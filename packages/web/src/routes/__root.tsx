import { createRootRoute, Outlet } from "@tanstack/react-router";

export const rootRoute = createRootRoute({
  component: RootLayout,
  errorComponent: RootErrorFallback,
});

function RootLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Outlet />
    </div>
  );
}

function RootErrorFallback() {
  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg, #0d0d0d)",
      }}
    >
      <div
        role="alert"
        style={{
          padding: "24px 32px",
          borderRadius: 8,
          border: "1px solid var(--bad, #f87171)",
          background: "var(--bg-2, #1a1a1a)",
          color: "var(--bad, #f87171)",
          fontSize: 13,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          maxWidth: 400,
        }}
      >
        <span style={{ fontWeight: 600 }}>Something went wrong</span>
        <span style={{ color: "var(--ink-3, #888)", fontSize: 12 }}>
          Reload the page or contact support if this persists.
        </span>
      </div>
    </div>
  );
}
