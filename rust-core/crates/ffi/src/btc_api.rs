use std::sync::Mutex;
use bitcoin::Network;
use bdk_wallet::{Wallet, ChangeSet};
use core_btc::{wallet, scanner, psbt, broadcast};
use crate::{BalanceInfo, TxInfo, WalletError, WalletNetwork, runtime};

pub struct BtcWatchWallet {
    inner: Mutex<Wallet>,
    /// Wallet changeset kept cumulatively for restore after an app restart.
    /// Merges the staged delta on each scan/sync; serialized via export_changeset for the app to store.
    changeset: Mutex<ChangeSet>,
    /// Serializes scans against each other without blocking readers.
    ///
    /// `inner` used to be held for a whole scan, which did serialize scans — but it also froze
    /// every read (address list, balance) for the scan's full network duration, minutes on a
    /// first import. Scans now take `inner` only to build the request and to apply the result,
    /// so this lock preserves the "one scan at a time" guarantee that `inner` used to provide.
    scan: Mutex<()>,
    use_pinning: bool,
}

impl WalletNetwork {
    fn use_pinning(&self) -> bool {
        matches!(self, WalletNetwork::Mobick | WalletNetwork::LaptopMining)
    }

    fn to_bitcoin(&self) -> Network {
        match self {
            WalletNetwork::Mobick       => Network::Mobick,
            WalletNetwork::LaptopMining => Network::LaptopMining,
            WalletNetwork::Bitcoin      => Network::Bitcoin,
        }
    }
}

impl BtcWatchWallet {
    pub fn new(
        network: WalletNetwork,
        descriptor: String,
        change_descriptor: Option<String>,
    ) -> Result<Self, WalletError> {
        let use_pinning = network.use_pinning();
        let net = network.to_bitcoin();
        let mut w = wallet::create_watch_wallet(net, descriptor, change_descriptor)
            .map_err(|e| WalletError::InvalidDescriptor(e.to_string()))?;
        let initial = wallet::take_initial_changeset(&mut w);
        Ok(Self { inner: Mutex::new(w), changeset: Mutex::new(initial), scan: Mutex::new(()), use_pinning })
    }

    /// Restore a wallet from a stored changeset (JSON) - used on app restart.
    pub fn from_changeset(
        network: WalletNetwork,
        changeset_json: String,
    ) -> Result<Self, WalletError> {
        let use_pinning = network.use_pinning();
        let net = network.to_bitcoin();
        let cs = wallet::parse_changeset(&changeset_json)
            .map_err(|e| WalletError::InvalidDescriptor(e.to_string()))?;
        let w = wallet::load_watch_wallet(net, cs.clone())
            .map_err(|e| WalletError::InvalidDescriptor(e.to_string()))?;
        Ok(Self { inner: Mutex::new(w), changeset: Mutex::new(cs), scan: Mutex::new(()), use_pinning })
    }

    /// Serialize the cumulative changeset to JSON (the app stores it as an encrypted file).
    pub fn export_changeset(&self) -> Result<String, WalletError> {
        let cs = self.changeset.lock().unwrap();
        wallet::serialize_changeset(&cs).map_err(|e| WalletError::ScanFailed(e.to_string()))
    }

    /// Deep scan (first import). The wallet lock is taken only to build each attempt's
    /// request and to apply the result; the network phase runs without it, so reads stay
    /// responsive while a scan that can take minutes is in flight.
    pub fn full_scan(&self, electrum_urls: Vec<String>) -> Result<BalanceInfo, WalletError> {
        let _scanning = self.scan.lock().unwrap();
        let resp = runtime()
            .block_on(scanner::run_full_scan(
                || scanner::build_full_scan_request(&mut self.inner.lock().unwrap()),
                &electrum_urls,
                self.use_pinning,
            ))
            .map_err(|e| WalletError::ScanFailed(e.to_string()))?;
        self.apply(resp)
    }

    /// Incremental sync (fast refresh). Rechecks known addresses only.
    pub fn sync(&self, electrum_urls: Vec<String>) -> Result<BalanceInfo, WalletError> {
        let _scanning = self.scan.lock().unwrap();
        let resp = runtime()
            .block_on(scanner::run_sync(
                || scanner::build_sync_request(&mut self.inner.lock().unwrap()),
                &electrum_urls,
                self.use_pinning,
            ))
            .map_err(|e| WalletError::ScanFailed(e.to_string()))?;
        self.apply(resp)
    }

    /// Fold a scan result into the wallet and stage it for persistence. Brief lock.
    fn apply(&self, update: impl Into<bdk_wallet::Update>) -> Result<BalanceInfo, WalletError> {
        let mut w = self.inner.lock().unwrap();
        let info = scanner::apply_scan_update(&mut w, update)
            .map_err(|e| WalletError::ScanFailed(e.to_string()))?;
        wallet::merge_staged(&mut w, &mut self.changeset.lock().unwrap());
        Ok(BalanceInfo {
            confirmed_sat:        info.confirmed_sat,
            unconfirmed_sat:      info.unconfirmed_sat,
            trusted_pending_sat:  info.trusted_pending_sat,
            pending_outgoing_sat: info.pending_outgoing_sat,
        })
    }

    pub fn get_addresses(&self, start: u32, count: u32) -> Result<Vec<String>, WalletError> {
        let w = self.inner.lock().unwrap();
        Ok(wallet::get_addresses(&w, start, count))
    }

    /// "Next unused receive address" for the card (standard). Call after full_scan.
    pub fn next_receive_address(&self) -> Result<String, WalletError> {
        let mut w = self.inner.lock().unwrap();
        Ok(wallet::next_unused_address(&mut w))
    }

    pub fn get_addresses_with_balance(&self, start: u32, count: u32, is_change: bool) -> Result<Vec<crate::AddressInfo>, WalletError> {
        let w = self.inner.lock().unwrap();
        Ok(wallet::get_addresses_with_balance(&w, start, count, is_change)
            .into_iter()
            .map(|a| crate::AddressInfo { address: a.address, balance_sat: a.balance_sat, used: a.used })
            .collect())
    }

    pub fn create_psbt(
        &self,
        recipient: String,
        amount_sat: u64,
        fee_rate_sat_vb: f32,
    ) -> Result<crate::PsbtResult, WalletError> {
        let mut w = self.inner.lock().unwrap();
        let (psbt_base64, fee_sat) = psbt::create_psbt(&mut w, &recipient, amount_sat, fee_rate_sat_vb)
            .map_err(|e| WalletError::PsbtCreation(e.to_string()))?;
        Ok(crate::PsbtResult { psbt_base64, fee_sat })
    }

    /// Decode a created/received PSBT from its actual bytes (WYSIWYS cross-check)
    pub fn decode_psbt(&self, psbt_base64: String) -> Result<crate::PsbtDecoded, WalletError> {
        let w = self.inner.lock().unwrap();
        let d = psbt::decode_psbt(&w, &psbt_base64)
            .map_err(|e| WalletError::PsbtCreation(e.to_string()))?;
        Ok(crate::PsbtDecoded {
            recipient: d.recipient,
            amount_sat: d.amount_sat,
            fee_sat: d.fee_sat,
            change_sat: d.change_sat,
            external_output_count: d.external_output_count,
        })
    }

    pub fn list_transactions(&self) -> Result<Vec<TxInfo>, WalletError> {
        let w = self.inner.lock().unwrap();
        let txs = wallet::list_transactions(&w)
            .into_iter()
            .map(|t| TxInfo {
                txid: t.txid,
                confirmed_at: t.confirmed_at,
                block_height: t.block_height,
                sent_sat: t.sent_sat,
                received_sat: t.received_sat,
            })
            .collect();
        Ok(txs)
    }

    pub fn broadcast_signed_psbt(
        &self,
        psbt_base64: String,
        electrum_urls: Vec<String>,
    ) -> Result<String, WalletError> {
        let use_pinning = self.use_pinning;
        runtime()
            .block_on(broadcast::broadcast_signed_psbt(&psbt_base64, &electrum_urls, use_pinning))
            .map_err(|e| WalletError::Broadcast(e.to_string()))
    }
}
