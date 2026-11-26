import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ScrollScreen } from '@/components/layout/scroll-screen';
import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/ui/themed-text';
import { ThemedView } from '@/components/ui/themed-view';
import { Spacing } from '@/constants/theme';
import { useCreateTradeWithClassification } from '@/hooks/use-trades';
import { useTheme } from '@/hooks/use-theme';
import { enteredClassification } from '@/lib/classification';
import { haptic } from '@/lib/haptics';
import { isISODate, todayISO } from '@/lib/format';
import { isEmptyDraft, useTradeDraft } from '@/stores/trade-draft';

type Errors = Partial<Record<'ticker' | 'shares' | 'price' | 'fee' | 'date', string>>;

const num = (s: string) => Number(s.trim().replace(',', '.'));

export default function AddTradeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const create = useCreateTradeWithClassification();

  // Opened via deep link / page reload there is no history to go back to.
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  // The form lives in a persisted store, so a dismissed modal or a killed app keeps what was
  // typed. It is cleared by Cancel and once a trade is saved (see useCreateTradeWithClassification).
  const draft = useTradeDraft((s) => s.draft);
  const setDraft = useTradeDraft((s) => s.setDraft);
  const clearDraft = useTradeDraft((s) => s.clear);
  const { side, ticker, shares, price, fee, note, sector, assetClass } = draft;
  // A date is only kept when the user typed one; otherwise it is today, whenever this opens.
  const date = draft.date ?? todayISO();
  const [restored] = useState(() => !isEmptyDraft(useTradeDraft.getState().draft));
  const [errors, setErrors] = useState<Errors>({});
  // Synchronous guard: a fast double tap can land before the pending state has re-rendered.
  const busy = useRef(false);
  const [classificationFailed, setClassificationFailed] = useState(false);

  function validate(): Errors {
    const e: Errors = {};
    if (!/^[A-Za-z0-9.\-]{1,15}$/.test(ticker.trim())) e.ticker = 'Enter a ticker, e.g. AAPL';
    if (!(num(shares) > 0)) e.shares = 'Shares must be greater than 0';
    if (price.trim() === '' || !(num(price) >= 0)) e.price = 'Enter a price (0 or more)';
    if (fee.trim() !== '' && !(num(fee) >= 0)) e.fee = 'Fee must be 0 or more';
    if (!isISODate(date.trim())) e.date = 'Use the format YYYY-MM-DD';
    return e;
  }

  function submit() {
    // One trade per tap: ignore re-entry while the save (trade + classification) is running or done.
    if (busy.current || create.isPending || classificationFailed) return;
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      haptic('warning');
      return;
    }
    busy.current = true;
    create.mutate(
      {
        trade: {
          ticker: ticker.trim().toUpperCase(),
          side,
          shares: num(shares),
          price: num(price),
          fee: fee.trim() === '' ? 0 : num(fee),
          traded_at: date.trim(),
          note: note.trim() || null,
        },
        classification: enteredClassification({ sector, assetClass }),
      },
      {
        onSuccess: ({ classificationFailed }) => {
          // The trade is saved either way. If only the classification failed, stay open and say
          // so (a haptic alone is invisible), then let the user close.
          if (classificationFailed) {
            haptic('warning');
            setClassificationFailed(true);
            return;
          }
          haptic('success');
          close();
        },
        onError: () => {
          busy.current = false;
          haptic('error');
        },
      },
    );
  }

  const input = [
    styles.input,
    { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.border },
  ];

  const field = (
    label: string,
    key: keyof Errors | null,
    props: React.ComponentProps<typeof TextInput>,
  ) => (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        placeholderTextColor={theme.textSecondary}
        style={input}
        accessibilityLabel={label}
        {...props}
      />
      {key && errors[key] ? (
        <ThemedText type="small" themeColor="loss">
          {errors[key]}
        </ThemedText>
      ) : null}
    </View>
  );

  return (
    <ScrollScreen avoidKeyboard>
      {restored && !isEmptyDraft(draft) ? (
        <ThemedText type="small" themeColor="textSecondary">
          Restored your unsaved draft. Cancel discards it.
        </ThemedText>
      ) : null}
      <View style={styles.sides}>
        {(['buy', 'sell'] as const).map((s) => {
          const active = side === s;
          return (
            <Pressable
              key={s}
              style={styles.sideFlex}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setDraft({ side: s })}
            >
              <ThemedView
                type={active ? 'backgroundSelected' : 'backgroundElement'}
                style={styles.sideBtn}
              >
                <ThemedText
                  type="smallBold"
                  themeColor={active ? (s === 'buy' ? 'gain' : 'loss') : 'textSecondary'}
                >
                  {s === 'buy' ? 'Buy' : 'Sell'}
                </ThemedText>
              </ThemedView>
            </Pressable>
          );
        })}
      </View>

      {field('Ticker', 'ticker', {
        value: ticker,
        onChangeText: (v: string) => setDraft({ ticker: v }),
        placeholder: 'AAPL',
        autoCapitalize: 'characters',
        autoCorrect: false,
      })}
      {field('Shares', 'shares', {
        value: shares,
        onChangeText: (v: string) => setDraft({ shares: v }),
        placeholder: '10',
        keyboardType: 'decimal-pad',
      })}
      {field('Price per share (USD)', 'price', {
        value: price,
        onChangeText: (v: string) => setDraft({ price: v }),
        placeholder: '189.50',
        keyboardType: 'decimal-pad',
      })}
      {field('Fee (optional)', 'fee', {
        value: fee,
        onChangeText: (v: string) => setDraft({ fee: v }),
        placeholder: '0',
        keyboardType: 'decimal-pad',
      })}
      {field('Date', 'date', {
        value: date,
        onChangeText: (v: string) => setDraft({ date: v.trim() === todayISO() ? null : v }),
        placeholder: 'YYYY-MM-DD',
        autoCorrect: false,
        autoCapitalize: 'none',
      })}
      {field('Note (optional)', null, {
        value: note,
        onChangeText: (v: string) => setDraft({ note: v }),
        placeholder: 'Why this trade?',
      })}
      {field('Sector (optional)', null, {
        value: sector,
        onChangeText: (v: string) => setDraft({ sector: v }),
        placeholder: 'Technology',
      })}
      {field('Asset class (optional)', null, {
        value: assetClass,
        onChangeText: (v: string) => setDraft({ assetClass: v }),
        placeholder: 'Stock, ETF, Bond…',
      })}

      {create.isError ? (
        <ThemedText themeColor="loss" accessibilityRole="alert">
          {create.error.message}
        </ThemedText>
      ) : null}

      {classificationFailed ? (
        <>
          <ThemedText accessibilityRole="alert">
            Trade saved, but the classification could not be saved. Set it on the position screen.
          </ThemedText>
          <Button title="Done" onPress={close} />
        </>
      ) : (
        <>
          <Button title="Save trade" onPress={submit} loading={create.isPending} />
          <Button
            title="Cancel"
            variant="secondary"
            onPress={() => {
              clearDraft();
              close();
            }}
          />
        </>
      )}
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  sides: { flexDirection: 'row', gap: Spacing.two },
  sideFlex: { flex: 1 },
  sideBtn: {
    minHeight: 44,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: { gap: Spacing.one },
  input: {
    minHeight: 48,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
});
