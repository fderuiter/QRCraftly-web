import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/Button';
import { RotateCcw } from 'lucide-react';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center p-8 text-center text-fg-soft">
          <h2 role="alert" className="mb-4 text-3xl font-bold text-danger">Application Error</h2>
          <p className="mb-8 text-lg">We're sorry, but something went wrong while rendering this page.</p>
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.reload();
              }
            }}
          >
            Reload Page
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

interface PanelState {
  error: Error | null;
}

/**
 * Error boundary for one tool panel (controls, preview or secondary controls). A crash
 * inside the panel shows a short message with a Reload panel button instead of taking
 * down the whole page; the tool's state lives above the panel, so nothing is lost.
 */
export class PanelErrorBoundary extends Component<{ children?: ReactNode }, PanelState> {
  public state: PanelState = { error: null };

  public static getDerivedStateFromError(error: Error): PanelState {
    return { error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Panel error:', error, errorInfo);
  }

  public render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-danger-line bg-danger-soft p-4 text-sm text-fg-soft">
        <p>
          <span className="font-semibold text-danger">This panel hit a snag.</span> Your design is safe in this tab.
        </p>
        <Button variant="outline" size="sm" onClick={() => this.setState({ error: null })}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Reload panel
        </Button>
      </div>
    );
  }
}
