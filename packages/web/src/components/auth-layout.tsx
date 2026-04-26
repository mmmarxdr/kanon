import type { ReactNode } from "react";
import { Monogram } from "@/components/ui/icons";

interface AuthLayoutProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  /** Footer text rendered above ©. Optional */
  footer?: ReactNode;
}

export function AuthLayout({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: AuthLayoutProps) {
  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        display: "grid",
        gridTemplateColumns: "minmax(360px, 44%) 1fr",
        background: "var(--bg)",
      }}
    >
      <BrandPanel eyebrow={eyebrow} title={title} subtitle={subtitle} />
      <FormPanel footer={footer}>{children}</FormPanel>
    </div>
  );
}

function BrandPanel({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        borderRight: "1px solid var(--line)",
        background: "var(--bg-2)",
        padding: "32px 40px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <BrandBackdrop />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Monogram size={28} />
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          kanon
        </div>
        <span
          className="mono"
          style={{
            fontSize: 9.5,
            color: "var(--ink-4)",
            padding: "2px 6px",
            border: "1px solid var(--line)",
            borderRadius: 3,
            marginLeft: 4,
            letterSpacing: "0.05em",
          }}
        >
          v3.4
        </span>
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          marginTop: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxWidth: 420,
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--accent-ink)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {eyebrow}
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 36,
            fontWeight: 600,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
          }}
        >
          {title}
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            color: "var(--ink-3)",
            lineHeight: 1.5,
            maxWidth: 380,
          }}
        >
          {subtitle}
        </p>
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          marginTop: 32,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <Quote
          body="The agent thread on each issue is the killer feature. We stopped writing standup notes."
          who="Maya Chen · Eng Lead"
        />
      </div>
    </div>
  );
}

function BrandBackdrop() {
  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        opacity: 0.5,
        pointerEvents: "none",
        zIndex: 0,
      }}
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 600 800"
    >
      <defs>
        <pattern
          id="auth-grid"
          width="32"
          height="32"
          patternUnits="userSpaceOnUse"
        >
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="var(--grid)" strokeWidth="0.5" />
        </pattern>
        <radialGradient id="auth-fade" cx="50%" cy="50%">
          <stop offset="0%" stopColor="var(--bg-2)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--bg-2)" stopOpacity="1" />
        </radialGradient>
      </defs>
      <rect width="600" height="800" fill="url(#auth-grid)" />
      <g stroke="var(--line-2)" strokeWidth="0.8" fill="none" opacity="0.7">
        <path d="M 60 200 C 200 200, 240 380, 380 380" />
        <path d="M 60 200 C 160 200, 220 280, 320 280" />
        <path d="M 380 380 C 480 380, 500 480, 500 560" />
        <path d="M 320 280 C 420 280, 460 360, 460 440" />
        <path d="M 60 460 C 200 460, 220 580, 360 580" />
      </g>
      <g>
        {[
          [60, 200, "var(--accent)"],
          [320, 280, "var(--ink-3)"],
          [380, 380, "var(--accent)"],
          [460, 440, "var(--ok)"],
          [500, 560, "var(--ink-3)"],
          [60, 460, "var(--ai)"],
          [360, 580, "var(--ok)"],
        ].map(([x, y, c], i) => (
          <g key={i}>
            <circle
              cx={x as number}
              cy={y as number}
              r="8"
              fill="var(--bg-2)"
              stroke={c as string}
              strokeWidth="1.2"
              opacity="0.9"
            />
            <circle cx={x as number} cy={y as number} r="2" fill={c as string} />
          </g>
        ))}
      </g>
      <rect width="600" height="800" fill="url(#auth-fade)" opacity="0.55" />
    </svg>
  );
}

function Quote({ body, who }: { body: string; who: string }) {
  return (
    <div
      style={{
        position: "relative",
        borderLeft: "2px solid var(--accent)",
        padding: "4px 0 4px 14px",
        maxWidth: 460,
      }}
    >
      <div
        style={{
          fontSize: 13.5,
          lineHeight: 1.55,
          color: "var(--ink-2)",
        }}
      >
        “{body}”
      </div>
      <div
        className="mono"
        style={{
          fontSize: 10.5,
          color: "var(--ink-4)",
          marginTop: 6,
          letterSpacing: "0.02em",
        }}
      >
        {who}
      </div>
    </div>
  );
}

function FormPanel({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        padding: "32px 40px",
        overflow: "auto",
      }}
    >
      <div style={{ minHeight: 24 }}>{footer}</div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div style={{ width: "100%", maxWidth: 420 }}>{children}</div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 11,
          color: "var(--ink-4)",
        }}
      >
        <span>© {new Date().getFullYear()} Kanon Labs</span>
        <span style={{ display: "flex", gap: 14 }}>
          <button type="button">Privacy</button>
          <button type="button">Terms</button>
          <button type="button">Status</button>
        </span>
      </div>
    </div>
  );
}

/* ─────────── Field primitives ─────────── */

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label
      style={{
        fontSize: 11,
        color: "var(--ink-3)",
        fontWeight: 500,
        letterSpacing: "0.01em",
      }}
    >
      {children}
    </label>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        margin: 0,
        fontSize: 22,
        fontWeight: 600,
        letterSpacing: "-0.02em",
      }}
    >
      {children}
    </h2>
  );
}

export function Sub({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: "6px 0 0",
        fontSize: 13,
        color: "var(--ink-3)",
        lineHeight: 1.5,
      }}
    >
      {children}
    </p>
  );
}

interface FormInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  fieldLabel?: string;
}

export function FormInput({ fieldLabel, id, ...rest }: FormInputProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {fieldLabel && (
        <label htmlFor={id}>
          <FieldLabel>{fieldLabel}</FieldLabel>
        </label>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 36,
          border: "1px solid var(--line-2)",
          borderRadius: 5,
          background: "var(--panel)",
          padding: "0 10px",
        }}
      >
        <input
          id={id}
          {...rest}
          style={{
            flex: 1,
            height: "100%",
            border: 0,
            outline: 0,
            background: "transparent",
            color: "var(--ink)",
            fontSize: 13,
          }}
        />
      </div>
    </div>
  );
}

export function PrimaryBtn({
  children,
  disabled,
  type = "submit",
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  type?: "submit" | "button";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: "100%",
        height: 38,
        background: "var(--accent)",
        color: "var(--btn-ink)",
        borderRadius: 5,
        fontSize: 13,
        fontWeight: 500,
        letterSpacing: "0.01em",
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "8px 12px",
        background:
          "color-mix(in oklch, var(--bad) 12%, transparent)",
        border:
          "1px solid color-mix(in oklch, var(--bad) 40%, transparent)",
        borderRadius: 5,
        color: "var(--bad)",
        fontSize: 12,
      }}
    >
      {children}
    </div>
  );
}

export function SuccessBox({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "8px 12px",
        background: "color-mix(in oklch, var(--ok) 12%, transparent)",
        border: "1px solid color-mix(in oklch, var(--ok) 40%, transparent)",
        borderRadius: 5,
        color: "var(--ok)",
        fontSize: 12,
      }}
    >
      {children}
    </div>
  );
}
