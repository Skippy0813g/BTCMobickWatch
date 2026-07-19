import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

export const WalletOutlineIcon = ({ size = 60, color = '#AEAEB2' }: { size?: number; color?: string }) => {
  const width = size;
  const height = size * 0.75;
  return (
    <View style={{
      width: width,
      height: height,
      borderWidth: 2.2,
      borderColor: color,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'flex-end',
      paddingRight: width * 0.08,
      marginBottom: 16
    }}>
      <View style={{
        width: width * 0.25,
        height: height * 0.25,
        borderWidth: 2.2,
        borderColor: color,
        borderRadius: 4,
        backgroundColor: '#0C0C0E'
      }} />
    </View>
  );
};

export const FilterIcon = ({ size = 18, color = '#FFF' }: { size?: number; color?: string }) => {
  const barWidth = size * 0.75;
  const barThickness = 2;
  return (
    <View style={{ width: size, height: size, justifyContent: 'space-between', paddingVertical: size * 0.14, alignItems: 'center' }}>
      <View style={{ width: barWidth, height: barThickness, backgroundColor: color, borderRadius: barThickness / 2 }} />
      <View style={{ width: barWidth, height: barThickness, backgroundColor: color, borderRadius: barThickness / 2 }} />
      <View style={{ width: barWidth, height: barThickness, backgroundColor: color, borderRadius: barThickness / 2 }} />
    </View>
  );
};

export const PlusIcon = ({ size = 18, color = '#FFF' }: { size?: number; color?: string }) => {
  const thickness = 2;
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <View style={{ position: 'absolute', width: size - 4, height: thickness, backgroundColor: color, borderRadius: thickness / 2 }} />
      <View style={{ position: 'absolute', width: thickness, height: size - 4, backgroundColor: color, borderRadius: thickness / 2 }} />
    </View>
  );
};
