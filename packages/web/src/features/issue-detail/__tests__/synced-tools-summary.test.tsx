import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { SyncedToolsSummaryContent } from "../synced-tools-summary";
import type { TimelineItem } from "../timeline-types";

const oldest: TimelineItem = {
  id: "sync-oldest",
  kind: "human-comment",
  body: "Older sync",
  author: { username: "alice" },
  via: "claude-code",
  createdAt: "2026-08-12T10:00:00.000Z",
};
const latest: TimelineItem = {
  id: "sync-latest",
  kind: "agent-comment",
  body: "Latest sync",
  source: "mcp",
  author: { username: "codex" },
  via: "codex",
  createdAt: "2026-08-12T12:00:00.000Z",
};

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("SyncedToolsSummaryContent", () => {
  it("renders the synced count and only the latest provenance row", () => {
    render(<SyncedToolsSummaryContent items={[oldest, latest]} isLoading={false} isError={false} />);

    expect(screen.getByTestId("synced-tools-summary")).toHaveTextContent("2 synced tool items");
    expect(screen.getByTestId("synced-tools-summary-latest")).toHaveTextContent("Codex");
    expect(screen.getByTestId("synced-tools-summary-latest")).toHaveTextContent("2026-08-12T12:00:00.000Z");
    expect(screen.queryByText("Claude Code")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("synced-tools-summary-latest")).toHaveLength(1);
  });

  it.each([
    ["loading", { items: [latest], isLoading: true, isError: false }, "Loading synced tools…"],
    ["unavailable", { items: [latest], isLoading: false, isError: true }, "Synced tools are unavailable."],
    ["empty", { items: [], isLoading: false, isError: false }, "No synced tool activity."],
  ] as const)("renders the %s state without a history row", (_state, result, expected) => {
    render(<SyncedToolsSummaryContent {...result} />);

    expect(screen.getByTestId("synced-tools-summary")).toHaveTextContent(expected);
    expect(screen.queryByTestId("synced-tools-summary-latest")).not.toBeInTheDocument();
  });

  it.each([
    ["en", [latest], "1 synced tool item"],
    ["en", [oldest, latest], "2 synced tool items"],
    ["es", [latest], "1 elemento sincronizado desde herramientas"],
    ["es", [oldest, latest], "2 elementos sincronizados desde herramientas"],
  ] as const)("renders the %s singular/plural count for %s items", async (language, items, expected) => {
    await i18n.changeLanguage(language);
    render(<SyncedToolsSummaryContent items={items} isLoading={false} isError={false} />);

    expect(screen.getByTestId("synced-tools-summary")).toHaveTextContent(expected);
  });

  it("localizes every summary state", async () => {
    await i18n.changeLanguage("es");
    const { rerender } = render(<SyncedToolsSummaryContent items={[latest]} isLoading isError={false} />);

    expect(screen.getByTestId("synced-tools-summary")).toHaveTextContent("Cargando herramientas sincronizadas…");

    rerender(<SyncedToolsSummaryContent items={[latest]} isLoading={false} isError />);
    expect(screen.getByTestId("synced-tools-summary")).toHaveTextContent("Las herramientas sincronizadas no están disponibles.");

    rerender(<SyncedToolsSummaryContent items={[]} isLoading={false} isError={false} />);
    expect(screen.getByTestId("synced-tools-summary")).toHaveTextContent("No hay actividad sincronizada desde herramientas.");
  });
});
