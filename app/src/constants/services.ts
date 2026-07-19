import type { NetworkKey } from './networks';

// Public source repository. Users verify the released APK against it — see BUILD.md ch.5.
export const GITHUB_REPO_URL = 'https://github.com/Skippy0813g/BTCMobickWatch';

// Keychain service keys (encrypted storage entries)
export const WALLETS_SERVICE = 'com.btcmobickwatch.wallets';
export const VISIBILITY_SERVICE = 'com.btcmobickwatch.visibility';
export const ORDER_SERVICE = 'com.btcmobickwatch.order';
export const SETTINGS_SERVICE = 'com.btcmobickwatch.settings';

export const DEFAULT_ORDER = {
  BTC: ['Bitcoin', 'Mobick', 'LaptopMining'] as NetworkKey[],
  EVM: ['BNB', 'WBMB', 'MOVN', 'USDT', 'ETH', 'USDT_ETH', 'ETH_BASE', 'WBMB_BASE', 'MOVL_BASE'] as NetworkKey[],
};

export const DEFAULT_VISIBILITY: Record<NetworkKey, boolean> = {
  Bitcoin: true, Mobick: true, LaptopMining: true,
  BNB: true, WBMB: true, MOVN: true, USDT: true,
  ETH: true, USDT_ETH: true, ETH_BASE: true, WBMB_BASE: true, MOVL_BASE: true,
};

export const ADDR_PAGE_SIZE = 20;
