# 0011 — Panel layout and browser preferences

## Boundary

v0.10 adds presentation-only panel sizing and compact disclosures. The service remains authoritative for all routing, grants, history, context, retries, and consumed/reserved turns. Resizing, collapsing, and resetting never send a conversation command or invoke a provider. No dependencies, runtime ranges, or database versions change.

The conversation and composer remain in their original mounted position. Panels use visibility rather than remounting or moving children when Settings, viewport size, or disclosure state changes. Existing draft, reply, thread-choice generation, acknowledged-send refresh, streaming scroll, and queue freshness behavior must remain intact.

## Desktop sizing

Above 1000 px the grid has navigation, an 8 px divider, a conversation, an 8 px divider, and participant activity. Default navigation/activity widths are 200/250 px through 1180 px, 238/292 px through 1649 px, and 265/320 px thereafter. Navigation is bounded to 180–420 px; activity to 230–480 px. The conversation retains at least 400 px. When desired side widths exceed the available space, their flexible space above minima shrinks proportionally. A ResizeObserver measures the actual workspace width.

Focusable vertical separators name/control their panes and expose current/minimum/maximum pixel values, a readable pixel value, instructions, and a visible focus state. Left/Right move the divider geometrically by 10 px (50 with Shift); the activity pane therefore shrinks when its divider moves right. Home/End choose the controlled panel's current bounds. These semantics use the [WAI-ARIA window splitter guidance](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/) for named, controllable separators. Desktop panes retain minimum widths; pane collapse is a separate compact-layout control.

Pointer capture keeps the active gesture attached to its divider after leaving it. Movement changes the open view; release saves the chosen view widths. Escape, pointer cancellation, lost capture, or transition to Settings/compact layout cancels an unfinished gesture and restores its original preference without saving. Keyboard adjustments save immediately. A deliberate adjustment after viewport fitting adopts both currently displayed side widths, rather than unexpectedly resizing against a hidden wider-screen width.

## Preferences and compact layout

`aib-panel-layout` in localStorage contains only `{ version: 1, navigation, activity }`. Both widths must be integer numbers within their bounds, with exactly the three supported fields. Missing, malformed, unsupported, or unreadable values use responsive defaults. A blocked/quota-exhausted write or removal leaves a usable view with a visible unsaved notice. Preference reads do not rewrite invalid data. Reset in Settings removes the preference, returns to defaults, and opens compact panels.

Viewport fitting itself never persists. A preferred wide-screen width reappears when space returns. Storage is per browser origin, read by each new/reloaded view; live synchronization across existing tabs is not promised. Theme remains the separate existing preference. Service defaults and room records are unaffected.

At 1000 px and below, saved widths are ignored and separators leave the focus order. The existing two-column tablet layout and stacked phone layout apply. Named Hide/Show buttons with expanded/control attributes independently disclose navigation and participants. Panels start expanded; choices remain local to the mounted view. Desktop always displays both panels, without erasing the compact choices. Settings remains available with navigation collapsed. Conversation response counts, workflow cards, workspace Stop, and Stop discussion stay outside collapsible panels; their controls wrap within the conversation.

## Validation and limits

Five isolated production-browser flows cover keyboard direction/steps/bounds/focus, pointer capture and cancellation, preference/reload/reset, malformed and unavailable storage, desktop fitting, tablet/phone disclosures, both themes, draft preservation, active discussion/room stopping, and unchanged stored room records. Responsive checks cover widths from 340 to 1800 px and the 1000/1001 breakpoint. Existing rendering and browser suites retain source safety, bounded code/tables, archive/deletion, roster, and send/refresh coverage. Required verification includes both supported Node runtimes and the existing platform matrix; exact results belong in the recovery file.

This completes the panel resizing/collapse checklist item. It does not complete the wider application keyboard/screen-reader/contrast audit, long-history pagination, or all release work. Real assistive-technology and touch-device review remain future accessibility work. The full README checklist remains the version 1 gate, including optional items.
