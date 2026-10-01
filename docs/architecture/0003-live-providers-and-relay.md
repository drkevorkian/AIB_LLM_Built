# ADR 0003: Live text providers and bounded relay

Status: Accepted for v0.2.0.

## Connections

`LiveProviders` selects an adapter from each invocation's frozen participant binding. Production requests use Node's native `fetch`; no browser automation or signed-in website session is involved. Simulation is an explicit provider choice and is never a fallback for a failed live request.

| Provider          | Protocol                           | Credential environment            | Endpoint policy                                   |
| ----------------- | ---------------------------------- | --------------------------------- | ------------------------------------------------- |
| OpenAI            | Responses API, semantic SSE events | `OPENAI_API_KEY`                  | Official `api.openai.com/v1` only; `store: false` |
| Grok/xAI          | Chat Completions, SSE              | `XAI_API_KEY`                     | Official `api.x.ai/v1` only                       |
| Gemini            | `streamGenerateContent`, SSE       | `GEMINI_API_KEY`                  | Official Google endpoint; key in header           |
| Ollama            | `/api/chat`, NDJSON                | None                              | Loopback HTTP/HTTPS only                          |
| OpenAI-compatible | Chat Completions, SSE              | Optional `AIB_COMPATIBLE_API_KEY` | Explicit HTTPS or loopback HTTP base URL          |
| Simulation        | Deterministic local generator      | None                              | No external calls                                 |

Only text generation is supported. v0.3.0 adds native structured coordinator actions under [ADR 0004](0004-bounded-agent-discussions.md). Tools, images, attachments, and provider-maintained conversations remain unsupported. The server model catalog is a convenience; an exact compatible text-generation model ID is still required. Catalog pagination/capability filtering remains planned.

Official contracts used for the implementation:

- [OpenAI Responses streaming](https://developers.openai.com/api/docs/guides/streaming-responses)
- [xAI Chat Completions](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions)
- [Gemini content generation](https://ai.google.dev/api/generate-content)
- [Gemini authentication](https://ai.google.dev/api)
- [Ollama chat](https://docs.ollama.com/api/chat)

## Completion and errors

Stream framing handles arbitrary UTF-8 boundaries, CRLF, multiline SSE data, and NDJSON. OpenAI requires `response.completed`; chat-completion providers require `finish_reason: stop`; Gemini requires `STOP`; Ollama requires `done: true` and rejects non-stop completion reasons. A non-empty answer is also required by the engine. Truncation, refusal, malformed frames, missing completion, and unsupported tool actions cannot release synthesis or the next relay hop.

Provider response IDs and reported token usage are recorded when available. Provider errors are replaced with application-authored explanations: raw error bodies, network exception details, and API keys do not enter diagnostics. Redirects are rejected. Cancellation closes the local stream; remote work/billing may continue. No generation request is automatically replayed.

## Configuration and transmission

API keys are read only by the service from its environment. The source-run scripts also load an optional ignored `.env` file. Plaintext `.env` storage is a convenience, not an encrypted keychain. No key management UI or secret database has been added.

Bindings store names, roles, requested models, endpoint URLs, output limits, timeouts, and revision numbers. Invocation snapshots retain the exact binding used. Complete standalone revision history for never-invoked configurations remains planned. Editing is blocked while jobs, unresolved relays, or unfinished discussions remain pending. Explicit retries retain the original context/binding; new questions use newly saved settings.

A live turn transmits its shared objective, roster names/roles/IDs, frozen source messages with author IDs, current request, and relevant collection metadata. Peers' source text is supplied as attributed data, not additional system-role messages. The application's routing permissions and relay order cannot be changed by generated prose.

The connection test generates a short greeting with the selected binding and participant roles, but no thread history or objective. It may be billed and does not consume a room turn. It is serialized with that participant's normal generation. Tests and protocol fixtures do not establish that a particular user account, API key, or model is available.

## Relay

The human selects a finite order. Completed responses are delivered automatically to the next selected participant with exact reply links and cumulative frozen context. This makes real cross-model exchange usable while preserving the existing turn, stop, and recovery guarantees. Bounded coordinator discussions are implemented in v0.3.0. Nested delegation, dynamic conferences, and browser-session connections remain separate milestones.
