import { renderHook } from '@testing-library/react-native';
import * as RN from 'react-native';
import React from 'react';

import { useColorScheme } from '@/hooks/use-color-scheme.web';

// react-dom ships no types here and is only needed for this one server-render check.
const { renderToString } = require('react-dom/server') as {
  renderToString: (element: React.ReactElement) => string;
};

afterEach(() => jest.restoreAllMocks());

function Probe() {
  return <>{useColorScheme()}</>;
}

test('after hydration it reports the real color scheme', async () => {
  jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark');
  const { result } = await renderHook(() => useColorScheme());
  expect(result.current).toBe('dark');
});

test('static rendering always reports light, so server and first client render agree', () => {
  jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark');
  expect(renderToString(<Probe />)).toBe('light');
});
