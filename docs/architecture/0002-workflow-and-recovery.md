# ADR 0002: Explicit obligations and frozen response sets

Status: Accepted for the local simulation milestone.

## Implemented flow

1. Validate the human command, recipients, exact reply target, policy, and turn reservation.
2. Atomically persist the human message, frozen snapshot, request, and recipient jobs.
3. Dispatch queued work only in running rooms, with one generation per agent and at most four across the service.
4. Persist each streamed text fragment into the associated answer message.
5. Require a non-empty answer and an explicit provider completion event before counting it.
6. Close an all/any/quorum response set with immutable included message IDs.
7. If requested, queue a separate synthesis invocation whose snapshot includes only the original context and the closed answer set.

All messages in v0.1.0 are room-visible. Only selected recipients receive work. Updates and prose mentions create no invocations. Agent-authored questions and autonomous structured routing are not implemented yet; current simulated agents only return answers or synthesis.

## Policies

- **All:** collect an eligible answer from every recipient.
- **Any:** close after the first eligible answer; remaining work continues and late answers are preserved.
- **Quorum:** close after the selected count of distinct eligible answers; remaining work continues.
- **Update:** persist an informational message with no response obligations.
- **Timeout:** the deadline is wall-clock time from submission, including time spent paused. Cancel unfinished work for that request, retain completed/partial text, and pause the room. A new question is required to continue an expired request.

Eligibility requires a non-empty, completed stream. Failure, refusal, cancellation, interruption, and streams missing completion are distinct visible outcomes and cannot meet the collection threshold. An unresolved set does not schedule synthesis.

Only the all/any/quorum subset of the full README policy design is implemented. Deadline-based partial-success policies and additional timeout strategies remain planned.

## Pause, stop, and restart

- Pause prevents new dispatches. Already-running jobs can finish; any dependent synthesis stays queued.
- Stop cancels queued and active jobs and closes collecting requests as cancelled. Results arriving afterward cannot release more work.
- Resume permits valid queued jobs to dispatch. It does not recreate cancelled jobs.
- Restart pauses unfinished rooms. Previously running jobs become interrupted; queued jobs remain queued. Interrupted jobs are never replayed automatically.
- Explicit retry creates a new job linked to the previous attempt. The earlier error and partial message remain inspectable in persisted state. At most three attempts are allowed for a given recipient/kind in a request.
- Resend protection uses a client-generated UUID plus a hash of the validated command. Repeating the same send returns the original message; changing its content under the same UUID produces a conflict.

Remote request acceptance and reconciliation are not implemented because v0.1.0 has no remote provider. Live adapters must add uncertain-delivery handling before automatic remote retries are permitted.

## Context limits

Initial snapshots include complete messages in the relevant thread and complete room updates. Recipient jobs share that same snapshot even if they start at different times. Each answer invocation receives no sibling-answer side channel.

There is no automatic summarization or silent truncation. Commands are bounded at 12,000 characters, provider output at 20,000 characters, and snapshot text at 64,000 characters. New requests that exceed snapshot capacity are rejected atomically. If completed answers make synthesis too large, the answer set remains ready and the synthesis job records a capacity failure. A successful answer is not retroactively relabeled as failed.

## Validation

Engine tests exercise independent snapshots, collection barriers, late answers, per-agent serialization, stop races, pause behavior, explicit retries, reservation limits, refusals, missing completion, and restart recovery. HTTP tests verify the local service boundary. Browser tests verify actual user interactions and safe text rendering.
