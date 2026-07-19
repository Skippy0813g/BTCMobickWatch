use core_evm::balance;
use crate::{WalletError, runtime};

pub struct EvmBalanceChecker {
    rpc_url: String,
}

impl EvmBalanceChecker {
    pub fn new(rpc_url: String) -> Self {
        Self { rpc_url }
    }

    pub fn get_token_balance(
        &self,
        contract_addr: String,
        wallet_addr: String,
    ) -> Result<String, WalletError> {
        let url = self.rpc_url.clone();
        runtime()
            .block_on(balance::get_token_balance(&url, &contract_addr, &wallet_addr))
            .map_err(|e| WalletError::RpcError(e.to_string()))
    }

    pub fn get_native_balance(
        &self,
        wallet_addr: String,
    ) -> Result<String, WalletError> {
        let url = self.rpc_url.clone();
        runtime()
            .block_on(balance::get_native_balance(&url, &wallet_addr))
            .map_err(|e| WalletError::RpcError(e.to_string()))
    }
}
