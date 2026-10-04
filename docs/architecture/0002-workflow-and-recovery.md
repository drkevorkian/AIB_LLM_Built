# ADR 0002: Explicit obligations and frozen response sets

Status: Accepted; updated for v0.3.0 bounded discussions. See [ADR 0004](0004-bounded-agent-discussions.md).

v0.21.0 extends context assembly with explicit human-reviewed summaries, original-source retrieval, optional frozen model text budgets and local delivery cursors under [ADR 0022](0022-reviewed-context-memory.md). The legacy/default 64,000-character atomic rejection remains; opt-in delivery omissions are visible and retain protected sources, submitted bindings and sibling isolation.

## Implemented flow

1. Validate the human command, recipients, exact reply target, policy, and turn reservation.
2. Atomically persist the human message, frozen snapshot, request, and recipient jobs.
3. Dispatch queued work only in running rooms, with one generation per agent and at most four across the service.
4. Persist each streamed text fragment into the associated answer message.
5. Require a non-empty answer and an explicit provider completion event before counting it.
6. Close an all/any/quorum response set with immutable included message IDs.
7. If requested, queue a separate synthesis invocation whose snapshot includes only the original context and the closed answer set.

All messages are room-visible. Only selected recipients receive work. Updates and prose mentions create no invocations. Fixed relay routing is selected by the human. A separately granted discussion coordinator may ask peers through validated actions; peers have no delegation permission.

## Policies

- **All:** collect an eligible answer from every recipient.
- **Any:** close after the first eligible answer; remaining work continues and late answers are preserved.
- **Quorum:** close after the selected count of distinct eligible answers; remaining work continues.
- **Update:** persist an informational message with no response obligations.
- **Timeout:** the deadline is wall-clock time from submission, including time spent paused. Cancel unfinished work for that request, retain completed/partial text, and pause the room. A new question is required to continue an expired request.

Eligibility requires a non-empty, completed stream. Failure, refusal, cancellation, interruption, and streams missing completion are distinct visible outcomes and cannot meet the collection threshold. An unresolved set does not schedule synthesis.

Only the all/any/quorum subset of the full README policy design is implemented. Deadline-based partial-success policies and additional timeout strategies remain planned.

## Pause, stop, and restart

- Pause prevents new dispatches. Already-running jobs can finish; any dependent synthesis, relay hop, or discussion continuation stays queued.
- Stop cancels queued and active jobs and closes collecting requests as cancelled. Results arriving afterward cannot release more work.
- Resume permits valid queued jobs to dispatch. It does not recreate cancelled jobs.
- Restart pauses unfinished rooms. Previously running jobs become interrupted; queued jobs remain queued. Interrupted jobs are never replayed automatically.
- Explicit retry creates a new job linked to the previous attempt. The earlier error and partial message remain inspectable in persisted state. At most three attempts are allowed for a given recipient/kind in a request.
- Resend protection uses a client-generated UUID plus a hash of the validated command. Repeating the same send returns the original message; changing its content under the same UUID produces a conflict.

Live adapters preserve provider-reported request IDs and usage. Provider-specific reconciliation is not implemented. Provider/network failures are never automatically retried. An invalid completed coordinator decision may receive one new correction invocation within its reserved allowance (ADR 0004). For other failures, an explicit retry may duplicate provider work or charges if the earlier request was accepted remotely. Aborting a local stream does not guarantee that remote processing or billing stops. Interrupted attempts require explicit review/retry.

## Context limits

Initial snapshots include complete messages in the relevant thread and complete room updates and recorded human interjections. Recipient jobs share that same snapshot even if they start at different times. Each answer invocation receives no sibling-answer side channel.

Explicit human thread deletion is an exception to context immutability: removed sources are redacted from stored copies, affected pending work is cancelled, and affected attempts cannot retry against altered context. Inspection/export identifies redacted historical snapshots. See [settings and deletion](0005-settings-and-deletion.md).

There is no automatic summarization or silent truncation. Commands are bounded at 12,000 characters, provider output at 20,000 characters, and snapshot text at 64,000 characters. New requests that exceed snapshot capacity are rejected atomically. If completed answers make synthesis too large, the answer set remains ready and the synthesis job records a capacity failure. A successful answer is not retroactively relabeled as failed.

## Validation

Engine tests exercise independent snapshots, collection barriers, late answers, per-agent serialization, stop races, pause behavior, explicit retries, reservation limits, refusals, missing completion, and restart recovery. HTTP tests verify the local service boundary. Browser tests verify actual user interactions and safe text rendering.

## Automatic relay

A relay order contains 1–12 selected participant IDs; IDs may repeat. The first human message invokes only the first participant. The entire order is reserved against the room turn budget at submission. Each hop is a single-recipient all-policy request.

A successful answer and its next-hop request/job are committed in one transaction. The next request replies to the completed answer’s exact message ID. Its context extends the preceding frozen snapshot with that answer; failed, partial, and concurrent sibling responses are excluded. The original human request remains the task prompt. The original participant settings stay frozen through the relay. Later human updates do not silently alter the relay’s submitted base context.

Each hop gets its own response deadline. Failure, refusal, or an interrupted attempt blocks progression. An eligible explicit retry of the current hop can release the next step once. Timeout cancels that relay’s remaining hops and pauses the room. Stop cancels active and queued work and releases unused future relay reservations. Resume never reconstructs cancelled hops.

If a completed hop makes the next context too large, the completed answer stays successful and the relay becomes blocked with an explicit capacity explanation. Stop and start a shorter thread; no source history is silently removed.

Human interjections are implemented in v0.18.0; see [ADR 0019](0019-human-interjections.md). Their optional room pause holds dispatch while preserving original response sets and context. Task correction and revised obligations remain separate.
