# 0009 — Coordinator capability tests

## Scope

v0.8 adds an explicit **Test coordinator** beside **Test connection** in participant settings. A greeting verifies ordinary text generation only. The coordinator check exercises the saved model/server's native structured-output path and requires a completed finish decision. It never starts a discussion, asks another participant, or changes a capability grant.

This is an optional, human-clicked probe. It does not gate normal discussions or claim that an account/model supports every future action, context size, peer request, or output limit. A failed check is a visible failure, not a permanent unsupported classification.

## HTTP and input

The existing authenticated `POST /api/rooms/:roomId/connection-test` accepts a strict body with `agentId` and optional `kind: greeting | coordinator`. Omission retains the greeting behavior. Unknown modes, extra fields, foreign identities, inactive participants, archives, and service shutdown fail before invocation. The existing session, Host, Origin, JSON-content-type, and body-size rules apply.

The probe uses the current saved participant binding and role plus roster identities/roles. Objective, thread messages, included answers, and missing respondents are empty. A coordinator probe supplies a transient decision input with no allowed peer IDs and capacity only to finish. This input never becomes a stored grant, snapshot, request, message, attempt, or workflow.

Native output schemas retain string items when no peers are granted, avoiding an invalid empty enum. Nonempty grants still restrict items to the allowed IDs. Schema acceptance cannot authorize routing: the engine independently checks the completed action, and a probe has no dispatch path.

## Completion and errors

Success requires exactly one action followed by provider completion. The same strict six-field action schema used by discussions checks types, unknown fields, nonempty body, and the 20,000-character bound. The probe additionally requires `kind: finish`, `recipientIds: []`, `policy: all`, `quorum: 1`, and `replyTo: null`.

An ask, plain-text delta, duplicate action, invalid object, refusal, missing completion, malformed structured response, or unsupported protocol cannot count as success. Native adapters buffer partial JSON privately and apply their existing completion, refusal, truncation, and output-size rules. There is one invocation per click and no correction, automatic retry, greeting fallback, or simulation fallback. A later click starts a new explicit probe.

Unexpected exception details, raw action objects, raw provider errors, and refusal text are excluded from diagnostics. Known application-authored provider/action failures remain actionable. Aborts and timeouts have explicit messages. Connection-check replies remain React text; formatting never creates routing or execution authority.

## Resource and lifecycle boundary

Both probe kinds share one active invocation per participant and the existing global limit of four. Queued normal generation waits while its participant is being checked. Normal dispatch and probes share the same capacity accounting. Workspace/roster/configuration edits and archive remain blocked while any workspace probe is active.

A check uses the smaller of 30 seconds and the saved participant timeout. Workspace deletion and service shutdown abort it; late events cannot report success or recreate records. Cleanup releases the participant slot on success or failure. Aborting the local request cannot guarantee remote cancellation or refunded billing. Closing the settings view does not cancel an already submitted probe; it remains bounded by its timeout.

No probe consumes room turns or persists usage/history. A remote provider may bill it separately. The user-facing explanation identifies what is transmitted and the charge possibility before either button is used.

## Results

Success returns the probe kind, a bounded reply, requested provider/model, saved configuration revision, and server-generated test time. These are the requested binding, not a claim about an unreported provider-side model alias. The coordinator UI names that binding and time and explicitly labels simulation. It does not display an invalid action body.

Results are per-form feedback. An edit or another action clears them; reopening or reloading also clears them. They are not persisted as a current capability flag. A result explicitly belongs to its recorded revision/time, including when another view changes settings afterward. Capability catalogs and durable records need a separate freshness/invalidation policy.

## Validation

Service tests cover completion gating, all native structured envelopes, valid empty-peer schemas, no history/objective transmission, strict finish validation, plain text, duplicate actions, refusal/failure/incomplete streams, unsupported protocols, redacted errors, explicit retries, concurrency, normal queued work, archive/roster locks, scope, inactivity, timeout, deletion, and shutdown. HTTP coverage retains optional greeting compatibility and verifies authentication/origin/body validation before invocation.

Chromium coverage checks the distinction between a successful greeting and failed coordinator action, a later explicit successful probe, exact unchanged conversation records, simulation labels, configuration revisions, saved-settings gating, result clearing/reload, narrow layouts, and archived disabled controls. Protocol fixtures are synthetic; paid accounts and installed local models still require separately authorized live smoke tests.
