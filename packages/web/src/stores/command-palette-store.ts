import { create } from "zustand";

interface CommandPaletteState {
  /** Whether the "create new issue" request was triggered from the command palette. */
  createIssueRequested: boolean;
  /** Request opening the New Issue modal from the command palette. */
  requestCreateIssue: () => void;
  /** Clear the request (called after the modal opens). */
  clearCreateIssueRequest: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  createIssueRequested: false,
  requestCreateIssue: () => set({ createIssueRequested: true }),
  clearCreateIssueRequest: () => set({ createIssueRequested: false }),
}));
