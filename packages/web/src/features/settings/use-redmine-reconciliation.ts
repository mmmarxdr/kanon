import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  redmineReconciliationActivationProgressSchema,
  redmineReconciliationDecisionResultSchema,
  redmineReconciliationDecisionSchema,
  redmineReconciliationMaterializeResultSchema,
  redmineReconciliationMaterializeTargetSchema,
  redmineReconciliationPreviewProgressSchema,
  redmineReconciliationPreviewRequestSchema,
  redmineReconciliationReviewPageRequestSchema,
  redmineReconciliationReviewPageResultSchema,
} from "@kanon/shared";
import type { z } from "zod";
import { fetchApiValidated } from "@/lib/api-client";
import { integrationKeys, issueKeys } from "@/lib/query-keys";

export type RedmineReconciliationPreviewInput = z.input<
  typeof redmineReconciliationPreviewRequestSchema
>;
export type RedmineReconciliationReviewPageInput = z.input<
  typeof redmineReconciliationReviewPageRequestSchema
>;
export type RedmineReconciliationMaterializeInput = z.input<
  typeof redmineReconciliationMaterializeTargetSchema
>;
export type RedmineReconciliationDecisionInput = Readonly<{
  remoteIssueId: string;
  decision: z.input<typeof redmineReconciliationDecisionSchema>;
}>;

function bindingPath(workspaceId: string, connectionId: string, bindingId: string) {
  return `/api/integrations/workspaces/${workspaceId}/connections/${connectionId}/bindings/${bindingId}`;
}

export function useRedmineReconciliationPreviewMutation(
  workspaceId: string,
  connectionId: string,
  bindingId: string,
) {
  const queryClient = useQueryClient();
  const path = bindingPath(workspaceId, connectionId, bindingId);
  return useMutation({
    mutationFn: (input: RedmineReconciliationPreviewInput) => {
      const body = redmineReconciliationPreviewRequestSchema.parse(input);
      return fetchApiValidated(`${path}/inbound/preview`, redmineReconciliationPreviewProgressSchema, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: integrationKeys.connection(workspaceId) }),
  });
}

export function useRedmineReconciliationReviewPageMutation(
  workspaceId: string,
  connectionId: string,
  bindingId: string,
) {
  const path = bindingPath(workspaceId, connectionId, bindingId);
  return useMutation({
    mutationFn: (input: RedmineReconciliationReviewPageInput) => {
      const body = redmineReconciliationReviewPageRequestSchema.parse(input);
      return fetchApiValidated(
        `${path}/reconciliation/review-page`,
        redmineReconciliationReviewPageResultSchema,
        { method: "POST", body: JSON.stringify(body) },
      );
    },
  });
}

export function useRedmineReconciliationMaterializeMutation(
  workspaceId: string,
  connectionId: string,
  bindingId: string,
) {
  const path = bindingPath(workspaceId, connectionId, bindingId);
  return useMutation({
    mutationFn: (input: RedmineReconciliationMaterializeInput) => {
      const body = redmineReconciliationMaterializeTargetSchema.parse(input);
      return fetchApiValidated(
        `${path}/reconciliation/recommendations/materialize`,
        redmineReconciliationMaterializeResultSchema,
        { method: "POST", body: JSON.stringify(body) },
      );
    },
  });
}

export function useRedmineReconciliationDecisionMutation(
  workspaceId: string,
  connectionId: string,
  bindingId: string,
) {
  const queryClient = useQueryClient();
  const path = bindingPath(workspaceId, connectionId, bindingId);
  return useMutation({
    mutationFn: ({ remoteIssueId, decision }: RedmineReconciliationDecisionInput) => {
      const remote = redmineReconciliationMaterializeTargetSchema.parse({ remoteIssueId });
      const body = redmineReconciliationDecisionSchema.parse(decision);
      return fetchApiValidated(
        `${path}/reconciliation/issues/${encodeURIComponent(remote.remoteIssueId)}/decision`,
        redmineReconciliationDecisionResultSchema,
        { method: "POST", body: JSON.stringify(body) },
      );
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: integrationKeys.connection(workspaceId) }),
  });
}

export function useRedmineReconciliationActivationMutation(
  workspaceId: string,
  connectionId: string,
  bindingId: string,
) {
  const queryClient = useQueryClient();
  const path = bindingPath(workspaceId, connectionId, bindingId);
  return useMutation({
    mutationFn: () =>
      fetchApiValidated(`${path}/inbound/activate`, redmineReconciliationActivationProgressSchema, {
        method: "POST",
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: integrationKeys.connection(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: issueKeys.all }),
      ]);
    },
  });
}
