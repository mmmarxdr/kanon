import "@testing-library/jest-dom/vitest";

// jsdom does not implement scrollIntoView — stub it globally so component
// tests that trigger scroll effects (e.g. command-palette keyboard nav) do
// not throw "selected.scrollIntoView is not a function".
Element.prototype.scrollIntoView = () => {};
