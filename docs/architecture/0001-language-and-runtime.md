# ADR 0001: TypeScript for the first implementation

Status: Accepted for v0.1.0.

## Decision

Use TypeScript across the graphical client, local application service, conversation engine, shared contracts, and tests. Use React for the interface, Node.js 24 for the service, and SQLite through an isolated persistence class.

TypeScript is the best fit for this project's first implementation because the dominant problems are message contracts, concurrent I/O, interface state, and provider integration. Sharing validated contracts between the service and client reduces the chance of routing and state fields drifting apart. Most work waits on provider responses rather than performing CPU-heavy computation.

## Alternatives considered

| Language   | Assessment for this application                                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript | Selected: one language for service, UI, adapters, and a possible future browser extension; typed message contracts and an asynchronous runtime.                                   |
| Python     | A strong engine option, but a React client would introduce a second language and duplicated cross-boundary contracts. A native GUI remains viable if product requirements change. |
| Rust       | Useful for a later native shell or isolated execution service. Its additional implementation effort does not address the immediate conversation-flow risks.                       |
| C#         | Suitable for a desktop service, but less direct for this application's planned browser-facing client and adapter reuse.                                                           |

These are project-specific engineering judgments, not claims that one language is universally better.

## Implementation choices

- Class-based `ConversationEngine`, `RoomStore`, and `SimulatedProvider` own domain behavior and resources.
- React function components own presentation and local view state.
- Zod validates untrusted commands at runtime; static types do not replace runtime checks.
- Vite provides client development and bundling. `node --import tsx` runs development source without manually rebuilding the server after edits; restart the service to pick up server changes.
- Production builds emit JavaScript for the service and bundled client assets.
- A desktop shell is deferred. The v0.1.0 interface opens in a local browser at a loopback address.
- Browser-provider automation and remote multi-user hosting are deferred to separately verified milestones.

## Persistence tradeoff

The initial `RoomStore` saves a versioned room document transactionally in SQLite. Each document contains messages, jobs, requests, snapshots, and audit events. This is deliberately a single-service design. A separate SQLite writer lease prevents two application processes from scheduling the same data directory; the operating system releases the lease after a crash.

This is not a multi-worker event-sourcing system. Large-history pagination, compacted snapshots, normalized entity tables, migrations, and backup tooling remain on the roadmap.

The tested Node version is 24.19.0, with a minimum of 24.15.0. Node's built-in SQLite API is a release candidate in this series. The `RoomStore` boundary permits replacing the driver without changing the engine or client. Reassess that driver before a production release.

## Sources consulted

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/)
- [React documentation](https://react.dev/learn)
- [Node 24.19 SQLite documentation](https://nodejs.org/download/release/v24.19.0/docs/api/sqlite.html)
- [Vite documentation](https://vite.dev/guide/)

Dependencies are locked in `package-lock.json`. The decision does not promise indefinite compatibility with unpinned future releases.
