import { reportError } from '@/lib/error-reporting';

const globalWithDev = globalThis as unknown as { __DEV__: boolean };
const original = globalWithDev.__DEV__;

afterEach(() => {
  globalWithDev.__DEV__ = original;
  jest.restoreAllMocks();
});

test('logs the error and its context in development', () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const error = new Error('boom');
  reportError(error, { screen: 'trades' });
  expect(spy).toHaveBeenCalledWith('[freeman] handled error:', error, { screen: 'trades' });
});

test('is completely silent in a release build', () => {
  globalWithDev.__DEV__ = false;
  const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  reportError(new Error('boom'));
  expect(spy).not.toHaveBeenCalled();
});
