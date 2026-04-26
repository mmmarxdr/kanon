import type { SVGProps } from "react";

type IcoProps = SVGProps<SVGSVGElement>;

const base = {
  width: 14,
  height: 14,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const Icon = {
  Diamond: (p: IcoProps) => (
    <svg {...base} {...p}><path d="M8 1.5L14.5 8 8 14.5 1.5 8z" /></svg>
  ),
  Inbox: (p: IcoProps) => (
    <svg {...base} {...p}>
      <path d="M2 9h3l1 2h4l1-2h3" />
      <path d="M2 9V4l2-2h8l2 2v5" />
      <path d="M2 9v4a1 1 0 001 1h10a1 1 0 001-1V9" />
    </svg>
  ),
  Graph: (p: IcoProps) => (
    <svg {...base} {...p}>
      <circle cx="3.5" cy="3.5" r="1.5" />
      <circle cx="12.5" cy="8" r="1.5" />
      <circle cx="3.5" cy="12.5" r="1.5" />
      <path d="M5 4h5M5 12h5M11 7l-6-3M11 9l-6 3" />
    </svg>
  ),
  Board: (p: IcoProps) => (
    <svg {...base} {...p}>
      <rect x="2" y="2" width="3.5" height="12" rx="0.6" />
      <rect x="6.25" y="2" width="3.5" height="8" rx="0.6" />
      <rect x="10.5" y="2" width="3.5" height="10" rx="0.6" />
    </svg>
  ),
  Road: (p: IcoProps) => (
    <svg {...base} {...p}><path d="M2 4h12M3 8h10M5 12h8" /></svg>
  ),
  Backlog: (p: IcoProps) => (
    <svg {...base} {...p}>
      <rect x="2" y="3" width="12" height="2.5" rx="0.5" />
      <rect x="2" y="7" width="12" height="2.5" rx="0.5" />
      <rect x="2" y="11" width="12" height="2.5" rx="0.5" />
    </svg>
  ),
  Cycles: (p: IcoProps) => (
    <svg {...base} {...p}>
      <path d="M12 3.5L14 5.5 12 7.5" />
      <path d="M2.5 8V7a2.5 2.5 0 012.5-2.5h9" />
      <path d="M4 12.5L2 10.5 4 8.5" />
      <path d="M13.5 8v1A2.5 2.5 0 0111 11.5H2" />
    </svg>
  ),
  Settings: (p: IcoProps) => (
    <svg {...base} {...p}>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2M8 12.5v2M3.5 8H1.5M14.5 8h-2M4.4 4.4l-1.4-1.4M13 13l-1.4-1.4M4.4 11.6L3 13M13 3l-1.4 1.4" />
    </svg>
  ),
  Search: (p: IcoProps) => (
    <svg {...base} {...p}><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
  ),
  Plus: (p: IcoProps) => (
    <svg {...base} {...p}><path d="M8 3v10M3 8h10" /></svg>
  ),
  Filter: (p: IcoProps) => (
    <svg {...base} {...p}><path d="M2 3h12l-4.5 6v4l-3 1.5V9z" /></svg>
  ),
  ChevL: (p: IcoProps) => (
    <svg {...base} {...p}><path d="M10 3l-5 5 5 5" /></svg>
  ),
  ChevR: (p: IcoProps) => (
    <svg {...base} {...p}><path d="M6 3l5 5-5 5" /></svg>
  ),
  ChevD: (p: IcoProps) => (
    <svg {...base} {...p}><path d="M3 6l5 5 5-5" /></svg>
  ),
  More: (p: IcoProps) => (
    <svg {...base} {...p} fill="currentColor" stroke="none">
      <circle cx="3.5" cy="8" r="1.2" />
      <circle cx="8" cy="8" r="1.2" />
      <circle cx="12.5" cy="8" r="1.2" />
    </svg>
  ),
  Spark: (p: IcoProps) => (
    <svg {...base} {...p}>
      <path d="M8 1.5l1.6 4.4L14 7.5l-4.4 1.6L8 13.5 6.4 9.1 2 7.5l4.4-1.6z" />
    </svg>
  ),
  Link: (p: IcoProps) => (
    <svg {...base} {...p}>
      <path d="M7 9.5a3 3 0 004.2 0l2.3-2.3a3 3 0 10-4.2-4.2L8 4.5" />
      <path d="M9 6.5a3 3 0 00-4.2 0L2.5 8.8a3 3 0 104.2 4.2L8 11.5" />
    </svg>
  ),
  Check: (p: IcoProps) => (
    <svg {...base} {...p} strokeWidth={1.6}><path d="M3 8.5L6.5 12l7-7.5" /></svg>
  ),
  ArrowR: (p: IcoProps) => (
    <svg {...base} {...p}><path d="M3 8h10M9 4l4 4-4 4" /></svg>
  ),
  Cmd: (p: IcoProps) => (
    <svg {...base} {...p}>
      <path d="M5.5 5.5h5v5h-5z" />
      <path d="M5.5 5.5V4a1.5 1.5 0 10-1.5 1.5zM10.5 5.5V4a1.5 1.5 0 111.5 1.5zM5.5 10.5V12a1.5 1.5 0 11-1.5-1.5zM10.5 10.5V12a1.5 1.5 0 101.5-1.5z" />
    </svg>
  ),
  X: (p: IcoProps) => (
    <svg {...base} {...p}><path d="M4 4l8 8M12 4l-8 8" /></svg>
  ),
  Lock: (p: IcoProps) => (
    <svg {...base} {...p}>
      <rect x="3" y="7" width="10" height="7" rx="1.4" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
    </svg>
  ),
  Sun: (p: IcoProps) => (
    <svg {...base} {...p}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M2.5 8H1M15 8h-1.5M3.8 3.8l-1-1M13.2 13.2l-1-1M3.8 12.2l-1 1M13.2 2.8l-1 1" />
    </svg>
  ),
  Moon: (p: IcoProps) => (
    <svg {...base} {...p}><path d="M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 107 6.5z" /></svg>
  ),
  User: (p: IcoProps) => (
    <svg {...base} {...p}>
      <circle cx="8" cy="5" r="3" />
      <path d="M2.5 14a5.5 5.5 0 0 1 11 0" />
    </svg>
  ),
  Logout: (p: IcoProps) => (
    <svg {...base} {...p}>
      <path d="M6 14H3.5A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2H6" />
      <path d="M10.5 11.5L14 8L10.5 4.5" />
      <path d="M14 8H6" />
    </svg>
  ),
};

/* ────────── Monogram — geometric "K" rooted in the diamond ────────── */

export function Monogram({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2L22 12L12 22L2 12Z"
        stroke="var(--ink)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M9 7v10M9 12l5-4M9 12l5 5"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
