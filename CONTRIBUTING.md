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
