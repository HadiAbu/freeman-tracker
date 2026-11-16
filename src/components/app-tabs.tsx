import { MaterialCommunityIcons } from '@expo/vector-icons';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import React from 'react';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

// iOS uses SF Symbols; Android uses Material icons.
const TABS = [
  { name: 'index', label: 'Dashboard', sf: 'chart.pie', md: 'chart-pie' },
  { name: 'portfolio', label: 'Portfolio', sf: 'briefcase', md: 'briefcase-outline' },
  { name: 'watchlist', label: 'Watchlist', sf: 'eye', md: 'eye-outline' },
  { name: 'trades', label: 'Trades', sf: 'arrow.left.arrow.right', md: 'swap-horizontal' },
] as const;

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      {TABS.map((tab) => (
        <NativeTabs.Trigger key={tab.name} name={tab.name}>
          <NativeTabs.Trigger.Label>{tab.label}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            sf={tab.sf}
            src={<NativeTabs.Trigger.VectorIcon family={MaterialCommunityIcons} name={tab.md} />}
          />
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
