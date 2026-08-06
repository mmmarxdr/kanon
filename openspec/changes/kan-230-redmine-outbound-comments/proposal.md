# Proposal: Deliver Kanon Comments to Redmine Safely

## Intent

Let developers and PMs comment once in Kanon and deliver eligible public comments to linked Redmine issues. Guarantee effectively-once delivery with marker proof and safe conflict otherwise—not unconditional exactly-once.

## Proposal question round

- **Eligibility?** Public comments on active links qualify.
- **Ambiguity?** One blind write, marker reconciliation, then manual conflict; NEVER write blindly twice.
- **Operations?** Durable evidence suffices; operations UI is deferred.

## Scope

### In Scope
- Atomically persist comment, activity, and replay-safe integration work.
- Fence by active link, binding epoch, credential version, comment state, parent reference, and operation before provider I/O.
- Append one note with `<!-- kanon-comment:<local-comment-uuid> -->` through a one-attempt transport; reconcile by marker.
- Attach marked inbound journals to the original comment without duplication and record echo evidence.

### Out of Scope
- Edit/delete sync, private comments, truthful remote authorship, historical privacy/tombstone audits, operations UI, broader polling hardening, and migrations.

## Capabilities

### New Capabilities
- `redmine-outbound-comments`: Durable delivery, ambiguity handling, and inbound echo suppression for public comments.

### Modified Capabilities
- None.

## Approach

Extend the API integration outbox and provider contract for comments. Capture transactionally, validate snapshots, and use a note-specific single-attempt PUT. Reconcile uncertainty by scanning journals for the stable marker. Inbound polling uses that marker to finalize the original comment reference and record echo evidence.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/api/src/modules/comment/service.ts` | Modified | Atomic capture |
| `packages/api/src/modules/integrations/{outbox.ts,worker.ts,inbound.ts,core/types.ts}` | Modified | Work, fences, dispatch, reconciliation, echoes |
| `packages/api/src/modules/integrations/providers/redmine/{adapter.ts,http-client.ts}` | Modified | One-attempt note write and marker lookup |
| Focused API tests | New/Modified | Strict-TDD safety coverage |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Duplicate note after ambiguity | Medium | Marker proof or conflict; no second blind write |
| Stale state causes unsafe I/O | Medium | Pre-I/O fences and durable evidence |
| Poll races finalization | Medium | Attach by marker |
| Diff exceeds 400 lines | Medium | Split before runtime wiring, never safety tests |

## Rollback Plan

Disable capture and dispatch, fail queued comment work closed, and retain marker recognition until in-flight reconciliation completes. Revert comment paths; no schema rollback is required.

## Dependencies

- Existing outbox, active binding, credential snapshot, and readable Redmine journals.

## Success Criteria

- [ ] Eligible comments are captured atomically and delivered with one marker.
- [ ] Ambiguous writes are proven or enter manual conflict without another blind write.
- [ ] Marked journals attach without duplicate comments.
- [ ] Stale, missing, revoked, unlinked, changed, or unsupported work performs no provider I/O and leaves evidence.
