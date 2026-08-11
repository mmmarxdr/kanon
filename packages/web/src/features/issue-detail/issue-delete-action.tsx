import { useCallback, useState } from "react";
import { FocusTrap } from "focus-trap-react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/icons";
import { useBackdropClose } from "@/hooks/use-backdrop-close";
import { useEscapeKey } from "@/hooks/use-escape-key";
import type { IssuePriority } from "@/types/issue";
import { useDeleteIssueMutation } from "./use-delete-issue-mutation";

interface IssueDeleteActionProps {
  issueKey: string;
  priority: IssuePriority;
  capability: { allowed: boolean; redmineLinked: boolean };
  projectKey: string;
  onDeleted: () => void;
}

export function IssueDeleteAction({
  issueKey,
  priority,
  capability,
  projectKey,
  onDeleted,
}: IssueDeleteActionProps) {
  const { t } = useTranslation("issue");
  const [open, setOpen] = useState(false);
  const [confirmationKey, setConfirmationKey] = useState("");
  const deletion = useDeleteIssueMutation(issueKey, projectKey);
  const close = useCallback(() => {
    if (deletion.isPending) return;
    setOpen(false);
    setConfirmationKey("");
    deletion.reset();
  }, [deletion]);
  useEscapeKey(close, open);
  const backdropClose = useBackdropClose(close);

  if (!capability.allowed) return null;
  const critical = priority === "critical";
  const confirmed = !critical || confirmationKey === issueKey;

  return (
    <>
      <button
        type="button"
        aria-label={t("moreActions")}
        onClick={() => setOpen(true)}
        style={{ color: "var(--ink-4)", padding: 4 }}
      >
        <Icon.More />
      </button>
      {open && (
        <FocusTrap
          focusTrapOptions={{
            escapeDeactivates: false,
            allowOutsideClick: true,
            clickOutsideDeactivates: false,
            initialFocus: critical ? "#issue-delete-confirmation" : false,
            fallbackFocus: "#issue-delete-dialog",
          }}
        >
          <div
            onClick={backdropClose}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 60,
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              padding: "12vh 16px 16px",
              background: "color-mix(in oklch, var(--bg) 70%, transparent)",
              backdropFilter: "blur(4px)",
            }}
          >
            <div
              role="dialog"
              id="issue-delete-dialog"
              aria-modal="true"
              aria-labelledby="issue-delete-title"
              style={{
                width: "100%",
                maxWidth: 460,
                padding: 20,
                border: "1px solid var(--line)",
                borderRadius: 8,
                background: "var(--panel)",
                boxShadow: "var(--shadow-drag)",
              }}
            >
              <h2 id="issue-delete-title" style={{ fontSize: 18, fontWeight: 600 }}>
                {t("deleteTitle", { key: issueKey })}
              </h2>
              <p style={{ marginTop: 10, color: "var(--ink-2)", fontSize: 13 }}>
                {t("deleteDescription")}
              </p>
              {capability.redmineLinked && (
                <p
                  role="alert"
                  style={{
                    marginTop: 12,
                    padding: 10,
                    border: "1px solid var(--warning)",
                    borderRadius: 5,
                    color: "var(--warning)",
                    fontSize: 12,
                  }}
                >
                  {t("deleteRedmineWarning")}
                </p>
              )}
              {critical && (
                <label style={{ display: "block", marginTop: 14, fontSize: 12 }}>
                  {t("deleteCriticalPrompt", { key: issueKey })}
                  <input
                    id="issue-delete-confirmation"
                    value={confirmationKey}
                    onChange={(event) => setConfirmationKey(event.target.value)}
                    aria-label={t("deleteCriticalPrompt", { key: issueKey })}
                    autoComplete="off"
                    style={{
                      display: "block",
                      width: "100%",
                      marginTop: 6,
                      padding: "8px 10px",
                      border: "1px solid var(--line)",
                      borderRadius: 5,
                      background: "var(--bg)",
                    }}
                  />
                </label>
              )}
              {deletion.error && (
                <p role="alert" style={{ marginTop: 10, color: "var(--danger)", fontSize: 12 }}>
                  {deletion.error.message}
                </p>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
                <button type="button" onClick={close} disabled={deletion.isPending}>
                  {t("deleteCancel")}
                </button>
                <button
                  type="button"
                  disabled={!confirmed || deletion.isPending}
                  onClick={() => {
                    void deletion
                      .mutateAsync(critical ? { confirmationKey } : {})
                      .then(onDeleted)
                      .catch(() => undefined);
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 5,
                    color: "white",
                    background: "var(--danger)",
                    opacity: confirmed && !deletion.isPending ? 1 : 0.5,
                  }}
                >
                  {deletion.isPending ? t("deleteDeleting") : t("deleteConfirm")}
                </button>
              </div>
            </div>
          </div>
        </FocusTrap>
      )}
    </>
  );
}
