global.Buffer = global.Buffer || require('buffer').Buffer;

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Modal,
  Switch,
  useWindowDimensions,
  ToastAndroid,
  BackHandler,
  AppState,
  Image,
  Platform,
  StatusBar,
} from 'react-native';
import * as Keychain from 'react-native-keychain';
import { NativeModules } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Path, Rect } from 'react-native-svg';
import { UR, UREncoder, URDecoder } from '@ngraveio/bc-ur';
import { Camera, useCameraDevice, useCameraPermission, useCodeScanner } from 'react-native-vision-camera';

const { DeviceAuth, DeviceIntegrity } = NativeModules;
import {
  initRuntime,
  zpubToDescriptor,
  zpubToChangeDescriptor,
  scanAddressBalance,
  scanAddressHistory,
  scanFeeEstimates,
  createBtcWallet,
  restoreBtcWallet,
  persistChainState,
  fullScan,
  syncWallet,
  nextReceiveAddress,
  getAddressesWithBalance,
  listTransactions,
  createPsbt,
  decodePsbt,
  broadcastSignedPsbt,
  type PsbtDecoded,
  type TxInfo,
  type AddressInfo,
  type FeeEstimates,
  type WalletNetwork,
} from './src/native/WalletCore';

// ── Separated constants (app/src/constants) ───────────────────
import { THEME } from './src/constants/theme';
import {
  NETWORKS,
  EXPLORER,
  explorerTxUrl,
  evmExplorerAddressUrl,
  fetchTipHeight,
  DEFAULT_PRICES,
  type NetworkKey,
} from './src/constants/networks';
import {
  type AssetConfig,
  ASSET_LOGOS,
  CHAIN_LOGOS,
  getChainBadge,
  getWalletAssets,
} from './src/constants/assets';
import {
  WALLETS_SERVICE,
  VISIBILITY_SERVICE,
  ORDER_SERVICE,
  SETTINGS_SERVICE,
  DEFAULT_ORDER,
  DEFAULT_VISIBILITY,
  ADDR_PAGE_SIZE,
  GITHUB_REPO_URL,
} from './src/constants/services';

// ── Separated types/utils/icons ─────────────────────────────
import { type AppSettings, DEFAULT_SETTINGS, type WalletEntry, type Screen, type BalanceState } from './src/types';
import {
  saveVisibilitySettings, loadVisibilitySettings, saveOrderSettings, loadOrderSettings,
  txCacheService, saveTxHistoryCache, loadTxHistoryCache, saveAppSettings, loadAppSettings, saveWalletList,
} from './src/utils/storage';
import {
  isEvmKey, isXpubKey, normalizeScannedKey, getWalletCardTheme, getWalletBadgeText, parseAddrIndex,
  sortTxs, fetchEvmBalance, smallUnit, coinAmountStr, formatAmount, formatDate, emptyBalance, spendableSat, showRawErrorAlert,
} from './src/utils/helpers';
import { WalletOutlineIcon, FilterIcon, PlusIcon } from './src/components/icons';
import { EditWalletModal, AssetDetailsModal, EditAssetsModal } from './src/components/modals';
import { SafeScreen } from './src/components/Screen';
import { useLanguage } from './src/context/LanguageContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { styles } from './src/styles';
export default function App() {
  const insets = useSafeAreaInsets();
  const { setLanguage, t, language } = useLanguage();
  const carouselRef = useRef<ScrollView>(null);
  const [screen, setScreen] = useState<Screen>('loading');
  const [wallets, setWallets] = useState<WalletEntry[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSecured, setIsSecured] = useState(false);
  const [isCheckingSecurity, setIsCheckingSecurity] = useState(false);
  const [onboardingChecks, setOnboardingChecks] = useState<boolean[]>([false, false, false, false, false, false]);

  // Current dashboard state
  const [activeWalletIndex, setActiveWalletIndex] = useState(0);
  const [balances, setBalances] = useState<Record<NetworkKey, BalanceState>>({
    Bitcoin: emptyBalance(),
    Mobick: emptyBalance(),
    LaptopMining: emptyBalance(),
    BNB: emptyBalance(),
    WBMB: emptyBalance(),
    MOVN: emptyBalance(),
    USDT: emptyBalance(),
    ETH: emptyBalance(),
    USDT_ETH: emptyBalance(),
    ETH_BASE: emptyBalance(),
    WBMB_BASE: emptyBalance(),
    MOVL_BASE: emptyBalance(),
  });
  // Memory cache: avoids the spinner lag when switching wallets
  const balancesCacheRef = useRef<Record<string, Record<NetworkKey, BalanceState>>>({});
  
  const [marketPrices, setMarketPrices] = useState(DEFAULT_PRICES);
  const [currencyMode, setCurrencyMode] = useState<'USD' | 'KRW'>('KRW');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // App settings (advanced mode, etc.) — persisted in Keychain
  const [advancedMode, setAdvancedMode] = useState(false);

  const [showCoin, setShowCoin] = useState<Record<NetworkKey, boolean>>({
    Bitcoin: true, Mobick: true, LaptopMining: true,
    BNB: true, WBMB: true, MOVN: true, USDT: true,
    ETH: true, USDT_ETH: true, ETH_BASE: true, WBMB_BASE: true, MOVL_BASE: true,
  });

  // Asset order & visibility state (managed per walletId)
  const [editAssetsModalVisible, setEditAssetsModalVisible] = useState(false);
  const [allVisibility, setAllVisibility] = useState<Record<string, Record<NetworkKey, boolean>>>({});
  const [allOrder, setAllOrder] = useState<Record<string, { BTC: NetworkKey[]; EVM: NetworkKey[] }>>({});

  // Wallet management modal
  const [editWalletModalVisible, setEditWalletModalVisible] = useState(false);
  const [walletToEdit, setWalletToEdit] = useState<WalletEntry | null>(null);
  const [newWalletAlias, setNewWalletAlias] = useState('');
  // Wallet card menu / extended public key (xpub) view modal
  const [walletMenuFor, setWalletMenuFor] = useState<WalletEntry | null>(null);
  const [xpubModalFor, setXpubModalFor] = useState<WalletEntry | null>(null);

  // Asset detail modal (on tap)
  const [assetDetailsModalVisible, setAssetDetailsModalVisible] = useState(false);
  const [selectedAssetKey, setSelectedAssetKey] = useState<NetworkKey | null>(null);

  // Receive screen state
  const [receiveNetwork, setReceiveNetwork] = useState<NetworkKey | null>(null);
  const [receiveAddressStr, setReceiveAddressStr] = useState<string | null>(null);

  // Add-wallet screen state
  const [addLabel, setAddLabel] = useState('');
  const [addZpub, setAddZpub] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addLoadingText, setAddLoadingText] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  // QR scan (add wallet)
  const [showScanner, setShowScanner] = useState(false);
  const scanHandledRef = useRef(false);
  // Which field a scan fills: wallet-import pubkey, or the send-tx recipient address.
  const scanTargetRef = useRef<'zpub' | 'recipient'>('zpub');
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraDevice = useCameraDevice('back');
  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (scanHandledRef.current) return;
      const raw = codes[0]?.value;
      if (!raw) return;
      scanHandledRef.current = true;
      if (scanTargetRef.current === 'recipient') {
        // Accept a raw address or a BIP21-style URI (scheme:address?params).
        const m = raw.trim().match(/^[a-zA-Z][a-zA-Z0-9.+-]*:([^?]+)/);
        setPsbtRecipient((m ? m[1] : raw).trim());
        setPsbtNetworkConfirmed(false);
      } else {
        setAddZpub(normalizeScannedKey(raw));
      }
      setShowScanner(false);
      ToastAndroid.show(t('toast_qr_scanned'), ToastAndroid.SHORT);
    },
  });

  const openScanner = useCallback(async (target: 'zpub' | 'recipient' = 'zpub') => {
    scanTargetRef.current = target;
    let granted = hasPermission;
    if (!granted) granted = await requestPermission();
    if (!granted) {
      Alert.alert(t('camera_permission_title'), t('camera_permission_body'));
      return;
    }
    // Open the scanner right away and let the reactive useCameraDevice hook (plus the
    // background poll below) supply the device. On first launch the device list isn't
    // enumerated yet, so deciding "no camera" before the modal opened caused a false
    // failure that only an app restart cleared.
    scanHandledRef.current = false;
    setScanDevice(null);
    setShowScanner(true);
    if (!cameraDevice) {
      let dev: any = null;
      for (let i = 0; i < 40 && !dev; i++) {
        const list = Camera.getAvailableCameraDevices();
        dev = list.find(d => d.position === 'back') ?? list[0];
        if (!dev) await new Promise(r => setTimeout(r, 200));
      }
      if (dev) setScanDevice(dev);
    }
  }, [hasPermission, requestPermission, cameraDevice]);

  // Create-transaction (PSBT) screen state
  const [psbtNetwork, setPsbtNetwork] = useState<NetworkKey | null>(null);
  const [psbtWalletId, setPsbtWalletId] = useState<string | null>(null);
  const [psbtRecipient, setPsbtRecipient] = useState('');
  // Send-network confirmation: gate "create" until the user confirms the recipient is on this chain.
  // BMB/BTC/LTM share the exact address format, so a wrong-chain address can't be caught technically.
  const [psbtNetworkConfirmed, setPsbtNetworkConfirmed] = useState(false);
  const [psbtAmount, setPsbtAmount] = useState('');
  // Send-all mode: when on, passes amountSat=0 to core to run drain_wallet
  const [isMaxAmount, setIsMaxAmount] = useState(false);
  const [psbtFeeRate, setPsbtFeeRate] = useState('2');
  const [psbtResult, setPsbtResult] = useState<string | null>(null);
  const [psbtFeeSat, setPsbtFeeSat] = useState<number | null>(null);
  const [psbtLoading, setPsbtLoading] = useState(false);
  const [psbtError, setPsbtError] = useState<string | null>(null);
  // WYSIWYS: actual values decoded from PSBT bytes + comparison against inputs
  const [psbtDecoded, setPsbtDecoded] = useState<PsbtDecoded | null>(null);
  const [psbtVerifyError, setPsbtVerifyError] = useState<string | null>(null);
  const [feeEstimates, setFeeEstimates] = useState<FeeEstimates | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);
  
  // UR QR code multi-part transfer
  const [urParts, setUrParts] = useState<string[]>([]);
  const [currentURIndex, setCurrentURIndex] = useState(0);

  // Signed-transaction scan & broadcast screen state
  const [bcNetwork, setBcNetwork] = useState<NetworkKey | null>(null);
  const [bcWalletId, setBcWalletId] = useState<string | null>(null);
  const [bcScanning, setBcScanning] = useState(false);      // whether the camera modal is shown
  const [bcScanProgress, setBcScanProgress] = useState(0);  // animated UR reassembly progress 0~1
  const [bcSignedPsbt, setBcSignedPsbt] = useState<string | null>(null); // reassembled signed PSBT (base64)
  const [bcDecoded, setBcDecoded] = useState<PsbtDecoded | null>(null);  // for WYSIWYS re-check before sending
  const [bcNetworkConfirmed, setBcNetworkConfirmed] = useState(false);   // gate broadcast until network re-confirmed
  const [bcLoading, setBcLoading] = useState(false);        // broadcast in progress
  const [bcError, setBcError] = useState<string | null>(null);
  const [bcTxid, setBcTxid] = useState<string | null>(null); // txid on successful send
  const bcUrDecoderRef = useRef<URDecoder | null>(null);    // multi-part UR accumulating decoder
  const bcWalletIdRef = useRef<string | null>(null);        // prevents stale closure in scanner callback
  const bcDoneRef = useRef(false);                          // prevents duplicate handling after scan completes
  const [scanDevice, setScanDevice] = useState<any>(null);  // camera device obtained directly when the hook has not caught it yet
  const [bcPreparing, setBcPreparing] = useState(false);    // waiting to obtain the camera device

  // Address-list screen state
  const [addrNetwork, setAddrNetwork] = useState<NetworkKey | null>(null);
  const [addrWalletId, setAddrWalletId] = useState<string | null>(null);
  const [addrPage, setAddrPage] = useState(0);
  const [addrList, setAddrList] = useState<AddressInfo[]>([]);
  const [addrLoading, setAddrLoading] = useState(false);
  const [addrJumpInput, setAddrJumpInput] = useState('');
  const [addrIsChange, setAddrIsChange] = useState(false);
  const [addrRefreshing, setAddrRefreshing] = useState(false);

  // Transaction-history screen state
  const [txNetwork, setTxNetwork] = useState<NetworkKey | null>(null);
  const [txList, setTxList] = useState<TxInfo[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [assetRescanLoading, setAssetRescanLoading] = useState(false);
  const [txRefreshing, setTxRefreshing] = useState(false);
  const [txTipHeight, setTxTipHeight] = useState<number | null>(null); // current tip height for confirmation count
  const [selectedTx, setSelectedTx] = useState<TxInfo | null>(null);   // target for the transaction-detail screen

  const { width: screenWidth } = useWindowDimensions();

  // ── Unit toggle handler ────────────────────────────────
  const toggleUnit = useCallback((netKey: NetworkKey) => {
    // Unit toggle is transient (not saved) — resets to the large unit when re-entering the detail screen
    setShowCoin(prev => ({ ...prev, [netKey]: !prev[netKey] }));
  }, []);

  // ── Asset visibility toggle handler ──────────────────────
  const toggleAssetVisibility = useCallback((assetId: NetworkKey) => {
    const walletId = wallets[activeWalletIndex]?.id;
    if (!walletId) return;
    setAllVisibility(prev => {
      const current = prev[walletId] ?? DEFAULT_VISIBILITY;
      const updated = { ...prev, [walletId]: { ...current, [assetId]: !current[assetId] } };
      saveVisibilitySettings(updated);
      return updated;
    });
  }, [activeWalletIndex, wallets]);

  // ── Asset order move handler ──────────────────────
  const moveAsset = useCallback((direction: 'up' | 'down', assetId: NetworkKey) => {
    const activeWallet = wallets[activeWalletIndex];
    if (!activeWallet) return;
    const isEvm = activeWallet.zpub.toLowerCase().trim().startsWith('0x');
    const category = isEvm ? 'EVM' : 'BTC';

    setAllOrder(prev => {
      const currentWalletOrder = prev[activeWallet.id] ?? DEFAULT_ORDER;
      const currentOrder = [...currentWalletOrder[category]];
      const index = currentOrder.indexOf(assetId);
      if (index === -1) return prev;

      if (direction === 'up' && index > 0) {
        const temp = currentOrder[index];
        currentOrder[index] = currentOrder[index - 1];
        currentOrder[index - 1] = temp;
      } else if (direction === 'down' && index < currentOrder.length - 1) {
        const temp = currentOrder[index];
        currentOrder[index] = currentOrder[index + 1];
        currentOrder[index + 1] = temp;
      }

      const updated = { ...prev, [activeWallet.id]: { ...currentWalletOrder, [category]: currentOrder } };
      saveOrderSettings(updated);
      return updated;
    });
  }, [activeWalletIndex, wallets]);

  // ── Sorted and filtered asset list calculator ───────────────
  const getSortedVisibleAssets = useCallback((zpub: string, walletId: string): AssetConfig[] => {
    const isEvm = (zpub || '').toLowerCase().trim().startsWith('0x');
    const category = isEvm ? 'EVM' : 'BTC';
    const assets = getWalletAssets(zpub);
    const visibility = allVisibility[walletId] ?? DEFAULT_VISIBILITY;
    const order = (allOrder[walletId] ?? DEFAULT_ORDER)[category];

    return assets
      .filter(asset => visibility[asset.id] !== false)
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }, [allVisibility, allOrder]);

  // ── Copy address + toast ──────────────────────────────
  const copyAddress = useCallback((addr: string) => {
    Clipboard.setString(addr);
    
    // To prevent address poisoning attacks, 
    // always show a cross-verification popup when copying an address, regardless of its length or type.
    Alert.alert(
      t('addr_copy_title'),
      t('addr_copy_body', { addr }),
      [{ text: t('alert_ok') }]
    );
  }, []);



  // ── CoinGecko real-time price integration ──────────────────────
  const fetchMarketPrices = async () => {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,btcmobick,binancecoin,tether,ethereum&vs_currencies=usd,krw');
      const data: any = await res.json();
      setMarketPrices(prev => ({
        ...prev,
        BTC_USD: data.bitcoin?.usd || 0,
        BTC_KRW: data.bitcoin?.krw || 0,
        BMB_USD: data.btcmobick?.usd || 0,
        BMB_KRW: data.btcmobick?.krw || 0,
        BNB_USD: data.binancecoin?.usd || 0,
        BNB_KRW: data.binancecoin?.krw || 0,
        USDT_USD: data.tether?.usd || 0,
        USDT_KRW: data.tether?.krw || 0,
        ETH_USD: data.ethereum?.usd || 0,
        ETH_KRW: data.ethereum?.krw || 0,
        // WBMB (Wrapped BMB) tracks BMB
        WBMB_USD: data.btcmobick?.usd || 0,
        WBMB_KRW: data.btcmobick?.krw || 0,
        // Unlisted tokens are strictly 0 value
        LTM_USD: 0,
        LTM_KRW: 0,
        MOVN_USD: 0,
        MOVN_KRW: 0,
        MOVL_USD: 0,
        MOVL_KRW: 0,
      }));
    } catch (e) {
      console.log('CoinGecko price refresh failed:', e);
    }
  };

  // Prevents scan race conditions: starting a new scan changes the token,
  // so a late-finishing previous wallet scan result is discarded, preventing it from overwriting the current card balance.
  const scanTokenRef = useRef(0);

  // If onlyKey is given, only that one asset is rescanned (for single refresh in the asset detail modal).
  const scanWalletBalances = useCallback(async (wallet: WalletEntry, onlyKey?: NetworkKey, isRefresh: boolean = false) => {
    const myToken = ++scanTokenRef.current;
    const isCurrent = () => scanTokenRef.current === myToken;
    const isEvm = wallet.zpub.toLowerCase().trim().startsWith('0x');

    if (isEvm) {
      const evmKeys: NetworkKey[] = ['BNB', 'WBMB', 'MOVN', 'USDT', 'ETH', 'USDT_ETH', 'ETH_BASE', 'WBMB_BASE', 'MOVL_BASE'];
      const keys = onlyKey ? evmKeys.filter(k => k === onlyKey) : evmKeys;
      setBalances(prev => {
        const next = { ...prev };
        for (const k of keys) {
          const cached = balancesCacheRef.current[wallet.id]?.[k];
          next[k] = isRefresh 
            ? { ...(prev[k] || cached || emptyBalance()), loading: true, error: null } 
            : { ...(cached || emptyBalance()), loading: true, error: null };
        }
        return next;
      });

      const scanEvmAsset = async (key: NetworkKey) => {
        const net = NETWORKS[key];
        try {
          const balance = await fetchEvmBalance(wallet.zpub, net.contract, net.rpc);
          if (!isCurrent()) return; // already switched to another wallet -> discard
          const newBal: BalanceState = {
            loading: false,
            confirmedSat: balance,
            unconfirmedSat: 0,
            trustedPendingSat: 0,
            pendingOutgoingSat: 0,
            walletId: null,
            error: null,
          };
          if (!balancesCacheRef.current[wallet.id]) balancesCacheRef.current[wallet.id] = {} as any;
          balancesCacheRef.current[wallet.id][key] = newBal;
          
          setBalances(prev => ({
            ...prev,
            [key]: newBal,
          }));
        } catch (e: any) {
          if (!isCurrent()) return;
          setBalances(prev => ({
            ...prev,
            [key]: {
              loading: false,
              confirmedSat: null,
              unconfirmedSat: null,
              trustedPendingSat: null,
              walletId: null,
              error: e.message ?? String(e),
            },
          }));
        }
      };

      await Promise.all(keys.map(k => scanEvmAsset(k)));
    } else {
      const btcKeysAll: ('Bitcoin' | 'Mobick' | 'LaptopMining')[] = ['Bitcoin', 'Mobick', 'LaptopMining'];
      const keys = onlyKey ? btcKeysAll.filter(k => k === onlyKey) : btcKeysAll;
      setBalances(prev => {
        const next = { ...prev };
        for (const k of keys) {
          const cached = balancesCacheRef.current[wallet.id]?.[k];
          next[k] = isRefresh 
            ? { ...(prev[k] || cached || emptyBalance()), loading: true, error: null } 
            : { ...(cached || emptyBalance()), loading: true, error: null };
        }
        return next;
      });

      // Collect walletId/balance during the scan to determine the xpub wallet primary coin (max balance).
      const scannedWids: Partial<Record<'Bitcoin' | 'Mobick' | 'LaptopMining', { wid: string; confirmedSat: number }>> = {};

      const scanNet = async (netKey: 'Bitcoin' | 'Mobick' | 'LaptopMining') => {
        const net = NETWORKS[netKey];
        try {
          if (isXpubKey(wallet.zpub)) {
            // xpub/zpub -> create BDK wallet then full scan
            // Reuse an existing walletId if present, to avoid confirmation rollback caused by sync lag between load-balancer nodes
            let wid = balances[netKey]?.walletId;
            if (!wid) {
              const descriptor = await zpubToDescriptor(wallet.zpub);
              const changeDescriptor = await zpubToChangeDescriptor(wallet.zpub);
              // Restore the saved tx graph cache if present (use previous state immediately after restart), otherwise create new
              wid = await restoreBtcWallet(net.network, descriptor, changeDescriptor);
            }
            const bal = await syncWallet(wid, [...net.electrum]);
            // Save the scan-updated graph to the encrypted cache (lookup still works even if this fails)
            persistChainState(wid).catch(() => {});
            if (!isCurrent()) return; // already switched to another wallet -> discard
            scannedWids[netKey] = { wid, confirmedSat: bal.confirmedSat };
            const newBal: BalanceState = {
              loading: false,
              confirmedSat: bal.confirmedSat,
              unconfirmedSat: bal.unconfirmedSat,
              trustedPendingSat: bal.trustedPendingSat,
              pendingOutgoingSat: bal.pendingOutgoingSat,
              walletId: wid,
              error: null,
            };
            if (!balancesCacheRef.current[wallet.id]) balancesCacheRef.current[wallet.id] = {} as any;
            balancesCacheRef.current[wallet.id][netKey] = newBal;

            setBalances(prev => ({
              ...prev,
              [netKey]: newBal,
            }));
          } else {
            // Single address -> view-only (no walletId, no PSBT/address-list)
            const bal = await scanAddressBalance(net.network, wallet.zpub.trim(), [...net.electrum]);
            
            // Some nodes (e.g. Mobick) may not report unconfirmed balance (unconfirmed < 0) accurately,
            // so we fetch the history and manually correct pendingOutgoing.
            let pendingOut = bal.pendingOutgoingSat || 0;
            try {
              const hist = await scanAddressHistory(net.network, wallet.zpub.trim(), [...net.electrum]);
              const calcPending = hist.filter((t: any) => t.blockHeight === null && t.sentSat > t.receivedSat)
                                      .reduce((sum: number, t: any) => sum + (t.sentSat - t.receivedSat), 0);
              if (calcPending > pendingOut) {
                pendingOut = calcPending;
              }
            } catch (err) {
              console.warn('history fetch failed for pending outgoing', err);
            }

            if (!isCurrent()) return; // already switched to another wallet -> discard
            setBalances(prev => ({
              ...prev,
              [netKey]: {
                loading: false,
                confirmedSat: bal.confirmedSat,
                unconfirmedSat: bal.unconfirmedSat,
                trustedPendingSat: bal.trustedPendingSat,
                pendingOutgoingSat: pendingOut,
                walletId: null,
                error: null,
              },
            }));
          }
        } catch (e: any) {
          if (!isCurrent()) return;
          setBalances(prev => ({
            ...prev,
            [netKey]: {
              loading: false,
              confirmedSat: null,
              unconfirmedSat: null,
              trustedPendingSat: null,
              pendingOutgoingSat: null,
              walletId: null,
              error: e.message ?? String(e),
            },
          }));
        }
      };

      await Promise.all(keys.map(k => scanNet(k)));


    }
  }, []);

  // ── Dashboard refresh ──────────────────────────────
  const handleRefresh = async () => {
    const activeWallet = wallets[activeWalletIndex];
    if (!activeWallet) return;
    setIsRefreshing(true);
    try {
      await Promise.all([
        scanWalletBalances(activeWallet, undefined, true),
        fetchMarketPrices(),
      ]);
    } catch (e) {
      console.log('Error during refresh:', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Rescan only that one asset from the asset detail modal (lighter than a full refresh)
  const refreshAssetBalance = useCallback(async (key: NetworkKey) => {
    const activeWallet = wallets[activeWalletIndex];
    if (!activeWallet) return;
    try {
      await Promise.all([
        scanWalletBalances(activeWallet, key, true),
        fetchMarketPrices(),
      ]);
    } catch (e) {
      console.log('Error during asset refresh:', e);
    }
  }, [wallets, activeWalletIndex, scanWalletBalances]);

  // Deep scan from the asset detail modal (recover full history)
  const deepRescanAssetBalance = useCallback(async (key: NetworkKey) => {
    const activeWallet = wallets[activeWalletIndex];
    const wid = balances[key]?.walletId;
    if (!activeWallet || !wid || !isXpubKey(activeWallet.zpub)) {
      Alert.alert(t('alert_notice_title'), t('alert_deep_scan_unsupported'));
      return;
    }
    
    setAssetRescanLoading(true);
    try {
      const net = NETWORKS[key];
      const bal = await fullScan(wid, [...net.electrum]);
      await persistChainState(wid).catch(() => {});
      
      setBalances(prev => ({
        ...prev,
        [key]: {
          ...prev[key],
          confirmedSat: bal.confirmedSat,
          unconfirmedSat: bal.unconfirmedSat,
          trustedPendingSat: bal.trustedPendingSat,
          pendingOutgoingSat: bal.pendingOutgoingSat,
        },
      }));
      await fetchMarketPrices();
    } catch (e: any) {
      console.log('Error during deep scan:', e);
      showRawErrorAlert(t('alert_deep_scan_err', { err: e.message ?? String(e) }));
    } finally {
      setAssetRescanLoading(false);
    }
  }, [wallets, activeWalletIndex, balances]);

  // ── Lock and security check ──────────────────────────────
  const checkSecurity = useCallback(async () => {
    let secured = false;
    try {
      secured = await DeviceAuth.isDeviceSecure();
    } catch {
      secured = await Keychain.isPasscodeAuthAvailable().catch(() => false);
    }
    setIsSecured(secured);
    return secured;
  }, []);

  // ── Unlock ──────────────────────────────────────
  const unlock = useCallback(async () => {
    setAuthError(null);
    try {
      // 1. On entry, always explicitly require device-owner auth (fingerprint/PIN, etc.). (guaranteed every call)
      await DeviceAuth.authenticate(t('auth_wallet_access'));

      // 2. After successful auth, read and decrypt the encrypted data from Keychain.
      // (since auth just completed, the OS cache prevents a duplicate prompt when reading the password.)
      const creds = await Keychain.getGenericPassword({
        service: WALLETS_SERVICE,
      });

      if (creds) {
        // Wallet exists and decryption succeeded -> enter home screen
        const list = JSON.parse(creds.password) as WalletEntry[];
        setWallets(list);
        setScreen('home');
      } else {
        // New user with no registered wallet -> enter home screen with empty wallet state
        setWallets([]);
        setScreen('home');
      }
    } catch (e: any) {
      const msg: string = e.message ?? String(e);
      if (msg === 'AUTH_FAILED' || msg.includes('cancel') || msg.includes('Cancel') || msg.includes('UserCancel') || msg.includes('AUTH_CANCELLED')) {
        setAuthError(t('auth_fail_retry'));
        setScreen('lock'); // enter lock screen only on auth failure/cancel
      } else {
        // If the key was force-invalidated or another crypto error occurred
        // e.g. when the user reset the lock and the key broke
        const lowerMsg = msg.toLowerCase();
        if (
          lowerMsg.includes('invalid') ||
          lowerMsg.includes('permanently') ||
          lowerMsg.includes('decryption failed') ||
          lowerMsg.includes('authentication tag') ||
          lowerMsg.includes('wrong key')
        ) {
          Alert.alert(
            t('security_change_title'),
            t('security_change_body'),
            [{ text: t('alert_ok'), onPress: async () => {
              await Keychain.resetGenericPassword({ service: WALLETS_SERVICE }).catch(() => {});
              setWallets([]);
              setScreen('home');
            }}]
          );
          return;
        }
        setAuthError(msg);
        setScreen('lock');
      }
    }
  }, []);

  // ── Init: auto-start device authentication ─────────────────────
  useEffect(() => {
    (async () => {
      // Block rooted devices — release builds only (debug/emulator pass for development)
      try {
        const integrity = await DeviceIntegrity?.checkIntegrity?.();
        if (integrity) {
          console.log('[Integrity]', JSON.stringify(integrity));
        }
        if (integrity?.rooted && integrity?.isDebug === false) {
          setScreen('blocked');
          return;
        }
      } catch {
        // Integrity module call failure does not block (for old versions / missing module)
      }

      await initRuntime().catch(() => {});

      // Unit setting is not saved — always defaults to the large unit

      // Load saved asset visibility & order (per walletId)
      const savedVisibility = await loadVisibilitySettings();
      if (savedVisibility) setAllVisibility(savedVisibility);
      const savedOrder = await loadOrderSettings();
      if (savedOrder) setAllOrder(savedOrder);
      const savedSettings = await loadAppSettings();
      if (savedSettings) setAdvancedMode(savedSettings.advancedMode);
      if (savedSettings?.language) setLanguage(savedSettings.language);

      const hasCompletedOnboarding = savedSettings?.hasCompletedOnboarding || false;
      const secured = await checkSecurity();

      if (!hasCompletedOnboarding) {
        // First run: pick language before onboarding (skip if already chosen)
        setScreen(savedSettings?.language ? 'onboarding' : 'language_selection');
      } else if (secured) {
        // Request unlock directly from the logo splash (loading) state
        setTimeout(() => {
          unlock();
        }, 3000);
      } else {
        setScreen('no_security');
      }
    })();
  }, [unlock, checkSecurity]);

  // ── Detect app state changes (handle return after settings complete) ───
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (nextAppState === 'active') {
        if (screen === 'no_security') {
          setIsCheckingSecurity(true);
          // Wait 1.5s for the OS to reflect state and to show a loading transition
          await new Promise((resolve) => setTimeout(resolve, 1500));
          await checkSecurity();
          setIsCheckingSecurity(false);
        } else {
          await checkSecurity();
        }
      }
    });
    return () => {
      subscription.remove();
    };
  }, [screen, checkSecurity]);

  // ── Scan on active-wallet change ──────────────────────────
  useEffect(() => {
    const activeWallet = wallets[activeWalletIndex];
    if (activeWallet) {
      scanWalletBalances(activeWallet);
      fetchMarketPrices();
    }
  }, [activeWalletIndex, wallets, scanWalletBalances]);

  // ── Sync carousel scroll on active-wallet change / home re-entry ───
  // (visiting other screens like tx history remounts the carousel, resetting its position to 0,
  //  so re-align to the activeWalletIndex position when returning home)
  useEffect(() => {
    if (screen !== 'home' || wallets.length === 0) return;
    const id = requestAnimationFrame(() => {
      carouselRef.current?.scrollTo({ x: activeWalletIndex * screenWidth, animated: false });
    });
    return () => cancelAnimationFrame(id);
  }, [screen, activeWalletIndex, wallets.length, screenWidth]);

  // ── Add wallet ──────────────────────────────────────
  const handleAddWallet = useCallback(async () => {
    // Remove invisible characters/whitespace mixed in on paste (keep only printable ASCII)
    const zpub = addZpub.replace(/[^\x21-\x7E]/g, '').trim();
    const label = addLabel.trim() || t('wallet_default_label', { n: wallets.length + 1 });
    if (!zpub) return;

    // On API 28 and below, explicitly require device auth when adding
    if (Platform.OS === 'android' && Platform.Version < 30) {
      try {
        await DeviceAuth.authenticate(t('auth_add_wallet'));
      } catch (err) {
        return; // abort on auth failure/cancel
      }
    }

    setAddLoading(true);
    setAddLoadingText('');
    setAddError(null);
    try {
      if (isEvmKey(zpub)) {
        if (!/^0x[0-9a-fA-F]{40}$/.test(zpub)) {
          throw new Error(t('err_invalid_evm'));
        }
      } else if (isXpubKey(zpub)) {
        setAddLoadingText(t('add_loading_deep'));
        const descriptor = await zpubToDescriptor(zpub);
        const changeDescriptor = await zpubToChangeDescriptor(zpub);
        const networks: WalletNetwork[] = ['Bitcoin', 'Mobick', 'LaptopMining'];
        for (const netKey of networks) {
          const net = NETWORKS[netKey];
          const wid = await restoreBtcWallet(net.network, descriptor, changeDescriptor);
          await fullScan(wid, [...net.electrum]);
          await persistChainState(wid).catch(() => {});
        }
      } else {
        // Single BTC address (view-only)
        if (!/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,}$/.test(zpub)) {
          throw new Error(t('err_unsupported_format'));
        }
      }
      const entry: WalletEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        label,
        zpub,
      };
      const updated = [...wallets, entry];
      await saveWalletList(updated);
      setWallets(updated);
      setAddLabel('');
      setAddZpub('');
      setScreen('home');
      setActiveWalletIndex(updated.length - 1);
    } catch (e: any) {
      setAddError(e.message ?? String(e));
    } finally {
      setAddLoading(false);
      setAddLoadingText('');
    }
  }, [addLabel, addZpub, wallets]);

  // ── Rename wallet ─────────────────────────────────
  const handleRenameWallet = async () => {
    if (!walletToEdit || !newWalletAlias.trim()) return;

    // On API 28 and below, explicitly require device auth when renaming
    if (Platform.OS === 'android' && Platform.Version < 30) {
      try {
        await DeviceAuth.authenticate(t('auth_rename_wallet'));
      } catch (err) {
        return; // abort on auth failure/cancel
      }
    }

    const updated = wallets.map(w => {
      if (w.id === walletToEdit.id) {
        return { ...w, label: newWalletAlias.trim() };
      }
      return w;
    });
    setWallets(updated);
    await saveWalletList(updated);
    setEditWalletModalVisible(false);
    setWalletToEdit(null);
    ToastAndroid.show(t('toast_wallet_renamed'), ToastAndroid.SHORT);
  };

  // ── Delete wallet ──────────────────────────────────────
  const handleDeleteWallet = (targetWallet?: WalletEntry) => {
    const w = targetWallet || walletToEdit;
    if (!w) return;
    Alert.alert(
      t('wallet_remove_title'),
      t('wallet_remove_body', { label: w.label }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('wallet_remove_confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              // Explicitly require device auth on all Android devices
              await DeviceAuth.authenticate(t('auth_remove_wallet'));
              
              const updated = wallets.filter(wallet => wallet.id !== w.id);
              // 1. First safely complete the save to the keychain (storage)
              await saveWalletList(updated);
              
              // 2. If no error, update the UI state
              setWallets(updated);
              if (activeWalletIndex >= updated.length) {
                setActiveWalletIndex(Math.max(0, updated.length - 1));
              }
              setEditWalletModalVisible(false);
              setWalletToEdit(null);
              ToastAndroid.show(t('toast_wallet_removed'), ToastAndroid.SHORT);
            } catch (err) {
              // Abort without UI changes on auth cancel or save failure
              console.log('Wallet delete canceled/failed:', err);
            }
          }
        }
      ]
    );
  };

  const getFormattedTotalBalance = () => {
    const isKrw = currencyMode === 'KRW';
    let totalValue = 0;
    const activeWallet = wallets[activeWalletIndex];
    if (!activeWallet) return isKrw ? '₩ 0' : '$ 0.00';
    const vis = allVisibility[activeWallet.id] ?? DEFAULT_VISIBILITY;
    const prices = marketPrices as Record<string, number>;

    // Iterate over displayed assets and convert by per-ticker price (chain/decimals per NETWORKS)
    for (const asset of getWalletAssets(activeWallet.zpub)) {
      const bal = balances[asset.id];
      if (vis[asset.id] === false || !bal || bal.confirmedSat === null) continue;
      const val = spendableSat(bal) / Math.pow(10, NETWORKS[asset.id].decimals);
      const price = prices[`${asset.ticker}_${isKrw ? 'KRW' : 'USD'}`] ?? 0;
      totalValue += val * price;
    }

    if (isKrw) {
      return `₩ ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    } else {
      return `$ ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
  };

  // ── Receive assets ─────────────────────────────
  const openReceive = useCallback(async (netKey: NetworkKey) => {
    const activeWallet = wallets[activeWalletIndex];
    if (!activeWallet) return;

    setReceiveNetwork(netKey);
    setReceiveAddressStr(null);
    setScreen('receive');
    setAssetDetailsModalVisible(false);

    try {
      const net = NETWORKS[netKey];
      if (net.isEvm || !isXpubKey(activeWallet.zpub)) {
        // Single address or EVM wallet
        setReceiveAddressStr(activeWallet.zpub);
      } else {
        // HD wallet
        const wid = balances[netKey].walletId;
        if (wid) {
          const addr = await nextReceiveAddress(wid);
          setReceiveAddressStr(addr);
        }
      }
    } catch (e: any) {
      showRawErrorAlert(e.message ?? String(e), t('addr_lookup_err_title'));
    }
  }, [balances, wallets, activeWalletIndex]);

  // ── Create transaction (PSBT) & animated QR ─────────
  const openCreatePsbt = useCallback((netKey: NetworkKey) => {
    const wid = balances[netKey].walletId;
    if (!wid) return;
    setPsbtNetwork(netKey);
    setPsbtWalletId(wid);
    setPsbtRecipient('');
    setPsbtNetworkConfirmed(false);
    setPsbtAmount('');
    setIsMaxAmount(false);
    setPsbtFeeRate('2');
    setPsbtResult(null);
    setPsbtFeeSat(null);
    setPsbtDecoded(null);
    setPsbtVerifyError(null);
    setUrParts([]);
    setPsbtError(null);
    setFeeEstimates(null);
    setScreen('create_psbt');
    setAssetDetailsModalVisible(false);

    // Estimate fast/normal/slow fee rates from Electrum -> set default to 'normal'
    setFeeLoading(true);
    const net = NETWORKS[netKey];
    scanFeeEstimates(net.network as WalletNetwork, [...net.electrum])
      .then(fees => {
        setFeeEstimates(fees);
        setPsbtFeeRate(String(Math.max(1, Math.round(fees.normalSatVb))));
      })
      .catch(() => {})
      .finally(() => setFeeLoading(false));
  }, [balances]);

  // ── Signed-transaction scan & broadcast ──────────────────
  // Read the signed PSBT returned by the cold wallet (single/animated UR), then finalize and send.
  const openBroadcastTx = useCallback((netKey: NetworkKey) => {
    const wid = balances[netKey].walletId;
    if (!wid) return;
    setBcNetwork(netKey);
    setBcWalletId(wid);
    bcWalletIdRef.current = wid;
    setBcScanning(false);
    setBcScanProgress(0);
    setBcSignedPsbt(null);
    setBcDecoded(null);
    setBcNetworkConfirmed(false);
    setBcLoading(false);
    setBcError(null);
    setBcTxid(null);
    bcUrDecoderRef.current = null;
    bcDoneRef.current = false;
    setScreen('broadcast_tx');
    setAssetDetailsModalVisible(false);
  }, [balances]);

  const startBcScan = useCallback(async () => {
    let granted = hasPermission;
    if (!granted) granted = await requestPermission();
    if (!granted) {
      Alert.alert(t('camera_permission_title'), t('camera_permission_body'));
      return;
    }
    bcUrDecoderRef.current = new URDecoder();
    bcDoneRef.current = false;
    setBcScanProgress(0);
    setBcSignedPsbt(null);
    setBcDecoded(null);
    setBcNetworkConfirmed(false);
    setBcError(null);

    // Open the scanner right away; the reactive useCameraDevice hook and the background
    // poll below supply the device. Bailing before opening caused a false "no camera"
    // on first launch (device list not yet enumerated) unless already warmed up.
    setScanDevice(null);
    setBcScanning(true);
    if (!cameraDevice) {
      setBcPreparing(true);
      let dev: any = null;
      for (let i = 0; i < 40 && !dev; i++) {
        const list = Camera.getAvailableCameraDevices();
        dev = list.find(d => d.position === 'back') ?? list[0];
        if (!dev) await new Promise(r => setTimeout(r, 200));
      }
      setBcPreparing(false);
      if (dev) setScanDevice(dev);
    }
  }, [hasPermission, requestPermission, cameraDevice]);

  // The scanner callback captures the initial render closure, so reference only refs instead of state.
  const bcCodeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (bcDoneRef.current) return;
      const raw = codes[0]?.value?.trim();
      if (!raw) return;
      try {
        let base64: string | null = null;
        if (raw.toLowerCase().startsWith('ur:')) {
          // Animated (multi-part) or single UR
          if (!bcUrDecoderRef.current) bcUrDecoderRef.current = new URDecoder();
          const dec = bcUrDecoderRef.current;
          dec.receivePart(raw);
          setBcScanProgress(dec.getProgress());
          if (dec.isComplete()) {
            if (dec.isSuccess()) {
              // The encoder wrapped it as a crypto-psbt CBOR byte string, so recover the original with decodeCBOR
              base64 = dec.resultUR().decodeCBOR().toString('base64');
            } else {
              bcDoneRef.current = true;
              setBcScanning(false);
              setBcError(t('broadcast_qr_rebuild_err', { err: dec.resultError() }));
              return;
            }
          }
        } else {
          // If not a UR, treat as a single-QR base64 PSBT
          base64 = raw;
        }
        if (base64) {
          bcDoneRef.current = true;
          setBcScanning(false);
          setBcScanProgress(1);
          setBcSignedPsbt(base64);
          // Re-decode actual bytes before sending -> re-verify recipient/amount (WYSIWYS)
          const wid = bcWalletIdRef.current;
          if (wid) {
            decodePsbt(wid, base64)
              .then(setBcDecoded)
              .catch((e: any) => setBcError(t('broadcast_parse_err', { err: e?.message ?? String(e) })));
          }
        }
      } catch (e: any) {
        bcDoneRef.current = true;
        setBcScanning(false);
        setBcError(t('broadcast_process_err', { err: e?.message ?? String(e) }));
      }
    },
  });

  const doBroadcast = useCallback(async () => {
    if (!bcNetwork || !bcWalletId || !bcSignedPsbt) return;
    setBcLoading(true);
    setBcError(null);
    try {
      const net = NETWORKS[bcNetwork];
      const txid = await broadcastSignedPsbt(bcWalletId, bcSignedPsbt, [...net.electrum]);
      setBcTxid(txid);
    } catch (e: any) {
      setBcError(e?.message ?? String(e));
    } finally {
      setBcLoading(false);
    }
  }, [bcNetwork, bcWalletId, bcSignedPsbt]);

  const handleCreatePsbt = useCallback(async () => {
    if (!psbtNetwork || !psbtWalletId) return;
    // Input is in the large unit (BTC/coin) -> convert to sat.
    // If send-all (isMaxAmount), pass the magic value 0 to core to trigger drain_wallet.
    const amountCoin = parseFloat(psbtAmount.trim());
    const amountSat = isMaxAmount ? 0 : Math.round(amountCoin * 100_000_000);
    const feeRate = parseFloat(psbtFeeRate.trim());
    if (!psbtRecipient.trim()) { setPsbtError(t('psbt_err_recipient')); return; }
    if (!isMaxAmount && (isNaN(amountCoin) || amountSat <= 0)) { setPsbtError(t('psbt_err_amount')); return; }
    if (isNaN(feeRate) || feeRate <= 0) { setPsbtError(t('psbt_err_fee')); return; }

    // All sends: force a sync right before build to reflect the latest UTXO state.
    // React state (balances) is the last scan value, so a just-created pending/deposit, or a UTXO
    // already spent elsewhere, may be missed. The latest state is essential for normal sends as well as send-all
    // (building with a stale graph may include already-spent UTXOs or miss just-confirmed balance, causing failure/inaccuracy).
    setPsbtLoading(true);
    setPsbtError(null);
    let freshConfirmed = 0;
    let freshPending = 0;
    let freshSpendable = 0;
    try {
      const fresh = await syncWallet(psbtWalletId, [...NETWORKS[psbtNetwork].electrum]);
      persistChainState(psbtWalletId).catch(() => {});
      freshConfirmed = fresh.confirmedSat ?? 0;
      freshPending = fresh.unconfirmedSat ?? 0;
      freshSpendable = freshConfirmed + (fresh.trustedPendingSat ?? 0);
      // Also update the spendable balance / incoming-pending display with the fresh scan result
      setBalances(prev => ({
        ...prev,
        [psbtNetwork]: {
          ...prev[psbtNetwork],
          confirmedSat: fresh.confirmedSat,
          unconfirmedSat: fresh.unconfirmedSat,
          trustedPendingSat: fresh.trustedPendingSat,
          pendingOutgoingSat: fresh.pendingOutgoingSat,
          loading: false,
          error: null,
        },
      }));
    } catch (e: any) {
      setPsbtLoading(false);
      setPsbtError(t('psbt_err_sync', { err: e.message ?? String(e) }));
      return;
    }

    if (isMaxAmount) {
      // Send-all spends "only confirmed UTXOs" in core (excludes unconfirmed).
      if (freshConfirmed <= 0) {
        setPsbtLoading(false);
        setPsbtError(t('psbt_err_no_balance'));
        return;
      }
      // If there is pending (unconfirmed) balance, inform that it is excluded and confirm whether to send only the confirmed portion.
      if (freshPending > 0) {
        const tk = NETWORKS[psbtNetwork].ticker;
        const proceed = await new Promise<boolean>(resolve => {
          Alert.alert(
            t('psbt_alert_pending_title'),
            t('psbt_alert_pending_body', {
              pending: (freshPending / 100_000_000).toFixed(8),
              confirmed: (freshConfirmed / 100_000_000).toFixed(8),
              token: tk,
            }),
            [
              { text: t('cancel'), style: 'cancel', onPress: () => resolve(false) },
              { text: t('psbt_pending_confirm_btn'), onPress: () => resolve(true) },
            ],
            { cancelable: false },
          );
        });
        if (!proceed) { setPsbtLoading(false); return; }
      }
    } else if (freshSpendable <= 0) {
      // Normal send: if there is no balance at all, block before calling core
      setPsbtLoading(false);
      setPsbtError(t('psbt_no_spendable'));
      return;
    }

    setPsbtError(null);
    setPsbtResult(null);
    setPsbtDecoded(null);
    setPsbtVerifyError(null);
    setUrParts([]);
    try {
      const recipientInput = psbtRecipient.trim();
      const { psbtBase64, feeSat } = await createPsbt(psbtWalletId, recipientInput, amountSat, feeRate);
      setPsbtFeeSat(feeSat);

      // ── WYSIWYS cross-verification ─────────────────────────────
      // Not the inputs shown on screen, but decode the actual PSBT bytes to
      // verify the recipient/amount/output count are exactly what the user intended.
      // If any of them mismatch, never generate/show the QR.
      const decoded = await decodePsbt(psbtWalletId, psbtBase64);
      setPsbtDecoded(decoded);

      const addrMatch =
        decoded.recipient.trim().toLowerCase() === recipientInput.toLowerCase();
      // For send-all, the user does not enter an amount, so an amount-match check is impossible.
      // Instead, verify "change == 0" = the wallet was fully emptied (a true drain).
      const amtMatch = isMaxAmount
        ? decoded.changeSat === 0
        : decoded.amountSat === amountSat;
      const singleOutput = decoded.externalOutputCount === 1;

      if (!addrMatch || !amtMatch || !singleOutput) {
        const reasons: string[] = [];
        if (!addrMatch) {
          reasons.push(t('psbt_verify_reason_recipient', { recipient: decoded.recipient }));
        }
        if (!amtMatch) {
          reasons.push(
            isMaxAmount
              ? t('psbt_verify_reason_change', { change: (decoded.changeSat / 100_000_000).toFixed(8) })
              : t('psbt_verify_reason_amount', { amount: (decoded.amountSat / 100_000_000).toFixed(8) }),
          );
        }
        if (!singleOutput) {
          reasons.push(t('psbt_verify_reason_external', { count: decoded.externalOutputCount }));
        }
        setPsbtVerifyError(t('psbt_verify_fail') + reasons.join('\n'));
        return; // psbtResult/urParts not set -> QR not shown
      }

      // Verification passed -> only now commit as the QR generation target
      setPsbtResult(psbtBase64);

      // Excessive-fee warning (sanity check): if the actual fee exceeds the actual amount sent
      // it is a tail-wagging-the-dog situation, so strongly alert before signing. (not a block)
      if (decoded.feeSat > decoded.amountSat) {
        const tk = NETWORKS[psbtNetwork].ticker;
        Alert.alert(
          t('psbt_fee_high_title'),
          t('psbt_fee_high_body', {
            fee: (decoded.feeSat / 100_000_000).toFixed(8),
            amount: (decoded.amountSat / 100_000_000).toFixed(8),
            token: tk,
          }),
        );
      }

      // Keystone UR standard multi-part animated QR conversion
      try {
        const psbtBuffer = Buffer.from(psbtBase64, 'base64');
        const len = psbtBuffer.length;
        let cborHeader: number[];
        if (len <= 23) {
          cborHeader = [0x40 + len];
        } else if (len <= 0xff) {
          cborHeader = [0x58, len];
        } else {
          cborHeader = [0x59, (len >> 8) & 0xff, len & 0xff];
        }
        const cborData = Buffer.concat([Buffer.from(cborHeader), psbtBuffer]);
        const ur = new UR(cborData, 'crypto-psbt');
        const urEncoder = new UREncoder(ur, 200); // split into 200-char chunks for readability
        const parts: string[] = [];
        const totalParts = urEncoder.fragmentsLength;
        for (let i = 0; i < totalParts; i++) {
          parts.push(urEncoder.nextPart());
        }
        setUrParts(parts);
        setCurrentURIndex(0);
      } catch (err) {
        console.log('UR multi-part QR generation failed:', err);
        setUrParts([]);
      }
    } catch (e: any) {
      // Failure causes vary (insufficient balance/dust/fee, etc.), so instead of translating each
      // expose the raw message from core/BDK as-is.
      // Common causes (e.g. insufficient available UTXO) are pre-noted in the guidance at the top of the create screen.
      setPsbtError(e.message ?? String(e));
    } finally {
      setPsbtLoading(false);
    }
  }, [psbtNetwork, psbtWalletId, psbtRecipient, psbtAmount, psbtFeeRate, isMaxAmount, balances]);

  // PSBT QR animation timer
  useEffect(() => {
    if (urParts.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentURIndex(prev => (prev + 1) % urParts.length);
    }, 350);
    return () => clearInterval(interval);
  }, [urParts]);

  // ── Address list (paging) ──────────────────────────────
  const loadAddrPage = useCallback(async (walletId: string, page: number, isChange: boolean) => {
    setAddrLoading(true);
    setAddrList([]);
    try {
      const items = await getAddressesWithBalance(walletId, page * ADDR_PAGE_SIZE, ADDR_PAGE_SIZE, isChange);
      setAddrList(items);
      setAddrPage(page);
      setAddrIsChange(isChange);
    } catch (e: any) {
      showRawErrorAlert(e.message ?? String(e));
    } finally {
      setAddrLoading(false);
    }
  }, []);

  const openAddresses = useCallback(async (netKey: NetworkKey) => {
    const wid = balances[netKey].walletId;
    if (!wid) return;
    setAddrNetwork(netKey);
    setAddrWalletId(wid);
    setAddrJumpInput('');
    setScreen('addresses');
    setAssetDetailsModalVisible(false);
    await loadAddrPage(wid, 0, false);
  }, [balances, loadAddrPage]);

  const handleAddrJump = useCallback(async () => {
    if (!addrWalletId) return;
    const idx = parseAddrIndex(addrJumpInput);
    if (idx === null || idx < 0) {
      Alert.alert(t('alert_error_title'), t('addr_index_err'));
      return;
    }
    await loadAddrPage(addrWalletId, Math.floor(idx / ADDR_PAGE_SIZE), addrIsChange);
  }, [addrWalletId, addrJumpInput, addrIsChange, loadAddrPage]);

  // Address-list refresh: update new addresses/UTXOs via full_scan, then reload the current page.
  // Per-address balance is scan-cache based, so without this refresh the latest deposits are not reflected.
  const refreshAddresses = useCallback(async () => {
    if (!addrWalletId || !addrNetwork || addrRefreshing) return;
    setAddrRefreshing(true);
    try {
      const net = NETWORKS[addrNetwork];
      const bal = await syncWallet(addrWalletId, [...net.electrum]);
      persistChainState(addrWalletId).catch(() => {});
      // Keep balance state consistent with home/modal
      setBalances(prev => ({
        ...prev,
        [addrNetwork]: {
          ...prev[addrNetwork],
          loading: false,
          confirmedSat: bal.confirmedSat,
          unconfirmedSat: bal.unconfirmedSat,
          trustedPendingSat: bal.trustedPendingSat,
          pendingOutgoingSat: bal.pendingOutgoingSat,
          error: null,
        },
      }));
      await loadAddrPage(addrWalletId, addrPage, addrIsChange);
    } catch (e: any) {
      showRawErrorAlert(e.message ?? String(e));
    } finally {
      setAddrRefreshing(false);
    }
  }, [addrWalletId, addrNetwork, addrPage, addrIsChange, addrRefreshing, loadAddrPage]);

  // ── Transaction history ───────────────────────────────
  // Fetch the tx list for the current wallet/network and return sorted only (no state change)
  // deep=false: incremental sync — recheck known addresses only, fast (default for open/refresh).
  // deep=true : full rescan (full_scan) — until new addresses are found, slow ('full rescan' button).
  const fetchTxs = useCallback(async (netKey: NetworkKey, deep: boolean = false): Promise<TxInfo[]> => {
    const activeWallet = wallets[activeWalletIndex];
    const wid = balances[netKey].walletId;
    const net = NETWORKS[netKey];
    if (wid) {
      // listTransactions reads only the in-memory cached wallet graph, so we must re-sync from Electrum first
      // to reflect txs/confirmations since the last scan. Default is a fast incremental sync; only full rescan uses full_scan.
      if (deep) {
        await fullScan(wid, [...net.electrum]);
      } else {
        await syncWallet(wid, [...net.electrum]);
      }
      // Save the updated graph to the encrypted cache (lookup still works even if this fails)
      persistChainState(wid).catch(() => {});
      return sortTxs(await listTransactions(wid));
    }
    // Single address — direct Electrum query (already live). Cache the result to show instantly on next entry.
    const addr = activeWallet!.zpub.trim();
    const txs = sortTxs(await scanAddressHistory(net.network as WalletNetwork, addr, [...net.electrum]));
    saveTxHistoryCache(net.network, addr, txs).catch(() => {});
    return txs;
  }, [balances, wallets, activeWalletIndex]);

  const openTxHistory = useCallback(async (netKey: NetworkKey) => {
    const activeWallet = wallets[activeWalletIndex];
    const wid = balances[netKey].walletId;
    const isSingleAddr = !!activeWallet && !isEvmKey(activeWallet.zpub) && !isXpubKey(activeWallet.zpub);
    if (!wid && !isSingleAddr) return;

    setTxNetwork(netKey);
    setTxTipHeight(null);
    setTxList([]); // clear first so the previous screen list is not briefly shown
    setScreen('tx_history');
    setAssetDetailsModalVisible(false);

    // 1) Show cached history immediately (no network call, stale-while-revalidate)
    //    HD wallet -> from the restored BDK graph; single address -> from the Keychain cache.
    let hasCache = false;
    if (wid) {
      try {
        const cached = sortTxs(await listTransactions(wid));
        setTxList(cached);
        hasCache = cached.length > 0;
      } catch {
        setTxList([]);
      }
    } else if (isSingleAddr && activeWallet) {
      const cached = await loadTxHistoryCache(NETWORKS[netKey].network, activeWallet.zpub.trim());
      if (cached && cached.length > 0) {
        setTxList(sortTxs(cached));
        hasCache = true;
      } else {
        setTxList([]);
      }
    } else {
      setTxList([]);
    }

    // 2) Latest sync — if cached, keep the list and show only the small header spinner (txRefreshing),
    //    if not cached, show the center full-loading spinner.
    if (hasCache) setTxRefreshing(true); else setTxLoading(true);
    try {
      const [txs, tip] = await Promise.all([fetchTxs(netKey), fetchTipHeight(netKey)]);
      setTxList(txs);
      setTxTipHeight(tip);
    } catch (e: any) {
      if (!hasCache) showRawErrorAlert(e.message ?? String(e));
    } finally {
      setTxLoading(false);
      setTxRefreshing(false);
    }
  }, [balances, wallets, activeWalletIndex, fetchTxs]);

  // Return to the previous asset-detail modal from asset sub-screens like tx history / address list
  // (selectedAssetKey persists even when entering sub-screens, so just reopen the modal)
  const backToAssetModal = useCallback(() => {
    setScreen('home');
    setAssetDetailsModalVisible(true);
  }, []);

  // Android hardware back: handled with the same rules as the on-screen back button.
  // (RN <Modal> consumes back via its own onRequestClose, so here we handle only full screens)
  useEffect(() => {
    const onBack = (): boolean => {
      switch (screen) {
        case 'tx_history':
        case 'addresses':
        case 'receive':
          backToAssetModal();
          return true;
        case 'tx_detail':
          setScreen('tx_history');
          return true;
        case 'create_psbt':
        case 'broadcast_tx':
        case 'settings':
        case 'add_wallet':
          setScreen('home');
          return true;
        case 'lock':
        case 'blocked':
        case 'no_security':
        case 'loading':
          return true; // ignore back on lock/block/loading screens
        case 'home':
        default:
          return false; // default behavior (exit app)
      }
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [screen, backToAssetModal]);

  // Silently reload without clearing the list (header refresh / pull-to-refresh)
  const refreshTxHistory = useCallback(async () => {
    if (!txNetwork || txRefreshing) return;
    setTxRefreshing(true);
    try {
      const [txs, tip] = await Promise.all([fetchTxs(txNetwork), fetchTipHeight(txNetwork)]);
      setTxList(txs);
      setTxTipHeight(tip);
    } catch (e: any) {
      showRawErrorAlert(e.message ?? String(e));
    } finally {
      setTxRefreshing(false);
    }
  }, [txNetwork, txRefreshing, fetchTxs]);

  // The former full-rescan (deep=true) feature is now replaced by the deep scan in the asset detail modal.

  // =======================================================
  // Screen rendering branch
  // =======================================================

  // ── 1. LOADING SCREEN (SPLASH) ────────────────────────
  if (screen === 'loading') {
    return (
      <View style={styles.center}>
        <Image source={require('./assets/logo.png')} style={styles.splashLogoImage} />
        <Text style={styles.logoTitle}>BTC · Mobick</Text>
        <Text style={styles.logoTitleSub}>Watch-Only</Text>
        <Text style={{ color: '#888', fontSize: 13, marginTop: 8, letterSpacing: 1 }}>powered by BDK</Text>
        <ActivityIndicator color={THEME.primary} size="large" style={{ marginTop: 32 }} />
      </View>
    );
  }

  // ── 1.4 FIRST-RUN LANGUAGE SELECTION ───────────────────
  if (screen === 'language_selection') {
    const LANGS: { code: 'en' | 'ko' | 'zh' | 'ja'; name: string }[] = [
      { code: 'en', name: 'English' },
      { code: 'ko', name: '한국어' },
      { code: 'zh', name: '中文 (简体)' },
      { code: 'ja', name: '日本語' },
    ];
    const handlePickLanguage = async (lang: 'en' | 'ko' | 'zh' | 'ja') => {
      setLanguage(lang);
      await saveAppSettings({ language: lang });
      setScreen('onboarding');
    };
    return (
      <SafeScreen style={{ backgroundColor: THEME.background }}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>🌐 Language</Text>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, paddingBottom: 40 + insets.bottom }}>
          <Text style={{ color: THEME.textMuted, fontSize: 14, marginBottom: 24, lineHeight: 22 }}>
            Select your language. / 언어를 선택하세요.
          </Text>
          {LANGS.map((lang) => (
            <TouchableOpacity
              key={lang.code}
              activeOpacity={0.7}
              onPress={() => handlePickLanguage(lang.code)}
              style={{
                marginBottom: 12,
                backgroundColor: THEME.cardBg,
                padding: 18,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: THEME.border,
              }}
            >
              <Text style={{ color: THEME.text, fontSize: 16, fontWeight: '600' }}>{lang.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeScreen>
    );
  }

  // ── 1.45 SETTINGS: LANGUAGE PICKER ─────────────────────
  if (screen === 'settings_language') {
    const LANGS: { code: 'en' | 'ko' | 'zh' | 'ja'; name: string }[] = [
      { code: 'en', name: 'English' },
      { code: 'ko', name: '한국어' },
      { code: 'zh', name: '中文 (简体)' },
      { code: 'ja', name: '日本語' },
    ];
    const pickLanguage = async (lang: 'en' | 'ko' | 'zh' | 'ja') => {
      setLanguage(lang);
      await saveAppSettings({ language: lang });
      setScreen('settings');
    };
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setScreen('settings')}>
            <Text style={[styles.headerAction, { color: THEME.primary }]}>{t('settings_back')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('lang_sel_title')}</Text>
          <View style={{ width: 48 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 24 + insets.bottom }}>
          <Text style={{ color: THEME.textMuted, fontSize: 14, marginBottom: 20, lineHeight: 22 }}>
            {t('lang_sel_desc')}
          </Text>
          {LANGS.map((lang) => {
            const active = language === lang.code;
            return (
              <TouchableOpacity
                key={lang.code}
                activeOpacity={0.7}
                onPress={() => pickLanguage(lang.code)}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                  backgroundColor: THEME.cardBg,
                  padding: 18,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: active ? THEME.primary : THEME.border,
                }}
              >
                <Text style={{ color: THEME.text, fontSize: 16, fontWeight: '600' }}>{lang.name}</Text>
                {active && <Text style={{ color: THEME.primary, fontSize: 16, fontWeight: 'bold' }}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  // ── 1.5 ONBOARDING SCREEN ──────────────────────────────
  if (screen === 'onboarding') {
    const allChecked = onboardingChecks.every(Boolean);
    const toggleCheck = (index: number) => {
      const next = [...onboardingChecks];
      next[index] = !next[index];
      setOnboardingChecks(next);
    };

    const handleStart = async () => {
      if (!allChecked) return;
      await saveAppSettings({ advancedMode, hasCompletedOnboarding: true });
      // Check security state once more, then call unlock if fine
      const secured = await checkSecurity();
      if (secured) {
        unlock();
      } else {
        setScreen('no_security');
      }
    };

    const clauses = [
      t('onboarding_clause_1'),
      t('onboarding_clause_2'),
      t('onboarding_clause_3'),
      t('onboarding_clause_4'),
      t('onboarding_clause_5'),
      t('onboarding_clause_6'),
    ];

    return (
      <SafeScreen style={{ backgroundColor: THEME.background }}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('onboarding_title')}</Text>
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
        >
          <Text style={{ color: THEME.textMuted, fontSize: 14, marginBottom: 24, lineHeight: 22 }}>
            {t('onboarding_intro')}
          </Text>
          {clauses.map((clause, idx) => {
            const isChecked = onboardingChecks[idx];
            return (
              <TouchableOpacity
                key={idx}
                activeOpacity={0.7}
                onPress={() => toggleCheck(idx)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  marginBottom: 16,
                  backgroundColor: THEME.cardBg,
                  padding: 16,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: isChecked ? THEME.primary : THEME.border
                }}
              >
                <View style={{
                  width: 24, height: 24, borderRadius: 12, borderWidth: 2, 
                  borderColor: isChecked ? THEME.primary : THEME.textMuted,
                  alignItems: 'center', justifyContent: 'center', marginRight: 12,
                  backgroundColor: isChecked ? THEME.primary : 'transparent'
                }}>
                  {isChecked && <Text style={{ color: '#000', fontWeight: 'bold', fontSize: 14 }}>✓</Text>}
                </View>
                <Text style={{ flex: 1, color: THEME.text, fontSize: 14, lineHeight: 22 }}>
                  {clause}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <View style={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 24 + insets.bottom, backgroundColor: THEME.background, borderTopWidth: 1, borderTopColor: THEME.border }}>
          <TouchableOpacity
            style={[styles.submitButton, !allChecked && { opacity: 0.5 }]}
            disabled={!allChecked}
            onPress={handleStart}
          >
            <Text style={styles.submitButtonText}>{t('onboarding_agree_btn')}</Text>
          </TouchableOpacity>
        </View>
      </SafeScreen>
    );
  }

  // ── 2. NO SECURITY SCREEN ─────────────────────────────
  // ── Rooted-device block screen (cannot be dismissed) ─────────────────
  if (screen === 'blocked') {
    return (
      <View style={styles.center}>
        <Text style={styles.lockTitle}>{t('security_risk_title')}</Text>
        <Text style={styles.lockSubtitle}>
          {t('security_risk_body')}
        </Text>
      </View>
    );
  }

  if (screen === 'no_security') {
    const handlePress = async () => {
      // Force a fresh security-state check at the moment the button is pressed
      const currentSecured = await checkSecurity();
      if (currentSecured) {
        // Settings complete -> switch to loading screen, then request unlock after 1s
        setScreen('loading');
        setTimeout(() => {
          unlock();
        }, 1000);
      } else {
        // Not set up yet -> go to the settings screen
        Linking.sendIntent('android.app.action.SET_NEW_PASSWORD');
      }
    };

    return (
      <View style={styles.center}>
        <Text style={styles.logoEmoji}>🔓</Text>
        <Text style={styles.lockTitle}>{t('security_req_title')}</Text>
        <Text style={styles.lockSubtitle}>
          {t('security_req_body')}
        </Text>
        {isCheckingSecurity ? (
          <View style={{ marginTop: 32, alignItems: 'center', height: 48, justifyContent: 'center' }}>
            <ActivityIndicator color={THEME.primary} size="small" />
            <Text style={{ color: 'rgba(255, 255, 255, 0.6)', marginTop: 8, fontSize: 13, fontWeight: '500' }}>
              {t('security_req_checking')}
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.btn, { marginTop: 32, width: '80%' }]}
            onPress={handlePress}
          >
            <Text style={styles.btnText}>
              {isSecured ? t('security_req_btn_start') : t('security_req_btn_setup')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ── 3. AUTH LOCK SCREEN ───────────────────────────────
  if (screen === 'lock') {
    return (
      <View style={styles.lockContainer}>
        <View style={styles.lockContent}>
          <View style={styles.lockIconCircle}>
            <Text style={styles.lockIconEmoji}>🔐</Text>
          </View>
          <Text style={styles.lockTitle}>{t('lock_screen_title')}</Text>
          <Text style={styles.lockSubtitle}>{t('lock_screen_subtitle')}</Text>

          {authError && (
            <View style={styles.lockErrorContainer}>
              <Text style={styles.lockErrorText}>{authError}</Text>
            </View>
          )}
        </View>
        <View style={styles.lockBottomContainer}>
          <TouchableOpacity style={styles.lockButton} onPress={unlock}>
            <Text style={styles.lockButtonText}>{t('lock_screen_btn')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── 4. HOME SCREEN (DASHBOARD) ────────────────────────
  if (screen === 'home') {
    const activeWallet = wallets[activeWalletIndex];

    return (
      <View style={styles.container}>
        {/* Top header area */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            BTCMobick <Text style={styles.headerTitleHighlight}>Watch-Only</Text>
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity
              onPress={() => { setAddLabel(''); setAddZpub(''); setAddError(null); setScreen('add_wallet'); }}
              style={{ padding: 4, marginRight: 16 }}
            >
              <PlusIcon color={THEME.text} size={20} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setScreen('settings')}
              style={{ padding: 4 }}
            >
              {/* U+2699 gear + U+FE0E (text variation selector) to force the line glyph instead of the color emoji */}
              <Text style={{ fontSize: 20, color: THEME.text }}>{'⚙︎'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {wallets.length === 0 ? (
          <ScrollView
            style={styles.dashboardContainer}
            contentContainerStyle={[styles.dashboardContentContainer, { justifyContent: 'center', alignItems: 'center', flex: 1 }]}
          >
            <WalletOutlineIcon size={56} color={THEME.textMuted} />
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: THEME.text, marginBottom: 8 }}>{t('home_empty_title')}</Text>
            <Text textBreakStrategy="balanced" style={{ fontSize: 14, color: THEME.textMuted, textAlign: 'center', paddingHorizontal: 40, marginBottom: 24 }}>
              {t('home_empty_body')}
            </Text>
            <TouchableOpacity
              style={[styles.submitButton, { paddingHorizontal: 24, height: 44, borderRadius: 22 }]}
              onPress={() => { setAddLabel(''); setAddZpub(''); setAddError(null); setScreen('add_wallet'); }}
            >
              <Text style={styles.submitButtonText}>{t('home_btn_add_wallet')}</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : (
          <ScrollView
            style={styles.dashboardContainer}
            contentContainerStyle={[styles.dashboardContentContainer, { paddingBottom: 16 + insets.bottom }]}
            showsVerticalScrollIndicator={false}
          >
            {/* Dashboard refresh bar */}
            <View style={[styles.dashboardHeaderRow, { paddingHorizontal: 20, marginTop: 10, marginBottom: 8 }]}>
              <Text style={[styles.sectionHeader, { marginTop: 0, marginBottom: 0 }]}>{t('home_wallet_cards')}</Text>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center' }}
                onPress={handleRefresh}
                disabled={isRefreshing}
              >
                {isRefreshing ? (
                  <ActivityIndicator size="small" color={THEME.primary} style={{ marginRight: 6 }} />
                ) : (
                  <Text style={styles.refreshText}>{t('modal_refresh')}</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Sliding wallet-card carousel */}
            <ScrollView
              ref={carouselRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => {
                const contentOffset = e.nativeEvent.contentOffset.x;
                const index = Math.round(contentOffset / screenWidth);
                if (index >= 0 && index < wallets.length) {
                  setActiveWalletIndex(index);
                }
              }}
              style={styles.carouselScrollView}
            >
              {wallets.map((item) => {
                const cardTheme = getWalletCardTheme(item.zpub);
                const isHdCard = isXpubKey(item.zpub);
                return (
                <View
                  key={item.id}
                  style={[
                    styles.carouselCard,
                    {
                      width: screenWidth - 40,
                      marginHorizontal: 20,
                      backgroundColor: cardTheme.bg,
                    }
                  ]}
                >
                  <View style={[styles.cardGlow1, { backgroundColor: cardTheme.glow1 }]} />
                  <View style={[styles.cardGlow2, { backgroundColor: cardTheme.glow2 }]} />

                  <View style={styles.cardHeaderRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      <View style={styles.cardBadge}>
                        <Text style={styles.cardBadgeText}>{getWalletBadgeText(item.zpub)}</Text>
                      </View>
                      <Text style={[styles.cardAliasName, { marginLeft: 8, flex: 1 }]} numberOfLines={1}>
                        {item.label}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setWalletMenuFor(item)}
                      style={{ paddingLeft: 12, paddingVertical: 4 }}
                    >
                      <Text style={{ fontSize: 20, color: '#FFF', fontWeight: 'bold' }}>⋮</Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    onPress={() => setCurrencyMode(prev => prev === 'USD' ? 'KRW' : 'USD')}
                    activeOpacity={0.8}
                    style={{ flexDirection: 'row', alignItems: 'baseline', marginVertical: 6 }}
                  >
                    <Text style={[styles.cardKRWBalance, { marginVertical: 0 }]}>
                      {getFormattedTotalBalance()}
                    </Text>
                    <Text style={{ fontSize: 9, color: 'rgba(255, 255, 255, 0.4)', marginLeft: 6 }}>
                      (via CoinGecko)
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.cardAddressRow}>
                    <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', marginBottom: 2 }}>
                      {t('home_public_address')}
                    </Text>
                    {isHdCard ? (
                      <Text style={[styles.cardAddressText, { opacity: 0.8, fontSize: 11 }]}>
                        {t('home_hd_card_addr_notice')}
                      </Text>
                    ) : (
                      <TouchableOpacity
                        style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%' }}
                        onPress={() => copyAddress(item.zpub)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[styles.cardAddressText, { flexShrink: 1 }]}
                          numberOfLines={1}
                          ellipsizeMode="middle"
                        >
                          {item.zpub}
                        </Text>
                        <View style={{ marginLeft: 6 }}>
                          <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <Rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <Path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </Svg>
                        </View>
                      </TouchableOpacity>
                    )}
                  </View>

                </View>
                );
              })}
            </ScrollView>

            {/* Page dots */}
            <View style={styles.indicatorContainer}>
              {wallets.map((_, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.indicatorDot,
                    idx === activeWalletIndex ? styles.indicatorDotActive : {}
                  ]}
                />
              ))}
            </View>

            {/* Asset list header */}
            <View style={[styles.assetHeaderRow, { paddingHorizontal: 20 }]}>
              <Text style={styles.assetSectionTitle}>{t('home_my_assets')}</Text>
              <TouchableOpacity
                onPress={() => setEditAssetsModalVisible(true)}
                style={{ padding: 8, marginRight: -8 }}
              >
                <FilterIcon color={THEME.textMuted} size={18} />
              </TouchableOpacity>
            </View>

            <View style={[styles.assetListContainer, { paddingHorizontal: 20 }]}>
              {getSortedVisibleAssets(activeWallet?.zpub ?? '', activeWallet?.id ?? '').map((asset) => {
                const bal = balances[asset.id];
                const netColor = NETWORKS[asset.id].color;
                const badge = getChainBadge(asset.network);
                
                return (
                  <TouchableOpacity
                    key={asset.id}
                    style={styles.assetRow}
                    onPress={() => {
                      setSelectedAssetKey(asset.id);
                      setShowCoin(prev => ({ ...prev, [asset.id]: true })); // default to large unit on detail entry
                      setAssetDetailsModalVisible(true);
                    }}
                  >
                    <View style={styles.assetIconContainer}>
                      <View style={styles.assetIconImageWrapper}>
                        <Image
                          source={ASSET_LOGOS[asset.ticker] || ASSET_LOGOS.default}
                          style={styles.assetIconImage}
                        />
                        {!ASSET_LOGOS[asset.ticker] && (
                          <Text style={styles.assetIconTextOverlay}>
                            {asset.ticker.charAt(0)}
                          </Text>
                        )}
                      </View>
                      {badge && (
                        <View style={styles.assetChainBadge}>
                          <Image source={badge} style={styles.assetChainBadgeImg} />
                        </View>
                      )}
                    </View>
                    <View style={styles.assetNameCol}>
                      <Text style={styles.assetTitle}>{asset.name}</Text>
                      <Text style={styles.assetSubTitle}>{asset.network}</Text>
                    </View>
                    <View style={styles.assetValueCol}>
                      {bal.loading && bal.confirmedSat === null ? (
                        <ActivityIndicator size="small" color={netColor} />
                      ) : bal.error ? (
                        <Text style={[styles.assetBalanceVal, { fontSize: 12, color: THEME.danger }]}>{t('error_scan')}</Text>
                      ) : (
                        <>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            {/* keep the cached value visible but show a small spinner while re-syncing */}
                            {bal.loading && <ActivityIndicator size="small" color={netColor} style={{ marginRight: 6 }} />}
                            <Text style={styles.assetBalanceVal}>
                              {bal.confirmedSat !== null
                                ? coinAmountStr(spendableSat(bal), asset.id)
                                : '—'}
                            </Text>
                          </View>
                          <Text style={styles.assetTickerText}>{asset.ticker}</Text>
                        </>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        )}

        {/* Wallet edit modal */}
        <EditWalletModal
          visible={editWalletModalVisible}
          walletAlias={newWalletAlias}
          onChangeText={setNewWalletAlias}
          onSave={handleRenameWallet}
          onClose={() => { setEditWalletModalVisible(false); setWalletToEdit(null); }}
        />

        {/* Wallet card menu */}
        <Modal
          visible={!!walletMenuFor}
          transparent
          animationType="fade"
          onRequestClose={() => setWalletMenuFor(null)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setWalletMenuFor(null)}
          >
            <View style={[styles.modalContainer, { paddingVertical: 8 }]}>
              <TouchableOpacity
                style={styles.walletMenuItem}
                onPress={() => {
                  const w = walletMenuFor;
                  setWalletMenuFor(null);
                  if (w) { setWalletToEdit(w); setNewWalletAlias(w.label); setEditWalletModalVisible(true); }
                }}
              >
                <Text style={styles.walletMenuText}>{t('modal_wallet_label')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.walletMenuItem}
                onPress={() => {
                  const w = walletMenuFor;
                  setWalletMenuFor(null);
                  if (w) handleDeleteWallet(w);
                }}
              >
                <Text style={[styles.walletMenuText, { color: '#FF6B6B' }]}>{t('home_menu_delete_wallet')}</Text>
              </TouchableOpacity>
              {walletMenuFor && isXpubKey(walletMenuFor.zpub) && (
                <TouchableOpacity
                  style={styles.walletMenuItem}
                  onPress={() => {
                    const w = walletMenuFor;
                    setWalletMenuFor(null);
                    setXpubModalFor(w);
                  }}
                >
                  <Text style={styles.walletMenuText}>{t('home_menu_show_xpub')}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.walletMenuItem, { borderBottomWidth: 0 }]}
                onPress={() => setWalletMenuFor(null)}
              >
                <Text style={[styles.walletMenuText, { color: THEME.textMuted }]}>{t('close')}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Extended public key (xpub) view modal */}
        <Modal
          visible={!!xpubModalFor}
          transparent
          animationType="fade"
          onRequestClose={() => setXpubModalFor(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContainer, { padding: 20, gap: 12 }]}>
              <Text style={styles.modalTitle}>{t('home_xpub_modal_title')}</Text>
              <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 18 }}>
                {t('home_xpub_modal_desc')}
              </Text>
              <View style={{ marginVertical: 8 }}>
                <Text style={{ color: THEME.text, fontSize: 12, fontFamily: 'monospace', lineHeight: 18 }}>
                  {xpubModalFor?.zpub}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.submitButton, { backgroundColor: THEME.border, marginTop: 12 }]}
                onPress={() => setXpubModalFor(null)}
              >
                <Text style={[styles.submitButtonText, { color: '#FFF' }]}>{t('close')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Asset details & action selection modal */}
        {selectedAssetKey && activeWallet && (
          <AssetDetailsModal
            visible={assetDetailsModalVisible}
            assetKey={selectedAssetKey}
            walletLabel={activeWallet.label}
            balance={balances[selectedAssetKey]}
            onClose={() => { setAssetDetailsModalVisible(false); setSelectedAssetKey(null); }}
            onRefresh={() => refreshAssetBalance(selectedAssetKey)}
            onDeepRescan={() => deepRescanAssetBalance(selectedAssetKey)}
            isRescanning={assetRescanLoading}
            onReceive={() => openReceive(selectedAssetKey)}
            onAddresses={() => openAddresses(selectedAssetKey)}
            onTxHistory={() => openTxHistory(selectedAssetKey)}
            onCreatePsbt={() => openCreatePsbt(selectedAssetKey)}
            onBroadcastTx={() => openBroadcastTx(selectedAssetKey)}
            onToggleUnit={() => toggleUnit(selectedAssetKey)}
            address={activeWallet.zpub}
            showCoin={showCoin[selectedAssetKey]}
            canCreatePsbt={isXpubKey(activeWallet.zpub) && advancedMode}
            isSingleAddress={!isEvmKey(activeWallet.zpub) && !isXpubKey(activeWallet.zpub)}
            marketPrices={marketPrices}
          />
        )}

        {/* Asset visibility & order edit modal */}
        {activeWallet && (
          <EditAssetsModal
            visible={editAssetsModalVisible}
            onClose={() => setEditAssetsModalVisible(false)}
            zpub={activeWallet.zpub}
            assetVisibility={allVisibility[activeWallet.id] ?? DEFAULT_VISIBILITY}
            assetOrder={allOrder[activeWallet.id] ?? DEFAULT_ORDER}
            onToggleVisibility={toggleAssetVisibility}
            onMoveAsset={moveAsset}
          />
        )}
      </View>
    );
  }

  // ── 5. ADD WALLET SCREEN ──────────────────────────────
  if (screen === 'add_wallet') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setScreen('home')}>
            <Text style={[styles.headerAction, { color: THEME.primary }]}>{t('settings_back')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('add_wallet_title')}</Text>
          <View style={{ width: 48 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 20 + insets.bottom }}>
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>{t('add_wallet_name_label')}</Text>
            <TextInput
              style={styles.input}
              value={addLabel}
              onChangeText={setAddLabel}
              placeholder={t('add_wallet_name_placeholder')}
              placeholderTextColor="#555"
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.fieldLabel}>{t('add_wallet_pubkey_label')}</Text>
            <TextInput
              style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]}
              value={addZpub}
              onChangeText={setAddZpub}
              placeholder={t('add_wallet_pubkey_placeholder')}
              placeholderTextColor="#555"
              autoCapitalize="none"
              autoCorrect={false}
              multiline
            />
            <TouchableOpacity
              style={styles.scanBtn}
              onPress={() => openScanner('zpub')}
              activeOpacity={0.8}
            >
              <Text style={styles.scanBtnText}>{t('add_wallet_scan_qr')}</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.infoText, { color: THEME.text }]}>
            <Text style={{ color: THEME.danger }}>{t('add_wallet_caution_title')}</Text>{t('add_wallet_caution_body')}
          </Text>

          <Text style={[styles.infoText, { color: THEME.textMuted }]}>
            {t('add_wallet_auth_init_warn')}
          </Text>

          {addError && (
            <View style={[styles.card, styles.errorCard]}>
              <Text style={styles.errorText} selectable={true}>{addError}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.submitButton, (!addZpub.trim() || addLoading) && styles.btnDisabled, { marginTop: 10 }]}
            onPress={handleAddWallet}
            disabled={!addZpub.trim() || addLoading}
          >
            {addLoading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color="#000" style={{ marginRight: 10 }} />
                <Text style={styles.submitButtonText}>{t('add_wallet_sync_loading')}</Text>
              </View>
            ) : (
              <Text style={styles.submitButtonText}>{t('add_wallet_submit')}</Text>
            )}
          </TouchableOpacity>

          {addLoading && (
            <Text style={{ color: THEME.primary, textAlign: 'center', marginTop: 12, fontSize: 13, lineHeight: 18 }}>
              {t('add_wallet_sync_desc')}
            </Text>
          )}
        </ScrollView>

        {/* QR scanner modal */}
        <Modal visible={showScanner} animationType="slide" onRequestClose={() => setShowScanner(false)}>
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            {(cameraDevice ?? scanDevice) ? (
              <Camera
                style={StyleSheet.absoluteFill}
                device={(cameraDevice ?? scanDevice)!}
                isActive={showScanner}
                codeScanner={codeScanner}
              />
            ) : (
              <View style={styles.center}>
                <ActivityIndicator color={THEME.primary} />
                <Text style={{ color: THEME.text, marginTop: 10 }}>{t('broadcast_camera_loading')}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.scanCancelBtn, { bottom: 48 + insets.bottom }]}
              onPress={() => setShowScanner(false)}
            >
              <Text style={styles.scanCancelText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      </View>
    );
  }

  // ── 5-b. SETTINGS SCREEN ──────────────────────────────
  if (screen === 'settings') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setScreen('home')}>
            <Text style={[styles.headerAction, { color: THEME.primary }]}>{t('settings_back')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('settings_title')}</Text>
          <View style={{ width: 48 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingVertical: 10, paddingBottom: 10 + insets.bottom }}>
          <TouchableOpacity 
            style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 18, paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: THEME.border }}
            onPress={() => setScreen('settings_language')}
          >
            <Text style={{ color: THEME.text, fontSize: 16 }}>{t('settings_menu_lang')}</Text>
            <Text style={{ color: THEME.textMuted, fontSize: 18 }}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 18, paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: THEME.border }}
            onPress={() => setScreen('settings_advanced')}
          >
            <Text style={{ color: THEME.text, fontSize: 16 }}>{t('settings_menu_advanced')}</Text>
            <Text style={{ color: THEME.textMuted, fontSize: 18 }}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 18, paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: THEME.border }}
            onPress={() => setScreen('settings_about')}
          >
            <Text style={{ color: THEME.text, fontSize: 16 }}>{t('settings_menu_about')}</Text>
            <Text style={{ color: THEME.textMuted, fontSize: 18 }}>›</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  if (screen === 'settings_advanced') {
    const toggleAdvanced = (next: boolean) => {
      setAdvancedMode(next);
      saveAppSettings({ advancedMode: next });
    };
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setScreen('settings')}>
            <Text style={[styles.headerAction, { color: THEME.primary }]}>{t('settings_back')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('settings_menu_advanced')}</Text>
          <View style={{ width: 48 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 20 + insets.bottom }}>
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.fieldLabel}>{t('settings_advanced_enable_label')}</Text>
              </View>
              <Switch
                value={advancedMode}
                onValueChange={toggleAdvanced}
                trackColor={{ false: THEME.border, true: THEME.primary }}
                thumbColor="#FFFFFF"
              />
            </View>
          </View>
          {advancedMode && (
            <Text style={styles.infoText}>
              {t('settings_advanced_enable_desc')}
            </Text>
          )}
        </ScrollView>
      </View>
    );
  }

  if (screen === 'settings_about') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setScreen('settings')}>
            <Text style={[styles.headerAction, { color: THEME.primary }]}>{t('settings_back')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('settings_about_title')}</Text>
          <View style={{ width: 48 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 20 + insets.bottom }}>
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ color: THEME.text }}>{t('about_version_label')}</Text>
              <Text style={{ color: THEME.textMuted }}>1.0.0 (Pre-release)</Text>
            </View>

            <TouchableOpacity 
              style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}
              onPress={() => Alert.alert(t('about_desc_title'), t('about_desc_body'))}
            >
              <Text style={{ color: THEME.text }}>{t('about_desc_title')}</Text>
              <Text style={{ color: THEME.textMuted, fontSize: 16 }}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}
              onPress={() => Alert.alert(t('about_auth_title'), t('about_auth_body'))}
            >
              <Text style={{ color: THEME.text }}>{t('about_auth_title')}</Text>
              <Text style={{ color: THEME.textMuted, fontSize: 16 }}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}
              onPress={() => Linking.openURL(GITHUB_REPO_URL).catch(() => Alert.alert(t('error'), t('error_browser')))}
            >
              <Text style={{ color: THEME.text }}>{t('settings_about_github')}</Text>
              <Text style={{ color: THEME.textMuted, fontSize: 16 }}>↗</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}
              onPress={() => Alert.alert(t('about_license_title'), t('about_license_body'))}
            >
              <Text style={{ color: THEME.text }}>{t('about_license_title')}</Text>
              <Text style={{ color: THEME.textMuted, fontSize: 16 }}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}
              onPress={() => setScreen('settings_licenses')}
            >
              <Text style={{ color: THEME.text }}>{t('about_oss_title')}</Text>
              <Text style={{ color: THEME.textMuted, fontSize: 16 }}>›</Text>
            </TouchableOpacity>


          </View>
        </ScrollView>
      </View>
    );
  }

  if (screen === 'settings_licenses') {
    let licensesData: any = {};
    try {
      licensesData = require('./direct-licenses.json');
    } catch (e) {
      licensesData = { "Error": { licenses: "No licenses found." } };
    }
    const licenseList = Object.keys(licensesData).map(key => ({
      name: key,
      ...licensesData[key]
    }));

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setScreen('settings_about')} style={{ zIndex: 1 }}>
            <Text style={[styles.headerAction, { color: THEME.primary }]}>{t('settings_back')}</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { position: 'absolute', left: 0, right: 0, textAlign: 'center' }]} pointerEvents="none">{t('settings_licenses_title')}</Text>
        </View>
        <FlatList
          data={licenseList}
          keyExtractor={(item) => item.name}
          contentContainerStyle={{ padding: 20, paddingBottom: 20 + insets.bottom }}
          renderItem={({ item }) => (
            <TouchableOpacity 
              style={[styles.card, { marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
              onPress={() => Alert.alert(item.name + ' License', item.licenseText || `License Type: ${item.licenses}\n\nThis package is open source and provided under the ${item.licenses} license.`)}
            >
              <View>
                <Text style={[styles.fieldLabel, { color: THEME.text, marginBottom: 4 }]}>{item.name}</Text>
                <Text style={{ color: THEME.textMuted, fontSize: 12 }}>{item.licenses} License</Text>
              </View>
              <Text style={{ color: THEME.textMuted, fontSize: 18 }}>›</Text>
            </TouchableOpacity>
          )}
        />
      </View>
    );
  }

  // ── 6. TX HISTORY SCREEN ──────────────────────────────
  if (screen === 'tx_history' && txNetwork) {
    const net = NETWORKS[txNetwork];
    const txActiveWallet = wallets[activeWalletIndex];
    const txIsSingleAddr = !!txActiveWallet && !isEvmKey(txActiveWallet.zpub) && !isXpubKey(txActiveWallet.zpub);
    const txWid = balances[txNetwork].walletId;
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={backToAssetModal} style={{ zIndex: 1 }}>
            <Text style={[styles.headerAction, { color: net.color }]}>{t('settings_back')}</Text>
          </TouchableOpacity>
          <Text
            style={[styles.headerTitle, { position: 'absolute', left: 0, right: 0, textAlign: 'center' }]}
            pointerEvents="none"
          >
            {t('history_title')}
          </Text>
          <TouchableOpacity
            onPress={refreshTxHistory}
            disabled={txRefreshing}
            style={{ flexDirection: 'row', alignItems: 'center', zIndex: 1 }}
          >
            {txRefreshing ? (
              <ActivityIndicator size="small" color={net.color} />
            ) : (
              <Text style={[styles.refreshText, { color: net.color }]}>{t('history_refresh')}</Text>
            )}
          </TouchableOpacity>
        </View>

        {(txLoading || (txList.length === 0 && (balances[txNetwork]?.loading || assetRescanLoading))) ? (
          <View style={styles.center}>
            <ActivityIndicator color={net.color} size="large" />
            <Text style={[styles.scanningText, { marginTop: 12 }]}>{t('history_syncing')}</Text>
          </View>
        ) : txList.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>{t('history_empty')}</Text>
            <Text style={[styles.infoText, { marginTop: 20, textAlign: 'center' }]}>
              {t('history_empty_hint')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={txList}
            keyExtractor={item => item.txid}
            contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 16 + insets.bottom }}
            ListFooterComponent={
              txIsSingleAddr ? (
                <Text style={[styles.infoText, { textAlign: 'center', marginTop: 8 }]}>
                  <Text style={{ color: THEME.danger }}>※ </Text>
                  {t('history_reuse_warn')}
                </Text>
              ) : null
            }
            renderItem={({ item }) => {
              const net_sat = item.receivedSat - item.sentSat;
              const isPositive = net_sat >= 0;
              const pending = item.blockHeight == null;
              const dirColor = isPositive ? THEME.success : THEME.danger;
              const confs = (!pending && txTipHeight != null && item.blockHeight != null)
                ? txTipHeight - item.blockHeight + 1 : null;
              return (
                <TouchableOpacity
                  style={styles.txCard}
                  activeOpacity={0.7}
                  onPress={() => { setSelectedTx(item); setScreen('tx_detail'); }}
                >
                  {/* Left: amount + direction arrow · Right: confirmation status / time */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
                      <Text style={[styles.txAmount, { color: dirColor }]} numberOfLines={1}>
                        {isPositive ? '+' : '−'}{formatAmount(Math.abs(net_sat), showCoin[txNetwork!], txNetwork!)}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', marginLeft: 10 }}>
                      {pending ? (
                        <Text style={[styles.txBlock, { color: THEME.warning, fontWeight: 'bold' }]}>{t('history_waiting')}</Text>
                      ) : confs != null ? (
                        <Text style={[styles.txBlock, { color: confs >= 6 ? THEME.success : THEME.warning }]}>
                          {t('history_confirm_badge', { count: confs.toLocaleString() })}
                        </Text>
                      ) : (
                        <Text style={styles.txBlock}>{t('history_confirmed')}</Text>
                      )}
                      {item.confirmedAt && <Text style={styles.txDate}>{formatDate(item.confirmedAt)}</Text>}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>
    );
  }

  // ── 6-b. TX DETAIL SCREEN ─────────────────────────────
  if (screen === 'tx_detail' && txNetwork && selectedTx) {
    const net = NETWORKS[txNetwork];
    const item = selectedTx;
    const net_sat = item.receivedSat - item.sentSat;
    const isPositive = net_sat >= 0;
    const pending = item.blockHeight == null;
    const dirColor = isPositive ? THEME.success : THEME.danger;
    const confs = (!pending && txTipHeight != null && item.blockHeight != null)
      ? txTipHeight - item.blockHeight + 1 : null;
    const url = explorerTxUrl(txNetwork, item.txid);
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setScreen('tx_history')} style={{ zIndex: 1 }}>
            <Text style={[styles.headerAction, { color: net.color }]}>{t('settings_back')}</Text>
          </TouchableOpacity>
          <Text
            style={[styles.headerTitle, { position: 'absolute', left: 0, right: 0, textAlign: 'center' }]}
            pointerEvents="none"
          >
            {t('detail_title')}
          </Text>
          <View style={{ width: 48 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 20 + insets.bottom }}>
          {/* Direction + amount */}
          <View style={[styles.card, { alignItems: 'center', gap: 6 }]}>
            <Text style={[styles.txDirection, { color: dirColor, fontSize: 15 }]}>
              {isPositive ? t('history_incoming') : t('history_outgoing')}
            </Text>
            <Text style={{ color: dirColor, fontSize: 26, fontWeight: 'bold' }}>
              {isPositive ? '+' : '−'}{formatAmount(Math.abs(net_sat), showCoin[txNetwork], txNetwork)}
            </Text>
            {pending ? (
              <Text style={{ color: THEME.warning, fontSize: 13, fontWeight: 'bold' }}>{t('detail_pending_full')}</Text>
            ) : (
              <Text style={{ color: confs != null && confs >= 6 ? THEME.success : THEME.warning, fontSize: 13, fontWeight: 'bold' }}>
                {confs != null ? t('history_confirm_badge', { count: confs.toLocaleString() }) : t('detail_confirmed')}
              </Text>
            )}
          </View>

          {/* Details */}
          <View style={[styles.card, { gap: 8 }]}>
            <View style={styles.psbtRow}>
              <Text style={styles.psbtRowLabel}>{t('detail_status')}</Text>
              <Text style={styles.psbtRowVal}>
                {pending ? t('detail_status_mempool') : confs != null ? t('detail_status_confirmed', { count: confs.toLocaleString() }) : t('detail_status_confirmed_simple')}
              </Text>
            </View>
            {item.confirmedAt && (
              <View style={styles.psbtRow}>
                <Text style={styles.psbtRowLabel}>{t('detail_date')}</Text>
                <Text style={styles.psbtRowVal}>{formatDate(item.confirmedAt)}</Text>
              </View>
            )}
            {item.blockHeight != null && (
              <View style={styles.psbtRow}>
                <Text style={styles.psbtRowLabel}>{t('detail_block_height')}</Text>
                <Text style={styles.psbtRowVal}>#{item.blockHeight.toLocaleString()}</Text>
              </View>
            )}
            <View style={styles.psbtRow}>
              <Text style={styles.psbtRowLabel}>{t('detail_received')}</Text>
              <Text style={styles.psbtRowVal}>{formatAmount(item.receivedSat, showCoin[txNetwork], txNetwork)}</Text>
            </View>
            <View style={styles.psbtRow}>
              <Text style={styles.psbtRowLabel}>{t('detail_sent')}</Text>
              <Text style={styles.psbtRowVal}>{formatAmount(item.sentSat, showCoin[txNetwork], txNetwork)}</Text>
            </View>
          </View>

          {/* txid */}
          <View style={[styles.card, { gap: 6 }]}>
            <Text style={styles.fieldLabel}>{t('detail_txid')}</Text>
            <TouchableOpacity
              onPress={() => { Clipboard.setString(item.txid); ToastAndroid.show(t('detail_toast_copied'), ToastAndroid.SHORT); }}
              activeOpacity={0.6}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <Text
                style={{ color: THEME.text, fontSize: 13, fontWeight: '600', flexShrink: 1, lineHeight: 18 }}
                numberOfLines={1}
                ellipsizeMode="middle"
              >{item.txid}</Text>
              <View style={{ marginLeft: 6 }}>
                <Svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <Rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <Path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </Svg>
              </View>
            </TouchableOpacity>
          </View>

          {/* View in explorer */}
          {url && (
            <TouchableOpacity
              style={[styles.submitButton, { backgroundColor: net.color }]}
              onPress={() => Linking.openURL(url).catch(() => Alert.alert(t('error'), t('error_browser')))}
            >
              <Text style={[styles.submitButtonText, { color: '#000' }]}>{t('detail_explorer')}</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    );
  }

  // ── X. RECEIVE SCREEN (QR CODE) ────────────────────
  if (screen === 'receive' && receiveNetwork) {
    const net = NETWORKS[receiveNetwork];
    const isHd = activeWalletIndex >= 0 && isXpubKey(wallets[activeWalletIndex]?.zpub || '');

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => backToAssetModal()}>
            <Text style={[styles.headerAction, { color: net.color }]}>{t('settings_back')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{net.label} {t('receive_title')}</Text>
          <View style={{ width: 60 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, alignItems: 'center', paddingBottom: 20 + insets.bottom }}>
          <View style={{ backgroundColor: '#FFF', padding: 16, borderRadius: 12, marginBottom: 20 }}>
            {receiveAddressStr ? (
              <QRCode
                value={receiveAddressStr}
                size={220}
                color="#000"
                backgroundColor="#FFF"
              />
            ) : (
              <View style={{ width: 220, height: 220, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color={net.color} />
              </View>
            )}
          </View>
          
          <Text style={{ fontSize: 13, color: THEME.textMuted, marginBottom: 8 }}>{t('receive_my_addr')}</Text>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: THEME.cardBg, padding: 16, borderRadius: 12, width: '100%', marginBottom: 20 }}
            onPress={() => receiveAddressStr && copyAddress(receiveAddressStr)}
            activeOpacity={0.7}
          >
            <Text style={{ flex: 1, color: THEME.text, fontSize: 15, fontFamily: 'monospace' }} selectable>
              {receiveAddressStr || t('receive_loading_addr')}
            </Text>
            <Text style={{ color: net.color, marginLeft: 10, fontWeight: 'bold' }}>{t('copy')}</Text>
          </TouchableOpacity>

          <View style={{ backgroundColor: 'rgba(255, 60, 60, 0.1)', padding: 16, borderRadius: 12, width: '100%', marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255, 60, 60, 0.3)' }}>
            <Text style={{ color: '#FF6B6B', fontSize: 14, fontWeight: 'bold', marginBottom: 4, textAlign: 'center' }}>
              {t('receive_caution_title')}
            </Text>
            <Text style={{ color: '#FF6B6B', fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
              {(() => {
                const [pre, post] = t('receive_warn_body').split('{network}');
                return (
                  <>
                    {pre}
                    <Text style={{ fontWeight: 'bold' }}>{net.network}</Text>
                    {post}
                  </>
                );
              })()}
            </Text>
          </View>

          {isHd && (
            <View style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', padding: 16, borderRadius: 12, width: '100%' }}>
              <Text style={{ color: THEME.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
                {t('receive_hd_notice')}
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  // ── 7. CREATE PSBT SCREEN (QR CODE) ────────────────────
  if (screen === 'create_psbt' && psbtNetwork) {
    const net = NETWORKS[psbtNetwork];
    const feeUnit = smallUnit(psbtNetwork);

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setScreen('home')}>
            <Text style={[styles.headerAction, { color: net.color }]}>{t('psbt_cancel')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('psbt_header_title', { ticker: net.ticker })}</Text>
          <View style={{ width: 48 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 20 + insets.bottom }}>
          <View style={[styles.card, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
            <Text style={styles.fieldLabel}>{t('psbt_available_label')}</Text>
            <Text style={{ color: net.color, fontSize: 16, fontWeight: 'bold' }}>
              {balances[psbtNetwork].confirmedSat !== null
                ? formatAmount(spendableSat(balances[psbtNetwork]), true, psbtNetwork)
                : '—'}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.fieldLabel}>{t('psbt_recipient_label')}</Text>
            <TextInput
              style={[styles.input, !!psbtResult && { opacity: 0.5 }]}
              value={psbtRecipient}
              onChangeText={(v) => { setPsbtRecipient(v); setPsbtNetworkConfirmed(false); }}
              editable={!psbtResult}
              placeholder={t('psbt_recipient_placeholder')}
              placeholderTextColor="#555"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.scanBtn, !!psbtResult && { opacity: 0.5 }]}
              onPress={() => openScanner('recipient')}
              disabled={!!psbtResult}
              activeOpacity={0.8}
            >
              <Text style={styles.scanBtnText}>{t('add_wallet_scan_qr')}</Text>
            </TouchableOpacity>
            <Text style={{ color: THEME.danger, fontSize: 13, marginTop: 8 }}>
              {t('psbt_network_warn', { network: net.network })}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.fieldLabel}>{t('psbt_amount_label', { ticker: net.ticker })}</Text>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <TextInput
                style={[styles.input, { flex: 1, marginTop: 0 }, !!psbtResult && { opacity: 0.5 }]}
                value={isMaxAmount ? t('psbt_max_full') : psbtAmount}
                editable={!isMaxAmount && !psbtResult}
                onChangeText={(t) => { if (isMaxAmount) setIsMaxAmount(false); setPsbtAmount(t); }}
                onFocus={() => { if (isMaxAmount) setIsMaxAmount(false); }}
                keyboardType="decimal-pad"
                placeholder={t('psbt_amount_placeholder', { ticker: net.ticker })}
                placeholderTextColor="#555"
              />
              <TouchableOpacity
                disabled={!!psbtResult}
                style={[
                  styles.feeTierBtn,
                  { marginTop: 0, paddingVertical: 14, paddingHorizontal: 16 },
                  isMaxAmount && { borderColor: net.color, backgroundColor: 'rgba(255,255,255,0.06)' },
                  !!psbtResult && { opacity: 0.5 },
                ]}
                onPress={() => { setIsMaxAmount(true); setPsbtAmount(''); }}
              >
                <Text style={[styles.feeTierLabel, isMaxAmount && { color: net.color }]}>MAX</Text>
              </TouchableOpacity>
            </View>
            {isMaxAmount && (
              <Text style={{ color: net.color, fontSize: 12, marginTop: 8 }}>
                {t('psbt_max_hint')}
              </Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.fieldLabel}>{t('psbt_fee_label', { unit: feeUnit })}</Text>

            {feeLoading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                <ActivityIndicator size="small" color={net.color} />
                <Text style={{ color: THEME.textMuted, fontSize: 12, marginLeft: 8 }}>{t('psbt_fee_loading')}</Text>
              </View>
            ) : feeEstimates ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 12 }}>
                {([
                  { key: 'fast', label: t('psbt_fee_fast'), val: feeEstimates.fastSatVb },
                  { key: 'normal', label: t('psbt_fee_normal'), val: feeEstimates.normalSatVb },
                  { key: 'slow', label: t('psbt_fee_slow'), val: feeEstimates.slowSatVb },
                ] as const).map(tier => {
                  const rate = Math.max(1, Math.round(tier.val));
                  const active = psbtFeeRate === String(rate);
                  return (
                    <TouchableOpacity
                      key={tier.key}
                      disabled={!!psbtResult}
                      style={[styles.feeTierBtn, active && { borderColor: net.color, backgroundColor: 'rgba(255,255,255,0.06)' }, !!psbtResult && { opacity: 0.5 }]}
                      onPress={() => setPsbtFeeRate(String(rate))}
                    >
                      <Text style={[styles.feeTierLabel, active && { color: net.color }]}>{tier.label}</Text>
                      <Text style={styles.feeTierVal}>{rate} {feeUnit}/vB</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}

            <TextInput
              style={[styles.input, !!psbtResult && { opacity: 0.5 }]}
              value={psbtFeeRate}
              onChangeText={setPsbtFeeRate}
              editable={!psbtResult}
              keyboardType="numeric"
              placeholder={t('psbt_fee_custom_placeholder', { unit: feeUnit })}
              placeholderTextColor="#555"
            />
            {!!psbtResult && (
              <Text style={{ color: THEME.textMuted, fontSize: 12, marginTop: 8 }}>
                {t('psbt_locked_hint')}
              </Text>
            )}
          </View>

          {psbtError && (
            <View style={[styles.card, styles.errorCard]}>
              <Text style={styles.errorText} selectable={true}>{psbtError}</Text>
            </View>
          )}

          {psbtVerifyError && (
            <View style={[styles.card, styles.errorCard]}>
              <Text style={[styles.errorText, { fontWeight: 'bold' }]}>{psbtVerifyError}</Text>
            </View>
          )}

          {psbtResult && (
            <>
              {/* Transaction summary — values decoded from the actual PSBT bytes */}
              <View style={[styles.card, { gap: 8 }]}>
                <Text style={styles.fieldLabel}>{t('psbt_summary_title')}</Text>
                {isMaxAmount && (
                  <Text style={{ color: net.color, fontSize: 13, fontWeight: 'bold' }}>
                    {t('psbt_send_all_note')}
                  </Text>
                )}
                <View style={styles.psbtRow}>
                  <Text style={styles.psbtRowLabel}>{t('psbt_row_recipient')}</Text>
                  <Text style={styles.psbtRowVal} numberOfLines={1} ellipsizeMode="middle">{psbtDecoded?.recipient ?? psbtRecipient}</Text>
                </View>
                <View style={styles.psbtRow}>
                  <Text style={styles.psbtRowLabel}>{t('psbt_row_amount')}</Text>
                  <Text style={styles.psbtRowVal}>
                    {psbtDecoded ? (psbtDecoded.amountSat / 100_000_000).toFixed(8) : psbtAmount} {net.ticker}
                  </Text>
                </View>
                <View style={styles.psbtRow}>
                  <Text style={styles.psbtRowLabel}>{t('psbt_row_rate')}</Text>
                  <Text style={styles.psbtRowVal}>{psbtFeeRate} {feeUnit}/vB</Text>
                </View>
                {psbtFeeSat !== null && (
                  <View style={styles.psbtRow}>
                    <Text style={styles.psbtRowLabel}>{t('psbt_row_est_fee')}</Text>
                    <Text style={styles.psbtRowVal}>
                      {(psbtFeeSat / 100_000_000).toFixed(8)} {net.ticker} ({psbtFeeSat.toLocaleString()} {feeUnit})
                    </Text>
                  </View>
                )}
                {psbtDecoded && psbtDecoded.changeSat > 0 && (
                  <View>
                    <View style={[styles.psbtRow, { borderTopWidth: 1, borderTopColor: '#333', paddingTop: 8, marginTop: 4 }]}>
                      <Text style={styles.psbtRowLabel}>{t('psbt_row_utxo_total')}</Text>
                      <Text style={styles.psbtRowVal}>
                        {((psbtDecoded.amountSat + psbtDecoded.feeSat + psbtDecoded.changeSat) / 100_000_000).toFixed(8)} {net.ticker}
                      </Text>
                    </View>
                    <View style={styles.psbtRow}>
                      <Text style={styles.psbtRowLabel}>{t('psbt_row_change')}</Text>
                      <Text style={styles.psbtRowVal}>
                        {(psbtDecoded.changeSat / 100_000_000).toFixed(8)} {net.ticker}
                      </Text>
                    </View>
                  </View>
                )}
                <Text style={{ color: '#22C55E', fontSize: 12, fontWeight: 'bold', marginTop: 4 }}>
                  {t('psbt_verified')}
                </Text>
              </View>

              {/* QR for offline signing */}
              <View style={[styles.card, { alignItems: 'center', gap: 12 }]}>
                <Text style={styles.fieldLabel}>{t('psbt_qr_title')}</Text>

                <View style={{ backgroundColor: '#FFF', padding: 12, borderRadius: 12 }}>
                  <QRCode
                    value={urParts.length > 0 ? urParts[currentURIndex] : psbtResult}
                    size={200}
                  />
                </View>

                {urParts.length > 1 && (
                  <Text style={{ color: THEME.primary, fontSize: 13, fontWeight: 'bold' }}>
                    {t('psbt_animating', { cur: currentURIndex + 1, total: urParts.length })}
                  </Text>
                )}

                <Text style={styles.infoText}>
                  {(() => {
                    const coldName = psbtNetwork === 'Bitcoin' ? 'Bitcoin' : psbtNetwork === 'Mobick' ? 'BTCMobick' : psbtNetwork === 'LaptopMining' ? 'LaptopMining' : '';
                    const [pre, post] = t('psbt_scan_notice').split('{network}');
                    return (
                      <>
                        {pre}
                        <Text style={{ color: 'red', fontWeight: 'bold' }}>{coldName}</Text>
                        {post}
                      </>
                    );
                  })()}
                </Text>
              </View>
            </>
          )}

          {!psbtResult && (
            <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 18 }}>
              💡 {t('psbt_info_warning')}
            </Text>
          )}
          {!psbtResult && (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setPsbtNetworkConfirmed(v => !v)}
              style={{
                flexDirection: 'row', alignItems: 'flex-start',
                backgroundColor: THEME.cardBg, padding: 16, borderRadius: 12,
                borderWidth: 1, borderColor: psbtNetworkConfirmed ? net.color : THEME.border,
                marginBottom: 12,
              }}
            >
              <View style={{
                width: 24, height: 24, borderRadius: 12, borderWidth: 2,
                borderColor: psbtNetworkConfirmed ? net.color : THEME.textMuted,
                alignItems: 'center', justifyContent: 'center', marginRight: 12,
                backgroundColor: psbtNetworkConfirmed ? net.color : 'transparent',
              }}>
                {psbtNetworkConfirmed && <Text style={{ color: '#000', fontWeight: 'bold', fontSize: 14 }}>✓</Text>}
              </View>
              <Text style={{ flex: 1, color: THEME.text, fontSize: 14, lineHeight: 22 }}>
                {t('psbt_confirm_network', { network: net.ticker })}
              </Text>
            </TouchableOpacity>
          )}
          {!psbtResult && (
            <TouchableOpacity
              style={[styles.submitButton, { backgroundColor: net.color }, (psbtLoading || !psbtNetworkConfirmed) && styles.btnDisabled]}
              onPress={handleCreatePsbt}
              disabled={psbtLoading || !psbtNetworkConfirmed}
            >
              {psbtLoading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={[styles.submitButtonText, { color: '#000' }]}>{t('psbt_btn_create')}</Text>
              )}
            </TouchableOpacity>
          )}
          
          {psbtResult && (
            <>
              <TouchableOpacity
                style={[styles.submitButton, { backgroundColor: net.color }]}
                onPress={() => openBroadcastTx(psbtNetwork)}
              >
                <Text style={[styles.submitButtonText, { color: '#000' }]}>{t('psbt_btn_broadcast')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitButton, { backgroundColor: THEME.border }]}
                onPress={() => setScreen('home')}
              >
                <Text style={[styles.submitButtonText, { color: '#FFF' }]}>{t('psbt_btn_back')}</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>

        {/* QR scanner modal (recipient address) — same shared scanner, rendered on this screen */}
        <Modal visible={showScanner} animationType="slide" onRequestClose={() => setShowScanner(false)}>
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            {(cameraDevice ?? scanDevice) ? (
              <Camera
                style={StyleSheet.absoluteFill}
                device={(cameraDevice ?? scanDevice)!}
                isActive={showScanner}
                codeScanner={codeScanner}
              />
            ) : (
              <View style={styles.center}>
                <ActivityIndicator color={THEME.primary} />
                <Text style={{ color: THEME.text, marginTop: 10 }}>{t('broadcast_camera_loading')}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.scanCancelBtn, { bottom: 48 + insets.bottom }]}
              onPress={() => setShowScanner(false)}
            >
              <Text style={styles.scanCancelText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      </View>
    );
  }

  // ── 7-b. BROADCAST SIGNED TX SCREEN ───────────────────
  if (screen === 'broadcast_tx' && bcNetwork) {
    const net = NETWORKS[bcNetwork];
    const feeUnit = smallUnit(bcNetwork);
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setScreen('home')} style={{ zIndex: 1 }}>
            <Text style={[styles.headerAction, { color: net.color }]}>{t('psbt_cancel')}</Text>
          </TouchableOpacity>
          <Text
            style={[styles.headerTitle, { position: 'absolute', left: 0, right: 0, textAlign: 'center' }]}
            pointerEvents="none"
          >
            {t('broadcast_header_title')}
          </Text>
          <View style={{ width: 48 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 20 + insets.bottom }}>
          {/* 1) Send complete */}
          {bcTxid ? (
            <>
              <View style={[styles.card, { alignItems: 'center', gap: 10 }]}>
                <Text style={{ fontSize: 40 }}>✅</Text>
                <Text style={{ color: THEME.success, fontSize: 17, fontWeight: 'bold' }}>{t('broadcast_done')}</Text>
                <Text style={styles.fieldLabel}>{t('broadcast_result_txid')}</Text>
                <TouchableOpacity onPress={() => { Clipboard.setString(bcTxid); ToastAndroid.show(t('broadcast_toast_txid_copied'), ToastAndroid.SHORT); }}>
                  <Text style={[styles.psbtRowVal, { textAlign: 'center' }]} selectable>{bcTxid}</Text>
                  <Text style={[styles.infoText, { textAlign: 'center' }]}>{t('broadcast_tap_copy')}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={[styles.submitButton, { backgroundColor: net.color }]} onPress={() => setScreen('home')}>
                <Text style={[styles.submitButtonText, { color: '#000' }]}>{t('broadcast_btn_home')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {/* Guide */}
              <View style={styles.card}>
                <Text style={styles.fieldLabel}>{t('broadcast_intro_title', { ticker: net.ticker })}</Text>
                <Text style={[styles.infoText, { marginTop: 6 }]}>
                  {t('broadcast_intro_body')}
                </Text>
              </View>

              {/* 2) Scan button (before scanning) */}
              {!bcSignedPsbt && (
                <TouchableOpacity
                  style={[styles.submitButton, { backgroundColor: net.color }, bcPreparing && styles.btnDisabled]}
                  onPress={startBcScan}
                  disabled={bcPreparing}
                >
                  {bcPreparing ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <Text style={[styles.submitButtonText, { color: '#000' }]}>{t('broadcast_btn_scan')}</Text>
                  )}
                </TouchableOpacity>
              )}

              {/* 3) Scan complete -> WYSIWYS re-check summary */}
              {bcSignedPsbt && (
                bcDecoded ? (
                  <View style={[styles.card, { gap: 8 }]}>
                    <Text style={styles.fieldLabel}>{t('broadcast_confirm_title')}</Text>
                    <View style={styles.psbtRow}>
                      <Text style={styles.psbtRowLabel}>{t('broadcast_result_recipient')}</Text>
                      <Text style={styles.psbtRowVal} numberOfLines={1} ellipsizeMode="middle">{bcDecoded.recipient}</Text>
                    </View>
                    <View style={styles.psbtRow}>
                      <Text style={styles.psbtRowLabel}>{t('broadcast_result_amount')}</Text>
                      <Text style={styles.psbtRowVal}>{(bcDecoded.amountSat / 100_000_000).toFixed(8)} {net.ticker}</Text>
                    </View>
                    <View style={styles.psbtRow}>
                      <Text style={styles.psbtRowLabel}>{t('broadcast_result_fee')}</Text>
                      <Text style={styles.psbtRowVal}>
                        {(bcDecoded.feeSat / 100_000_000).toFixed(8)} {net.ticker} ({bcDecoded.feeSat.toLocaleString()} {feeUnit})
                      </Text>
                    </View>
                    {bcDecoded.changeSat > 0 && (
                      <View>
                        <View style={[styles.psbtRow, { borderTopWidth: 1, borderTopColor: '#333', paddingTop: 8, marginTop: 4 }]}>
                          <Text style={styles.psbtRowLabel}>{t('psbt_row_utxo_total')}</Text>
                          <Text style={styles.psbtRowVal}>
                            {((bcDecoded.amountSat + bcDecoded.feeSat + bcDecoded.changeSat) / 100_000_000).toFixed(8)} {net.ticker}
                          </Text>
                        </View>
                        <View style={styles.psbtRow}>
                          <Text style={styles.psbtRowLabel}>{t('psbt_row_change')}</Text>
                          <Text style={styles.psbtRowVal}>{(bcDecoded.changeSat / 100_000_000).toFixed(8)} {net.ticker}</Text>
                        </View>
                      </View>
                    )}
                    {bcDecoded.externalOutputCount !== 1 && (
                      <Text style={{ color: THEME.warning, fontSize: 12, fontWeight: 'bold', marginTop: 4 }}>
                        {t('broadcast_external_warn', { count: bcDecoded.externalOutputCount })}
                      </Text>
                    )}
                  </View>
                ) : !bcError ? (
                  <View style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                    <ActivityIndicator size="small" color={net.color} />
                    <Text style={{ color: THEME.textMuted, fontSize: 13 }}>{t('broadcast_decoding')}</Text>
                  </View>
                ) : null
              )}

              {bcError && (
                <View style={[styles.card, styles.errorCard]}>
                  <Text style={styles.errorText} selectable={true}>{bcError}</Text>
                </View>
              )}

              {/* 4) Send button (only after reviewing the summary) */}
              {bcSignedPsbt && bcDecoded && (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setBcNetworkConfirmed(v => !v)}
                  style={{
                    flexDirection: 'row', alignItems: 'flex-start',
                    backgroundColor: THEME.cardBg, padding: 16, borderRadius: 12,
                    borderWidth: 1, borderColor: bcNetworkConfirmed ? net.color : THEME.border,
                    marginBottom: 12,
                  }}
                >
                  <View style={{
                    width: 24, height: 24, borderRadius: 12, borderWidth: 2,
                    borderColor: bcNetworkConfirmed ? net.color : THEME.textMuted,
                    alignItems: 'center', justifyContent: 'center', marginRight: 12,
                    backgroundColor: bcNetworkConfirmed ? net.color : 'transparent',
                  }}>
                    {bcNetworkConfirmed && <Text style={{ color: '#000', fontWeight: 'bold', fontSize: 14 }}>✓</Text>}
                  </View>
                  <Text style={{ flex: 1, color: THEME.text, fontSize: 14, lineHeight: 22 }}>
                    {t('psbt_confirm_network', { network: net.ticker })}
                  </Text>
                </TouchableOpacity>
              )}
              {bcSignedPsbt && bcDecoded && (
                <TouchableOpacity
                  style={[styles.submitButton, { backgroundColor: net.color }, (bcLoading || !bcNetworkConfirmed) && styles.btnDisabled]}
                  onPress={doBroadcast}
                  disabled={bcLoading || !bcNetworkConfirmed}
                >
                  {bcLoading ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <Text style={[styles.submitButtonText, { color: '#000' }]}>{t('broadcast_btn_send')}</Text>
                  )}
                </TouchableOpacity>
              )}

              {/* Rescan */}
              {bcSignedPsbt && !bcLoading && (
                <TouchableOpacity style={[styles.submitButton, { backgroundColor: THEME.border }]} onPress={startBcScan}>
                  <Text style={[styles.submitButtonText, { color: '#FFF' }]}>{t('broadcast_btn_rescan')}</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </ScrollView>

        {/* Signed-PSBT QR scanner modal */}
        <Modal visible={bcScanning} animationType="slide" onRequestClose={() => setBcScanning(false)}>
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            {(cameraDevice ?? scanDevice) ? (
              <Camera
                style={StyleSheet.absoluteFill}
                device={cameraDevice ?? scanDevice}
                isActive={bcScanning}
                codeScanner={bcCodeScanner}
              />
            ) : (
              <View style={styles.center}>
                <ActivityIndicator color={THEME.primary} />
                <Text style={{ color: THEME.text, marginTop: 10 }}>{t('broadcast_camera_loading')}</Text>
              </View>
            )}

            {bcScanProgress > 0 && bcScanProgress < 1 && (
              <View style={{ position: 'absolute', top: 60, left: 0, right: 0, alignItems: 'center' }}>
                <Text style={{ color: '#FFF', fontSize: 16, fontWeight: 'bold', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 }}>
                  {t('broadcast_qr_reassembling', { pct: Math.round(bcScanProgress * 100) })}
                </Text>
              </View>
            )}

            <TouchableOpacity style={[styles.scanCancelBtn, { bottom: 48 + insets.bottom }]} onPress={() => setBcScanning(false)}>
              <Text style={styles.scanCancelText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      </View>
    );
  }

  // ── 8. ADDRESSES SCREEN ───────────────────────────────
  if (screen === 'addresses' && addrNetwork) {
    const net = NETWORKS[addrNetwork];
    const startIdx = addrPage * ADDR_PAGE_SIZE;
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={backToAssetModal}>
            <Text style={[styles.headerAction, { color: net.color }]}>{t('settings_back')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{net.ticker} {t('addresses_title')}</Text>
          {addrWalletId ? (
            <TouchableOpacity onPress={refreshAddresses} disabled={addrRefreshing} style={{ minWidth: 48, alignItems: 'flex-end' }}>
              {addrRefreshing ? (
                <ActivityIndicator size="small" color={net.color} />
              ) : (
                <Text style={[styles.refreshText, { color: net.color }]}>{t('history_refresh')}</Text>
              )}
            </TouchableOpacity>
          ) : (
            <View style={{ width: 48 }} />
          )}
        </View>

        {/* Receive / change tab */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginBottom: 12 }}>
          <TouchableOpacity
            style={{ flex: 1, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: !addrIsChange ? net.color : 'transparent', alignItems: 'center' }}
            onPress={() => { if (addrWalletId) { setAddrJumpInput(''); loadAddrPage(addrWalletId, 0, false); } }}
          >
            <Text style={{ color: !addrIsChange ? THEME.text : THEME.textMuted, fontWeight: 'bold' }}>{t('addresses_tab_recv')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flex: 1, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: addrIsChange ? net.color : 'transparent', alignItems: 'center' }}
            onPress={() => { if (addrWalletId) { setAddrJumpInput(''); loadAddrPage(addrWalletId, 0, true); } }}
          >
            <Text style={{ color: addrIsChange ? THEME.text : THEME.textMuted, fontWeight: 'bold' }}>{t('addresses_tab_change')}</Text>
          </TouchableOpacity>
        </View>

        {/* Direct index-jump form */}
        <View style={styles.addrJumpRow}>
          <TextInput
            style={styles.addrJumpInput}
            value={addrJumpInput}
            onChangeText={setAddrJumpInput}
            placeholder={t('addresses_jump_placeholder')}
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity style={[styles.addrJumpBtn, { backgroundColor: net.color }]} onPress={handleAddrJump}>
            <Text style={styles.addrJumpBtnText}>{t('addresses_jump_btn')}</Text>
          </TouchableOpacity>
        </View>

        {addrLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={net.color} size="large" />
          </View>
        ) : (
          <FlatList
            data={addrList}
            keyExtractor={(_, i) => String(startIdx + i)}
            contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 16 + insets.bottom }}
            renderItem={({ item, index }) => {
              const absIdx = startIdx + index;
              const hasBalance = item.balanceSat > 0;
              return (
                <View style={[styles.addrItem, hasBalance && { borderLeftWidth: 3.5, borderLeftColor: net.color }]}>
                  {/* Header: #index + path (left) · balance (right, empty if none) */}
                  <View style={styles.addrItemHeader}>
                    <Text style={[styles.addrIdx, { color: net.color }]}>
                      #{absIdx}  <Text style={styles.addrPath}>m/84'/0'/0'/{addrIsChange ? 1 : 0}/{absIdx}</Text>
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {item.used && (
                        <Text style={styles.addrUsedBadge}>{t('addresses_used_badge')}</Text>
                      )}
                      {hasBalance && (
                        <Text style={[styles.addrBalance, { color: net.color }]}>
                          {formatAmount(item.balanceSat, showCoin[addrNetwork!], addrNetwork!)}
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* Address (left, copy) and explorer (right) */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                    <TouchableOpacity
                      onPress={() => copyAddress(item.address)}
                      activeOpacity={0.6}
                      style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                    >
                      <Text style={[styles.addrStr, { flexShrink: 1, marginTop: 0 }]} numberOfLines={1} ellipsizeMode="middle">
                        {item.address}
                      </Text>
                      <View style={{ marginLeft: 6 }}>
                        <Svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <Rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <Path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </Svg>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        const url = EXPLORER[addrNetwork!] ? `${EXPLORER[addrNetwork!]!.mempoolBase}/address/${item.address}` : null;
                        if (url) Linking.openURL(url).catch(() => Alert.alert(t('error'), t('error_browser')));
                      }}
                      style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4, marginLeft: 8 }}
                    >
                      <Text style={{ fontSize: 11, color: THEME.text }}>{t('addresses_explorer_link')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
          />
        )}

        {/* Pagination bar */}
        <View style={styles.addrPageRow}>
          <TouchableOpacity
            style={[styles.addrPageBtn, addrPage === 0 && styles.btnDisabled]}
            onPress={() => addrWalletId && addrPage > 0 && loadAddrPage(addrWalletId, addrPage - 1, addrIsChange)}
            disabled={addrPage === 0}
          >
            <Text style={styles.addrPageBtnText}>{t('addresses_prev')}</Text>
          </TouchableOpacity>
          <Text style={styles.addrPageInfo}>
            {addrList.length > 0 ? `${startIdx} – ${startIdx + addrList.length - 1}` : '—'}
          </Text>
          <TouchableOpacity
            style={styles.addrPageBtn}
            onPress={() => addrWalletId && loadAddrPage(addrWalletId, addrPage + 1, addrIsChange)}
          >
            <Text style={styles.addrPageBtnText}>{t('addresses_next')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return null;
}

// =======================================================
// Sub-modal components
// =======================================================

// ── Wallet edit & delete modal ──────────────────────────────
