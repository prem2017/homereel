import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { reportToServer } from '../utils/remoteLog';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** What is inside, as the message and the log line name it: "player", "app". */
  what: string;
  /** A change clears the error, so picking another file tries the player again. */
  resetKey?: string | null;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Keeps a render error inside this box, and tells the server about it.
 *
 * Without one, React 18 unmounts the whole root on a render error. On a TV with
 * no devtools that is a blank page and nothing to go on, which is what an
 * unguarded `play().catch` and a null folder listing both produced before they
 * were found. Renders nothing of its own until something throws.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportToServer(`The ${this.props.what} crashed: ${error.message}${info.componentStack || ''}`);
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // No gap-*, no focus-visible: - the reference TV is Chromium 47.
    return (
      <div role="alert" className="flex items-center justify-center h-full bg-black text-gray-300 rounded-lg px-6 py-6">
        <div className="max-w-lg text-center">
          <AlertTriangle size={40} className="mx-auto mb-3 text-amber-400" />
          <p className="text-lg font-semibold text-white">The {this.props.what} stopped working</p>
          <p className="mt-2 text-sm text-gray-400 break-words">{error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 text-sm px-4 py-2 rounded bg-blue-700 text-white hover:bg-blue-600 focus:outline-none focus:bg-blue-500"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
