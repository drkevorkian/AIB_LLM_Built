# LLM Recovery Prompt

Updated: 2026-10-01 (America/Denver). Application checkpoint: v0.7.0.

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

- Branch: `main`.
- Application version: `0.7.0`.
- Most recent application-code commit: `b1bce081e08b0705750dd2c825e1987e9af4b240` — `Keep acknowledged sends bound to refreshed thread history`.
- Application-code Git tree: `12e18ec86b19e4e3842a1813091bb6ea904fc8b6`.
- Verified CI: https://github.com/drkevorkian/AIB_LLM_Built/actions/runs/36880097322
- That run completed successfully for the exact application-code commit, with all six platform/runtime jobs green.
- This recovery document is being added after that code checkpoint. A later documentation commit does not change the recorded application version or make the old CI run verification of a newer tree.
- The v0.7.0 implementation is finished and published. No unfinished feature patch or selected v0.8.0 scope is carried over.

The last user request was to create this file so work can move into a new chat. Do not interpret the stuck timer as evidence that additional code was produced after the checkpoint.

## Working behavior already implemented

- Workspaces with 1–8 independent participant identities, including duplicate display names. Settings supports adding, editing, deactivating, and reactivating participants; revisions and historical author/model bindings are retained.
- Directed messages, parallel answers with all/any/quorum collection, and optional synthesis after the required answers finish.
- Fixed relays with 1–12 hops, including repeated identities and orders such as A → C → B → A.
- Coordinator discussions with strict validated actions, frozen peer grants, 1–10 peer rounds, and a reserved 2–50 turn allowance. Invalid completed decisions permit one bounded correction; network failures do not receive that correction retry.
- Persistent history, threads, response sets, streamed answers, frozen context inspection, reported token usage, provider request IDs, and Markdown export.
- Per-participant queues, a global generation limit of four, pause/resume/stop, explicit bounded retries, turn accounting, and restart recovery.
- Settings for themes, conversation defaults, workspace name/objective/turn limits, and participant connections.
- Confirmed workspace/thread deletion with scoped cancellation, removal of copied deleted source context, late-event rejection, and persistence of the empty state after the final workspace is deleted.
- Workspace archive/restore, thread renaming, literal workspace metadata search, and scoped thread/message search. Restoring an archive leaves it paused and does not replay work.
- Simulated providers plus implemented API adapters for OpenAI, xAI/Grok, Gemini, Ollama, and OpenAI-compatible servers.

Archive, deletion, retry, roster, search, and context guarantees are described in the architecture decisions. Inspect those documents before changing the relevant behavior.

## Most recent iteration: message presentation

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

## Final bug fix that must remain intact

A fast second send could previously select a newly created thread before refreshed history contained it. Selection reconciliation could then clear the thread and accidentally create another one.

The final fix keeps the composer in an Updating state until `onSent` has awaited refreshed workspace history. A new draft can be typed during this refresh, but another send is held until authoritative history is applied. Room/thread refs prevent an old workspace response from changing a new workspace's selection and preserve an explicit thread choice made while refreshing. Failed refreshes do not resend an acknowledged message.

Keep the deterministic delayed-refresh browser regression. The thread deletion test deliberately selects All messages before counting messages across separate threads. Message sequence styling uses `.message-sequence`; broad span selectors collide with copy-feedback elements.

Each Playwright run now uses its own fresh temporary database. Do not reuse accumulated browser test data or point tests at normal application data.

## Verification and honest limits

The saved v0.7.0 source passed 140 engine/service/provider-protocol/rendering tests and 28 Chromium UI tests: 168 distinct tests.

CI verified Node 24.19.0 and Node 26.10.0 on Ubuntu, Windows, and macOS. All six jobs passed dependency installation, checks, production builds, and production dependency audits. Chromium runs on Ubuntu for both Node versions. The production audit reported no vulnerabilities at that checkpoint.

The final local Node 24 run passed all 140 + 28 tests. A final local Node 26 run lost its execution connection, so its local completion was not observed. Exact-source CI subsequently passed all 140 + 28 tests on Node 26 as well as Node 24. Do not claim that the disconnected local run itself passed.

No paid provider account or installed Ollama model was tested with real credentials in the prior workspace. Protocol fixtures and simulation are verified; live-account smoke tests remain TODO. Do not silently use credentials or bill a provider while running normal tests.

Signed-in ChatGPT/Grok/Gemini website transport is not implemented. This application currently communicates through APIs and simulation. Anthropic, unrestricted conferences, nested peer delegation, attachments, syntax highlighting, mathematical typesetting, diagrams, and several other planned capabilities remain open.

## What to do next

1. Read current main and check whether newer commits supersede this checkpoint. Read any applicable `AGENTS.md` discovered in the new checkout; none existed in the recorded source tree.
2. Read the README's complete TODO checklist, CONTRIBUTING, and the architecture decisions relevant to the intended change.
3. When asked to continue, select one useful, bounded unfinished item or demonstrated bug and state the chosen scope briefly. No next feature was decided in the previous chat; do not invent a partially completed feature.
4. Implement the iteration, run appropriate validation, update README/release notes as needed, refresh this recovery file, and publish through the authorized connection.
5. Finish with the concrete change, commit/link, completed checks, and material remaining limitations. Distinguish saved work from pending or unobserved work.

The complete implementation checklist belongs at the very end of README.md. Keep completed entries and open entries accurate. Partial work leaves the original compound checkbox unchecked with a clear note; do not mark a whole feature complete because only one part works.

## Collaboration and recovery rules

- The established workflow permits routine implementation, validation, documentation, and publishing completed changes directly to main. Do not ask for confirmation repeatedly for that same scope. Respect your actual system/developer instructions and the receiving user's current request.
- Preserve user changes, real application data, original messages, attribution, frozen retry bindings, permissions, and turn accounting. Do not force-push or discard an unrelated worktree.
- Prefer a small complete iteration to an unbounded rewrite. Do not redo the completed v0.7.0 iteration or repeat passing suites without a new change, failure, or unresolved concern.
- UI corners should be square: prefer 0–4px radii, with none above 8px.
- No project license has been selected. The package is private; do not add a license grant or publish it to npm.
- Work solo unless the user or applicable project instructions explicitly request delegation.
- Send a concise meaningful progress update at least every 60 seconds during active work. Track only elapsed time and tool status you can actually observe.
- A stalled or offline execution connection gets at most two short recovery attempts. Do not poll indefinitely, spend hours reconstructing source, or repeatedly start commands that cannot execute. After two unsuccessful attempts, stop dependent work and report saved work, passed checks, pending checks, and the blocker.
- The previous chat displayed a Working timer for over ten hours even after replies and ten page refreshes. The assistant could not inspect/cancel the underlying conversation run or reset its timer. Do not claim to monitor or fix that platform counter, and do not treat a stale counter as an active coding task.

## Old checkout caveat

The previous scratch checkout was `/workspace/scratch/4e0546cf1d33/AIB_LLM_Built`. It was clean at local commit `467dd44`, with the same code tree `12e18ec86b19e4e3842a1813091bb6ea904fc8b6`, when the execution service went offline. Its cached origin/main was `1725b47f34317521da05e2572022d348f81995f1`.

The final remote commit `b1bce081e08b0705750dd2c825e1987e9af4b240` was published through the GitHub API from the verified tree. Local and remote commit metadata therefore differed despite identical application contents. The old local Git metadata was not synchronized afterward.

Prefer a fresh checkout of current main in a new environment. If reusing that exact old checkout, inspect status, fetch origin, and compare trees first. Do not assume `git pull --ff-only` can reconcile the differing commits. Only consider a soft metadata reset when the worktree is clean and tree equality is proven against the relevant remote code checkpoint; newer remote documentation must also be accounted for. Never use a hard reset or force push as a shortcut. Preserve any new local work before reconciliation.

## Useful paths and commands

- `src/shared`: schemas and shared types.
- `src/server/engine.ts`: scheduling, routing, workflows, and domain rules.
- `src/server/store.ts`: SQLite persistence and transactions.
- `src/server/http.ts`: HTTP contracts and request validation.
- `src/server/providers.ts` and `src/server/live-providers.ts`: provider interfaces, simulation, live adapters, and model prompt boundaries.
- `src/client/App.tsx`: main interface, selection reconciliation, composer, settings, and management flows.
- `src/client/MarkdownText.tsx`, `MessageText.tsx`, `CopyButton.tsx`, and `message-links.ts`: message presentation, fallback, copying, and URL policy.
- `tests/rendering.test.ts`: adversarial rendering and source-retention coverage.
- `tests/ui/conversation.spec.ts`: Chromium workflows, including the send/refresh race regression.
- `tests/ui/isolated-service.ts`: isolated production-service restart fixture.
- `playwright.config.ts`: fresh per-run test data and optional `AIB_BROWSER_PATH`.
- `docs/architecture/0001-language-and-runtime.md` through `0008-message-presentation.md`: architecture decisions.
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
