use bdk_electrum::electrum_client::{self, ElectrumApi};
use bitcoin::Transaction;
use bdk_wallet::bitcoin::psbt::Psbt;
use std::str::FromStr;
use crate::BtcError;
use crate::scanner::{make_ssl_client, parse_ssl_url, try_each_url};

pub async fn broadcast_signed_psbt(
    psbt_base64: &str,
    electrum_urls: &[String],
    use_pinning: bool,
) -> Result<String, BtcError> {
    let psbt = Psbt::from_str(psbt_base64)
        .map_err(|e| BtcError::Broadcast(format!("invalid PSBT: {e}")))?;
    let tx: Transaction = psbt
        .extract_tx()
        .map_err(|e| BtcError::Broadcast(format!("PSBT not fully signed: {e}")))?;

    // Try servers in order (auto fallback). Re-broadcasting the same signed tx is idempotent (same txid) - safe to retry.
    let txid = try_each_url(electrum_urls, use_pinning, |url| {
        if url.starts_with("ssl://") {
            let (host, port) = parse_ssl_url(url)?;
            let client = make_ssl_client(host, port, use_pinning)?;
            client.transaction_broadcast(&tx)
                .map_err(|e| BtcError::Broadcast(e.to_string()))
        } else {
            let config = electrum_client::ConfigBuilder::new().timeout(Some(15)).build();
            let client = electrum_client::Client::from_config(url, config)
                .map_err(|e| BtcError::ElectrumConnection(e.to_string()))?;
            client.transaction_broadcast(&tx)
                .map_err(|e| BtcError::Broadcast(e.to_string()))
        }
    })?;

    Ok(txid.to_string())
}
