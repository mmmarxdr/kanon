import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

// FocusTrap calls into real DOM and can cause issues in jsdom — stub it out
vi.mock("focus-trap-react", () => ({
  FocusTrap: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const MODAL_URL = "kanon://server.example.com/onboard?token=eyJhbGciOiJIUzI1NiJ9.abc.xyz";
const MODAL_EXPIRES_AT = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

async function renderModal(overrides: Partial<{
  open: boolean;
  onClose: () => void;
  url: string;
  expiresAt: string;
}> = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const { OnboardingLinkModal } = await import("./onboarding-link-modal");
  render(
    <OnboardingLinkModal
      open={overrides.open ?? true}
      onClose={onClose}
      url={overrides.url ?? MODAL_URL}
      expiresAt={overrides.expiresAt ?? MODAL_EXPIRES_AT}
    />,
  );
  return { onClose };
}

describe("OnboardingLinkModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stub clipboard
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the kanon:// URL", async () => {
    await renderModal();
    expect(screen.getByTestId("onboarding-url")).toHaveTextContent(MODAL_URL);
  });

  it("copy button calls navigator.clipboard.writeText with the URL", async () => {
    await renderModal();
    fireEvent.click(screen.getByTestId("onboarding-copy-btn"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(MODAL_URL);
  });

  it("renders expiry text containing 'Expires'", async () => {
    await renderModal();
    expect(screen.getByTestId("onboarding-expiry")).toHaveTextContent(/Expires/i);
  });

  it("close button calls onClose", async () => {
    const onClose = vi.fn();
    await renderModal({ onClose });
    fireEvent.click(screen.getByTestId("onboarding-close-btn"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("pressing Escape calls onClose", async () => {
    const onClose = vi.fn();
    await renderModal({ onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not render when open=false", async () => {
    await renderModal({ open: false });
    expect(screen.queryByTestId("onboarding-link-modal")).toBeNull();
  });
});
