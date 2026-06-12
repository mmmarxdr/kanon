import { createRoute, redirect, lazyRouteComponent } from "@tanstack/react-router";
import { authenticatedRoute } from "../_authenticated";

function BoardErrorFallback() {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        role="alert"
        style={{
          padding: "16px 24px",
          borderRadius: 6,
          border: "1px solid var(--bad, #f87171)",
          background: "var(--bg-2, #1a1a1a)",
          color: "var(--bad, #f87171)",
          fontSize: 12,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          maxWidth: 320,
        }}
      >
        <span style={{ fontWeight: 600 }}>Board failed to render</span>
        <span style={{ color: "var(--ink-3, #888)", fontSize: 11 }}>
          Reload the page to try again.
        </span>
      </div>
    </div>
  );
}

export const boardRoute = createRoute({
  path: "/board/$projectKey",
  getParentRoute: () => authenticatedRoute,
  component: lazyRouteComponent(() => import("./board-page")),
  errorComponent: BoardErrorFallback,
  validateSearch: (
    search: Record<string, unknown>,
  ): { view?: "grouped" | "flat" } => {
    const view = search["view"];
    return view === "grouped" || view === "flat" ? { view } : {};
  },
  beforeLoad: ({ params }) => {
    if (!params.projectKey || params.projectKey.trim() === "") {
      throw redirect({ to: "/" });
    }
  },
});
