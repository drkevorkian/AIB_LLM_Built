# ADR 0021: Explicit response collection and synthesis revisions

Status: Accepted for v0.20.0. Extends ADR 0002; ADRs 0004, 0005, 0010, 0016–0019 remain authoritative for their existing guarantees.

## Scope

Ordinary human questions add deadline-window collection, explicit timeout choices, and continue/cancel remaining-recipient policies. No-reply updates retain their no-job/no-turn behavior. Relays, interjections, and bounded coordinator discussions reject custom collection controls and retain their existing grants and timeouts. Agent-authored actions cannot select these new controls.

Commands are strict and server validated. Minima are integers 1–8 within the recipient count, never zero. A quorum timeout minimum cannot exceed its threshold; any requires one. New request fields are additive; absent legacy values retain minimum one, pause on timeout, and continued remaining work. Default fields are omitted from canonical command hashes so old UUID replay stays exact. Room schema 1, SQLite schema 2, dependency records, and supported runtimes do not change.

## Closing a set

All, any, and quorum close at their normal eligible threshold. Deadline policy waits for its full persisted 5–600-second window even if every recipient is already complete. At the boundary it closes with eligible completed latest attempts if its selected minimum is met. Threshold closure records one immutable included set; late answers never modify it.

Provider completion still requires a nonempty answer and an explicit complete event. Failed, refused, partial, empty, cancelled, and interrupted attempts cannot satisfy a minimum. Expiry is checked before handling provider events as well as by the scheduler, preventing a completion racing the pump from entering a set after its boundary. Source messages and exact bodies remain separate and attributable.

Continue leaves remaining work authorized against its original snapshot. Cancel atomically cancels only unfinished answer jobs in that request, then aborts their transports after commit. Partial text and consumed turns remain; queued turns become available under existing accounting. Global/provider/workspace slots stay occupied through ordinary transport cleanup. Unrelated tasks and workspaces stay intact. Local abort cannot promise remote cancellation or a billing refund.

## Timeout choices

| Choice                 | Durable result                                                                   | Scheduling effect                                                                             |
| ---------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Pause (legacy default) | Timed-out request with retained complete/partial messages                        | Cancel unfinished request jobs; pause workspace                                               |
| Wait                   | Record `waitingSince` once; retain original obligations and snapshots            | Ignore the elapsed collection deadline after that explicit choice; no retry or resume         |
| Incomplete             | Ready set labeled with incomplete timeout reason when the nonzero minimum is met | Cancel unfinished answer jobs; queue only the authorized synthesis, respecting existing pause |
| Minimum unmet          | Timed-out request                                                                | Cancel and pause; never synthesize an empty set                                               |

Deadline policy first tests its minimum at the boundary; its timeout fallback applies when the minimum is unmet. Wait does not extend provider transport timeouts, invent a deadline, or create more invocations. Failed/interrupted work still requires a bounded explicit Retry; that retry retains the original binding and starts its normal reviewed collection window. A completed threshold after wait closes once. Stop/deletion cancels wait; Resume only permits valid existing queued work. Expiry never resumes a paused room.

A deadline/incomplete/wait collection may still be pending after its jobs finish. Shared pending-work guards cover settings, membership/removal, probes, archive and bulk archive. Turn reservation retains its potential synthesis. Restart pauses these pending collections, preserves saved policy/expiry/closure facts, marks running jobs interrupted, and never automatically replays a request.

## Frozen synthesis evidence

`CollectionContext` records request ID, policy, reason, included source IDs, expected identities, missing identities with outcomes at closure, incomplete-set flag, and the fixed preserve-and-identify disagreement policy. The request and synthesis snapshot receive separate copies in the closing transaction. Retry copies its prior snapshot’s collection evidence. Late completion and later settings/role edits cannot rewrite it.

Provider envelopes include the exact original independent bodies, expected and missing respondents, and collection facts as attributed data. Application-owned synthesis instructions require conflicting claims and unresolved questions to retain their authors, forbid invented missing answers and consensus from silence, and require incomplete-result disclosure. There is no semantic classifier or guarantee of model compliance. Rendering, inspection, and Markdown export disclose these facts without copying author prose into control fields or granting routing permissions. Streaming remains literal and source/copy/export retain original strings.

## Separate updated synthesis

Authenticated `POST /api/rooms/:roomId/updated-synthesis` accepts only `{clientId, requestId, expectedRevision}`. Existing session, Host, Origin, fetch-site, method, and body-size rules apply. The exact workspace revision must match the review. Choose an ordinary ready set whose latest synthesis completed; the original synthesizer must remain active and present in the frozen roster. Removed or deleted-context bindings, stopped/archived workspaces, unknown/foreign requests, no new eligible answer, a repeated answer set, active earlier revisions, and insufficient turn capacity are rejected before mutation. Paused workspaces may record the command, leaving its job held.

The server derives latest eligible completed answers from the original recipient obligations, not client-supplied source IDs. It atomically records a human command, a separate ready response set linked through `synthesisRevisionOf`/`sourceRequestId`, an original-binding snapshot extended only by the selected completed answers, and one synthesis job. The prior request, closure, output, source bodies and attribution remain exact. No peer job is replayed. Earlier synthesis prose and later updates/settings do not replace the original task or enter the new snapshot. Every new invocation consumes one turn; duplicate UUID replay returns the existing result without another reservation or provider call. Different content under that UUID conflicts. One identical completed answer set cannot be resubmitted under a fresh UUID.

Browser controls explain original-context use and potential provider charges. The command has a fifteen-second client bound. Failure requires explicit refresh/review; an unknown acknowledgement never automatically repeats the command. Cross-view notification preserves composer drafts and thread selection. Request cards, frozen context, and export expose the separate lineage and included sources. Archived history is read-only. Existing thread deletion removes same-thread revisions, redacts shared deleted sources, cancels affected work, prevents retry, and retains replay tombstones.

## Validation

Deterministic source tests cover exact deadline boundaries and event/pump races, full-window closure, strict minima/workflow rejection, no-reply updates, one-time wait, pause/stop/reservation guards, complete/partial/failed/refused eligibility, remaining queued/active cancellation, unchanged unrelated work, original source/binding retention, late revision/UUID replay, duplicate-set rejection, stale review, budget exhaustion, retired synthesizers, SQLite rollback, isolated disk restart/deletion, HTTP authorization and safe exports. Provider envelopes preserve directly conflicting source statements and explicit disagreement/incomplete instructions.

Five isolated Chromium regressions exercise deadline/incomplete/wait/cancel controls, keyboard focus, both themes and narrow bounds, context/export, literal hostile text, cross-view drafts, reload, separate late synthesis, and lost acknowledgement requiring refresh. Only controlled loopback protocol fixtures with blank cloud credentials are used. Browser discovery is not a pass; final exact CI evidence belongs in Recovery. Credentialed cloud/model tests, general semantic progress, summaries, unrestricted corrections, broad accessibility and remaining README work are separate.
