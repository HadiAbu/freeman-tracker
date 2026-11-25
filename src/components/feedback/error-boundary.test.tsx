import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { ErrorBoundary } from '@/components/feedback/error-boundary';
import { ChartCard } from '@/components/charts/chart-card';

const mockReport = jest.fn();
jest.mock('@/lib/error-reporting', () => ({
  reportError: (e: unknown, c: unknown) => mockReport(e, c),
}));

// React logs every caught render error to the console; that is noise here, not a failure.
beforeEach(() => {
  mockReport.mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

/** Throws while `broken.now` is true, so a test can fix it and press "Try again". */
const broken = { now: true };
function Flaky({ label = 'chart' }: { label?: string }) {
  if (broken.now) throw new Error('secret internal detail');
  return <Text>{label} ok</Text>;
}
beforeEach(() => {
  broken.now = true;
});

test('a healthy child renders normally and reports nothing', async () => {
  broken.now = false;
  await render(
    <ErrorBoundary>
      <Flaky />
    </ErrorBoundary>,
  );
  expect(screen.getByText('chart ok')).toBeTruthy();
  expect(mockReport).not.toHaveBeenCalled();
});

test('a throwing child shows a generic message, never the raw error, and is reported once', async () => {
  await render(
    <ErrorBoundary>
      <Flaky />
    </ErrorBoundary>,
  );
  expect(screen.getByText('This section could not be shown.')).toBeTruthy();
  expect(screen.queryByText(/secret internal detail/)).toBeNull();
  expect(mockReport).toHaveBeenCalledTimes(1);
  expect(mockReport.mock.calls[0][0]).toEqual(new Error('secret internal detail'));
});

test('Try again renders the children again and recovers once they work', async () => {
  await render(
    <ErrorBoundary>
      <Flaky />
    </ErrorBoundary>,
  );
  broken.now = false;
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByText('chart ok')).toBeTruthy();
});

test('a custom fallback can be a node or a function that receives the error and a reset', async () => {
  const view = await render(
    <ErrorBoundary fallback={<Text>custom node</Text>}>
      <Flaky />
    </ErrorBoundary>,
  );
  expect(screen.getByText('custom node')).toBeTruthy();
  await view.unmount();

  broken.now = true;
  await render(
    <ErrorBoundary
      fallback={({ error, reset }) => <Text onPress={reset}>{`failed: ${error.message}`}</Text>}
    >
      <Flaky />
    </ErrorBoundary>,
  );
  expect(screen.getByText('failed: secret internal detail')).toBeTruthy();
});

test('onError replaces the default reporting', async () => {
  const onError = jest.fn();
  await render(
    <ErrorBoundary onError={onError}>
      <Flaky />
    </ErrorBoundary>,
  );
  expect(onError).toHaveBeenCalledTimes(1);
  expect(mockReport).not.toHaveBeenCalled();
});

test('a failed boundary tries again when a reset key changes, and not before', async () => {
  const view = await render(
    <ErrorBoundary resetKeys={['a']}>
      <Flaky />
    </ErrorBoundary>,
  );
  broken.now = false;
  await view.rerender(
    <ErrorBoundary resetKeys={['a']}>
      <Flaky />
    </ErrorBoundary>,
  );
  expect(screen.getByText('This section could not be shown.')).toBeTruthy(); // same key: stays failed

  await view.rerender(
    <ErrorBoundary resetKeys={['b']}>
      <Flaky />
    </ErrorBoundary>,
  );
  expect(screen.getByText('chart ok')).toBeTruthy();
});

test('a broken chart does not take the rest of the screen with it', async () => {
  await render(
    <>
      <Text>Portfolio total</Text>
      <ChartCard title="Trend">
        <Flaky />
      </ChartCard>
    </>,
  );
  expect(screen.getByText('Portfolio total')).toBeTruthy();
  expect(screen.getByText('Trend')).toBeTruthy();
  expect(screen.getByText('This section could not be shown.')).toBeTruthy();
});
