import { useToastStore } from "@/stores/toast-store";

const TYPE_STYLES = {
  error: "bg-red-50 border-red-200 text-red-800",
  success: "bg-emerald-50 border-emerald-200 text-emerald-800",
  info: "bg-sky-50 border-sky-200 text-sky-800",
} as const;

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          className={`rounded-lg border px-4 py-3 text-sm shadow-lg flex items-start gap-2 animate-slide-up ${TYPE_STYLES[toast.type]}`}
        >
          <span className="flex-1">{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            className="shrink-0 opacity-70 hover:opacity-100 text-current"
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
