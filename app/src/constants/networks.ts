// Per-chain public RPCs (tried in order, fall back on failure/timeout). All keyless.
const RPC_BSC = [
  'https://bsc-rpc.publicnode.com',
  'https://bsc-dataseed.binance.org',
  'https://bsc-dataseed1.defibit.io',
  'https://rpc.ankr.com/bsc',
  'https://binance.llamarpc.com',
];
const RPC_BASE = [
  'https://base-rpc.publicnode.com',
  'https://mainnet.base.org',
  'https://base.llamarpc.com',
  'https://base.drpc.org',
  'https://1rpc.io/base',
];
const RPC_ETH = [
  'https://ethereum-rpc.publicnode.com',
  'https://cloudflare-eth.com',
  'https://rpc.ankr.com/eth',
  'https://eth.llamarpc.com',
];

export const NETWORKS = {
  Bitcoin: {
    label: 'Bitcoin',
    ticker: 'BTC',
    color: '#F7931A',
    network: 'Bitcoin' as const,
    electrum: ['ssl://electrum.blockstream.info:50002'],
    isEvm: false,
    isToken: false,
    contract: undefined,
    rpc: [] as string[],
    decimals: 8,
  },
  Mobick: {
    label: 'BTCMobick',
    ticker: 'BMB',
    color: '#4CAF50',
    network: 'Mobick' as const,
    electrum: [
      'ssl://wallet04.mobick.info:40009',
      'ssl://wallet01.mobick.info:40009',
      'ssl://wallet02.mobick.info:40009',
    ],
    isEvm: false,
    isToken: false,
    contract: undefined,
    rpc: [] as string[],
    decimals: 8,
  },
  LaptopMining: {
    label: 'LaptopMining',
    ticker: 'LTM',
    color: '#2196F3',
    network: 'LaptopMining' as const,
    electrum: ['ssl://ltm-wallet.gnc.ne.kr:50009'],
    isEvm: false,
    isToken: false,
    contract: undefined,
    rpc: [] as string[],
    decimals: 8,
  },
  // BNB Smart Chain (BSC)
  BNB: {
    label: 'BNB',
    ticker: 'BNB',
    color: '#F3BA2F',
    network: 'BNB Smart Chain' as const,
    electrum: [],
    isEvm: true,
    isToken: false,
    contract: undefined,
    rpc: RPC_BSC,
    decimals: 18,
  },
  WBMB: {
    label: 'WBMB',
    ticker: 'WBMB',
    color: '#9C27B0',
    network: 'BNB Smart Chain' as const,
    electrum: [],
    isEvm: true,
    isToken: true,
    contract: '0x9E4c611B834672c3643D9818249366bf65ae4C86',
    rpc: RPC_BSC,
    decimals: 8, // WBMB is 8 decimals (per Choonsim scanner config)
  },
  MOVN: {
    label: 'MOVN',
    ticker: 'MOVN',
    color: '#00BCD4',
    network: 'BNB Smart Chain' as const,
    electrum: [],
    isEvm: true,
    isToken: true,
    contract: '0x200b63AA750c901892d4DCf82439860F9C270274',
    rpc: RPC_BSC,
    decimals: 18,
  },
  USDT: {
    label: 'USDT',
    ticker: 'USDT',
    color: '#009688',
    network: 'BNB Smart Chain' as const,
    electrum: [],
    isEvm: true,
    isToken: true,
    contract: '0x55d398326f99059fF775485246999027B3197955',
    rpc: RPC_BSC,
    decimals: 18,
  },
  // Ethereum (ERC)
  ETH: {
    label: 'Ethereum',
    ticker: 'ETH',
    color: '#627EEA',
    network: 'Ethereum' as const,
    electrum: [],
    isEvm: true,
    isToken: false,
    contract: undefined,
    rpc: RPC_ETH,
    decimals: 18,
  },
  USDT_ETH: {
    label: 'USDT',
    ticker: 'USDT',
    color: '#009688',
    network: 'Ethereum' as const,
    electrum: [],
    isEvm: true,
    isToken: true,
    contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    rpc: RPC_ETH,
    decimals: 6,
  },
  // Base
  ETH_BASE: {
    label: 'Ethereum',
    ticker: 'ETH',
    color: '#627EEA',
    network: 'Base' as const,
    electrum: [],
    isEvm: true,
    isToken: false,
    contract: undefined,
    rpc: RPC_BASE,
    decimals: 18,
  },
  WBMB_BASE: {
    label: 'WBMB',
    ticker: 'WBMB',
    color: '#9C27B0',
    network: 'Base' as const,
    electrum: [],
    isEvm: true,
    isToken: true,
    contract: '0x71E7CBD674762F95D4D685138749feC3665c8225',
    rpc: RPC_BASE,
    decimals: 8, // WBMB is 8 decimals (per Choonsim scanner config)
  },
  MOVL_BASE: {
    label: 'MOVL',
    ticker: 'MOVL',
    color: '#7E57C2',
    network: 'Base' as const,
    electrum: [],
    isEvm: true,
    isToken: true,
    contract: '0x6c3b923561B9e3b19D06cB02537Cc0FD5F1af6d4',
    rpc: RPC_BASE,
    decimals: 18,
  },
} as const;

export type NetworkKey = keyof typeof NETWORKS;

// Explorers (mempool instances): /api/blocks/tip/height (tip) + /tx/{txid} (lookup)
export const EXPLORER: Partial<Record<NetworkKey, { mempoolBase: string }>> = {
  Bitcoin: { mempoolBase: 'https://mempool.space' },
  Mobick: { mempoolBase: 'https://blockchain.mobick.info' },
  LaptopMining: { mempoolBase: 'https://ltm-mempool.gnc.ne.kr' },
};

export const explorerTxUrl = (netKey: NetworkKey, txid: string): string | null =>
  EXPLORER[netKey] ? `${EXPLORER[netKey]!.mempoolBase}/tx/${txid}` : null;

// EVM chain explorers (web) — address-based tx history. Keyless, plain links.
const EVM_EXPLORER: Record<string, string> = {
  'BNB Smart Chain': 'https://bscscan.com',
  'Ethereum': 'https://etherscan.io',
  'Base': 'https://basescan.org',
};

// Address tx-history page URL. Token -> token-filtered view, native -> address page.
export const evmExplorerAddressUrl = (netKey: NetworkKey, address: string): string | null => {
  const n = NETWORKS[netKey];
  if (!n.isEvm) return null;
  const base = EVM_EXPLORER[n.network];
  if (!base) return null;
  return n.contract
    ? `${base}/token/${n.contract}?a=${address}`
    : `${base}/address/${address}`;
};

// Fetch current chain tip height (for confirmation count). null on failure.
export async function fetchTipHeight(netKey: NetworkKey): Promise<number | null> {
  const e = EXPLORER[netKey];
  if (!e) return null;
  try {
    const res = await fetch(`${e.mempoolBase}/api/blocks/tip/height`);
    const t = parseInt((await res.text()).trim(), 10);
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

export const DEFAULT_PRICES = {
  BTC_USD: 0, BTC_KRW: 0,
  BMB_USD: 0, BMB_KRW: 0,
  LTM_USD: 0, LTM_KRW: 0,
  BNB_USD: 0, BNB_KRW: 0,
  WBMB_USD: 0, WBMB_KRW: 0,
  MOVN_USD: 0, MOVN_KRW: 0,
  MOVL_USD: 0, MOVL_KRW: 0,
  USDT_USD: 0, USDT_KRW: 0,
  ETH_USD: 0, ETH_KRW: 0,
};
