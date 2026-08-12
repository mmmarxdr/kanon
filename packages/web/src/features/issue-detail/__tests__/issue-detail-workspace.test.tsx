import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import { DependenciesSection } from "../dependencies-section";
import { IssueDetailWorkspace } from "../issue-detail-workspace";

describe("IssueDetailWorkspace", () => {
  it.each(["loading", "error", "not-found"] as const)("keeps all five landmarks mounted for %s", (kind) => {
    render(<IssueDetailWorkspace state={{ kind }} />);
    expect(screen.getAllByRole("region")).toHaveLength(5);
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Development" })).toBeInTheDocument();
  });

  it("renders an unavailable Development contract without provider integration", () => {
    render(<IssueDetailWorkspace state={{ kind: "ready" }} />);
    expect(screen.getByText("Development data is unavailable.")).toBeInTheDocument();
  });
});

it("moves focus to the stable target heading", async () => {
  const { userEvent } = await import("@testing-library/user-event");
  Element.prototype.scrollIntoView = vi.fn();
  render(<IssueDetailWorkspace state={{ kind: "ready" }} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Resources" }));
  expect(screen.getByRole("heading", { name: "Resources" })).toHaveFocus();
});

it("localizes issue-state feedback without confusing an error for loading", async () => {
  await i18n.changeLanguage("es");
  const { unmount } = render(<IssueDetailWorkspace state={{ kind: "error" }} />);

  expect(screen.getAllByRole("alert")).toHaveLength(5);
  expect(screen.getAllByRole("alert")).toEqual(
    expect.arrayContaining([expect.objectContaining({ textContent: "No se pudo cargar esta issue." })]),
  );
  expect(screen.queryByText("Cargando issue…")).not.toBeInTheDocument();

  unmount();
  await i18n.changeLanguage("en");
});

it("offers the safe return action when an issue is not found", async () => {
  const { userEvent } = await import("@testing-library/user-event");
  const onBack = vi.fn();
  render(<IssueDetailWorkspace state={{ kind: "not-found" }} onBack={onBack} />);

  await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));

  expect(onBack).toHaveBeenCalledOnce();
});

it("announces the reached location and exposes it as the current navigation item", async () => {
  const { userEvent } = await import("@testing-library/user-event");
  Element.prototype.scrollIntoView = vi.fn();
  render(<IssueDetailWorkspace state={{ kind: "ready" }} />);

  await userEvent.setup().click(screen.getByRole("button", { name: "Resources" }));

  expect(screen.getByRole("status")).toHaveTextContent("Resources section");
  expect(screen.getByRole("button", { name: "Resources" })).toHaveAttribute("aria-current", "location");
});

it("renders a localized empty state when relationships have no children or dependencies", () => {
  render(
    <IssueDetailWorkspace
      state={{ kind: "ready" }}
      relationships={<DependenciesSection blocks={[]} blockedBy={[]} childrenCount={0} />}
    />,
  );

  expect(screen.getByText("No relationships yet.")).toBeInTheDocument();
});

it("activates section navigation by keyboard with reduced motion", async () => {
  const { userEvent } = await import("@testing-library/user-event");
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
  render(<IssueDetailWorkspace state={{ kind: "ready" }} />);
  const user = userEvent.setup();

  await user.tab();
  await user.tab();
  await user.tab();
  await user.tab();
  await user.keyboard("{Enter}");

  expect(screen.getByRole("heading", { name: "Resources" })).toHaveFocus();
  expect(screen.getByRole("button", { name: "Resources" })).toHaveAttribute("aria-current", "location");
  expect(screen.getAllByRole("button", { current: "location" })).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent("Resources section");
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
});

it("places supplied narrow metadata inside the sole scroll document", () => {
  render(<IssueDetailWorkspace state={{ kind: "ready" }} metadata={<div data-testid="metadata-section">Properties</div>} />);
  expect(screen.getByTestId("issue-detail-scroll")).toContainElement(screen.getByTestId("metadata-section"));
});

it("keeps explicit navigation current when stale observer and scroll events arrive", async () => {
  const { userEvent } = await import("@testing-library/user-event");
  let callback: IntersectionObserverCallback | undefined;
  class Observer {
    observe = vi.fn(); disconnect = vi.fn(); unobserve = vi.fn(); takeRecords = vi.fn(() => []);
    constructor(next: IntersectionObserverCallback) { callback = next; }
    root = null; rootMargin = ""; thresholds = [0];
  }
  vi.stubGlobal("IntersectionObserver", Observer);
  Element.prototype.scrollIntoView = vi.fn();
  const { container } = render(<IssueDetailWorkspace state={{ kind: "ready" }} />);
  const scrollRoot = screen.getByTestId("issue-detail-scroll");
  Object.defineProperties(scrollRoot, {
    clientHeight: { configurable: true, get: () => 500 },
    scrollHeight: { configurable: true, get: () => 1_000 },
    scrollTop: { configurable: true, get: () => 500 },
  });
  vi.spyOn(scrollRoot, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
  for (const [id, top] of Object.entries({ general: -800, activity: -400, relationships: -200, resources: 0, development: 140 })) {
    vi.spyOn(container.querySelector(`#issue-section-${id}`)!, "getBoundingClientRect").mockReturnValue({ top } as DOMRect);
  }

  await userEvent.setup().click(screen.getByRole("button", { name: "Development" }));
  act(() => scrollRoot.dispatchEvent(new Event("scroll")));
  act(() => scrollRoot.dispatchEvent(new Event("scrollend")));
  act(() => callback?.([{ target: container.querySelector("#issue-section-resources")!, isIntersecting: true, intersectionRatio: 0.1, boundingClientRect: { top: 0 } } as IntersectionObserverEntry], {} as IntersectionObserver));

  expect(screen.getByRole("button", { name: "Development" })).toHaveAttribute("aria-current", "location");
  expect(screen.getByRole("status")).toHaveTextContent("Development section");
});
