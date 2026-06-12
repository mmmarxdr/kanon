import { Component, type ErrorInfo, type ReactNode } from "react";

interface PanelErrorBoundaryProps {
  /** Label shown in the default fallback message, e.g. "Board column". */
  label?: string;
  /** Custom fallback element. When provided, replaces the default fallback UI. */
  fallback?: ReactNode;
  children: ReactNode;
}

interface PanelErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Compact React class error boundary for board panels and widgets.
 *
 * Catches render/lifecycle errors in its subtree and displays a contained
 * fallback instead of propagating the crash to the route root. Each usage
 * site wraps an independent panel, so a single bad card or column never
 * white-screens the whole board.
 *
 * Usage:
 *   <PanelErrorBoundary label="Board column">
 *     <BoardColumn ... />
 *   </PanelErrorBoundary>
 */
export class PanelErrorBoundary extends Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  constructor(props: PanelErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to console for observability; can be swapped for a real error tracker.
    console.error("[PanelErrorBoundary] Caught render error:", error, info);
  }

  override render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback !== undefined) {
      return this.props.fallback;
    }

    const label = this.props.label ?? "panel";

    return (
      <div
        role="alert"
        style={{
          padding: "12px 16px",
          margin: 8,
          borderRadius: 6,
          border: "1px solid var(--bad, #f87171)",
          background: "var(--bg-2, #1a1a1a)",
          color: "var(--bad, #f87171)",
          fontSize: 11,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <span style={{ fontWeight: 600, textTransform: "capitalize" }}>
          {label} failed to render
        </span>
        <span style={{ color: "var(--ink-3, #888)", fontSize: 10.5 }}>
          Reload the page or contact support if this persists.
        </span>
      </div>
    );
  }
}
