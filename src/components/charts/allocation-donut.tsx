import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PieChart } from 'react-native-gifted-charts';

import { useChartTheme } from '@/constants/chart-theme';
import { Spacing } from '@/constants/theme';
import { formatCurrency } from '@/lib/format';
import type { ColoredSlice } from '@/lib/entity-colors';

type Props = { slices: ColoredSlice[]; total: number };

const RADIUS = 84;
const INNER = 56;

/**
 * A donut for part-to-whole at a glance (<= 5 named slices + gray "Other"), with a legend
 * that lists every name, amount and percent: the legend is the table view, so no slice
 * depends on color alone. Tap a slice or a row to focus it.
 */
export function AllocationDonut({ slices, total }: Props) {
  const c = useChartTheme();
  const [focused, setFocused] = useState<number | null>(null);
  const active = focused !== null ? slices[focused] : undefined;
  const toggle = (i: number) => setFocused((cur) => (cur === i ? null : i));

  return (
    <View style={styles.wrap}>
      <PieChart
        donut
        radius={RADIUS}
        innerRadius={INNER}
        innerCircleColor={c.surface}
        backgroundColor={c.surface}
        // 2px surface gap between slices (a gap, not a border around the marks)
        strokeWidth={2}
        strokeColor={c.surface}
        data={slices.map((s, i) => ({
          value: s.value,
          color: s.color,
          focused: focused === i,
          onPress: () => toggle(i),
        }))}
        centerLabelComponent={() => (
          <View style={styles.center}>
            <Text style={[styles.centerCaption, { color: c.inkSecondary }]} numberOfLines={1}>
              {active ? active.label : 'Total'}
            </Text>
            <Text style={[styles.centerValue, { color: c.ink }]} numberOfLines={1}>
              {active ? `${active.percent.toFixed(1)}%` : formatCurrency(total)}
            </Text>
          </View>
        )}
      />

      <View style={styles.legend}>
        {slices.map((s, i) => (
          <Pressable
            key={s.label}
            accessibilityRole="button"
            accessibilityLabel={`${s.label}, ${formatCurrency(s.value)}, ${s.percent.toFixed(1)} percent`}
            accessibilityState={{ selected: focused === i }}
            onPress={() => toggle(i)}
            style={styles.row}>
            <View style={[styles.swatch, { backgroundColor: s.color }]} />
            <Text style={[styles.name, { color: c.ink }, focused === i && styles.bold]} numberOfLines={1}>
              {s.label}
            </Text>
            <Text style={[styles.amount, { color: c.inkSecondary }]}>{formatCurrency(s.value)}</Text>
            <Text style={[styles.percent, { color: c.inkSecondary }]}>{s.percent.toFixed(1)}%</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: Spacing.three },
  center: { alignItems: 'center', justifyContent: 'center', width: INNER * 1.6 },
  centerCaption: { fontSize: 12 },
  centerValue: { fontSize: 16, fontWeight: '700' },
  legend: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 40 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  name: { flex: 1, fontSize: 14 },
  bold: { fontWeight: '700' },
  amount: { fontSize: 14, minWidth: 84, textAlign: 'right' },
  percent: { fontSize: 14, minWidth: 52, textAlign: 'right' },
});
