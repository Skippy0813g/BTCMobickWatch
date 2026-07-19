use bdk_electrum::electrum_client;
use bdk_electrum::electrum_client::{ElectrumApi, Param};
use electrum_client::raw_client::{RawClient, ElectrumSslStream};
use bdk_chain::spk_client::{FullScanRequest, FullScanResponse, SyncRequest, SyncResponse};
use bdk_wallet::{KeychainKind, Update, Wallet};
use rustls::{ClientConfig, DigitallySignedStruct};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, SubjectPublicKeyInfoDer, UnixTime};
use rustls_pemfile::certs;
use std::io::BufReader;
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;
use crate::BtcError;

pub struct BalanceInfo {
    pub confirmed_sat: u64,
    pub unconfirmed_sat: u64,
    /// Change from my own tx (unconfirmed) - standard wallets add it to the balance
    pub trusted_pending_sat: u64,
    /// Pending outgoing amount (for single-address and full-scan)
    pub pending_outgoing_sat: u64,
}

pub struct FeeEstimates {
    pub fast_sat_vb: f64,
    pub normal_sat_vb: f64,
    pub slow_sat_vb: f64,
}

// Bundled certificate DER: BMB (Fulcrum self-signed) + LTM (OTAVERSE wildcard)
const BMB_CERT_PEM: &[u8] = include_bytes!("../certs/mobick_electrum.pem");
const LTM_CERT_PEM: &[u8] = include_bytes!("../certs/ltm_electrum.pem");

/// One pinned cert: raw DER (for exact match) + SubjectPublicKeyInfo DER (for signature verification)
struct PinnedCert {
    der: Vec<u8>,
    spki: Vec<u8>,
}

/// Load the bundled certificates (PEM) and extract both DER and SPKI.
///
/// Why x509-parser is used for SPKI extraction: some servers (LTM) use X.509 v1
/// certificates, which webpki cannot parse. What we parse here is "trusted bytes we
/// bundled ourselves", so the parser's leniency is not a security risk.
fn load_pinned_certs() -> Result<Vec<PinnedCert>, BtcError> {
    use x509_parser::prelude::*;

    let mut out = Vec::new();
    for pem_bytes in [BMB_CERT_PEM, LTM_CERT_PEM] {
        let parsed: Vec<CertificateDer<'static>> = certs(&mut BufReader::new(pem_bytes))
            .collect::<Result<_, _>>()
            .map_err(|e| BtcError::ElectrumConnection(format!("cert parse: {e}")))?;
        for cert in parsed {
            let der = cert.to_vec();
            let (_, x509) = X509Certificate::from_der(&der)
                .map_err(|e| BtcError::ElectrumConnection(format!("x509 parse: {e}")))?;
            let spki = x509.public_key().raw.to_vec();
            out.push(PinnedCert { der, spki });
        }
    }
    Ok(out)
}

/// Pinning verifier that accepts only an end-entity cert exactly matching a bundled cert (DER).
///
/// The certificate itself is public information, so a cert match alone cannot stop MitM.
/// The handshake signature (proof of private-key ownership) MUST actually be verified
/// in `verify_tls1x_signature`.
#[derive(Debug)]
struct PinnedVerifier {
    pinned: Vec<PinnedCert>,
}

impl std::fmt::Debug for PinnedCert {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PinnedCert").finish_non_exhaustive()
    }
}

impl PinnedVerifier {
    /// If the presented cert exactly matches a pin, return that pin's SPKI.
    fn matching_spki(&self, cert: &CertificateDer<'_>) -> Option<&[u8]> {
        self.pinned
            .iter()
            .find(|p| p.der.as_slice() == cert.as_ref())
            .map(|p| p.spki.as_slice())
    }
}

impl ServerCertVerifier for PinnedVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        // Accept only on a byte-for-byte match with a bundled cert (self-signed pinning)
        if self.matching_spki(end_entity).is_some() {
            return Ok(ServerCertVerified::assertion());
        }
        Err(rustls::Error::General(
            "server certificate does not match pinned certificate".into(),
        ))
    }

    fn verify_tls12_signature(
        &self, msg: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        // Actually verify the handshake signature - proves the server owns the cert's private key.
        // Without this check, an attacker could copy the public cert and bypass pinning.
        rustls::crypto::verify_tls12_signature(
            msg, cert, dss,
            &rustls::crypto::ring::default_provider().signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self, msg: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        let algs = &rustls::crypto::ring::default_provider().signature_verification_algorithms;
        // For a pin-matched cert, verify the signature directly with the SPKI (public key).
        // webpki cannot parse X.509 v1 certs (e.g. LTM), so the key is to skip cert parsing
        // and verify with the SPKI pre-extracted from the trusted pin.
        if let Some(spki) = self.matching_spki(cert) {
            let spki = SubjectPublicKeyInfoDer::from(spki);
            return rustls::crypto::verify_tls13_signature_with_raw_key(msg, &spki, dss, algs);
        }
        // A pin mismatch is already rejected in verify_server_cert, but keep the standard path defensively.
        rustls::crypto::verify_tls13_signature(msg, cert, dss, algs)
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// BMB/LTM: pinning-verification TLS config
fn pinned_tls_config() -> Result<Arc<ClientConfig>, BtcError> {
    let pinned = load_pinned_certs()?;
    let verifier = Arc::new(PinnedVerifier { pinned });
    let config = ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth();
    Ok(Arc::new(config))
}

/// Bitcoin, etc. with public CAs: standard TLS config (webpki-roots)
fn standard_tls_config() -> Arc<ClientConfig> {
    let store = rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    Arc::new(ClientConfig::builder()
        .with_root_certificates(store)
        .with_no_client_auth())
}

/// Protocol version range we speak. ElectrumX rejects a client whose range it cannot meet.
const ELECTRUM_PROTOCOL_VERSION: &str = "1.4";

/// How we identify ourselves to electrum servers. Deliberately truthful: the source is
/// public, so a disguise would only be found out. No version — this crate's version is the
/// engine's, not the app's, and stating it would misreport who is connecting.
const ELECTRUM_CLIENT_NAME: &str = "BTCMobickWatch";

/// Identify the client to the server before any other request.
///
/// ElectrumX refuses every subsequent call with "use server.version to identify client"
/// until this handshake happens; Fulcrum does not require it. `electrum-client` never
/// sends it on any of its client types, so we must do it ourselves on every connection.
fn electrum_handshake<C: ElectrumApi>(client: &C) -> Result<(), BtcError> {
    client
        .raw_call(
            "server.version",
            vec![
                Param::String(ELECTRUM_CLIENT_NAME.to_string()),
                Param::String(ELECTRUM_PROTOCOL_VERSION.to_string()),
            ],
        )
        .map(|_| ())
        .map_err(|e| BtcError::ElectrumConnection(format!("server.version handshake: {e}")))
}

pub fn make_ssl_client(host: &str, port: u16, use_pinning: bool) -> Result<RawClient<ElectrumSslStream>, BtcError> {
    let config = if use_pinning {
        pinned_tls_config()?
    } else {
        standard_tls_config()
    };
    let addr = format!("{host}:{port}");
    let tcp = TcpStream::connect(&addr)
        .map_err(|e| BtcError::ElectrumConnection(format!("tcp connect {addr}: {e}")))?;
    tcp.set_read_timeout(Some(Duration::from_secs(15))).ok();
    tcp.set_write_timeout(Some(Duration::from_secs(15))).ok();
    let server_name = ServerName::try_from(host.to_string())
        .map_err(|e| BtcError::ElectrumConnection(format!("invalid server name: {e}")))?;
    let conn = rustls::ClientConnection::new(config, server_name)
        .map_err(|e| BtcError::ElectrumConnection(format!("tls init: {e}")))?;
    let client = RawClient::from(rustls::StreamOwned::new(conn, tcp));
    electrum_handshake(&client)?;
    Ok(client)
}

/// Reject plaintext (non-TLS) connections on networks that require pinning.
/// If use_pinning=true but the URL isn't ssl://, treat it as a downgrade attack and block it.
pub fn require_secure(url: &str, use_pinning: bool) -> Result<(), BtcError> {
    if use_pinning && !url.starts_with("ssl://") {
        return Err(BtcError::ElectrumConnection(format!(
            "insecure (non-TLS) electrum URL rejected for pinned network: {url}"
        )));
    }
    Ok(())
}

pub fn parse_ssl_url(url: &str) -> Result<(&str, u16), BtcError> {
    let rest = url.strip_prefix("ssl://")
        .ok_or_else(|| BtcError::ElectrumConnection(format!("expected ssl:// url: {url}")))?;
    let (host, port_str) = rest.rsplit_once(':')
        .ok_or_else(|| BtcError::ElectrumConnection(format!("missing port in url: {url}")))?;
    let port = port_str.parse::<u16>()
        .map_err(|_| BtcError::ElectrumConnection(format!("invalid port: {port_str}")))?;
    Ok((host, port))
}

/// Try the Electrum server list in order, moving to the next on a connection/query failure (auto fallback).
///
/// - `require_secure` is checked first per URL: if a non-`ssl://` URL is mixed into a pinned
///   network (downgrade attack), fail hard immediately - do not move to the next server.
/// - If `op` succeeds, return its result. If a server fails (connection/query error), move to the next.
/// - If all servers fail, return the last error.
///
/// ⚠ The certificate pinning / signature-verification / raw-key logic (`make_ssl_client`,
/// `pinned_tls_config`) is NOT touched here. This helper is only the outer loop that "picks a
/// server and retries on failure"; the actual connection/verification runs the existing path inside `op`.
pub(crate) fn try_each_url<T>(
    electrum_urls: &[String],
    use_pinning: bool,
    mut op: impl FnMut(&str) -> Result<T, BtcError>,
) -> Result<T, BtcError> {
    if electrum_urls.is_empty() {
        return Err(BtcError::ElectrumConnection("no electrum URLs provided".into()));
    }
    let mut last_err: Option<BtcError> = None;
    for url in electrum_urls {
        require_secure(url, use_pinning)?; // downgrade block = hard fail (do not skip)
        match op(url) {
            Ok(v) => return Ok(v),
            Err(e) => last_err = Some(e), // this server failed -> try the next
        }
    }
    Err(last_err
        .unwrap_or_else(|| BtcError::ElectrumConnection("all electrum servers failed".into())))
}

/// Compute display balance info from the wallet graph (no network call).
fn wallet_balance_info(wallet: &Wallet) -> BalanceInfo {
    let mut pending_outgoing_sat = 0;
    for tx in wallet.transactions() {
        if !tx.chain_position.is_confirmed() {
            let (sent, received) = wallet.sent_and_received(&tx.tx_node.tx);
            if sent.to_sat() > received.to_sat() {
                pending_outgoing_sat += sent.to_sat() - received.to_sat();
            }
        }
    }
    let balance = wallet.balance();
    BalanceInfo {
        confirmed_sat: balance.confirmed.to_sat(),
        unconfirmed_sat: (balance.trusted_pending + balance.untrusted_pending).to_sat(),
        trusted_pending_sat: balance.trusted_pending.to_sat(),
        pending_outgoing_sat,
    }
}

/// Unused receive-address headroom (lookahead gap) that incremental sync watches.
/// Matched to full_scan's stop_gap (20) so incremental sync alone can find new deposits
/// up to 20 addresses past the last-used address.
const RECEIVE_LOOKAHEAD_GAP: u32 = 20;

/// Before incremental sync, top up so at least GAP unused receive addresses stay pre-revealed.
///
/// Incremental sync (`start_sync_with_revealed_spks`) queries only already-revealed addresses,
/// so without headroom a deposit to a not-yet-revealed new receive address would never be seen.
/// Pre-revealing up to GAP unused addresses here catches deposits in that range without a full_scan.
/// When the headroom is consumed by deposits (used), it is automatically refilled on the next sync.
fn ensure_receive_lookahead(wallet: &mut Wallet) {
    // Reveal up to GAP addresses past the "last used" receive-address index.
    // Judging by total unused count is wrong: when unused gaps are scattered below the used index,
    // count is inflated and under-provisions the trailing headroom. Base it on last_used_index instead.
    let last_used = wallet
        .spk_index()
        .last_used_index(KeychainKind::External);
    let target = match last_used {
        Some(i) => i.saturating_add(RECEIVE_LOOKAHEAD_GAP),
        None => RECEIVE_LOOKAHEAD_GAP - 1, // no usage history yet -> reveal 0..=GAP-1
    };
    // reveal_addresses_to does nothing if already revealed to target (idempotent).
    let _ = wallet
        .reveal_addresses_to(KeychainKind::External, target)
        .count();
}

/// Scan until this many consecutive unused addresses are seen.
const STOP_GAP: usize = 20;
/// Scripts queried per round trip. Larger batches mean fewer round trips.
/// 100 matches standard wallets (e.g. BlueWallet history batch) — important on
/// high-latency servers where round-trip count dominates scan time.
const BATCH_SIZE: usize = 100;

// ── Three-phase scanning ──────────────────────────────────────────────────
//
// A scan is (1) build a request from the wallet, (2) talk to the server, (3) apply the
// result to the wallet. Only 1 and 3 touch the wallet, and both are local and fast; 2 is
// where the minutes go. Keeping these separate lets the caller hold the wallet lock for
// 1 and 3 only, so reads (address list, balance) are not blocked while a scan is running.
//
// The request is consumed by the network call, so a retry against the next server needs a
// fresh one — hence `make_request` is a closure rather than a value.

/// Phase 1 (full scan): snapshot what to ask for. Wallet lock needed.
pub fn build_full_scan_request(wallet: &mut Wallet) -> FullScanRequest<KeychainKind> {
    wallet.start_full_scan().build()
}

/// Phase 1 (sync): reveal lookahead headroom, then snapshot what to ask for. Wallet lock needed.
///
/// Incremental sync queries only already-revealed addresses, so the headroom must be
/// revealed before the request is built or a deposit to a new address would be missed.
pub fn build_sync_request(wallet: &mut Wallet) -> SyncRequest<(KeychainKind, u32)> {
    ensure_receive_lookahead(wallet);
    wallet.start_sync_with_revealed_spks().build()
}

/// Phase 2 (full scan): the network. Deliberately takes no wallet — nothing here needs it.
pub async fn run_full_scan<F>(
    mut make_request: F,
    electrum_urls: &[String],
    use_pinning: bool,
) -> Result<FullScanResponse<KeychainKind>, BtcError>
where
    F: FnMut() -> FullScanRequest<KeychainKind>,
{
    try_each_url(electrum_urls, use_pinning, |url| {
        let request = make_request();
        if url.starts_with("ssl://") {
            let (host, port) = parse_ssl_url(url)?;
            crate::batch_scan::full_scan(&make_ssl_client(host, port, use_pinning)?, request, STOP_GAP, BATCH_SIZE)
        } else {
            crate::batch_scan::full_scan(&plain_client(url)?, request, STOP_GAP, BATCH_SIZE)
        }
    })
}

/// Phase 2 (sync): the network. Takes no wallet.
pub async fn run_sync<F>(
    mut make_request: F,
    electrum_urls: &[String],
    use_pinning: bool,
) -> Result<SyncResponse, BtcError>
where
    F: FnMut() -> SyncRequest<(KeychainKind, u32)>,
{
    try_each_url(electrum_urls, use_pinning, |url| {
        let request = make_request();
        if url.starts_with("ssl://") {
            let (host, port) = parse_ssl_url(url)?;
            crate::batch_scan::sync(&make_ssl_client(host, port, use_pinning)?, request, BATCH_SIZE)
        } else {
            crate::batch_scan::sync(&plain_client(url)?, request, BATCH_SIZE)
        }
    })
}

/// Phase 3: fold the server's answer into the wallet. Wallet lock needed.
pub fn apply_scan_update(
    wallet: &mut Wallet,
    update: impl Into<Update>,
) -> Result<BalanceInfo, BtcError> {
    wallet
        .apply_update(update.into())
        .map_err(|e| BtcError::ScanFailed(e.to_string()))?;
    Ok(wallet_balance_info(wallet))
}

/// Plaintext (non-TLS) client. Only reachable for networks that don't require pinning.
fn plain_client(url: &str) -> Result<electrum_client::Client, BtcError> {
    let config = electrum_client::ConfigBuilder::new().timeout(Some(15)).build();
    let client = electrum_client::Client::from_config(url, config)
        .map_err(|e| BtcError::ElectrumConnection(e.to_string()))?;
    electrum_handshake(&client)?;
    Ok(client)
}

/// Single-address balance (view-only).
/// Without creating a BDK wallet (descriptor), convert address -> scriptPubKey and
/// call Electrum's scripthash balance query (`script_get_balance`) directly.
pub async fn scan_address_balance(
    address: &str,
    electrum_urls: &[String],
    use_pinning: bool,
) -> Result<BalanceInfo, BtcError> {
    // Address string -> scriptPubKey (skip network check - BMB/LTM share BTC's format)
    let addr = address
        .trim()
        .parse::<bitcoin::Address<bitcoin::address::NetworkUnchecked>>()
        .map_err(|e| BtcError::InvalidAddress(format!("{address}: {e}")))?
        .assume_checked();
    let script = addr.script_pubkey();

    let bal = try_each_url(electrum_urls, use_pinning, |url| {
        if url.starts_with("ssl://") {
            let (host, port) = parse_ssl_url(url)?;
            let client = make_ssl_client(host, port, use_pinning)?;
            client
                .script_get_balance(script.as_script())
                .map_err(|e| BtcError::ScanFailed(e.to_string()))
        } else {
            let config = electrum_client::ConfigBuilder::new().timeout(Some(15)).build();
            let client = electrum_client::Client::from_config(url, config)
                .map_err(|e| BtcError::ElectrumConnection(e.to_string()))?;
            electrum_handshake(&client)?;
            client
                .script_get_balance(script.as_script())
                .map_err(|e| BtcError::ScanFailed(e.to_string()))
        }
    })?;

    let pending_outgoing_sat = if bal.unconfirmed < 0 {
        (-bal.unconfirmed) as u64
    } else {
        0
    };
    let confirmed_sat = if bal.unconfirmed < 0 {
        (bal.confirmed as i64 + bal.unconfirmed).max(0) as u64
    } else {
        bal.confirmed
    };
    
    Ok(BalanceInfo {
        confirmed_sat,
        unconfirmed_sat: bal.unconfirmed.max(0) as u64,
        // A single address (view-only) can't distinguish change, so 0
        trusted_pending_sat: 0,
        pending_outgoing_sat,
    })
}

/// Single-address tx history (view-only).
/// Get the txid list via Electrum script_get_history, fetch each tx (and each input's previous tx),
/// and compute sent/received amounts relative to this address.
pub async fn scan_address_history(
    address: &str,
    electrum_urls: &[String],
    use_pinning: bool,
) -> Result<Vec<crate::wallet::TxInfo>, BtcError> {
    use std::collections::HashMap;

    // Cap on recent txs to compute in detail (fast even for busy addresses)
    const MAX_TXS: usize = 50;

    fn collect<E: ElectrumApi>(
        client: &E,
        script: &bitcoin::Script,
    ) -> Result<Vec<crate::wallet::TxInfo>, BtcError> {
        use std::collections::HashSet;
        use bitcoin::Txid;

        let mut history = client
            .script_get_history(script)
            .map_err(|e| BtcError::ScanFailed(e.to_string()))?;

        // Sort newest-first: mempool (height<=0) at the front, confirmed by descending height
        let rank = |h: i32| if h > 0 { h as i64 } else { i64::MAX };
        history.sort_by(|a, b| rank(b.height).cmp(&rank(a.height)));
        history.truncate(MAX_TXS);

        if history.is_empty() {
            return Ok(Vec::new());
        }

        // 1) Fetch the target txs in a single batch (per-item round trips -> 1)
        let main_txids: Vec<Txid> = history.iter().map(|h| h.tx_hash).collect();
        let main_txs = client
            .batch_transaction_get(&main_txids)
            .map_err(|e| BtcError::ScanFailed(e.to_string()))?;
        // The batch response preserves request order, so build a txid -> tx map to match safely
        let tx_map: HashMap<Txid, bitcoin::Transaction> =
            main_txids.iter().cloned().zip(main_txs).collect();

        // 2) Gather the inputs' previous txids and fetch them in one batch (to compute sent amount)
        let mut prev_ids: Vec<Txid> = Vec::new();
        let mut seen: HashSet<Txid> = HashSet::new();
        for tx in tx_map.values() {
            for input in &tx.input {
                let pid = input.previous_output.txid;
                if seen.insert(pid) {
                    prev_ids.push(pid);
                }
            }
        }
        let mut prev_map: HashMap<Txid, bitcoin::Transaction> = HashMap::new();
        if !prev_ids.is_empty() {
            let prev_txs = client
                .batch_transaction_get(&prev_ids)
                .map_err(|e| BtcError::ScanFailed(e.to_string()))?;
            for (pid, t) in prev_ids.iter().cloned().zip(prev_txs) {
                prev_map.insert(pid, t);
            }
        }

        // 3) Fetch confirmed block-header times in one batch (per-height round trips -> 1)
        let mut heights: Vec<u32> = Vec::new();
        let mut hseen: HashSet<u32> = HashSet::new();
        for h in &history {
            if h.height > 0 && hseen.insert(h.height as u32) {
                heights.push(h.height as u32);
            }
        }
        let mut time_map: HashMap<u32, u64> = HashMap::new();
        if !heights.is_empty() {
            if let Ok(headers) = client.batch_block_header(&heights) {
                for (hgt, hdr) in heights.iter().zip(headers.iter()) {
                    time_map.insert(*hgt, hdr.time as u64);
                }
            }
        }

        // 4) Compute sent/received/confirmation-time per tx (no extra network calls)
        let mut out = Vec::with_capacity(history.len());
        for h in &history {
            let tx = match tx_map.get(&h.tx_hash) {
                Some(t) => t,
                None => continue,
            };

            // received: sum of outputs paying this address
            let received: u64 = tx
                .output
                .iter()
                .filter(|o| o.script_pubkey == *script)
                .map(|o| o.value.to_sat())
                .sum();

            // sent: sum of inputs that spent this address's UTXOs (checked against the batched previous txs)
            let mut sent: u64 = 0;
            for input in &tx.input {
                let vout = input.previous_output.vout as usize;
                if let Some(prev) = prev_map.get(&input.previous_output.txid) {
                    if let Some(o) = prev.output.get(vout) {
                        if o.script_pubkey == *script {
                            sent += o.value.to_sat();
                        }
                    }
                }
            }

            let (block_height, confirmed_at) = if h.height > 0 {
                let height = h.height as u32;
                (Some(height), time_map.get(&height).copied())
            } else {
                (None, None)
            };

            out.push(crate::wallet::TxInfo {
                txid: h.tx_hash.to_string(),
                confirmed_at,
                block_height,
                sent_sat: sent,
                received_sat: received,
            });
        }

        Ok(out)
    }

    let addr = address
        .trim()
        .parse::<bitcoin::Address<bitcoin::address::NetworkUnchecked>>()
        .map_err(|e| BtcError::InvalidAddress(format!("{address}: {e}")))?
        .assume_checked();
    let script = addr.script_pubkey();

    try_each_url(electrum_urls, use_pinning, |url| {
        if url.starts_with("ssl://") {
            let (host, port) = parse_ssl_url(url)?;
            let client = make_ssl_client(host, port, use_pinning)?;
            collect(&client, script.as_script())
        } else {
            let config = electrum_client::ConfigBuilder::new().timeout(Some(15)).build();
            let client = electrum_client::Client::from_config(url, config)
                .map_err(|e| BtcError::ElectrumConnection(e.to_string()))?;
            electrum_handshake(&client)?;
            collect(&client, script.as_script())
        }
    })
}

/// Estimate fast/normal/slow fee rates (sat/vB) via Electrum estimatefee.
/// If the server returns no estimate (unsupported/low activity), fall back to defaults.
pub async fn estimate_fees(
    electrum_urls: &[String],
    use_pinning: bool,
) -> Result<FeeEstimates, BtcError> {
    fn collect<E: ElectrumApi>(client: &E) -> FeeEstimates {
        // BTC/kB -> sat/vB (x100_000); default if estimate fails or <= 0
        let get = |blocks: usize, fallback: f64| -> f64 {
            client
                .estimate_fee(blocks)
                .ok()
                .map(|v| if v > 0.0 { (v * 100_000.0).max(1.0) } else { fallback })
                .unwrap_or(fallback)
        };
        FeeEstimates {
            fast_sat_vb: get(2, 4.0),
            normal_sat_vb: get(6, 2.0),
            slow_sat_vb: get(24, 1.0),
        }
    }

    try_each_url(electrum_urls, use_pinning, |url| {
        if url.starts_with("ssl://") {
            let (host, port) = parse_ssl_url(url)?;
            let client = make_ssl_client(host, port, use_pinning)?;
            Ok(collect(&client))
        } else {
            let config = electrum_client::ConfigBuilder::new().timeout(Some(15)).build();
            let client = electrum_client::Client::from_config(url, config)
                .map_err(|e| BtcError::ElectrumConnection(e.to_string()))?;
            electrum_handshake(&client)?;
            Ok(collect(&client))
        }
    })
}

#[cfg(test)]
mod fallback_tests {
    //! Verifies the control flow of `try_each_url` (Electrum server auto fallback).
    //! Pure logic only, no network.
    use super::*;

    #[test]
    fn returns_first_success_without_trying_rest() {
        let urls = vec!["ssl://a:1".to_string(), "ssl://b:2".to_string()];
        let mut attempts: Vec<String> = vec![];
        let r = try_each_url(&urls, false, |u| {
            attempts.push(u.to_string());
            Ok::<_, BtcError>(42)
        });
        assert_eq!(r.unwrap(), 42);
        assert_eq!(attempts, vec!["ssl://a:1"]); // stops at the first success
    }

    #[test]
    fn falls_through_to_next_on_failure() {
        let urls = vec!["ssl://dead:1".to_string(), "ssl://live:2".to_string()];
        let mut attempts: Vec<String> = vec![];
        let r = try_each_url(&urls, false, |u| {
            attempts.push(u.to_string());
            if u.contains("dead") {
                Err(BtcError::ElectrumConnection("down".into()))
            } else {
                Ok(7)
            }
        });
        assert_eq!(r.unwrap(), 7);
        assert_eq!(attempts, vec!["ssl://dead:1", "ssl://live:2"]); // dead server -> switch to next
    }

    #[test]
    fn all_fail_returns_error() {
        let urls = vec!["ssl://x:1".to_string(), "ssl://y:2".to_string()];
        let r: Result<i32, _> =
            try_each_url(&urls, false, |_| Err(BtcError::ScanFailed("boom".into())));
        assert!(r.is_err());
    }

    #[test]
    fn empty_list_errors() {
        let urls: Vec<String> = vec![];
        let r: Result<i32, _> = try_each_url(&urls, false, |_| Ok(1));
        assert!(r.is_err());
    }

    #[test]
    fn pinned_rejects_non_ssl_hard_without_calling_op() {
        // A non-ssl URL mixed into a pinned network is treated as a downgrade -> hard fail, op not called
        let urls = vec!["tcp://insecure:1".to_string(), "ssl://real:2".to_string()];
        let mut called = 0;
        let r: Result<i32, _> = try_each_url(&urls, true, |_| {
            called += 1;
            Ok(1)
        });
        assert!(r.is_err());
        assert_eq!(called, 0);
    }
}
