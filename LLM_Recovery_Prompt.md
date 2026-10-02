# LLM Recovery Prompt

Updated: 2026-10-02 (UTC). Application checkpoint: v0.13.0.

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

- Main baseline: `23a827863a36ebbe9a161ea8db70147da1591c14`, v0.12.0, tree `865f69f2741623ff71bffd7ca488d94c9fe842ee`. Its automatic full-main CI `36963739243` was independently confirmed successful before this iteration.
- Branch: `main`. Application version: `0.13.0`.
- Most recent application/test commit: `31891289be3e94f9829b697b7ec1c004c7ee89b2` — `Give bulk workspace dropdowns stable accessible labels`. The preceding feature commit `2de0c9216d26313e2ac587305e483ca5a021cdc1` implements the batch contract.
- Application/test Git tree: `c5a49dd4333e2c683149dfe1a8db7fdd5eb0eb96`.
- Validation branch: `codex/v0.13.0-bulk-workspaces-20261002`.
- Exact application/test CI: https://github.com/drkevorkian/AIB_LLM_Built/actions/runs/36968893326
- CI completed successfully for commit `31891289be3e94f9829b697b7ec1c004c7ee89b2`: all six platform/runtime jobs green; all 48 Chromium tests passed on Ubuntu under both supported runtimes.
- The bounded v0.13.0 iteration is complete and published. No unfinished feature patch, pending required application check, publication blocker, or selected v0.14.0 feature is carried over.
- This recovery-only document follows the verified application/test commit. Its automatically triggered main CI is a separate full-tree check; the application-source run above does not claim to verify the newer documentation tree. Inspect current main's run independently when resuming.
- The user's latest scope asks to finish 1–5 existing checkboxes. Exactly two original entries are completed: section 23's archive/restore, bulk deletion, thread renaming, and searchable workspace/thread management; and section 26's scoped bulk archive/restore/deletion with previews and cancellation. Existing archive/search/renaming behavior supplies the earlier parts of the first item. No checklist entry was added or removed; 182 remain unchecked.
- The user requires every README checklist item to be fully completed and validated before version 1. README, CONTRIBUTING, and this handoff retain that gate; versions stay on 0.x, including optional and verification/security/packaging/release work. Compound items with unfinished work remain unchecked. Do not remove or defer items to bypass the gate.

Current goal completed: the bounded v0.13.0 implementation, validation, publication, and recovery update, including two existing README checkboxes. No second feature has been started. Read current main and select the next bounded unfinished item.

## Working behavior already implemented

- Workspaces with 1–8 independent participant identities, including duplicate display names. Settings supports adding, editing, deactivating, and reactivating participants; revisions and historical author/model bindings are retained.
- Directed messages, parallel answers with all/any/quorum collection, and optional synthesis after the required answers finish.
- Fixed relays with 1–12 hops, including repeated identities and orders such as A → C → B → A.
- Coordinator discussions with strict validated actions, frozen peer grants, 1–10 peer rounds, and a reserved 2–50 turn allowance. Invalid completed decisions permit one bounded correction; network failures do not receive that correction retry.
- Persistent history, threads, response sets, streamed answers, frozen context inspection, reported token usage, provider request IDs, and Markdown export.
- Per-participant queues with running/numbered queue inspection, source-thread links, dispatch holds, shared-slot occupancy, and separate synthesis/coordinator response prerequisites. A global generation limit of four, pause/resume/stop, explicit bounded retries, turn accounting, and restart recovery remain unchanged.
- Safe Markdown/code/source presentation and exact message/code copying, with labeled message-scoped footnotes and optional bounded JavaScript/TypeScript/JSON/Python highlighting.
- Settings for themes, conversation defaults, workspace name/objective/turn limits, and participant connections.
- Desktop pointer/keyboard panel sizing with browser width preferences, Settings reset, responsive fitting, and independently collapsible navigation/participants on narrow screens.
- Explicit greeting and coordinator capability probes, sharing scheduling limits/cancellation and leaving conversation state/turn usage unchanged.
- Confirmed workspace/thread deletion with scoped cancellation, removal of copied deleted source context, late-event rejection, and persistence of the empty state after the final workspace is deleted.
- Workspace archive/restore, thread renaming, literal workspace metadata search, and scoped thread/message search. Restoring an archive leaves it paused and does not replay work.
- Confirmed atomic archive/restore/deletion of 1–25 exact selected workspaces, with named previews, cancellation before confirmation, stale-preview rejection, and unchanged unrelated work.
- Simulated providers plus implemented API adapters for OpenAI, xAI/Grok, Gemini, Ollama, and OpenAI-compatible servers.

Archive, deletion, retry, roster, search, and context guarantees are described in the architecture decisions. Inspect those documents before changing the relevant behavior.

## Current iteration: confirmed bulk workspace management

v0.13.0 adds **Manage workspaces** beside the workspace list. Native checkboxes identify each exact workspace ID separately, including duplicate names. Literal name/objective search and active/archived/all filters clear the selection when changed; hidden rows cannot silently enter a preview. There are no wildcard scopes or automatic future selections. The maximum batch is 25 current workspaces.

A read-only named preview lists the exact IDs, titles, revisions, archive state, thread/message counts, consumed turns, queued/running jobs, pending workflows, connection probes, and open transports. It explains unchanged targets and archive blockers. It excludes objectives, participant roles, message/context bodies, endpoints, raw provider errors, and credentials. Cancel receives focus; Escape, close, and Back to selection abandon the preview before confirmation. Drafts and the conversation remain mounted through selection, cancellation, archive, and restore. Deleting the selected workspace uses the existing fallback/empty-state rules.

The authenticated POST endpoints `/api/workspaces/bulk/preview`, `/api/workspaces/bulk/confirm`, and `/api/workspaces/bulk/preview-cancel` retain existing session, Host, Origin, cross-site, method, body-size, and security-header protections. Strict schemas reject empty/duplicate/oversized or unknown workspace selections and extra fields. Preview takes an action and exact ordered IDs; confirmation/cancellation accept only a UUID token, never a client-supplied replacement action or target list.

Each five-minute one-use preview is transient, server-owned, and bound to selected revisions and the actual connection-probe/transport instances. At most 50 previews are retained; expired/oldest records are removed and service restart/shutdown clears all tokens. Selected data changes, removal, or probe/transport start/end/replacement require an explicit fresh preview; unselected changes do not expand or invalidate the scope. Confirmation consumes the token before validation or writes, including on failure. Mutating a returned preview cannot change the server's saved authority.

`RoomStore.applyBatch` uses a synchronous SQLite `BEGIN IMMEDIATE` transaction. It loads and validates every target before writing, applies revision-checked writes, leaves identical no-op records unchanged, and commits everything or rolls back all rows, timestamps, revisions, and audit entries. Any changing archive target with pending jobs/workflows or connection probes blocks the entire batch. Archive retains history/usage and pauses targets; restore leaves restored workspaces paused without replay/retry/refund, while already active workspaces remain exactly unchanged. No provider is invoked by archive/restore.

Bulk deletion commits all selected row removals before aborting any selected request or probe. Existing cancellation, released occupancy, and late-event rejection apply; unrelated rooms/work are untouched. Deleting the last workspace remains empty after restart. Deletion is logical app-record removal, not forensic erasure, provider submission retraction, external backup deletion, or a billing refund.

Cancellation ends when confirmation starts. Close/Escape/Back/Cancel are held while confirmation is in flight; a committed action cannot be undone. Known rejection clears the preview and requires explicit review. An unknown/lost response disables new previews and requires **Close and refresh workspaces** to inspect authoritative state. Never automatically retry an ambiguous destructive operation. Abandoned preview reads are aborted and known preview tokens are cancelled with a bounded request; token expiry/restart remains the fallback.

Read `docs/architecture/0014-bulk-workspaces.md`, `docs/releases/0.13.0.md`, `tests/bulk-workspaces.test.ts`, and `tests/ui/bulk-workspaces.spec.ts` alongside ADRs 0005/0007 before extending this behavior. No dependency/runtime/schema/license changes are included. Thread batches, backups/retention, groups, full accessibility, and large-history audits remain open.

## Previous iteration: optional bounded code highlighting

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

Local Node 24.19.0 passed locked installation, TypeScript checks, all 216 service/engine/provider/rendering tests, formatting, production client/server builds, `git diff --check`, and a zero-vulnerability production dependency audit. Playwright discovery lists 48 tests in seven files; listing alone is not a browser pass. The lockfile changes only root application version metadata, and the package/shared release labels agree on 0.13.0. The README retains every original checklist entry, changes exactly two existing items to complete, and leaves 182 unchecked.

Sixteen new engine/store/HTTP tests cover read-only previews/cancellation, strict limits and exact identities including 25 duplicate-named targets, unchanged history/usage and no-op records, pending-work archive blocking, selected revision/removal changes, probe replacement without a stored revision change, expiration/eviction/one-use tokens, tampered returned metadata, commit-before-abort deletion of active streams/probes/queues, unchanged unrelated work and late-event rejection, forced SQLite UPDATE/DELETE rollback, disk restart/empty-state persistence, service shutdown, and HTTP authentication/Host/Origin/method/scope protections. A wrong-Host fixture uses an actual `node:http` request because Node fetch did not reliably send its requested Host header; all final tests passed without an application behavior change.

Four new isolated Chromium flows bring the browser suite to 48 tests: 264 distinct service/rendering/browser tests. They exercise duplicate names and literal hostile titles without markup execution, exact scope, Space activation, focused cancellation/Escape, filter selection reset, untouched drafts/history/usage, narrow layouts and theme changes, archive/restore and real service restart, stale confirmation and pending-work blockers, actual loopback streaming request disconnection after scoped deletion, unrelated work and cross-view selection reconciliation, final-workspace deletion/restart, and a deliberately lost successful confirmation response without automatic repeat. Existing roster, routing, queue, panel, footnote, highlighting, clipboard, archive/deletion, and acknowledged-send selection regressions remain required.

The known local Chromium executable is truncated (30,354,432 bytes with missing ELF sections expected beyond 209 MB) and previously crashed with SIGSEGV even for `--version`. This iteration did not retry it or download replacements. Local browser validation remains unavailable; do not reuse its path or claim a local UI pass. No local Node 26 run is claimed. Required browser/runtime verification uses the exact GitHub CI source tree.

Final exact-source CI `36968893326` completed successfully for commit `31891289be3e94f9829b697b7ec1c004c7ee89b2`. All six jobs passed locked installation, TypeScript/format checks, all 216 service/provider/rendering tests, production builds, and zero-vulnerability production audits on Node 24.19.0/26.10.0 across Linux, Windows, and macOS. Both Ubuntu jobs passed all 48 Chromium tests, including all four bulk flows: 264 distinct tests. Older or failed runs do not verify this final source. The recovery-only follow-up triggers a separate automatic main CI; its outcome is not inferred from the source run.

The initial candidate `2de0c9216d26313e2ac587305e483ca5a021cdc1` / CI `36968394358` passed all platform source/build/audit gates and all 44 existing browser tests, but all four new browser flows stopped at exact-label dropdown selection. Their wrapping labels included option text. The two dropdowns now have explicit stable accessible names matching their visible labels. This is a two-attribute application correction, without weakened assertions or increased timeouts. The final corrected candidate passed the entire browser suite under both supported runtimes.

Execution remained available throughout this iteration. Zero short execution recovery attempts were needed; there is no unresolved execution blocker. The earlier v0.12.0 patch-request connection timeout and its one successful short recovery were historical, not failures in this iteration. Retain the maximum of two short recovery attempts if a future execution connection stalls.

Previously published v0.12.0 exact-source CI `36963375971` passed all six jobs, 200 service/rendering tests on Node 24.19.0/26.10.0 across Linux, Windows, and macOS, and 44 Chromium tests under both Ubuntu runtimes. Its recovery-only full-main run `36963739243` was independently confirmed successful before v0.13.0 development. Those older runs do not verify v0.13.0. The earlier highlighting/clipboard and layout-storage corrections scope status selectors to their intended controls; preserve those selectors rather than broad status matches.

The deletion browser regression still waits up to ten seconds for the exact simulated request's authoritative stored synthesis completion before requiring an enabled reply. This wait addresses a default five-second timeout observed in an older documentation-tree CI run; it does not accept incomplete jobs or change completion rules. Footnote and highlighting browser selectors retain the anchored All messages label match including the displayed count.

No paid provider account or installed Ollama model was tested with real credentials. Protocol fixtures and simulation do not establish live-account/model compatibility. Do not silently use credentials or bill a provider during normal tests. Browser service fixtures clear cloud key variables and use isolated temporary databases; the bulk-deletion protocol test is a synthetic loopback stream, not an installed Ollama model.

Signed-in ChatGPT/Grok/Gemini website transport is not implemented. This application communicates through APIs and simulation. Anthropic, unrestricted conferences, nested peer delegation, attachments, mathematical typesetting, diagrams, persistent capability catalogs, and other planned capabilities remain open. Version 1 remains prohibited until every README checklist item is fully implemented and validated.

## What to do next

Read the remaining README checklist and choose one new bounded feature or demonstrated bug after verifying current main. One possible next feature is safe mathematical typesetting: define allowed syntax, resource bounds, escaped/inert rendering, accessibility, exact source/copy/context preservation, and readable failure behavior before choosing a dependency. That is a suggestion, not an unfinished patch, a selected v0.14.0 scope, or permission for executable plugins or automatic external loads. Bulk workspace management is complete; do not reimplement it. No second feature has been started. Live-account smoke tests remain separate and require explicit authorization for provider requests.

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

This iteration reused `/workspace/scratch/066d1deae166/AIB_LLM_Built` after confirming its clean local baseline commit `8e5164127400ee6dd16c93130cb5bbf3f8fb56fc` matched current main's exact tree `865f69f2741623ff71bffd7ca488d94c9fe842ee`. No applicable AGENTS.md was found. Source originally came through the authorized GitHub connection after the conventional clone endpoint was unavailable.

Local Git history is an independent snapshot, not a clone of remote history. Local application/test commit `d8874fa9d3a01226fa411a2c1f80f262acb94a1b` and remote application/test commit `31891289be3e94f9829b697b7ec1c004c7ee89b2` share tree `c5a49dd4333e2c683149dfe1a8db7fdd5eb0eb96`. Publishing uses actual remote parents and fast-forward refs; never force-push the snapshot or assume a normal pull can reconcile it. Preserve and compare exact trees before reconciling metadata.

Application feature/test changes are committed and published to main with actual remote parents retained. This final recovery-only document follows that verified source, and its remote tree is compared exactly with the local documentation tree during publication. No uncommitted feature work or pending required application check is carried over. No real data, credentials, generated assets, or test output is committed. The truncated local browser remains unavailable; required browser verification was completed through CI.

## Useful paths and commands

- `src/shared`: schemas and shared types, including strict bulk selection/token contracts.
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
- `tests/bulk-workspaces.test.ts` and `tests/ui/bulk-workspaces.spec.ts`: scope, confirmation, cancellation, stale activity, rollback, streaming deletion, restart, keyboard/mobile, and ambiguous-response coverage.
- `tests/ui/isolated-service.ts`: isolated production-service restart fixture.
- `playwright.config.ts`: fresh per-run test data and optional `AIB_BROWSER_PATH`.
- `docs/architecture/0001-language-and-runtime.md` through `0014-bulk-workspaces.md`: architecture decisions.
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
