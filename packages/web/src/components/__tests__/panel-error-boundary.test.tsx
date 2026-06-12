/**
 * KAN-88 Slice 2 — Granular error boundaries
 *
 * These tests prove that:
 * EB-1: A child that throws during render is caught by PanelErrorBoundary
 *       and shows the compact fallback instead of crashing the whole tree.
 * EB-2: A sibling of a throwing component (wrapped in its own boundary) is
 *       NOT affected — it continues to render normally.
 * EB-3: PanelErrorBoundary accepts a custom `label` prop shown in the fallback.
 * EB-4: A custom `fallback` render prop overrides the default fallback UI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// Suppress React's error boundary console.error noise in test output
const originalError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});
afterEach(() => {
  console.error = originalError;
});

// Component that unconditionally throws during render — returns never
function Bomb({ message }: { message?: string }): never {
  throw new Error(message ?? "test-render-error");
}

describe("PanelErrorBoundary — contains render errors (KAN-88 Slice 2)", () => {
  it("EB-1: renders fallback UI when a child throws", async () => {
    const { PanelErrorBoundary } = await import("../panel-error-boundary");

    render(
      <PanelErrorBoundary>
        <Bomb />
      </PanelErrorBoundary>,
    );

    // Default fallback must render — not a blank screen
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // The Bomb must NOT bubble up to the outer tree
    expect(screen.queryByText("test-render-error")).not.toBeInTheDocument();
  });

  it("EB-2: a sibling boundary is not affected by a throwing sibling", async () => {
    const { PanelErrorBoundary } = await import("../panel-error-boundary");

    render(
      <div>
        <PanelErrorBoundary label="broken-panel">
          <Bomb message="only-this-panel-breaks" />
        </PanelErrorBoundary>
        <PanelErrorBoundary label="healthy-panel">
          <span>healthy content</span>
        </PanelErrorBoundary>
      </div>,
    );

    // Broken panel shows fallback
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Healthy sibling renders normally
    expect(screen.getByText("healthy content")).toBeInTheDocument();
  });

  it("EB-3: fallback message includes the label when provided", async () => {
    const { PanelErrorBoundary } = await import("../panel-error-boundary");

    render(
      <PanelErrorBoundary label="Board column">
        <Bomb />
      </PanelErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/board column/i);
  });

  it("EB-4: custom fallback render prop overrides default fallback UI", async () => {
    const { PanelErrorBoundary } = await import("../panel-error-boundary");

    render(
      <PanelErrorBoundary fallback={<div data-testid="custom-fb">custom fallback</div>}>
        <Bomb />
      </PanelErrorBoundary>,
    );

    expect(screen.getByTestId("custom-fb")).toBeInTheDocument();
    expect(screen.getByText("custom fallback")).toBeInTheDocument();
  });
});
