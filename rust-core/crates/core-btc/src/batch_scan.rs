//! Batched Electrum full scan — a drop-in for `bdk_electrum`'s `full_scan` that
//! collapses per-transaction round trips into batched calls.
//!
//! `bdk_electrum` 0.20 fetches each discovered transaction with ~3 sequential round
//! trips (`transaction_get`, `script_get_history`, `transaction_get_merkle`). On a
//! high-latency server — BMB is a single AWS Sydney node — that count dominates scan
//! time (a wallet with N txs costs ~3N serial round trips). Here we instead:
//!   1. discover with `batch_script_get_history` (as bdk does),
//!   2. fetch every discovered tx in one `batch_transaction_get`,
//!   3. fetch every confirmed block header in one `batch_block_header`,
//!   4. build anchors from (height, header) directly.
//!
//! Trade-off: no per-tx merkle-proof validation. This is a watch-only wallet that
//! already trusts the pinned Electrum server for all balance/history data; the merkle
//! proof is validated against a header from that same server, so it adds little here.
//! Standard watch-only wallets (e.g. BlueWallet) skip it too. The produced
//! `FullScanResponse` is otherwise identical to bdk's, so `Wallet::apply_update` is
//! unaffected.

use bdk_chain::{
    bitcoin::{BlockHash, ScriptBuf, Txid},
    collections::BTreeMap,
    spk_client::{FullScanRequest, FullScanResponse, SyncRequest, SyncResponse},
    BlockId, CheckPoint, ConfirmationBlockTime, TxUpdate,
};
use bdk_electrum::electrum_client::{ElectrumApi, HeaderNotification};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use crate::BtcError;

/// Chain suffix length used when building checkpoint updates (matches bdk_electrum).
const CHAIN_SUFFIX_LENGTH: u32 = 8;

fn scan_err<E: std::fmt::Display>(e: E) -> BtcError {
    BtcError::ScanFailed(e.to_string())
}

/// Batched drop-in for `BdkElectrumClient::full_scan` (no merkle validation — see module docs).
pub fn full_scan<K: Ord + Clone>(
    client: &impl ElectrumApi,
    request: impl Into<FullScanRequest<K>>,
    stop_gap: usize,
    batch_size: usize,
) -> Result<FullScanResponse<K>, BtcError> {
    let mut request: FullScanRequest<K> = request.into();

    let tip_and_blocks = match request.chain_tip() {
        Some(tip) => Some(fetch_tip_and_latest_blocks(client, tip)?),
        None => None,
    };

    // Phase 1: discover which scripts have history (batched), collecting (txid, height).
    let mut collected = Vec::<(Txid, i32)>::new();
    let mut last_active_indices = BTreeMap::<K, u32>::default();
    for keychain in request.keychains() {
        let spks = request.iter_spks(keychain.clone());
        if let Some(idx) = discover(client, spks, stop_gap, batch_size, &mut collected)? {
            last_active_indices.insert(keychain, idx);
        }
    }

    // Phase 2: fetch tx bodies + confirmed headers in batches, build the update.
    let tx_update = build_update(client, &collected, batch_size)?;

    let chain_update = match tip_and_blocks {
        Some((tip, latest_blocks)) => Some(build_chain_update(
            tip,
            &latest_blocks,
            tx_update.anchors.iter().cloned(),
        )?),
        None => None,
    };

    Ok(FullScanResponse {
        tx_update,
        chain_update,
        last_active_indices,
    })
}

/// Batched drop-in for `BdkElectrumClient::sync` (no merkle validation — see module docs).
///
/// Our wallet sync (`start_sync_with_revealed_spks`) carries only revealed spks — no
/// explicit txids/outpoints. Electrum's `get_history` returns transactions that *spend
/// from* a scripthash as well as those that pay it, so syncing every revealed spk captures
/// spends too; separate outpoint spend-detection is unnecessary. That assumption is guarded.
pub fn sync<I: 'static>(
    client: &impl ElectrumApi,
    request: impl Into<SyncRequest<I>>,
    batch_size: usize,
) -> Result<SyncResponse, BtcError> {
    let mut request: SyncRequest<I> = request.into();

    let tip_and_blocks = match request.chain_tip() {
        Some(tip) => Some(fetch_tip_and_latest_blocks(client, tip)?),
        None => None,
    };

    // Sync scans a known, finite set of revealed spks — no stop_gap early exit.
    let mut collected = Vec::<(Txid, i32)>::new();
    let spks = request.iter_spks().enumerate().map(|(i, spk)| (i as u32, spk));
    discover(client, spks, usize::MAX, batch_size, &mut collected)?;

    // Only the revealed-spks sync is supported (see above). Fail loudly rather than
    // silently drop data if the request ever carries explicit txids/outpoints.
    let has_txids = request.iter_txids().next().is_some();
    let has_outpoints = request.iter_outpoints().next().is_some();
    if has_txids || has_outpoints {
        return Err(BtcError::ScanFailed(
            "batched sync received unexpected txids/outpoints".into(),
        ));
    }

    let tx_update = build_update(client, &collected, batch_size)?;

    let chain_update = match tip_and_blocks {
        Some((tip, latest_blocks)) => Some(build_chain_update(
            tip,
            &latest_blocks,
            tx_update.anchors.iter().cloned(),
        )?),
        None => None,
    };

    Ok(SyncResponse {
        tx_update,
        chain_update,
    })
}

/// Walk `spks` in batches, collecting `(txid, height)` for every script that has history.
/// Returns the last index that had any history, or `None`. Stops a keychain after
/// `stop_gap` consecutive unused scripts (same rule as bdk_electrum's `populate_with_spks`).
fn discover(
    client: &impl ElectrumApi,
    mut spks: impl Iterator<Item = (u32, ScriptBuf)>,
    stop_gap: usize,
    batch_size: usize,
    out: &mut Vec<(Txid, i32)>,
) -> Result<Option<u32>, BtcError> {
    let mut unused = 0usize;
    let mut last_active: Option<u32> = None;

    loop {
        let batch: Vec<(u32, ScriptBuf)> = (0..batch_size).map_while(|_| spks.next()).collect();
        if batch.is_empty() {
            return Ok(last_active);
        }

        let histories = client
            .batch_script_get_history(batch.iter().map(|(_, s)| s.as_script()))
            .map_err(scan_err)?;

        for ((idx, _spk), history) in batch.into_iter().zip(histories) {
            if history.is_empty() {
                unused = unused.saturating_add(1);
                if unused >= stop_gap {
                    return Ok(last_active);
                }
                continue;
            }
            last_active = Some(idx);
            unused = 0;
            for h in history {
                out.push((h.tx_hash, h.height));
            }
        }
    }
}

/// Fetch all collected txs (one batch) and build the `TxUpdate`, anchoring confirmed
/// ones from batched block headers. No merkle proof (see module docs).
fn build_update(
    client: &impl ElectrumApi,
    collected: &[(Txid, i32)],
    batch_size: usize,
) -> Result<TxUpdate<ConfirmationBlockTime>, BtcError> {
    let mut tx_update = TxUpdate::<ConfirmationBlockTime>::default();

    // Unique txids to fetch; confirmed (height > 0) tx→height and the heights to header-fetch.
    let mut seen_txid = HashSet::<Txid>::new();
    let mut txids = Vec::<Txid>::new();
    let mut confirmed = Vec::<(Txid, u32)>::new();
    let mut seen_height = HashSet::<u32>::new();
    let mut heights = Vec::<u32>::new();
    for (txid, height) in collected {
        if seen_txid.insert(*txid) {
            txids.push(*txid);
        }
        if *height > 0 {
            let h = *height as u32;
            confirmed.push((*txid, h));
            if seen_height.insert(h) {
                heights.push(h);
            }
        }
    }

    // Tx bodies: batched in chunks (a single huge request could exceed server limits).
    // bdk keys txs by their computed txid, so order is irrelevant.
    for chunk in txids.chunks(batch_size) {
        for tx in client.batch_transaction_get(chunk.iter()).map_err(scan_err)? {
            tx_update.txs.push(Arc::new(tx));
        }
    }

    // Anchors: fetch each confirmed height's header once (batched in chunks), then anchor directly.
    if !heights.is_empty() {
        let mut by_height: HashMap<u32, _> = HashMap::new();
        for chunk in heights.chunks(batch_size) {
            let headers = client
                .batch_block_header(chunk.iter().copied())
                .map_err(scan_err)?;
            for (h, header) in chunk.iter().copied().zip(headers) {
                by_height.insert(h, header);
            }
        }
        for (txid, height) in confirmed {
            if let Some(header) = by_height.get(&height) {
                tx_update.anchors.insert((
                    ConfirmationBlockTime {
                        confirmation_time: header.time as u64,
                        block_id: BlockId {
                            height,
                            hash: header.block_hash(),
                        },
                    },
                    txid,
                ));
            }
        }
    }

    Ok(tx_update)
}

// ── Checkpoint / chain-tip helpers (ported from bdk_electrum; not a bottleneck) ──────

/// Return a [`CheckPoint`] of the latest tip that connects with `prev_tip`, plus the
/// latest blocks (for consistent hashes across a re-org).
fn fetch_tip_and_latest_blocks(
    client: &impl ElectrumApi,
    prev_tip: CheckPoint,
) -> Result<(CheckPoint, BTreeMap<u32, BlockHash>), BtcError> {
    let HeaderNotification { height, .. } = client.block_headers_subscribe().map_err(scan_err)?;
    let new_tip_height = height as u32;

    // Electrum's tip is behind ours: no checkpoint update needed.
    if new_tip_height < prev_tip.height() {
        return Ok((prev_tip, BTreeMap::new()));
    }

    let mut new_blocks = {
        let start_height = new_tip_height.saturating_sub(CHAIN_SUFFIX_LENGTH - 1);
        let hashes = client
            .block_headers(start_height as _, CHAIN_SUFFIX_LENGTH as _)
            .map_err(scan_err)?
            .headers
            .into_iter()
            .map(|h| h.block_hash());
        (start_height..).zip(hashes).collect::<BTreeMap<u32, _>>()
    };

    // Find the point of agreement between our previous tip and the server's chain.
    let agreement_cp = {
        let mut agreement_cp = Option::<CheckPoint>::None;
        for cp in prev_tip.iter() {
            let cp_block = cp.block_id();
            let hash = match new_blocks.get(&cp_block.height) {
                Some(&hash) => hash,
                None => {
                    let hash = client
                        .block_header(cp_block.height as _)
                        .map_err(scan_err)?
                        .block_hash();
                    new_blocks.insert(cp_block.height, hash);
                    hash
                }
            };
            if hash == cp_block.hash {
                agreement_cp = Some(cp);
                break;
            }
        }
        agreement_cp
    };

    let agreement_height = agreement_cp.as_ref().map(CheckPoint::height);

    let new_tip = new_blocks
        .iter()
        .filter(|(height, _)| Some(**height) > agreement_height)
        .map(|(height, hash)| BlockId {
            height: *height,
            hash: *hash,
        })
        .fold(agreement_cp, |prev_cp, block| {
            Some(match prev_cp {
                Some(cp) => cp.push(block).expect("must extend checkpoint"),
                None => CheckPoint::new(block),
            })
        })
        .expect("must have at least one checkpoint");

    Ok((new_tip, new_blocks))
}

/// Add a checkpoint per anchor height if missing (bounded by `latest_blocks`).
fn build_chain_update(
    mut tip: CheckPoint,
    latest_blocks: &BTreeMap<u32, BlockHash>,
    anchors: impl Iterator<Item = (ConfirmationBlockTime, Txid)>,
) -> Result<CheckPoint, BtcError> {
    for (anchor, _txid) in anchors {
        let height = anchor.block_id.height;
        if tip.get(height).is_none() && height <= tip.height() {
            let hash = match latest_blocks.get(&height) {
                Some(&hash) => hash,
                None => anchor.block_id.hash,
            };
            tip = tip.insert(BlockId { hash, height });
        }
    }
    Ok(tip)
}
