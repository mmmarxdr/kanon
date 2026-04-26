import { create } from "zustand";

export type CommandPaletteMode = "search" | "ai";

interface CommandPaletteState {
  /** Whether the palette is open. */
  isOpen: boolean;
  /** Active mode — search vs ask Kanon (AI). */
  mode: CommandPaletteMode;
  /** Whether the "create new issue" request was triggered from the palette. */
  createIssueRequested: boolean;

  open: (mode?: CommandPaletteMode) => void;
  close: () => void;
  toggle: (mode?: CommandPaletteMode) => void;
  setMode: (mode: CommandPaletteMode) => void;

  requestCreateIssue: () => void;
  clearCreateIssueRequest: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  isOpen: false,
  mode: "search",
  createIssueRequested: false,

  open: (mode = "search") => set({ isOpen: true, mode }),
  close: () => set({ isOpen: false }),
  toggle: (mode = "search") =>
    set((s) => (s.isOpen ? { isOpen: false } : { isOpen: true, mode })),
  setMode: (mode) => set({ mode }),

  requestCreateIssue: () => set({ createIssueRequested: true }),
  clearCreateIssueRequest: () => set({ createIssueRequested: false }),
}));
