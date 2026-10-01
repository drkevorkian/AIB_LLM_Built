# AI Conversation Room

A local workspace where independent LLM agents answer directed or parallel requests, exchange responses through relays, and coordinate bounded discussions under human control.

**Status:** v0.7.0 adds safe Markdown and code formatting, original-source views, and message/code copying. Workspace search, thread-content search and naming, and persistent archives are available. Workspaces support 1–8 independent participants, roster management in Settings, and persistent participant configuration history. Node.js 26.10 and Node 24 are supported. A human-selected coordinator can ask active peers, collect all/any/quorum responses, and finish within an enforced round and turn allowance. The application also includes saved conversation defaults, workspace editing, and confirmed workspace/thread deletion. OpenAI, Grok/xAI, Gemini, Ollama, and OpenAI-compatible servers have implemented adapters. Add your provider keys or start a local model, then configure each participant in the app. Provider protocols and browser flows are tested with fixtures; credentialed provider accounts and installed local models have not been verified in this workspace. This release connects through APIs; signed-in ChatGPT/Grok/Gemini website sessions remain a separate, unimplemented transport. AI Conversation Room is the working name for `drkevorkian/AIB_LLM_Built`, inspired by lessons from AI Bridge.

## Overview

AI Conversation Room combines a group chat, threaded discussions, directed messages, parallel requests, and controlled turn-taking. Each agent has a stable identity, an individual context, and its own queue. The application owns delivery, scheduling, permissions, persistence, and recovery.

The central rule is simple:

**Who can see a message, who should answer it, and when they should answer are separate decisions.**

You can ask two agents for independent opinions, wait for both, send their answers to a third agent for synthesis, and ask one participant a targeted follow-up. An automatic relay follows your selected order, including A → C → B → A. Other participants can observe without being required to respond. In **Agent discussion**, a selected coordinator makes its own peer-routing choices and returns a final result. Open-ended conferences and nested peer delegation remain target capabilities.

## Goals

- Enable direct, attributable communication between distinct agents.
- Support multiple instances of the same model as independent participants.
- Run independent work concurrently and dependent work in sequence.
- Preserve original answers, disagreements, evidence, and decisions.
- Give the human clear controls over recipients, context, execution, and cost.
- Resume interrupted work without silently duplicating requests or losing state.
- Keep the conversation engine independent of provider APIs and browser interfaces.
- Make the application understandable through a complete graphical interface.

## Available in v0.7.0

- Read Markdown headings, emphasis, lists, quotes, tables, disabled task checkboxes, and scrollable code blocks with language labels.
- Switch each message between formatted and original-source views, copy its stored text, or copy an individual code block, including in archived workspaces.
- Keep streaming text stable until the attempt ends; retain readable source if formatting fails and selectable text if the clipboard is unavailable.
- Search workspace names/objectives and the selected workspace's thread names/messages with literal, case-insensitive matching and safe text previews.
- Rename threads without changing their identities, messages, reply links, frozen context, or pending work.
- Archive and restore workspaces in Settings while retaining full history and consumed usage; archived workspaces cannot invoke models or change conversation data.
- Create workspaces with 1–8 participants; add, deactivate, and reactivate participants in Settings while retaining their identities and history.
- Record every new participant configuration revision, including unused edits, and preserve the original author names and provider/model bindings on historical answers.
- Configurable OpenAI, Grok/xAI, Gemini, Ollama, and OpenAI-compatible text-generation connections, alongside clearly labeled simulation.
- Participant name/role editing, exact model IDs, model discovery, output limits, and connection timeouts.
- A connection test that makes an actual short generation request and reports its result.
- Automatic, configurable relay orders with 1–12 hops, repeated participants, exact reply links, and a complete turn reservation before starting.
- Directed questions, parallel answers, all/any/quorum collection, and optional synthesis after the required answers complete.
- Agent discussions: a selected coordinator chooses peers, collection policy, exact-message follow-ups, and when to finish, with 1–10 peer rounds and a 2–50 turn allowance reserved before starting.
- Strict structured coordinator actions, one bounded correction for an invalid completed decision, repeated-question detection, and a per-discussion Stop control.
- Persistent rooms/objectives/threads, streaming, frozen context inspection, reported token usage, provider request IDs, and Markdown export.
- Per-agent queues, pause/resume/stop, explicit bounded retries, and restart recovery.
- A dedicated Settings page for theme, saved conversation defaults, workspace name/objective/turn limit, and participant connections.
- Confirmed workspace/thread deletion, cancellation of affected work, removal of copied source context, and an empty state that survives service restart.
- A responsive React interface with dark/light themes and a loopback-only service with validated local sessions.

New rooms start in simulation so launch does not invoke or bill a provider. Configure participants explicitly to use real models. Missing credentials or failed live requests produce visible failures; they never fall back to simulation.

See [v0.7.0 release notes](docs/releases/0.7.0.md), [message presentation contract](docs/architecture/0008-message-presentation.md), [v0.6.0 release notes](docs/releases/0.6.0.md), [workspace organization contract](docs/architecture/0007-workspace-organization.md), [v0.5.0 release notes](docs/releases/0.5.0.md), [participant roster contract](docs/architecture/0006-participant-rosters.md), [v0.4.1 release notes](docs/releases/0.4.1.md), [v0.4.0 release notes](docs/releases/0.4.0.md), [settings/deletion contract](docs/architecture/0005-settings-and-deletion.md), [bounded-discussion contract](docs/architecture/0004-bounded-agent-discussions.md), [language decision](docs/architecture/0001-language-and-runtime.md), [workflow/recovery contract](docs/architecture/0002-workflow-and-recovery.md), and [live-provider contract](docs/architecture/0003-live-providers-and-relay.md).

![Agent discussion through configured local connections, using labeled HTTP protocol fixtures](docs/images/workspace.png)

## Reading and copying messages

Completed messages support Markdown headings, emphasis, lists, blockquotes, tables, task lists, inline code, and fenced/indented code blocks. Message headings stay below the workspace heading. Code blocks and wide tables scroll within the conversation on narrow screens. Task checkboxes show source state and cannot be toggled. Code is displayed without execution or syntax highlighting.

**View source** shows the stored message body; **View formatted** returns to Markdown. **Copy message** copies that body, including Markdown, without attribution labels or other interface text. While an answer streams, it copies the text available at that click. **Copy code** copies just the displayed code content; Markdown parsing normalizes code line endings and may add a final newline. Copying never reads your clipboard or sends another provider request. If clipboard access is missing or denied, a visible message explains manual copying, and whole-message copying opens the selectable source view.

Streaming text stays literal until the attempt ends. Completed, failed, cancelled, and interrupted attempts may show formatted text; their original status remains visible, and formatting does not make a partial answer complete. The formatter loads separately and falls back to readable source if it cannot load or render. Reload after fixing a module-load problem to restore formatting. Source-view and copy feedback are per-view and reset on reload.

Raw HTML remains escaped text. Image references show alt-text placeholders without loading local or remote images. Only explicit HTTP(S) links without embedded credentials are clickable, opening in a new tab without an opener or referrer. Relative links, fragments, non-web schemes, and malformed/unsafe destinations remain labels. Links never open automatically. These rules also apply to LLM-authored messages. Formatting has no routing or execution authority; frozen context, literal search previews, and exports keep the original text. Attachment upload/previews, mathematical typesetting, Mermaid rendering, internal footnote navigation, and code highlighting remain planned. An exported transcript is Markdown source; other viewers have their own rendering rules.

## Planned capabilities

| Capability            | Intended behavior                                                      |
| --------------------- | ---------------------------------------------------------------------- |
| Shared room           | A persistent objective, roster, instructions, and conversation         |
| Threads               | Separate discussions linked to their originating messages              |
| Directed requests     | Explicit recipients and exact reply targets                            |
| Parallel consultation | Multiple agents answer from the same shared context snapshot           |
| Response collection   | Attributed answers collected against a defined completion policy       |
| Cross-review          | One agent reviews another's completed answer or artifact               |
| Fixed relay           | Configurable order, including A → C → B → A                            |
| Conference discussion | A controlled speaking queue and bounded follow-ups                     |
| Artifact exchange     | Versioned attachments with authorship and access controls              |
| Recovery              | Durable queues, checkpoints, reconciliation, and explicit continuation |
| Human control         | Start, pause, resume, stop, interject, redirect, and inspect           |
| Observability         | Delivery states, missing responses, context versions, and usage        |

## Getting started

Install **Node.js 26.10 or newer in the 26.x series**. **Node.js 24.15 or newer in the 24.x series** is also supported. `.nvmrc` selects 26.10.0 when using nvm. This build was verified on Linux with Node 26.10.0 and 24.19.0. CI checks both versions on Linux, Windows, and macOS; Chromium UI coverage runs on Linux for both runtimes. A native desktop installer is planned.

```sh
git clone https://github.com/drkevorkian/AIB_LLM_Built.git
cd AIB_LLM_Built
npm ci
npm run dev
```

Open **http://127.0.0.1:4317**. The first launch creates a room with AI A, AI B, and AI C. The default composer asks B and C independently, then queues A to synthesize their completed answers. Turn off synthesis or change the recipients for a directed conversation. Choose **Update · no reply** to share information without invoking anyone. Click a participant's **Configure** button to select actual models. New workspaces let you choose 1–8 participants and have independent participant settings. A single-participant workspace starts with a directed request; larger workspaces default to parallel answers and synthesis by the first active participant.

The client updates during development. Restart the service after server-source changes. To run built assets:

```sh
npm run build
npm start
```

The service continues working if the browser view closes. Pause or stop from the UI to control work; press Ctrl+C in the service terminal to shut it down. On restart, unfinished rooms are paused. Queued jobs remain queued; interrupted jobs require an explicit retry and are never replayed automatically.

### Connect real models

1. Copy `.env.example` to `.env` in the repository directory. For a cloud provider, set `OPENAI_API_KEY`, `XAI_API_KEY`, or `GEMINI_API_KEY` locally. Restart the service after changing keys. Environment variables already set in the service take precedence over `.env`.
2. Click **Configure** on a participant card or in Settings. Choose its provider, edit its role, and enter the exact text-generation model ID. **Load available models** reads the provider catalog; some catalog entries may not support text generation.
3. Save the settings. **Test connection** sends a short greeting request through the selected connection. This test may incur provider charges and does not consume the room turn budget. It sends participant roles but no thread history or shared objective.
4. Send a question, parallel consultation, relay, or agent discussion. Active participants may use different providers, or independent instances of the same provider/model.

For **Ollama**, start Ollama on your machine and install a model in it. Select **Ollama (local)**, use `http://127.0.0.1:11434`, and load/select the installed model. No cloud API key is needed. The adapter accepts loopback servers only.

For an **OpenAI-compatible server**, enter its base URL, including `/v1` when required by that server. HTTPS is required except on localhost. Set `AIB_COMPATIBLE_API_KEY` in the service if your server requires bearer authentication. Redirects are rejected to prevent forwarding credentials to a different endpoint. Compatibility depends on the server implementing streamed Chat Completions with a complete `stop` outcome. A discussion coordinator additionally requires JSON Schema structured-output support; ordinary peer answers remain plain text. A successful greeting test does not verify that additional capability.

Provider keys remain in the service environment. They are absent from room records, snapshots, browser responses, and exports. A local `.env` file is ignored by Git but is still a plaintext file on your machine; restrict its filesystem access. OS keychain storage is planned. API access, billing, and model permissions are separate from website sessions/subscriptions.

### Choose a conversation flow

- **Directed:** select one participant and disable synthesis. Its answer is attributed to it; other agents remain observers. **Reply to AI B**, for example, selects B and preserves the exact reply target.
- **Parallel:** select multiple participants. They receive the same initial context and answer independently. Choose all/any/quorum and optionally a separate synthesizer.
- **Relay:** choose **Automatic relay** in the composer and edit the ordered steps. With the initial three participants the default is A → C → B → A; it adapts to other active rosters. Each completed answer goes to the next participant; the final answer returns to you. Failure or refusal blocks advancement. Pause holds new hops, and Stop cancels remaining hops. The deadline applies to each hop.
- **Agent discussion:** select a coordinator, peer-round limit, and turn allowance. The coordinator can ask one or more permitted active peers concurrently, choose all/any/quorum, follow up to a specific answer, then return a final result. A single-participant coordinator may finish without peer requests. Decisions, peer answers, correction attempts, and explicit retries all consume the allowance. The default reserves 12 turns and allows 3 peer rounds; unused turns are released when finished or stopped. A round deadline covers the queue and generation time for that decision or peer set. **Stop discussion** cancels only that discussion; room controls still apply to all work.
- **Update:** share information with no new generation.

A discussion keeps its submitted objective, roles, and base context frozen. Later updates do not silently replace that context. All/any/quorum closure records the exact included peer answers. Late answers remain separate and do not rewrite the coordinator’s continuation; unfinished late respondents are cancelled when the coordinator finishes. The coordinator may finish without asking peers when the task or allowance calls for it. Exceeding a limit produces a blocked state rather than an invented final answer.

Participant and workspace settings cannot be edited while queued/running work, a blocked relay, an unfinished discussion, or a connection probe remains. Finish or stop pending work first. Previously recorded invocation snapshots retain their original provider, model, role, and objective. Explicit retries retain the original bindings too; send a new question to use revised settings. If a participant required by a failed workflow has been deactivated, reactivate it before retrying.

### Settings and workspace management

Click **Settings** in the header to open the dedicated page; `http://127.0.0.1:4317/#settings` also opens it directly. In this release each sidebar workspace is one conversation room; there is no additional workspace/group hierarchy.

- **Preferences:** choose a theme and save defaults for new workspace turn limits, response deadlines, all/any/quorum collection, synthesis, discussion peer rounds, and discussion turn allowances. Theme stays in this browser; conversation defaults are stored in SQLite and shared by views of the same service. Existing workspaces, active work, and open composers keep their values. Visiting Settings preserves the open composer draft.
- **Workspace:** edit the selected workspace's name, shared objective, and turn limit. Finish or stop pending work first. The limit cannot be below turns already used. Historical invocation objectives and participant bindings remain recorded; new requests use the revised objective.
- **Participants & connections:** add a participant, deactivate/reactivate an existing identity, inspect configuration history, or configure its role, provider/model, output limit, and timeout. New participants start in simulation; connection tests require an active participant. Keep at least one active participant. The eight-identity limit includes inactive participants, whose messages, settings, usage, and history remain available. Names may repeat; the UI adds a roster number to distinguish duplicate names. API credentials remain in the service environment/`.env`; Settings displays their availability without receiving key values.
- **Search:** use **Search workspaces** to match names or objectives and choose **Active**, **Archived**, or **All workspaces**. **Search threads** matches names and retained message text in the selected workspace, including streamed text as it arrives. Matching previews are plain text. Search keeps the selected conversation and open draft; choosing a result opens the full thread. Queries are local to the open view, use literal case-insensitive matching, and clear on reload. Thread search resets when changing workspaces.
- **Rename thread:** click its pencil button, enter a name of 1–100 characters, then save or cancel. Naming can happen during active work because it changes only the thread label. Other views and exports use the updated name; routing, message IDs, reply links, invocation context, and usage stay unchanged.
- **Archive workspace:** use Settings and confirm the named workspace. Finish or stop queued/running work and unfinished workflows first; connection probes must finish. Archiving pauses the workspace and retains its participants, threads, messages, attempts, snapshots, workflows, history, and consumed usage. Archived conversations support reading, searching, inspection, export, restoration, and whole-workspace deletion. Editing, sending, retrying, controls, thread deletion/renaming, roster changes, and connection tests require restoration. An already open draft stays in place with its controls disabled.
- **Restore workspace:** use Settings or the archived-conversation notice and confirm. Restoration returns it to the active list and keeps it paused; **Resume** is explicit. Restoration does not replay failed/cancelled work or refund used turns. If only archived workspaces remain, the app opens an archived workspace after restart without creating another welcome room.
- **Delete workspace:** use the trash button beside its sidebar entry or the action at the end of Settings, then confirm the named workspace. This removes its participants, threads, messages, requests, attempts, snapshots, workflows, and local activity. Active generations and connection probes are aborted. Other workspaces remain usable. Deleting the final workspace leaves an empty app, including after restart; **Create workspace** starts a new one.
- **Delete thread:** use its sidebar trash button and confirm. Its messages, attempts, response sets, relays, and discussions are removed. Stored copies of its messages are also removed from surviving context snapshots. Pending work using that context is cancelled, unused reservations are released, and consumed turns remain counted. Surviving completed answers remain in their threads; a redaction notice identifies historical context changes. Attempts with redacted context cannot be retried; ask a new question instead.

Roster changes update other open views. An open composer keeps its draft, removes inactive recipients and relay steps, and adjusts invalid coordinator, synthesis, or quorum choices. Added/reactivated participants remain observers until explicitly selected. Deactivation prevents new generations; it does not hide room-visible messages or remove historical context. New edits record full configurations from v0.5.0 onward. Older workspaces recover configurations present in their snapshots and current settings; previously unrecorded unused edits cannot be reconstructed.

Deletion is permanent within the app and updates other open views. It is logical deletion from active records, not a promise of forensic disk erasure. It cannot retract provider submissions, exported transcripts, external backups, or text already incorporated into answers in another thread. Minimal deleted-command UUIDs remain to reject delayed replay; they retain no message text or command hash. Export first if you need a transcript.

![Settings page with conversation defaults and workspace controls](docs/images/settings.png)

### Configuration and data

| Setting            | Default                               | Meaning                                                  |
| ------------------ | ------------------------------------- | -------------------------------------------------------- |
| `AIB_PORT`         | `4317`                                | Loopback service port; remote binding is not supported   |
| `AIB_DATA_DIR`     | Platform-specific user data directory | Directory containing `rooms.sqlite` and its writer lease |
| `AIB_BROWSER_PATH` | Playwright-managed Chromium           | Optional existing Chromium executable for UI tests only  |

Default application data locations:

- Linux: `$XDG_DATA_HOME/AIB_LLM_Built`, or `~/.local/share/AIB_LLM_Built`.
- Windows: `%LOCALAPPDATA%/AIB_LLM_Built`, or the user home directory if that variable is unavailable.
- macOS: `~/Library/Application Support/AIB_LLM_Built`.

Example local override in Bash:

```sh
AIB_DATA_DIR=.data/local AIB_PORT=4317 npm run dev
```

In PowerShell:

```powershell
$env:AIB_DATA_DIR = ".data/local"
$env:AIB_PORT = "4317"
npm run dev
```

`npm run dev` and `npm start` automatically load an optional local `.env` file using Node’s native loader. Local databases and secrets are ignored by Git. Do not run two application processes against the same data directory: the writer lease intentionally rejects the second process.

### Verification

```sh
npm run check
npm run build
npx playwright install chromium
npm run test:ui
```

The v0.7.0 suite includes 140 engine/service/provider-protocol/rendering tests and 28 Chromium UI tests, verified under both Node 26.10.0 and 24.19.0. Coverage includes Markdown safety, exact source/code copying, denied or missing clipboard APIs, split streams, failed partial code, formatter-load failure, delayed post-send history refresh and retained drafts/selection, source/context/export preservation, archives and explicit restoration, read-only archive commands, scoped renaming during active work, safe search previews, archive-only service restart, variable rosters, activation, configuration history, frozen retry bindings, independent duplicate names, cross-view drafts, and persistence/restart. Protocol fixtures exercise the production adapters over streamed HTTP, including relay and a six-turn coordinator → parallel peers → targeted review → final result flow. These checks do not establish availability of your cloud account or installed local model. Browser tests use a fresh temporary data directory for each run, separate from normal application data. See [CONTRIBUTING.md](CONTRIBUTING.md) for development boundaries.

To exercise failure handling in simulation, include `[simulate:fail]`, `[simulate:refuse]`, or `[simulate:slow]` in a question. Use `[simulate:follow-up]` in an agent discussion to demonstrate a second round targeting the first peer’s exact answer. These markers belong to simulation and have no special behavior in live providers.

## Current implementation limits

The rest of this README specifies the full target design. The checked TODO items at the end record completed work; unchecked items remain planned.

The v0.7.0 build supports live text-generation API calls, human-directed requests/updates, synthesis, fixed relays, and bounded coordinator discussions. The selected coordinator can ask peers and finish through validated structured actions. Peers answer without delegation permission. Coordinators cannot change identity, permissions, limits, or room controls. Nested delegation, autonomous tools, and open-ended conferences are not implemented. Each workspace has 1–8 participant identities, including inactive identities; at least one stays active. Their names, roles, providers, and models are editable. The service runs at most four generations concurrently and one per participant.

All messages are room-visible. All/any/quorum are the implemented collection policies. Timeout cancels unfinished work for the affected request and pauses the room; deadlines continue while paused. Each provider also has a connection timeout. Reported usage is stored per attempt; monetary cost estimates and enforced token/cost budgets are not implemented.

Signed-in browser-session transport, rosters above eight identities, participant removal, membership changes during pending workflows, unrestricted agent send types, nested peer delegation, assigned cross-review rounds, conference speaking queues, attachments, private threads, summaries, imports, backup tools, and installers remain planned. Remote acceptance/reconciliation is incomplete. Provider/network failures are never automatically retried. A confirmed completed but invalid coordinator action can receive one new correction invocation within the reserved allowance; this may incur charges. Explicit retries may also incur another charge if the first request reached the provider. Stop aborts the local request, but a provider may continue processing or billing a request it already accepted.

Initial limits are 12,000 characters per command, 20,000 per provider answer, and 64,000 per context snapshot. Oversized contexts are rejected explicitly; history is not silently truncated. The persistence layer is a transactional room-document store for a single service, with a separate SQLite writer lease. Multi-worker scheduling and large-history pagination are planned.

Search uses workspace metadata and the selected workspace's retained room-visible messages already loaded by the client. Advanced query syntax, global message search across workspaces, ranking/indexing, bulk organization, thread archive, and message-body editing remain planned. Archived workspaces are retained data, not backups or a privacy boundary.

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

| Type                | Meaning                                              | Default scheduling effect                                |
| ------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| Question/task       | Requests a response or deliverable                   | Creates tracked obligations                              |
| Answer              | Responds to an existing request                      | Updates that request's response set                      |
| Critique            | Reviews a specific claim or artifact                 | Requires an explicit follow-up request to summon a reply |
| Update              | Shares information                                   | No automatic reply                                       |
| Proposal            | Suggests a course of action                          | No automatic adoption                                    |
| Decision            | Records an authorized resolution                     | Updates decision state within assigned authority         |
| Human-input request | Identifies a missing human decision                  | Blocks the affected work according to scope              |
| Control event       | Records pause, cancellation, or configuration change | Executed only through authorized application controls    |

These types describe public contributions. The application does not require agents to disclose hidden internal reasoning; concise explanations, evidence, assumptions, and conclusions are sufficient.

### Parallel questions and response sets

A request addressed to B and C creates one parent request and two recipient obligations. Both receive the same shared snapshot, plus their explicitly recorded individual role and context. Independent-answer mode withholds sibling answers until each initial answer is committed.

Responses stream into the interface separately. Downstream synthesis waits for the configured collection policy; displaying an answer does not automatically release dependent work.

| Policy   | Completion rule                                                                   |
| -------- | --------------------------------------------------------------------------------- |
| All      | Every required recipient supplies an eligible completed answer                    |
| Any      | The first eligible completed answer releases downstream work                      |
| Quorum   | A configured number of distinct recipients supply eligible answers                |
| Deadline | At the deadline, use the available response set if the minimum requirement is met |
| No reply | Informational delivery creates no answer obligation                               |

Each policy specifies timeout behavior: keep waiting, pause, or proceed with an explicitly incomplete set. Errors, refusals, cancellations, empty outputs, and malformed structured results remain visible outcomes; they do not silently count as eligible answers. A refusal can be a terminal recipient outcome while leaving the parent request unable to meet its success policy.

When a collection closes, it records exactly which messages were included. Late answers remain attributed and visible; they do not silently alter an already-published synthesis. A follow-up synthesis can incorporate them. Any/quorum policies also specify whether remaining work continues or is cancelled.

A response set preserves each original answer. A synthesis is a separate authored message linked to the included answers, with missing participants and unresolved disagreements identified.

### Directed follow-ups

If B identifies a race condition and C proposes an interface, A can create two requests:

- A → B, replying to B's message: identify the exact transition that allows a duplicate send.
- A → C, replying to C's message: show how queued, submitted, and completed states appear.

These requests can run concurrently. A can instead question B while leaving C as an observer. Each answer links to the specific request and thread, not merely to the latest room message.

### Conversation modes

| Mode                  | Scheduling rule                                          | Typical use                     |
| --------------------- | -------------------------------------------------------- | ------------------------------- |
| Directed              | Invoke only explicitly selected respondents              | Targeted questions              |
| Parallel consultation | Dispatch independent requests, collect, then synthesize  | Comparing approaches            |
| Peer review           | Independent answers followed by assigned cross-critiques | Finding errors and omissions    |
| Parallel tasks        | Execute independent tasks against agreed interfaces      | Dividing work                   |
| Conference            | Maintain a fair speaking queue and explicit follow-ups   | Open discussion                 |
| Fixed relay           | Follow the selected participant order                    | Predictable sequential dialogue |

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

| Component           | Responsibility                                                            |
| ------------------- | ------------------------------------------------------------------------- |
| Graphical client    | Room, thread, roster, composer, controls, and inspection views            |
| Application service | Authenticated commands, validation, and authoritative state               |
| Conversation engine | Requests, obligations, response sets, dependencies, and mode rules        |
| Scheduler           | Per-agent queues, fairness, limits, deadlines, leases, and cancellation   |
| Context builder     | Authorized snapshot assembly, summaries, retrieval, and token budgets     |
| Provider adapters   | Translate invocations and normalize provider lifecycle events             |
| Persistent store    | Events, message records, queues, checkpoints, and configuration revisions |
| Artifact store      | Original files, immutable versions, hashes, previews, and permissions     |
| Policy layer        | Authorization, tool boundaries, visibility, and routing validation        |
| Diagnostics         | Redacted logs, metrics, usage estimates, and recovery explanations        |

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
  "visibility": { "scope": "room" },
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

TypeScript, React, Node 24, SQLite, and local browser operation were selected for v0.1.0. The v0.2.0 iteration added live API adapters and bounded relay; v0.3.0 adds bounded agent-chosen peer discussions. v0.4.0 adds settings and workspace/thread management; v0.4.1 adds verified Node 26.10 support. v0.5.0 adds variable participant rosters, activation, and configuration history. v0.6.0 adds workspace/thread search, thread renaming, and workspace archive/restore. v0.7.0 adds safe Markdown/code presentation, original-source views, and copy controls. Source-run installation is available; desktop packaging and the project license remain open decisions. There is no declared project license grant.

## Delivery milestones

| Milestone                | Exit condition                                                                |
| ------------------------ | ----------------------------------------------------------------------------- |
| M0 — Contracts           | Message, state, policy, and persistence contracts reviewed                    |
| M1 — Local simulation    | Two fake agents complete directed and parallel workflows through the UI       |
| M2 — API MVP             | Real adapters, durable recovery, human controls, budgets, and export verified |
| M3 — Collaboration       | Review, conference, relay, artifact workflows, and extended context complete  |
| M4 — Optional extensions | Browser transport or remote hosting separately scoped and validated           |
| M5 — Release             | Security, packaging, upgrade, documentation, and release gates pass           |

## Complete implementation TODO checklist

This is the complete implementation checklist for the scope described above. Checked items are implemented and validated in v0.1.0–v0.7.0 or supported by a recorded scope decision. Provider adapter validation uses protocol fixtures; credentialed account/model verification remains explicitly unchecked. Partial implementations retain their unchecked original item. Optional items are explicitly marked; future discoveries may add work. Mark an item complete only with reviewable implementation or a recorded scope decision and applicable validation.

### 1. Product scope and decisions

- [x] Confirm the project name and repository location.
- [x] Record initial target operating systems and supported deployment model.
- [x] Select the runtime, GUI framework, persistence engine, and packaging approach.
- [ ] Select and document the project license and dependency license policy.
- [x] Define MVP boundaries against milestones M0–M5.
- [x] Select initial API providers and document supported capabilities from their official documentation.
- [x] Decide whether browser transport belongs in the first release or a later milestone.
- [x] Define whether execution continues when the graphical client closes.
- [x] Define single-user permissions and separately scope optional multi-user operation.
- [x] Record architecture decisions, defaults, and unresolved questions in versioned documentation.

### 2. Repository and development foundation

- [x] Create the application, domain, adapters, persistence, UI, and test modules.
- [x] Configure dependency locking and reproducible development setup.
- [ ] Add formatting, linting, static checks, and CI workflows.
- [ ] Add secret scanning and dependency vulnerability checks.
- [x] Add configuration validation and a safe example configuration without credentials.
- [ ] Establish schema versioning and migration conventions.
- [x] Implement deterministic clocks and ID injection for workflow tests.
- [x] Implement a fake provider supporting success, delay, partial output, refusal, and failure.
- [x] Define contribution guidance and the feature completion standard.

### 3. Identity, rooms, and configuration

- [ ] Implement stable workspace, room, participant, and thread identities.
- [x] Support multiple independent participants using the same provider/model.
- [x] Store participant role and model configuration revisions.
- [x] Preserve attribution when participants are renamed or deactivated.
- [ ] Implement room objectives and versioned human instructions.
- [x] Implement room membership and participant activation rules.
- [x] Validate recipient identity without relying on display-name uniqueness.
- [ ] Record membership changes during active rounds and define their effect on obligations.
- [ ] Implement explicit room lifecycle and completion reasons.

### 4. Message and routing contracts

- [ ] Define schemas for all public message types and internal control events.
- [x] Separate recipients, visibility, response policy, and scheduling metadata.
- [x] Implement exact reply links and parent-request references.
- [x] Enforce trusted authorship and server-assigned timestamps/order.
- [x] Validate message size, field limits, and schema versions.
- [ ] Implement structured agent send actions and bounded repair for invalid payloads.
- [ ] Reject unknown, inactive, ambiguous, unauthorized, and disallowed self-targets.
- [x] Ensure prose mentions and quoted routing text cannot dispatch work.
- [ ] Preserve original messages; represent edits and regenerations as linked revisions.
- [ ] Implement explicit supersession and its effect on dependent requests.
- [ ] Enforce thread and artifact visibility on send and read paths.

### 5. Persistence and event processing

- [ ] Create transactional storage for all core entities and configuration revisions.
- [x] Persist dispatch intent atomically with requests and obligations.
- [x] Implement durable queues and an outbox or equivalent delivery mechanism.
- [ ] Add unique constraints for deduplicating local event processing.
- [ ] Implement worker claims, lease expiry, and fencing against stale workers.
- [ ] Store provider attempt identifiers and normalized lifecycle events.
- [x] Rebuild room state from durable records after restart.
- [ ] Add indexes and pagination for large histories.
- [ ] Implement backup creation, integrity checks, and restoration.
- [ ] Implement migrations with rollback or recoverable backup procedures.
- [ ] Define data retention and authorized deletion across derived stores.

### 6. Scheduler and dependencies

- [x] Enforce one active invocation per logical agent.
- [x] Support concurrent invocations across separate agents.
- [ ] Add per-provider and per-workspace concurrency limits.
- [ ] Implement priorities, fair queues, and starvation prevention.
- [ ] Represent dependencies explicitly and detect cycles.
- [ ] Explain blocked tasks and missing prerequisites in the UI.
- [x] Implement deadlines using restart-safe timestamps and monotonic elapsed timers where appropriate.
- [ ] Implement bounded retries with backoff and jitter for eligible errors.
- [ ] Distinguish retryable failure from uncertain remote acceptance.
- [ ] Prevent cancelled, stale, or superseded work from releasing dependencies.
- [ ] Reserve sufficient turn and budget capacity before starting a multi-agent phase.

### 7. Response collection

- [x] Create one obligation per selected recipient and link it to its parent request.
- [ ] Implement all, any, quorum, deadline, and no-reply policies.
- [x] Validate impossible quorums and empty respondent sets before dispatch.
- [x] Define eligible answers and distinct failure/refusal outcomes.
- [x] Render incoming streams without prematurely releasing synthesis.
- [ ] Implement wait, pause, and explicitly incomplete timeout outcomes.
- [x] Record immutable response-set closure and included message IDs.
- [ ] Implement policies for cancelling or continuing remaining work after any/quorum completion.
- [ ] Preserve late answers and support an explicit updated synthesis.
- [x] Prevent duplicate answer events from satisfying multiple obligations.
- [x] Preserve each contributor's original answer and attribution.
- [ ] Show missing recipients and unresolved disagreement in synthesis context.

### 8. Conversation modes

- [x] Implement directed requests and targeted follow-ups.
- [x] Implement independent parallel consultation with sibling-answer isolation.
- [ ] Implement sequential review dependencies.
- [ ] Implement assigned cross-review after independent first answers.
- [ ] Implement parallel task execution with explicit shared contracts.
- [ ] Implement conference speaking queues and fair turn allocation.
- [x] Implement configurable fixed relay orders, including A → C → B → A.
- [ ] Keep fixed speaking order separate from message addressing.
- [ ] Support a selectable starter and finite round limits.
- [ ] Define mode transitions only at safe workflow boundaries.
- [x] Prevent informational updates from generating acknowledgment loops.
- [ ] Bound automatic follow-ups and detect repetitive or stalled discussion.
- [ ] Distinguish idle, completed, unresolved, blocked, and stopped outcomes.

### 9. Context assembly and memory

- [x] Build immutable invocation snapshots with selected source versions.
- [ ] Include applicable human instructions and the correct participant revision.
- [x] Include relevant thread history and unseen authorized room updates.
- [ ] Implement per-agent context cursors without implying comprehension.
- [ ] Apply model-specific context budgets and visible truncation rules.
- [ ] Implement summaries linked to original messages and decisions.
- [ ] Preserve disagreements and open questions during summarization.
- [ ] Retrieve original source messages when summaries are insufficient.
- [ ] Enforce access control before retrieval, summarization, and attachment expansion.
- [x] Exclude sibling answers during independent first-response phases.
- [ ] Mark outputs generated against superseded instructions as stale.
- [ ] Implement safe context rollover with role, objective, and pending-work restoration.
- [x] Provide an inspector for exactly what context each invocation received.

### 10. API adapters

- [ ] Define a common adapter interface and capability registry.
- [x] Implement credential validation without exposing secrets.
- [x] Implement initial provider integrations against verified official contracts.
- [ ] Normalize accepted, streaming, completed, refused, failed, and interrupted outcomes.
- [x] Preserve provider request IDs and useful redacted metadata.
- [x] Handle rate limits, authentication expiry, service errors, and network disconnects.
- [x] Detect token-limit truncation and incomplete streams.
- [ ] Implement cancellation where supported and report where it is unavailable.
- [ ] Implement idempotency and request reconciliation where supported.
- [ ] Validate structured outputs and expose unsupported features.
- [ ] Handle attachments according to provider capabilities and data policies.
- [x] Collect usage and label unavailable or estimated values correctly.
- [x] Add adapter contract tests using recorded or synthetic safe fixtures.

### 11. Recovery and human control

- [ ] Implement start, pause, resume, and stop commands with durable state changes.
- [ ] Define whether pause drains or cancels in-flight work and expose the choice.
- [x] Guarantee pause/stop blocks new dispatches after the control transition commits.
- [x] Prevent late results from restarting cancelled workflows.
- [ ] Implement human interjections with immediate event recording.
- [ ] Apply correction policies to affected queued and active work.
- [ ] Scope human-input pauses to a task, thread, or room as appropriate.
- [x] Resume from durable state after client disconnection or service restart.
- [ ] Reconcile uncertain attempts before permitting retries.
- [ ] Implement explicit retry and regenerate as distinct actions.
- [ ] Implement continuation from a selected completed response.
- [ ] Restore sibling obligations and collection policy for parallel-round continuation.
- [x] Record recovery choices and preserve prior attempts for inspection.
- [ ] Detect unavailable agents and offer explicit reassignment or cancellation.

### 12. Graphical interface

- [x] Implement room creation, selection, search, archive, and deletion.
- [x] Implement the three-column room/thread, conversation, and agent-details layout.
- [ ] Add panel resizing and responsive collapse behavior.
- [x] Add agent configuration, role editing, activation, and model selection.
- [x] Build a composer with explicit recipients, visibility, and response policy.
- [x] Implement message reply, thread creation, and linked-source navigation.
- [ ] Show author, status, context revision, and artifact versions on messages.
- [x] Show expected respondents, missing answers, deadlines, and collection outcomes.
- [ ] Show agent queues and explain blocked work.
- [ ] Expose start/pause/resume/stop and keep stop controls readily accessible.
- [ ] Add context, attempt, decision, and usage inspection views.
- [x] Implement themes with primary corner radii at 0–4 px and no radius over 8 px.
- [ ] Add keyboard navigation, focus states, screen-reader labels, and accessible contrast.
- [x] Preserve scroll position during streaming and provide a jump-to-latest control.
- [ ] Render Markdown, code, and attachments safely without executable embedded content (Markdown/code complete in v0.7.0; attachments remain).
- [ ] Distinguish pending, failed, refused, cancelled, uncertain, and stale results visually.
- [x] Add clear empty states, connection errors, and recovery instructions.

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
- [x] Enforce authorization in application services rather than only in the UI.
- [x] Bind local services appropriately and validate browser origins and requests.
- [x] Prevent peer content from escalating privileges or modifying control instructions.
- [x] Validate all structured actions and reject unexpected fields or oversized input.
- [x] Protect renderers against script injection and unsafe links.
- [ ] Protect file operations against traversal, unsafe archives, and unintended overwrites.
- [ ] Prevent restricted content leakage through summaries, search, and previews.
- [ ] Define and implement retention, export, deletion, and backup lifecycle policies.
- [ ] Disclose which providers receive which selected messages and artifacts.
- [x] Verify secrets are excluded from model context and exported session bundles.
- [ ] Define security reporting and patch procedures.
- [ ] Review dependency and installer integrity before release.

### 15. Budgets and diagnostics

- [ ] Track invocations, attempts, completed responses, rounds, tokens, and elapsed time separately.
- [x] Implement per-room limits and a visible remaining-budget display.
- [ ] Reserve expected cost for concurrent work and reconcile actual usage.
- [ ] Label uncertain prices, missing usage, and possible in-flight overrun.
- [x] Stop new dispatches when enforced limits are reached.
- [ ] Add correlation IDs across requests, attempts, provider events, and UI updates.
- [ ] Add redacted structured logs and configurable retention.
- [ ] Measure queue delay, response latency, failure rate, and reconciliation outcomes.
- [ ] Provide diagnostic export with a preview of included information.
- [ ] Surface stalled work and repeated failures without creating retry loops.

### 16. Export, import, and portability

- [x] Export human-readable Markdown transcripts with authors and reply links.
- [ ] Export structured sessions with schema version, participants, requests, and decisions.
- [ ] Include artifact manifests and preserve original message identifiers.
- [x] Exclude credentials and enforce visibility during export.
- [ ] Validate imported schemas, sizes, identities, and attachment hashes.
- [ ] Import sessions as inactive until explicitly resumed.
- [ ] Ensure importing history cannot execute embedded control events or tools.
- [ ] Handle schema upgrades and ID collisions without corrupting provenance.
- [ ] Document backup restoration separately from transcript import.

### 17. Optional browser transport

- [x] Record an explicit scope decision for browser-provider support.
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

- [x] Record an explicit scope decision for remote hosting.
- [ ] Implement user authentication, membership roles, and workspace isolation.
- [ ] Add encrypted transport and secure session handling.
- [ ] Define invite, revoke, and administrative controls.
- [ ] Enforce tenant isolation in storage, queues, search, artifacts, and diagnostics.
- [ ] Configure deployment secrets, backups, monitoring, and recovery procedures.
- [ ] Add abuse limits and concurrent-user capacity planning.
- [ ] Validate remote security separately from the local release.

### 19. Verification and failure testing

- [x] Verify two agents using the same model retain independent identities and histories.
- [x] Verify directed messages do not awaken observers.
- [x] Verify independent recipients cannot see sibling first answers prematurely.
- [x] Verify synthesis waits for its actual configured collection policy.
- [ ] Verify duplicate and out-of-order events do not duplicate obligations or releases.
- [x] Verify late answers remain visible without rewriting a closed synthesis.
- [x] Verify refusals, empty results, and truncated outputs are classified correctly.
- [ ] Verify fixed relay order remains intact during directed addressing.
- [ ] Verify dependency cycles and stalled queues produce actionable states.
- [ ] Verify human corrections prevent stale results from satisfying revised tasks.
- [x] Verify pause/stop behavior under simultaneous dispatch and completion.
- [ ] Verify restart recovery before submission, after remote acceptance, and before local commit.
- [ ] Verify expired worker leases cannot produce conflicting commits.
- [ ] Verify uncertain delivery never triggers an unreviewed duplicate resend.
- [ ] Verify parallel continuation reconstructs all relevant obligations.
- [ ] Verify context limits, summarization, and rollover preserve decisions and unresolved issues.
- [x] Verify prompt injection cannot become an authorized command or secret disclosure.
- [ ] Verify restricted messages cannot leak through summaries or exports.
- [ ] Verify budget reservation under concurrent requests and unavailable pricing.
- [ ] Verify backup restoration and schema migration on realistic session data.
- [ ] Verify imports cannot automatically dispatch tasks or execute actions.
- [ ] Verify long transcripts, many threads, and streaming remain usable.
- [ ] Verify keyboard accessibility, contrast, resizing, and narrow layouts.
- [ ] Run an end-to-end investigation from parallel answers through directed review and synthesis.

### 20. Documentation and release gates

- [x] Replace design-only setup notes with verified installation and launch instructions.
- [x] Document supported platforms, providers, models, and capability limitations.
- [ ] Document conversation policies with directed, parallel, review, and relay examples.
- [x] Document response eligibility, timeout behavior, and late-answer handling.
- [ ] Document human controls and recovery from uncertain delivery.
- [ ] Document data storage locations, credential handling, retention, and provider transmission.
- [ ] Add troubleshooting for rate limits, missing responses, stale context, and interrupted sessions.
- [ ] Publish developer setup, architecture, schema, adapter, and migration documentation.
- [ ] Produce versioned builds and verify installation, upgrade, and uninstall behavior.
- [ ] Confirm uninstall preserves or removes user data only according to explicit choice.
- [ ] Review license notices and dependency distribution requirements.
- [ ] Complete the security and recovery gates for the selected release scope.
- [x] Confirm every advertised capability is implemented and validated or clearly marked unavailable.
- [x] Record known limitations and unresolved defects in release notes.
- [ ] Tag the reviewed release and archive its reproducible build inputs.

### 21. Live-connection release follow-through

- [x] Implement editable provider/model bindings for the existing three participants.
- [x] Load optional local environment files while keeping keys in the service.
- [x] Discover model IDs and provide a real generation-based connection check.
- [x] Support a local Ollama server and explicit OpenAI-compatible endpoints.
- [x] Reject credential-bearing URLs and automatic HTTP redirects.
- [x] Record requested provider/model settings in immutable invocation snapshots.
- [x] Stream live replies with visible failures and no simulation fallback.
- [x] Persist automatic relay steps and validate their stop/recovery behavior.
- [x] Verify configuration, connection check, relay, and targeted follow-up through the browser using labeled protocol fixtures.
- [ ] Run credentialed live smoke tests for OpenAI, xAI, and Gemini and record exact verified model IDs/date.
- [ ] Verify the Ollama adapter against a real installed model, beyond HTTP protocol fixtures.
- [ ] Verify selected third-party OpenAI-compatible servers with real generation requests.
- [ ] Add automatic provider-specific reconciliation for uncertain accepted requests before considering automatic retries.
- [ ] Add OS-backed credential storage and a graphical credential management flow.
- [x] Preserve complete participant configuration revision history, including revisions never used in an invocation (new edits from v0.5.0; recover known legacy configurations).
- [ ] Extend model catalogs with provider-specific pagination and text-generation capability filtering.
- [ ] Implement the separate signed-in browser-session transport and verify supported website/model combinations.

### 22. v0.3.0 bounded agent discussions

- [x] Add an explicit human grant selecting one coordinator, a peer-round limit, and a turn allowance.
- [x] Reserve the entire discussion allowance before its first invocation and release unused turns on completion/cancellation.
- [x] Count coordinator decisions, peer answers, correction attempts, and explicit retries against that allowance.
- [x] Let the coordinator choose one or both peers and all/any/quorum collection through strict structured actions.
- [x] Validate authorship, permitted peer IDs, distinct recipients, field limits, quorum, exact reply links, thread scope, and visible context before dispatch.
- [x] Keep peer responses and quoted routing text from acquiring delegation permission.
- [x] Require provider completion before accepting or dispatching a structured decision, keeping partial action JSON out of the transcript.
- [x] Request native JSON Schema output through the implemented OpenAI, xAI, Gemini, Ollama, and compatible-server adapters and verify their protocol envelopes with fixtures.
- [x] Offer one bounded correction for an invalid completed decision, with the original attempt retained and no automatic replay for network/provider failures.
- [x] Freeze shared peer context and the exact collected answer set before coordinator continuation.
- [x] Preserve targeted follow-ups, individual peer answers, provider usage, and accepted actions for inspection/export.
- [x] Enforce finite peer rounds and turn capacity, detecting repeated questions to the same recipients.
- [x] Cancel unfinished late respondents when the coordinator finishes.
- [x] Add per-discussion Stop while retaining unrelated room work and releasing unused reservations.
- [x] Persist discussion deadlines, grants, barriers, actions, and queued continuations for pause/stop/restart recovery without automatic replay.
- [x] Verify a six-turn discussion with parallel peers and exact-message review through the browser using labeled live HTTP protocol fixtures.
- [x] Verify discussion controls, reload, plain-text rendering, and narrow layouts through the browser.
- [ ] Verify structured discussions against credentialed OpenAI/xAI/Gemini accounts and record exact model IDs/date.
- [ ] Verify structured discussions against a real installed Ollama model and selected compatible servers.
- [ ] Add explicit structured-output capability discovery or a dedicated coordinator capability test.
- [ ] Add nested peer delegation with dependency-cycle detection and independent grants.
- [ ] Add fair conference turn allocation and safe coordinator handoff during an active discussion.
- [ ] Extend agent-authored contributions beyond questions/final results to the full typed-message design.
- [ ] Add human correction/interjection policies that explicitly revise a discussion’s frozen context and obligations.
- [ ] Add semantic progress checks and stalled-discussion detection beyond exact repeated questions and wall-clock deadlines.

### 23. v0.4.0 settings and deletion

- [x] Add a dedicated, directly addressable Settings page with desktop and narrow layouts.
- [x] Keep theme preferences in the browser and preserve open composer drafts when visiting Settings.
- [x] Persist and strictly validate workspace, deadline, collection, synthesis, and discussion defaults.
- [x] Apply defaults to newly created workspaces and newly opened composers without changing active work.
- [x] Support explicit restore-to-defaults in the form, requiring Save to persist the restored values.
- [x] Edit workspace names, objectives, and turn limits while retaining historical invocation settings and consumed usage.
- [x] Expose participant/model/role/connection configuration from Settings without sending credential values to the browser.
- [x] Add named workspace deletion from the sidebar and Settings, with explicit confirmation and Cancel.
- [x] Add named thread deletion from the sidebar, with explicit confirmation and Cancel.
- [x] Atomically cascade thread deletion through its messages, response sets, attempts, snapshots, relays, and discussions.
- [x] Remove deleted source copies from surviving snapshots and identify those snapshots as redacted.
- [x] Cancel dependent work and prevent retries from reusing deleted context, while retaining unrelated work and historical answers.
- [x] Abort deleted work and probes, ignore late provider events, and free dispatch capacity during transport cleanup.
- [x] Release unused reservations without refunding consumed turns or resuming paused workspaces.
- [x] Preserve monotonic message sequences and minimal replay tombstones across deletion/restart.
- [x] Propagate deletion to other open views and provide a usable empty state after deleting the final workspace.
- [x] Seed the welcome workspace once so deleting all workspaces remains effective after service restart.
- [x] Migrate v1 databases additively to v2 with existing room data retained and preferences stored separately.
- [x] Verify settings, cancellation, deletion scope, source redaction, late events, replay prevention, persistence, and browser management flows.
- [ ] Add separate workspace/group hierarchy and membership if multiple rooms need to share a workspace.
- [ ] Add archive/restore, bulk deletion, thread renaming, and searchable workspace/thread management (archive/restore, renaming, and search complete in v0.6.0; bulk deletion remains).
- [ ] Add encrypted backups, restoration, retention scheduling, and a documented disk-erasure policy.
- [ ] Add OS-backed credential management and graphical credential editing (also tracked in the live-provider checklist).

### 24. v0.4.1 Node 26 compatibility

- [x] Accept Node 26.10 and newer 26.x releases while retaining the supported Node 24 range.
- [x] Select Node 26.10.0 for nvm and update Node TypeScript declarations and the dependency lockfile.
- [x] Allow the pinned esbuild installation hook for the npm version bundled with Node 26.10.
- [x] Verify installation, type checking, formatting, the production build, SQLite persistence/recovery, provider fixtures, and Chromium workflows under Node 26.10.0.
- [x] Check Node 24.19.0 and 26.10.0 across Linux, Windows, and macOS in CI, with Chromium coverage for both runtimes on Linux.

### 25. v0.5.0 participant rosters

- [x] Create workspaces with 1–8 participants while retaining the three-participant welcome workspace.
- [x] Assign participant identities on the server and support independent instances with duplicate display names.
- [x] Add participants in Settings without invoking a provider; start new identities in simulation.
- [x] Deactivate/reactivate participants while retaining messages, settings, revisions, and consumed usage.
- [x] Keep at least one active participant and count inactive identities toward the eight-participant limit.
- [x] Validate strict roster commands, workspace scope, sessions, Host, and Origin before mutation.
- [x] Block roster/configuration edits during pending jobs, unfinished or blocked workflows, and workspace connection probes.
- [x] Restrict new recipients, synthesizers, relay steps, and coordinators to active participants.
- [x] Freeze discussion peer grants and prevent model actions from reaching inactive or newly added participants.
- [x] Reject retries requiring inactive participants without consuming turns, and preserve original retry model/objective/roster bindings.
- [x] Cancel an unavailable queued participant defensively without invocation or consumed turns.
- [x] Record every new configuration revision atomically, including unused edits and activation changes.
- [x] Recover only known legacy configurations and disclose unknown edit times without inventing missing history.
- [x] Preserve historical author labels in transcripts, source contexts, response sets, workflows, and Markdown exports.
- [x] Distinguish duplicate names in recipient controls and answer labels while routing exclusively by identity.
- [x] Preserve open drafts across roster changes, prune inactive recipients/relay steps, repair quorum choices, and keep additions as observers.
- [x] Verify single-participant, larger-roster, cross-view, narrow-layout, restart, and active-routing flows under Node 24 and 26.
- [ ] Support rosters above eight identities with explicit capacity, context-size, and interface policies.
- [ ] Add participant removal with documented historical attribution, workflow, and retention behavior.

### 26. v0.6.0 workspace organization

- [x] Persist additive workspace archive metadata while keeping existing room documents and database versions readable.
- [x] Add named archive and restore confirmations with cancellation in Settings and archived conversations.
- [x] Require queued/running work, unfinished or blocked workflows, and workspace connection probes to finish or stop before archiving.
- [x] Preserve all retained conversation records, participant history, and consumed turns while archived.
- [x] Reject archived edits, sends, retries, control commands, roster changes, thread deletion/renaming, and connection tests before mutation or invocation.
- [x] Keep archived history available for reading, searching, context inspection, export, and confirmed whole-workspace deletion.
- [x] Restore into a paused state without replaying cancelled/failed work or starting a provider request.
- [x] Defensively prevent dispatch in archived records even if a stale status says running.
- [x] Retain archives across disk and production-service restart without reseeding the welcome room.
- [x] Search workspace names/objectives with active, archived, and all views and clear/no-match controls.
- [x] Search thread names and retained message text within the selected workspace using literal case-insensitive matching and bounded plain-text previews.
- [x] Preserve selected conversations and draft text while searching and reconciling archives from other views.
- [x] Rename threads with strict workspace scope and bounded names, including during active work, without changing IDs, messages, reply links, context, obligations, or usage.
- [x] Include current thread names and archive metadata in Markdown exports while retaining stable IDs and original author bindings.
- [x] Verify archive/restore, retry bindings, search scope, deletion reconciliation, safe previews, narrow layouts, cross-view drafts, and restart under Node 24 and 26.
- [ ] Add bulk archive/restore/deletion with explicit scope, previews, and cancellation.
- [ ] Add optional global message search across workspaces with visibility checks, pagination, and explicit result locations.
- [ ] Add thread archive/restore, ordering, saved views, and richer query syntax after their behavior is specified.

### 27. v0.7.0 message presentation

- [x] Render CommonMark/GFM headings, emphasis, lists, quotes, tables, tasks, inline code, and code blocks through React elements.
- [x] Keep message headings below the workspace heading and task checkboxes disabled.
- [x] Escape raw HTML and reject executable embedded content without enabling raw-HTML or MDX plugins.
- [x] Limit links to explicit HTTP(S) origins without credentials, control characters, or ambiguous backslashes; retain blocked labels.
- [x] Open permitted links only on user action in a new tab with opener and referrer isolation.
- [x] Render image alt-text placeholders without image loads, preloads, or provider requests.
- [x] Preserve exact stored bodies in source views, whole-message copies, frozen context, literal search, and exports.
- [x] Copy individual code blocks without fences or interface text and document parser-normalized line endings.
- [x] Keep streamed text literal until the attempt ends and preserve partial-result statuses after formatting.
- [x] Capture copy text at the click and avoid claiming later streamed text was already copied.
- [x] Handle missing/denied clipboard access with visible feedback, selectable source, and a later retry; never read the clipboard.
- [x] Allow source viewing and copying in archived workspaces without conversation mutations or invocation.
- [x] Load the formatter separately, memoize unchanged formatted bodies, and preserve usable source/controls if formatting fails.
- [x] Keep code blocks and wide tables scrollable and keyboard-focusable within narrow layouts in both themes.
- [x] Verify HTML/link/image safety, real clipboard writes, failure paths, streamed HTTP answers, exact context/export retention, archive/reload, and both supported Node runtimes.
- [x] Isolate each browser run in a fresh temporary database so previous test history cannot change its starting state.
- [x] Reconcile accepted sends with refreshed workspace history before selecting the new thread or enabling another send, while preserving a newly typed draft.
- [ ] Add optional syntax highlighting with bounded language detection and no executable grammars.
- [ ] Add safe mathematical typesetting and diagram presentation after defining resource and rendering policies.
- [ ] Add scoped internal footnote navigation without duplicate document IDs or unsafe relative links.
- [ ] Implement authorized attachment storage and previews before enabling inline image/attachment rendering.
