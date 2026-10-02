# ADR 0012: Message-scoped footnote navigation

Status: accepted for v0.11.0. Extends [ADR 0008](0008-message-presentation.md).

## Decision

Completed and terminal partial messages support GFM footnote references and backlinks. An explicit click or native button keyboard activation moves focus and scrolls to the selected note or reference inside that formatted message. It never changes the URL, fragment, browser history, workspace, thread, draft, provider request, or stored conversation. Streaming and source views remain literal, and formatter failure retains readable original text.

The installed GFM parser supplies a footnote section, numbered references, definitions, and backlinks. A presentation-only rehype plugin recognizes that generated graph; it does not parse raw HTML. Each mounted `MessageText` owns a React `useId` namespace, retained when switching between source and formatted views. The formatter assigns numeric definition/reference IDs inside that namespace. Neither author-supplied labels nor parser-generated IDs are copied into the DOM. Identical labels in different messages therefore cannot collide. A full reload may allocate new IDs; no link is persisted or exported.

Repeated references have separate labeled buttons and separate backlinks. Parser IDs can collide between the second occurrence of `[^a]` and the first occurrence of `[^a-2]`. Forward edges use the parser's note number and validated definition destination; backlinks resolve within their own definition's references. A global map of original parser IDs would route this case incorrectly. Missing/malformed references remain text, unused definitions follow the parser's normal omission rule, and cyclic references create finite controls without automatic navigation. View source retains all original syntax.

The generated heading labels the footnote section without introducing another top-level heading. Reference buttons identify the note and occurrence, and backlink buttons identify their exact reference. Notes accept programmatic focus through `tabIndex=-1`; normal keyboard tab order includes only the buttons. Focus indicators are visible, and scrolling is immediate without an animation. Focus lookup stays inside the currently connected formatted-message root rather than using a document-wide ID lookup.

## Trust and bounds

Only graph nodes recognized by the plugin's weak maps receive application-authored IDs, labels, targets, and handlers. No user node properties are spread onto these controls. Raw HTML and attribute imitations remain escaped text. Ordinary authored fragments—including an exact known application footnote ID—relative URLs, executable schemes, and credential-bearing URLs remain blocked by the unchanged web-link policy. The renderer makes no generic fragment exception. Safe HTTP(S) links in notes retain isolated new-tab attributes; image references remain placeholders without resource loads. Code and task lists keep the existing inert presentation rules.

Navigation is limited to 100 referenced definitions and 300 reference occurrences per message. Above either bound, the parsed notes remain readable with an application-authored notice, and all footnote references/backlinks become inert labels without navigation IDs. The bound limits interactive navigation metadata and controls; it is not a total Markdown-node or whole-history performance limit. Existing message/provider output bounds remain unchanged, and the source body is never truncated or rewritten by this feature.

The message body is still untrusted data with no routing or execution authority. Copy message, stored history, frozen provider context, search, and Markdown exports retain the exact body. Navigating a note cannot dispatch, repair, retry, complete a failed attempt, consume a turn, or mutate an archived workspace. No dependencies, runtime ranges, schema, storage format, or permissions change.

The primary parser contracts are the [react-markdown security documentation](https://github.com/remarkjs/react-markdown#security) and [mdast-util-to-hast footnote documentation](https://github.com/syntax-tree/mdast-util-to-hast#footnotes). Graph recognition also follows the exact versions in the lockfile; dependency changes require reviewing these assumptions and running the adversarial suite.

## Validation and remaining scope

Rendering coverage checks message isolation, repeated/colliding/Unicode/long labels, spoofed HTML and fragments, inert note content, missing/unused/cyclic syntax, both navigation bounds, literal streaming/source, and exact frozen context/search/export preservation. Three isolated production-service Chromium flows check Enter/Space focus in both directions, URL/history isolation, source-toggle IDs, copying, narrow screens, both themes, archives/reload, unsafe resource/route imitations, the over-limit fallback, explicit stream completion, and failed partial status/context without automatic retry. Formatter-module failure also contains footnote source.

An existing deletion test now waits for the exact simulated request's authoritative synthesis completion before retaining its strict enabled-reply assertion. This addresses a default five-second wait observed failing under CI load on the prior documentation commit; it does not change application completion rules or accept an unfinished answer.

Broader application accessibility/contrast and real assistive-technology/touch-device audits remain open. Math, Mermaid rendering, highlighting, attachments, and long-history performance are separate unfinished README items. This remains a 0.x iteration, with every README checklist item required before version 1.
