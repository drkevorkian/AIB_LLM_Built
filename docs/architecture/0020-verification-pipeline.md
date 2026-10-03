# ADR 0020: Complete formatting, lint, static-check, and CI gates

Status: accepted for v0.19.0

## Decision

Add Oxlint 1.86.0 as an exact development dependency. Its native platform bindings are locked with integrity metadata for the supported CI operating systems; it adds no package installation script or new script permission. The existing production dependencies, TypeScript 7.0.2 compiler, Prettier formatter, runtime range, application permissions, and persistence schemas stay intact. This closes the original formatting/lint/static-check/CI item by adding the missing lint stage to the already implemented gates.

`npm run lint` invokes the locked local tool with the committed configuration over repository JavaScript/TypeScript, including TSX, server/shared/client code, source/browser tests, and root tooling. New code files are discovered without maintaining a path list. Generated builds, dependencies, local application data, coverage, and browser reports are excluded. The command never applies fixes. Correctness rules from the core, TypeScript, Unicorn, and Oxc plugins are errors; dynamic evaluation, implied evaluation, and Function-constructor generation are explicitly forbidden. Warnings and unused suppression directives produce a failed command. No external JavaScript plugin or experimental type-aware/type-check mode is enabled.

Prettier continues to own formatting. The existing strict TypeScript compiler, including unused declarations and unchecked indexed access, remains the semantic type gate. Lint adds syntax and configured correctness checks; it does not replace the compiler, the runtime schemas, workflow/provider/browser fixtures, security review, or the uncompleted secret-scanning/accessibility/audit requirements. React compiler and exhaustive-hook analyses are outside this selected rule set; introducing them requires a bounded behavior review of existing synchronization and selection guarantees.

## Verification flow

`npm run check` fails at the first unsuccessful stage: lint → TypeScript → source tests → formatting. CI runs this command after locked installation in every Node 24.19.0/26.10.0 job on Ubuntu, Windows, and macOS, followed by client/server builds and a production dependency audit. Both Ubuntu runtimes additionally install Chromium and run the complete browser suite. Named CI steps identify the combined verification gate; action revisions and read-only workflow permissions remain pinned.

An initial lint finding identified three unsafe optional header dereferences in synthetic OpenAI/xAI/Gemini protocol fixtures. Each fixture now explicitly asserts authentication headers exist before accessing them, retaining every exact authentication/protocol assertion. A single line-scoped exception documents the URL filter's intentionally rejected control characters; the original expression and URL policy are unchanged. Removing the filter or weakening its rendering tests is not a lint fix. Future exceptions must state their reason and remain narrow; stale exceptions fail verification.

Three subprocess integration tests invoke the committed lint options with the same configuration in isolated temporary fixtures. They require nonzero exits for executable dynamic code and malformed syntax, allow quoted model source as inert data, reject unexplained control-character regexes and unused exceptions, discover client/server/browser/root tooling and newly added modules, and exclude generated/local-data paths. The tests never execute fixture code, load the app database, make provider requests, or modify repository source. Child processes have a ten-second bound and require normal exit rather than a timeout/crash. Both supported runtimes/platform bindings are validated through CI.

## Sources and limits

Consulted official [Oxlint overview](https://oxc.rs/docs/guide/usage/linter.html), [configuration](https://oxc.rs/docs/guide/usage/linter/config.html), and [CLI reference](https://oxc.rs/docs/guide/usage/linter/cli.html), plus npm package metadata for exact versions, engines, platform bindings, and integrity. The current typescript-eslint 8.71.0 peer range excludes the repository's TypeScript 7 compiler; do not bypass peer requirements or downgrade the application compiler to add a lint tool. Oxlint runs syntax/configured-rule checks alongside the unchanged compiler.

The configured checks are bounded development safeguards, not a proof of program correctness or complete security. Secret scanning, full dependency/license distribution review, runtime recovery/correction features, broad application accessibility, packaging, and other original checklist items remain open. Version 1 is still prohibited until every original README entry is fully implemented and validated.
