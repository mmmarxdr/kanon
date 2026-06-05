import { useState, useCallback, useEffect } from "react";
import { useCreateProjectMutation } from "@/hooks/use-create-project-mutation";
import { Icon } from "@/components/ui/icons";

const MAX_NAME_LENGTH = 100;
const MAX_KEY_LENGTH = 6;

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--ink-4)",
  marginBottom: 4,
  fontFamily: "JetBrains Mono, monospace",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 32,
  padding: "0 10px",
  background: "var(--bg)",
  border: "1px solid var(--line)",
  borderRadius: 5,
  color: "var(--ink)",
  fontSize: 12.5,
  outline: "none",
};

/** Derive a project key suggestion from a project name. */
function deriveKey(name: string): string {
  const words = name.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return (words[0] ?? "").slice(0, MAX_KEY_LENGTH);
  // Initials of each word, up to 4
  return words
    .slice(0, 4)
    .map((w) => w[0])
    .join("")
    .slice(0, MAX_KEY_LENGTH);
}

interface CreateProjectModalProps {
  workspaceId: string;
  onClose: () => void;
}

export function CreateProjectModal({ workspaceId, onClose }: CreateProjectModalProps) {
  const createMutation = useCreateProjectMutation(workspaceId);

  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState("");

  // Auto-derive key from name unless the user has manually edited it
  useEffect(() => {
    if (!keyTouched) {
      setKey(deriveKey(name));
    }
  }, [name, keyTouched]);

  const nameTrimmed = name.trim();
  const keyTrimmed = key.trim().toUpperCase();
  const keyValid = /^[A-Z][A-Z0-9]*$/.test(keyTrimmed) && keyTrimmed.length >= 1 && keyTrimmed.length <= MAX_KEY_LENGTH;
  const nameValid = nameTrimmed.length > 0 && nameTrimmed.length <= MAX_NAME_LENGTH;
  const isValid = nameValid && keyValid;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const handleSubmit = useCallback(() => {
    if (!isValid || createMutation.isPending) return;
    createMutation.mutate(
      {
        name: nameTrimmed,
        key: keyTrimmed,
        description: description.trim() || undefined,
      },
      { onSuccess: () => onClose() },
    );
  }, [isValid, nameTrimmed, keyTrimmed, description, createMutation, onClose]);

  return (
    <div
      data-testid="create-project-modal-backdrop"
      onClick={handleBackdropClick}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "8vh 16px 16px",
        background: "color-mix(in oklch, var(--bg) 70%, transparent)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title-label"
        data-testid="create-project-modal"
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 480,
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 8,
          boxShadow: "var(--shadow-drag)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 14px",
            borderBottom: "1px solid var(--line)",
            background: "var(--bg-2)",
          }}
        >
          <span
            id="new-project-title-label"
            className="mono"
            style={{
              fontSize: 10.5,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--ink-4)",
            }}
          >
            New project
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ color: "var(--ink-4)", padding: 2 }}
          >
            <Icon.X />
          </button>
        </div>

        {/* Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: "16px 16px 14px",
          }}
        >
          {/* Name */}
          <div>
            <label htmlFor="project-name" style={labelStyle}>
              Name <span style={{ color: "var(--bad)" }}>*</span>
            </label>
            <input
              id="project-name"
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME_LENGTH}
              placeholder="My project"
              data-testid="new-project-name"
              style={inputStyle}
            />
          </div>

          {/* Key */}
          <div>
            <label htmlFor="project-key" style={labelStyle}>
              Key <span style={{ color: "var(--bad)" }}>*</span>{" "}
              <span style={{ color: "var(--ink-4)", fontSize: 9, textTransform: "none", letterSpacing: 0 }}>
                (1–6 uppercase letters/digits, starts with letter)
              </span>
            </label>
            <input
              id="project-key"
              type="text"
              value={key}
              onChange={(e) => {
                setKeyTouched(true);
                setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, MAX_KEY_LENGTH));
              }}
              maxLength={MAX_KEY_LENGTH}
              placeholder="KAN"
              data-testid="new-project-key"
              style={inputStyle}
            />
            {key.length > 0 && !keyValid && (
              <span
                role="alert"
                data-testid="new-project-key-error"
                style={{ fontSize: 11, color: "var(--bad)" }}
              >
                Key must be 1–6 uppercase letters/digits starting with a letter.
              </span>
            )}
          </div>

          {/* Description (optional) */}
          <div>
            <label htmlFor="project-description" style={labelStyle}>
              Description{" "}
              <span style={{ color: "var(--ink-4)", fontSize: 9, textTransform: "none", letterSpacing: 0 }}>
                (optional)
              </span>
            </label>
            <textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What is this project about?"
              data-testid="new-project-description"
              style={{
                width: "100%",
                background: "var(--bg)",
                border: "1px solid var(--line)",
                borderRadius: 5,
                padding: "8px 10px",
                color: "var(--ink)",
                fontSize: 12.5,
                lineHeight: 1.5,
                outline: "none",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </div>

          {createMutation.isError && (
            <span
              role="alert"
              data-testid="new-project-error"
              style={{ fontSize: 12, color: "var(--bad)" }}
            >
              Failed to create project. Please try again.
            </span>
          )}
        </form>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderTop: "1px solid var(--line)",
            background: "var(--bg-2)",
          }}
        >
          <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-4)" }}>
            Esc to close
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            style={{
              height: 28,
              padding: "0 12px",
              border: "1px solid var(--line)",
              borderRadius: 4,
              background: "var(--panel)",
              color: "var(--ink-2)",
              fontSize: 12,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid || createMutation.isPending}
            data-testid="new-project-submit"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 28,
              padding: "0 12px",
              border: "none",
              borderRadius: 4,
              background: "var(--accent)",
              color: "var(--btn-ink)",
              fontSize: 12,
              fontWeight: 500,
              opacity: !isValid || createMutation.isPending ? 0.55 : 1,
              cursor: !isValid || createMutation.isPending ? "not-allowed" : "pointer",
            }}
          >
            {createMutation.isPending ? "Creating…" : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
}
