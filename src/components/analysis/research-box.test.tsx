import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { ResearchBox } from '@/components/analysis/research-box';

test('submits an upper-cased, trimmed ticker', async () => {
  const onSubmit = jest.fn();
  await render(<ResearchBox onSubmit={onSubmit} />);
  await fireEvent.changeText(screen.getByLabelText('Research a ticker'), '  nvda ');
  await fireEvent.press(screen.getByRole('button', { name: 'Research' }));
  expect(onSubmit).toHaveBeenCalledWith('NVDA');
});

test.each(['', 'A B', 'x'.repeat(16), 'AAPL;DROP'])('rejects %p with a message and does not submit', async (bad) => {
  const onSubmit = jest.fn();
  await render(<ResearchBox onSubmit={onSubmit} />);
  await fireEvent.changeText(screen.getByLabelText('Research a ticker'), bad);
  await fireEvent.press(screen.getByRole('button', { name: 'Research' }));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByText('Enter a ticker, e.g. NVDA')).toBeTruthy();
});

test('the error clears as soon as the user edits', async () => {
  await render(<ResearchBox onSubmit={jest.fn()} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Research' }));
  expect(screen.getByText('Enter a ticker, e.g. NVDA')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Research a ticker'), 'A');
  expect(screen.queryByText('Enter a ticker, e.g. NVDA')).toBeNull();
});
