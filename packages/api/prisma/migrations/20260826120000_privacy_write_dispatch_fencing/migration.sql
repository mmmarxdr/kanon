-- KAN-246 PR2e: bind synchronization work to the issue privacy generation.
DO $$ BEGIN
  LOCK TABLE public.integration_sync_work IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.integration_sync_work WHERE state::text IN ('leased','ambiguous')) THEN
    RAISE EXCEPTION 'privacy fence upgrade requires leased and ambiguous work to be drained'; END IF;
END $$;
ALTER TABLE public.integration_sync_work
  ADD COLUMN privacy_issue_id uuid,
  ADD COLUMN privacy_hold_generation integer,
  ADD COLUMN provider_io_fence integer;

-- Upgrade only rows whose root still exists. Project and legacy/unresolvable work stays nullable.
UPDATE public.integration_sync_work work
SET privacy_issue_id=issue.id, privacy_hold_generation=issue.privacy_hold_generation
FROM public.issues issue, public.integration_project_bindings binding
WHERE work.entity_type='issue' AND issue.id=work.entity_id
  AND binding.id=work.binding_id AND binding.project_id=issue.project_id;
UPDATE public.integration_sync_work work
SET privacy_issue_id=issue.id, privacy_hold_generation=issue.privacy_hold_generation
FROM public.comments comment
JOIN public.issues issue ON issue.id=comment.issue_id
JOIN public.integration_project_bindings binding ON binding.project_id=issue.project_id
WHERE work.entity_type='comment' AND comment.id=work.entity_id AND binding.id=work.binding_id;
UPDATE public.integration_sync_work work
SET privacy_issue_id=issue.id, privacy_hold_generation=issue.privacy_hold_generation
FROM public.time_entries entry
JOIN public.issues issue ON issue.id=entry.issue_id
JOIN public.integration_project_bindings binding ON binding.project_id=issue.project_id
WHERE work.entity_type='time_entry' AND entry.id=work.entity_id AND binding.id=work.binding_id;

-- Existing holds predate this fence. Refuse to conceal an in-flight provider start,
-- then make every already-contained row stale and terminal before runtime can see it.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.integration_sync_work work
    WHERE (work.state='leased' OR work.provider_io_fence IS NOT NULL) AND (
      EXISTS (SELECT 1 FROM public.issues issue WHERE issue.id=work.privacy_issue_id AND issue.privacy_held_at IS NOT NULL)
      OR EXISTS (
        SELECT 1 FROM privacy_authority.held_row_associations association
        JOIN public.issues issue ON issue.id=association.issue_id AND issue.privacy_held_at IS NOT NULL
        WHERE association.store_kind='integration_sync_work' AND association.row_pk=work.id::text
      )
    )
  ) THEN RAISE EXCEPTION 'privacy fence upgrade rejected: leased synchronization work'; END IF;
END $$;
INSERT INTO privacy_authority.held_row_associations(store_kind,row_pk,issue_id,hold_generation)
SELECT 'integration_sync_work',work.id::text,issue.id,issue.privacy_hold_generation
FROM public.integration_sync_work work JOIN public.issues issue
  ON issue.id=work.privacy_issue_id AND issue.privacy_held_at IS NOT NULL
ON CONFLICT DO NOTHING;
UPDATE public.integration_sync_work work SET
  privacy_hold_generation=issue.privacy_hold_generation-1,
  payload='{}'::jsonb,
  state=CASE WHEN work.state::text IN ('queued','retry','dead','ambiguous') THEN 'skipped'::public."SyncWorkState" ELSE work.state END,
  skipped_reason=CASE WHEN work.state::text IN ('queued','retry','dead','ambiguous') THEN 'privacy_hold' ELSE work.skipped_reason END,
  lease_token=CASE WHEN work.state::text IN ('queued','retry','dead','ambiguous') THEN NULL ELSE work.lease_token END,
  lease_until=CASE WHEN work.state::text IN ('queued','retry','dead','ambiguous') THEN NULL ELSE work.lease_until END,
  fence=CASE WHEN work.state::text IN ('queued','retry','dead','ambiguous') THEN work.fence+1 ELSE work.fence END
FROM public.issues issue
WHERE issue.id=work.privacy_issue_id AND issue.privacy_held_at IS NOT NULL;
UPDATE public.integration_sync_work work SET
  payload='{}'::jsonb,
  state=CASE WHEN work.state::text IN ('queued','retry','dead','ambiguous') THEN 'skipped'::public."SyncWorkState" ELSE work.state END,
  skipped_reason=CASE WHEN work.state::text IN ('queued','retry','dead','ambiguous') THEN 'privacy_hold' ELSE work.skipped_reason END,
  lease_token=CASE WHEN work.state::text IN ('queued','retry','dead','ambiguous') THEN NULL ELSE work.lease_token END,
  lease_until=CASE WHEN work.state::text IN ('queued','retry','dead','ambiguous') THEN NULL ELSE work.lease_until END,
  fence=CASE WHEN work.state::text IN ('queued','retry','dead','ambiguous') THEN work.fence+1 ELSE work.fence END
WHERE work.privacy_issue_id IS NULL AND EXISTS (
  SELECT 1 FROM privacy_authority.held_row_associations association
  JOIN public.issues issue ON issue.id=association.issue_id AND issue.privacy_held_at IS NOT NULL
  WHERE association.store_kind='integration_sync_work' AND association.row_pk=work.id::text
);

CREATE FUNCTION privacy_authority.work_visible(
  candidate text, root_issue uuid, root_generation integer,
  entity_kind text, entity uuid, operation_kind text, reason text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT privacy_authority.row_visible('integration_sync_work', candidate)
    AND reason IS DISTINCT FROM 'privacy_hold'
    AND (
      (root_issue IS NULL AND root_generation IS NULL)
      OR EXISTS (
        SELECT 1 FROM public.issues issue
        WHERE issue.id=root_issue AND issue.privacy_held_at IS NULL
          AND issue.privacy_hold_generation=root_generation
      )
      OR (
        entity_kind='issue' AND operation_kind='delete' AND entity=root_issue
        AND root_generation IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.issues issue WHERE issue.id=root_issue)
      )
    )
$$;
ALTER FUNCTION privacy_authority.work_visible(text,uuid,integer,text,uuid,text,text) OWNER TO kanon_privacy_authority;
REVOKE ALL ON FUNCTION privacy_authority.work_visible(text,uuid,integer,text,uuid,text,text) FROM PUBLIC, kanon_privacy_operator;
GRANT EXECUTE ON FUNCTION privacy_authority.work_visible(text,uuid,integer,text,uuid,text,text) TO kanon_runtime;

ALTER TABLE public.integration_sync_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_sync_work FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_runtime_visible ON public.integration_sync_work;
CREATE POLICY privacy_runtime_visible ON public.integration_sync_work FOR ALL TO kanon_runtime
USING (privacy_authority.work_visible(id::text,privacy_issue_id,privacy_hold_generation,entity_type,entity_id,operation::text,skipped_reason))
WITH CHECK (privacy_authority.work_visible(id::text,privacy_issue_id,privacy_hold_generation,entity_type,entity_id,operation::text,skipped_reason));

CREATE FUNCTION privacy_authority.fence_sync_work_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE root_id uuid; root_generation integer; held_at timestamptz;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW.privacy_issue_id IS DISTINCT FROM OLD.privacy_issue_id
        OR NEW.privacy_hold_generation IS DISTINCT FROM OLD.privacy_hold_generation)
       AND session_user <> 'kanon_privacy_operator'
      THEN RAISE EXCEPTION 'synchronization privacy fields are server managed' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.privacy_issue_id IS NOT NULL OR NEW.privacy_hold_generation IS NOT NULL
    THEN RAISE EXCEPTION 'synchronization privacy fields are server managed' USING ERRCODE='42501';
  END IF;
  CASE NEW.entity_type
    WHEN 'issue' THEN
      SELECT issue.id,issue.privacy_hold_generation,issue.privacy_held_at
      INTO root_id,root_generation,held_at
      FROM public.issues issue JOIN public.integration_project_bindings binding
        ON binding.id=NEW.binding_id AND binding.project_id=issue.project_id
      WHERE issue.id=NEW.entity_id FOR SHARE OF issue;
    WHEN 'comment' THEN
      SELECT issue.id,issue.privacy_hold_generation,issue.privacy_held_at
      INTO root_id,root_generation,held_at
      FROM public.comments comment JOIN public.issues issue ON issue.id=comment.issue_id
      JOIN public.integration_project_bindings binding
        ON binding.id=NEW.binding_id AND binding.project_id=issue.project_id
      WHERE comment.id=NEW.entity_id FOR SHARE OF issue;
    WHEN 'time_entry' THEN
      SELECT issue.id,issue.privacy_hold_generation,issue.privacy_held_at
      INTO root_id,root_generation,held_at
      FROM public.time_entries entry JOIN public.issues issue ON issue.id=entry.issue_id
      JOIN public.integration_project_bindings binding
        ON binding.id=NEW.binding_id AND binding.project_id=issue.project_id
      WHERE entry.id=NEW.entity_id FOR SHARE OF issue;
    ELSE RETURN NEW;
  END CASE;
  IF root_id IS NULL OR held_at IS NOT NULL
    THEN RAISE EXCEPTION 'privacy work root unavailable' USING ERRCODE='42501';
  END IF;
  NEW.privacy_issue_id := root_id;
  NEW.privacy_hold_generation := root_generation;
  RETURN NEW;
END $$;
ALTER FUNCTION privacy_authority.fence_sync_work_write() OWNER TO kanon_privacy_authority;
REVOKE ALL ON FUNCTION privacy_authority.fence_sync_work_write() FROM PUBLIC, kanon_runtime, kanon_privacy_operator;
CREATE TRIGGER integration_sync_work_privacy_root
BEFORE INSERT OR UPDATE OF privacy_issue_id, privacy_hold_generation ON public.integration_sync_work
FOR EACH ROW EXECUTE FUNCTION privacy_authority.fence_sync_work_write();

REVOKE INSERT, UPDATE ON public.integration_sync_work FROM kanon_runtime;
DO $$ DECLARE writable text; BEGIN
  SELECT string_agg(quote_ident(attname),',') INTO writable FROM pg_attribute WHERE
    attrelid='public.integration_sync_work'::regclass AND attnum>0 AND NOT attisdropped AND attname<>'provider_io_fence';
  EXECUTE format('GRANT INSERT (%s), UPDATE (%s) ON public.integration_sync_work TO kanon_runtime',writable,writable);
END $$;
CREATE FUNCTION privacy_authority.transition_provider_io(work_id uuid, owned_token text, owned_fence integer, owned_epoch integer, active boolean)
RETURNS integer LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
  WITH changed AS (
    UPDATE public.integration_sync_work SET provider_io_fence=CASE WHEN active THEN owned_fence ELSE NULL END
    WHERE id=work_id AND fence=owned_fence AND epoch=owned_epoch AND (
      (active AND state='leased' AND lease_token=owned_token AND lease_until>clock_timestamp() AND provider_io_fence IS NULL)
      OR (NOT active AND provider_io_fence=owned_fence)) RETURNING 1
  ) SELECT count(*)::integer FROM changed
$$;
ALTER FUNCTION privacy_authority.transition_provider_io(uuid,text,integer,integer,boolean) OWNER TO kanon_privacy_authority;
REVOKE ALL ON FUNCTION privacy_authority.transition_provider_io(uuid,text,integer,integer,boolean) FROM PUBLIC, kanon_privacy_operator;
GRANT EXECUTE ON FUNCTION privacy_authority.transition_provider_io(uuid,text,integer,integer,boolean) TO kanon_runtime;

CREATE FUNCTION privacy_authority.prevent_runtime_hidden_work_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF session_user='kanon_runtime' AND NOT privacy_authority.work_visible(
    OLD.id::text,OLD.privacy_issue_id,OLD.privacy_hold_generation,
    OLD.entity_type,OLD.entity_id,OLD.operation::text,OLD.skipped_reason
  ) THEN RAISE EXCEPTION 'runtime cannot delete hidden privacy row' USING ERRCODE='42501'; END IF;
  RETURN OLD;
END $$;
ALTER FUNCTION privacy_authority.prevent_runtime_hidden_work_delete() OWNER TO kanon_privacy_authority;
REVOKE ALL ON FUNCTION privacy_authority.prevent_runtime_hidden_work_delete() FROM PUBLIC, kanon_runtime, kanon_privacy_operator;
DROP TRIGGER privacy_runtime_preserve_hidden ON public.integration_sync_work;
CREATE TRIGGER privacy_runtime_preserve_hidden BEFORE DELETE ON public.integration_sync_work
FOR EACH ROW EXECUTE FUNCTION privacy_authority.prevent_runtime_hidden_work_delete();

CREATE FUNCTION privacy_authority.contain_sync_work_on_hold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.integration_sync_work work
    WHERE (work.state='leased' OR work.provider_io_fence IS NOT NULL) AND (work.privacy_issue_id=OLD.id OR EXISTS (
      SELECT 1 FROM privacy_authority.held_row_associations association
      WHERE association.store_kind='integration_sync_work' AND association.row_pk=work.id::text
        AND association.issue_id=OLD.id
    ))
  ) THEN RAISE EXCEPTION 'privacy containment rejected: active provider I/O'; END IF;

  INSERT INTO privacy_authority.held_row_associations(store_kind,row_pk,issue_id,hold_generation)
  SELECT 'integration_sync_work',work.id::text,OLD.id,NEW.privacy_hold_generation
  FROM public.integration_sync_work work WHERE work.privacy_issue_id=OLD.id
  ON CONFLICT DO NOTHING;

  UPDATE public.integration_sync_work work SET
    privacy_issue_id=coalesce(work.privacy_issue_id,OLD.id),
    privacy_hold_generation=coalesce(work.privacy_hold_generation,OLD.privacy_hold_generation),
    payload='{}'::jsonb,
    state=CASE WHEN work.state::text IN ('queued','retry','dead','ambiguous') THEN 'skipped'::public."SyncWorkState" ELSE work.state END,
    skipped_reason=CASE WHEN work.state::text IN ('queued','retry','dead','ambiguous') THEN 'privacy_hold' ELSE work.skipped_reason END,
    lease_token=CASE WHEN work.state::text IN ('queued','retry','dead','ambiguous') THEN NULL ELSE work.lease_token END,
    lease_until=CASE WHEN work.state::text IN ('queued','retry','dead','ambiguous') THEN NULL ELSE work.lease_until END,
    fence=CASE WHEN work.state::text IN ('queued','retry','dead','ambiguous') THEN work.fence+1 ELSE work.fence END
  WHERE work.privacy_issue_id=OLD.id OR EXISTS (
    SELECT 1 FROM privacy_authority.held_row_associations association
    WHERE association.store_kind='integration_sync_work' AND association.row_pk=work.id::text
      AND association.issue_id=OLD.id
  );
  RETURN NEW;
END $$;
ALTER FUNCTION privacy_authority.contain_sync_work_on_hold() OWNER TO kanon_privacy_authority;
REVOKE ALL ON FUNCTION privacy_authority.contain_sync_work_on_hold() FROM PUBLIC, kanon_runtime, kanon_privacy_operator;
CREATE TRIGGER privacy_contain_sync_work
BEFORE UPDATE OF privacy_held_at, privacy_hold_generation ON public.issues
FOR EACH ROW WHEN (OLD.privacy_held_at IS NULL AND NEW.privacy_held_at IS NOT NULL)
EXECUTE FUNCTION privacy_authority.contain_sync_work_on_hold();
