# 0008 — Message presentation and copying

## Boundary

v0.7 treats message bodies from humans, models, and coordinator actions as untrusted presentation data. Stored bodies, invocation snapshots, response sets, author bindings, search input/previews, and exports retain their original strings. Rendering and clipboard writes cannot dispatch agents, change routing, execute tools, or mutate workspace data. Archived history supports the same reading and copying controls.

The client uses pinned `react-markdown` and `remark-gfm` packages to parse CommonMark/GFM into React elements. It does not use `dangerouslySetInnerHTML`, an HTML-to-DOM parser, raw-HTML plugins, MDX, executable highlighting, or a remote rendering service. An explicit tag allowlist covers paragraphs, heading levels, emphasis, lists, quotes, code, links, image placeholders, rules, tables, and task checkboxes. Unsupported wrappers are unwrapped; raw HTML remains escaped text. Custom renderers do not spread untrusted link, image, input, heading, or code properties onto DOM controls.

Message headings map below the single workspace heading. Task checkboxes are always disabled and never submit or modify source state. Fenced and indented code is plain selectable text with a bounded language label, a copy control, and a focusable scrolling container. The language label never selects executable code or a grammar. Wide tables scroll inside a focusable region; neither tables nor code widen the page.

## Links and images

Only explicit absolute `http://` or `https://` links with a valid host are permitted. The URL policy rejects credentials, whitespace/control characters, backslashes, malformed URLs, relative paths, fragments, protocol-relative destinations, and all other schemes. Both the Markdown URL transform and link component apply that policy. Permitted links use `target="_blank"`, `rel="noopener noreferrer"`, and `referrerPolicy="no-referrer"`. They require an explicit click; rendering never navigates or fetches them. Blocked links retain their escaped labels and are not anchors.

Every Markdown image becomes an escaped alt-text placeholder. No image element, `src`, preload, local file request, or remote image fetch is emitted. Images nested inside links still follow the link policy. Raw HTML, SVG, forms, iframes, scripts, inline event handlers, and HTML-like strings in code remain text. The existing production content security policy stays in place; it is additional protection, not the parser's authorization mechanism.

The parser libraries' upstream contracts are documented in the [react-markdown README](https://github.com/remarkjs/react-markdown#security) and [remark-gfm README](https://github.com/remarkjs/remark-gfm). Extending plugins, components, tags, or URL policies requires new adversarial rendering and browser coverage. Do not enable HTML or image loading simply because a model produced it.

## Streaming and failure

While `status` is streaming, the client displays the current body literally with the existing streaming indicator. It does not repeatedly parse unfinished syntax or offer individual code copying during that state. When the attempt ends, the retained body can be formatted, including incomplete code fences from failed, cancelled, or interrupted attempts. The status badge and attempt inspection remain authoritative; formatting never promotes a partial result to completed.

The formatter is loaded as a separate application chunk and unchanged formatted bodies are memoized. A pending module load shows literal source. A rendering/module failure is caught per message and keeps literal source, a short explanation, conversation controls, and whole-message copying available. Fix the load problem and reload to retry; no invisible provider retry accompanies presentation recovery. Source selection and copy feedback are per-view rather than persisted settings.

After a send is acknowledged, the composer clears the sent body and remains busy while loading authoritative workspace history. It selects the accepted thread together with that history, preventing a stale room document from clearing a new thread selection. A draft typed during this refresh is retained, and a thread chosen explicitly during the wait stays selected. A response for a workspace the user has left cannot select a thread in their new workspace. A refresh failure does not resend the acknowledged message.

Context inspection intentionally remains a literal source view. Search previews also stay literal and bounded. Markdown exports contain original source rather than rendered HTML; a separate viewer must enforce its own safety policy.

## Clipboard

`Copy message` captures the current stored body when clicked, without author labels, message numbers, statuses, or other UI text. A streaming copy contains only the text present at that click. Feedback is bound to the copied string, so later stream updates cannot be presented as already copied.

`Copy code` captures the displayed parsed code content without Markdown fences, language labels, or copy-button text. CommonMark parsing normalizes code line endings and may append a final newline; use source view or whole-message copying when the exact stored Markdown string is required.

The application only calls `navigator.clipboard.writeText` on an explicit click. It never reads the clipboard, uses an automatic clipboard action, or injects a legacy HTML copy surface. Missing/denied clipboard access produces a safe application-authored status and leaves text selectable. Whole-message copy failure also opens the source view for manual copying. A later click can retry; provider errors, browser exception text, and clipboard contents are never printed in diagnostics.

## Validation and limits

Rendering tests exercise CommonMark/GFM structure, disabled tasks, hostile HTML/SVG/forms/frames, executable and obfuscated URLs, credentials, non-web/relative destinations, image placeholders without preloads, raw source, empty attempts, incomplete fences, and exact frozen context/routing/search/export preservation. Chromium tests use actual clipboard writes/reads in the test harness, denied/missing API fixtures, a blocked formatter chunk, split HTTP streams, failed partial code, archive/reload, literal search, keyboard scrolling, narrow layouts, and both themes. Clipboard reads exist only in the test harness. Each browser run uses a new temporary database, so repeated runs cannot inherit earlier test workspaces. Both supported Node runtimes run the full suite; CI covers Linux, Windows, and macOS.

Attachment upload/previews, inline images, highlighting, mathematical typesetting, diagram rendering, and scoped internal footnote navigation remain outside v0.7. Message and provider output bounds remain unchanged. Pagination and large-history policies remain separate work.
