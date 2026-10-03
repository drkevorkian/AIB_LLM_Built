# ADR 0017: Versioned workspace instructions and frozen context

Status: accepted for v0.16.0

## Decision

A workspace owns a shared objective and human instruction text. Creation records revision zero with the creation time. A successful objective or instruction change appends one full revision in the same SQLite transaction as the current settings and audit event. Instructions preserve exact whitespace and Unicode, are bounded to 3,000 JavaScript string characters, and can be cleared. Name, turn-limit, and request-limit edits alone do not advance the instruction revision. History belongs to the workspace; thread deletion retains it, and whole-workspace deletion removes it.

Settings submits the instruction revision reviewed by the user. A stale revision produces HTTP 409 before settings, history, or audit changes. The user returns to the conversation and reopens Settings to review current instructions before another save. Dirty forms retain their original review and text across server events. This check is optional in the HTTP schema for older clients; it does not claim a mandatory compare-and-save contract for every legacy API caller. Omitting the instruction field in an older settings request preserves its saved value. Strict schemas reject forged history and unknown fields.

Pending jobs, unfinished workflows, connection probes, shutdown, and archives retain their existing editing guards. Editing after Stop does not resume work, cancel further transports, refund turns, dispatch a request, or grant additional authority. History remains readable in archived workspaces, outside the disabled editing fieldset.

## Invocation provenance

New requests snapshot the current objective, exact human instructions, instruction revision, and participant configurations. Explicit retries use that original snapshot. Synthesis collection/retry, fixed-relay hops, discussion peers, subsequent coordinator turns, and bounded invalid-action corrections inherit the submitted instruction/objective and roster binding. They do not read current settings to fill or replace an earlier binding.

All five native provider protocols receive the frozen instruction fields through the common prompt envelope. They guide the response alongside the recorded role and objective. Peer answers and quoted context are data; they cannot edit human instructions. Human instructions cannot extend application-controlled identities, routing, tool permissions, or execution authority. Protocol tests use injected synthetic streams without credentials or remote calls.

The 64,000-character snapshot check includes the objective, instruction text, and retained message bodies. There is no silent truncation or summarization. Existing per-command, role, and output bounds still apply. Greeting and coordinator capability probes contain only the test objective/request and recorded participant roles; their snapshot objective is empty and instruction text/revision/history are absent. They do not consume conversation turns or create durable instruction/context records.

## Legacy data and presentation

Room schema 1 and SQLite schema 2 remain. Optional fields permit old documents without a destructive migration. Read-only inspection of a legacy workspace returns its known current objective/instructions as a recovered record, with unknown edit time. A subsequent edit retains that known record and appends the new timed revision. Earlier unrecorded edits cannot be invented. Old snapshots without instruction fields retain those absences through display, retries, and continuation; current settings never backfill old provenance.

Native labeled inputs edit exact text. Native details show retained revisions as escaped React text, with wrapping and bounded scrolling, keyboard access, and narrow light/dark layouts. The snapshot inspector shows the frozen instruction text/revision or explicit legacy uncertainty. Markdown export includes JSON-encoded workspace instruction history and instruction revision references for messages with snapshots; it preserves the original message body. Settings and live-provider notices explain what instructions are transmitted and that probes omit them.

## Validation and remaining work

Twenty-three new source tests cover creation/revisions, no-op and name/limit edits, clearing, strict bounds, stale saves, older clients, current roles, original retries and all continuation kinds, context limits, probe isolation, archive/pending guards, legacy persistence, SQLite rollback, HTTP protections, export, and all five native envelopes. Four isolated Chromium flows cover creation/editing, readable safe history, drafts, narrow themes, real service restart, old/new invocation inspection, pending/archive controls, paused restoration, and two-view stale reviews. An existing participant-removal regression now uses an advancing clock; removal and its revision share one timestamp rather than sampling separately.

Large-history pagination, summary/context budgets, instruction-change interjections, stale-output annotation, restricted contexts, broader accessibility audits, packaging, and the remaining README entries stay open. No runtime, dependency, license, provider permission, or release-gate changes occur.
