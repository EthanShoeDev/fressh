# Key Management UX & Tech Plan

Goal: Make SSH private key management clear and consistent: selecting a key,
generating/importing keys, renaming, deleting, and setting a default — all with
a unified, styled UI and predictable data semantics.

## Current State (Summary)

- Security type uses a `Picker` in the main form; defaults to `password`.
- Switching to key auth shows a `Picker` for keys (awkward empty state) and a
  “Manage Keys” button.
- Keys can be generated, renamed, deleted, set as default inside a modal.
- Storage uses a chunked manifest in `expo-secure-store` (works for >2KB values)
  with metadata (`priority`, `createdAtMs`, `label?`, `isDefault?`).
- All key mutations go through one `upsertPrivateKey` that invalidates the React
  Query `keys` query.

## UX Objectives

- Remove the inline key `Picker`; select a key within the Key Manager modal.
- Replace the security type `Picker` with a simple toggle/switch.
- Handle the “no keys yet” case gracefully by auto-opening the modal when user
  chooses key auth.
- Keep visual styling consistent with text inputs (button heights, paddings,
  colors).
- Prepare the modal for importing private keys (paste text or select file) in a
  future phase.

## Phase 1 — Selection UX + Styling

1. Replace security type `Picker` with toggle
   - Use a `SwitchField` (styled like inputs) labeled "Use Private Key".
   - Value mapping: off → password; on → key.
   - When toggled ON and there is no selected key and no keys exist, auto-open
     Key Manager.

2. Remove inline key `Picker`
   - Replace with a read-only field styled like inputs: label: "Private Key",
     value: current key label or "None".
   - The field is a `Pressable` that opens the Key Manager for selection.
   - Disabled state (no keys): show "None" with hint "Open Key Manager to add a
     key".

3. Key Manager: add selection mode
   - Add a radio-style control on each row to select the key for this session.
   - Modal accepts an optional `selectedKeyId` and `onSelect(id)` callback.
   - When user taps a row (or radio), call `onSelect(id)` and close the modal.
   - Continue to support generate/rename/delete/set-default; selection should
     update live.

4. Styling parity
   - Ensure the read-only "Private Key" field height/padding matches
     `TextField`.
   - Use consistent typography/colors for labels, values, and hints.

5. Empty states
   - If no keys: show a friendly empty state in modal with primary action
     "Generate New Key" and secondary "Import Key" (Import lands in Phase 2).

Deliverables (Phase 1)

- Update `apps/mobile/src/app/index.tsx` form:
  - Toggle for auth type.
  - Read-only key field that opens modal.
- Update `KeyManagerModal`:
  - Support selection behavior with visual radio and `onSelect` callback.
  - Keep existing generate/rename/delete/set-default.

## Phase 2 — Import Keys

1. Import entry points in modal
   - Add "Import" button/menu in the modal header or as secondary action in
     empty state.
   - Options:
     - Paste PEM text (multiline input)
     - Pick a file (use `expo-document-picker`)

2. Validation + Storage
   - Validate PEM or OpenSSH formats; detect supported types
     (rsa/ecdsa/ed25519/ed448/dsa).
   - Optional passphrase field (store encrypted if supported by library;
     otherwise prompt each use — confirm feasibility with SSH lib).
   - On success, call the single `upsertPrivateKey({ keyId, value, metadata })`
     and close import flow.

3. UX details
   - Show parse/validation errors inline.
   - Set initial `label` from filename (file import) or "Imported Key" (paste);
     allow editing label on success or selection.

Deliverables (Phase 2)

- Modal import screen(s) with paste/file flows.
- PEM validation utility and error handling.

## Phase 3 — Data Model + Semantics

1. Default key semantics
   - Guarantee exactly one default key at most by flipping `isDefault` on upsert
     when `isDefault === true`.
   - Consider: separate lightweight persistent "defaultId" in manifest root to
     avoid iterating all keys on default change.

2. Robustness
   - Add safety around manifest chunk growth: if
     `manifestChunkSize + newEntrySize > sizeLimit`, create a new chunk.
   - Ensure `createdAtMs` is preserved across upserts (done) and add
     `modifiedAtMs` if useful.

3. Logging + Dev ergonomics
   - Gate verbose logs behind a debug flag to avoid log spam in production
     builds.

## Phase 4 — Edge Cases & Polish

- Deleting the currently-selected key: clear selection and show hint to
  pick/create a new key.
- Auto-select the default key when switching to key auth and no key is selected.
- Handle failures from `SecureStore` (permissions/storage full) with
  user-friendly messages.
- Handle very large keys with chunking (already supported), surface an error if
  size exceeds safe thresholds.
- Accessibility: ensure labels/roles for controls in modal and the selection
  field.

## Phase 5 — Testing & QA

- Unit test PEM parsing/validation (Phase 2).
- E2E flows:
  - First run → toggle to key → auto-open modal → generate key → selected →
    connect.
  - Import key by paste/file; rename; set default; delete.
  - Delete selected key; confirm the form state updates.

## Implementation Notes

- Keep a single write path for keys: `upsertPrivateKey` (invalidates the `keys`
  query).
- Prefer modal-based selection with a simple “field-as-button” in the form.
- For future passphrase support, confirm the SSH library’s API shape and storage
  expectations.
