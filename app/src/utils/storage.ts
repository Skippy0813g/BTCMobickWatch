import * as Keychain from 'react-native-keychain';
import { WALLETS_SERVICE, VISIBILITY_SERVICE, ORDER_SERVICE, SETTINGS_SERVICE, DEFAULT_ORDER, DEFAULT_VISIBILITY } from '../constants/services';
import type { NetworkKey } from '../constants/networks';
import type { TxInfo } from '../native/WalletCore';
import { type AppSettings, DEFAULT_SETTINGS, type WalletEntry } from '../types';

export async function saveVisibilitySettings(allVisibility: Record<string, Record<NetworkKey, boolean>>): Promise<void> {
  try {
    await Keychain.setGenericPassword('visibility', JSON.stringify(allVisibility), {
      service: VISIBILITY_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch (e) {
    console.log('Error saving visibility settings:', e);
  }
}

export async function loadVisibilitySettings(): Promise<Record<string, Record<NetworkKey, boolean>> | null> {
  try {
    const creds = await Keychain.getGenericPassword({ service: VISIBILITY_SERVICE });
    if (creds) return JSON.parse(creds.password);
  } catch (e) {}
  return null;
}

export async function saveOrderSettings(allOrder: Record<string, { BTC: NetworkKey[]; EVM: NetworkKey[] }>): Promise<void> {
  try {
    await Keychain.setGenericPassword('order', JSON.stringify(allOrder), {
      service: ORDER_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch (e) {
    console.log('Error saving order settings:', e);
  }
}

export async function loadOrderSettings(): Promise<Record<string, { BTC: NetworkKey[]; EVM: NetworkKey[] }> | null> {
  try {
    const creds = await Keychain.getGenericPassword({ service: ORDER_SERVICE });
    if (creds) return JSON.parse(creds.password);
  } catch (e) {}
  return null;
}

// Per-address tx history cache (stale-while-revalidate). Single addresses have no BDK
// graph, so the last result is stored per-address (encrypted, since addresses are
// privacy-sensitive) for instant display while a live fetch refreshes in the background.

export function txCacheService(network: string, address: string): string {
  return `txcache_${network}_${address}`;
}

export async function saveTxHistoryCache(network: string, address: string, txs: TxInfo[]): Promise<void> {
  try {
    await Keychain.setGenericPassword('txcache', JSON.stringify(txs), {
      service: txCacheService(network, address),
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch (e) {
    console.log('Error saving tx cache:', e);
  }
}

export async function loadTxHistoryCache(network: string, address: string): Promise<TxInfo[] | null> {
  try {
    const creds = await Keychain.getGenericPassword({ service: txCacheService(network, address) });
    if (creds) return JSON.parse(creds.password) as TxInfo[];
  } catch (e) {}
  return null;
}

export async function saveAppSettings(settings: Partial<AppSettings>): Promise<void> {
  try {
    const existing = await loadAppSettings() || DEFAULT_SETTINGS;
    const merged = { ...existing, ...settings };
    await Keychain.setGenericPassword('settings', JSON.stringify(merged), {
      service: SETTINGS_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch (e) {
    console.log('Error saving app settings:', e);
  }
}

export async function loadAppSettings(): Promise<AppSettings | null> {
  try {
    const creds = await Keychain.getGenericPassword({ service: SETTINGS_SERVICE });
    if (creds) return { ...DEFAULT_SETTINGS, ...JSON.parse(creds.password) };
  } catch (e) {}
  return null;
}

export async function saveWalletList(wallets: WalletEntry[]): Promise<void> {
  await Keychain.setGenericPassword('wallets', JSON.stringify(wallets), {
    service: WALLETS_SERVICE,
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
