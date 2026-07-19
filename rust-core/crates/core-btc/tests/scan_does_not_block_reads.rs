//! The point of the three-phase split: a running scan must not freeze wallet reads.
//!
//! Ignored by default (hits the real BMB servers, where a deep scan takes a while).
//!   cargo test -p core-btc --test scan_does_not_block_reads -- --ignored --nocapture

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use bdk_wallet::Wallet;
use core_btc::{scanner, wallet as w};

/// BIP32 test-vector-1 master public key. Published in the spec, so no one's privacy is
/// involved and no real funds are watched.
const XPUB: &str = "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";

fn make_wallet() -> Wallet {
    let desc = format!("wpkh({XPUB}/0/*)");
    let change = format!("wpkh({XPUB}/1/*)");
    w::create_watch_wallet(bitcoin::Network::Mobick, desc, Some(change)).expect("wallet")
}

#[test]
#[ignore]
fn reads_stay_responsive_during_full_scan() {
    let _ = rustls::crypto::ring::default_provider().install_default();

    let urls = vec![
        "ssl://wallet04.mobick.info:40009".to_string(),
        "ssl://wallet01.mobick.info:40009".to_string(),
    ];
    let wallet = Arc::new(Mutex::new(make_wallet()));

    // Start a deep scan in the background, exactly as the FFI does.
    let scan_wallet = Arc::clone(&wallet);
    let scan_urls = urls.clone();
    let scan = thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let started = Instant::now();
        let resp = rt.block_on(scanner::run_full_scan(
            || scanner::build_full_scan_request(&mut scan_wallet.lock().unwrap()),
            &scan_urls,
            true,
        ));
        (started.elapsed(), resp.is_ok())
    });

    // Meanwhile hammer a read and record the worst stall.
    thread::sleep(Duration::from_millis(300)); // let the scan reach its network phase
    let mut worst = Duration::ZERO;
    let mut reads = 0u32;
    while !scan.is_finished() {
        let t0 = Instant::now();
        let _ = w::get_addresses_with_balance(&wallet.lock().unwrap(), 0, 20, false);
        worst = worst.max(t0.elapsed());
        reads += 1;
        thread::sleep(Duration::from_millis(20));
    }

    let (scan_time, scan_ok) = scan.join().expect("scan thread");
    println!("스캔 시간       : {scan_time:?} (성공: {scan_ok})");
    println!("스캔 중 읽기    : {reads}회");
    println!("최악의 읽기 지연: {worst:?}");

    assert!(scan_ok, "스캔 자체가 실패");
    assert!(
        scan_time > Duration::from_millis(700),
        "스캔이 너무 빨리 끝나 판정이 무의미함: {scan_time:?}"
    );
    // If the wallet lock were held across the network phase, a read would stall for
    // roughly the whole scan. Unblocked, it is local compute and finishes in ~microseconds.
    assert!(
        worst * 3 < scan_time,
        "읽기가 {worst:?} 막힘 (스캔 {scan_time:?}) - 스캔이 지갑 잠금을 쥐고 있다"
    );
}
