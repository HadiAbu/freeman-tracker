import React from 'react';

import { ErrorBanner } from '@/components/feedback/error-banner';
import { reportError } from '@/lib/error-reporting';

export type ErrorFallbackProps = { error: Error; reset: () => void };

type Props = {
  children: React.ReactNode;
  /** What to show instead of the children. A node, or a function that can offer a retry. */
  fallback?: React.ReactNode | ((props: ErrorFallbackProps) => React.ReactNode);
  /** Defaults to `reportError`. Pass your own to add context or to silence it in a test. */
  onError?: (error: Error, info: React.ErrorInfo) => void;
  /** When any value changes (compared with `Object.is`), a failed boundary tries its children again. */
  resetKeys?: readonly unknown[];
};

type State = { error: Error | null };

const changed = (a: readonly unknown[] = [], b: readonly unknown[] = []) =>
  a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));

/**
 * Keeps a render error in one part of a screen from blanking the whole screen. Wrap the section
 * that can fail (a chart, a block built from server data) and the rest of the screen keeps working.
 *
 * It must be a class: React only has error boundaries as `getDerivedStateFromError` and
 * `componentDidCatch`, with no hook equivalent.
 *
 * Limits, so nobody relies on it for more than it does: a boundary catches errors thrown while
 * rendering its children, in their lifecycle methods and in their constructors. It does NOT catch
 * errors in event handlers, in async code (a rejected fetch) or in the boundary itself. Those go
 * through the TanStack Query `error` state and `reportError`. A failure that escapes every boundary
 * lands on the route-level `ErrorBoundary` exported from `src/app/_layout.tsx`.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (this.props.onError) this.props.onError(error, info);
    else reportError(error, { componentStack: info.componentStack });
  }

  override componentDidUpdate(prev: Props) {
    // Only reset after a failure; resetting a healthy boundary would remount nothing but cost a render.
    if (this.state.error && changed(prev.resetKeys, this.props.resetKeys)) this.reset();
  }

  reset = () => this.setState({ error: null });

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { fallback } = this.props;
    if (typeof fallback === 'function') return fallback({ error, reset: this.reset });
    if (fallback !== undefined) return fallback;
    // The message is generic on purpose: the real error goes to `reportError`, never to the screen.
    return (
      <ErrorBanner
        message="This section could not be shown."
        actionLabel="Try again"
        onDismiss={this.reset}
      />
    );
  }
}
