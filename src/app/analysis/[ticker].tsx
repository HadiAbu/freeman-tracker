import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import { CaseList } from '@/components/analysis/case-list';
import { SourceList } from '@/components/analysis/source-list';
import { StanceChip } from '@/components/analysis/stance-chip';
import { ErrorBoundary } from '@/components/feedback/error-boundary';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/feedback/error-banner';
import { ErrorState, LoadingState } from '@/components/feedback/screen-state';
import { ThemedText } from '@/components/ui/themed-text';
import { ThemedView } from '@/components/ui/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useLatestAnalysis, useRunAnalysis } from '@/hooks/use-analysis';
import { usePortfolioSummary } from '@/hooks/use-trades';
import { timeAgo } from '@/lib/time-ago';
import { usePreferences } from '@/stores/preferences';
import type { Analysis } from '@/types';

export const DISCLAIMER =
  'Informational only, not financial advice. This view comes from recent news headlines and can be wrong or out of date.';

export default function AnalysisScreen() {
  const { ticker: raw } = useLocalSearchParams<{ ticker: string }>();
  const ticker = String(raw ?? '').toUpperCase();

  const latest = useLatestAnalysis(ticker);
  const run = useRunAnalysis(ticker);
  const summary = usePortfolioSummary();
  const held = !!summary.data?.holdings.some((h) => h.ticker === ticker);

  // The newest run result lives here, separate from the stored "latest" query, so a refetch or
  // a thin-news result (never stored on the server) cannot replace what the user just got.
  const [shown, setShown] = useState<Analysis | null>(null);
  const analysis = shown ?? latest.data ?? null;

  // The last choice made on any ticker is where a ticker with no analysis yet starts.
  const personalizeDefault = usePreferences((s) => s.personalizeDefault);
  const setPersonalizeDefault = usePreferences((s) => s.setPersonalizeDefault);
  // null = follow the displayed analysis; a boolean = the user's explicit choice.
  const [override, setOverride] = useState<boolean | null>(null);
  const usePosition = override ?? analysis?.personalized ?? personalizeDefault;
  const [dismissed, setDismissed] = useState(false);
  const personalize = held && usePosition;

  const start = (extra: { refresh?: boolean } = {}) => {
    if (run.isPending) return;
    setDismissed(false);
    run.mutate({ ...extra, personalize }, { onSuccess: setShown });
  };

  const togglePosition = (value: boolean) => {
    if (run.isPending) return;
    const previous = usePosition;
    const previousDefault = personalizeDefault;
    setOverride(value);
    setPersonalizeDefault(value);
    // With nothing displayed this only changes the setting for the next explicit Analyze tap.
    if (!analysis) return;
    setDismissed(false);
    run.mutate(
      { personalize: value },
      {
        onSuccess: setShown,
        onError: () => {
          setOverride(previous);
          setPersonalizeDefault(previousDefault);
        },
      },
    );
  };

  let body: React.ReactNode;
  if (latest.isPending) {
    body = <LoadingState />;
  } else if (latest.isError) {
    body = <ErrorState error={latest.error as Error} onRetry={() => latest.refetch()} />;
  } else if (run.isPending) {
    body = (
      <View style={styles.center}>
        <LoadingState />
        <ThemedText themeColor="textSecondary" style={styles.centerText}>
          Reading the latest news… this can take up to a minute.
        </ThemedText>
      </View>
    );
  } else if (!analysis) {
    body = (
      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="smallBold">No analysis yet</ThemedText>
        <ThemedText themeColor="textSecondary">
          Reads recent company, market and world news about {ticker} and summarises the case for and
          against holding it.
        </ThemedText>
        <Button title="Analyze with news" onPress={() => start()} />
      </ThemedView>
    );
  } else {
    const sourceNumbers: Record<string, number> = {};
    analysis.sources.forEach((s, i) => (sourceNumbers[s.id] = i + 1));
    // The analysis is model output, so a malformed payload is a realistic way to crash: contain it
    // here. Refresh stays outside the boundary so a broken analysis can still be regenerated.
    body = (
      <>
        <ErrorBoundary resetKeys={[analysis]}>
          <StanceChip stance={analysis.stance} confidence={analysis.confidence} />
          <ThemedText>{analysis.summary}</ThemedText>
          <CaseList title="Case for" points={analysis.case_for} sourceNumbers={sourceNumbers} />
          <CaseList
            title="Case against"
            points={analysis.case_against}
            sourceNumbers={sourceNumbers}
          />
          {analysis.watch_for.length > 0 ? (
            <View style={styles.block}>
              <ThemedText type="smallBold">What would change this view</ThemedText>
              {analysis.watch_for.map((w, i) => (
                <View key={i} style={styles.bulletRow}>
                  <ThemedText>•</ThemedText>
                  <ThemedText style={styles.bulletText}>{w}</ThemedText>
                </View>
              ))}
            </View>
          ) : null}
          <SourceList sources={analysis.sources} />
          {analysis.notes.map((n, i) => (
            <ThemedText key={i} type="small" themeColor="textSecondary">
              {n}
            </ThemedText>
          ))}
        </ErrorBoundary>
        <View style={styles.meta}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.metaText}>
            Generated {timeAgo(analysis.generated_at)}
            {analysis.personalized ? ' · uses your position' : ''}
          </ThemedText>
          <Button title="Refresh" variant="secondary" onPress={() => start({ refresh: true })} />
        </View>
      </>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <Stack.Screen options={{ title: ticker }} />
      <ScrollView contentContainerStyle={styles.content}>
        {held ? (
          <View style={styles.switchRow}>
            <ThemedText>Use my position</ThemedText>
            <Switch
              accessibilityLabel="Use my position"
              value={usePosition}
              disabled={run.isPending}
              onValueChange={togglePosition}
            />
          </View>
        ) : null}
        {run.isError && !dismissed ? (
          <ErrorBanner
            message={(run.error as Error).message}
            onDismiss={() => setDismissed(true)}
          />
        ) : null}
        {body}
        <ThemedText type="small" themeColor="textSecondary">
          {DISCLAIMER}
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingBottom: Spacing.six,
  },
  card: { padding: Spacing.four, borderRadius: Spacing.four, gap: Spacing.three },
  block: { gap: Spacing.two },
  bulletRow: { flexDirection: 'row', gap: Spacing.two },
  bulletText: { flex: 1 },
  center: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.four },
  centerText: { textAlign: 'center' },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  metaText: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
