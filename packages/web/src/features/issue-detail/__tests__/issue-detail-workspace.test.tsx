import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import { DependenciesSection } from "../dependencies-section";
import { IssueDetailWorkspace } from "../issue-detail-workspace";

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

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
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
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
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  render(<IssueDetailWorkspace state={{ kind: "ready" }} />);

  await userEvent.setup().click(screen.getByRole("button", { name: "Resources" }));

  const announcement = screen.getByTestId("issue-section-announcement");
  expect(announcement).toHaveRole("status");
  expect(announcement).toHaveAttribute("aria-live", "polite");
  expect(announcement).toHaveTextContent("Resources section");
  expect(screen.getByTestId("issue-detail-scroll")).not.toHaveAttribute("aria-live");
  expect(screen.getByRole("button", { name: "Resources" })).toHaveAttribute("aria-current", "location");
});

it("localizes the navigation label and reached-section announcement", async () => {
  const { userEvent } = await import("@testing-library/user-event");
  await i18n.changeLanguage("es");
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  render(<IssueDetailWorkspace state={{ kind: "ready" }} />);

  expect(screen.getByRole("navigation", { name: "Secciones de la issue" })).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "Recursos" }));

  expect(screen.getByTestId("issue-section-announcement")).toHaveTextContent("Sección Recursos");
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
  const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
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
  expect(screen.getByTestId("issue-section-announcement")).toHaveTextContent("Resources section");
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
});

it("places supplied narrow metadata inside the sole scroll document", () => {
  render(<IssueDetailWorkspace state={{ kind: "ready" }} metadata={<div data-testid="metadata-section">Properties</div>} />);
  expect(screen.getByTestId("issue-detail-scroll")).toContainElement(screen.getByTestId("metadata-section"));
});

it("marks the activated Development section as current", async () => {
  const { userEvent } = await import("@testing-library/user-event");
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  render(<IssueDetailWorkspace state={{ kind: "ready" }} />);

  await userEvent.setup().click(screen.getByRole("button", { name: "Development" }));

  expect(screen.getByRole("button", { name: "Development" })).toHaveAttribute("aria-current", "location");
  expect(screen.getByTestId("issue-section-announcement")).toHaveTextContent("Development section");
});
