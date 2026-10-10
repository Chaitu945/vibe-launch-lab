import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string;
  asyncErrors: string[];
}

/**
 * Nothing in this app should ever take the page down to a blank screen.
 *
 * A render-time exception with no boundary unmounts the entire tree in React 19,
 * which is exactly what a white page is, and it hides the error from whoever
 * could report it. This catches render errors AND unhandled promise rejections /
 * window errors, and prints them in the UI so a failure is diagnosable from a
 * screenshot instead of guesswork.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: "", asyncErrors: [] };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info: info.componentStack ?? "" });
    console.error("[launch-lab] render error", error, info);
  }

  componentDidMount() {
    window.addEventListener("error", this.onWindowError);
    window.addEventListener("unhandledrejection", this.onRejection);
  }

  componentWillUnmount() {
    window.removeEventListener("error", this.onWindowError);
    window.removeEventListener("unhandledrejection", this.onRejection);
  }

  onWindowError = (e: ErrorEvent) => {
    this.push(`${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`);
  };

  onRejection = (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    this.push(reason instanceof Error ? `${reason.message}\n${reason.stack ?? ""}` : String(reason));
  };

  push(message: string) {
    this.setState((s) => ({ asyncErrors: [...s.asyncErrors.slice(-4), message] }));
  }

  render() {
    const { error, info, asyncErrors } = this.state;
    const hasRender = Boolean(error);
    if (!hasRender && asyncErrors.length === 0) return this.props.children;

    return (
      <div className="crash">
        <h2>{hasRender ? "The feed crashed while rendering" : "An async error was reported"}</h2>
        <p className="muted small">
          This is a bug, not a data problem. Nothing below is fabricated: it is the actual exception, shown instead of a blank
          page.
        </p>
        {error && (
          <>
            <pre className="crash-pre">{error.message}</pre>
            {error.stack && <pre className="crash-pre dim">{error.stack.slice(0, 1200)}</pre>}
            {info && <pre className="crash-pre dim">component stack:{info.slice(0, 700)}</pre>}
          </>
        )}
        {asyncErrors.map((m, i) => (
          <pre className="crash-pre dim" key={i}>
            {m.slice(0, 800)}
          </pre>
        ))}
        <div className="crash-actions">
          <button className="primary" onClick={() => this.setState({ error: null, info: "", asyncErrors: [] })}>
            dismiss and reload
          </button>
        </div>
      </div>
    );
  }
}
