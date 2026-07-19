//! Live check against the real Mobick/LTM electrum servers.
//!
//! Ignored by default (needs network). Run with:
//!   cargo test -p core-btc --test electrum_live -- --ignored --nocapture

use core_btc::scanner::{make_ssl_client, parse_ssl_url};
use bdk_electrum::electrum_client::ElectrumApi;

/// The app installs this in the ffi crate's init; tests must do the same.
fn init_crypto() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

fn probe(url: &str, label: &str) {
    init_crypto();
    let (host, port) = parse_ssl_url(url).expect("url parse");
    let client = make_ssl_client(host, port, true).unwrap_or_else(|e| {
        panic!("{label}: connect/handshake failed: {e}");
    });
    let header = client
        .block_headers_subscribe_raw()
        .unwrap_or_else(|e| panic!("{label}: headers.subscribe failed after handshake: {e}"));
    println!("{label}: OK — height {}", header.height);
}

#[test]
#[ignore]
fn bmb_servers_reachable_with_pinning() {
    for url in [
        "ssl://wallet04.mobick.info:40009",
        "ssl://wallet01.mobick.info:40009",
        "ssl://wallet02.mobick.info:40009",
    ] {
        probe(url, url);
    }
}

#[test]
#[ignore]
fn ltm_server_reachable_with_pinning() {
    probe("ssl://ltm-wallet.gnc.ne.kr:50009", "LTM");
}
