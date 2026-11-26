import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  type TabTriggerSlotProps,
  type TabListProps,
} from 'expo-router/ui';
import React from 'react';
import {
  Pressable,
  type PressableProps,
  View,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';

import { ThemedText } from '@/components/ui/themed-text';
import { ThemedView } from '@/components/ui/themed-view';

import { MaxContentWidth, Spacing } from '@/constants/theme';

/** Narrower than this, the brand name and four normally spaced tabs do not fit on one line. */
export const COMPACT_TAB_BAR_WIDTH = 520;

const useCompactTabBar = () => useWindowDimensions().width < COMPACT_TAB_BAR_WIDTH;

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="index" href="/" asChild>
            <TabButton>Dashboard</TabButton>
          </TabTrigger>
          <TabTrigger name="portfolio" href="/portfolio" asChild>
            <TabButton>Portfolio</TabButton>
          </TabTrigger>
          <TabTrigger name="watchlist" href="/watchlist" asChild>
            <TabButton>Watchlist</TabButton>
          </TabTrigger>
          <TabTrigger name="trades" href="/trades" asChild>
            <TabButton>Trades</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

export function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  const compact = useCompactTabBar();
  return (
    <Pressable {...(props as PressableProps)} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        type={isFocused ? 'backgroundSelected' : 'backgroundElement'}
        style={[styles.tabButtonView, compact && styles.tabButtonCompact]}
      >
        <ThemedText type="small" themeColor={isFocused ? 'text' : 'textSecondary'}>
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  const compact = useCompactTabBar();
  return (
    <View {...props} style={[styles.tabListContainer, compact && styles.tabListCompact]}>
      <ThemedView
        type="backgroundElement"
        style={[styles.innerContainer, compact && styles.innerCompact]}
      >
        {compact ? null : (
          <ThemedText type="smallBold" style={styles.brandText}>
            Freeman
          </ThemedText>
        )}

        {props.children}
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  tabListContainer: {
    position: 'absolute',
    width: '100%',
    padding: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  innerContainer: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.five,
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  brandText: {
    marginRight: 'auto',
  },
  // Compact: share the width evenly between the tabs with little padding, so all four fit
  // windows as narrow as 320.
  tabListCompact: {
    paddingHorizontal: Spacing.two,
  },
  innerCompact: {
    paddingHorizontal: Spacing.one,
    justifyContent: 'space-around',
    gap: 0,
  },
  tabButtonCompact: {
    paddingHorizontal: Spacing.two,
  },
  pressed: {
    opacity: 0.7,
  },
  tabButtonView: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
});
