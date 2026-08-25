-- KAN-246 PR2d: inert operator-only atomic containment; admission remains out of scope.
CREATE TABLE privacy_authority.containment_preparations (
  token uuid PRIMARY KEY, issue_id uuid NOT NULL, binding_id uuid NOT NULL,
  generation integer NOT NULL, backend_pid integer NOT NULL, transaction_id bigint NOT NULL
);
ALTER TABLE privacy_authority.containment_preparations OWNER TO kanon_privacy_authority;
REVOKE ALL ON TABLE privacy_authority.containment_preparations FROM PUBLIC, kanon_runtime, kanon_privacy_operator;

GRANT USAGE ON SCHEMA public, privacy_quarantine TO kanon_privacy_authority;
GRANT SELECT, UPDATE, DELETE ON TABLE public.issues, public.projects, public.cycles, public.comments, public.time_entries, public.integration_project_bindings,
  public.external_refs, public.integration_sync_work, public.integration_content_provenance,
  public.triage_proposals, public.triage_proposal_contents, public.triage_proposal_lifecycle_events,
  public.mcp_proposals, public.cycle_scope_events, public.admin_audit_logs,
  public.integration_inbound_applications, public.integration_conflicts, public.work_capture_intents,
  public.work_capture_owner_leases, public.domain_event_outbox, public.notifications TO kanon_privacy_authority;
GRANT SELECT, INSERT ON TABLE privacy_quarantine.issue_content TO kanon_privacy_authority;

CREATE FUNCTION privacy_authority.prepare_containment(token uuid, issue uuid, binding uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE current_issue record; evidence jsonb;
BEGIN
  LOCK TABLE public.comments, public.time_entries, public.external_refs, public.integration_sync_work, public.integration_content_provenance,
    public.triage_proposals, public.triage_proposal_contents, public.triage_proposal_lifecycle_events,
    public.mcp_proposals, public.cycle_scope_events, public.admin_audit_logs,
    public.integration_inbound_applications, public.integration_conflicts, public.work_capture_intents,
    public.work_capture_owner_leases, public.domain_event_outbox, public.notifications IN SHARE ROW EXCLUSIVE MODE;
  PERFORM 1 FROM public.integration_project_bindings
    WHERE id = binding AND lifecycle::text = 'active' AND released_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'privacy containment rejected'; END IF;
  SELECT i.id, i.key, i.title, i.description, i.privacy_held_at, i.privacy_hold_generation
    INTO current_issue FROM public.issues i JOIN public.integration_project_bindings b ON b.project_id = i.project_id
    WHERE i.id = issue AND b.id = binding FOR UPDATE OF i;
  IF NOT FOUND OR current_issue.privacy_hold_generation < 0 OR current_issue.privacy_hold_generation = 2147483647
    THEN RAISE EXCEPTION 'privacy containment rejected'; END IF;
  PERFORM 1 FROM public.external_refs
    WHERE binding_id = binding AND entity_type = 'issue' AND entity_id = issue FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'privacy containment rejected'; END IF;
  IF current_issue.privacy_held_at IS NOT NULL THEN
    IF (SELECT count(*) FROM privacy_quarantine.issue_content
        WHERE issue_id = issue AND generation = current_issue.privacy_hold_generation) = 1
       AND EXISTS (SELECT 1 FROM privacy_quarantine.issue_content
        WHERE issue_id = issue AND binding_id = binding AND generation = current_issue.privacy_hold_generation AND snapshot_schema = 2)
      THEN RETURN jsonb_build_object('status','contained','generation',current_issue.privacy_hold_generation);
    END IF;
    RAISE EXCEPTION 'privacy containment rejected';
  END IF;
  PERFORM 1 FROM public.integration_content_provenance
    WHERE binding_id = binding AND entity_type = 'issue' AND entity_id = issue AND field IN ('title','description')
    ORDER BY field FOR UPDATE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('field',field,'origin',origin,'contentHash',content_hash) ORDER BY field),'[]'::jsonb)
    INTO evidence FROM public.integration_content_provenance
    WHERE binding_id = binding AND entity_type = 'issue' AND entity_id = issue AND field IN ('title','description');
  INSERT INTO privacy_authority.containment_preparations
    VALUES (token,issue,binding,current_issue.privacy_hold_generation + 1,pg_backend_pid(),txid_current());
  RETURN jsonb_build_object('status','prepared','generation',current_issue.privacy_hold_generation + 1,
    'title',current_issue.title,'description',current_issue.description,'provenance',evidence);
END $$;

CREATE FUNCTION privacy_authority.commit_containment(token uuid, issue uuid, binding uuid, generation integer, envelope text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE prepared record; held_issue record;
BEGIN
  SELECT * INTO prepared FROM privacy_authority.containment_preparations
    WHERE containment_preparations.token = commit_containment.token AND issue_id = issue AND binding_id = binding
      AND containment_preparations.generation = commit_containment.generation AND backend_pid = pg_backend_pid()
      AND transaction_id = txid_current() FOR UPDATE;
  IF NOT FOUND OR envelope !~ '^pq[.]gcm[.]v1:[A-Za-z0-9._-]{1,64}:2:'
    THEN RAISE EXCEPTION 'privacy containment rejected'; END IF;
  SELECT i.key,i.project_id,p.workspace_id INTO held_issue FROM public.issues i JOIN public.projects p ON p.id=i.project_id
    WHERE i.id = issue AND i.privacy_held_at IS NULL AND i.privacy_hold_generation = generation - 1 FOR UPDATE OF i,p;
  IF NOT FOUND THEN RAISE EXCEPTION 'privacy containment rejected'; END IF;
  INSERT INTO privacy_quarantine.issue_content(issue_id,binding_id,generation,snapshot_schema,envelope)
    VALUES (issue,binding,generation,2,envelope);
  WITH comments AS MATERIALIZED (
    SELECT id FROM public.comments WHERE issue_id=issue
  ), time_entries AS MATERIALIZED (
    SELECT id FROM public.time_entries WHERE issue_id=issue
  ), issue_refs AS MATERIALIZED (
    SELECT id,external_id FROM public.external_refs WHERE binding_id=binding AND entity_type='issue' AND entity_id=issue
  ), refs AS MATERIALIZED (
    SELECT id,external_id FROM issue_refs
    UNION ALL
    SELECT id,external_id FROM public.external_refs WHERE binding_id=binding AND
      ((entity_type='comment' AND entity_id IN (SELECT id FROM comments)) OR
       (entity_type='time_entry' AND entity_id IN (SELECT id FROM time_entries)))
  ), works AS MATERIALIZED (
    SELECT id FROM public.integration_sync_work WHERE binding_id=binding
      AND ((entity_type='issue' AND entity_id=issue) OR
       (entity_type='comment' AND entity_id IN (SELECT id FROM comments)) OR
       (entity_type='time_entry' AND entity_id IN (SELECT id FROM time_entries)) OR
       ref_id IN (SELECT id FROM refs))
  ), apps AS MATERIALIZED (
    SELECT id FROM public.integration_inbound_applications WHERE binding_id=binding AND
      (ref_id IN (SELECT id FROM refs) OR work_id IN (SELECT id FROM works) OR
       (remote_entity_type='issue' AND remote_id IN (SELECT external_id FROM issue_refs)) OR
       (remote_parent_type='issue' AND remote_parent_id IN (SELECT external_id FROM issue_refs)))
  ), census(kind,row_pk) AS (
    SELECT 'external_refs',id::text FROM refs
    UNION ALL SELECT 'integration_sync_work',id::text FROM works
    UNION ALL SELECT 'integration_content_provenance',id::text FROM public.integration_content_provenance WHERE binding_id=binding AND entity_type='issue' AND entity_id=issue
    UNION ALL SELECT 'triage_proposal_content',c.id::text FROM public.triage_proposal_contents c JOIN public.triage_proposals p ON p.id=c.proposal_id WHERE p.target_issue_id=issue
    UNION ALL SELECT 'triage_proposal_lifecycle_event',e.id::text FROM public.triage_proposal_lifecycle_events e JOIN public.triage_proposals p ON p.id=e.proposal_id WHERE p.target_issue_id=issue
    UNION ALL SELECT 'mcp_proposal',id::text FROM public.mcp_proposals WHERE target_ref=held_issue.key AND workspace_id=held_issue.workspace_id AND (project_id IS NULL OR project_id=held_issue.project_id)
    UNION ALL SELECT 'cycle_scope_event',e.id::text FROM public.cycle_scope_events e JOIN public.cycles c ON c.id=e.cycle_id WHERE e.issue_key=held_issue.key AND c.project_id=held_issue.project_id
    UNION ALL SELECT 'admin_audit_log',id::text FROM public.admin_audit_logs WHERE entity_type='issue' AND entity_id=issue::text
    UNION ALL SELECT 'integration_inbound_application',id::text FROM apps
    UNION ALL SELECT 'integration_conflict',id::text FROM public.integration_conflicts WHERE binding_id=binding AND (ref_id IN (SELECT id FROM refs) OR work_id IN (SELECT id FROM works) OR application_id IN (SELECT id FROM apps))
    UNION ALL SELECT 'work_capture_owner_lease',l.id::text FROM public.work_capture_owner_leases l JOIN public.work_capture_intents i ON i.id=l.intent_id WHERE i.issue_id=issue
    UNION ALL SELECT 'domain_event_outbox',id::text FROM public.domain_event_outbox WHERE workspace_id=held_issue.workspace_id AND jsonb_path_exists(payload,'$.** ? (@ == $issueId || @ == $issueKey)',jsonb_build_object('issueId',to_jsonb(issue::text),'issueKey',to_jsonb(held_issue.key)))
  ) INSERT INTO privacy_authority.held_row_associations(store_kind,row_pk,issue_id,hold_generation)
    SELECT DISTINCT kind,row_pk,issue,generation FROM census ON CONFLICT DO NOTHING;
  UPDATE public.external_refs SET metadata=NULL WHERE id::text IN (SELECT row_pk FROM privacy_authority.held_row_associations WHERE issue_id=issue AND hold_generation=generation AND store_kind='external_refs');
  UPDATE public.integration_sync_work SET payload='{}' WHERE id::text IN (SELECT row_pk FROM privacy_authority.held_row_associations WHERE issue_id=issue AND hold_generation=generation AND store_kind='integration_sync_work');
  UPDATE public.integration_inbound_applications SET outcome=NULL WHERE id::text IN (SELECT row_pk FROM privacy_authority.held_row_associations WHERE issue_id=issue AND hold_generation=generation AND store_kind='integration_inbound_application');
  UPDATE public.integration_conflicts SET local_evidence='{}',remote_evidence='{}' WHERE id::text IN (SELECT row_pk FROM privacy_authority.held_row_associations WHERE issue_id=issue AND hold_generation=generation AND store_kind='integration_conflict');
  DELETE FROM public.triage_proposal_contents WHERE id::text IN (SELECT row_pk FROM privacy_authority.held_row_associations WHERE issue_id=issue AND hold_generation=generation AND store_kind='triage_proposal_content');
  UPDATE public.triage_proposal_lifecycle_events SET reason=NULL,details=NULL WHERE id::text IN (SELECT row_pk FROM privacy_authority.held_row_associations WHERE issue_id=issue AND hold_generation=generation AND store_kind='triage_proposal_lifecycle_event');
  UPDATE public.triage_proposals SET list_summary='{}' WHERE target_issue_id=issue;
  DELETE FROM public.mcp_proposals WHERE id::text IN (SELECT row_pk FROM privacy_authority.held_row_associations WHERE issue_id=issue AND hold_generation=generation AND store_kind='mcp_proposal');
  UPDATE public.cycle_scope_events SET issue_key='[privacy hold]',reason=NULL WHERE id::text IN (SELECT row_pk FROM privacy_authority.held_row_associations WHERE issue_id=issue AND hold_generation=generation AND store_kind='cycle_scope_event');
  UPDATE public.admin_audit_logs SET payload='{}',reason=NULL WHERE id::text IN (SELECT row_pk FROM privacy_authority.held_row_associations WHERE issue_id=issue AND hold_generation=generation AND store_kind='admin_audit_log');
  DELETE FROM public.domain_event_outbox WHERE id::text IN (SELECT row_pk FROM privacy_authority.held_row_associations WHERE issue_id=issue AND hold_generation=generation AND store_kind='domain_event_outbox');
  UPDATE public.notifications SET payload=NULL WHERE issue_id=issue;
  DELETE FROM privacy_authority.containment_preparations WHERE containment_preparations.token=commit_containment.token;
  UPDATE public.issues SET title='[privacy hold]',description=NULL,privacy_held_at=clock_timestamp(),privacy_hold_generation=generation
    WHERE id=issue AND privacy_held_at IS NULL AND privacy_hold_generation=generation-1;
  IF NOT FOUND THEN RAISE EXCEPTION 'privacy containment rejected'; END IF;
  RETURN jsonb_build_object('status','contained','generation',generation);
END $$;

ALTER FUNCTION privacy_authority.prepare_containment(uuid,uuid,uuid) OWNER TO kanon_privacy_authority;
ALTER FUNCTION privacy_authority.commit_containment(uuid,uuid,uuid,integer,text) OWNER TO kanon_privacy_authority;
REVOKE ALL ON FUNCTION privacy_authority.prepare_containment(uuid,uuid,uuid), privacy_authority.commit_containment(uuid,uuid,uuid,integer,text) FROM PUBLIC, kanon_runtime;
GRANT USAGE ON SCHEMA privacy_authority TO kanon_privacy_operator;
GRANT EXECUTE ON FUNCTION privacy_authority.prepare_containment(uuid,uuid,uuid), privacy_authority.commit_containment(uuid,uuid,uuid,integer,text) TO kanon_privacy_operator;
