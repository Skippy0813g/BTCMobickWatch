//! BTCMobick and LaptopMining share Bitcoin's key format and address encoding; only
//! consensus parameters and the genesis block differ. So the same descriptor must
//! derive byte-identical addresses on all three networks.
//!
//! If this ever fails, users would see their funds vanish from the app while the coins
//! sit untouched on chain. Cheap to check, catastrophic to miss — which is why it runs
//! by default and needs no network.

use bitcoin::Network;
use core_btc::wallet as w;

/// BIP32 test-vector-1 master public key. Published in the spec, so no one's privacy is
/// involved and no real funds are watched.
const XPUB: &str = "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";

fn first_addresses(network: Network, count: u32) -> Vec<String> {
    let desc = format!("wpkh({XPUB}/0/*)");
    let change = format!("wpkh({XPUB}/1/*)");
    let wallet =
        w::create_watch_wallet(network, desc, Some(change)).expect("descriptor must be accepted");

    (0..count)
        .map(|i| wallet.peek_address(bdk_wallet::KeychainKind::External, i).address.to_string())
        .collect()
}

#[test]
fn mobick_and_laptopmining_derive_the_same_addresses_as_bitcoin() {
    let bitcoin = first_addresses(Network::Bitcoin, 20);

    assert!(bitcoin[0].starts_with("bc1"), "unexpected address format: {}", bitcoin[0]);
    assert_eq!(bitcoin.len(), 20);

    assert_eq!(first_addresses(Network::Mobick, 20), bitcoin, "Mobick diverged from Bitcoin");
    assert_eq!(
        first_addresses(Network::LaptopMining, 20),
        bitcoin,
        "LaptopMining diverged from Bitcoin"
    );
}

/// The reason bdk_wallet is forked: descriptor validation rejects these networks upstream.
#[test]
fn watch_wallets_can_be_created_on_all_supported_networks() {
    for network in [Network::Bitcoin, Network::Mobick, Network::LaptopMining] {
        let desc = format!("wpkh({XPUB}/0/*)");
        assert!(
            w::create_watch_wallet(network, desc, None).is_ok(),
            "{network:?} rejected"
        );
    }
}
