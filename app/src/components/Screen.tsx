import React from 'react';
import { View, ViewStyle, StyleProp } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { THEME } from '../constants/theme';

interface ScreenProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Whether to apply the top (status bar) inset. Default true.
   * Set false for full-screen overlays like the camera that must fill the screen.
   */
  topInset?: boolean;
}

/**
 * Shared root wrapper for all screens.
 * Under edge-to-edge (targetSdk 36), RN's default SafeAreaView is a no-op on Android,
 * so the top inset is applied directly via useSafeAreaInsets.
 *
 * Does NOT reuse styles.container: legacy (not-yet-migrated) screens get their top inset
 * from StatusBar.currentHeight, so combining the two would double-apply insets.top.
 * SafeScreen uses only its own base (flex/background + insets.top).
 *
 * Bottom insets are handled per-screen (fixed footer vs scroll), so each screen uses
 * useSafeAreaInsets directly for those.
 */
export const SafeScreen = ({ children, style, topInset = true }: ScreenProps) => {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        { flex: 1, backgroundColor: THEME.background, paddingTop: topInset ? insets.top : 0 },
        style,
      ]}
    >
      {children}
    </View>
  );
};
