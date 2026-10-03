# LLM Recovery Prompt

Updated: 2026-10-03 (UTC). Application checkpoint: v0.15.0.

This file is a durable handoff for a new chat or another LLM. Paste the whole file when repository access is unavailable, or use the launch prompt below when the receiving LLM can read GitHub. The current repository is authoritative if it has advanced beyond this checkpoint.

## Launch prompt

```text
Continue development of AI Conversation Room at https://github.com/drkevorkian/AIB_LLM_Built.
Before coding, read LLM_Recovery_Prompt.md from current main, then README.md, CONTRIBUTING.md, and the relevant architecture decisions. Verify the saved checkpoint against current main and preserve existing work. Continue with one bounded iteration from the remaining README TODOs, validate it, update the recovery file, and publish through the authorized GitHub connection. Keep me informed of actual progress. If execution stalls or goes offline, allow at most two short recovery attempts, then stop dependent work and report what is saved, verified, pending, and blocked. Do not repeat an hours-long recovery loop.
```

## Project and original intent

You are resuming an existing working application, not starting a new framework. The repository is `drkevorkian/AIB_LLM_Built`; its working product name is AI Conversation Room. It was inspired by AI Bridge, but it is a separate project. Do not edit `drkevorkian/AI_Bridge` for this task.

The goal is a local graphical workspace in which independent LLM identities can receive directed questions, answer parallel requests, exchange messages in selected relay orders, and conduct bounded coordinator discussions under human control. Visibility, recipients required to answer, and scheduling are separate concepts. Preserve separate attributable answers, original disagreements, stable identities, explicit reply links, and frozen context.

The chosen stack is TypeScript with a React/Vite client, a Node.js server, and SQLite persistence. Keep the existing architecture. Node 26.10 support, a Settings page, and workspace/thread deletion are explicit user requirements and already implemented.

## Saved checkpoint

- Main baseline: `e2db21740f9f2c0b89d24aca58211bdcf0f68485`, v0.14.0, tree `19bd3ee90b67539f1f8b65c99789f8fb1229228d`. Its automatic full-main CI `37013780370` was independently confirmed successful before this iteration.
- Branch: `main`. Application version: `0.15.0`.
- Most recent application/test commit: `964be1404dab860525c08b76b5c5272252ab6096` — `Match concurrency browser fixture to Ollama chat protocol`. The preceding feature commit `560b1d78eb7af0214e334dc0d46340a3df765d13` implements scoped limits and their regressions.
- Application/test Git tree: `afbc8ac9c8de1df96c3bc4beeed9e6bbccecdd85`.
- Validation branch: `codex/v0.15.0-scoped-concurrency-20261003`.
- Exact application/test CI: https://github.com/drkevorkian/AIB_LLM_Built/actions/runs/37095314133
- Exact-source CI completed successfully for commit `964be1404dab860525c08b76b5c5272252ab6096`: all six supported platform/runtime jobs passed 255 source tests, checks, builds, and zero-vulnerability production audits. All 56 Chromium tests passed under both Ubuntu runtimes.
- The bounded v0.15.0 iteration is complete and published. No unfinished feature patch, pending required application check, publication blocker, or selected v0.16.0 feature is carried over.
- This recovery-only document follows the verified application/test commit. Its automatically triggered main CI is a separate full-tree check; the application-source run does not claim to verify the newer documentation tree. Inspect current main's run independently when resuming.
- The user's scope asks to finish 1–5 existing checkboxes per bounded iteration. Exactly one original entry is completed in v0.15.0: section 6's per-provider and per-workspace concurrency limits. All 424 original entries are retained, without additions/removals; 180 remain unchecked. No second feature has been started or selected for v0.16.0.
- The user requires every README checklist item to be fully completed and validated before version 1. README, CONTRIBUTING, and this handoff retain that gate; versions stay on 0.x, including optional and verification/security/packaging/release work. Compound items with unfinished work remain unchecked. Do not remove or defer items to bypass the gate.

Current goal completed: bounded v0.15.0 implementation, validation, main publication, and recovery update, including one existing README checkbox. No second feature has been started. Read current main and choose the next bounded unfinished item.

## Working behavior already implemented

- Workspaces with 1–8 current independent participant identities, including inactive identities and duplicate display names. Settings supports adding, editing, deactivating, reactivating, and confirmed permanent removal. Removed identities/settings remain read-only, current slots can be reused only with fresh IDs/ordinals, and revisions/historical author/model bindings are retained.
- Directed messages, parallel answers with all/any/quorum collection, and optional synthesis after the required answers finish.
- Fixed relays with 1–12 hops, including repeated identities and orders such as A → C → B → A.
- Coordinator discussions with strict validated actions, frozen peer grants, 1–10 peer rounds, and a reserved 2–50 turn allowance. Invalid completed decisions permit one bounded correction; network failures do not receive that correction retry.
- Persistent history, threads, response sets, streamed answers, frozen context inspection, reported token usage, provider request IDs, and Markdown export.
- Per-participant queues with running/numbered queue inspection, source-thread links, dispatch holds, shared-slot occupancy, and separate synthesis/coordinator response prerequisites. Four shared service slots and one active request per participant remain, with saved provider/workspace concurrency limits and visible scoped occupancy. Pause/resume/stop, explicit bounded retries, turn accounting, and restart recovery remain intact.
- Safe Markdown/code/source presentation and exact message/code copying, with labeled message-scoped footnotes and optional bounded JavaScript/TypeScript/JSON/Python highlighting.
- Settings for themes, conversation defaults, workspace name/objective/turn/request limits, provider request limits, and participant connections.
- Desktop pointer/keyboard panel sizing with browser width preferences, Settings reset, responsive fitting, and independently collapsible navigation/participants on narrow screens.
- Explicit greeting and coordinator capability probes, sharing scheduling limits/cancellation and leaving conversation state/turn usage unchanged.
- Confirmed workspace/thread deletion with scoped cancellation, removal of copied deleted source context, late-event rejection, and persistence of the empty state after the final workspace is deleted.
- Workspace archive/restore, thread renaming, literal workspace metadata search, and scoped thread/message search. Restoring an archive leaves it paused and does not replay work.
- Confirmed atomic archive/restore/deletion of 1–25 exact selected workspaces, with named previews, cancellation before confirmation, stale-preview rejection, and unchanged unrelated work.
- Simulated providers plus implemented API adapters for OpenAI, xAI/Grok, Gemini, Ollama, and OpenAI-compatible servers.

Archive, deletion, retry, roster, search, and context guarantees are described in the architecture decisions. Inspect those documents before changing the relevant behavior.

## Current iteration: scoped request concurrency

v0.15.0 adds strict saved limits from 1–4 for all six provider kinds and each workspace. Provider kinds share allowances across workspaces, models, accounts, and endpoints; all OpenAI-compatible endpoints share one kind. Generations and greeting/coordinator probes share these scoped allowances, four global managed slots, and one active request per participant. Defaults and missing legacy fields read as four. Room schema 1 and SQLite schema 2 remain; no destructive migration or dependency/runtime change occurs.

Generation occupancy captures the provider from the frozen invocation binding, including retries after current connection edits. Probe occupancy captures the saved binding. Limits are current dispatch policy, not frozen context or grants. A hold is checked before durable claims and leaves room revisions, messages, attempts, history, and turn usage unchanged. Scan other eligible scopes, but never bypass an earlier held job for the same participant using a later provider binding. Deadlines still expire under the existing contract.

Provider limits can change during active requests. Lowering drains existing occupancy without cancellation/retry/refund; new starts wait until below the new allowance. Raising may dispatch already authorized queued work on the next pump. Neither edit resumes paused workspaces or initiates probes. Workspace request edits keep the existing pending-job/workflow/probe and archive locks. A terminal stopped transport can drain under a changed workspace cap.

`providerConcurrency` is a strict complete six-kind map in app settings. Authenticated `PUT /api/settings/provider-limits` saves only that map against current conversation defaults. `GET /api/settings` returns full settings; older defaults-only PUT bodies preserve the saved map. Client defaults saves omit the map, so dirty defaults and Restore defaults cannot reset provider policy after another view edits it. `maxConcurrentRequests` is additive in creation/workspace settings and optional in legacy Room records. Omitted workspace edit fields retain the saved cap. Native labeled numeric controls enforce bounds and retain unsuccessful edits; existing token, Host, Origin, cross-site, method, body-size, and SQLite rollback guarantees apply.

Ordinary completion, failure, and Stop retain managed capacity through provider transport cleanup. Whole-workspace/thread deletion preserves immediate local release after commit and abort; do not undo the already checked deletion contract. Deleted probes disappear from accounting even while their exact AbortController metadata is awaiting cleanup. Bulk preview bindings to exact probes/transports remain unchanged. Limits govern locally managed requests, not physical remote processing, cancellation, provider rate limits, or billing. Independent services, external submissions, and remote execution after abort are outside accounting.

RoomActivity keeps its original global capacity object and adds workspace occupancy, relevant provider-kind occupancy, and workspace/provider capacity blockers. Include kinds used by current identities or queued/running frozen jobs. Other workspaces contribute anonymous numeric counts only, never foreign identities, titles, bodies, models, endpoints, or credentials. Inspection remains read-only, and settings notifications refresh other open views without changing a room revision or remounting drafts.

Read `docs/architecture/0016-scoped-concurrency.md`, `docs/releases/0.15.0.md`, `tests/concurrency.test.ts`, and `tests/ui/concurrency.spec.ts` with ADRs 0002/0005/0009/0010 before extending this behavior. Only the original scoped concurrency checkbox is completed, with required CI passed. Fair queues, priorities, distributed workers, rate/token/cost budgets, broader accessibility, real provider verification, and every other unfinished README item remain open.

## Previous iteration: confirmed participant removal

v0.14.0 adds **Remove** in Settings for each exact current identity. The native confirmation shows workspace title/ID, participant ID/duplicate-name label, retained-message/configuration counts, and the effects/retention policy. Focused Cancel, Escape, or close before submission leave the workspace unchanged. Once submission begins, cancellation/closing is held. A known rejection disables the old confirmation and requires refreshed review. A lost/network/unknown response says removal may have completed and requires **Close and refresh participants**; never automatically repeat an ambiguous destructive command. The request has a 15-second abort signal; existing session reauthentication only retries an authentication rejection before command execution.

`DELETE /api/rooms/:roomId/participants/:agentId` accepts only a strict nonnegative safe-integer `{expectedRevision}` bound to the reviewed workspace. Existing authentication, Host, Origin, cross-site, method, body-size, scope, and security-header checks remain required. Unknown/cross-workspace/already removed identities, malformed/extra fields, or later workspace revisions fail without mutation. Names and client-supplied metadata cannot change the target or grant authority.

Removal requires an open workspace, at least one active identity afterward, no queued/running work, no unfinished relay/discussion obligations, no workspace connection probe, and no terminal request still closing its transport. Pause does not release obligations. Explicit Stop follows existing cancellation policy; wait for actual cleanup before a fresh review. Guards include an already invalid zero-active record. Removal does not cancel work, invoke a provider, consume/refund turns, or resume a workspace.

One SQLite transaction sets server-owned `removedAt` and `active: false`, increments the participant configuration revision, preserves the complete revision, appends `agent.removed` audit, and advances the workspace revision. Write failure rolls back the entire change; unrelated workspaces are unchanged. `room.agents` remains an append-only retained registry. Current capacity excludes removed records but includes inactive ones, with a maximum of eight. New replacements start active in simulation at revision zero with fresh IDs and never-reused append ordinals. Generated-ID collisions are rejected. Legacy current records recover their known array ordinal without modifying old snapshots/revisions; their missing historical edit times remain unknown.

**Removed participants** exposes read-only retained identity/settings/history. Original messages, author labels, replies/source provenance, jobs, requests, workflows, frozen snapshots, exports, and usage are preserved. Removed identities cannot be edited, activated, deactivated, probed, addressed, or included in new synthesis/relay/coordinator/peer grants, even if stale data says `active: true`. Defensive dispatch cancels an unavailable queued identity before invocation/turn use. Queue inspection projects only current identities.

New questions omit removed roles/connections from the roster but can include retained room-visible conversation. Retry checks all original required recipients/synthesis/relay/discussion grant identities; removal of a required identity rejects retry before reservation/invocation. A same-named replacement cannot inherit the old identity or obligations. Otherwise eligible retries preserve the complete original frozen roster, including removed observers, and original objective/settings/context. Do not rewrite old snapshots to make retries appear current.

Other views retain drafts and explicit thread choices, prune unavailable selections/relay choices, repair existing quorum/synthesis/coordinator choices, clear removed reply targets, and close a removed identity's configuration form. New replacements remain unselected until explicitly chosen. Historical removed replies remain disabled with an accurate explanation. Thread deletion retains its existing conversation/source-redaction rules; participant configuration history remains until whole-workspace deletion. Removal is not privacy erasure, external-backup cleanup, provider-submission retraction, or forensic disk erasure; prior text/frozen retries may still reach a provider.

Read `docs/architecture/0015-participant-removal.md`, `docs/releases/0.14.0.md`, `tests/participant-removal.test.ts`, and `tests/ui/participant-removal.spec.ts` alongside ADRs 0005/0006/0007 before changing these guarantees. No dependency/runtime/schema/license/provider-permission changes are included. Membership changes during pending workflows, larger current rosters, groups, pagination, broader accessibility/retention audits, and credentialed provider verification remain open.

## Earlier iteration: confirmed bulk workspace management

v0.13.0 adds **Manage workspaces** beside the workspace list. Native checkboxes identify each exact workspace ID separately, including duplicate names. Literal name/objective search and active/archived/all filters clear the selection when changed; hidden rows cannot silently enter a preview. There are no wildcard scopes or automatic future selections. The maximum batch is 25 current workspaces.

A read-only named preview lists the exact IDs, titles, revisions, archive state, thread/message counts, consumed turns, queued/running jobs, pending workflows, connection probes, and open transports. It explains unchanged targets and archive blockers. It excludes objectives, participant roles, message/context bodies, endpoints, raw provider errors, and credentials. Cancel receives focus; Escape, close, and Back to selection abandon the preview before confirmation. Drafts and the conversation remain mounted through selection, cancellation, archive, and restore. Deleting the selected workspace uses the existing fallback/empty-state rules.

The authenticated POST endpoints `/api/workspaces/bulk/preview`, `/api/workspaces/bulk/confirm`, and `/api/workspaces/bulk/preview-cancel` retain existing session, Host, Origin, cross-site, method, body-size, and security-header protections. Strict schemas reject empty/duplicate/oversized or unknown workspace selections and extra fields. Preview takes an action and exact ordered IDs; confirmation/cancellation accept only a UUID token, never a client-supplied replacement action or target list.

Each five-minute one-use preview is transient, server-owned, and bound to selected revisions and the actual connection-probe/transport instances. At most 50 previews are retained; expired/oldest records are removed and service restart/shutdown clears all tokens. Selected data changes, removal, or probe/transport start/end/replacement require an explicit fresh preview; unselected changes do not expand or invalidate the scope. Confirmation consumes the token before validation or writes, including on failure. Mutating a returned preview cannot change the server's saved authority.

`RoomStore.applyBatch` uses a synchronous SQLite `BEGIN IMMEDIATE` transaction. It loads and validates every target before writing, applies revision-checked writes, leaves identical no-op records unchanged, and commits everything or rolls back all rows, timestamps, revisions, and audit entries. Any changing archive target with pending jobs/workflows or connection probes blocks the entire batch. Archive retains history/usage and pauses targets; restore leaves restored workspaces paused without replay/retry/refund, while already active workspaces remain exactly unchanged. No provider is invoked by archive/restore.

Bulk deletion commits all selected row removals before aborting any selected request or probe. Existing cancellation, released occupancy, and late-event rejection apply; unrelated rooms/work are untouched. Deleting the last workspace remains empty after restart. Deletion is logical app-record removal, not forensic erasure, provider submission retraction, external backup deletion, or a billing refund.

Cancellation ends when confirmation starts. Close/Escape/Back/Cancel are held while confirmation is in flight; a committed action cannot be undone. Known rejection clears the preview and requires explicit review. An unknown/lost response disables new previews and requires **Close and refresh workspaces** to inspect authoritative state. Never automatically retry an ambiguous destructive operation. Abandoned preview reads are aborted and known preview tokens are cancelled with a bounded request; token expiry/restart remains the fallback.

Read `docs/architecture/0014-bulk-workspaces.md`, `docs/releases/0.13.0.md`, `tests/bulk-workspaces.test.ts`, and `tests/ui/bulk-workspaces.spec.ts` alongside ADRs 0005/0007 before extending this behavior. No dependency/runtime/schema/license changes are included. Thread batches, backups/retention, groups, full accessibility, and large-history audits remain open.

## Earlier iteration: optional bounded code highlighting

v0.12.0 keeps code plain by default and adds an explicit native per-block toggle with `aria-pressed`, an application-owned code target, and Enter/Space activation. Only explicit case-insensitive fences select a language: `javascript`/`js`, `typescript`/`ts`, `json`, and `python`/`py`. Labels are bounded to 50 characters; no content is guessed and prototype-property names cannot select a language. Unlabeled, indented, and unsupported code stays plain. Unsupported labeled blocks retain a disabled toggle, a fixed explanatory notice, and exact code copying.

The small application-owned scanner emits offsets and fixed categories for plain text, keywords, strings, comments, numbers, JSON property names, and punctuation. React renders escaped source slices in application-owned spans, without generated HTML, source properties, executable grammar plugins, code evaluation, imports, remote resource loads, or new dependencies. This is approximate lexical presentation, not syntax validation or a full parser; regex literals, template interpolation, Python prefixes, contextual keywords, and semantic types are not fully parsed. Unsupported HTML, JSX/TSX, shell, and other languages are not inferred.

Each block is limited to 20,000 UTF-16 code units, 1,000 lines, and 2,000 coalesced token runs, including plain runs. CRLF counts once; CR, LF, Unicode line separator, and Unicode paragraph separator are boundaries, and a trailing break adds no empty line. The forward-moving scanner has fixed patterns and no recursion. Above a limit or if highlighting fails, the entire parsed code remains plain with a fixed notice, without truncation or a highlighted prefix. These limits bound highlighting work and output, not the whole Markdown parser or history rendering.

Choices last only for mounted blocks and their exact text/language, reset after source/formatted toggles or reload, and survive theme changes. They never persist preferences, change room data, consume turns, invoke providers, or alter routing. Copy code uses the complete original parsed code independently of spans; the existing documented parser normalization of line endings/final newlines remains. Copy message, source, stored bodies, frozen context, literal search, and exports retain the original body. Streams stay literal until the attempt ends. Highlighting terminal partial answers retains failed status and disabled reply controls. Archives allow reading/copying without mutations. Formatter-module failure still exposes literal source and copying.

Six token colors reuse existing theme variables and meet normal-text contrast against the code background in both themes. This targeted check does not complete the broader accessibility/contrast, assistive-technology, touch-device, or large-history audit. There are no runtime-range, dependency, schema, provider, permission, or license changes.

Read `docs/architecture/0013-code-highlighting.md`, `docs/releases/0.12.0.md`, `src/client/code-highlighting.ts`, `src/client/CodeBlock.tsx`, `tests/highlighting.test.ts`, and `tests/ui/highlighting.spec.ts` alongside ADRs 0008/0012 before extending this behavior. Math, diagrams, attachments, broader accessibility, long-history performance, and the other unfinished README items remain open.

## Earlier iteration: safe footnote navigation

v0.11.0 adds native reference and backlink buttons to parser-generated GFM footnotes. A click or Enter/Space activation moves focus and scrolls immediately to the exact note or reference within that formatted message. Navigation does not change the URL, fragment, history, workspace/thread selection, draft, room revision, provider calls, or turns. References identify their note and occurrence, notes accept programmatic focus, backlinks target the exact reference, and the generated section has a labeled heading with visible focus styling.

`MessageText` owns a React namespace retained across source/formatted toggles. The formatter assigns numeric application-owned IDs instead of copying author labels or parser IDs. Identical labels in different messages stay separate. Repeated references have distinct backlinks; per-definition mapping correctly handles the parser ID collision between the second `[^a]` reference and the first `[^a-2]` reference. Long and Unicode labels never become DOM IDs. A reload may allocate new IDs; none are persisted or exported. Focus lookup stays inside the currently connected formatted-message root rather than querying the document.

Only parser-generated graph edges recognized by the presentation plugin become controls. Raw HTML and attribute imitations remain escaped text. Ordinary fragments, relative URLs, and unsafe schemes remain blocked, including authored links to an exact known application footnote ID. There is no generic fragment exemption. Protected absolute HTTP(S) links, unloaded image placeholders, inert code/tasks, the unchanged URL policy, and routing-looking text boundaries remain intact.

At most 100 referenced notes and 300 reference occurrences receive navigation controls in a message. Above either limit, all footnote navigation becomes inert labels with a readable application-authored notice; parsed notes and the exact source remain available. These limits bound interactive controls/metadata, not total Markdown nodes or large-history performance. Missing/malformed references remain text, unused definitions follow normal GFM omission, and cyclic references remain finite without automatic navigation.

Streaming and source views stay literal. Completed and terminal partial answers may format without changing their authoritative status; failed partial replies remain disabled. Formatter failure still retains literal footnote source, copying, and conversation controls. Stored bodies, Copy message, frozen context, search, and Markdown exports keep exact strings. There are no dependency/runtime/schema/permission changes. Broad accessibility/contrast, real assistive-technology/touch-device audits, math, diagrams, attachments, and history pagination remain open. Optional bounded highlighting is now implemented in v0.12.0; the broader audits remain unchecked.

Read `docs/architecture/0012-message-footnotes.md`, `docs/releases/0.11.0.md`, `src/client/message-footnotes.ts`, and `tests/ui/footnotes.spec.ts` alongside ADR 0008 before extending this behavior or upgrading the parser.

## Earlier iteration: panel layout

v0.10.0 adds two focusable desktop dividers, pointer capture, Left/Right 10 px steps (Shift 50), Home/End bounds, pixel value announcements, and visible focus. Escape, cancelled/lost capture, and Settings/compact transitions roll back unfinished drags. Completed drags and keyboard adjustments save to browser storage; these controls have no conversation authority.

Navigation spans 180–420 px and activity 230–480 px, with at least 400 px retained for the desktop conversation. ResizeObserver fitting temporarily reduces flexible side widths without rewriting saved preferences. An explicit adjustment after fitting saves the view's current side widths. Defaults retain the previous width breakpoints. At 1000 px or below, desktop widths/dividers yield to compact layouts and Hide/Show panel buttons. Mounted panels/composer retain drafts, selections, disclosure state, and existing send/refresh guards. Response status, workspace Stop, and Stop discussion stay in the conversation. Settings works with navigation collapsed and can reset widths/reopen compact panels.

`aib-panel-layout` stores only an exact version-1 object with bounded integer navigation/activity widths. Malformed, unsupported, or unreadable values use defaults. Storage write/removal failure keeps usable view sizing with an unsaved notice. Preferences belong to this browser origin; new/reloaded views read them, without live cross-tab synchronization. Compact collapse choices last only for the mounted view, while desktop always displays both panels.

The final v0.10.0 correction checks the live viewport before persisting a pointer release and cancels directly from the media-query event. Preserve the browser regression that releases immediately after crossing into compact layout.

Layout changes must never mutate room records, service defaults, attribution, context, grants, queues, provider lifecycle, or consumed/reserved turns. Dependencies/runtime/database versions are unchanged. The wider keyboard/screen-reader/contrast audit and real assistive-technology/touch-device review remain open. The original panel resizing/collapse checklist item is covered by this bounded feature; no broader accessibility checkbox is treated as complete.

Read `docs/architecture/0011-panel-layout.md`, `docs/releases/0.10.0.md`, `src/client/PanelLayout.tsx`, and `tests/ui/layout.spec.ts` before extending this behavior.

## Earlier iteration: participant queue inspection

v0.9.0 adds **Inspect queue** to each active participant card. It shows running generations and actual queued jobs in their stored per-participant order, exact source threads, frozen provider/model bindings, queue/start times, applicable collecting-response deadlines, and current dispatch holds. Sources are plain React text; selecting a source preserves the draft and uses the existing explicit thread-choice guard.

The authenticated `GET /api/rooms/:roomId/activity` is a transient read-only projection of the room and scheduler occupancy. It never mutates stored rooms, expires requests, invokes providers, reserves/consumes turns, dispatches, reorders, retries, or cancels work. It uses existing session/Host/Origin/scope/method checks. Anonymous global slot counts include other workspaces and probes without disclosing their identities or work. Message bodies, objective/role/context copies, endpoint URLs, raw errors, and credentials are excluded; thread titles remain authorized metadata and may derive from question text.

Synthesis and coordinator continuations still waiting for eligible peer responses appear under **Response prerequisites**, outside numbered queues. They use the saved all/any/quorum threshold, latest recipient attempt statuses, and frozen attribution. Failed, refused, interrupted, cancelled, and missing attempts do not count as completed. Explicit retries update the latest status; actual continuation creation or cancellation/deletion removes the prerequisite. Existing workflow/attempt cards retain other blocked relay/decision explanations. Do not invent queued future work.

Holds reflect pause/archive/stop/shutdown, inactivity, participant requests/checks, earlier queue entries, shared occupied slots, turn limits, ended discussions, and elapsed collecting deadlines awaiting scheduler cleanup. Closed response sets' old deadlines do not hold queued synthesis or late answers. Inspection does not enforce these holds or grant resumption; the original scheduler remains authoritative. Probe start/end and released generation slots broadcast transient notifications without recording history or changing revisions. A completed/aborted iterator still closing is shown as finishing request cleanup until its slot releases.

Client snapshots must match the selected workspace ID and loaded revision. Old aborted reads cannot replace another workspace's view. Disconnection marks last-observed data; failed reads remove old actionable details and offer explicit Refresh. Observation-time readiness is not a promise of start time, global fairness, or remote processing state. Keep native keyboard-focusable disclosure controls and bounded narrow layouts in both themes.

Header, local session, and startup labels now share `src/shared/version.ts`; keep it consistent with the package version. Dependencies, runtime ranges, persisted schema, grants, snapshots, accounting, and licenses are unchanged.

Read `docs/architecture/0010-participant-queue-inspection.md`, `docs/releases/0.9.0.md`, `src/server/activity.ts`, `src/client/ParticipantQueue.tsx`, and the new activity tests before extending this feature. Queue reordering/priorities, fair global allocation, timing estimates, broader dependency graphs, and pagination remain planned.

## Earlier iteration: coordinator capability tests

v0.8.0 adds **Test coordinator** beside **Test connection** in participant settings. A successful greeting does not prove the structured-output capability needed by Agent discussion. The new check sends one native structured decision request through the saved binding, with participant roles but no thread history or workspace objective. It has no peer grant and never schedules conversation work.

Success requires exactly one valid six-field finish action followed by explicit provider completion: nonempty body up to 20,000 characters, recipientIds [], policy all, quorum 1, replyTo null, and no extra fields. Asks, plain text, duplicate actions, malformed/oversized objects, refusal, incomplete streams, or unsupported protocols fail visibly. No automatic retry, correction, greeting fallback, or simulation fallback is permitted. Another click is an explicit new probe.

Both probe kinds use the same participant serialization, global request limit, roster/archive locks, deletion/shutdown cancellation, and the smaller of 30 seconds or the saved timeout. Unexpected error details, raw actions, and provider error bodies stay out of diagnostics. Neither probe stores messages/jobs/snapshots/workflows nor consumes room turns; provider charges may still apply.

Success identifies the requested provider/model, configuration revision, and test time. Simulation is explicit. These are temporary per-form results for that configuration/time; they do not establish every future discussion capability or a durable supported-model flag. An edit, another settings action, reopening, or reload clears feedback. Closing a view does not cancel its submitted probe; the service timeout still bounds it.

Empty-peer native output schemas now omit the empty enum and retain string items. Nonempty grants still use the permitted-ID enum. Independent engine validation enforces finish semantics and peer permissions; schema text never becomes a grant.

Read `docs/architecture/0009-coordinator-capability-tests.md`, `docs/releases/0.8.0.md`, and `tests/connections.test.ts` / `tests/ui/connections.spec.ts` before changing these guarantees. The original section 22 coordinator-test TODO is complete; capability catalogs and credentialed model smoke tests remain open.

## Earlier iteration: message presentation

v0.7.0 added CommonMark/GFM headings, emphasis, lists, quotes, tables, disabled task checkboxes, inline code, and fenced/indented code blocks. Each message supports formatted/source views and Copy message; code blocks support Copy code. Archived history supports these reading controls.

Rendering uses `react-markdown` 10.1.0 and `remark-gfm` 4.0.1. The formatter is lazy-loaded, unchanged bodies are memoized, and a per-message fallback retains readable source and controls if formatting fails. Streamed bodies remain literal until the attempt ends. Failed partial results remain readable with their authoritative status.

Preserve these boundaries:

- Stored bodies, source views, frozen context, search, and exports retain original strings. Whole-message copying captures the stored body at the click without author/status/interface labels.
- Code copying uses parsed code without fences; parser-normalized newlines or a final newline are documented.
- Clipboard writes happen only after explicit user clicks. Never read the clipboard. Missing or denied permission leaves selectable text and supports a later retry.
- Raw HTML remains escaped text. Do not enable raw HTML, MDX, executable code, or `dangerouslySetInnerHTML`.
- Images remain alt-text placeholders without remote loads or preloads. Authorized attachment handling is not implemented.
- Only explicit valid absolute HTTP(S) links without credentials, control/whitespace ambiguity, or backslashes are clickable. Relative links and executable schemes are blocked.
- Permitted links open on a user click with opener/referrer isolation. Formatting and routing-looking text never grant execution or scheduling authority.
- Code and wide tables remain bounded, keyboard-focusable, and scrollable within narrow layouts.

Read `docs/architecture/0008-message-presentation.md` and `docs/releases/0.7.0.md` for the full contract.

## Send and selection fixes that must remain intact

A fast second send could previously select a newly created thread before refreshed history contained it. Selection reconciliation could then clear the thread and accidentally create another one.

The final fix keeps the composer in an Updating state until `onSent` has awaited refreshed workspace history. A new draft can be typed during this refresh, but another send is held until authoritative history is applied. Room/thread refs prevent an old workspace response from changing a new workspace's selection and preserve an explicit thread choice made while refreshing. Failed refreshes do not resend an acknowledged message.

v0.8.0 additionally records explicit thread-selection changes, including repeated clicks on All messages, from before submission through acknowledged history refresh. A request completing afterward cannot replace a newer thread/All messages/reply choice. Workspace changes also invalidate that selection generation. Preserve the held-refresh and held-acknowledgment regression cases.

Keep the deterministic delayed-refresh browser regression. The thread deletion test deliberately selects All messages before counting messages across separate threads. Message sequence styling uses `.message-sequence`; broad span selectors collide with copy-feedback elements.

Each Playwright run now uses its own fresh temporary database. Do not reuse accumulated browser test data or point tests at normal application data.

## Verification and honest limits

Local Node 24.19.0 passed locked installation, TypeScript checks, all 255 service/engine/provider/rendering tests, formatting, production client/server builds, `git diff --check`, and a zero-vulnerability production dependency audit. Playwright discovery lists 56 tests in nine files; listing alone is not a browser pass. Package/shared labels agree on 0.15.0, and the lockfile changes only root application version metadata. Automated comparison confirms all 424 original README entries remain in their original order/text, exactly one original checkbox changes, and 180 remain unchecked.

Twenty-one new service/store/HTTP tests cover strict bounds, legacy defaults and omitted-field preservation, restart/schema continuity, workspace/provider shared dispatch, independent-scope progress, anonymous no-write inspection, provider drain/raise behavior, both probe kinds, generation/probe rejection, failed/refused/empty probes, frozen retries and per-participant ordering, normal completion/Stop/deletion cleanup and late-output rejection, pending/archive/shutdown guards, forced SQLite rollback without successful notifications, and authenticated Host/Origin/cross-site/method/body/workspace boundaries.

Four new isolated Chromium flows bring verified browser coverage to 56 tests: 311 distinct source/browser tests. They cover durable settings/restart, conversation-default and draft preservation, native bounds and failed save retention, narrow themes, workspace queue holds and pending edit guards, and another workspace's held synthetic probe with cross-view provider-capacity updates. Existing routing/workflow/queue/roster/removal/panel/footnote/highlighting/clipboard/archive/deletion/bulk and acknowledged-send selection regressions remain required.

The known local Chromium executable is truncated (30,354,432 bytes with missing ELF sections expected beyond 209 MB) and previously crashed with SIGSEGV even for `--version`. This iteration did not retry it or download replacements. Local browser validation remains unavailable; do not reuse its path or claim a local UI pass. No local Node 26 run is claimed. Required browser/runtime verification uses the exact GitHub CI source tree.

Final exact-source CI `37095314133` completed successfully for commit `964be1404dab860525c08b76b5c5272252ab6096`, tree `afbc8ac9c8de1df96c3bc4beeed9e6bbccecdd85`. Decoded logs independently confirm all six jobs passed 255 source tests, TypeScript/format checks, production builds, and zero-vulnerability production audits on Node 24.19.0/26.10.0 across Linux, Windows, and macOS. Both Ubuntu logs confirm all 56 Chromium flows passed, including the four new capacity flows: 311 distinct tests. Jobs are `111123926947` (Windows 26), `111123926953` (Ubuntu 26), `111123926991` (Windows 24), `111123927007` (macOS 26), `111123927048` (macOS 24), and `111123927051` (Ubuntu 24). Older runs and discovery alone do not verify this source. The recovery-only follow-up triggers a separate automatic main CI; its outcome must not be inferred from the source run.

The initial feature candidate `560b1d78eb7af0214e334dc0d46340a3df765d13` / CI `37095228231` used an incorrect browser-only Ollama fixture endpoint/envelope. Source review caught it while CI was starting: the application uses `/api/chat` with `message.content`, while the new fixture initially used `/api/generate` and `response`. The corrected fixture matches the existing chat protocol and explicit stop completion; scheduler behavior, assertions, and timeouts are unchanged. Only the corrected final source can satisfy required browser verification.

The execution connection remained available; zero stalled-execution recovery attempts were needed in this iteration. No unresolved execution/validation blocker remains. Restoring the expired older scratch snapshot required smaller file-fetch batches and one exact decoded Git-blob repair for a truncated stylesheet; the resulting complete tree matched main before any coding. Those resolved read diagnostics and the browser-fixture correction are not execution-stall recovery attempts. Preserve the maximum of two short recovery attempts; do not poll a stalled connection or installer indefinitely.

Previously published v0.14.0 exact-source CI `37012407797` passed all six jobs, 234 source tests across Node 24.19.0/26.10.0 on Linux/Windows/macOS, and all 52 Chromium tests on both Ubuntu runtimes. Its recovery-only full-main run `37013780370` was independently confirmed successful before v0.15.0 development. Those older runs do not verify v0.15.0. Preserve the v0.14.0 focused removal cancellation and stable new-participant accessible labels, the v0.13.0 exact dropdown labels, and earlier clipboard/layout status scoping corrections.

The deletion browser regression waits up to ten seconds for the exact simulated request's authoritative stored synthesis completion before requiring an enabled reply. Preserve the completion assertion. Footnote/highlighting selectors retain the anchored All messages label including the displayed count. No existing assertions or timeouts were weakened for scoped concurrency.

No paid provider account or installed Ollama model was invoked or verified. New browser capacity streams use a held synthetic loopback NDJSON chat fixture with no installed model; provider kinds in controlled service tests likewise never call their real endpoints. Existing browser services clear cloud keys and use isolated data. Credentialed cloud/model smoke tests remain separate and require explicit authorization. Provider keys remain service-only. No project license has been selected; the package remains private, without an npm publication or license grant.

Signed-in ChatGPT/Grok/Gemini website transport remains unimplemented. This application uses APIs and simulation. Anthropic, unrestricted conferences, nested delegation, attachments, math, diagrams, persistent capability catalogs, packaging, and other planned work remain open. Version 1 is prohibited until every README checkbox is fully implemented and validated.

## What to do next

Read the remaining README checklist and choose one new bounded feature or demonstrated bug after verifying current main. One possible next feature is safe mathematical typesetting: define allowed syntax, resource bounds, escaped/inert rendering, accessibility, exact source/copy/context preservation, and readable failure behavior before choosing a dependency. That is a suggestion, not an unfinished patch, a selected v0.16.0 scope, or permission for executable plugins or automatic external loads. The original math/diagram compound checkbox stays open until its full contract is complete. Scoped concurrency, participant removal, and bulk workspace management are complete; do not reimplement them. No second feature has been started. Live-account smoke tests remain separate and require explicit authorization for provider requests.

1. Read current main and check whether newer commits supersede this checkpoint. Read any applicable `AGENTS.md` discovered in the new checkout; none existed in the recorded source tree.
2. Read the README's complete TODO checklist, CONTRIBUTING, and the architecture decisions relevant to the intended change.
3. When asked to continue, select one useful, bounded unfinished item or demonstrated bug and state the chosen scope briefly. Verify this iteration's final checkpoint first; do not invent a partially completed next feature.
4. Implement the iteration, run appropriate validation, update README/release notes as needed, refresh this recovery file, and publish through the authorized connection.
5. Finish with the concrete change, commit/link, completed checks, and material remaining limitations. Distinguish saved work from pending or unobserved work.

The complete implementation checklist belongs at the very end of README.md. Keep completed entries and open entries accurate. Partial work leaves the original compound checkbox unchecked with a clear note; do not mark a whole feature complete because only one part works.

## Collaboration and recovery rules

- The established workflow permits routine implementation, validation, documentation, and publishing completed changes directly to main. Do not ask for confirmation repeatedly for that same scope. Respect your actual system/developer instructions and the receiving user's current request.
- Preserve user changes, real application data, original messages, attribution, frozen retry bindings, permissions, and turn accounting. Do not force-push or discard an unrelated worktree.
- Prefer a small complete iteration to an unbounded rewrite. Do not redo completed prior iterations or repeat passing suites without a new change, failure, or unresolved concern.
- UI corners should be square: prefer 0–4px radii, with none above 8px.
- No project license has been selected. The package is private; do not add a license grant or publish it to npm.
- Version 1 is prohibited until every item in the complete README checklist is fully completed and validated, including optional items and verification/security/packaging/release work. Keep versions on 0.x; do not remove, defer, or check off unfinished items to bypass this gate. Only an explicit user instruction may change this release requirement.
- Work solo unless the user or applicable project instructions explicitly request delegation.
- Send a concise meaningful progress update at least every 60 seconds during active work. Track only elapsed time and tool status you can actually observe.
- A stalled or offline execution connection gets at most two short recovery attempts. Do not poll indefinitely, spend hours reconstructing source, or repeatedly start commands that cannot execute. After two unsuccessful attempts, stop dependent work and report saved work, passed checks, pending checks, and the blocker.
- The previous chat displayed a Working timer for over ten hours even after replies and ten page refreshes. The assistant could not inspect/cancel the underlying conversation run or reset its timer. Do not claim to monitor or fix that platform counter, and do not treat a stale counter as an active coding task.

## Checkout caveat

This iteration reused `/workspace/scratch/066d1deae166/AIB_LLM_Built`, which had reverted to the clean older v0.13.0 snapshot `cfdc888aaf9bd10004534df6a55f2f453cc75125`, tree `adb0193c58525b6ea20de34d19098e60bbef0524`. Read current-main recovery first, restored 22 published changed text files through the authorized GitHub connection, then compared every tracked blob against main's recursive tree. One stylesheet fetch was truncated at 20,000 characters; the exact decoded blob `c2c1b74d2840e5d0ae753ab0bf89eb05b72687fc` restored its verified 39,417 bytes. Local baseline commit `ddccf2ae52ecb889cadc319406bc37adfa75a70f` then matched current main's complete tree `19bd3ee90b67539f1f8b65c99789f8fb1229228d`. No user edits or real app data were discarded, and no applicable AGENTS.md was found.

Local Git history is an independent snapshot, not a clone of remote history. Local corrected application/test commit `75fab83f43d0dd441f0836c45493175758f62f46` and remote commit `964be1404dab860525c08b76b5c5272252ab6096` share tree `afbc8ac9c8de1df96c3bc4beeed9e6bbccecdd85`. Publishing uses actual remote parents and fast-forward refs. Never force-push the snapshot, assume its local hashes equal remote hashes, or use a normal pull to reconcile it. Compare exact trees before reconciling metadata.

Application changes are committed and published to main with actual remote parents retained. This final recovery-only document follows the verified source, and its remote tree is compared exactly against the local documentation tree during publication. No uncommitted feature work or pending required application check is carried over. No real data, credentials, generated assets, or test output is committed. Local Chromium remains unavailable; required browser verification was completed through CI.

## Useful paths and commands

- `src/shared`: schemas/shared types, strict scoped concurrency/removal/bulk contracts, and retained identity/ordinal/eligibility helpers.
- `tests/concurrency.test.ts` and `tests/ui/concurrency.spec.ts`: scope/probe occupancy, policy persistence, cleanup/deletion, HTTP, queue holds, settings/draft/defaults, cross-view edits, and isolated protocol fixtures.
- `src/server/engine.ts`: scheduling, routing, workflows, and domain rules.
- `src/server/activity.ts`: read-only activity projection.
- `src/client/ParticipantQueue.tsx`: activity freshness, queue disclosure, prerequisites, and source navigation.
- `src/shared/version.ts`: shared header/session/startup release label.
- `src/client/PanelLayout.tsx` and `tests/ui/layout.spec.ts`: browser layout preference, resizing/cancellation, compact panels, and isolated browser coverage.
- `tests/activity.test.ts` and `tests/ui/activity.spec.ts`: queue, prerequisite, occupancy, recovery, HTTP, and isolated browser coverage.
- `src/server/store.ts`: SQLite persistence, revision-checked writes, and atomic `applyBatch` transactions.
- `src/server/http.ts`: HTTP contracts and request validation.
- `src/server/providers.ts` and `src/server/live-providers.ts`: provider interfaces, simulation, live adapters, and model prompt boundaries.
- `src/client/App.tsx`: main interface, selection reconciliation, composer, settings, and management flows.
- `src/client/MarkdownText.tsx`, `MessageText.tsx`, `CopyButton.tsx`, `message-links.ts`, and `message-footnotes.ts`: message presentation, fallback, copying, URL policy, and scoped footnote graph/focus.
- `tests/connections.test.ts`: coordinator/greeting probes, native provider envelopes, scope, cancellation, limits, and no-state-change coverage.
- `tests/ui/connections.spec.ts`: simulation/saved-settings/narrow layout and greeting-success/coordinator-failure/explicit-success flows.
- `tests/rendering.test.ts`: adversarial rendering and source-retention coverage.
- `src/client/code-highlighting.ts`, `CodeBlock.tsx`, and `tests/highlighting.test.ts`: bounded lexical scanning, optional escaped token presentation, complete plain fallback, and targeted token contrast.
- `tests/ui/highlighting.spec.ts`: isolated keyboard/copy/source/archive/reload, hostile code, resource bounds, streaming/failure/context coverage.
- `tests/ui/footnotes.spec.ts`: isolated focus, URL/history, source, bounds, spoofing, streaming, failure, and provenance coverage.
- `tests/ui/conversation.spec.ts`: Chromium workflows, including the send/refresh race regression.
- `src/client/Participants.tsx`, `tests/participant-removal.test.ts`, and `tests/ui/participant-removal.spec.ts`: current/removed Settings, exact review, retention, eligibility, rollback, restart, cross-view and ambiguous-response coverage.
- `tests/bulk-workspaces.test.ts` and `tests/ui/bulk-workspaces.spec.ts`: scope, confirmation, cancellation, stale activity, rollback, streaming deletion, restart, keyboard/mobile, and ambiguous-response coverage.
- `tests/ui/isolated-service.ts`: isolated production-service restart fixture.
- `playwright.config.ts`: fresh per-run test data and optional `AIB_BROWSER_PATH`.
- `docs/architecture/0001-language-and-runtime.md` through `0016-scoped-concurrency.md`: architecture decisions.
- `.github/workflows/ci.yml`: six-job Node/platform matrix.

Supported Node engine range is `>=24.15.0 <25 || >=26.10.0 <27`; `.nvmrc` selects 26.10.0. Use the lockfile. Do not silently upgrade dependencies or change the runtime range.

```sh
npm ci
npm run check
npm run build
npm audit --omit=dev --audit-level=high
npx playwright install chromium
npm run test:ui
```

`npm run check` includes TypeScript checks, unit/service/rendering tests, and formatting. Browser tests are required for client or service/client contract changes. Use `npm run dev` for development or `npm start` after building for the production service. Ensure tests retain blank cloud credentials and isolated data.

## Maintain this handoff

Update this file after every completed iteration and before a material pause or handoff. Record the current goal, completed changes, exact application commit/tree, verification evidence, uncommitted work if any, blockers, and the next concrete step. Replace stale checkpoint statements instead of appending contradictory histories. Never store keys, credential values, private user data, or unrelated personal history here.

A documentation-only change does not require a release version bump. Verify the file was actually committed to main and distinguish its CI status from the recorded application-code CI. A receiving LLM should finish the authorized work and leave the next recovery prompt ready.
