# Contributing

Use Node.js 24.15 or later in the 24.x series and install the locked dependencies with `npm ci`.

```sh
npm run dev
npm run check
npm run build
npx playwright install chromium
npm run test:ui
```

`npm run dev` serves the UI and local API on one loopback port. Client edits use Vite's development pipeline. Restart the service after server edits. Tests use a separate data directory; never point test configuration at your normal application data.

Keep message schemas in `src/shared`, domain rules in `src/server/engine.ts`, persistence in `src/server/store.ts`, and provider lifecycle behavior behind the `ProviderAdapter` interface. UI components must not become authoritative for routing, permissions, or workflow completion.

When changing a workflow, explain the externally observable guarantee, its failure cases, and the evidence from tests. Add meaningful tests for races, persistence, and recovery rather than tests that merely repeat implementation details. Preserve original messages and completed response sets.

Run formatting, type checks, unit/service tests, and a production build. Run browser tests when changing the client or service/client contract. The optional `AIB_BROWSER_PATH` environment variable selects an existing compatible Chromium executable for browser tests; normal developer setup uses Playwright's installed browser.

Mark a README task complete only when the entire listed item is implemented and validated. Partial implementations should be noted separately, leaving the original checkbox unchecked. Keep API credentials, local databases, test output, and generated build assets out of commits.

No project license has been selected yet. Do not add a license grant or publish a package without that decision.

Provider tests use synthetic safe streams and loopback HTTP fixtures. The Playwright service explicitly clears cloud API-key variables so automated browser tests cannot call or bill cloud providers. Never use a real key in a protocol fixture, checked-in transcript, screenshot, or test expectation. Credentialed provider smoke tests are separate, explicitly invoked checks whose model IDs and date must be recorded without keys.

Coordinator actions must pass server validation and an explicit provider completion before scheduling peers. Keep grants, turn reservation, peer barriers, and cancellation atomic. Read [ADR 0004](docs/architecture/0004-bounded-agent-discussions.md) before extending discussion routing. Invalid completed actions may receive one bounded correction; network failures must not acquire that automatic retry path.
