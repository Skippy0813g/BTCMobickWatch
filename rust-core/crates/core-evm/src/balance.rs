use alloy::{
    primitives::{Address, Bytes, U256},
    providers::{Provider, ProviderBuilder},
    rpc::types::TransactionRequest,
    sol,
    sol_types::SolCall,
};
use std::str::FromStr;
use crate::EvmError;

sol!(
    #[allow(missing_docs)]
    function balanceOf(address owner) external view returns (uint256);
);

pub async fn get_token_balance(
    rpc_url: &str,
    contract_addr: &str,
    wallet_addr: &str,
) -> Result<String, EvmError> {
    let url = rpc_url
        .parse::<reqwest::Url>()
        .map_err(|e| EvmError::RpcError(e.to_string()))?;

    let provider = ProviderBuilder::new().connect_http(url);

    let contract = Address::from_str(contract_addr)
        .map_err(|e| EvmError::InvalidAddress(e.to_string()))?;
    let owner = Address::from_str(wallet_addr)
        .map_err(|e| EvmError::InvalidAddress(e.to_string()))?;

    let calldata = Bytes::from(balanceOfCall { owner }.abi_encode());
    let result = provider
        .call(TransactionRequest::default().to(contract).input(calldata.into()))
        .await
        .map_err(|e| EvmError::ContractCall(e.to_string()))?;

    let balance = U256::from_be_slice(&result);
    Ok(balance.to_string())
}

pub async fn get_native_balance(
    rpc_url: &str,
    wallet_addr: &str,
) -> Result<String, EvmError> {
    let url = rpc_url
        .parse::<reqwest::Url>()
        .map_err(|e| EvmError::RpcError(e.to_string()))?;

    let provider = ProviderBuilder::new().connect_http(url);

    let address = Address::from_str(wallet_addr)
        .map_err(|e| EvmError::InvalidAddress(e.to_string()))?;

    let balance = provider
        .get_balance(address)
        .await
        .map_err(|e| EvmError::RpcError(e.to_string()))?;

    Ok(balance.to_string())
}
