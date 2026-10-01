# AI Conversation Room

A shared workspace where multiple LLM agents can discuss ideas, ask each other questions, review work, and collaborate under human direction.

**Status:** Design specification. The behavior below describes the intended application; it is not a claim that software, integrations, or installers already exist. AI Conversation Room is a working name for a new project inspired by lessons from AI Bridge.

## Overview

AI Conversation Room combines a group chat, threaded discussions, directed messages, parallel requests, and controlled turn-taking. Each agent has a stable identity, an individual context, and its own queue. The application owns delivery, scheduling, permissions, persistence, and recovery.

The central rule is simple:

**Who can see a message, who should answer it, and when they should answer are separate decisions.**

An agent can ask two peers for independent opinions, wait for both, compare their answers, and ask one peer a targeted follow-up. Other participants can observe without being required to respond. A fixed relay remains available for sessions that need a prescribed speaking order.

## Goals

- Enable direct, attributable communication between distinct agents.
- Support multiple instances of the same model as independent participants.
- Run independent work concurrently and dependent work in sequence.
- Preserve original answers, disagreements, evidence, and decisions.
- Give the human clear controls over recipients, context, execution, and cost.
- Resume interrupted work without silently duplicating requests or losing state.
- Keep the conversation engine independent of provider APIs and browser interfaces.
- Make the application understandable through a complete graphical interface.

## Planned capabilities

| Capability | Intended behavior |
|---|---|
| Shared room | A persistent objective, roster, instructions, and conversation |
| Threads | Separate discussions linked to their originating messages |
| Directed requests | Explicit recipients and exact reply targets |
| Parallel consultation | Multiple agents answer from the same shared context snapshot |
| Response collection | Attributed answers collected against a defined completion policy |
| Cross-review | One agent reviews another's completed answer or artifact |
| Fixed relay | Configurable order, including A → C → B → A |
| Conference discussion | A controlled speaking queue and bounded follow-ups |
| Artifact exchange | Versioned attachments with authorship and access controls |
| Recovery | Durable queues, checkpoints, reconciliation, and explicit continuation |
| Human control | Start, pause, resume, stop, interject, redirect, and inspect |
| Observability | Delivery states, missing responses, context versions, and usage |

## Getting started

There is no runnable release or installation command yet. The implementation checklist at the end of this document defines the work required to produce one.

The intended first-run experience is:

1. Create a workspace and configure one or more provider connections.
2. Add agents with stable IDs, display names, model selections, and optional roles.
3. Create a room and enter its objective and human instructions.
4. Choose a conversation mode and execution limits.
5. Address a message to one agent, selected agents, or all active agents.
6. Review replies, open threads, and direct follow-up questions.
7. Pause or close the interface and later resume from persisted state.

Provider credentials, billing requirements, supported models, and platform installation instructions will be documented after integrations and packaging are verified. No specific runtime, GUI framework, or provider SDK version is selected by this README.

## Conversation model

### Participants

An agent is a configured participant, not a provider name. AI A and AI B may use the same provider and model while retaining separate roles, context histories, queues, and identities.

The application assigns author identity. A message body cannot impersonate another participant. Renaming an agent changes its display label without changing historical attribution. Changing its model or role creates a recorded configuration revision.

The human is a first-class participant and can address the room or a specific agent. Agent messages cannot increase their own privileges or replace human instructions.

### Addressing and visibility

Every message distinguishes its audience from its intended respondents. Room-visible directed messages are the default. Restricted threads may be added with explicit access controls; merely addressing one agent does not make a message private.

Observers receive relevant messages as context on a subsequent invocation. Visibility alone does not trigger a new generation. Mentioning an agent in prose is also not a scheduling instruction.

The composer displays recipients and visibility before submission. Model-generated sends use a validated structured action. Unknown, inactive, ambiguous, or unauthorized recipients produce an explicit routing error. No silent fallback to another agent is allowed.

### Message types

| Type | Meaning | Default scheduling effect |
|---|---|---|
| Question/task | Requests a response or deliverable | Creates tracked obligations |
| Answer | Responds to an existing request | Updates that request's response set |
| Critique | Reviews a specific claim or artifact | Requires an explicit follow-up request to summon a reply |
| Update | Shares information | No automatic reply |
| Proposal | Suggests a course of action | No automatic adoption |
| Decision | Records an authorized resolution | Updates decision state within assigned authority |
| Human-input request | Identifies a missing human decision | Blocks the affected work according to scope |
| Control event | Records pause, cancellation, or configuration change | Executed only through authorized application controls |

These types describe public contributions. The application does not require agents to disclose hidden internal reasoning; concise explanations, evidence, assumptions, and conclusions are sufficient.

### Parallel questions and response sets

A request addressed to B and C creates one parent request and two recipient obligations. Both receive the same shared snapshot, plus their explicitly recorded individual role and context. Independent-answer mode withholds sibling answers until each initial answer is committed.

Responses stream into the interface separately. Downstream synthesis waits for the configured collection policy; displaying an answer does not automatically release dependent work.

| Policy | Completion rule |
|---|---|
| All | Every required recipient supplies an eligible completed answer |
| Any | The first eligible completed answer releases downstream work |
| Quorum | A configured number of distinct recipients supply eligible answers |
| Deadline | At the deadline, use the available response set if the minimum requirement is met |
| No reply | Informational delivery creates no answer obligation |

Each policy specifies timeout behavior: keep waiting, pause, or proceed with an explicitly incomplete set. Errors, refusals, cancellations, empty outputs, and malformed structured results remain visible outcomes; they do not silently count as eligible answers. A refusal can be a terminal recipient outcome while leaving the parent request unable to meet its success policy.

When a collection closes, it records exactly which messages were included. Late answers remain attributed and visible; they do not silently alter an already-published synthesis. A follow-up synthesis can incorporate them. Any/quorum policies also specify whether remaining work continues or is cancelled.

A response set preserves each original answer. A synthesis is a separate authored message linked to the included answers, with missing participants and unresolved disagreements identified.

### Directed follow-ups

If B identifies a race condition and C proposes an interface, A can create two requests:

- A → B, replying to B's message: identify the exact transition that allows a duplicate send.
- A → C, replying to C's message: show how queued, submitted, and completed states appear.

These requests can run concurrently. A can instead question B while leaving C as an observer. Each answer links to the specific request and thread, not merely to the latest room message.

### Conversation modes

| Mode | Scheduling rule | Typical use |
|---|---|---|
| Directed | Invoke only explicitly selected respondents | Targeted questions |
| Parallel consultation | Dispatch independent requests, collect, then synthesize | Comparing approaches |
| Peer review | Independent answers followed by assigned cross-critiques | Finding errors and omissions |
| Parallel tasks | Execute independent tasks against agreed interfaces | Dividing work |
| Conference | Maintain a fair speaking queue and explicit follow-ups | Open discussion |
| Fixed relay | Follow the selected participant order | Predictable sequential dialogue |

In fixed relay, addressing and speaking order remain distinct. A message to B does not silently move B ahead of C. The selected policy determines whether the message waits until B's turn or the human explicitly changes the order.

The default investigation pattern is independent answers → targeted cross-review → synthesis. Additional rounds require unresolved work and remaining limits. Agreement alone is not evidence of correctness.

### Completion and stopping

Questions create obligations; answers resolve them. Updates do not create reply chains. A thread becomes idle when it has no runnable or outstanding work. Idle does not necessarily mean the objective is accomplished.

A room can finish successfully, finish with unresolved issues, pause for human input, exhaust its limits, or be stopped. The application records the actual reason. It must not label a session successful merely because every agent agrees or no agent is speaking.

## Example session

1. The human asks A to investigate duplicate message delivery.
2. A sends the same question concurrently to B and C with an `all` response policy.
3. B's answer appears first. The interface shows C as pending; synthesis does not start.
4. C finishes. The application closes the initial response set.
5. A compares both answers and asks B about the suspected race and C about recovery behavior.
6. B and C answer their respective follow-ups.
7. A publishes a synthesis that links the evidence, proposed fix, and remaining uncertainty.
8. The thread becomes idle. Further implementation requires a task with appropriate permissions.

If the human changes the requirement during step 5, the new instruction is recorded immediately. Existing generations are marked as using the earlier snapshot. Dependent work is held until the configured correction policy has been applied.

## System architecture

| Component | Responsibility |
|---|---|
| Graphical client | Room, thread, roster, composer, controls, and inspection views |
| Application service | Authenticated commands, validation, and authoritative state |
| Conversation engine | Requests, obligations, response sets, dependencies, and mode rules |
| Scheduler | Per-agent queues, fairness, limits, deadlines, leases, and cancellation |
| Context builder | Authorized snapshot assembly, summaries, retrieval, and token budgets |
| Provider adapters | Translate invocations and normalize provider lifecycle events |
| Persistent store | Events, message records, queues, checkpoints, and configuration revisions |
| Artifact store | Original files, immutable versions, hashes, previews, and permissions |
| Policy layer | Authorization, tool boundaries, visibility, and routing validation |
| Diagnostics | Redacted logs, metrics, usage estimates, and recovery explanations |

The initial deployment should be a local application service with a graphical client and durable local storage. A desktop wrapper or local browser interface is an implementation decision. Remote multi-user hosting is a separate scope and must not be implied by local operation.

The service remains authoritative if a view disconnects. Whether work continues after closing the client is an explicit setting shown to the user. Persistent state must survive process restarts regardless of that setting.

### Core entities

Workspace, room, participant, participant revision, thread, message, request, recipient obligation, invocation, delivery attempt, response set, decision, artifact version, context snapshot, checkpoint, and audit event each require stable identifiers.

Logical messages and delivery attempts are different entities. A retry may create another attempt without creating another logical request. A regenerated answer is a distinct revision, with the earlier result preserved.

### Illustrative message envelope

This is a proposed internal contract, not an existing public API. The server supplies trusted identity, timestamps, and sequence numbers after validating a send action.

```json
{
  "schema_version": 1,
  "message_id": "msg_0142",
  "room_id": "room_01",
  "thread_id": "thread_delivery",
  "author_id": "agent_a",
  "recipient_ids": ["agent_b", "agent_c"],
  "visibility": {"scope": "room"},
  "type": "question",
  "reply_to_message_id": "msg_0139",
  "request_id": "req_0070",
  "context_snapshot_id": "ctx_0380",
  "response_policy": {
    "mode": "all",
    "deadline_seconds": 120,
    "on_timeout": "pause",
    "remaining_work": "continue"
  },
  "body": "Independently identify the likely duplicate-send failure.",
  "artifact_version_ids": [],
  "created_at": "2026-10-01T00:00:00Z"
}
```

The example deadline is illustrative, not a universal timeout. Each response references its parent request and exact reply target. Validation requires recipients to belong to the room and have access to the message, its thread, and referenced artifacts.

## Scheduling and delivery

One active generation per logical agent is the initial invariant. Different agents may run concurrently, subject to provider and workspace limits. Queued work includes dependencies and priorities; dependency cycles are rejected or surfaced as blocked work.

The application persists the request and dispatch intent before sending. Workers use durable claims and fencing so a stale worker cannot commit over a newer owner. Provider submissions, local commits, and stream receipts are correlated by attempt ID.

Delivery and generation have separate states. A delivery can be queued, submitting, accepted, failed, cancelled, or uncertain. An invocation can be waiting, generating, completed, failed, cancelled, or interrupted. Partial text is retained as partial text.

Exactly-once remote execution cannot be assumed. The target is duplicate-resistant dispatch and idempotent local processing. Use provider idempotency or reconciliation where available. If acceptance is unknown, reconcile before retrying; if reconciliation is impossible, expose uncertainty and require an explicit recovery choice.

A transport acceptance, HTTP success, or browser click does not prove a completed answer. Completion comes from validated provider events or an adapter-specific completion procedure. Length limits and truncated streams are recorded rather than treated as normal completion.

## Context and memory

Each invocation receives the current applicable human instructions, role revision, objective, relevant thread history, selected room decisions, authorized artifacts, and relevant unseen messages.

Context snapshots record the exact selected message and artifact versions. Per-agent cursors track inclusion in context, not proof of understanding. The system distinguishes visible, included, responded-to, and acknowledged states.

Long histories may be summarized. Summaries retain links to original messages, unresolved disagreements, and decision ownership. Originals remain available subject to retention policy. Restricted content must not leak through summaries, retrieval results, or artifact previews.

An answer records the snapshot on which it was based. Human corrections can cancel affected work or allow it to finish as stale, but stale output cannot silently satisfy a request against revised requirements.

## Human controls

- **Start:** begin runnable work under the selected mode and limits.
- **Pause:** stop new dispatches; apply the selected policy to in-flight work.
- **Resume:** reconcile outstanding attempts, then continue valid queued work.
- **Stop:** cancel queued work and request cancellation of active work where supported.
- **Interject:** publish a human message with explicit recipients and priority.
- **Redirect:** create a recorded routing or task change without rewriting history.
- **Retry:** retry a known failed attempt under bounded policy.
- **Regenerate:** produce a new answer revision with explicit context selection.
- **Continue from response:** select a completed response and reconstruct its surrounding workflow.
- **Inspect:** view recipients, snapshot, attempts, included answers, and usage.

Cancellation is best effort after remote submission. Late results remain recorded but cannot restart stopped workflows. A selected response alone is insufficient to reconstruct a parallel round; recovery must include its parent request, sibling obligations, and collection state.

## Provider integrations

API adapters are the primary transport. Each adapter declares capabilities such as streaming, structured output, attachments, cancellation, usage reporting, request reconciliation, and idempotency support.

The engine normalizes lifecycle events while retaining original provider metadata for diagnostics. Unsupported capabilities are shown explicitly. Provider output and peer messages are treated as untrusted content and cannot directly execute application commands.

A browser adapter is a later, separately tested transport. It must verify the participant's bound conversation and writable composer before submission, detect session replacement and DOM changes, and pause on ambiguous delivery. No authentication bypass or silent switching to another conversation is permitted.

## Artifacts and collaborative work

Messages reference immutable artifact versions. Each version records author, content hash, media type, size, and origin. Previews are derived views, not replacements for original bytes.

Discussion does not automatically authorize file edits, code execution, commits, or publication. Optional tool execution requires explicitly granted capabilities. Parallel edits should use isolated branches or workspaces and a deliberate integration step. Conflicting versions remain visible until resolved.

## Security and privacy

Credentials belong in an appropriate secret store and must never be injected into model context, committed to source control, or included in exports. Access control is enforced by the service for reads, writes, context assembly, and downloads.

Peer outputs, uploaded files, retrieved content, and model-generated routing requests are untrusted. Schema validation, authorization, attachment limits, safe rendering, and sandboxed tool execution form the application boundary. Prompts alone are not an access-control mechanism.

A local HTTP service must bind narrowly and protect against unauthorized browser origins and requests. Remote access requires separate authentication, transport protection, tenancy, and deployment work.

Retention, export, deletion, backup, and provider data transmission must be understandable to the user. Operational append-only history does not override explicit deletion policy; deletion must account for originals, summaries, indexes, caches, and backups.

## Interface

The proposed wide layout has three resizable columns: rooms/threads, conversation, and agent activity/details. Narrow layouts collapse panels without hiding stop controls or pending-response status.

Messages display author, recipients, visibility, reply target, status, and linked artifacts. The response-set view shows each expected participant, received answers, deadline, and completion policy. A queue view explains why work is waiting.

The visual style uses square or minimally rounded surfaces: primary containers at 0–4 px and no radius above 8 px. Themes, keyboard navigation, readable contrast, and streaming behavior that respects the reader's scroll position are required.

## Limits and cost

Rooms support limits for turns, rounds, tokens, cost estimates, elapsed time, concurrent invocations, and follow-up depth. A model invocation counts as a turn even if it fails; retries and successful answers are reported separately. A round groups related turns and is not interchangeable with a turn count.

Cost estimates identify assumptions and uncertainty. Unknown pricing or unavailable usage must not appear as zero cost. Reserve budget for parallel work before dispatch, reconcile actual usage afterward, and disclose that in-flight provider charges may exceed a local stopping threshold.

## Development and contribution

Implement domain contracts and a deterministic fake provider before live integrations. Keep provider logic out of scheduling and UI code. Use transactional persistence, explicit state transitions, and versioned migrations.

Contributions should explain the behavior changed, its reason, relevant failure cases, and validation. New routing or recovery behavior requires tests of its observable guarantees. No feature is complete solely because its happy path works once.

The runtime, GUI framework, persistence engine, supported platforms, packaging, project license, and initial provider integrations remain decisions to record before implementation. There is no declared license grant in this design document.

## Delivery milestones

| Milestone | Exit condition |
|---|---|
| M0 — Contracts | Message, state, policy, and persistence contracts reviewed |
| M1 — Local simulation | Two fake agents complete directed and parallel workflows through the UI |
| M2 — API MVP | Real adapters, durable recovery, human controls, budgets, and export verified |
| M3 — Collaboration | Review, conference, relay, artifact workflows, and extended context complete |
| M4 — Optional extensions | Browser transport or remote hosting separately scoped and validated |
| M5 — Release | Security, packaging, upgrade, documentation, and release gates pass |

## Complete implementation TODO checklist

This is the complete planned checklist for the scope described above. All items are initially unchecked because this document does not verify an existing implementation. Optional items are explicitly marked; future discoveries may add work. Mark an item complete only with reviewable implementation or a recorded scope decision and applicable validation.

### 1. Product scope and decisions

- [ ] Confirm the project name and repository location.
- [ ] Record initial target operating systems and supported deployment model.
- [ ] Select the runtime, GUI framework, persistence engine, and packaging approach.
- [ ] Select and document the project license and dependency license policy.
- [ ] Define MVP boundaries against milestones M0–M5.
- [ ] Select initial API providers and document supported capabilities from their official documentation.
- [ ] Decide whether browser transport belongs in the first release or a later milestone.
- [ ] Define whether execution continues when the graphical client closes.
- [ ] Define single-user permissions and separately scope optional multi-user operation.
- [ ] Record architecture decisions, defaults, and unresolved questions in versioned documentation.

### 2. Repository and development foundation

- [ ] Create the application, domain, adapters, persistence, UI, and test modules.
- [ ] Configure dependency locking and reproducible development setup.
- [ ] Add formatting, linting, static checks, and CI workflows.
- [ ] Add secret scanning and dependency vulnerability checks.
- [ ] Add configuration validation and a safe example configuration without credentials.
- [ ] Establish schema versioning and migration conventions.
- [ ] Implement deterministic clocks and ID injection for workflow tests.
- [ ] Implement a fake provider supporting success, delay, partial output, refusal, and failure.
- [ ] Define contribution guidance and the feature completion standard.

### 3. Identity, rooms, and configuration

- [ ] Implement stable workspace, room, participant, and thread identities.
- [ ] Support multiple independent participants using the same provider/model.
- [ ] Store participant role and model configuration revisions.
- [ ] Preserve attribution when participants are renamed or deactivated.
- [ ] Implement room objectives and versioned human instructions.
- [ ] Implement room membership and participant activation rules.
- [ ] Validate recipient identity without relying on display-name uniqueness.
- [ ] Record membership changes during active rounds and define their effect on obligations.
- [ ] Implement explicit room lifecycle and completion reasons.

### 4. Message and routing contracts

- [ ] Define schemas for all public message types and internal control events.
- [ ] Separate recipients, visibility, response policy, and scheduling metadata.
- [ ] Implement exact reply links and parent-request references.
- [ ] Enforce trusted authorship and server-assigned timestamps/order.
- [ ] Validate message size, field limits, and schema versions.
- [ ] Implement structured agent send actions and bounded repair for invalid payloads.
- [ ] Reject unknown, inactive, ambiguous, unauthorized, and disallowed self-targets.
- [ ] Ensure prose mentions and quoted routing text cannot dispatch work.
- [ ] Preserve original messages; represent edits and regenerations as linked revisions.
- [ ] Implement explicit supersession and its effect on dependent requests.
- [ ] Enforce thread and artifact visibility on send and read paths.

### 5. Persistence and event processing

- [ ] Create transactional storage for all core entities and configuration revisions.
- [ ] Persist dispatch intent atomically with requests and obligations.
- [ ] Implement durable queues and an outbox or equivalent delivery mechanism.
- [ ] Add unique constraints for deduplicating local event processing.
- [ ] Implement worker claims, lease expiry, and fencing against stale workers.
- [ ] Store provider attempt identifiers and normalized lifecycle events.
- [ ] Rebuild room state from durable records after restart.
- [ ] Add indexes and pagination for large histories.
- [ ] Implement backup creation, integrity checks, and restoration.
- [ ] Implement migrations with rollback or recoverable backup procedures.
- [ ] Define data retention and authorized deletion across derived stores.

### 6. Scheduler and dependencies

- [ ] Enforce one active invocation per logical agent.
- [ ] Support concurrent invocations across separate agents.
- [ ] Add per-provider and per-workspace concurrency limits.
- [ ] Implement priorities, fair queues, and starvation prevention.
- [ ] Represent dependencies explicitly and detect cycles.
- [ ] Explain blocked tasks and missing prerequisites in the UI.
- [ ] Implement deadlines using restart-safe timestamps and monotonic elapsed timers where appropriate.
- [ ] Implement bounded retries with backoff and jitter for eligible errors.
- [ ] Distinguish retryable failure from uncertain remote acceptance.
- [ ] Prevent cancelled, stale, or superseded work from releasing dependencies.
- [ ] Reserve sufficient turn and budget capacity before starting a multi-agent phase.

### 7. Response collection

- [ ] Create one obligation per selected recipient and link it to its parent request.
- [ ] Implement all, any, quorum, deadline, and no-reply policies.
- [ ] Validate impossible quorums and empty respondent sets before dispatch.
- [ ] Define eligible answers and distinct failure/refusal outcomes.
- [ ] Render incoming streams without prematurely releasing synthesis.
- [ ] Implement wait, pause, and explicitly incomplete timeout outcomes.
- [ ] Record immutable response-set closure and included message IDs.
- [ ] Implement policies for cancelling or continuing remaining work after any/quorum completion.
- [ ] Preserve late answers and support an explicit updated synthesis.
- [ ] Prevent duplicate answer events from satisfying multiple obligations.
- [ ] Preserve each contributor's original answer and attribution.
- [ ] Show missing recipients and unresolved disagreement in synthesis context.

### 8. Conversation modes

- [ ] Implement directed requests and targeted follow-ups.
- [ ] Implement independent parallel consultation with sibling-answer isolation.
- [ ] Implement sequential review dependencies.
- [ ] Implement assigned cross-review after independent first answers.
- [ ] Implement parallel task execution with explicit shared contracts.
- [ ] Implement conference speaking queues and fair turn allocation.
- [ ] Implement configurable fixed relay orders, including A → C → B → A.
- [ ] Keep fixed speaking order separate from message addressing.
- [ ] Support a selectable starter and finite round limits.
- [ ] Define mode transitions only at safe workflow boundaries.
- [ ] Prevent informational updates from generating acknowledgment loops.
- [ ] Bound automatic follow-ups and detect repetitive or stalled discussion.
- [ ] Distinguish idle, completed, unresolved, blocked, and stopped outcomes.

### 9. Context assembly and memory

- [ ] Build immutable invocation snapshots with selected source versions.
- [ ] Include applicable human instructions and the correct participant revision.
- [ ] Include relevant thread history and unseen authorized room updates.
- [ ] Implement per-agent context cursors without implying comprehension.
- [ ] Apply model-specific context budgets and visible truncation rules.
- [ ] Implement summaries linked to original messages and decisions.
- [ ] Preserve disagreements and open questions during summarization.
- [ ] Retrieve original source messages when summaries are insufficient.
- [ ] Enforce access control before retrieval, summarization, and attachment expansion.
- [ ] Exclude sibling answers during independent first-response phases.
- [ ] Mark outputs generated against superseded instructions as stale.
- [ ] Implement safe context rollover with role, objective, and pending-work restoration.
- [ ] Provide an inspector for exactly what context each invocation received.

### 10. API adapters

- [ ] Define a common adapter interface and capability registry.
- [ ] Implement credential validation without exposing secrets.
- [ ] Implement initial provider integrations against verified official contracts.
- [ ] Normalize accepted, streaming, completed, refused, failed, and interrupted outcomes.
- [ ] Preserve provider request IDs and useful redacted metadata.
- [ ] Handle rate limits, authentication expiry, service errors, and network disconnects.
- [ ] Detect token-limit truncation and incomplete streams.
- [ ] Implement cancellation where supported and report where it is unavailable.
- [ ] Implement idempotency and request reconciliation where supported.
- [ ] Validate structured outputs and expose unsupported features.
- [ ] Handle attachments according to provider capabilities and data policies.
- [ ] Collect usage and label unavailable or estimated values correctly.
- [ ] Add adapter contract tests using recorded or synthetic safe fixtures.

### 11. Recovery and human control

- [ ] Implement start, pause, resume, and stop commands with durable state changes.
- [ ] Define whether pause drains or cancels in-flight work and expose the choice.
- [ ] Guarantee pause/stop blocks new dispatches after the control transition commits.
- [ ] Prevent late results from restarting cancelled workflows.
- [ ] Implement human interjections with immediate event recording.
- [ ] Apply correction policies to affected queued and active work.
- [ ] Scope human-input pauses to a task, thread, or room as appropriate.
- [ ] Resume from durable state after client disconnection or service restart.
- [ ] Reconcile uncertain attempts before permitting retries.
- [ ] Implement explicit retry and regenerate as distinct actions.
- [ ] Implement continuation from a selected completed response.
- [ ] Restore sibling obligations and collection policy for parallel-round continuation.
- [ ] Record recovery choices and preserve prior attempts for inspection.
- [ ] Detect unavailable agents and offer explicit reassignment or cancellation.

### 12. Graphical interface

- [ ] Implement room creation, selection, search, archive, and deletion.
- [ ] Implement the three-column room/thread, conversation, and agent-details layout.
- [ ] Add panel resizing and responsive collapse behavior.
- [ ] Add agent configuration, role editing, activation, and model selection.
- [ ] Build a composer with explicit recipients, visibility, and response policy.
- [ ] Implement message reply, thread creation, and linked-source navigation.
- [ ] Show author, status, context revision, and artifact versions on messages.
- [ ] Show expected respondents, missing answers, deadlines, and collection outcomes.
- [ ] Show agent queues and explain blocked work.
- [ ] Expose start/pause/resume/stop and keep stop controls readily accessible.
- [ ] Add context, attempt, decision, and usage inspection views.
- [ ] Implement themes with primary corner radii at 0–4 px and no radius over 8 px.
- [ ] Add keyboard navigation, focus states, screen-reader labels, and accessible contrast.
- [ ] Preserve scroll position during streaming and provide a jump-to-latest control.
- [ ] Render Markdown, code, and attachments safely without executable embedded content.
- [ ] Distinguish pending, failed, refused, cancelled, uncertain, and stale results visually.
- [ ] Add clear empty states, connection errors, and recovery instructions.

### 13. Artifacts and optional execution

- [ ] Implement artifact upload, original-byte retention, hashing, and version metadata.
- [ ] Validate size, media type, filenames, and archive expansion limits.
- [ ] Generate safe previews with provenance links to originals.
- [ ] Authorize artifact reads and inclusion in provider requests.
- [ ] Track artifact versions referenced by each message and context snapshot.
- [ ] Support export of selected artifacts with an attribution manifest.
- [ ] Define conflict handling for competing artifact revisions.
- [ ] Optional: implement a capability-controlled tool execution service.
- [ ] Optional: isolate code execution and enforce resource/network limits.
- [ ] Optional: isolate concurrent edits in separate branches or workspaces.
- [ ] Optional: implement review and integration gates for merged changes.
- [ ] Optional: record external side effects and their authorization separately from discussion.

### 14. Security and privacy

- [ ] Document trust boundaries and threat scenarios for local operation.
- [ ] Store credentials securely and redact logs, diagnostics, and exports.
- [ ] Enforce authorization in application services rather than only in the UI.
- [ ] Bind local services appropriately and validate browser origins and requests.
- [ ] Prevent peer content from escalating privileges or modifying control instructions.
- [ ] Validate all structured actions and reject unexpected fields or oversized input.
- [ ] Protect renderers against script injection and unsafe links.
- [ ] Protect file operations against traversal, unsafe archives, and unintended overwrites.
- [ ] Prevent restricted content leakage through summaries, search, and previews.
- [ ] Define and implement retention, export, deletion, and backup lifecycle policies.
- [ ] Disclose which providers receive which selected messages and artifacts.
- [ ] Verify secrets are excluded from model context and exported session bundles.
- [ ] Define security reporting and patch procedures.
- [ ] Review dependency and installer integrity before release.

### 15. Budgets and diagnostics

- [ ] Track invocations, attempts, completed responses, rounds, tokens, and elapsed time separately.
- [ ] Implement per-room limits and a visible remaining-budget display.
- [ ] Reserve expected cost for concurrent work and reconcile actual usage.
- [ ] Label uncertain prices, missing usage, and possible in-flight overrun.
- [ ] Stop new dispatches when enforced limits are reached.
- [ ] Add correlation IDs across requests, attempts, provider events, and UI updates.
- [ ] Add redacted structured logs and configurable retention.
- [ ] Measure queue delay, response latency, failure rate, and reconciliation outcomes.
- [ ] Provide diagnostic export with a preview of included information.
- [ ] Surface stalled work and repeated failures without creating retry loops.

### 16. Export, import, and portability

- [ ] Export human-readable Markdown transcripts with authors and reply links.
- [ ] Export structured sessions with schema version, participants, requests, and decisions.
- [ ] Include artifact manifests and preserve original message identifiers.
- [ ] Exclude credentials and enforce visibility during export.
- [ ] Validate imported schemas, sizes, identities, and attachment hashes.
- [ ] Import sessions as inactive until explicitly resumed.
- [ ] Ensure importing history cannot execute embedded control events or tools.
- [ ] Handle schema upgrades and ID collisions without corrupting provenance.
- [ ] Document backup restoration separately from transcript import.

### 17. Optional browser transport

- [ ] Record an explicit scope decision for browser-provider support.
- [ ] Define adapter access and session-binding requirements.
- [ ] Verify the exact bound conversation and writable composer before each send.
- [ ] Detect missing tabs, changed sessions, login walls, and invalidated extension context.
- [ ] Implement provider-specific response completion checks and truncation detection.
- [ ] Detect DOM changes and pause when selectors or identity checks become uncertain.
- [ ] Distinguish submission evidence from answer completion.
- [ ] Reconcile ambiguous delivery before any resend.
- [ ] Prevent silent switching to a different conversation or participant.
- [ ] Test supported browser/provider combinations and document maintenance limits.

### 18. Optional remote multi-user deployment

- [ ] Record an explicit scope decision for remote hosting.
- [ ] Implement user authentication, membership roles, and workspace isolation.
- [ ] Add encrypted transport and secure session handling.
- [ ] Define invite, revoke, and administrative controls.
- [ ] Enforce tenant isolation in storage, queues, search, artifacts, and diagnostics.
- [ ] Configure deployment secrets, backups, monitoring, and recovery procedures.
- [ ] Add abuse limits and concurrent-user capacity planning.
- [ ] Validate remote security separately from the local release.

### 19. Verification and failure testing

- [ ] Verify two agents using the same model retain independent identities and histories.
- [ ] Verify directed messages do not awaken observers.
- [ ] Verify independent recipients cannot see sibling first answers prematurely.
- [ ] Verify synthesis waits for its actual configured collection policy.
- [ ] Verify duplicate and out-of-order events do not duplicate obligations or releases.
- [ ] Verify late answers remain visible without rewriting a closed synthesis.
- [ ] Verify refusals, empty results, and truncated outputs are classified correctly.
- [ ] Verify fixed relay order remains intact during directed addressing.
- [ ] Verify dependency cycles and stalled queues produce actionable states.
- [ ] Verify human corrections prevent stale results from satisfying revised tasks.
- [ ] Verify pause/stop behavior under simultaneous dispatch and completion.
- [ ] Verify restart recovery before submission, after remote acceptance, and before local commit.
- [ ] Verify expired worker leases cannot produce conflicting commits.
- [ ] Verify uncertain delivery never triggers an unreviewed duplicate resend.
- [ ] Verify parallel continuation reconstructs all relevant obligations.
- [ ] Verify context limits, summarization, and rollover preserve decisions and unresolved issues.
- [ ] Verify prompt injection cannot become an authorized command or secret disclosure.
- [ ] Verify restricted messages cannot leak through summaries or exports.
- [ ] Verify budget reservation under concurrent requests and unavailable pricing.
- [ ] Verify backup restoration and schema migration on realistic session data.
- [ ] Verify imports cannot automatically dispatch tasks or execute actions.
- [ ] Verify long transcripts, many threads, and streaming remain usable.
- [ ] Verify keyboard accessibility, contrast, resizing, and narrow layouts.
- [ ] Run an end-to-end investigation from parallel answers through directed review and synthesis.

### 20. Documentation and release gates

- [ ] Replace design-only setup notes with verified installation and launch instructions.
- [ ] Document supported platforms, providers, models, and capability limitations.
- [ ] Document conversation policies with directed, parallel, review, and relay examples.
- [ ] Document response eligibility, timeout behavior, and late-answer handling.
- [ ] Document human controls and recovery from uncertain delivery.
- [ ] Document data storage locations, credential handling, retention, and provider transmission.
- [ ] Add troubleshooting for rate limits, missing responses, stale context, and interrupted sessions.
- [ ] Publish developer setup, architecture, schema, adapter, and migration documentation.
- [ ] Produce versioned builds and verify installation, upgrade, and uninstall behavior.
- [ ] Confirm uninstall preserves or removes user data only according to explicit choice.
- [ ] Review license notices and dependency distribution requirements.
- [ ] Complete the security and recovery gates for the selected release scope.
- [ ] Confirm every advertised capability is implemented and validated or clearly marked unavailable.
- [ ] Record known limitations and unresolved defects in release notes.
- [ ] Tag the reviewed release and archive its reproducible build inputs.
