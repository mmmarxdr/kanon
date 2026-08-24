-- KAN-246: runtime visibility boundary; recovery authority is intentionally out of scope.
DO $$ BEGIN
  CREATE ROLE kanon_privacy_authority NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER ROLE kanon_privacy_authority NOLOGIN NOSUPERUSER BYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;
DO $$ DECLARE item record; BEGIN
  FOR item IN
    SELECT member.rolname AS member_name
    FROM pg_auth_members membership
    JOIN pg_roles authority ON authority.oid = membership.roleid
    JOIN pg_roles member ON member.oid = membership.member
    WHERE authority.rolname = 'kanon_privacy_authority'
  LOOP
    EXECUTE format('REVOKE %I FROM %I', 'kanon_privacy_authority', item.member_name);
  END LOOP;
END $$;
CREATE SCHEMA IF NOT EXISTS privacy_authority AUTHORIZATION kanon_privacy_authority;
REVOKE ALL ON SCHEMA privacy_authority FROM PUBLIC, kanon_runtime;
CREATE TABLE IF NOT EXISTS privacy_authority.held_row_associations (
  store_kind text NOT NULL, row_pk text NOT NULL, issue_id uuid NOT NULL REFERENCES public.issues(id) ON DELETE CASCADE,
  hold_generation integer NOT NULL, PRIMARY KEY (store_kind, row_pk, issue_id, hold_generation)
);
ALTER TABLE privacy_authority.held_row_associations OWNER TO kanon_privacy_authority;
REVOKE ALL ON TABLE privacy_authority.held_row_associations FROM PUBLIC, kanon_runtime;
GRANT USAGE ON SCHEMA public TO kanon_privacy_authority;
GRANT SELECT ON TABLE public.issues TO kanon_privacy_authority;
CREATE OR REPLACE FUNCTION privacy_authority.issue_visible(candidate uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.issues WHERE id = candidate AND privacy_held_at IS NOT NULL)
$$;
CREATE OR REPLACE FUNCTION privacy_authority.row_visible(kind text, candidate text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT NOT EXISTS (SELECT 1 FROM privacy_authority.held_row_associations WHERE store_kind = kind AND row_pk = candidate)
$$;
ALTER FUNCTION privacy_authority.issue_visible(uuid) OWNER TO kanon_privacy_authority;
ALTER FUNCTION privacy_authority.row_visible(text, text) OWNER TO kanon_privacy_authority;
REVOKE ALL ON FUNCTION privacy_authority.issue_visible(uuid), privacy_authority.row_visible(text, text) FROM PUBLIC;
GRANT USAGE ON SCHEMA privacy_authority TO kanon_runtime;
GRANT EXECUTE ON FUNCTION privacy_authority.issue_visible(uuid), privacy_authority.row_visible(text, text) TO kanon_runtime;
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('issues','id'), ('activity_logs','issue_id'), ('comments','issue_id'), ('work_sessions','issue_id'), ('work_logs','issue_id'), ('mentions','issue_id'), ('issue_documents','issue_id'), ('notifications','issue_id'), ('issue_subscriptions','issue_id'), ('issue_schedules','issueId'), ('estimate_revisions','issue_id'), ('issue_forecasts','issueId'), ('time_entries','issue_id'), ('milestone_deliverables','issue_id'), ('work_capture_intents','issue_id'), ('work_transition_lifecycles','issue_id'), ('triage_proposals','target_issue_id')
  ) AS v(tab, issue_col) LOOP
    IF to_regclass('public.' || item.tab) IS NULL THEN RAISE EXCEPTION 'privacy table missing: %', item.tab; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item.tab);
    EXECUTE format('DROP POLICY IF EXISTS privacy_runtime_visible ON public.%I', item.tab);
    IF item.tab = 'issues' THEN
      EXECUTE 'CREATE POLICY privacy_runtime_visible ON public.issues FOR ALL TO kanon_runtime USING (privacy_authority.issue_visible(id)) WITH CHECK (privacy_held_at IS NULL)';
    ELSE
      EXECUTE format('CREATE POLICY privacy_runtime_visible ON public.%I FOR ALL TO kanon_runtime USING (privacy_authority.issue_visible(%I)) WITH CHECK (privacy_authority.issue_visible(%I))', item.tab, item.issue_col, item.issue_col);
    END IF;
  END LOOP;
END $$;
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT * FROM (VALUES ('issue_dependencies','source_id','target_id'), ('interruptions','incident_issue_id','interrupted_issue_id')) AS v(tab, left_col, right_col) LOOP
    IF to_regclass('public.' || item.tab) IS NULL THEN RAISE EXCEPTION 'privacy table missing: %', item.tab; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item.tab);
    EXECUTE format('DROP POLICY IF EXISTS privacy_runtime_visible ON public.%I', item.tab);
    EXECUTE format('CREATE POLICY privacy_runtime_visible ON public.%I FOR ALL TO kanon_runtime USING (privacy_authority.issue_visible(%I) AND privacy_authority.issue_visible(%I)) WITH CHECK (privacy_authority.issue_visible(%I) AND privacy_authority.issue_visible(%I))', item.tab, item.left_col, item.right_col, item.left_col, item.right_col);
  END LOOP;
END $$;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['external_refs','integration_sync_work','integration_content_provenance'] LOOP
    IF to_regclass('public.' || tab) IS NULL THEN RAISE EXCEPTION 'privacy table missing: %', tab; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tab);
    EXECUTE format('DROP POLICY IF EXISTS privacy_runtime_visible ON public.%I', tab);
    EXECUTE format('CREATE POLICY privacy_runtime_visible ON public.%I FOR ALL TO kanon_runtime USING (privacy_authority.row_visible(%L, id::text) AND (entity_type <> ''issue'' OR privacy_authority.issue_visible(entity_id))) WITH CHECK (privacy_authority.row_visible(%L, id::text) AND (entity_type <> ''issue'' OR privacy_authority.issue_visible(entity_id)))', tab, tab, tab);
  END LOOP;
END $$;
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('triage_proposal_contents','triage_proposal_content'), ('triage_proposal_lifecycle_events','triage_proposal_lifecycle_event'), ('mcp_proposals','mcp_proposal'), ('cycle_scope_events','cycle_scope_event'), ('admin_audit_logs','admin_audit_log'), ('integration_inbound_applications','integration_inbound_application'), ('integration_conflicts','integration_conflict'), ('work_capture_owner_leases','work_capture_owner_lease'), ('domain_event_outbox','domain_event_outbox')
  ) AS v(tab, kind) LOOP
    IF to_regclass('public.' || item.tab) IS NULL THEN RAISE EXCEPTION 'privacy table missing: %', item.tab; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item.tab);
    EXECUTE format('DROP POLICY IF EXISTS privacy_runtime_visible ON public.%I', item.tab);
    EXECUTE format('CREATE POLICY privacy_runtime_visible ON public.%I FOR ALL TO kanon_runtime USING (privacy_authority.row_visible(%L, id::text)) WITH CHECK (privacy_authority.row_visible(%L, id::text))', item.tab, item.kind, item.kind);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION privacy_authority.prevent_runtime_hidden_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE row_data jsonb := to_jsonb(OLD); hidden boolean;
BEGIN
  IF session_user <> 'kanon_runtime' THEN RETURN OLD; END IF;
  CASE TG_ARGV[0]
    WHEN 'direct' THEN hidden := NOT privacy_authority.issue_visible((row_data ->> TG_ARGV[1])::uuid);
    WHEN 'paired' THEN hidden := NOT privacy_authority.issue_visible((row_data ->> TG_ARGV[1])::uuid) OR NOT privacy_authority.issue_visible((row_data ->> TG_ARGV[2])::uuid);
    WHEN 'typed' THEN hidden := NOT privacy_authority.row_visible(TG_ARGV[1], row_data ->> 'id') OR (row_data ->> 'entity_type' = 'issue' AND NOT privacy_authority.issue_visible((row_data ->> 'entity_id')::uuid));
    WHEN 'opaque' THEN hidden := NOT privacy_authority.row_visible(TG_ARGV[1], row_data ->> 'id');
  END CASE;
  IF hidden THEN RAISE EXCEPTION 'runtime cannot delete hidden privacy row' USING ERRCODE = '42501'; END IF;
  RETURN OLD;
END $$;
ALTER FUNCTION privacy_authority.prevent_runtime_hidden_delete() OWNER TO kanon_privacy_authority;
REVOKE ALL ON FUNCTION privacy_authority.prevent_runtime_hidden_delete() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy_authority.prevent_runtime_hidden_delete() TO kanon_runtime;
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('issues','direct','id',NULL::text), ('activity_logs','direct','issue_id',NULL::text), ('comments','direct','issue_id',NULL::text), ('work_sessions','direct','issue_id',NULL::text), ('work_logs','direct','issue_id',NULL::text), ('mentions','direct','issue_id',NULL::text), ('issue_documents','direct','issue_id',NULL::text), ('notifications','direct','issue_id',NULL::text), ('issue_subscriptions','direct','issue_id',NULL::text), ('issue_schedules','direct','issueId',NULL::text), ('estimate_revisions','direct','issue_id',NULL::text), ('issue_forecasts','direct','issueId',NULL::text), ('time_entries','direct','issue_id',NULL::text), ('milestone_deliverables','direct','issue_id',NULL::text), ('work_capture_intents','direct','issue_id',NULL::text), ('work_transition_lifecycles','direct','issue_id',NULL::text), ('triage_proposals','direct','target_issue_id',NULL::text),
    ('issue_dependencies','paired','source_id','target_id'), ('interruptions','paired','incident_issue_id','interrupted_issue_id'),
    ('external_refs','typed','external_refs',NULL::text), ('integration_sync_work','typed','integration_sync_work',NULL::text), ('integration_content_provenance','typed','integration_content_provenance',NULL::text),
    ('triage_proposal_contents','opaque','triage_proposal_content',NULL::text), ('triage_proposal_lifecycle_events','opaque','triage_proposal_lifecycle_event',NULL::text), ('mcp_proposals','opaque','mcp_proposal',NULL::text), ('cycle_scope_events','opaque','cycle_scope_event',NULL::text), ('admin_audit_logs','opaque','admin_audit_log',NULL::text), ('integration_inbound_applications','opaque','integration_inbound_application',NULL::text), ('integration_conflicts','opaque','integration_conflict',NULL::text), ('work_capture_owner_leases','opaque','work_capture_owner_lease',NULL::text), ('domain_event_outbox','opaque','domain_event_outbox',NULL::text)
  ) AS v(tab, category, first_arg, second_arg) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS privacy_runtime_preserve_hidden ON public.%I', item.tab);
    EXECUTE format('CREATE TRIGGER privacy_runtime_preserve_hidden BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION privacy_authority.prevent_runtime_hidden_delete(%L, %L, %L)', item.tab, item.category, item.first_arg, item.second_arg);
  END LOOP;
END $$;
