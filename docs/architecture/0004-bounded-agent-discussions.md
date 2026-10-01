# ADR 0004: Bounded agent-chosen peer discussions

Status: Accepted for v0.3.0.

## Scope and permission

A human starts **Agent discussion** by selecting one coordinator, 1–10 peer rounds, a 2–50 turn allowance, and a 5–600 second response deadline. The entire allowance is reserved against the room limit before any invocation. Any of the three participants can coordinate; the other two become its permitted peers. The root request cannot mix discussion with relay or separate synthesis.

The coordinator may ask one or both peers, select all/any/quorum, target an exact completed answer, or finish for the human. Peers answer normally without routing permission. The application assigns authorship, thread, timestamps, ordering, and job ownership. Models cannot change permissions, participants, turn limits, controls, or invoke tools.

Nested delegation and a fair conference speaking queue need their own dependency and permission design. They are outside this iteration.

## Structured output contract

The coordinator returns exactly one object with all six required fields:

```json
{
  "kind": "ask",
  "body": "Review your answer and identify a specific regression test.",
  "recipientIds": ["peer-c-id"],
  "policy": "all",
  "quorum": 1,
  "replyTo": "peer-c-answer-id"
}
```

`kind` is `ask` or `finish`. An ask requires nonempty, distinct IDs from the granted peer set, a question up to 12,000 characters, and a possible quorum. `replyTo` may be null or a completed source message in the discussion thread and the coordinator's supplied snapshot. Following up to a peer answer must include its author among the recipients.

A finish has a nonempty final body up to 20,000 characters, `recipientIds: []`, `policy: all`, `quorum: 1`, and `replyTo: null`. Its message goes to the human. A coordinator can finish immediately without consulting peers. Repeated normalized questions to the same recipient set/policy are rejected even if a model changes the reply link.

Native adapters request JSON Schema output:

| Provider                          | Request field                                                     |
| --------------------------------- | ----------------------------------------------------------------- |
| OpenAI Responses                  | `text.format`, type `json_schema`, strict schema                  |
| xAI / compatible Chat Completions | `response_format.json_schema`, strict schema                      |
| Gemini `streamGenerateContent`    | `generationConfig.responseFormat.text`, JSON MIME type and schema |
| Ollama chat                       | `format`, JSON Schema                                             |

The requested model/server must support that structured-output protocol. Catalog discovery and a successful plain-text greeting do not establish this capability. An unsupported request fails visibly; no plain-text or simulation fallback is attempted. v0.8.0 provides a separate [coordinator capability test](0009-coordinator-capability-tests.md) requiring a completed finish decision for the saved binding. Capability catalogs and account/model-specific smoke tests remain TODOs.

The adapter privately buffers at most 128,000 characters of structured output. It requires the normal provider completion event before parsing and yielding an action. The engine then independently validates the schema, identities, reply scope, limits, and repeated-question check before any dispatch. Partial action JSON is never exposed as answer text. Source messages and peer answers remain attributed data; their routing-looking prose never becomes an action.

Official references used for native request contracts:

- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [xAI structured outputs](https://docs.x.ai/developers/model-capabilities/text/structured-outputs)
- [Gemini Generate Content structured outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
- [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)

## Durable sequence and collection

The root message, grant, initial decision request, frozen context, and coordinator job commit together. A completed valid ask commits its attributed question, a peer request, shared snapshot, and all peer jobs in one transaction. The coordinator decision is complete; the overall discussion remains waiting for peers.

Peer jobs receive the same snapshot and no sibling answer channel. Each peer answer replies to the coordinator's exact question and is addressed to the coordinator and human. The response set closes with immutable included IDs under all/any/quorum. Only that closed set is appended to the coordinator's next frozen snapshot. Included and missing respondents are supplied separately. Late answers stay visible without rewriting the continuation.

The submitted objective, source context, and participant bindings stay frozen throughout. Later human updates do not silently revise a granted workflow. Explicit correction/interjection policies remain planned.

A valid finish records the final result ID and completes the discussion. Queued/running late peer jobs are cancelled; completed late answers stay preserved. No late event may reopen or extend the finished discussion.

## Bounds and recovery

Every started coordinator decision, peer invocation, automatic correction, or explicit retry consumes both a room turn and a discussion turn. An ask must leave capacity for all chosen peers plus the next coordinator decision, including already-queued work. Failed invocations retain their used turns. Reserved unused turns are released on finish or cancellation. A blocked discussion retains its reservation until explicitly stopped or recovered.

A confirmed completed but invalid action may receive **one new correction invocation per decision request**, linked to the original attempt, using the original snapshot and an application-authored correction reason. It consumes the reserved allowance and shares the decision's existing deadline. A second invalid action, or insufficient remaining allowance, blocks the discussion. Invalid raw action text is discarded; the attempt, error, provider ID, and reported usage remain inspectable. Manual retries retain the existing three-attempt chain limit.

Provider failures, refusals, incomplete streams, and uncertain network outcomes are not automatically retried. They block the required barrier. An eligible explicit retry uses the original context and remaining allowance. Remote reconciliation remains unimplemented; another invocation may incur another charge.

Pause lets active work finish but holds new peer/continuation dispatch. **Stop discussion** cancels only that discussion and releases its unused reservation; unrelated room work remains intact. Room Stop cancels all unfinished discussions. Resume cannot recreate cancelled jobs. Aborting local HTTP does not guarantee that remote processing or billing stops.

Each decision and peer response set has a persisted wall-clock deadline, including queue/pause time. A deadline cancels the entire affected discussion, preserves completed/partial messages, and pauses the room. Restart pauses unfinished rooms, retains queued jobs/grants, and marks previously running jobs interrupted without replay. Retrying an interrupted coordinator is an explicit action.

Context limits remain 64,000 characters without summarization or silent truncation. If a successful decision or peer set cannot fit its next snapshot, completed messages remain successful and the discussion becomes blocked with a capacity explanation. Stop and start a shorter thread.

## Validation

Engine tests cover completion-gated dispatch, independent peer snapshots, all/any/quorum closure, exact-message targeting, thread/context scope, forged identities, quoted routing, single correction, limits, repeated questions, failures, explicit retries, stop races, reservation release, deadlines, and queued/interrupted restart recovery. Native provider fixtures check every structured request envelope and completion/parser behavior.

The browser fixture exercises six production HTTP invocations: coordinator question → B/C answers → coordinator follow-up to C's exact answer → C review → coordinator finish. It verifies accepted action/usage inspection, reload, per-discussion stop, plain-text rendering, and narrow layout. These are synthetic protocol fixtures, not verified paid accounts or an installed reasoning model.
