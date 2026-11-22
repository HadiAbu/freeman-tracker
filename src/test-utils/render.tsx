import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import React from 'react';

const clients: QueryClient[] = [];

/**
 * A client for tests: no retries, and no garbage-collection timers left running (an unfinished
 * 5 minute gc timer on a query or mutation keeps the Jest worker from exiting).
 */
export function createTestClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  clients.push(client);
  return client;
}

/** Wraps `ui` in a fresh QueryClientProvider. Clients are cleared after every test. */
export async function renderWithClient(ui: React.ReactElement) {
  const client = createTestClient();
  const result = await render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { client, ...result };
}

afterEach(() => {
  clients.splice(0).forEach((c) => c.clear());
});
