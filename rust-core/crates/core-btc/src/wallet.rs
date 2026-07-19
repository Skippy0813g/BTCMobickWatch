use bdk_wallet::{Wallet, KeychainKind, CreateParams, ChangeSet};
use bdk_chain::{ChainPosition, Merge};
use bitcoin::Network;
use crate::BtcError;

// Wallet persistence (ChangeSet) helpers
// So the in-memory wallet can be restored after an app restart, BDK's ChangeSet is
// serialized and stored as a file by the app, then the wallet is restored from it on restart.

/// Restore a wallet from a stored changeset (JSON).
/// The changeset itself holds the descriptor/network, so no separate descriptor arg is needed.
pub fn load_watch_wallet(network: Network, changeset: ChangeSet) -> Result<Wallet, BtcError> {
    Wallet::load()
        .check_network(network)
        .load_wallet_no_persist(changeset)
        .map_err(|e| BtcError::InvalidDescriptor(format!("wallet load: {e}")))?
        .ok_or_else(|| BtcError::InvalidDescriptor("empty or mismatched changeset".into()))
}

/// Extract the wallet's initial staged changeset (descriptor/network, etc.) right after creation.
pub fn take_initial_changeset(wallet: &mut Wallet) -> ChangeSet {
    wallet.take_staged().unwrap_or_default()
}

/// Merge the wallet's unsaved staged changes (from scans, etc.) into the cumulative changeset.
pub fn merge_staged(wallet: &mut Wallet, aggregate: &mut ChangeSet) {
    if let Some(delta) = wallet.take_staged() {
        aggregate.merge(delta);
    }
}

pub fn serialize_changeset(cs: &ChangeSet) -> Result<String, BtcError> {
    serde_json::to_string(cs).map_err(|e| BtcError::ScanFailed(format!("changeset serialize: {e}")))
}

pub fn parse_changeset(json: &str) -> Result<ChangeSet, BtcError> {
    serde_json::from_str(json)
        .map_err(|e| BtcError::InvalidDescriptor(format!("changeset parse: {e}")))
}

pub fn create_watch_wallet(
    network: Network,
    external_descriptor: String,
    change_descriptor: Option<String>,
) -> Result<Wallet, BtcError> {
    let params: CreateParams = match change_descriptor {
        Some(change) => Wallet::create(external_descriptor, change),
        None => Wallet::create_single(external_descriptor),
    };

    params
        .network(network)
        .create_wallet_no_persist()
        .map_err(|e| BtcError::InvalidDescriptor(e.to_string()))
}

/// Return the next-unused external receive address (industry-standard way to show a receive address).
/// Accurate only when called after full_scan has filled in usage history. Reveals and returns the
/// lowest unused-index address, so &mut is needed (in-memory wallet, no persist).
pub fn next_unused_address(wallet: &mut Wallet) -> String {
    wallet
        .next_unused_address(KeychainKind::External)
        .address
        .to_string()
}

pub fn get_addresses(wallet: &Wallet, start: u32, count: u32) -> Vec<String> {
    (start..start + count)
        .map(|i| {
            wallet
                .peek_address(KeychainKind::External, i)
                .address
                .to_string()
        })
        .collect()
}

pub struct AddressWithBalance {
    pub address: String,
    pub balance_sat: u64,
    /// Whether used before (true if any past tx, even if balance is now 0). Flags address reuse.
    pub used: bool,
}

pub fn get_addresses_with_balance(wallet: &Wallet, start: u32, count: u32, is_change: bool) -> Vec<AddressWithBalance> {
    use std::collections::HashMap;
    use bitcoin::ScriptBuf;

    // Build a script_pubkey -> balance map from UTXOs cached after fullScan
    let mut balance_map: HashMap<ScriptBuf, u64> = HashMap::new();
    for utxo in wallet.list_unspent() {
        *balance_map.entry(utxo.txout.script_pubkey.clone()).or_insert(0)
            += utxo.txout.value.to_sat();
    }

    (start..start + count)
        .map(|i| {
            let keychain = if is_change { KeychainKind::Internal } else { KeychainKind::External };
            let info = wallet.peek_address(keychain, i);
            let script = info.address.script_pubkey();
            let balance_sat = balance_map.get(&script).copied().unwrap_or(0);
            // Usage: whether the BDK indexer marked it used (true if it appeared in the tx graph, kept even at 0 balance)
            let used = wallet.spk_index().is_used(keychain, i);
            AddressWithBalance { address: info.address.to_string(), balance_sat, used }
        })
        .collect()
}

#[derive(Clone)]
pub struct TxInfo {
    pub txid: String,
    pub confirmed_at: Option<u64>,
    pub block_height: Option<u32>,
    pub sent_sat: u64,
    pub received_sat: u64,
}

pub fn list_transactions(wallet: &Wallet) -> Vec<TxInfo> {
    let mut txs: Vec<TxInfo> = wallet
        .transactions()
        .map(|ct| {
            let txid = ct.tx_node.txid.to_string();
            let (sent, received) = wallet.sent_and_received(&ct.tx_node.tx);
            let (confirmed_at, block_height) = match ct.chain_position {
                ChainPosition::Confirmed { anchor, .. } => (
                    Some(anchor.confirmation_time),
                    Some(anchor.block_id.height),
                ),
                ChainPosition::Unconfirmed { .. } => (None, None),
            };
            TxInfo {
                txid,
                confirmed_at,
                block_height,
                sent_sat: sent.to_sat(),
                received_sat: received.to_sat(),
            }
        })
        .collect();

    // Newest block first, unconfirmed at the front
    txs.sort_by(|a, b| b.block_height.cmp(&a.block_height));
    txs
}
