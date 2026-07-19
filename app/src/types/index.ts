import type { NetworkKey } from '../constants/networks';
import type { TxInfo } from '../native/WalletCore';

export interface AppSettings {
  advancedMode: boolean;
  hasCompletedOnboarding?: boolean;
  language?: 'en' | 'ko' | 'zh' | 'ja';
}

export const DEFAULT_SETTINGS: AppSettings = {
  advancedMode: false,
};

export interface WalletEntry {
  id: string;
  label: string;
  zpub: string;
}

export type Screen = 'loading' | 'onboarding' | 'blocked' | 'no_security' | 'lock' | 'home' | 'add_wallet' | 'tx_history' | 'tx_detail' | 'addresses' | 'create_psbt' | 'broadcast_tx' | 'settings' | 'settings_advanced' | 'settings_about' | 'settings_licenses' | 'receive' | 'language_selection' | 'settings_language';

export interface BalanceState {
  loading: boolean;
  confirmedSat: number | null;
  unconfirmedSat: number | null;
  trustedPendingSat: number | null;
  pendingOutgoingSat: number | null;
  walletId: string | null;
  error: string | null;
}
