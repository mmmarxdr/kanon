-- KAN-246: a database authority is the only containment/recovery boundary.
DO $$ BEGIN
  CREATE ROLE kanon_privacy_authority NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE kanon_privacy_operator LOGIN NOSUPERUSER NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE kanon_runtime LOGIN NOSUPERUSER NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS privacy_authority AUTHORIZATION kanon_privacy_authority;
REVOKE ALL ON SCHEMA privacy_authority FROM PUBLIC;
CREATE TABLE IF NOT EXISTS privacy_authority.control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), admission_enabled boolean NOT NULL DEFAULT false,
  recovery_enabled boolean NOT NULL DEFAULT false, registry_version integer NOT NULL DEFAULT 1
);
INSERT INTO privacy_authority.control(singleton) VALUES (true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS privacy_authority.evidence (
  id uuid PRIMARY KEY, binding_id uuid NOT NULL REFERENCES public.integration_project_bindings(id) ON DELETE CASCADE,
  issue_id uuid NOT NULL REFERENCES public.issues(id) ON DELETE CASCADE, issuer text NOT NULL CHECK (issuer IN ('kan245', 'redmine_private')),
  generation integer NOT NULL, scope_fingerprint text NOT NULL, credential_fingerprint text NOT NULL,
  lease_token text NOT NULL, fence integer NOT NULL, terminal_verified boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE TABLE IF NOT EXISTS privacy_authority.recovery_capabilities (
  id uuid PRIMARY KEY, binding_id uuid NOT NULL REFERENCES public.integration_project_bindings(id) ON DELETE CASCADE,
  issue_id uuid NOT NULL REFERENCES public.issues(id) ON DELETE CASCADE, generation integer NOT NULL,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE TABLE IF NOT EXISTS privacy_authority.held_row_associations (
  store_kind text NOT NULL, row_pk text NOT NULL, issue_id uuid NOT NULL REFERENCES public.issues(id) ON DELETE CASCADE,
  hold_generation integer NOT NULL, registry_version integer NOT NULL, disposition text NOT NULL,
  PRIMARY KEY (store_kind, row_pk)
);
ALTER TABLE privacy_authority.control OWNER TO kanon_privacy_authority;
ALTER TABLE privacy_authority.evidence OWNER TO kanon_privacy_authority;
ALTER TABLE privacy_authority.recovery_capabilities OWNER TO kanon_privacy_authority;
ALTER TABLE privacy_authority.held_row_associations OWNER TO kanon_privacy_authority;
REVOKE ALL ON ALL TABLES IN SCHEMA privacy_authority FROM PUBLIC, kanon_runtime;
GRANT USAGE ON SCHEMA privacy_authority TO kanon_privacy_operator;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA privacy_authority TO kanon_privacy_operator;
-- SECURITY DEFINER runs as the authority, which must have direct ACLs even with BYPASSRLS.
GRANT USAGE ON SCHEMA public, privacy_quarantine TO kanon_privacy_authority;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, privacy_quarantine TO kanon_privacy_authority;
GRANT USAGE ON SCHEMA public TO kanon_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kanon_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kanon_runtime;

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
GRANT EXECUTE ON FUNCTION privacy_authority.issue_visible(uuid) TO kanon_runtime;

-- Every direct issue derivative gets the same forced table boundary. The dynamic
-- selection deliberately fails closed for an unknown schema/table rather than
-- relying on application predicates that Prisma nested/raw queries can bypass.
DO $$ DECLARE tab text; BEGIN
  FOR tab IN SELECT unnest(ARRAY['issues','activity_logs','comments','work_sessions','work_logs','mentions','issue_documents','notifications','issue_subscriptions','issue_schedules','estimate_revisions','issue_forecasts','time_entries','milestone_deliverables']) LOOP
    IF to_regclass('public.' || tab) IS NULL THEN RAISE EXCEPTION 'privacy registry missing direct store %', tab; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tab);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tab);
    EXECUTE format('DROP POLICY IF EXISTS privacy_hold_visible ON public.%I', tab);
    IF tab = 'issues' THEN
      EXECUTE format('CREATE POLICY privacy_hold_visible ON public.%I USING (privacy_authority.issue_visible(id))', tab);
    ELSIF tab IN ('issue_schedules', 'issue_forecasts') THEN
      EXECUTE format('CREATE POLICY privacy_hold_visible ON public.%I USING (privacy_authority.issue_visible("issueId"))', tab);
    ELSE
      EXECUTE format('CREATE POLICY privacy_hold_visible ON public.%I USING (privacy_authority.issue_visible(issue_id))', tab);
    END IF;
  END LOOP;
END $$;
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('triage_proposals','triage', 'id'), ('triage_proposal_contents','triage_content','id'),
    ('triage_proposal_lifecycle_events','triage_event','id'), ('mcp_proposals','mcp_proposal','id'),
    ('cycle_scope_events','cycle_scope_event','id'), ('admin_audit_logs','admin_audit','id'),
    ('external_refs','external_ref','id'), ('integration_sync_work','integration_work','id'),
    ('integration_inbound_applications','integration_application','id'), ('integration_conflicts','integration_conflict','id')
  ) AS v(tab, kind, pk) LOOP
    IF to_regclass('public.' || item.tab) IS NULL THEN RAISE EXCEPTION 'privacy registry missing associated store %', item.tab; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item.tab);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', item.tab);
    EXECUTE format('DROP POLICY IF EXISTS privacy_hold_association ON public.%I', item.tab);
    EXECUTE format('CREATE POLICY privacy_hold_association ON public.%I USING (privacy_authority.row_visible(%L, %I::text))', item.tab, item.kind, item.pk);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION privacy_authority.record_private_tombstone(evidence uuid, issue uuid, binding uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM 1 FROM public.integration_project_bindings WHERE id=binding FOR UPDATE;
  INSERT INTO privacy_authority.evidence(id,binding_id,issue_id,issuer,generation,scope_fingerprint,credential_fingerprint,lease_token,fence,terminal_verified,expires_at)
  SELECT evidence,binding,issue,'redmine_private',privacy_hold_generation,'authenticated-detail','authenticated-detail','authenticated-detail',0,true,clock_timestamp()+interval '5 minutes'
  FROM public.issues WHERE id=issue;
  IF NOT FOUND THEN RAISE EXCEPTION 'privacy issue missing'; END IF;
END $$;
CREATE OR REPLACE FUNCTION privacy_authority.prepare_containment(evidence uuid, issue uuid, binding uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE ev privacy_authority.evidence; next_generation integer; snapshot jsonb; BEGIN
  SELECT * INTO ev FROM privacy_authority.evidence WHERE id = evidence FOR UPDATE;
  IF NOT FOUND OR ev.used_at IS NOT NULL OR ev.binding_id <> binding OR ev.issue_id <> issue OR ev.expires_at <= clock_timestamp()
     OR ev.generation <> (SELECT privacy_hold_generation FROM public.issues WHERE id=issue)
     OR NOT ev.terminal_verified OR NOT EXISTS (SELECT 1 FROM privacy_authority.control WHERE singleton AND admission_enabled) THEN
    RAISE EXCEPTION 'privacy evidence rejected';
  END IF;
  PERFORM 1 FROM public.integration_project_bindings WHERE id = binding FOR UPDATE;
  PERFORM 1 FROM public.issues WHERE id = issue FOR UPDATE;
  SELECT privacy_hold_generation + 1 INTO next_generation FROM public.issues WHERE id = issue;
  UPDATE privacy_authority.evidence SET used_at = clock_timestamp() WHERE id = evidence;
  SELECT jsonb_build_object('generation', next_generation, 'title', title, 'description', description, 'key', key) INTO snapshot FROM public.issues WHERE id = issue;
  RETURN snapshot;
END $$;
CREATE OR REPLACE FUNCTION privacy_authority.contain_issue(issue uuid, binding uuid, generation integer, envelope text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE c privacy_authority.control; BEGIN
  SELECT * INTO c FROM privacy_authority.control WHERE singleton FOR UPDATE;
  IF NOT c.admission_enabled OR c.registry_version <> 1 OR envelope = '' THEN RAISE EXCEPTION 'privacy containment rejected'; END IF;
  PERFORM 1 FROM public.issues WHERE id = issue AND privacy_hold_generation = generation - 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'privacy generation changed'; END IF;
  INSERT INTO privacy_quarantine.issue_content(issue_id,binding_id,generation,snapshot_schema,envelope) VALUES (issue,binding,generation,1,envelope);
  -- Register associations before mutation: readers see absence even while retained
  -- lifecycle rows are being sanitized, and an unknown registry version aborts above.
  INSERT INTO privacy_authority.held_row_associations(store_kind,row_pk,issue_id,hold_generation,registry_version,disposition)
    SELECT 'triage', id::text, issue, generation, 1, 'delete' FROM public.triage_proposals WHERE target_issue_id = issue
    UNION ALL SELECT 'mcp_proposal', id::text, issue, generation, 1, 'delete' FROM public.mcp_proposals WHERE target_ref = (SELECT key FROM public.issues WHERE id=issue)
    UNION ALL SELECT 'cycle_scope_event', id::text, issue, generation, 1, 'sanitize' FROM public.cycle_scope_events WHERE issue_key = (SELECT key FROM public.issues WHERE id=issue)
    UNION ALL SELECT 'admin_audit', id::text, issue, generation, 1, 'sanitize' FROM public.admin_audit_logs WHERE entity_type='issue' AND entity_id=issue::text
    UNION ALL SELECT 'external_ref', id::text, issue, generation, 1, 'sanitize' FROM public.external_refs WHERE entity_type='issue' AND entity_id=issue
    UNION ALL SELECT 'integration_work', id::text, issue, generation, 1, 'fence' FROM public.integration_sync_work WHERE entity_type='issue' AND entity_id=issue
    UNION ALL SELECT 'integration_application', a.id::text, issue, generation, 1, 'fence' FROM public.integration_inbound_applications a JOIN public.integration_sync_work w ON w.id=a.work_id WHERE w.entity_type='issue' AND w.entity_id=issue
    UNION ALL SELECT 'integration_conflict', c.id::text, issue, generation, 1, 'sanitize' FROM public.integration_conflicts c LEFT JOIN public.integration_sync_work w ON w.id=c.work_id LEFT JOIN public.external_refs r ON r.id=c.ref_id WHERE (w.entity_type='issue' AND w.entity_id=issue) OR (r.entity_type='issue' AND r.entity_id=issue)
    ON CONFLICT (store_kind,row_pk) DO NOTHING;
  DELETE FROM public.triage_proposal_contents c USING public.triage_proposals p WHERE c.proposal_id = p.id AND p.target_issue_id = issue;
  DELETE FROM public.triage_proposals WHERE target_issue_id = issue;
  DELETE FROM public.mcp_proposals WHERE target_ref = (SELECT key FROM public.issues WHERE id=issue);
  UPDATE public.cycle_scope_events SET issue_key='[privacy hold]', reason=NULL WHERE issue_key = (SELECT key FROM public.issues WHERE id=issue);
  UPDATE public.admin_audit_logs SET payload='{}'::jsonb, reason=NULL WHERE entity_type='issue' AND entity_id=issue::text;
  UPDATE public.integration_sync_work SET state=CASE WHEN state IN ('queued','retry') THEN 'skipped' ELSE 'ambiguous' END, skipped_reason=CASE WHEN state IN ('queued','retry') THEN 'privacy_hold' ELSE skipped_reason END WHERE entity_type='issue' AND entity_id=issue AND state IN ('queued','retry','leased');
  UPDATE public.notifications SET payload = NULL, issue_id = NULL WHERE issue_id = issue;
  -- Holding is the final write: any error above rolls back quarantine, associations,
  -- sanitization and fences together instead of exposing a partial containment.
  UPDATE public.issues SET title = '[privacy hold]', description = NULL, privacy_held_at = clock_timestamp(), privacy_hold_generation = generation WHERE id = issue;
END $$;
CREATE OR REPLACE FUNCTION privacy_authority.load_recovery(capability uuid, issue uuid, binding uuid, member uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE c privacy_authority.recovery_capabilities; BEGIN
  SELECT * INTO c FROM privacy_authority.recovery_capabilities WHERE id = capability FOR UPDATE;
  IF NOT FOUND OR c.used_at IS NOT NULL OR c.issue_id <> issue OR c.binding_id <> binding OR c.member_id <> member OR c.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'privacy recovery rejected'; END IF;
  PERFORM 1 FROM public.issues WHERE id = issue AND privacy_held_at IS NOT NULL AND privacy_hold_generation = c.generation FOR UPDATE;
  RETURN (SELECT jsonb_build_object('envelope', envelope, 'generation', c.generation) FROM privacy_quarantine.issue_content WHERE issue_id = issue AND binding_id = binding AND generation = c.generation FOR UPDATE);
END $$;
CREATE OR REPLACE FUNCTION privacy_authority.release_issue(capability uuid, issue uuid, binding uuid, member uuid, title text, description text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM 1 FROM privacy_authority.recovery_capabilities WHERE id = capability AND issue_id = issue AND binding_id = binding AND member_id = member AND used_at IS NULL AND expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM privacy_authority.control WHERE singleton AND recovery_enabled) THEN RAISE EXCEPTION 'privacy release rejected'; END IF;
  UPDATE public.issues SET title = release_issue.title, description = release_issue.description, privacy_held_at = NULL WHERE id = issue;
  DELETE FROM privacy_authority.held_row_associations WHERE issue_id = issue;
  UPDATE privacy_authority.recovery_capabilities SET used_at = clock_timestamp() WHERE id = capability;
END $$;
CREATE OR REPLACE FUNCTION privacy_authority.assert_catalog() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM privacy_authority.control WHERE singleton AND registry_version = 1) THEN RAISE EXCEPTION 'privacy catalog invalid'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='privacy_authority' AND p.proacl IS NULL) THEN RAISE EXCEPTION 'privacy function ACL missing'; END IF;
END $$;
ALTER FUNCTION privacy_authority.record_private_tombstone(uuid,uuid,uuid) OWNER TO kanon_privacy_authority;
ALTER FUNCTION privacy_authority.prepare_containment(uuid,uuid,uuid) OWNER TO kanon_privacy_authority;
ALTER FUNCTION privacy_authority.contain_issue(uuid,uuid,integer,text) OWNER TO kanon_privacy_authority;
ALTER FUNCTION privacy_authority.load_recovery(uuid,uuid,uuid,uuid) OWNER TO kanon_privacy_authority;
ALTER FUNCTION privacy_authority.release_issue(uuid,uuid,uuid,uuid,text,text) OWNER TO kanon_privacy_authority;
ALTER FUNCTION privacy_authority.assert_catalog() OWNER TO kanon_privacy_authority;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA privacy_authority FROM PUBLIC, kanon_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA privacy_authority TO kanon_privacy_operator;
GRANT EXECUTE ON FUNCTION privacy_authority.issue_visible(uuid) TO kanon_runtime;

-- Recovery authority: durable idempotency and a short-lived, operator-only capability.
ALTER TABLE privacy_authority.recovery_capabilities ADD COLUMN IF NOT EXISTS key_hash text;
ALTER TABLE privacy_authority.recovery_capabilities ADD COLUMN IF NOT EXISTS snapshot_digest text;
ALTER TABLE privacy_authority.recovery_capabilities ADD COLUMN IF NOT EXISTS observed_at timestamptz;
CREATE TABLE IF NOT EXISTS privacy_authority.recovery_receipts (
  key_hash text NOT NULL, member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  binding_id uuid NOT NULL REFERENCES public.integration_project_bindings(id) ON DELETE CASCADE,
  issue_id uuid NOT NULL REFERENCES public.issues(id) ON DELETE CASCADE,
  source_generation integer NOT NULL, released_generation integer NOT NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (key_hash, member_id, binding_id, issue_id, source_generation),
  UNIQUE (member_id, key_hash)
);
ALTER TABLE privacy_authority.recovery_receipts OWNER TO kanon_privacy_authority;
REVOKE ALL ON privacy_authority.recovery_receipts FROM PUBLIC, kanon_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON privacy_authority.recovery_receipts TO kanon_privacy_operator;

CREATE OR REPLACE FUNCTION privacy_authority.mint_recovery_capability(capability uuid, issue uuid, binding uuid, member uuid, key_hash text, snapshot_digest text, observed_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE generation integer; BEGIN
  IF observed_at < clock_timestamp() - interval '30 seconds' OR observed_at > clock_timestamp() + interval '5 seconds' OR length(key_hash) <> 64 OR length(snapshot_digest) <> 64 THEN
    RAISE EXCEPTION 'privacy recovery proof rejected';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(member::text || ':' || key_hash, 0)) THEN RAISE EXCEPTION 'privacy recovery in progress'; END IF;
  PERFORM 1 FROM privacy_authority.recovery_receipts WHERE member_id=member AND key_hash=mint_recovery_capability.key_hash AND expires_at > clock_timestamp();
  IF FOUND THEN RAISE EXCEPTION 'privacy idempotency conflict'; END IF;
  SELECT privacy_hold_generation INTO generation FROM public.issues WHERE id=issue AND privacy_held_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM privacy_authority.control WHERE singleton AND recovery_enabled) THEN RAISE EXCEPTION 'privacy recovery rejected'; END IF;
  INSERT INTO privacy_authority.recovery_capabilities(id,binding_id,issue_id,generation,member_id,expires_at,key_hash,snapshot_digest,observed_at)
    VALUES(capability,binding,issue,generation,member,clock_timestamp()+interval '60 seconds',key_hash,snapshot_digest,observed_at);
  RETURN capability;
END $$;
ALTER FUNCTION privacy_authority.mint_recovery_capability(uuid,uuid,uuid,uuid,text,text,timestamptz) OWNER TO kanon_privacy_authority;
REVOKE ALL ON FUNCTION privacy_authority.mint_recovery_capability(uuid,uuid,uuid,uuid,text,text,timestamptz) FROM PUBLIC, kanon_runtime;
GRANT EXECUTE ON FUNCTION privacy_authority.mint_recovery_capability(uuid,uuid,uuid,uuid,text,text,timestamptz) TO kanon_privacy_operator;

-- A capability is meaningful only for this exact route context.  These columns
-- deliberately duplicate the rechecked binding fields so a credential/scope
-- replacement cannot race a provider read into releasing a held issue.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
ALTER TABLE privacy_authority.recovery_capabilities ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE privacy_authority.recovery_capabilities ADD COLUMN IF NOT EXISTS connection_id uuid;
ALTER TABLE privacy_authority.recovery_capabilities ADD COLUMN IF NOT EXISTS credential_id uuid;
ALTER TABLE privacy_authority.recovery_capabilities ADD COLUMN IF NOT EXISTS credential_fingerprint text;
ALTER TABLE privacy_authority.recovery_capabilities ADD COLUMN IF NOT EXISTS lifecycle_epoch integer;
ALTER TABLE privacy_authority.recovery_capabilities ADD COLUMN IF NOT EXISTS binding_lifecycle_epoch integer;
ALTER TABLE privacy_authority.recovery_capabilities ADD COLUMN IF NOT EXISTS remote_issue_id text;
ALTER TABLE privacy_authority.recovery_capabilities ADD COLUMN IF NOT EXISTS scope_fingerprint text;

CREATE OR REPLACE FUNCTION privacy_authority.mint_recovery_capability(
  capability uuid, issue uuid, binding uuid, member uuid, workspace uuid, connection uuid,
  request_key_hash text, credential uuid, expected_credential_fingerprint text,
  expected_lifecycle_epoch integer, expected_binding_lifecycle_epoch integer, expected_remote_issue_id text,
  expected_scope_fingerprint text, expected_snapshot_digest text, observed_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE generation integer; BEGIN
  IF observed_at < clock_timestamp() - interval '30 seconds' OR observed_at > clock_timestamp() + interval '5 seconds'
    OR length(request_key_hash) <> 64 OR length(expected_snapshot_digest) <> 64 OR length(expected_credential_fingerprint) <> 64 THEN
    RAISE EXCEPTION 'privacy recovery proof rejected';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(member::text || ':' || request_key_hash, 0)) THEN
    RAISE EXCEPTION 'privacy recovery in progress';
  END IF;
  IF EXISTS (SELECT 1 FROM privacy_authority.recovery_receipts WHERE member_id=member AND key_hash=request_key_hash AND expires_at > clock_timestamp()) THEN
    RAISE EXCEPTION 'privacy idempotency conflict';
  END IF;
  SELECT i.privacy_hold_generation INTO generation
  FROM public.issues i
  JOIN public.integration_project_bindings b ON b.id=binding AND b.connection_id=connection AND b.lifecycle='active'
  JOIN public.integration_connections c ON c.id=connection AND c.workspace_id=workspace AND c.service_credential_id=credential AND c.lifecycle_epoch=expected_lifecycle_epoch
  JOIN public.member_integration_credentials cr ON cr.id=credential AND cr.connection_id=connection AND cr.last_auth_status='valid' AND cr.revoked_at IS NULL
  JOIN public.external_refs r ON r.entity_id=i.id AND r.binding_id=binding AND r.connection_id=connection AND r.entity_type='issue' AND r.external_id=expected_remote_issue_id
  WHERE i.id=issue AND i.privacy_held_at IS NOT NULL AND b.lifecycle_epoch=expected_binding_lifecycle_epoch
    AND encode(public.digest(cr.encrypted_key, 'sha256'), 'hex')=expected_credential_fingerprint
    AND b.remote_project_id=expected_scope_fingerprint
  FOR UPDATE OF i, b, c, cr, r;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM privacy_authority.control WHERE singleton AND recovery_enabled) THEN
    RAISE EXCEPTION 'privacy recovery context rejected';
  END IF;
  INSERT INTO privacy_authority.recovery_capabilities(
    id,binding_id,issue_id,generation,member_id,expires_at,key_hash,snapshot_digest,observed_at,
    workspace_id,connection_id,credential_id,credential_fingerprint,lifecycle_epoch,binding_lifecycle_epoch,remote_issue_id,scope_fingerprint
  ) VALUES (
    capability,binding,issue,generation,member,clock_timestamp()+interval '60 seconds',request_key_hash,expected_snapshot_digest,observed_at,
    workspace,connection,credential,expected_credential_fingerprint,expected_lifecycle_epoch,expected_binding_lifecycle_epoch,expected_remote_issue_id,expected_scope_fingerprint
  );
  RETURN capability;
END $$;

CREATE OR REPLACE FUNCTION privacy_authority.load_recovery(capability uuid, issue uuid, binding uuid, member uuid, expected_snapshot_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE c privacy_authority.recovery_capabilities; BEGIN
  SELECT * INTO c FROM privacy_authority.recovery_capabilities WHERE id=capability FOR UPDATE;
  IF NOT FOUND OR c.used_at IS NOT NULL OR c.issue_id<>issue OR c.binding_id<>binding OR c.member_id<>member
    OR c.expires_at<=clock_timestamp() OR c.observed_at < clock_timestamp() - interval '60 seconds'
    OR c.snapshot_digest<>expected_snapshot_digest THEN
    RAISE EXCEPTION 'privacy recovery proof rejected';
  END IF;
  PERFORM 1 FROM public.issues WHERE id=issue AND privacy_held_at IS NOT NULL AND privacy_hold_generation=c.generation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'privacy recovery context rejected'; END IF;
  RETURN (SELECT jsonb_build_object('envelope', envelope, 'generation', c.generation)
    FROM privacy_quarantine.issue_content WHERE issue_id=issue AND binding_id=binding AND generation=c.generation FOR UPDATE);
END $$;

CREATE OR REPLACE FUNCTION privacy_authority.release_issue(
  capability uuid, issue uuid, binding uuid, member uuid, request_key_hash text, restored_title text, restored_description text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE c privacy_authority.recovery_capabilities; released integer; BEGIN
  SELECT * INTO c FROM privacy_authority.recovery_capabilities WHERE id=capability FOR UPDATE;
  IF NOT FOUND OR c.used_at IS NOT NULL OR c.issue_id<>issue OR c.binding_id<>binding OR c.member_id<>member
    OR c.key_hash<>request_key_hash OR c.expires_at<=clock_timestamp() OR c.observed_at < clock_timestamp() - interval '60 seconds'
    OR NOT EXISTS (SELECT 1 FROM privacy_authority.control WHERE singleton AND recovery_enabled) THEN
    RAISE EXCEPTION 'privacy release rejected';
  END IF;
  PERFORM 1 FROM public.issues WHERE id=issue AND privacy_held_at IS NOT NULL AND privacy_hold_generation=c.generation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'privacy recovery context rejected'; END IF;
  released := c.generation + 1;
  -- Restore exact quarantined canonical fields, then clean containment metadata and
  -- lift the fence. HELD is intentionally the last state-changing write.
  UPDATE public.issues SET title=restored_title, description=restored_description, privacy_hold_generation=released WHERE id=issue;
  DELETE FROM privacy_authority.held_row_associations WHERE issue_id=issue AND hold_generation=c.generation;
  UPDATE privacy_authority.recovery_capabilities SET used_at=clock_timestamp() WHERE id=capability;
  INSERT INTO privacy_authority.recovery_receipts(key_hash,member_id,binding_id,issue_id,source_generation,released_generation,expires_at)
    VALUES(request_key_hash,member,binding,issue,c.generation,released,clock_timestamp()+interval '24 hours');
  UPDATE public.issues SET privacy_held_at=NULL WHERE id=issue AND privacy_hold_generation=released;
  IF NOT FOUND THEN RAISE EXCEPTION 'privacy recovery context rejected'; END IF;
  RETURN jsonb_build_object('generation', released);
END $$;

ALTER FUNCTION privacy_authority.mint_recovery_capability(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,text,integer,integer,text,text,text,timestamptz) OWNER TO kanon_privacy_authority;
ALTER FUNCTION privacy_authority.load_recovery(uuid,uuid,uuid,uuid,text) OWNER TO kanon_privacy_authority;
ALTER FUNCTION privacy_authority.release_issue(uuid,uuid,uuid,uuid,text,text,text) OWNER TO kanon_privacy_authority;
REVOKE ALL ON FUNCTION privacy_authority.mint_recovery_capability(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,text,integer,integer,text,text,text,timestamptz), privacy_authority.load_recovery(uuid,uuid,uuid,uuid,text), privacy_authority.release_issue(uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC, kanon_runtime;
GRANT EXECUTE ON FUNCTION privacy_authority.mint_recovery_capability(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,text,integer,integer,text,text,text,timestamptz), privacy_authority.load_recovery(uuid,uuid,uuid,uuid,text), privacy_authority.release_issue(uuid,uuid,uuid,uuid,text,text,text) TO kanon_privacy_operator;
