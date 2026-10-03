# ADR 0016: Provider and workspace request concurrency

Status: accepted for v0.15.0

## Decision

Retain four shared service slots and one active managed request per logical participant. Add a saved integer limit from 1–4 for each provider kind and for each workspace. All six provider kinds, including simulation, have independent service-wide allowances. Models, credentials, and endpoints within a kind share its allowance. The service remains a single SQLite writer and scheduling authority; there are no distributed claims, priorities, fairness guarantees, or rate/token budgets.

Generation occupancy captures the provider from the attempt's frozen snapshot. Greeting/coordinator probes capture their saved participant binding. Both consume a shared slot, a workspace slot, and a provider slot. Retries retain the original binding even after the current participant changes provider. Settings are dispatch policy, not model context, routing grants, or a change to snapshot provenance.

Check scoped capacity before a durable claim. A hold cannot append messages, consume turns, create attempts, change room revisions, or emit a durable event. Continue scanning other eligible participants/scopes while preserving stored order within each participant's queue; a later job cannot bypass a held earlier job by using another provider. The existing global-capacity early return remains valid because every request consumes that global allowance. Existing deadlines and explicit cancellation still apply to held work.

Provider edits are permitted while requests run. Lowering drains existing occupancy and holds new starts until below the new allowance; temporarily observed occupancy may exceed a lowered limit. Raising allows already authorized queues to progress on the next pump. Neither edit cancels, retries, refunds turns, resumes paused workspaces, or initiates a probe. Workspace edits retain the existing pending-job/workflow/probe and archive guards; finishing stopped transports may drain under a changed cap.

## Persistence and HTTP

The settings payload gains a strict complete `providerConcurrency` map. Missing legacy maps read as four for every kind. `Room.maxConcurrentRequests` is additive and optional for old payloads; absence reads as four. New creation/settings commands accept a default of four, but a workspace edit omitting the field retains its saved limit. Conversation-default edits omitting the map retain saved provider policy. Schema versions remain SQLite 2 and room 1; no destructive migration occurs.

Authenticated `PUT /api/settings/provider-limits` takes exactly the complete six-kind map and updates only that policy using the current stored conversation defaults. `GET /api/settings` returns the full settings. Existing `PUT /api/settings` accepts a full explicit map or an older defaults-only body. The client's conversation-default form omits the map so dirty defaults and Restore defaults cannot overwrite a more recent provider edit. Limits reject fractions, strings, nulls, missing map keys, extra keys, and values outside 1–4. Failed SQLite writes retain previous state and emit no successful change notification. Existing token, Host, Origin, content-type, method, and body-size protections apply.

## Cleanup and deletion

Count the engine's current managed generation/probe maps. Ordinary completion, failure, or Stop retains occupancy until provider transport cleanup finishes, avoiding an early replacement start. Whole-workspace and thread deletion retain ADR 0005's immediate local dispatch release: commit deletion, abort affected work, remove its managed entries, and reject late output. Probe metadata is keyed by its exact AbortController and removed on cleanup; a deleted entry no longer contributes occupancy. Preserve bulk preview bindings to exact probe/transport instances.

These limits bound service-managed requests. They cannot guarantee remote cancellation, provider acceptance/rate limits, concurrent remote processing, cost, or refunds. Remote execution can continue after abort/deletion; independent services and external submissions are outside accounting. Do not strengthen this into a billing or physical transport guarantee without changing the architecture and deletion contract explicitly.

## Inspection and UI

Keep `RoomActivity.capacity` unchanged and add workspace occupancy, relevant provider-kind occupancy, and `workspace_capacity`/`provider_capacity` blockers. Include kinds used by the current roster or queued/running frozen bindings. Other rooms contribute numeric counts only, with no foreign IDs, names, text, endpoints, or model IDs. Inspection remains read-only and never dispatches, expires, retries, or probes.

Settings uses native labeled bounded numeric controls, separate provider/default forms, explicit save success/failure, and preserved unsaved edits. Existing workspace locks apply. Queue entries expose their frozen provider occupancy, and settings change notifications refresh other open views without requiring a room revision or remounting drafts.

## Evidence and remaining scope

`tests/concurrency.test.ts` covers strict bounds, legacy loading/save preservation and restart, shared scope dispatch, anonymous inspection without writes, drain/raise behavior, both probe kinds, rejected probes, probe failures, frozen retries and per-agent order, completion/Stop/deletion cleanup, archive/pending/shutdown guards, forced SQLite rollback, and the authenticated HTTP boundary. `tests/ui/concurrency.spec.ts` covers durable settings, native validation/failure, draft/default preservation, narrow themes, restart, workspace holds, and another workspace's synthetic probe with cross-view capacity changes. Browser streams come from a held loopback protocol fixture, without installed models or cloud credentials.

Only the original per-provider/per-workspace concurrency checkbox is completed. All 424 original entries remain, with 180 unfinished. Fair scheduling, priorities, distributed execution, broader budgets, full accessibility, credentialed provider verification, packaging, and every other incomplete README entry remain open. Version 1 remains blocked until all entries are implemented and validated.
