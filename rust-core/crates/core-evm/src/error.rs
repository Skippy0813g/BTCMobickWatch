use thiserror::Error;

#[derive(Debug, Error)]
pub enum EvmError {
    #[error("RPC error: {0}")]
    RpcError(String),
    #[error("invalid address: {0}")]
    InvalidAddress(String),
    #[error("contract call failed: {0}")]
    ContractCall(String),
}
