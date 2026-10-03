# ADR 0019: Immediate human interjection records

Status: accepted for v0.18.0

## Decision

A human can publish an explicitly addressed interjection while conversation work is queued or active. The strict send command requires at least one distinct active recipient, a normal/urgent priority label, and an explicit `record_only` or `pause` dispatch policy. It rejects response collection, synthesis, relay, and discussion combinations. The existing human-message contract bounds text to 12,000 characters and trims surrounding whitespace; the validated stored body remains the source for display, copying, snapshots, and export. Human instructions remain separately versioned exact text.

One SQLite transaction records the human message, its sequence and stable identity, the queued/running job IDs observed across the workspace, a `human.interjected` event referencing its identity/thread/recipients/priority/policy, the normal delivery event, and any requested room pause. The command waits for storage commit rather than a provider response or stream cleanup. A failed write retains no message, event, sequence change, pause, or change notification. Recording consumes no turns, reserves no new work, invokes no provider, and creates no response obligations. Prose cannot manufacture a control event.

All messages retain room visibility; selected recipients identify the addressed humans' intended participants, rather than restricting read access. Normal and urgent are retained human priority labels. They do not change queue order, confer a grant, route an automatic reply, or claim that a participant understood the message. New questions include complete retained interjections as room-visible human context, alongside room updates and the selected thread. The shared context limit still rejects oversized new requests atomically without truncation.

## Control boundaries

`record_only` retains the current room state. `pause` changes the room to paused in the same transaction, holding new conversation dispatches across the entire workspace. Active work may finish. Its result can still satisfy the original request, and a synthesis, relay hop, or discussion continuation can be created against the original frozen context while dispatch remains held. Queued/running jobs, snapshots, instruction versions, grants, answer eligibility, response deadlines, and workflow obligations are never rewritten by the interjection. Existing wall-clock deadlines continue while paused.

Resume continues valid original work. Stop cancels work under the existing best-effort policy; asking a new question after resuming creates new obligations with the current settings and recorded input. Interjections in stopped rooms require Resume; archives retain their reading/copying/inspection locks, and shutdown rejects new interjections. Probe controls and provider permissions remain unchanged.

UUID replay returns the original message without applying its pause again, even after Resume. A changed body, addressing, priority, or policy under that UUID conflicts. Omitted/null interjection fields are excluded from ordinary send hashes, preserving previous clients' replay contract. A deleted interjection cannot be recreated by delayed replay. Thread deletion follows the existing copied-source redaction and affected-work cancellation policy; whole-workspace deletion removes the record.

Restart retains interjections, their events, source text, and original queued snapshots. Standard recovery records its own events and pauses unfinished rooms; interrupted work requires explicit retry. Recording-time job references are historical observations rather than current queue inspection, ownership claims, or replacement obligations.

## Interface and export

The composer offers Human interjection, native labeled priority/policy selectors, recipients, and Record interjection. The default policy pauses new dispatches. It explains that priority is descriptive, active work may finish, old context remains frozen, and revised work requires Stop plus a new question. A paused room still records immediately rather than labeling this action Queue. The existing acknowledged-send refresh, thread-selection guards, lost-response draft retention, and stable UUID handling apply.

Messages and context inspection show an inert application-authored note with the recorded priority/policy and queued/active counts at recording time. This is independent of current room status and message-body formatting. Source/copy/export retain the original stored text. Markdown export includes recording-time policy metadata separately from the body. Archived/narrow light/dark views retain reading and keyboard inspection without granting editing authority. No extra live announcement, HTML execution, remote image load, provider call, or clipboard read is introduced.

## Validation and remaining work

Fourteen source tests cover immediate recording during active parallel work, optional pause/record-only behavior, immutable synthesis/relay/discussion bindings, fresh cross-thread context, forged/malformed control rejection, UUID conflict and replay after Resume, previous send hashes, injected SQLite rollback, real persistence/restart, source deletion/replay, archive/Stop/shutdown guards, unchanged deadlines, authenticated HTTP/export, and inert presentation. Three isolated Chromium flows cover active work, multiple views and drafts, exact source/copy, frozen inspection, lost acknowledgements/replay, no-generation record-only input, keyboard controls, archive/narrow themes, and a real service restart. Providers are controlled fixtures or simulation with cloud keys cleared.

This completes only the original immediate human-interjection recording item. Task correction/supersession, revised requirements and obligations, scope-specific human-input pauses, stale-result dependency exclusion, explicit regeneration, and discussion context revision remain open. Recording a note or pausing dispatch is not an implementation of those policies. No dependency, runtime range, database schema, license, or release-gate change occurs.
