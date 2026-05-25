import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Catches any unhandled render error so the screen
 * never goes white — the user sees a recoverable "Something went wrong" UI
 * with a Reload button instead of a blank page.
 *
 * React error boundaries must be class components (hooks cannot catch errors
 * in sibling subtrees).
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100dvh',
            padding: '24px',
            background: '#f5f5f5',
            fontFamily: 'sans-serif',
            textAlign: 'center',
            gap: '12px',
          }}
        >
          <p style={{ fontWeight: 600, fontSize: '16px', color: '#0f172a' }}>
            Something went wrong
          </p>
          <p style={{ fontSize: '14px', color: '#7f7f7f', maxWidth: '280px' }}>
            The app hit an unexpected error. Reload to continue — your picks are saved.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: '8px',
              padding: '10px 24px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: '12px',
              fontSize: '15px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
