# 0015 — Confirmed participant removal and retained identity

## Scope and authority

v0.14.0 adds permanent removal from the current roster, separately from reversible deactivation. A workspace still has at most eight current identities, including inactive ones, and at least one active identity. Removal frees a current slot while retaining the removed identity, configuration history, messages, usage, workflows, and snapshots. It neither invokes/cancels a provider nor refunds turns, resumes a workspace, or rewrites an old obligation.

`DELETE /api/rooms/:roomId/participants/:agentId` accepts only `{expectedRevision}`: a nonnegative safe integer identifying the workspace revision reviewed by the human. It uses existing local session, exact workspace membership, Host, Origin, cross-site, method, JSON/body-size, and security-header checks. The client cannot supply an alternative identity, name, activation state, timestamp, role, provider, or replacement grant. Wrong scope, unknown IDs, missing/extra/malformed fields, a stale revision, or an already removed identity fail before mutation.

The review uses the loaded workspace's exact title/ID and participant ID/label, retained authored-message and configuration counts, and the full effect/retention policy. It does not reserve work or grant authority through names. A later workspace change requires closing and reviewing again. New configuration, history, activation, archive, and removal changes all advance that same stored revision. A read-only probe that ends before confirmation does not invalidate a revision; live probes still block confirmation.

## Quiescence and atomicity

Removal requires an open workspace without any queued/running job, running/blocked relay, running/waiting/blocked discussion, or any workspace connection probe. A terminal request still closing its transport also blocks removal until its slot actually releases. Pause retains obligations and cannot permit removal. Stop cancels work through its existing policy; wait for request cleanup before a fresh review. The last-active check also rejects an already invalid zero-active record.

The existing `RoomStore.mutate` SQLite transaction validates all guards before writing, sets `active: false`, records server-owned `removedAt`, increments the participant configuration revision, appends its complete configuration revision, and records an `agent.removed` audit event. The room revision advances in the same commit. Any validation/write failure rolls back activation, removal time, revisions, history, and audit together. Unrelated workspaces are unchanged. There is no partial deletion or automatic cancellation to make the command succeed.

## Retention, capacity, and numbering

`room.agents` remains an append-only identity registry, including removed records. Optional `Agent.removedAt` marks permanent retirement, and optional `rosterNumber` preserves the original append ordinal. New records receive an application-assigned ordinal; legacy current records recover their known array ordinal on read. The next mutation persists that metadata without changing old snapshots. Original snapshots/revisions with no ordinal retain their original roster-position fallback; unknown historical edit times remain unknown.

Current capacity, Settings controls, new-question snapshot rosters, and queue inspection exclude removed records. Inactive current identities still occupy a slot. Adding a replacement appends a fresh ID and ordinal, starts active in simulation at configuration revision zero, and does not invoke a provider or consume turns. Retained IDs/numbers are never reassigned within that workspace; a generated ID collision is rejected without committing. Duplicate-name controls and new snapshots use the recorded ordinal rather than a filtered array position.

Settings exposes **Removed participants** and their retained configuration history read-only; the stored revisions preserve complete configuration records. Historical author names, reply links, copied source labels, old provider/model bindings, attempt outcomes, response closures, usage, and exports are preserved. New questions omit removed roles/connections from the participant roster but can include their retained room-visible messages. This is invocation-eligibility management, not a privacy boundary or data erasure.

Thread deletion retains its existing conversation/source-redaction rules and does not erase participant configuration history. Whole-workspace deletion removes its retained participant records through the existing deletion policy. Provider submissions, exports, external backups, already copied text, and disk remnants cannot be retracted or securely erased by removal. Large-history pagination and broader retention/backup/erasure work remain separate unfinished checklist items.

## Workflow and retry boundaries

`isAgentActive` treats a removed identity as ineligible even if a stale record also says `active: true`. Removed identities cannot be configured, activated, deactivated, probed, addressed, chosen as synthesizers/coordinators/relay steps, or included in new peer grants. Defensive dispatch cancels an unavailable queued identity before provider invocation or turn use.

An explicit retry checks all identities required by its original recipients, synthesis binding, relay order, or discussion grant. If any was removed, retry fails visibly before reservation/invocation; a same-named replacement cannot inherit the old identity or obligations. Ask a new question with current participants. Otherwise eligible retries keep their original frozen roster, including removed observers, and original objective/model/role/context. Removal never rewrites a prior snapshot to make a retry appear current.

Other open views retain drafts and explicit thread selection, prune removed recipients/relay choices, repair quorum/synthesis/coordinator choices through the existing roster reconciliation, clear unavailable reply targets, and close a removed identity's configuration form. Added replacements remain unselected observers. Historical replies to removed identities stay disabled with an accurate explanation.

## Confirmation and uncertain responses

The existing native dialog provides a labeled exact-ID review. Cancel receives focus; Escape, Cancel, and close before submission abandon the review without mutation. Once confirmation starts, cancellation/closing is held. The DELETE request has a 15-second abort signal. Known rejection disables the old confirmation and requires closing/refreshed review. Network/lost/unknown server responses disclose that removal may have completed and require **Close and refresh participants** to inspect authoritative state. No automatic destructive retry or substitution is permitted; the existing single session reauthentication can only retry an authentication rejection that happened before the command.

A repeated confirmed request cannot retire another identity: the path remains exact, the first commit advances the workspace revision, and the removed record rejects replay. This is local revision protection, not provider reconciliation or a durable remote-operation ledger.

## Validation and unchanged boundaries

Eighteen new service/store/HTTP tests cover retention/provenance and export, slot reuse, strict/stale/scope guards, last-active protection, pending jobs/blocked workflows/probes/finishing transports, irreversible eligibility, removed grants and defensive dispatch, required and observer retries, forced SQLite rollback, disk restart/legacy labels, generated-ID collision, authenticated Host/Origin/method checks, archives, and shutdown. Four isolated Chromium flows cover native keyboard cancellation, exact duplicate identity, retained history, current slots, narrow themes, restart, cross-view reply/draft reconciliation, unselected replacements, stale review, pending-work and last-active guards, held cancellation, and a lost successful response without automatic repeat.

Both supported Node runtimes must pass the full source/platform matrix and Chromium suite. Fixtures use simulation and isolated databases with blank cloud credentials; there are no credentialed model checks. No dependency, runtime-range, database-version, room-schema-version, license, or provider permission changes are included. The complete version 1 gate remains in force.
