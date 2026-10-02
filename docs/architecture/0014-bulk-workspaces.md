# ADR 0014: Confirmed atomic bulk workspace management

Status: accepted for v0.13.0. Extends [ADR 0005](0005-settings-and-deletion.md) and [ADR 0007](0007-workspace-organization.md).

## Scope and interface

Manage workspaces supports archive, restore, and whole-workspace deletion for 1–25 explicitly selected existing room IDs. A room remains the current workspace boundary. This feature completes the existing workspace-organization bulk task and the remaining bulk-deletion part of the settings/management checklist. It does not introduce workspace groups, thread batches, scheduled retention, backups, secure erasure, or provider-side deletion.

The picker has native labeled checkboxes, bounded literal name/objective search, and active/archived/all filters. Duplicate names display independent full IDs. Changing a filter clears selection; hidden rows cannot silently join a preview. Selection never changes the current conversation, reply target, or composer draft. No wildcard, select-all-current-and-future rule, title-based authority, or model-authored control is accepted. The preview freezes the named targets and reports archive state, thread/message counts, consumed turns, queued/running jobs, pending workflows, connection probes, and open transports. Titles and IDs render as escaped React text.

Previewing and abandoning a selection perform no room writes, provider calls, reservations, or turn consumption. The native modal provides focus confinement, a safe Cancel default, Escape, close, and Back to selection. Closing during a preview read aborts the browser request; a preview already minted by the service still expires. Known previews are invalidated through the cancel endpoint on abandonment, with a bounded five-second best-effort request. Cancellation is available until explicit confirmation begins. During confirmation, close/back/cancel are held; the committed operation cannot be cancelled or undone.

## Preview authority and endpoints

All three POST routes use existing local session, Host, Origin, cross-site, body-size, and security-header checks:

| Endpoint                              | Strict request      | Result                                           |
| ------------------------------------- | ------------------- | ------------------------------------------------ |
| `/api/workspaces/bulk/preview`        | `{action, roomIds}` | Named metadata and a short-lived confirmation ID |
| `/api/workspaces/bulk/confirm`        | `{token}`           | The server-bound action and exact applied IDs    |
| `/api/workspaces/bulk/preview-cancel` | `{token}`           | Abandonment acknowledgement                      |

Action is archive, restore, or delete. IDs use the existing bounded identity schema; duplicates, empty selections, more than 25 targets, unknown IDs, and unexpected fields fail before mutation. Confirmation/cancellation require a UUID. Caller-supplied action/targets on confirmation are rejected. A preview's returned metadata cannot override its separately cloned server record.

The service stores at most 50 preview records, each expiring after five minutes, without persisting conversation bodies or adding database state. Expired entries are pruned during preview/confirmation and the oldest entry is evicted at capacity. Restart/shutdown discards them. The random one-time identifier binds the exact action, ordered IDs, revisions, and actual probe/transport controller instances. It is not a substitute for session authorization.

Confirmation consumes the preview before validation/writes, including when rejected. Revision changes, removed targets, probe starts/completion/replacement, transport changes, expiration, cancellation, reuse, and restart require a new review. Activity comparison includes controller identity rather than only counts: a new check for the same participant cannot reuse an earlier check's preview. Unselected changes do not invalidate or expand the scope. These bindings are transient local metadata and confer no routing or provider authority.

## Atomic persistence and execution

`RoomStore.applyBatch` starts one synchronous `BEGIN IMMEDIATE` transaction, reads every selected record, then runs all scope/activity/eligibility validation before writing. It checks each row's expected revision, saves only changed records or deletes the rows, and commits the whole batch. A callback or write failure rolls back every selected write, including revision, timestamps, and audit changes. There is no await, provider request, or cancellation within the transaction. This follows SQLite's [explicit transaction contract](https://www.sqlite.org/lang_transaction.html) and the existing single-writer lease. Database version and room schema remain unchanged.

Archive requires every changing target to have no pending queued/running jobs, blocked/running relay, unfinished discussion, or connection probe. One blocked workspace prevents the entire batch; no target is silently skipped. Archiving stores the existing archive metadata, pauses execution, and retains all conversation records, configuration history, and consumed turns. An already archived target remains unchanged.

Restore clears archive metadata and leaves restored targets paused without invocation, replay, retry, or turn refund. Already active targets remain exactly unchanged, including their execution state. The archived-command and scheduler guards from ADR 0007 remain authoritative.

Delete removes every selected workspace in the same transaction before aborting any selected active transport or connection probe, freeing their dispatch accounting and broadcasting changes. The shared deletion cleanup also serves single-workspace deletion. Late events see the abort signal and cannot access removed records, recreate work, or release deleted dependencies. Unselected workspaces retain their data, jobs, usage, and bindings. The welcome initialization flag still prevents reseeding after deleting the final workspace, including across a real service restart. Logical deletion cannot retract provider submissions, external copies, or wording in external records and does not guarantee forensic disk erasure or refunded billing.

## Failure handling and validation

Stale, expired, blocked, missing, or consumed previews fail without partial mutation. The browser clears the invalid preview and requires another explicit review. A network error or server failure after submitting confirmation can have an uncertain outcome; the dialog disables another operation and offers Close and refresh workspaces for inspection. There is no automatic mutation retry. The existing API's single 401 session refresh is safe because authentication rejects before engine execution; a one-time preview also prevents repeated application.

Sixteen added engine/store/HTTP tests cover scope and bounds, preview metadata/cancellation, paused restoration and no-ops, blocked batches, changed/missing targets, expiration/eviction/reuse, returned-data tampering, probe-instance changes, commit-before-abort active deletion, late events, unrelated work, forced mid-batch DELETE and UPDATE failures, disk restart, empty initialized storage, shutdown, and authenticated strict HTTP commands. Four isolated production-service Chromium flows cover native keyboard selection/cancellation, exact duplicate identities, filter clearing, escaped preview labels, drafts/history, both themes and narrow layout, stale/blocked batches, a held loopback HTTP stream, cross-view deletion, final deletion/restart, and lost confirmation responses without replay.

Automated services use isolated temporary databases and blank cloud credentials. The held stream is a synthetic Ollama-compatible protocol fixture, not an installed model. Credentialed provider checks, thread batching, broader accessibility/device audits, retention/backup work, and other unfinished README tasks remain open. This remains a 0.x iteration; every checklist item must be fully implemented and validated before version 1.
