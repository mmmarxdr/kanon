-- KAN-261: recommendations are issue-linked privacy data created after the base RLS migration.
ALTER TABLE public.integration_reconciliation_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS privacy_runtime_visible
ON public.integration_reconciliation_recommendations;

CREATE POLICY privacy_runtime_visible
ON public.integration_reconciliation_recommendations
FOR ALL
TO kanon_runtime
USING (privacy_authority.issue_visible(candidate_issue_id))
WITH CHECK (privacy_authority.issue_visible(candidate_issue_id));

DROP TRIGGER IF EXISTS privacy_runtime_preserve_hidden
ON public.integration_reconciliation_recommendations;

CREATE TRIGGER privacy_runtime_preserve_hidden
BEFORE DELETE ON public.integration_reconciliation_recommendations
FOR EACH ROW
EXECUTE FUNCTION privacy_authority.prevent_runtime_hidden_delete(
  'direct',
  'candidate_issue_id',
  ''
);
