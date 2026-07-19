import { NativeModules } from 'react-native';

const { WalletCore } = NativeModules;

if (!WalletCore) {
  throw new Error(
    'WalletCore native module not found. ' +
    'Make sure lib_wallet_core.aar is linked and the app is rebuilt.'
  );
}

// Types

export type WalletNetwork = 'Mobick' | 'LaptopMining' | 'Bitcoin';

export interface BalanceInfo {
  confirmedSat: number;
  unconfirmedSat: number;
  /** Change from my own tx (unconfirmed) - added to balance */
  trustedPendingSat: number;
  /** Unconfirmed outgoing amount (my sent amount + fee) */
  pendingOutgoingSat: number;
}

export interface AddressInfo {
  address: string;
  balanceSat: number;
  /** Whether used before (true if any past tx, even at 0 balance) - flags address reuse */
  used: boolean;
}

export interface FeeEstimates {
  fastSatVb: number;
  normalSatVb: number;
  slowSatVb: number;
}

export interface TxInfo {
  txid: string;
  confirmedAt: number | null;
  blockHeight: number | null;
  sentSat: number;
  receivedSat: number;
}

// Init

/** Call once at app start - initializes the Rust tokio runtime */
export async function initRuntime(): Promise<void> {
  return WalletCore.initRuntime();
}

// zpub conversion

/** Convert zpub -> wpkh descriptor (xpub passes through unchanged) */
export async function zpubToDescriptor(zpub: string): Promise<string> {
  return WalletCore.zpubToDescriptor(zpub);
}

export async function zpubToChangeDescriptor(zpub: string): Promise<string> {
  return WalletCore.zpubToChangeDescriptor(zpub);
}

/**
 * Single-address balance (view-only - no BDK wallet created).
 * Converts address -> scriptPubKey, then queries Electrum scripthash balance.
 */
export async function scanAddressBalance(
  network: WalletNetwork,
  address: string,
  electrumUrls: string[],
): Promise<BalanceInfo> {
  return WalletCore.scanAddressBalance(network, address, electrumUrls);
}

/** Electrum fee estimate (fast/normal/slow, sat/vB) */
export async function scanFeeEstimates(
  network: WalletNetwork,
  electrumUrls: string[],
): Promise<FeeEstimates> {
  return WalletCore.scanFeeEstimates(network, electrumUrls);
}

/** Single-address tx history (view-only) */
export async function scanAddressHistory(
  network: WalletNetwork,
  address: string,
  electrumUrls: string[],
): Promise<TxInfo[]> {
  return WalletCore.scanAddressHistory(network, address, electrumUrls);
}

// BTC watch wallet

/**
 * Create a watch-only wallet.
 * @returns walletId (used in subsequent API calls)
 */
export async function createBtcWallet(
  network: WalletNetwork,
  descriptor: string,
  changeDescriptor?: string,
): Promise<string> {
  return WalletCore.createBtcWallet(network, descriptor, changeDescriptor ?? null);
}

/**
 * Restore/create a watch-only wallet - restores from the saved changeset cache if present
 * (reuses the prior tx graph immediately after restart), otherwise creates a new one.
 * The entry point that replaces createBtcWallet.
 * @returns walletId
 */
export async function restoreBtcWallet(
  network: WalletNetwork,
  descriptor: string,
  changeDescriptor?: string,
): Promise<string> {
  return WalletCore.restoreBtcWallet(network, descriptor, changeDescriptor ?? null);
}

/** Persist the current wallet changeset to an encrypted file (call after a successful scan/sync) */
export async function persistChainState(walletId: string): Promise<void> {
  return WalletCore.persistChainState(walletId);
}

/** Electrum full scan -> balance (discovers new addresses, slow) */
export async function fullScan(
  walletId: string,
  electrumUrls: string[],
): Promise<BalanceInfo> {
  return WalletCore.fullScan(walletId, electrumUrls);
}

/** Incremental sync -> balance (rechecks known addresses only, fast) */
export async function syncWallet(
  walletId: string,
  electrumUrls: string[],
): Promise<BalanceInfo> {
  return WalletCore.syncWallet(walletId, electrumUrls);
}

/** List receive addresses */
export async function getAddresses(
  walletId: string,
  start: number,
  count: number,
): Promise<string[]> {
  return WalletCore.getAddresses(walletId, start, count);
}

/** Next unused receive address - for card display (standard). Call after full_scan. */
export async function nextReceiveAddress(walletId: string): Promise<string> {
  return WalletCore.nextReceiveAddress(walletId);
}

/** Receive addresses + balances (from UTXOs cached after fullScan, no extra network calls) */
export async function getAddressesWithBalance(
  walletId: string,
  start: number,
  count: number,
  isChange: boolean = false
): Promise<AddressInfo[]> {
  return WalletCore.getAddressesWithBalance(walletId, start, count, isChange);
}

export interface PsbtResult {
  psbtBase64: string;
  /** Actual fee computed by BDK (sat) */
  feeSat: number;
}

/**
 * Create an unsigned PSBT (watch-only - no signing).
 * @returns { psbtBase64, feeSat } -> pass to the offline device via QR code
 */
export async function createPsbt(
  walletId: string,
  recipient: string,
  amountSat: number,
  feeRateSatVb: number,
): Promise<PsbtResult> {
  return WalletCore.createPsbt(walletId, recipient, amountSat, feeRateSatVb);
}

export interface PsbtDecoded {
  /** External recipient address extracted from the actual PSBT bytes (first external output) */
  recipient: string;
  /** Total amount going out (sat) - excludes change */
  amountSat: number;
  /** Fee the PSBT actually pays (sat) */
  feeSat: number;
  /** Change returning to my wallet (sat) */
  changeSat: number;
  /** Number of external outputs - 1 for a normal single send */
  externalOutputCount: number;
}

/**
 * Decode a PSBT from its actual bytes (WYSIWYS cross-check).
 * Returns the real values held in the bytes being signed, not the on-screen values.
 */
export async function decodePsbt(
  walletId: string,
  psbtBase64: string,
): Promise<PsbtDecoded> {
  return WalletCore.decodePsbt(walletId, psbtBase64);
}

/** List transactions (after full_scan) */
export async function listTransactions(walletId: string): Promise<TxInfo[]> {
  return WalletCore.listTransactions(walletId);
}

/**
 * Broadcast a PSBT signed on the offline device to the network.
 * @returns txid
 */
export async function broadcastSignedPsbt(
  walletId: string,
  psbtBase64: string,
  electrumUrls: string[],
): Promise<string> {
  return WalletCore.broadcastSignedPsbt(walletId, psbtBase64, electrumUrls);
}

// EVM balance

/** ERC-20 token balance (direct balanceOf RPC call) */
export async function getTokenBalance(
  rpcUrl: string,
  contractAddr: string,
  walletAddr: string,
): Promise<string> {
  return WalletCore.getTokenBalance(rpcUrl, contractAddr, walletAddr);
}

/** Native coin balance (ETH, MATIC, etc.) */
export async function getNativeBalance(
  rpcUrl: string,
  walletAddr: string,
): Promise<string> {
  return WalletCore.getNativeBalance(rpcUrl, walletAddr);
}
