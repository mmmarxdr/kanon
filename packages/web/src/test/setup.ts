import "@testing-library/jest-dom/vitest";
import i18n from "@/i18n";

// jsdom does not implement scrollIntoView — stub it globally so component
// tests that trigger scroll effects (e.g. command-palette keyboard nav) do
// not throw "selected.scrollIntoView is not a function".
Element.prototype.scrollIntoView = () => {};

// Pin UI language so assertions on English copy stay stable (KAN-158).
void i18n.changeLanguage("en");
