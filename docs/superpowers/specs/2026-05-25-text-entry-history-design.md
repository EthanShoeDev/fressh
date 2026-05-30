# Text Entry History Design

## Goal

Add persisted history to the mobile shell Text dialog so users can quickly reuse
text they previously pasted through that dialog. The first version supports
cycling between recent pasted messages, browsing history, and pinning durable
snippets.

## Scope

This applies only to `TextEntryModal` in the mobile shell. History captures
successful Text dialog Paste actions only. It does not capture clipboard paste,
commander paste, command presets, macros, keyboard text keys, or other terminal
input sources.

History persists across app restarts. The app keeps the 50 most recent unpinned
entries. Duplicate text is deduped by exact text and moved to the top when used
again. Pinned entries are stored separately, appear above recent entries, and do
not count against the 50 recent entry limit.

## Behavior

The default dialog remains editor-first. The existing text area, Clear, Paste,
and Close actions stay in place. The dialog adds compact previous and next
controls that load historical entries into the current editor value. A history
button opens a browse panel for pinned and recent entries.

Selecting a history row loads its text into the editor and closes the history
panel. It does not send text to the terminal. The user can edit selected history
before pressing Paste.

Pressing Paste records the exact submitted text only after the paste payload is
valid and the terminal send path is invoked. Empty text is never saved. Text
dialog Paste continues to append Enter through the existing
`buildTextEntryPasteSegments` behavior.

Pinning applies to either the current editor text or a row in the history panel.
Pinned entries are stable snippets. They survive recent-history pruning and
Clear History. Users can unpin or delete pinned entries explicitly.

Delete removes one row. Clear History removes all unpinned recent entries and
leaves pinned entries intact.

## UI

Add two compact header actions to the Text dialog:

- a pin toggle for the current editor text;
- a history button that opens the history panel.

When history exists, show previous and next controls near the text area with a
small position label such as `Recent 2 of 18`. Cycling replaces the current
editor value. If the user edits after loading history, the editor is treated as a
draft until they cycle or paste again.

The history panel opens inside the same modal frame as an expanded panel below
the editor. It has `Pinned` and `Recent` sections. Rows show a single-line
preview, pin or unpin, and delete. Tapping the row loads that text into the
editor. The panel must fit within the existing modal height constraints and
remain usable above the Android keyboard.

## Components

Add a focused history module at `apps/mobile/src/lib/text-entry-history.ts`.
It owns pure history operations:

- parse and validate persisted state;
- serialize state;
- record a pasted text entry;
- dedupe exact text and update `lastUsedAtMs`;
- enforce the 50-entry unpinned recent limit;
- pin and unpin;
- delete one entry;
- clear unpinned entries;
- derive display sections and cycling order.

Use MMKV-style string storage, matching existing non-secret mobile stores. This
is convenience history, not secret material, so it should not use SecureStore.
Use a dedicated storage id/key pair for Text dialog history so it does not share
state with shell config or connections.

`detail.tsx` owns loading and saving persisted history, logging storage
failures, and calling the history record action after successful Text dialog
Paste dispatch. It continues to own terminal send behavior.

`TextEntryModal` owns transient UI state:

- current editor text;
- history panel open or closed;
- cycling index;
- selecting, pinning, unpinning, deleting, and clearing through callbacks passed
  from `detail.tsx`.

## Data Model

Each entry stores:

```ts
type TextEntryHistoryEntry = {
	id: string;
	text: string;
	createdAtMs: number;
	lastUsedAtMs: number;
	pinned: boolean;
};
```

Recent entries sort by `lastUsedAtMs` descending. Pinned entries appear above
recent entries and also sort by `lastUsedAtMs` descending.

The storage value should include a version field so future migrations can be
handled explicitly:

```ts
type TextEntryHistoryState = {
	version: 1;
	entries: TextEntryHistoryEntry[];
};
```

IDs should be generated from the current time plus a small random suffix. UI
behavior must not depend on array indexes as persistent identity.

## Error Handling

History storage failures must not block Paste. If saving fails, log a warning
and continue sending text to the terminal.

If persisted history is missing, use an empty history state. If persisted JSON is
invalid or fails validation, reset history to empty and log a warning. The user
should see an empty history list rather than an error dialog.

If pin, unpin, delete, or clear fails to persist, keep the in-memory UI
consistent for the current interaction where practical, log a warning, and allow
future loads to reflect the last successfully persisted state.

## Non-Goals

- Capture clipboard paste or commander text.
- Add search in v1.
- Add undo for Clear History.
- Add per-connection history.
- Change Text dialog Paste payload semantics.
- Change Wispr automation behavior.
- Rework the terminal send path.

## Testing

Add pure tests for `text-entry-history` covering:

- recording a new text entry;
- ignoring empty text;
- deduping exact duplicate text and moving it to the top;
- enforcing a 50-entry limit for unpinned recent entries;
- pinned entries not counting against the 50 recent entry limit;
- pinned entries sorting above recent entries;
- pin and unpin behavior;
- deleting one entry;
- clearing only unpinned entries;
- invalid persisted JSON or invalid shape resetting to empty state.

Add focused integration coverage where practical for:

- Text dialog Paste records history only after it has a non-empty payload;
- clipboard paste does not record Text dialog history;
- Text dialog Paste still appends Enter.

Manual Android preview verification should cover:

- previous and next cycling through recent text;
- opening the history panel;
- selecting a pinned and recent row into the editor;
- editing selected text before Paste;
- pinning current text;
- unpinning and deleting rows;
- Clear History preserving pinned rows;
- Paste still closes the modal and submits text plus Enter.
