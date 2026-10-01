# 0007 — Workspace organization

## Scope and storage

v0.6 adds workspace archive/restore, thread renaming, and local search to the existing single-user room/workspace boundary. It does not add workspace groups, bulk operations, private threads, thread archive, global message search, or message-body editing.

Room documents gain optional `archivedAt: string | null`. Absence or null means open; an archive stores a server-generated timestamp. Room summaries expose the flag. SQLite remains schema version 2 and room documents remain version 1. Existing records remain readable without rewriting snapshots or adding another welcome workspace.

## Archive and restore contract

`PUT /api/rooms/:roomId/archive` accepts only `{archived: boolean}` and returns the updated room. The endpoint uses the existing session token, loopback Host, Origin, strict-body, and workspace-scope checks. The caller cannot supply a timestamp or execution status.

Archiving requires no queued/running jobs, running/blocked relays, running/waiting/blocked discussions, or connection probe for any participant in that workspace. Pausing retains obligations and does not permit archiving. Finish work or stop its workflows; probes must finish. Another workspace's probe does not block archive. Validation fails before commit, invocation, turn reservation, or cancellation.

Archive atomically stores its timestamp, pauses the room, and records an audit event. It retains participants and configuration revisions, threads, messages, requests, jobs, snapshots, workflows, replay tombstones, and consumed turns. Repeating the same archive value preserves its timestamp and does not add another archive/restoration event.

Archived workspaces support reading, searching, context inspection, Markdown export, restoration, and confirmed whole-workspace deletion. The engine rejects sends (including updates and duplicate send commands), retries, room controls, workspace/participant edits, participant additions/activation, thread naming/deletion, discussion controls, and generation-based connection probes. These commands must restore first. Global app preferences and read-only provider catalogs remain available.

The scheduler skips archived records before expiration/dispatch and also checks the flag when claiming a job. Recovery keeps archived workspaces paused even if a stale execution status says running. The flag independently prevents provider invocation; a status change cannot bypass it.

Restoration clears the flag, records an event, and leaves the room paused. It does not invoke a provider, recreate cancelled obligations, replay failed attempts, change consumed usage, or resume the room. Queued new work and explicit retries after restoration still wait for Resume and retain existing budget, retry, and original-snapshot rules. An already open non-archived workspace receives no execution change from a no-op restore.

## Thread naming

`PUT /api/rooms/:roomId/threads/:threadId` accepts only `{title: string}`. Names are trimmed, nonempty, and at most 100 characters. The thread must belong to the named workspace; wrong scope returns 404. The existing DELETE route stays at the same path, and unsupported methods return 405.

Naming updates only the thread label and room audit/revision metadata. It is permitted while jobs or workflows run because provider inputs and routing never use the thread title as authority or instructions. IDs, messages, source copies, reply links, attempts, immutable snapshots, obligations, and usage remain unchanged. Names need not be unique. Archived threads require restoration before naming. Other views and Markdown exports use the current name while retaining stable IDs and original participant bindings.

## Search and interface

Workspace search matches retained names/objectives and has active, archived, and all views. Thread search matches names and retained message bodies in the selected workspace; streamed message text joins results as the room updates. Queries are literal case-insensitive substrings, trimmed for matching and limited to 200 characters by the controls. Search previews are bounded slices rendered as React text; HTML-like text and regular-expression characters cannot become executable markup or query syntax. Foreign or deleted thread sources are excluded.

Search filters navigation without changing the selected conversation, reply targets, or draft. Selecting a result opens its full conversation. Queries are per-view and clear on reload; thread search clears when changing workspaces. Clear controls and explicit no-match states let users leave a filter. Large-history indexing, ranking, pagination, global message search, and advanced queries remain future work.

Settings and conversation notices provide named archive/restore confirmations with Cancel. Archive locks reconcile pending work even if another view starts it while a dialog is open, with server validation as the authority. An open archived composer stays mounted with its draft retained and controls disabled. Participant/workspace settings remain inspectable, with saves and probes disabled. Restoration enables the composer but keeps execution paused. If only archived workspaces remain, startup opens the first retained archive and selects the archived list; the welcome initialization flag prevents reseeding. Other views retain their selected archive and reconcile its read-only state through room updates.

Search currently uses metadata and room-visible data already authorized and loaded by the local service. Archiving is not a visibility restriction or backup. Future private threads, shared tenants, or global search require server authorization before records/previews reach the client; client filtering is not an access control.

## Validation

Service/HTTP tests cover pending and blocked obligations, probe scope, archived-command rejection without mutation/invocation, history and usage retention, no-op semantics, paused restoration, original retry bindings, stale running flags, disk persistence, legacy records, thread scope/validation, naming during streaming, preserved reply links/context, authentication/origins/methods, export metadata, search literals, preview bounds, and deleted/foreign sources. Chromium tests cover filters/no-match controls, safe previews, rename/cancel/reload, archive/restore confirmations, disabled controls, export/inspection, drafts across two views, pending-work locks, narrow layouts, and a real archive-only production-service restart. Both supported Node versions run the full suite; CI checks Linux, Windows, and macOS.
