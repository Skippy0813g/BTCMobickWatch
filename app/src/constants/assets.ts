import type { NetworkKey } from './networks';

export interface AssetConfig {
  id: NetworkKey;
  name: string;
  ticker: string;
  network: string;
  icon: string;
}

// Path note: this file lives in app/src/constants/, so imgs/ is reached via ../../imgs/
export const ASSET_LOGOS: Record<string, any> = {
  BTC: require('../../imgs/Logo_BTC.png'),
  BMB: require('../../imgs/Logo_BMB.png'),
  LTM: require('../../imgs/Logo_LTM.png'),
  ETH: require('../../imgs/Logo_ETH.png'),
  USDT: require('../../imgs/Logo_Tether.png'),
  WBMB: require('../../imgs/Logo_WBMB.png'),
  MOVL: require('../../imgs/Logo_MOVL.png'),
  BNB: require('../../imgs/Logo_BNB.png'),
  default: require('../../imgs/Logo_default.png'),
};

export const CHAIN_LOGOS: Record<string, any> = {
  BSC: require('../../imgs/Logo_BSC.png'),
  BASE: require('../../imgs/Logo_BASE.png'),
};

export const getChainBadge = (network: string) => {
  const lower = (network || '').toLowerCase();
  if (lower.includes('smart chain') || lower.includes('bsc') || lower.includes('binance') || lower.includes('bnb')) {
    return CHAIN_LOGOS.BSC;
  }
  if (lower.includes('base')) {
    return CHAIN_LOGOS.BASE;
  }
  return null;
};

export const getWalletAssets = (zpub: string): AssetConfig[] => {
  const isEvm = (zpub || '').toLowerCase().trim().startsWith('0x');
  if (isEvm) {
    return [
      { id: 'BNB', name: 'BNB', ticker: 'BNB', network: 'BNB Smart Chain', icon: '' },
      { id: 'WBMB', name: 'WBMB', ticker: 'WBMB', network: 'BNB Smart Chain', icon: '' },
      { id: 'MOVN', name: 'MOVN', ticker: 'MOVN', network: 'BNB Smart Chain', icon: '' },
      { id: 'USDT', name: 'USDT', ticker: 'USDT', network: 'BNB Smart Chain', icon: '' },
      { id: 'ETH', name: 'Ethereum', ticker: 'ETH', network: 'Ethereum', icon: '' },
      { id: 'USDT_ETH', name: 'USDT', ticker: 'USDT', network: 'Ethereum', icon: '' },
      { id: 'ETH_BASE', name: 'Ethereum', ticker: 'ETH', network: 'Base', icon: '' },
      { id: 'WBMB_BASE', name: 'WBMB', ticker: 'WBMB', network: 'Base', icon: '' },
      { id: 'MOVL_BASE', name: 'MOVL', ticker: 'MOVL', network: 'Base', icon: '' },
    ];
  } else {
    return [
      { id: 'Bitcoin', name: 'Bitcoin', ticker: 'BTC', network: 'BTC Mainnet', icon: '' },
      { id: 'Mobick', name: 'BTCMobick', ticker: 'BMB', network: 'BMB Mainnet', icon: '' },
      { id: 'LaptopMining', name: 'LaptopMining', ticker: 'LTM', network: 'LTM Mainnet', icon: '' },
    ];
  }
};
