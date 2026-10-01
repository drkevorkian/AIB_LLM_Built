# 0006 — Participant rosters and configuration history

## Scope and identity

Each v0.5 workspace remains one room. Creation accepts a participant count from 1 to 8, defaulting to 3; the welcome workspace retains AI A, AI B, and AI C. The eight-identity cap includes inactive participants. At least one participant must remain active. Participant removal and larger rosters require a separate policy and are not implemented here.

The server assigns an immutable participant ID. Names may repeat, including when several participants use the same provider/model. Routing, queues, reply targets, usage, and configuration history use IDs. Duplicate display names receive a roster-number suffix in controls and answer labels. Since identities are retained and never reordered, the number remains stable; historical labels use the roster frozen in their snapshot.

New participants start active in simulation with revision 0. Adding or activating a participant does not invoke a provider or consume turns. The user explicitly configures a live connection and selects recipients. The existing global limit of four simultaneous generations and the per-participant single-flight limit remain unchanged.

## Commands and mutation boundary

`POST /api/rooms/:roomId/participants` accepts only `{name, role}` and returns the updated room with status 201. Identity, provider, model, activation, and revision values cannot be supplied through creation. `PUT /api/rooms/:roomId/participants/:agentId` accepts only `{active: boolean}` and returns the updated room. Provider/model configuration continues through the existing validated agent-settings endpoint.

All routes enforce the same local session token, loopback Host, and Origin requirements as other commands. Validation checks workspace membership, count limits, and the last-active rule before commit. Invalid commands do not partially mutate settings, reserve turns, or start work.

Adding, configuring, deactivating, and reactivating require a quiescent workspace: no queued/running job, running or blocked relay, running/waiting/blocked discussion, or connection probe for any participant in that workspace. Pausing does not remove obligations. Finish pending work or use Stop before editing; Stop does not automatically resume the room after an edit. A configuration modal may be inspected during pending work, but its save is rejected by the engine.

## Eligibility and frozen workflows

Only active participants can receive new questions, serve as synthesizers/coordinators, or occupy relay steps. Discussion peer grants contain active non-coordinator IDs from submission and remain frozen. A coordinator cannot widen its grant through prose or structured actions. A single-participant discussion can finish without requesting peers; it cannot submit an empty peer request.

Deactivation affects generation eligibility, not visibility. Historical room-visible messages, settings, roles, usage, and provenance remain available, including in subsequent active participants' context. This is not a privacy control.

The client reconciles roster changes from other views. It preserves draft text, removes inactive recipients and relay steps, replaces an invalid coordinator, clears an invalid synthesizer, clamps quorum, and clears reply targets whose author is inactive. Added/reactivated identities remain observers until selected. The server validates submitted IDs regardless of client state.

Before explicit retry, the engine checks every identity required by the original request/workflow. An inactive dependency produces a visible error before turn reservation or provider invocation. Reactivation permits retry with the original provider/model/role, objective, and frozen roster; a new question uses current configuration. Synthesis continuation and retry retain the original request's bindings while incorporating only the recorded included answers. Defensive dispatch cancels an unavailable queued identity without invoking it or consuming a turn and broadcasts the resulting state.

## Revisions and attribution

Each successful configuration or activation change increments `configRevision` and stores a deep copy of the complete participant configuration plus its recorded time in `room.agentRevisions`. Creation records revision 0. These records commit with the room mutation, including revisions never used by a generation. Setting the same activation value does not create another configuration revision. API credentials remain in the service environment and are not part of these records.

Invocation snapshots retain participant names, roles, providers, models, revisions, and the objective. Transcript and workflow labels resolve their snapshot roster; copied context messages also record the source author label. Renaming a participant therefore preserves older attribution and exports. A reply targets the same identity using its current label and eligibility, even when the source answer has an older name.

The SQLite database remains version 2 and room documents remain schema version 1. `active` and `agentRevisions` are additive optional fields. Missing activation means active. When reading a legacy room without revision history, storage recovers distinct `(participant ID, configuration revision)` records present in existing snapshots and current settings. Recovered edit times are `null` and the UI says they are unknown. Previously unrecorded unused edits cannot be reconstructed. Recovered records are persisted with the next room mutation; new edits always record their full history.

## Validation

Service and HTTP tests cover creation bounds, identity scope, duplicate names, strict bodies, sessions/origins, activation/revisions, last-active and cap rules, workflow/probe locks, active-only routing, frozen peer grants, single-participant decisions, scheduler capacity, retry accounting/bindings, historical labels/export, and legacy/new-history persistence across disk restart. Chromium tests cover creation, adding/deactivating/reactivating, preserved drafts, quorum adjustment, exact-ID replies, duplicate-name routing, another open view, history after reload, and a narrow layout. Both Node 24.19.0 and 26.10.0 run these checks; CI also checks Linux, Windows, and macOS. Provider fixtures verify protocols without credentialed account/model smoke tests.
