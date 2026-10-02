# Contributing

Use Node.js 26.10 or later in the 26.x series, or Node.js 24.15 or later in the 24.x series. `.nvmrc` selects 26.10.0 for developers using nvm. Install the locked dependencies with `npm ci`. CI checks both Node 24.19.0 and 26.10.0 on Linux, Windows, and macOS, with Chromium tests on Linux for both runtimes.

```sh
npm run dev
npm run check
npm run build
npx playwright install chromium
npm run test:ui
```

`npm run dev` serves the UI and local API on one loopback port. Client edits use Vite's development pipeline. Restart the service after server edits. Browser tests create a fresh temporary data directory per run; never point test configuration at your normal application data.

Keep message schemas in `src/shared`, domain rules in `src/server/engine.ts`, persistence in `src/server/store.ts`, and provider lifecycle behavior behind the `ProviderAdapter` interface. UI components must not become authoritative for routing, permissions, or workflow completion.

When changing a workflow, explain the externally observable guarantee, its failure cases, and the evidence from tests. Add meaningful tests for races, persistence, and recovery rather than tests that merely repeat implementation details. Preserve original messages and completed response sets.

Run formatting, type checks, unit/service tests, and a production build. Run browser tests when changing the client or service/client contract. The optional `AIB_BROWSER_PATH` environment variable selects an existing compatible Chromium executable for browser tests; normal developer setup uses Playwright's installed browser.

Mark a README task complete only when the entire listed item is implemented and validated. Partial implementations should be noted separately, leaving the original checkbox unchecked. Keep API credentials, local databases, test output, and generated build assets out of commits.

Version 1 is blocked until every item in the complete README checklist is completed and validated, including optional entries and verification/release work. Continue with 0.x versions until then. Removing, deferring, or checking off unfinished work cannot satisfy this gate; only an explicit user instruction may change it. See the README's **Version 1 release gate**.

Read [ADR 0008](docs/architecture/0008-message-presentation.md) before extending message rendering or copying. Preserve exact stored/source/context strings, keep streaming presentation literal, and treat HTML, links, code, images, and model-authored formatting as untrusted data. Do not enable raw HTML, executable highlighting, automatic navigation, remote image loads, or clipboard reads. Extend adversarial rendering/browser coverage when changing plugins, component properties, URL policies, or formatting failure handling.

No project license has been selected yet. Do not add a license grant or publish a package without that decision.

Read [ADR 0010](docs/architecture/0010-participant-queue-inspection.md) before changing queue inspection. Activity is a transient read-only projection, not scheduling authority or stored room data. Preserve original job order/bindings, anonymous shared capacity, real response barriers, and explicit freshness/failure states. Never turn inspection into dispatch, expiration, retry, or provider calls. Keep release labels in `src/shared/version.ts` consistent with the package version.

Read [ADR 0009](docs/architecture/0009-coordinator-capability-tests.md) before changing connection probes. Greeting and coordinator checks share concurrency, timeout, archive/roster locks, and cancellation; they must not persist conversation work, consume room turns, or transmit history/objectives. Coordinator success requires a valid completed finish decision, without automatic repair, retry, or fallback. Keep results scoped to the tested configuration/time and retain explicit simulation labels.

Provider tests use synthetic safe streams and loopback HTTP fixtures. The Playwright service explicitly clears cloud API-key variables so automated browser tests cannot call or bill cloud providers. Never use a real key in a protocol fixture, checked-in transcript, screenshot, or test expectation. Credentialed provider smoke tests are separate, explicitly invoked checks whose model IDs and date must be recorded without keys.

Coordinator actions must pass server validation and an explicit provider completion before scheduling peers. Keep grants, turn reservation, peer barriers, and cancellation atomic. Read [ADR 0004](docs/architecture/0004-bounded-agent-discussions.md) before extending discussion routing. Invalid completed actions may receive one bounded correction; network failures must not acquire that automatic retry path.

Read [ADR 0006](docs/architecture/0006-participant-rosters.md) before changing roster or attribution behavior. Route by stable participant ID, permit duplicate names, retain at least one active participant, and keep roster edits outside pending workflows and workspace probes. Activation controls invocation eligibility, not message visibility. Every successful configuration/activation change must preserve a full revision in the same transaction. Historical labels and retry bindings come from their recorded snapshots; a new question uses current settings. Legacy history must identify recovered records and unknown times without inventing missing revisions. Cover inactive-routing rejection, turn accounting, cross-view draft reconciliation, and disk restart when changing these guarantees.

Read [ADR 0007](docs/architecture/0007-workspace-organization.md) before extending archive, naming, or search behavior. Archived workspaces must never dispatch or probe a provider, and restoration must not resume or replay work. Keep naming separate from routing and frozen context. Search only authorized retained records, render previews as plain text, and retain drafts when filters or archive state change. Test archive-only startup with a real isolated service and preserve the welcome initialization flag. Adding restricted visibility or global search requires server authorization before search/preview data reaches the client.

Read [ADR 0011](docs/architecture/0011-panel-layout.md) before changing panel sizing or collapse behavior. Keep widths/browser preferences separate from conversation authority. Preserve bounds, conversation/Stop visibility, mounted drafts and selections, cancelled-gesture rollback, and responsive preference retention. Test pointer/keyboard interactions, compact transitions, storage failure, and unchanged room records.

Read [ADR 0012](docs/architecture/0012-message-footnotes.md) before changing footnote navigation. Recognize only parser-generated graph edges, keep IDs and focus inside one message, and preserve the ordinary fragment/relative-link block. Retain repeated-reference backlinks, label-collision handling, literal streaming/source, exact body provenance, navigation limits, and the readable fallback. Review the pinned parser graph assumptions when dependencies change.

Read [ADR 0013](docs/architecture/0013-code-highlighting.md) before changing code highlighting. Use explicit bounded fence aliases and fixed token categories rendered as escaped text. Preserve complete plain fallback at character/line/token limits, per-block opt-in, exact code copying, literal streams, and original message provenance. Never load a grammar selected by source text, enable executable plugins, generate HTML, or infer routing from code. Highlighting is approximate lexical presentation, not syntax validation; broader accessibility and history-performance audits remain separate.

Read [ADR 0014](docs/architecture/0014-bulk-workspaces.md) before changing bulk management. Bind short-lived previews to exact identities, revisions, and probe/transport instances. Preserve strict bounds, one-time confirmation, all-or-nothing transactions, cancellation before confirmation, commit-before-abort deletion, archive locks, paused restoration, and explicit inspection after a lost response. Extend database-fault, stale-activity, persistence, and browser coverage when those guarantees change.
