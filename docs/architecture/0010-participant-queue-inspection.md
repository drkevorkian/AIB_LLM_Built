# 0010 — Participant queue inspection

## Scope and authority

v0.9 adds a read-only **Inspect queue** disclosure on each active participant card. It shows persisted queued generations in their per-participant insertion order, running generations, source threads, frozen provider/model bindings, and concrete dispatch holds. It separately identifies synthesis and coordinator continuations that still depend on a response set. Those continuations are not counted or numbered as queued jobs until the engine actually creates them.

Inspection does not dispatch, expire, retry, reorder, cancel, reserve turns, change deadlines, or mutate stored rooms. The existing scheduler remains authoritative: one active request per participant and four shared service slots, including connection probes. There are no priorities, new fairness guarantees, workspace/provider limits, estimated start times, or automatic recovery choices.

## Service contract

Authenticated `GET /api/rooms/:roomId/activity` returns a transient snapshot with the workspace ID/revision, server observation time, shared occupied/maximum slot counts, and activity for the workspace's retained participant IDs. The normal session, loopback Host, Origin, cross-site, method, and workspace-scope checks apply. Archived and inactive history can be inspected; a deleted or unknown workspace returns 404. Unsupported methods return 405. Responses cannot be cached.

`src/server/activity.ts` projects the current room plus live scheduler occupancy. These inspection types do not become persisted room fields or a database migration. They contain job/request/thread identifiers, current thread titles, frozen model bindings, timestamps, reason codes, and response status labels. They exclude message bodies, objective/role/context copies, endpoint URLs, provider errors, and credentials. Thread titles may derive from the original question; inspection is an authorized room metadata view, not a privacy boundary. Other workspaces contribute only anonymous aggregate slot counts, never their identities, titles, or work records.

Queue positions reflect the existing room job array, including ties in creation times. Running and terminal attempts are excluded from numbered queues. A previous explicit retry remains historical; only the new queued attempt appears. The projection does not claim a global FIFO or permanent readiness.

Holds include archive/pause/stop/shutdown, inactive participation, a participant's current request or connection check, earlier stored queue entries, occupied shared slots, exhausted room/discussion turns, an ended discussion awaiting cancellation, and elapsed collecting-response deadlines awaiting expiration. Multiple current holds can be shown together. Inspection does not implement the resulting cancellation or grant authority to resume. A closed response set's old deadline does not hold queued synthesis or late respondents: the existing expiration contract applies only to collecting sets. Saved provider timeouts still apply independently.

Connection probes broadcast their start and end without creating audit/history records or changing room revisions. Normal generation cleanup broadcasts when the occupied slot actually releases, including after completion. A provider iterator may still be closing after a job has completed/cancelled; that occupied slot is shown as finishing request cleanup. These notifications do not change dispatch rules.

## Response prerequisites

A future synthesis is shown while its original request is collecting or unresolved and no synthesis job exists. A coordinator continuation is shown while its current peer consultation is collecting or unresolved and the discussion is waiting or blocked. Received counts use each recipient's latest **completed** answer attempt; failed, refused, cancelled, interrupted, running, queued, and missing attempts do not satisfy the barrier. All requires every selected recipient, any requires one, and quorum requires the saved threshold. Labels use the request's frozen roster, preserving duplicate-name disambiguation and attribution after configuration changes.

Unresolved barriers identify respondent outcomes and require human review/explicit recovery. They cannot automatically retry or become runnable merely because they are visible. After an explicit retry, the latest recipient attempt is shown; after real collection closure and continuation creation, the prerequisite disappears and the actual queued generation appears. Cancellation/deletion removes the corresponding pending inspection data. Blocked relays, invalid coordinator decisions, and capacity failures retain their existing workflow/attempt explanations; they do not acquire invented future queue entries.

## Client freshness and navigation

The client fetches activity on workspace/revision updates, existing event notifications, and an explicit Refresh. It accepts only snapshots matching the selected workspace ID and loaded room revision. Aborted earlier requests cannot replace a later workspace's activity. A missing/mismatched snapshot shows refreshing; a failed read removes old actionable details and offers retry. Disconnected events identify retained snapshots as last-observed details. Capacity/readiness is always an observation, not a promise about future dispatch or a remote provider's processing state.

Source buttons select an exact retained thread through the existing explicit-selection path, preserving drafts and the send/refresh selection guard. Names and bindings render as plain React text with no formatting, remote loads, or routing authority. Reading and navigation remain available for archives. Disclosure state is per view and resets on reload/workspace changes. Controls remain keyboard-focusable and text wraps in narrow layouts and both themes. Stop/Resume/Retry remain the established explicit controls; this inspector adds no scheduling mutations.

## Validation

Service coverage verifies stored order, frozen bindings and labels, all/any/quorum prerequisites, failures/refusals/incomplete streams, explicit retries, coordinator peer barriers, shared capacity and probes, cleanup occupancy, elapsed deadlines, defensive holds, unchanged persistence/turns, deletion, disk recovery, and the authenticated HTTP boundary. Chromium flows exercise source navigation/safe titles, preserved drafts, reload, both themes/narrow layouts, running/queued distinctions, unresolved-to-retried prerequisites, read failure/recovery, and delayed old-workspace responses. Existing message, control, provider, roster, deletion, and discussion regressions still apply.
