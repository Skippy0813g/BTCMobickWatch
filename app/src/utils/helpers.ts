import { Alert, ToastAndroid } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { tStatic } from '../context/LanguageContext';
import { NETWORKS, type NetworkKey } from '../constants/networks';
import { THEME } from '../constants/theme';
import type { TxInfo } from '../native/WalletCore';
import type { BalanceState } from '../types';

export const isEvmKey = (key: string): boolean =>
  (key || '').trim().toLowerCase().startsWith('0x');

export const isXpubKey = (key: string): boolean => {
  const lower = (key || '').trim().toLowerCase();
  return (
    lower.startsWith('xpub') ||
    lower.startsWith('zpub') ||
    lower.startsWith('tpub') ||
    lower.startsWith('ypub') ||
    lower.startsWith('vpub') ||
    lower.startsWith('upub')
  );
};

/** Strip URI scheme/params from a scanned string -> bare key/address */

export const normalizeScannedKey = (raw: string): string => {
  let s = (raw || '').trim();
  // Extract the body from bitcoin:bc1...?amount= / ethereum:0x...@chain forms
  const m = s.match(/^(?:bitcoin|ethereum|bmb|ltm):([^?@]+)/i);
  if (m) s = m[1];
  return s.trim();
};

/** Card color theme by wallet type (EVM=blue, Xpub/HD=teal, single address=plum) */

export const getWalletCardTheme = (key: string): { bg: string; glow1: string; glow2: string } => {
  if (isEvmKey(key)) {
    return { bg: '#1A295C', glow1: 'rgba(0, 122, 255, 0.15)', glow2: 'rgba(0, 240, 255, 0.12)' };
  }
  if (isXpubKey(key)) {
    return { bg: '#14424A', glow1: 'rgba(0, 200, 210, 0.18)', glow2: 'rgba(0, 180, 200, 0.10)' };
  }
  // Single address - plum
  return { bg: '#3E1A45', glow1: 'rgba(220, 90, 220, 0.20)', glow2: 'rgba(180, 80, 255, 0.12)' };
};

export const getWalletBadgeText = (key: string): string => {
  const lower = (key || '').trim().toLowerCase();
  if (lower.startsWith('0x')) {
    return 'EVM Address';
  }
  if (
    lower.startsWith('xpub') ||
    lower.startsWith('zpub') ||
    lower.startsWith('tpub') ||
    lower.startsWith('ypub') ||
    lower.startsWith('vpub') ||
    lower.startsWith('upub')
  ) {
    return 'BTC HD (Watch-only)';
  }
  return 'BTC Single Address';
};

export const sortTxs = (txs: TxInfo[]): TxInfo[] =>
  [...txs].sort((a, b) => {
    const aPending = a.blockHeight == null;
    const bPending = b.blockHeight == null;
    if (aPending !== bPending) return aPending ? -1 : 1;
    return (b.blockHeight ?? 0) - (a.blockHeight ?? 0);
  });

export function parseAddrIndex(input: string): number | null {
  const s = input.trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const last = s.split('/').pop()?.replace("'", '') ?? '';
  if (/^\d+$/.test(last)) return parseInt(last, 10);
  return null;
}

export const fetchEvmBalance = async (address: string, contractAddress: string | undefined, rpcUrls: readonly string[]): Promise<number> => {
  let method = 'eth_getBalance';
  let params: any[] = [address, 'latest'];
  if (contractAddress) {
    method = 'eth_call';
    const cleanAddr = address.toLowerCase().replace('0x', '');
    const data = `0x70a08231000000000000000000000000${cleanAddr}`;
    params = [{ to: contractAddress, data }, 'latest'];
  }

  const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
  let lastErr: any = null;
  // Try RPCs in order, falling back to the next on network/response error
  for (const rpcUrl of rpcUrls) {
    try {
      // Abort RPCs that hang with no response after 8s and move on (for real-device networks)
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      let response: Response;
      try {
        response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: ctrl.signal,
        } as any); // RN fetch type lacks signal -> cast (AbortController works at runtime)
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json: any = await response.json();
      if (json.error) throw new Error(json.error.message);
      const hexVal = json.result;
      if (!hexVal || hexVal === '0x') return 0;
      return Number(BigInt(hexVal));
    } catch (e: any) {
      lastErr = e;
    }
  }
  throw new Error(lastErr?.message ? tStatic('error_rpc_failed', { msg: lastErr.message }) : tStatic('error_rpc_no_response'));
};

export function smallUnit(netKey: NetworkKey): string {
  if (netKey === 'Bitcoin') return 'sat';
  if (NETWORKS[netKey].isEvm) return 'wei';
  return 'bick';
}

// Raw small-unit integer -> coin-unit string. EVM shows up to the token's decimals (max 8),
// trimming trailing zeros to avoid rounding confusion; BTC family stays fixed at 8.

export function coinAmountStr(sat: number, netKey: NetworkKey): string {
  const n = NETWORKS[netKey];
  const v = sat / Math.pow(10, n.decimals);
  if (!n.isEvm) return v.toFixed(8);
  const places = Math.min(n.decimals, 8);
  let s = v.toFixed(places);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

export function formatAmount(sat: number, showCoin: boolean, netKey: NetworkKey): string {
  const isEvm = NETWORKS[netKey].isEvm;
  if (showCoin || isEvm) {
    return `${coinAmountStr(sat, netKey)} ${NETWORKS[netKey].ticker}`;
  }
  return `${sat.toLocaleString()} ${smallUnit(netKey)}`;
}

export function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}



export const emptyBalance = (): BalanceState => ({
  loading: false,
  confirmedSat: null,
  unconfirmedSat: null,
  trustedPendingSat: null,
  pendingOutgoingSat: null,
  walletId: null,
  error: null,
});

/** Displayed balance = confirmed + own change (trusted pending). Standard wallet behavior. */

export const spendableSat = (bal: BalanceState): number =>
  (bal.confirmedSat ?? 0) + (bal.trustedPendingSat ?? 0);

/**
 * Show a raw BDK/core error in an alert with a "copy" button.
 * Alert popups aren't text-selectable, so provide a way to copy the raw error to clipboard.
 */

export function showRawErrorAlert(msg: string, title?: string) {
  const alertTitle = title || tStatic('error');
  Alert.alert(alertTitle, msg, [
    {
      text: tStatic('copy'),
      onPress: () => {
        Clipboard.setString(msg);
        ToastAndroid.show(tStatic('toast_error_copied'), ToastAndroid.SHORT);
      },
    },
    { text: tStatic('ok'), style: 'cancel' },
  ]);
}
