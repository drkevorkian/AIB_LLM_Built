# 0005 — Settings and deletion

## Scope

The v0.4 client calls each room a workspace. The existing room identity, isolated participant roster, objective, history, and turn budget remain the domain boundary. A separate multi-room workspace/group hierarchy remains planned. Routes retain `/api/rooms` for compatibility.

## Settings

`GET /api/settings` reads service-wide defaults; `PUT /api/settings` replaces a strict six-field record. Bounds match the existing creation/send/discussion contracts. The browser consumes defaults only when creating a workspace or mounting a new composer; updates do not change open drafts, existing workspaces, or queued/running jobs. Theme is a separate local browser preference. Settings has a `#settings` deep link and preserves the mounted composer when navigating within the app.

`PUT /api/rooms/:roomId/settings` requires a complete name/objective/turn-limit record. Editing requires no pending jobs, unfinished relays/discussions, or connection probes. The new limit must cover consumed and reserved turns. Existing snapshot objectives, roles, and provider/model bindings are retained. Participant configuration reuses the existing validated endpoint and connection test. Credentials remain in the service environment and are never part of these records.

The SQLite database migrates additively from `user_version = 1` to `2`. A singleton settings table stores validated preferences and a one-time welcome initialization flag, separately from room documents. Room `schemaVersion` remains `1`; newly added room/snapshot fields are optional for compatibility. A newer database version is rejected, and the writer lease still prevents concurrent service processes.

In v0.22.0, [ADR 0023](0023-versioned-artifacts-and-opposite-themes.md) extends this migration to SQLite `user_version = 3` with a private artifact BLOB table. Original bytes and room metadata commit together; foreign-key cascades remove bytes with whole-workspace/bulk deletion. Thread deletion removes message grants and copied context while retaining independently owned workspace originals. Theme preferences now include the opposite Ghost White/Blizzard Blue pair alongside Dark/Light.

## Workspace deletion

`DELETE /api/rooms/:roomId` requires the same session token, loopback Host, and Origin checks as other commands. The UI names the target and requires explicit confirmation. Cancel performs no mutation. Deleting commits the row removal before aborting active requests/probes, releases dispatch capacity, and broadcasts a change event. Provider events check their abort signal before accessing storage. A deleted workspace returns 404 on subsequent reads, export, sends, or retry commands; it is never recreated by stream completion.

The welcome workspace is seeded once. An initialized service with no rooms starts with an empty app; the client offers creation and Settings. Deleting the final workspace remains effective across service restart.

## Thread deletion

`DELETE /api/rooms/:roomId/threads/:threadId` validates membership before any mutation. A single room transaction removes the thread and its messages, requests, jobs/attempts, relays, discussions, and unreferenced snapshots. Consumed turns are retained. Reservation calculations release deleted/cancelled work without changing the room's running/paused/stopped state.

Complete room updates can appear in another thread's frozen context. Deletion therefore finds every snapshot containing a removed source ID, and every dependent request/workflow using it. Unfinished dependent workflows and jobs are cancelled before those source copies are redacted. Completed answers in surviving threads remain historical results. Retained snapshots record `deletedMessageIds`; inspection and export disclose the redaction, and explicit retry rejects any affected original/request snapshot. New requests build fresh snapshots from retained sources. Ordinary generation never mutates frozen context; explicit human deletion is the documented exception.

Deleted human-command UUIDs remain as replay tombstones without text or command hashes. A delayed duplicate send cannot restore a deleted message. A persistent message sequence counter prevents reused sequence numbers when the latest or final thread is removed; older rooms backfill it from existing sequences.

Abort and storage mutations are synchronous through their commit boundaries. Deleted/cancelled active tasks are removed from dispatch accounting immediately; even a slow-to-close transport cannot consume all scheduler capacity. Late deltas, metadata, actions, completion, or failures see the aborted signal and cannot touch removed records or restart dependencies. Connection checks are scoped to the deleted workspace's participant IDs.

## Meaning and limits

This is logical deletion of active app records, not forensic erasure of SQLite pages/WAL or external copies. Provider submissions, exported files, external backups, and wording already incorporated into surviving answers cannot be retracted. Room-local activity can retain non-content audit identifiers and deletion counts. The UI discloses permanence, affected work, and retained consumed usage; it does not promise remote cancellation or refunded billing.

Read/list refreshes reconcile deleted selections in other open views. The client falls back to a remaining workspace/all messages, clears deleted reply/inspection targets, rejects older room revisions, and hides stale composers while another workspace loads.

## Validation

Service tests cover additive migration, restart persistence, validation, budget edits, frozen objectives, scoped cascades, reservation release, copied-source redaction, prohibited retries, slow-to-abort provider events, probe cancellation, replay tombstones, and monotonic sequences. HTTP tests check authentication, origin restrictions, strict bodies, deletion scope, and 404 results. Production browser tests cover Settings/drafts/defaults, confirmations, active discussion deletion, export/reload, two simultaneous views, narrow layouts, and deleting the final workspace through a real service restart.
