import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ErrorBoundary } from '@/components/feedback/error-boundary';
import { Spacing } from '@/constants/theme';
import { useChartTheme } from '@/constants/chart-theme';

type Props = {
  title: string;
  subtitle?: string;
  /** Read by screen readers instead of the (unreadable) chart graphics. */
  summary?: string;
  children: React.ReactNode;
};

/**
 * Charts render on a fixed surface so the palette's contrast was validated against the
 * surface it is actually drawn on. Text wears ink tokens, never a series color.
 */
export function ChartCard({ title, subtitle, summary, children }: Props) {
  const c = useChartTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
      accessible={!!summary}
      accessibilityLabel={summary ? `${title}. ${summary}` : undefined}
    >
      <Text style={[styles.title, { color: c.ink }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: c.inkSecondary }]}>{subtitle}</Text>
      ) : null}
      {/* A chart that throws shows an inline message; the rest of the screen keeps working. The summary
          is derived from the data, so a refresh with new data lets a failed chart try again. */}
      <View style={styles.body}>
        <ErrorBoundary resetKeys={[summary]}>{children}</ErrorBoundary>
      </View>
    </View>
  );
}

export function ChartNote({ children }: { children: string }) {
  const c = useChartTheme();
  return <Text style={[styles.note, { color: c.inkSecondary }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.four,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  title: { fontSize: 16, fontWeight: '700' },
  subtitle: { fontSize: 13, lineHeight: 18 },
  body: { marginTop: Spacing.two },
  note: { fontSize: 14, lineHeight: 20, paddingVertical: Spacing.three },
});
