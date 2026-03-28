import { useEffect, useRef, useState } from "react";

/**
 * Hook that measures a container element's width via ResizeObserver.
 * Returns [ref, width] — attach the ref to the container div.
 * Width defaults to 0 before first measurement; consumers should
 * guard rendering (e.g. `width > 0`) to avoid negative-dimension warnings.
 */
export function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setWidth(w);
      }
    });

    observer.observe(el);
    // Capture initial width
    const initial = el.getBoundingClientRect().width;
    if (initial > 0) setWidth(initial);

    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
