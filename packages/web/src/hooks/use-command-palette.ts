import { useEffect } from "react";
import { useCommandPaletteStore } from "@/stores/command-palette-store";

/**
 * Hook to manage Command Palette open/close state.
 * Listens for Cmd+K (search) and Cmd+J (ask Kanon / AI) globally.
 */
export function useCommandPalette() {
  const isOpen = useCommandPaletteStore((s) => s.isOpen);
  const mode = useCommandPaletteStore((s) => s.mode);
  const open = useCommandPaletteStore((s) => s.open);
  const close = useCommandPaletteStore((s) => s.close);
  const toggle = useCommandPaletteStore((s) => s.toggle);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle("search");
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggle("ai");
      } else if (e.key === "Escape" && useCommandPaletteStore.getState().isOpen) {
        close();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [toggle, close]);

  return { isOpen, mode, open, close, toggle };
}
