export type IssueDeletedDestination =
  | { to: "/board/$projectKey"; params: { projectKey: string }; replace: true }
  | { to: "/inbox"; replace: true };

/** Preserve replace-navigation after a successful deletion without history teardown races. */
export function getIssueDeletedDestination({
  from,
  projectKey,
}: {
  from: string | undefined;
  projectKey: string;
}): IssueDeletedDestination {
  if (from === "board" && projectKey) {
    return { to: "/board/$projectKey", params: { projectKey }, replace: true };
  }

  return { to: "/inbox", replace: true };
}
