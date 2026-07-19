import React from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, TextInput, Image, ActivityIndicator, Alert, Linking } from 'react-native';
import { THEME } from '../constants/theme';
import { NETWORKS, EXPLORER, evmExplorerAddressUrl, DEFAULT_PRICES, type NetworkKey } from '../constants/networks';
import { ASSET_LOGOS, getChainBadge, getWalletAssets } from '../constants/assets';
import { DEFAULT_ORDER } from '../constants/services';
import { formatAmount, spendableSat } from '../utils/helpers';
import type { BalanceState } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { styles } from '../styles';

interface EditWalletModalProps {
  visible: boolean;
  walletAlias: string;
  onChangeText: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export const EditWalletModal = ({
  visible,
  walletAlias,
  onChangeText,
  onSave,
  onClose,
}: EditWalletModalProps) => {
  const { t } = useLanguage();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('modal_wallet_title')}</Text>
            <TouchableOpacity onPress={onClose} style={styles.modalCloseButton}>
              <Text style={styles.modalCloseButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={{ marginVertical: 14 }}>
            <Text style={styles.modalLabel}>{t('modal_wallet_label')}</Text>
            <TextInput
              style={styles.input}
              value={walletAlias}
              onChangeText={onChangeText}
              placeholder={t('modal_wallet_placeholder')}
              placeholderTextColor={THEME.textMuted}
            />
          </View>

          <TouchableOpacity style={styles.submitButton} onPress={onSave}>
            <Text style={styles.submitButtonText}>{t('modal_wallet_save')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

interface AssetDetailsModalProps {
  visible: boolean;
  assetKey: NetworkKey;
  walletLabel: string;
  balance: BalanceState;
  onClose: () => void;
  onRefresh: () => void;
  onDeepRescan: () => void;
  isRescanning: boolean;
  onReceive: () => void;
  onAddresses: () => void;
  onTxHistory: () => void;
  onCreatePsbt: () => void;
  onBroadcastTx: () => void;
  onToggleUnit: () => void;
  showCoin: boolean;
  canCreatePsbt: boolean;
  isSingleAddress: boolean;
  marketPrices: typeof DEFAULT_PRICES;
  address: string;
}

export const AssetDetailsModal = ({
  visible,
  assetKey,
  walletLabel,
  balance,
  onClose,
  onRefresh,
  onDeepRescan,
  isRescanning,
  onReceive,
  onAddresses,
  onTxHistory,
  onCreatePsbt,
  onBroadcastTx,
  onToggleUnit,
  showCoin,
  canCreatePsbt,
  isSingleAddress,
  marketPrices,
  address,
}: AssetDetailsModalProps) => {
  const { t } = useLanguage();
  const net = NETWORKS[assetKey];
  const prices = marketPrices as Record<string, number>;
  const priceUsd = prices[`${net.ticker}_USD`] ?? 0;
  const priceKrw = prices[`${net.ticker}_KRW`] ?? 0;
  const coinAmount = balance.confirmedSat !== null
    ? spendableSat(balance) / Math.pow(10, net.decimals)
    : 0;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContainer, { minHeight: 320 }]}>
          <View style={styles.modalHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
              <View style={[styles.assetIconImageWrapper, { width: 32, height: 32, borderRadius: 16, marginRight: 10, flexShrink: 0 }]}>
                <Image 
                  source={ASSET_LOGOS[net.ticker] || ASSET_LOGOS.default} 
                  style={{ width: 32, height: 32 }} 
                />
                {!ASSET_LOGOS[net.ticker] && (
                  <Text style={[styles.assetIconTextOverlay, { fontSize: 14, lineHeight: 32 }]}>
                    {net.ticker.charAt(0)}
                  </Text>
                )}
              </View>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.modalTitle} numberOfLines={1}>{t('modal_asset_header', { netLabel: net.label })}</Text>
                <Text style={styles.historyModalSubHeader} numberOfLines={1}>{t('modal_wallet_header', { walletLabel })}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity onPress={onRefresh} disabled={balance.loading || isRescanning} style={{ paddingHorizontal: 4, paddingVertical: 2 }}>
                {balance.loading ? (
                  <ActivityIndicator size="small" color={net.color} />
                ) : (
                  <Text style={[styles.refreshText, { color: net.color }]}>{t('modal_refresh')}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} style={styles.modalCloseButton}>
                <Text style={styles.modalCloseButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ alignItems: 'center', marginVertical: 20 }}>
            <Text style={{ fontSize: 13, color: THEME.textMuted, marginBottom: 4 }}>{t('modal_total_balance')}</Text>
            {balance.loading || isRescanning ? (
              <ActivityIndicator size="small" color={net.color} />
            ) : balance.error ? (
              <Text style={{ color: THEME.danger, fontSize: 15 }}>{t('modal_load_failed')}</Text>
            ) : balance.confirmedSat !== null ? (
              <TouchableOpacity onPress={onToggleUnit} activeOpacity={0.8} style={{ alignItems: 'center' }}>
                <Text style={[styles.cardKRWBalance, { color: net.color, fontSize: 32, marginVertical: 0 }]}>
                  {formatAmount(spendableSat(balance), showCoin, assetKey)}
                </Text>
                <Text style={{ fontSize: 13, color: THEME.textMuted, marginTop: 6 }}>
                  {priceUsd > 0
                    ? `≈ $ ${(coinAmount * priceUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (₩ ${Math.round(coinAmount * priceKrw).toLocaleString()})`
                    : t('modal_price_unconfirmed')}
                </Text>
                {((balance.unconfirmedSat ?? 0) - (balance.trustedPendingSat ?? 0)) > 0 && (
                  <Text style={{ fontSize: 13, color: THEME.textMuted, marginTop: 4 }}>
                    {t('modal_pending_deposit', { amount: formatAmount((balance.unconfirmedSat ?? 0) - (balance.trustedPendingSat ?? 0), showCoin, assetKey) })}
                  </Text>
                )}
                {(balance.pendingOutgoingSat ?? 0) > 0 && (
                  <Text style={{ fontSize: 13, color: THEME.warning, marginTop: 4 }}>
                    {t('modal_pending_withdrawal', { amount: formatAmount(balance.pendingOutgoingSat ?? 0, showCoin, assetKey) })}
                  </Text>
                )}
              </TouchableOpacity>
            ) : (
              <Text style={{ color: THEME.text, fontSize: 15 }}>—</Text>
            )}
          </View>

          {/* Main action buttons - single address (no walletId) is view-only, so hidden */}
          {net.isEvm ? (
            <View style={{ gap: 8, marginTop: 10 }}>
              <TouchableOpacity style={[styles.gridActionBtn, { width: '100%', backgroundColor: '#2D4B63' }]} onPress={onReceive}>
                <Text style={styles.gridActionText}>{t('modal_btn_receive')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.gridActionBtn, { width: '100%' }]}
                onPress={() => {
                  const url = evmExplorerAddressUrl(assetKey, address);
                  if (url) Linking.openURL(url).catch(() => Alert.alert(t('error'), t('error_browser')));
                }}
              >
                <Text style={styles.gridActionText}>{t('modal_btn_explorer')}</Text>
              </TouchableOpacity>
            </View>
          ) : balance.walletId ? (
            <View style={{ gap: 8, marginTop: 10 }}>
              <TouchableOpacity style={[styles.gridActionBtn, { width: '100%', backgroundColor: '#2D4B63' }]} onPress={onReceive}>
                <Text style={styles.gridActionText}>{t('modal_btn_receive')}</Text>
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={[styles.gridActionBtn, { flex: 1 }]} onPress={onTxHistory}>
                  <Text style={styles.gridActionText}>{t('modal_btn_history')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.gridActionBtn, { flex: 1 }]} onPress={onAddresses}>
                  <Text style={styles.gridActionText}>{t('modal_btn_addresses')}</Text>
                </TouchableOpacity>
              </View>
              {canCreatePsbt && (
                <>
                  <TouchableOpacity style={[styles.gridActionBtn, { width: '100%' }]} onPress={onCreatePsbt}>
                    <Text style={styles.gridActionText}>{t('modal_btn_create_psbt')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.gridActionBtn, { width: '100%' }]} onPress={onBroadcastTx}>
                    <Text style={styles.gridActionText}>{t('modal_btn_send_psbt')}</Text>
                  </TouchableOpacity>
                </>
              )}
              <TouchableOpacity 
                style={[styles.gridActionBtn, { width: '100%', marginTop: 8, borderColor: net.color }]} 
                onPress={onDeepRescan}
                disabled={isRescanning}
              >
                <Text style={[styles.gridActionText, { color: net.color }]}>
                  {isRescanning ? t('modal_rescan_loading') : t('modal_rescan_btn')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : isSingleAddress ? (
            <View style={{ gap: 8, marginTop: 10 }}>
              <TouchableOpacity style={[styles.gridActionBtn, { width: '100%', backgroundColor: '#2D4B63' }]} onPress={onReceive}>
                <Text style={styles.gridActionText}>{t('modal_btn_receive')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.gridActionBtn, { width: '100%' }]} onPress={onTxHistory}>
                <Text style={styles.gridActionText}>{t('modal_btn_history')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.gridActionBtn, { width: '100%' }]}
                onPress={() => {
                  const url = EXPLORER[assetKey] ? `${EXPLORER[assetKey]!.mempoolBase}/address/${address}` : null;
                  if (url) Linking.openURL(url).catch(() => Alert.alert(t('error'), t('error_browser')));
                }}
              >
                <Text style={styles.gridActionText}>{t('modal_btn_explorer')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={[styles.infoText, { textAlign: 'center', marginTop: 10 }]}>
              {t('modal_loading_balance')}
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
};

interface EditAssetsModalProps {
  visible: boolean;
  onClose: () => void;
  zpub: string;
  assetVisibility: Record<NetworkKey, boolean>;
  assetOrder: { BTC: NetworkKey[]; EVM: NetworkKey[] };
  onToggleVisibility: (assetId: NetworkKey) => void;
  onMoveAsset: (direction: 'up' | 'down', assetId: NetworkKey) => void;
}

export const EditAssetsModal = ({
  visible,
  onClose,
  zpub,
  assetVisibility,
  assetOrder,
  onToggleVisibility,
  onMoveAsset,
}: EditAssetsModalProps) => {
  const { t } = useLanguage();
  const isEvm = (zpub || '').toLowerCase().trim().startsWith('0x');
  const category = isEvm ? 'EVM' : 'BTC';
  
  // Get all assets and sort them by the current order
  const allAssets = getWalletAssets(zpub);
  const order = assetOrder[category] || DEFAULT_ORDER[category];
  const sortedAllAssets = [...allAssets].sort((a, b) => {
    const idxA = order.indexOf(a.id);
    const idxB = order.indexOf(b.id);
    return idxA - idxB;
  });

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContainer, { maxHeight: '80%' }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('modal_edit_assets_title')}</Text>
            <TouchableOpacity onPress={onClose} style={styles.modalCloseButton}>
              <Text style={[styles.modalCloseButtonText, { color: THEME.primary, fontSize: 15, fontWeight: 'bold' }]}>{t('close')}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingVertical: 10 }}>
            {sortedAllAssets.map((asset, index) => {
              const isVisible = assetVisibility[asset.id] !== false;
              const netColor = NETWORKS[asset.id].color;
              const badge = getChainBadge(asset.network);

              return (
                <View key={asset.id} style={styles.editAssetRow}>
                  {/* Visibility Toggle */}
                  <TouchableOpacity
                    onPress={() => onToggleVisibility(asset.id)}
                    style={styles.visibilityToggleBtn}
                  >
                    <View style={[
                      styles.checkbox,
                      isVisible && { backgroundColor: THEME.primary, borderColor: THEME.primary }
                    ]}>
                      {isVisible && <Text style={styles.checkboxCheck}>✓</Text>}
                    </View>
                  </TouchableOpacity>

                  {/* Asset Icon */}
                  <View style={{ width: 32, height: 32, marginRight: 10 }}>
                    <View style={[styles.assetIconImageWrapper, { width: 32, height: 32, borderRadius: 16 }]}>
                      <Image
                        source={ASSET_LOGOS[asset.ticker] || ASSET_LOGOS.default}
                        style={{ width: 32, height: 32 }}
                      />
                      {!ASSET_LOGOS[asset.ticker] && (
                        <Text style={[styles.assetIconTextOverlay, { fontSize: 14 }]}>
                          {asset.ticker.charAt(0)}
                        </Text>
                      )}
                    </View>
                    {badge && (
                      <View style={[styles.assetChainBadge, { top: 19, left: 19, width: 14, height: 14, borderRadius: 7 }]}>
                        <Image source={badge} style={{ width: 12, height: 12 }} />
                      </View>
                    )}
                  </View>

                  {/* Asset Title/Subtitle */}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.assetTitle, { fontSize: 14 }]}>{asset.name}</Text>
                    <Text style={[styles.assetSubTitle, { fontSize: 10, marginTop: 1 }]}>{asset.network}</Text>
                  </View>

                  {/* Reorder controls */}
                  <View style={styles.reorderControls}>
                    <TouchableOpacity
                      disabled={index === 0}
                      onPress={() => onMoveAsset('up', asset.id)}
                      style={[styles.reorderBtn, index === 0 && { opacity: 0.3 }]}
                    >
                      <Text style={styles.reorderBtnText}>▲</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      disabled={index === sortedAllAssets.length - 1}
                      onPress={() => onMoveAsset('down', asset.id)}
                      style={[styles.reorderBtn, index === sortedAllAssets.length - 1 && { opacity: 0.3 }]}
                    >
                      <Text style={styles.reorderBtnText}>▼</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};
