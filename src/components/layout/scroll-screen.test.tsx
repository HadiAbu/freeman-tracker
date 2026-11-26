import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { ScrollScreen } from '@/components/layout/scroll-screen';

type Node = { type: string; props: Record<string, unknown>; children?: (Node | string)[] | null };

/** First node in the rendered tree that has this prop, so the test does not depend on host names. */
function findWithProp(node: Node | string | null | undefined, prop: string): Node | undefined {
  if (!node || typeof node === 'string') return undefined;
  if (prop in node.props) return node;
  for (const child of node.children ?? []) {
    const found = findWithProp(child, prop);
    if (found) return found;
  }
  return undefined;
}

test('renders its children in a scroll view that lets buttons be tapped while a field is focused', async () => {
  await render(
    <ScrollScreen>
      <Text>form body</Text>
    </ScrollScreen>,
  );
  expect(screen.getByText('form body')).toBeTruthy();
  const scroll = findWithProp(screen.toJSON() as Node, 'keyboardShouldPersistTaps');
  expect(scroll?.props.keyboardShouldPersistTaps).toBe('handled');
});

test('shows the same content with or without keyboard avoidance', async () => {
  const view = await render(
    <ScrollScreen>
      <Text>plain</Text>
    </ScrollScreen>,
  );
  expect(screen.getByText('plain')).toBeTruthy();
  await view.unmount();

  await render(
    <ScrollScreen avoidKeyboard>
      <Text>with keyboard</Text>
    </ScrollScreen>,
  );
  expect(screen.getByText('with keyboard')).toBeTruthy();
  const scroll = findWithProp(screen.toJSON() as Node, 'keyboardShouldPersistTaps');
  expect(scroll?.props.keyboardShouldPersistTaps).toBe('handled');
});
