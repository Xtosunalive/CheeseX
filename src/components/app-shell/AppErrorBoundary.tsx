import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Panel } from "@/components/panel";
import { TERM } from "@/constants/term-const";
import { APP_SHELL_COPY } from "../components-copy";

interface Props {
  boundaryName: string;
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      `[ErrorBoundary:${this.props.boundaryName}]`,
      error.message,
      info.componentStack?.slice(0, 200),
    );
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex h-full items-center justify-center p-8">
          <Panel className="max-w-md p-8 text-center ring-status-error-6">
            <AlertTriangle className="mx-auto mb-3 h-6 w-6 text-status-error-11" />
            <p className="text-sm font-medium text-text-sub">
              {this.props.boundaryName}
            </p>
            <p className="mt-2 text-xs text-text-hint">
              {this.state.error?.message || APP_SHELL_COPY.UNKNOWN_ERROR}
            </p>
            <button
              onClick={this.handleRetry}
              className="mt-4 inline-flex items-center gap-2 rounded-lg ring-1 ring-border-thin bg-surface-hover px-4 py-2 text-xs text-text-sub hover:bg-surface-hover transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              {TERM.RETRY_ACTION}
            </button>
          </Panel>
        </div>
      );
    }

    return this.props.children;
  }
}
