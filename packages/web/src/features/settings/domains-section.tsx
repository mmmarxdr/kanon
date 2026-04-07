import { useState } from "react";
import { useUpdateWorkspaceMutation } from "./use-settings-queries";

export function DomainsSection({
  workspaceId,
  currentUserRole,
  allowedDomains: initialDomains,
}: {
  workspaceId: string;
  currentUserRole: string | undefined;
  allowedDomains: string[];
}) {
  const updateWorkspace = useUpdateWorkspaceMutation(workspaceId);
  const [newDomain, setNewDomain] = useState("");
  const [domainError, setDomainError] = useState<string | null>(null);

  const isAdmin = currentUserRole === "admin" || currentUserRole === "owner";
  const domains = initialDomains;

  function handleAddDomain(e: React.FormEvent) {
    e.preventDefault();
    setDomainError(null);

    const domain = newDomain.trim().toLowerCase();
    if (!domain) return;

    // Basic domain validation
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(domain)) {
      setDomainError("Please enter a valid domain (e.g. example.com)");
      return;
    }

    if (domains.includes(domain)) {
      setDomainError("This domain is already in the list.");
      return;
    }

    updateWorkspace.mutate(
      { allowedDomains: [...domains, domain] },
      {
        onSuccess: () => {
          setNewDomain("");
          setDomainError(null);
        },
      },
    );
  }

  function handleRemoveDomain(domain: string) {
    updateWorkspace.mutate({
      allowedDomains: domains.filter((d) => d !== domain),
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="text-lg font-semibold text-foreground mb-1">Allowed Domains</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Restrict which email domains can join this workspace via invite links.
      </p>

      {domains.length === 0 ? (
        <p className="text-sm text-muted-foreground mb-4">
          No domain restrictions -- any email domain can join.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 mb-4">
          {domains.map((domain) => (
            <span
              key={domain}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-2.5 py-1 text-sm text-foreground"
            >
              {domain}
              {isAdmin && (
                <button
                  onClick={() => handleRemoveDomain(domain)}
                  disabled={updateWorkspace.isPending}
                  className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                  aria-label={`Remove ${domain}`}
                >
                  &times;
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {isAdmin && (
        <form onSubmit={handleAddDomain} className="flex items-start gap-2">
          <div className="flex-1">
            <input
              type="text"
              value={newDomain}
              onChange={(e) => {
                setNewDomain(e.target.value);
                setDomainError(null);
              }}
              placeholder="example.com"
              className="w-full rounded-md border border-input bg-[#E8E8E8] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
            />
            {domainError && (
              <p className="mt-1 text-xs text-destructive">{domainError}</p>
            )}
            {updateWorkspace.isError && (
              <p className="mt-1 text-xs text-destructive">{updateWorkspace.error.message}</p>
            )}
          </div>
          <button
            type="submit"
            disabled={updateWorkspace.isPending || !newDomain.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 ease-out"
          >
            {updateWorkspace.isPending ? "Adding..." : "Add Domain"}
          </button>
        </form>
      )}
    </div>
  );
}
