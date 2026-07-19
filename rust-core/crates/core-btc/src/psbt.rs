use bdk_wallet::{bitcoin::FeeRate, Wallet};
use bitcoin::{Address, Amount};
use bitcoin::psbt::Psbt;
use std::str::FromStr;
use crate::BtcError;

/// PSBT creation result: (base64, actual fee sat)
pub fn create_psbt(
    wallet: &mut Wallet,
    recipient: &str,
    amount_sat: u64,
    fee_rate_sat_vb: f32,
) -> Result<(String, u64), BtcError> {
    let address = Address::from_str(recipient)
        .map_err(|e| BtcError::InvalidAddress(e.to_string()))?
        .require_network(wallet.network())
        .map_err(|e| BtcError::InvalidAddress(e.to_string()))?;

    let fee_rate = FeeRate::from_sat_per_vb(fee_rate_sat_vb as u64)
        .ok_or_else(|| BtcError::PsbtCreation("invalid fee rate".into()))?;

    // For Send-All, collect the unconfirmed UTXOs in advance so only "confirmed UTXOs" are spent.
    // (build_tx() mutably borrows the wallet, so grab this via an immutable borrow first.)
    let unconfirmed_outpoints: Vec<bitcoin::OutPoint> = if amount_sat == 0 {
        wallet
            .list_unspent()
            .filter(|u| !u.chain_position.is_confirmed())
            .map(|u| u.outpoint)
            .collect()
    } else {
        Vec::new()
    };

    let mut builder = wallet.build_tx();
    if amount_sat == 0 {
        // Send-All: use amount_sat == 0 as a magic value.
        // Spend all confirmed UTXOs (drain_wallet) and send the full amount minus fee
        // to the recipient (drain_to). add_recipient is not called.
        // Unconfirmed UTXOs are marked unspendable to exclude them - avoids building a child tx
        // that spends an unsettled parent (if the parent is dropped/RBF'd, the sweep is invalidated too).
        builder
            .drain_wallet()
            .drain_to(address.script_pubkey())
            .fee_rate(fee_rate);
        for op in &unconfirmed_outpoints {
            builder.add_unspendable(*op);
        }
    } else {
        builder
            .add_recipient(address.script_pubkey(), Amount::from_sat(amount_sat))
            .fee_rate(fee_rate);
    }
    let psbt = builder
        .finish()
        .map_err(|e| BtcError::PsbtCreation(e.to_string()))?;

    let fee_sat = psbt
        .fee()
        .map_err(|e| BtcError::PsbtCreation(format!("fee calc: {e}")))?
        .to_sat();

    Ok((psbt.to_string(), fee_sat))
}

/// Result of decoding a PSBT from its actual bytes (for WYSIWYS cross-check)
///
/// Instead of the UI showing the user's raw inputs, it must display/compare the
/// "actual values in the PSBT" held by this struct to detect tampering.
pub struct PsbtDecoded {
    /// External (not owned by my wallet) recipient address. Based on the first external output.
    pub recipient: String,
    /// Total amount going out (sat) - excludes change.
    pub amount_sat: u64,
    /// Fee the PSBT actually pays (sat).
    pub fee_sat: u64,
    /// Change returning to my wallet (sat).
    pub change_sat: u64,
    /// Number of external outputs. Should be 1 for a normal single send.
    pub external_output_count: u64,
}

/// Parse the given PSBT (base64) and extract the actual outputs/fee.
///
/// Uses the wallet descriptor to determine whether each output is mine (change),
/// separating external recipient outputs from change. Used to verify that on-screen
/// values match the actual bytes being signed.
pub fn decode_psbt(wallet: &Wallet, psbt_base64: &str) -> Result<PsbtDecoded, BtcError> {
    let psbt = Psbt::from_str(psbt_base64)
        .map_err(|e| BtcError::PsbtCreation(format!("invalid PSBT: {e}")))?;

    let fee_sat = psbt
        .fee()
        .map_err(|e| BtcError::PsbtCreation(format!("fee calc: {e}")))?
        .to_sat();

    let mut recipient: Option<String> = None;
    let mut amount_sat: u64 = 0;
    let mut change_sat: u64 = 0;
    let mut external_output_count: u64 = 0;

    for txout in &psbt.unsigned_tx.output {
        let script = txout.script_pubkey.clone();
        if wallet.is_mine(script.clone()) {
            change_sat = change_sat.saturating_add(txout.value.to_sat());
        } else {
            external_output_count += 1;
            amount_sat = amount_sat.saturating_add(txout.value.to_sat());
            if recipient.is_none() {
                recipient = Some(
                    Address::from_script(&script, wallet.network())
                        .map(|a| a.to_string())
                        .unwrap_or_else(|_| "unknown".to_string()),
                );
            }
        }
    }

    let recipient = recipient
        .ok_or_else(|| BtcError::PsbtCreation("no external recipient output".into()))?;

    Ok(PsbtDecoded {
        recipient,
        amount_sat,
        fee_sat,
        change_sat,
        external_output_count,
    })
}
