import { Alert, Platform } from 'react-native';

import { confirmDestructive } from '@/lib/confirm';

afterEach(() => jest.restoreAllMocks());

test('on native it shows an alert whose destructive button runs the action', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const onConfirm = jest.fn();
  confirmDestructive('Delete trade?', 'BUY 2 NVDA', 'Delete', onConfirm);

  expect(alert).toHaveBeenCalledTimes(1);
  const [title, message, buttons] = alert.mock.calls[0];
  expect([title, message]).toEqual(['Delete trade?', 'BUY 2 NVDA']);
  expect(onConfirm).not.toHaveBeenCalled(); // nothing happens until the user confirms

  const cancel = buttons!.find((b) => b.style === 'cancel');
  const destructive = buttons!.find((b) => b.style === 'destructive');
  expect(cancel?.text).toBe('Cancel');
  expect(destructive?.text).toBe('Delete');
  cancel?.onPress?.();
  expect(onConfirm).not.toHaveBeenCalled();
  destructive?.onPress?.();
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

describe('on web (Alert buttons do not run there)', () => {
  const win = globalThis as unknown as { window: { confirm: (m: string) => boolean } };

  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'web');
    win.window = win.window ?? (globalThis as never);
  });

  test('uses window.confirm and runs the action only when accepted', () => {
    const confirm = jest.fn().mockReturnValue(true);
    win.window.confirm = confirm;
    const onConfirm = jest.fn();
    confirmDestructive('Delete trade?', 'BUY 2 NVDA', 'Delete', onConfirm);
    expect(confirm).toHaveBeenCalledWith('Delete trade?\nBUY 2 NVDA');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test('does nothing when the user cancels', () => {
    win.window.confirm = jest.fn().mockReturnValue(false);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onConfirm = jest.fn();
    confirmDestructive('Delete trade?', 'BUY 2 NVDA', 'Delete', onConfirm);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });
});
