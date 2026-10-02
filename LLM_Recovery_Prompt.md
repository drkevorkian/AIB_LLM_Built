# LLM Recovery Prompt

Updated: 2026-10-02 (UTC). Application checkpoint: v0.10.0.

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

- Main baseline: `91bf55cda44ff8ebe8aa92f8bcb4080d083b121a`, v0.9.0, tree `e7f088e8a7f877a3c82495961ccf60c81cfb7ac3`.
- Branch: `main`. Application version: `0.10.0`.
- Most recent application/test commit: `fe5096471d33a5ae1a02f7c4a5ea4fb7ef8ae161` — `Cancel desktop drags before compact-layout pointer release`.
- Application/test Git tree: `6052c74d345109e5f7ec1b9aa1f5478a3a1ec779`.
- Validation branch: `codex/v0.10.0-panel-layout-20261002`.
- Exact application/test CI: https://github.com/drkevorkian/AIB_LLM_Built/actions/runs/36956469856
- CI completed successfully for commit `fe5096471d33a5ae1a02f7c4a5ea4fb7ef8ae161`: all six platform/runtime jobs green; all 38 Chromium tests passed on Ubuntu under both runtimes.
- The bounded v0.10.0 iteration is complete and published. No unfinished feature patch, pending required application check, publication blocker, or selected v0.11.0 feature is carried over.
- This recovery-only document follows the verified application/test commit. Its automatically triggered CI is separate; the exact application CI above does not claim to verify the newer full documentation tree.
- The user requires every README checklist item to be completed and validated before version 1. README, CONTRIBUTING, and this handoff retain that gate; versions stay on 0.x, including optional and verification/security/packaging/release work.

Current goal completed: the bounded v0.10.0 implementation, validation, publication, and recovery update. No second feature has been started. Read current main and select the next bounded unfinished README item.

## Working behavior already implemented

- Workspaces with 1–8 independent participant identities, including duplicate display names. Settings supports adding, editing, deactivating, and reactivating participants; revisions and historical author/model bindings are retained.
- Directed messages, parallel answers with all/any/quorum collection, and optional synthesis after the required answers finish.
- Fixed relays with 1–12 hops, including repeated identities and orders such as A → C → B → A.
- Coordinator discussions with strict validated actions, frozen peer grants, 1–10 peer rounds, and a reserved 2–50 turn allowance. Invalid completed decisions permit one bounded correction; network failures do not receive that correction retry.
- Persistent history, threads, response sets, streamed answers, frozen context inspection, reported token usage, provider request IDs, and Markdown export.
- Per-participant queues with running/numbered queue inspection, source-thread links, dispatch holds, shared-slot occupancy, and separate synthesis/coordinator response prerequisites. A global generation limit of four, pause/resume/stop, explicit bounded retries, turn accounting, and restart recovery remain unchanged.
- Settings for themes, conversation defaults, workspace name/objective/turn limits, and participant connections.
- Desktop pointer/keyboard panel sizing with browser width preferences, Settings reset, responsive fitting, and independently collapsible navigation/participants on narrow screens.
- Explicit greeting and coordinator capability probes, sharing scheduling limits/cancellation and leaving conversation state/turn usage unchanged.
- Confirmed workspace/thread deletion with scoped cancellation, removal of copied deleted source context, late-event rejection, and persistence of the empty state after the final workspace is deleted.
- Workspace archive/restore, thread renaming, literal workspace metadata search, and scoped thread/message search. Restoring an archive leaves it paused and does not replay work.
- Simulated providers plus implemented API adapters for OpenAI, xAI/Grok, Gemini, Ollama, and OpenAI-compatible servers.

Archive, deletion, retry, roster, search, and context guarantees are described in the architecture decisions. Inspect those documents before changing the relevant behavior.

## Current iteration: panel layout

v0.10.0 adds two focusable desktop dividers, pointer capture, Left/Right 10 px steps (Shift 50), Home/End bounds, pixel value announcements, and visible focus. Escape, cancelled/lost capture, and Settings/compact transitions roll back unfinished drags. Completed drags and keyboard adjustments save to browser storage; these controls have no conversation authority.

Navigation spans 180–420 px and activity 230–480 px, with at least 400 px retained for the desktop conversation. ResizeObserver fitting temporarily reduces flexible side widths without rewriting saved preferences. An explicit adjustment after fitting saves the view's current side widths. Defaults retain the previous width breakpoints. At 1000 px or below, desktop widths/dividers yield to compact layouts and Hide/Show panel buttons. Mounted panels/composer retain drafts, selections, disclosure state, and existing send/refresh guards. Response status, workspace Stop, and Stop discussion stay in the conversation. Settings works with navigation collapsed and can reset widths/reopen compact panels.

`aib-panel-layout` stores only an exact version-1 object with bounded integer navigation/activity widths. Malformed, unsupported, or unreadable values use defaults. Storage write/removal failure keeps usable view sizing with an unsaved notice. Preferences belong to this browser origin; new/reloaded views read them, without live cross-tab synchronization. Compact collapse choices last only for the mounted view, while desktop always displays both panels.

Layout changes must never mutate room records, service defaults, attribution, context, grants, queues, provider lifecycle, or consumed/reserved turns. Dependencies/runtime/database versions are unchanged. The wider keyboard/screen-reader/contrast audit and real assistive-technology/touch-device review remain open. The original panel resizing/collapse checklist item is covered by this bounded feature; no broader accessibility checkbox is treated as complete.

Read `docs/architecture/0011-panel-layout.md`, `docs/releases/0.10.0.md`, `src/client/PanelLayout.tsx`, and `tests/ui/layout.spec.ts` before extending this behavior.

## Previous iteration: participant queue inspection

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

Local Node 24.19.0 passed locked installation, TypeScript checks, all 184 service/engine/provider/rendering tests, formatting, production client/server builds, `git diff --check`, and a zero-vulnerability production dependency audit. The dependency lock changes only the root application version.

Five new isolated production-browser flows bring the suite to 38 browser tests (222 distinct tests including service/rendering). They cover keyboard direction/steps/bounds/focus, pointer capture and completed/cancelled gestures, reload/reset, malformed/blocked storage, responsive fitting without preference overwrites, both themes at 340–1800 px and the 1000/1001 breakpoint, mounted drafts, compact disclosures/Settings, active discussion/room Stop, and unchanged stored room records. Existing browser tests retain all prior routing, queue, roster, archive/deletion, rendering, clipboard, and acknowledged-send selection regressions.

The first local UI command could not launch a browser; none of its five tests executed. The previously available Chromium file is truncated (30,354,432 bytes with missing ELF sections expected beyond 209 MB) and crashes with SIGSEGV even for `--version`. One short inspection confirmed the runtime problem; no repeated downloads/recovery loop was attempted. Local browser validation is therefore unavailable in this iteration. Do not reuse that executable path or claim a local UI pass.

The first candidate CI (`36956047465`) passed all six service/platform gates and all 38 Ubuntu Node 24 browser tests, but Node 26 caught a real drag-cancellation race: release immediately after crossing into compact layout could save before the media-query/React effect cancelled it. The correction checks the live viewport before persisting release and cancels directly from the media-query event; the same browser regression remains intact. Its local type checks, build, formatting, and diff checks passed. Final exact-source CI `36956469856` passed all 184 service/rendering tests on Node 24.19.0/26.10.0 across Linux, Windows, and macOS, with clean installation/checks/builds and zero-vulnerability audits. Both Ubuntu jobs passed all 38 Chromium tests, including the immediate compact-transition release regression: 222 distinct tests in this release. No local Node 26 run is claimed. Older and failed runs do not verify the final source.

No paid provider account or installed Ollama model was tested with real credentials. Protocol fixtures and simulation do not establish live-account/model compatibility. Do not silently use credentials or bill a provider during normal tests.

Signed-in ChatGPT/Grok/Gemini website transport is not implemented. This application communicates through APIs and simulation. Anthropic, unrestricted conferences, nested peer delegation, attachments, syntax highlighting, mathematical typesetting, diagrams, persistent capability catalogs, and other planned capabilities remain open.

## What to do next

One suggested next bounded feature is safe, message-scoped internal footnote navigation with stable namespaced IDs and bounded keyboard targets. Preserve the link/HTML/image/source boundaries in ADR 0008. This is a suggestion, not an unfinished patch or authorization to add general relative-link navigation. Read the full current README checklist and relevant decisions before choosing the next scope. Live-account smoke tests remain separate and require explicit authorization for provider requests.

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

This iteration reused `/workspace/scratch/066d1deae166/AIB_LLM_Built` after checking that its clean baseline tree exactly matched current main (`e7f088e8a7f877a3c82495961ccf60c81cfb7ac3`). No applicable AGENTS.md was found. Source originally came through the authorized GitHub connection after the conventional clone endpoint was unavailable.

Local Git history is an independent snapshot, not a clone of remote history. Local application/test commit `87018c066d5c1096fd7c24b9810b7e202919743c` and remote application/test commit `fe5096471d33a5ae1a02f7c4a5ea4fb7ef8ae161` share tree `6052c74d345109e5f7ec1b9aa1f5478a3a1ec779`. Publishing uses actual remote parents and fast-forward refs; never force-push the snapshot or assume a normal pull can reconcile it. Preserve/compare exact trees before reconciling metadata.

Application feature/test changes are committed and published to main with actual remote parents retained. This final recovery-only document follows that verified source. No uncommitted feature work or pending required check is carried over. The truncated local browser runtime remains unavailable; browser verification was completed through CI. No real data, credentials, generated assets, or test output is committed.

## Useful paths and commands

- `src/shared`: schemas and shared types.
- `src/server/engine.ts`: scheduling, routing, workflows, and domain rules.
- `src/server/activity.ts`: read-only activity projection.
- `src/client/ParticipantQueue.tsx`: activity freshness, queue disclosure, prerequisites, and source navigation.
- `src/shared/version.ts`: shared header/session/startup release label.
- `src/client/PanelLayout.tsx` and `tests/ui/layout.spec.ts`: browser layout preference, resizing/cancellation, compact panels, and isolated browser coverage.
- `tests/activity.test.ts` and `tests/ui/activity.spec.ts`: queue, prerequisite, occupancy, recovery, HTTP, and isolated browser coverage.
- `src/server/store.ts`: SQLite persistence and transactions.
- `src/server/http.ts`: HTTP contracts and request validation.
- `src/server/providers.ts` and `src/server/live-providers.ts`: provider interfaces, simulation, live adapters, and model prompt boundaries.
- `src/client/App.tsx`: main interface, selection reconciliation, composer, settings, and management flows.
- `src/client/MarkdownText.tsx`, `MessageText.tsx`, `CopyButton.tsx`, and `message-links.ts`: message presentation, fallback, copying, and URL policy.
- `tests/connections.test.ts`: coordinator/greeting probes, native provider envelopes, scope, cancellation, limits, and no-state-change coverage.
- `tests/ui/connections.spec.ts`: simulation/saved-settings/narrow layout and greeting-success/coordinator-failure/explicit-success flows.
- `tests/rendering.test.ts`: adversarial rendering and source-retention coverage.
- `tests/ui/conversation.spec.ts`: Chromium workflows, including the send/refresh race regression.
- `tests/ui/isolated-service.ts`: isolated production-service restart fixture.
- `playwright.config.ts`: fresh per-run test data and optional `AIB_BROWSER_PATH`.
- `docs/architecture/0001-language-and-runtime.md` through `0011-panel-layout.md`: architecture decisions.
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
