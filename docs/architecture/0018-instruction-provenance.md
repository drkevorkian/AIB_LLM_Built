# ADR 0018: Read-only instruction staleness

Status: accepted for v0.17.0

## Decision

Derive instruction provenance from each model output's actual snapshot and current retained workspace/author configuration. Keep this projection outside the persisted message status, scheduling, collection, cancellation, and provider contracts. A stale result describes superseded instruction inputs, independently of whether its original attempt completed, failed, refused, was cancelled/interrupted, or is streaming. Human and system messages do not receive model-output notices.

Workspace revisions are ordered instruction versions. A lower frozen revision is stale, including when a later revision restores the exact text. Equal versions with exact objective/instruction text match current records. Missing snapshot text/version is unknown; a known legacy objective or instruction-text difference can prove staleness without inventing the missing revision. Invalid, future, or inconsistent same-version records are unknown. Missing current legacy fields use the documented current defaults, without backfilling old snapshots.

Author-role comparison uses the exact retained participant ID. Different role text proves a changed instruction. If the role text matches but the configuration revision advanced, inspect all retained intermediate revisions. An intervening role change proves supersession even after text is restored. A complete unchanged-role revision chain establishes current role instructions; gaps establish uncertainty. Count distinct bounded recorded revisions rather than iterating a numeric range. Duplicate, foreign, or out-of-range records cannot fill gaps. Missing snapshot, author, or role/configuration metadata stays unknown.

Renames, provider/model/connection edits, activation/removal metadata, output/timeout edits, and workspace name/limit edits alone do not supersede instructions. Peer role edits do not change another author's own role instructions. The scope is workspace objectives/human instructions plus the invocation author's role, not a semantic assessment of every quoted source or peer configuration.

Combine workspace and role evidence: proven staleness remains visible even if another component is unknown; otherwise unknown evidence prevents a current label. Current means a match to recorded instruction inputs, not a judgment about answer quality or comprehension. Neither message prose nor names select this state.

## Interface and export

Messages show an application-owned, non-live note for stale or unknown provenance. Context inspection also shows current comparisons beside the exact frozen instructions. Explain the reason with safe revision numbers and fixed text, without adding current unused instruction/role content. Use native existing inspection, source, copying, and reply controls. Preserve drafts, selected threads, original attribution, keyboard focus, readable narrow layouts, and both themes.

The existing retry control warns about stale/unknown recorded instructions. Explicit retry retains the original snapshot, model, role, source set, and policy. A new question uses current settings. A reply to a completed historical answer remains eligible under existing controls and includes the original text under current instructions. Archives allow reading/copying/inspection while preserving their editing/invocation locks.

Markdown export uses the same projection and labels its instruction provenance and original outcome separately. The annotation is a current comparison at export time; stored bodies and provider context never include the added notice. Missing legacy provenance is explicit. Existing authentication, no-store headers, workspace scope, and original-body/credential guarantees apply.

## Authority and persistence

No message, request, job, response set, snapshot, workflow, audit event, or turn record is changed by comparison, rendering, inspection, or export. There is no migration, stored stale flag, automatic cancellation/retry/resume, rewritten context, new provider call, or grant. Settings and roster edits retain their quiescent-workspace/probe/archive locks. A retried old request remains a request against its original requirements.

Active-work interjections, explicit task/message supersession, revised obligations, stale-result dependency exclusion, regeneration, and general uncertain-result presentation stay unfinished. This iteration completes only the original stale-instruction-output checkbox. Their future implementation must separately define scheduling authority and transactional correction policies rather than treating this read-only annotation as a control event.

## Validation

Twenty-two new source tests cover read-only projection, workspace/role text restoration, unrelated edits, exact identities, incomplete/duplicate/foreign history, legacy known/unknown fields, inconsistent/future/large revisions, all model message/outcome variants, inert readable rendering, real completed/failed/retried/cancelled output, closed relay/synthesis/discussion provenance, SQLite restart, export authorization/scope/no-store, and unchanged body/context/usage/provider bindings.

Four isolated Chromium flows cover cross-view instruction changes and drafts, safe notices, keyboard inspection, exact source/copy/export, fresh current requests, name/connection counterexamples, role restoration, failed frozen retries, archive/narrow themes, real service restart, and an explicit legacy response fixture at the read boundary. The legacy browser fixture transforms only the served response; source tests separately validate real retained legacy documents. All automated providers remain simulation or controlled adapters, with isolated data and blank cloud keys.

There are no dependency/runtime-range/schema/license/provider-permission changes. Large-history performance/pagination, broader accessibility/assistive-technology audits, semantic answer invalidation, and the rest of the original README remain open.
