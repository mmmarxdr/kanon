import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Kbd } from "@/components/ui/primitives";

export interface IssueComposerProps {
  /** Resolves only after the comment has been accepted by the mutation. */
  onSubmit: (body: string) => Promise<unknown>;
  isPending: boolean;
  error?: Error | null;
}

/** Comment composer that retains its draft until the mutation succeeds. */
export function IssueComposer({ onSubmit, isPending, error }: IssueComposerProps) {
  const { t } = useTranslation("issue");
  const [draft, setDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { const textarea = textareaRef.current; if (!textarea) return; textarea.style.height = "auto"; textarea.style.height = `${textarea.scrollHeight}px`; }, [draft]);

  const handleSubmit = async () => {
    if (isPending || isSubmitting) return;
    const submittedDraft = draft;
    const trimmed = submittedDraft.trim();
    if (!trimmed) return;
    setIsSubmitting(true);
    try {
      await onSubmit(trimmed);
      setDraft((currentDraft) => currentDraft === submittedDraft ? "" : currentDraft);
      textareaRef.current?.focus();
    } catch {
      // The mutation error is rendered from the owner; keep the user draft for retry.
      textareaRef.current?.focus();
    } finally {
      setIsSubmitting(false);
    }
  };

  const pending = isPending || isSubmitting;
  return (
    <div style={{ borderTop: "1px solid var(--line)", padding: "12px 28px", background: "var(--bg)" }}>
      {pending ? <p role="status" aria-live="polite">{t("commentSending")}</p> : null}
      {error ? <p role="alert">{error.message}</p> : null}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--panel)" }}>
        <textarea ref={textareaRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void handleSubmit(); } }} placeholder={t("placeholderComment")} rows={2} style={{ flex: 1, border: "none", outline: "none", resize: "none", overflowY: "hidden", overflowX: "hidden", background: "transparent", fontSize: 12.5, lineHeight: 1.5, fontFamily: "Inter Tight", color: "var(--ink)" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--ink-4)" }}><Kbd>⌘</Kbd><Kbd>↵</Kbd></span>
          <button type="button" disabled={!draft.trim() || pending} onClick={() => void handleSubmit()} style={{ height: 26, padding: "0 12px", fontSize: 11.5, fontWeight: 500, background: "var(--accent)", color: "var(--btn-ink)", borderRadius: 4, cursor: !draft.trim() || pending ? "not-allowed" : "pointer", opacity: !draft.trim() || pending ? 0.55 : 1 }}>{t("commentSend")}</button>
        </div>
      </div>
    </div>
  );
}
