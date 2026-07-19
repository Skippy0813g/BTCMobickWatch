use std::sync::OnceLock;
use tokio::runtime::Runtime;

mod btc_api;
mod evm_api;

uniffi::include_scaffolding!("wallet_core");

// Global tokio runtime

static RUNTIME: OnceLock<Runtime> = OnceLock::new();

pub fn init_runtime() {
    // rustls 0.23+ requires exactly one crypto provider; install ring before any TLS call
    let _ = rustls::crypto::ring::default_provider().install_default();
    RUNTIME.get_or_init(|| Runtime::new().expect("tokio runtime init failed"));
}

pub(crate) fn runtime() -> &'static Runtime {
    RUNTIME.get().expect("init_runtime() must be called first")
}

// Error types (1:1 mapping to the UDL)

#[derive(Debug, thiserror::Error)]
pub enum WalletError {
    #[error("invalid descriptor: {0}")]  InvalidDescriptor(String),
    #[error("electrum connection: {0}")] ElectrumConnection(String),
    #[error("scan failed: {0}")]         ScanFailed(String),
    #[error("psbt creation: {0}")]       PsbtCreation(String),
    #[error("broadcast: {0}")]           Broadcast(String),
    #[error("rpc error: {0}")]           RpcError(String),
    #[error("invalid address: {0}")]     InvalidAddress(String),
    #[error("insufficient funds")]       InsufficientFunds,
}

// UniFFI-exposed types

pub use btc_api::BtcWatchWallet;
pub use evm_api::EvmBalanceChecker;

pub fn zpub_to_descriptor(zpub: String) -> Result<String, WalletError> {
    core_btc::zpub::zpub_to_descriptor(&zpub)
        .map_err(|e| WalletError::InvalidDescriptor(e.to_string()))
}

pub fn zpub_to_change_descriptor(zpub: String) -> Result<String, WalletError> {
    core_btc::zpub::zpub_to_change_descriptor(&zpub)
        .map_err(|e| WalletError::InvalidDescriptor(e.to_string()))
}

/// Single-address tx history (view-only)
pub fn scan_address_history(
    network: WalletNetwork,
    address: String,
    electrum_urls: Vec<String>,
) -> Result<Vec<TxInfo>, WalletError> {
    let use_pinning = matches!(network, WalletNetwork::Mobick | WalletNetwork::LaptopMining);
    runtime()
        .block_on(core_btc::scanner::scan_address_history(&address, &electrum_urls, use_pinning))
        .map(|txs| txs.into_iter().map(|t| TxInfo {
            txid: t.txid,
            confirmed_at: t.confirmed_at,
            block_height: t.block_height,
            sent_sat: t.sent_sat,
            received_sat: t.received_sat,
        }).collect())
        .map_err(|e| match e {
            core_btc::BtcError::InvalidAddress(s) => WalletError::InvalidAddress(s),
            other => WalletError::ScanFailed(other.to_string()),
        })
}

/// Electrum fee estimate (fast/normal/slow, sat/vB)
pub fn scan_fee_estimates(
    network: WalletNetwork,
    electrum_urls: Vec<String>,
) -> Result<FeeEstimates, WalletError> {
    let use_pinning = matches!(network, WalletNetwork::Mobick | WalletNetwork::LaptopMining);
    runtime()
        .block_on(core_btc::scanner::estimate_fees(&electrum_urls, use_pinning))
        .map(|f| FeeEstimates {
            fast_sat_vb: f.fast_sat_vb,
            normal_sat_vb: f.normal_sat_vb,
            slow_sat_vb: f.slow_sat_vb,
        })
        .map_err(|e| WalletError::ScanFailed(e.to_string()))
}

/// Single-address balance (view-only - no BDK wallet)
pub fn scan_address_balance(
    network: WalletNetwork,
    address: String,
    electrum_urls: Vec<String>,
) -> Result<BalanceInfo, WalletError> {
    let use_pinning = matches!(network, WalletNetwork::Mobick | WalletNetwork::LaptopMining);
    runtime()
        .block_on(core_btc::scanner::scan_address_balance(&address, &electrum_urls, use_pinning))
        .map(|b| BalanceInfo {
            confirmed_sat: b.confirmed_sat,
            unconfirmed_sat: b.unconfirmed_sat,
            trusted_pending_sat: b.trusted_pending_sat,
            pending_outgoing_sat: b.pending_outgoing_sat,
        })
        .map_err(|e| match e {
            core_btc::BtcError::InvalidAddress(s) => WalletError::InvalidAddress(s),
            other => WalletError::ScanFailed(other.to_string()),
        })
}

#[derive(Debug, Clone)]
pub struct BalanceInfo {
    pub confirmed_sat: u64,
    pub unconfirmed_sat: u64,
    pub trusted_pending_sat: u64,
    pub pending_outgoing_sat: u64,
}

#[derive(Debug, Clone)]
pub struct PsbtResult {
    pub psbt_base64: String,
    pub fee_sat: u64,
}

/// PSBT decode result (for WYSIWYS cross-check)
#[derive(Debug, Clone)]
pub struct PsbtDecoded {
    pub recipient: String,
    pub amount_sat: u64,
    pub fee_sat: u64,
    pub change_sat: u64,
    pub external_output_count: u64,
}

#[derive(Debug, Clone)]
pub struct FeeEstimates {
    pub fast_sat_vb: f64,
    pub normal_sat_vb: f64,
    pub slow_sat_vb: f64,
}

#[derive(Debug, Clone)]
pub struct AddressInfo {
    pub address: String,
    pub balance_sat: u64,
    pub used: bool,
}

#[derive(Debug, Clone)]
pub struct TxInfo {
    pub txid: String,
    pub confirmed_at: Option<u64>,
    pub block_height: Option<u32>,
    pub sent_sat: u64,
    pub received_sat: u64,
}

#[derive(Debug, Clone)]
pub enum WalletNetwork {
    Mobick,
    LaptopMining,
    Bitcoin,
}
