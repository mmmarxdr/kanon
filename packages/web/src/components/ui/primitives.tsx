import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/* ====================================================================
   Avatar — initials chip with optional agent styling
   ==================================================================== */

interface AvatarProps {
  initials: string;
  name?: string;
  size?: number;
  isAgent?: boolean;
  ring?: boolean;
}

export function Avatar({ initials, name, size = 20, isAgent = false, ring = false }: AvatarProps) {
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size,
    height: size,
    borderRadius: 4,
    background: isAgent ? "var(--ai-2)" : "var(--bg-3)",
    color: isAgent ? "var(--ai)" : "var(--ink-2)",
    fontSize: size <= 18 ? 9 : 10,
    fontWeight: 600,
    letterSpacing: "0.02em",
    outline: ring ? "1.5px solid var(--accent)" : "none",
    outlineOffset: 1,
    flexShrink: 0,
  };
  return (
    <span className="mono" style={style} title={name}>
      {initials.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function avatarInitials(name: string | null | undefined, fallback = "?") {
  if (!name) return fallback;
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || fallback;
}

/* ====================================================================
   Priority — geometric bars indicator
   ==================================================================== */

export type Priority = "low" | "medium" | "high" | "critical";

const PRIO_ORDER: Priority[] = ["low", "medium", "high", "critical"];

export function Prio({ value }: { value: Priority }) {
  const lvl = PRIO_ORDER.indexOf(value);
  const color =
    value === "critical" ? "var(--bad)"
    : value === "high" ? "var(--warn)"
    : value === "medium" ? "var(--ink-3)"
    : "var(--ink-4)";
  return (
    <span
      style={{ display: "inline-flex", alignItems: "flex-end", gap: 1.5, height: 12 }}
      title={value}
    >
      {[3, 6, 9, 12].map((h, i) => (
        <span
          key={i}
          style={{
            width: 2,
            height: h,
            borderRadius: 0.5,
            background: i <= lvl ? color : "var(--line-2)",
          }}
        />
      ))}
    </span>
  );
}

/* ====================================================================
   TypeGlyph — single-letter monospace tile
   ==================================================================== */

export type IssueType = "feature" | "bug" | "task" | "spike";

const TYPE_MAP: Record<IssueType, { letter: string; color: string; bg: string }> = {
  feature: { letter: "F", color: "var(--accent-ink)", bg: "var(--accent-2)" },
  bug:     { letter: "B", color: "var(--bad)",        bg: "color-mix(in oklch, var(--bad) 14%, transparent)" },
  task:    { letter: "T", color: "var(--ink-2)",      bg: "var(--bg-3)" },
  spike:   { letter: "S", color: "var(--ai)",         bg: "var(--ai-2)" },
};

export function TypeGlyph({ value }: { value: IssueType }) {
  const t = TYPE_MAP[value] ?? TYPE_MAP.task;
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 16,
        height: 16,
        borderRadius: 3,
        background: t.bg,
        color: t.color,
        fontSize: 9,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {t.letter}
    </span>
  );
}

/* ====================================================================
   StatePip — colored dot + label
   ==================================================================== */

export type IssueState =
  | "backlog"
  | "todo"
  | "in_progress"
  | "review"
  | "done"
  | "idea"
  | "planned";

const STATE_MAP: Record<IssueState, { label: string; dot: string }> = {
  backlog:     { label: "Backlog",     dot: "var(--ink-4)" },
  todo:        { label: "Todo",        dot: "var(--ink-3)" },
  in_progress: { label: "In progress", dot: "var(--accent)" },
  review:      { label: "In review",   dot: "var(--ai)" },
  done:        { label: "Done",        dot: "var(--ok)" },
  idea:        { label: "Idea",        dot: "var(--ink-4)" },
  planned:     { label: "Planned",     dot: "var(--ink-3)" },
};

export function StatePip({ state, hideLabel = false }: { state: IssueState; hideLabel?: boolean }) {
  const s = STATE_MAP[state] ?? STATE_MAP.todo;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: "var(--ink-2)",
        fontSize: 12,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: s.dot,
          boxShadow: `0 0 0 2px color-mix(in oklch, ${s.dot} 16%, transparent)`,
          flexShrink: 0,
        }}
      />
      {!hideLabel && s.label}
    </span>
  );
}

export function stateLabel(state: IssueState) {
  return (STATE_MAP[state] ?? STATE_MAP.todo).label;
}

/* ====================================================================
   Tag — small mono pill (used for labels)
   ==================================================================== */

export function Tag({
  children,
  kind = "default",
}: {
  children: ReactNode;
  kind?: "default" | "sdd" | "ai";
}) {
  const styles = {
    default: { color: "var(--ink-3)", bg: "var(--bg-3)", border: "var(--line)" },
    sdd:     { color: "var(--accent-ink)", bg: "var(--accent-2)", border: "transparent" },
    ai:      { color: "var(--ai)", bg: "var(--ai-2)", border: "transparent" },
  } as const;
  const s = styles[kind] ?? styles.default;
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 6px",
        borderRadius: 3,
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: "0.02em",
      }}
    >
      {children}
    </span>
  );
}

/* ====================================================================
   Kbd — keyboard-key pill
   ==================================================================== */

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 18,
        height: 18,
        padding: "0 4px",
        background: "var(--bg-3)",
        border: "1px solid var(--line)",
        borderRadius: 3,
        fontSize: 10,
        color: "var(--ink-2)",
      }}
    >
      {children}
    </span>
  );
}

/* ====================================================================
   FilterChip — toolbar dashed-border chip
   ==================================================================== */

export function FilterChip({
  children,
  onClick,
  active = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 26,
        padding: "0 8px",
        background: active ? "var(--bg-3)" : "var(--panel)",
        border: active
          ? "1px solid var(--line-2)"
          : "1px dashed var(--line-2)",
        borderRadius: 4,
        fontSize: 11.5,
        color: active ? "var(--ink-2)" : "var(--ink-3)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/* ====================================================================
   FilterChipSelect — dashed chip + custom popover (no native select)
   ==================================================================== */

export function FilterChipSelect({
  label,
  value,
  options,
  onChange,
  allLabel,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const displayValue = selected?.label ?? allLabel ?? "any";
  const active = !!value;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 26,
          padding: "0 8px",
          background: active ? "var(--bg-3)" : "var(--panel)",
          border: active
            ? "1px solid var(--line-2)"
            : "1px dashed var(--line-2)",
          borderRadius: 4,
          fontSize: 11.5,
          color: active ? "var(--ink-2)" : "var(--ink-3)",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <span>
          {label}:{" "}
          <span style={{ color: "var(--ink-2)" }}>{displayValue}</span>
        </span>
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            color: "var(--ink-4)",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 120ms",
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 6l5 5 5-5" />
          </svg>
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 30,
            minWidth: 180,
            maxHeight: 280,
            overflow: "auto",
            padding: 4,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            boxShadow:
              "0 8px 24px color-mix(in oklch, black 25%, transparent)",
          }}
        >
          <FilterOption
            label={allLabel ?? `All ${label.toLowerCase()}`}
            selected={!value}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            mono
          />
          {options.map((o) => (
            <FilterOption
              key={o.value}
              label={o.label}
              selected={value === o.value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterOption({
  label,
  selected,
  onClick,
  mono = false,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  mono?: boolean;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={mono ? "mono" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "6px 8px",
        textAlign: "left",
        borderRadius: 4,
        fontSize: mono ? 11 : 12,
        color: selected ? "var(--ink)" : "var(--ink-2)",
        background: selected ? "var(--bg-3)" : "transparent",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        if (selected) return;
        e.currentTarget.style.background = "var(--bg-2)";
      }}
      onMouseLeave={(e) => {
        if (selected) return;
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ flex: 1 }}>{label}</span>
      {selected && (
        <svg
          width="11"
          height="11"
          viewBox="0 0 16 16"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 8.5L6.5 12l7-7.5" />
        </svg>
      )}
    </button>
  );
}

/* ====================================================================
   SearchChip — compact pill with leading icon, matches the board toolbar
   ==================================================================== */

export function SearchChip({
  value,
  onChange,
  placeholder = "Search…",
  width = 220,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number;
}) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    if (local === value) return;
    timer.current = setTimeout(() => onChange(local), 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 26,
        padding: "0 8px",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 4,
        width,
        color: "var(--ink-3)",
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      >
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5L14 14" />
      </svg>
      <input
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          height: "100%",
          border: 0,
          outline: 0,
          background: "transparent",
          color: "var(--ink)",
          fontSize: 11.5,
          minWidth: 0,
        }}
      />
      {local && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setLocal("");
            onChange("");
          }}
          style={{
            color: "var(--ink-4)",
            display: "inline-flex",
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      )}
    </div>
  );
}

/* ====================================================================
   Segmented — small segmented control
   ==================================================================== */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange?: (id: T) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--bg-3)",
        borderRadius: 5,
        padding: 2,
        border: "1px solid var(--line)",
      }}
    >
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange?.(o.id)}
            style={{
              padding: "3px 10px",
              borderRadius: 4,
              fontSize: 11.5,
              background: active ? "var(--panel)" : "transparent",
              color: active ? "var(--ink)" : "var(--ink-3)",
              fontWeight: active ? 500 : 400,
              boxShadow: active ? "0 1px 0 var(--line)" : "none",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ====================================================================
   ScoreBar — small effort/impact dot bar
   ==================================================================== */

export function ScoreBar({
  label,
  value,
  max = 5,
  tone = "accent",
}: {
  label: string;
  value: number | null | undefined;
  max?: number;
  tone?: "warn" | "ok" | "accent";
}) {
  if (value == null) return null;
  const tones = {
    warn: "var(--warn)",
    ok: "var(--ok)",
    accent: "var(--accent)",
  } as const;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>
        {label}
      </span>
      <span style={{ display: "inline-flex", gap: 1.5 }}>
        {Array.from({ length: max }).map((_, i) => (
          <span
            key={i}
            style={{
              width: 5,
              height: 6,
              borderRadius: 1,
              background: i < value ? tones[tone] : "var(--line-2)",
            }}
          />
        ))}
      </span>
    </span>
  );
}
