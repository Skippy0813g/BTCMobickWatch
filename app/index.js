/**
 * @format
 */

import React from 'react';
import { AppRegistry } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { LanguageProvider } from './src/context/LanguageContext';
import App from './App';
import { name as appName } from './app.json';

// initialWindowMetrics: 첫 렌더부터 인셋을 동기적으로 제공 → "첫 프레임 insets=0" 타이밍 문제 차단
const Root = () => (
  <SafeAreaProvider initialMetrics={initialWindowMetrics}>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </SafeAreaProvider>
);

AppRegistry.registerComponent(appName, () => Root);
