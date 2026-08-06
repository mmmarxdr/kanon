# Design: Safe Redmine Outbound Comments

## Technical Approach

Use the existing `IntegrationSyncWork`, `ExternalRef`, `IntegrationInboundApplication`, and `IntegrationConflict` tables; no migration. Inside `createComment()`, one Prisma transaction creates the comment and `ActivityLog`, finds the active project binding plus the issue `ExternalRef` and member credential, and captures work when the link is active. It then preserves the current best-effort `autoSubscribe` → mention parsing/emission → `comment.created` sequence after commit.

```text
createComment -> DB tx(comment, activity, work) -> post-commit events
worker claim -> prepare/fence -> ONE PUT -> journal read -> finalize
                                      \-> ambiguous -> marker read -> done | conflict
inbound poll -> parse marker -> lock work -> attach same comment/ref -> echo evidence
```

## Architecture Decisions

| Decision | Choice and rationale | Rejected |
|---|---|---|
| Work identity | `entityType=comment`, `entityId=comment.id`, `operation=create`, `correlationId=comment.id`; dedupe remains `binding|comment|id|create|id`. `loadEntityOwnership()` resolves through `Comment.issue.project`; its lane is the parent issue lane, preserving issue/comment order without coalescing comments. | New idempotency table/migration: existing unique work/ref/application keys suffice. |
| Snapshot | Payload v1 is `{body,bodySha256,commentUpdatedAt,issueId,parentRefId,parentRemoteIssueId,bindingEpoch,credentialId,credentialLastValidatedAt,credentialRemoteUserId}`; work also stores epoch, credential ID, parent `refId`, and canonical marker. Body/marker are never written back locally. | Marker in local body: leaks transport metadata and breaks edit semantics. |
| Provider contract | Add `pushComment(CanonicalComment, remoteIssueId)` and a `comment` arm to `ProviderCreateReconciliationRequest`. The comment request carries `expectedRemoteIssueId`, `marker`, `strippedBodySha256`, and `expectedCredentialRemoteUserId`; its result is `proved` with `{externalId, remoteIssueId, marker, strippedBodySha256, remoteActorId}` or `unproved` with a reason/count. | Broad umbrella spec/API reuse: comment append and journal identity have distinct semantics. |
| Redmine transport | Add `RedmineHttpClient.putOnce()` (same SSRF pinning/timeouts, exactly one transport attempt). `RedmineProviderAdapter.pushComment()` sends `{issue:{notes:"<body>\n\n<marker>",private_notes:false}}`, then makes one issue-detail read. It can return `proved` only when exactly one journal proves the expected remote issue, exact unique marker, marker-stripped body hash, and captured remote credential actor; otherwise it returns `unproved`. The worker makes at most one later bounded read-only reconciliation request (normal GET attempts apply), using those same proof fields, then conflicts. | Generic `put()` retries; unconditional retry; both can duplicate journals. |
| Ambiguity | One blind write only. A missing/indeterminate response becomes `ambiguous`; bounded read-only reconciliation uses the same normative proof. Only a unique fully matching result finalizes; zero, multiple, unreadable, or any mismatched proof creates an open `outbound-create-ambiguity` conflict. | Claiming unconditional exactly-once: Redmine has no idempotency key. The truthful guarantee is effectively-once when complete marker proof exists, otherwise safe manual conflict. |

## Contracts and Invariants

`comment-marker.ts` owns grammar `<!-- kanon-comment:<canonical-lowercase-uuid> -->`. Its parser accepts exactly one standalone final marker and returns the preceding body; reserved marker text in a local body is a pre-I/O manual conflict. Both immediate success lookup and later reconciliation construct the same comment reconciliation request from the immutable snapshot: expected remote parent issue ID, exact canonical marker, SHA-256 of the marker-stripped remote body, and captured credential `remoteUserId`. A result is finalizable only if one and only one journal matches every field and yields its journal ID; zero, multiple, missing actor, unreadable body, or any mismatch is `unproved` and cannot finalize. Inbound association applies the same proof plus binding, local UUID, and work operation/payload. Thus copied/spoofed markers are not attached.

`worker.prepare()` locks connection → binding → work, then verifies: live lease/fence; active binding/connection and epoch; `operation=create`; payload v1; provider capability; comment exists under the bound project; unchanged body/hash/update time; exact parent issue `ExternalRef`; no conflicting comment ref; and exact valid, unrevoked credential ID plus `lastValidatedAt`. **No adapter method runs before all fences pass.**

| Outcome | Conditions before/after I/O |
|---|---|
| `superseded`/`skipped`/`dead` | Edited/deleted comment, inactive/unlinked parent, stale epoch, missing/revoked/replaced credential, unsupported operation/payload/capability; zero provider I/O. |
| Open conflict + `ambiguous` | Ref/marker association collision before I/O, or zero/multiple/unreadable proof after the single write. |
| `done` | Unique journal proof attaches a comment `ExternalRef` and clears the lease atomically. |

## Inbound Race and Idempotency

`persistInboundCommentsTx()` handles marked journals before normal creation. It follows worker lock order, locks the matching work, revalidates associations, then upserts/validates the comment `ExternalRef`, marks unsettled work `done`, and creates a deduped `IntegrationInboundApplication` with `workId`, `refId`, and echo outcome. If worker finalizes first, inbound records the same echo; if inbound wins, worker finalization observes stale work. Concurrent polls converge through existing external-ref/application unique keys. Neither path creates another `Comment`.

## Delivery, File, and Test Boundaries

Use a three-PR `feature-branch-chain`. Changed-line forecasts count product and test additions plus deletions; `.codegraph/` and OpenSpec artifacts are excluded. Each PR has a hard stop at 399 lines: if strict-TDD proof cannot fit, apply is blocked rather than weakening behavior or tests.

| PR | Branch → target | Deployable work unit and focused proof | Forecast |
|---|---|---|---:|
| 1 | `feat/kan-230-redmine-comment-pr1-marker-recognition` → `feat/kan-230-redmine-outbound-comments` | Add canonical marker grammar/parser and inbound marked-journal recognition with binding/parent/UUID/work validation and spoof rejection. Test canonical, malformed, multiple, reserved, valid-echo, and forged/copy cases. No capture or comment work exists, so the slice is inert. | 260 |
| 2 | `feat/kan-230-redmine-comment-pr2-dispatch` → `feat/kan-230-redmine-comment-pr1-marker-recognition` | Add provider-neutral proof contracts, Redmine `putOnce()` public-note transport, adapter proof/reconciliation, worker payload/fences/dispatch/reconciliation, and `commentDispatchEnabled=false`. Focused contract, HTTP, adapter, fence, ambiguity, and unrelated-work tests prove complete parent+marker+stripped-body-hash+actor proof and at most one blind write. No local capture exists, so the slice is inert. | 390 |
| 3 | `feat/kan-230-redmine-comment-pr3-capture` → `feat/kan-230-redmine-comment-pr2-dispatch` | Before code, validate JD-003 lock order against current mutation paths; block and amend/re-review if comment insertion can invert `connection → binding → work`. Then add atomic comment/activity/outbox capture, ownership/parent issue lane, inbound/worker race convergence, and `commentCaptureEnabled=false`. Focused service, outbox, race, rollout, rollback, and end-to-end tests cover both race orders. | 390 |

The tracker branch `feat/kan-230-redmine-outbound-comments` targets `main` as draft/no-merge. Create each child from its target and review the immediate-parent diffs in order PR1, then PR2, then PR3. Final accumulation is leaf-to-root: merge PR3 into PR2, PR2 into PR1, and PR1 into the tracker; the tracker then merges to `main`. Preserve those distinct commits and merge boundaries so rolling back PR3, then PR2, retains PR1 recognition. Tests remain with their behavior; no slice adds migrations, UI, private/edit/delete/authorship, or broader polling scope.

## Dependencies

PR1 has no runtime dependency and recognition stays enabled. PR2 depends on PR1's canonical parser/recognizer. PR3 depends on PR2 and cannot start implementation until the JD-003 validation gate passes. JD-001/JD-002 invariants remain normative; JD-004 is information only.

## Rollout / Rollback

Deploy and observe PR1 recognition first. Deploy PR2 with dispatch off and verify it remains inert. Deploy PR3 with capture and dispatch off; enable capture first, observe durable queued work, then enable dispatch and observe proof/reconciliation outcomes. Roll back in order PR3 → PR2: disable dispatch, disable capture, revert/hold PR3, then revert/hold PR2. Retain PR1 recognition and inbound polling so in-flight marked journals can reconcile; unrelated integration work continues and ambiguous work is never blindly retried. No schema rollback is required.

## Open Questions

None.
