use thiserror::Error;

#[derive(Debug, Error)]
pub enum BtcError {
    #[error("invalid descriptor: {0}")]
    InvalidDescriptor(String),
    #[error("electrum connection failed: {0}")]
    ElectrumConnection(String),
    #[error("full scan failed: {0}")]
    ScanFailed(String),
    #[error("PSBT creation failed: {0}")]
    PsbtCreation(String),
    #[error("broadcast failed: {0}")]
    Broadcast(String),
    #[error("insufficient funds")]
    InsufficientFunds,
    #[error("invalid address: {0}")]
    InvalidAddress(String),
}
