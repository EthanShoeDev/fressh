# Import Private Key — Detailed Plan

This plan covers implementing private key import (paste or file), improving key management UX, adding metadata display, and enabling copying the corresponding public key. It is grounded in the current code found in:

- `apps/mobile/src/app/index.tsx` (connection form + `KeyIdPicker`)
- `apps/mobile/src/components/key-manager-modal.tsx` (list, generate, rename, delete, set default)
- `apps/mobile/src/lib/secrets-manager.ts` (chunked secure store, key metadata, queries)

Relevant Expo docs (for implementation reference):

- Document Picker: https://docs.expo.dev/versions/latest/sdk/document-picker/
- File System: https://docs.expo.dev/versions/latest/sdk/filesystem/
- Clipboard (for copy public key): https://docs.expo.dev/versions/latest/sdk/clipboard/


## Current State (from repo)

- Keys are stored via a chunked manifest around `expo-secure-store` with metadata schema: `{ priority: number; createdAtMs: int; label?: string; isDefault?: boolean }`.
- `KeyManagerModal` supports: generate key (RSA 4096), rename, delete, set default, and selection through `onSelect` (already wired and used by the form’s `KeyIdPicker`).
- `generateKeyPair` uses `@dylankenneally/react-native-ssh-sftp`. We currently save only `pair.privateKey`, discard public key.
- Selection UI shows label or id; there’s no import flow yet; no createdAt display; no copy public key.


## Goals

- Import private keys via two paths:
  - Paste PEM/OpenSSH text into a multiline field.
  - Pick a key file via a system file picker and read its contents.
- Let users name the key before creating/storing it (applies to both Generate and Import flows).
- Allow users to copy the corresponding public key for any stored private key.
- Show basic metadata (createdAt) in the key list for context.
- Keep storage compatible and robust (no breaking changes to existing manifests).


## UX Plan

1) Entry points in Key Manager
- Add a secondary action “Import Key” next to the existing “Generate” button.
- When no keys exist, show both “Generate New Key” and “Import Key” prominently in the empty state.

2) Import flow (single modal sheet with tabs or steps)
- Step A: Choose method: “Paste PEM” or “Pick File”.
  - Paste PEM: multiline `TextInput` for the private key content; live validation feedback.
  - Pick File: button to open file picker (DocumentPicker). After selection, read file with FileSystem and populate a read-only preview (collapsible) + validation feedback.
- Step B: Name & options
  - “Label” text input (required or at least prompted before confirm).
  - Optional: “Set as default key” toggle.
  - Optional: public key association (see Public Key section below).
- Step C: Confirm & Save
  - On success, call `secretsManager.keys.utils.upsertPrivateKey` with computed `keyId`, metadata, and value.
  - Close the import sheet and refresh list.

3) Generate flow improvements
- Instead of immediate generate, open a small pre-flight form:
  - Label (text input; default prefilled like “My RSA Key”).
  - Key type (dropdown/segmented, default RSA).
  - Key size for RSA (e.g., 2048/4096; default 4096).
  - Optional comment (passed to generator if supported).
  - On submit, call `generateKeyPair`, then `upsertPrivateKey` with label and useful metadata (see Data Model Changes).

4) Key list rows (metadata + actions)
- Under the title, show small muted details: “ID: … • Created: …” (formatted via date-fns).
- Add an overflow/action area with:
  - Copy Public Key (uses `expo-clipboard`).
  - Rename (existing).
  - Set Default (existing).
  - Delete (existing).
- If public key is not known, show “Add Public Key” which opens a small paste dialog to attach one (stored in metadata).


## File Picker + File Reading (Expo)

Document selection:

- Use `expo-document-picker`:
  - `const res = await DocumentPicker.getDocumentAsync({ type: ['text/*', 'application/x-pem-file', 'application/octet-stream'], copyToCacheDirectory: true });`
  - Handle cancelation: `res.canceled` or check `res.assets?.length` depending on SDK version.
  - Use `res.assets[0].uri` and `res.assets[0].name`.

File reading:

- Use `expo-file-system`:
  - `const contents = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });`
  - If using DocumentPicker with `copyToCacheDirectory: true`, the returned `uri` is readable by FileSystem on both iOS and Android.
  - Normalize line endings (`\r\n` → `\n`) and trim extraneous whitespace.

Validation basics:

- Accept common formats:
  - OpenSSH: `-----BEGIN OPENSSH PRIVATE KEY----- ... -----END OPENSSH PRIVATE KEY-----`
  - RSA: `-----BEGIN RSA PRIVATE KEY----- ... -----END RSA PRIVATE KEY-----`
  - ECDSA/ED25519/ED448/DSA similarly.
- Quick checks:
  - Contains a matching BEGIN/END block.
  - Reasonable length (e.g., 500–5000 chars); reject empty/suspiciously short.
  - Optional: basic type inference from header for metadata.
- Store as-is on success; more advanced parsing is a future enhancement.


## Public Key Handling

- Generated keys: `generateKeyPair` likely returns a `publicKey` alongside `privateKey`. Store that public key in metadata so users can copy it later.
- Imported keys: deriving public keys on-device for all types may require an extra JS crypto library. To keep scope small and reliable:
  - MVP: Allow the user to optionally paste a corresponding public key during import (or later via “Add Public Key”).
  - Stretch: Add an optional dependency to derive a public key from the private key (e.g., a pure JS RSA/ed25519 parser) and auto-populate the metadata when feasible.
- UI: “Copy Public Key” button copies `metadata.publicKey` to clipboard; if absent, offer “Add Public Key”.


## Data Model Changes (backward-compatible)

- Extend `keyMetadataSchema` with optional fields:
  - `publicKey?: string` — OpenSSH public key (single line) or PEM.
  - `keyType?: SshPrivateKeyType` — derived from header or generator input.
  - `keySize?: number` — for RSA/ECDSA when known.
  - `fingerprint?: string` — short identifier derived from the private key (see below).
  - Keep existing: `priority`, `createdAtMs`, `label?`, `isDefault?`.
- Compute `keyId` at import/generate time:
  - Prefer deterministic id using a short fingerprint: `key_<8-char-fp>`.
  - Use `expo-crypto.digestStringAsync('SHA-256', privateKey)` → base16; take first 8–10 chars for id and show full fingerprint in row subtitle if needed.
  - Fallback to current `key_<timestamp>` if hashing ever fails.
- Size considerations:
  - Metadata is bounded by the ~1KB per-manifest-chunk budget; an OpenSSH public key line is typically < 1KB, so storing `publicKey` is safe.


## Implementation Steps

1) Secrets manager updates
- Update `keyMetadataSchema` (optional fields listed above) in `apps/mobile/src/lib/secrets-manager.ts`.
- When generating a key, store `metadata.publicKey`, `metadata.keyType`, `metadata.keySize`, and computed `fingerprint`.
- Add a tiny helper: `computeKeyFingerprint(privateKey: string): Promise<string>` using `expo-crypto`.

2) Key Manager modal — UI and flows
- Add “Import Key” entry. Implement a small state machine: `mode = 'list' | 'import' | 'generate'`.
- Import mode:
  - Tabs or toggle between “Paste” and “Pick File”.
  - Paste: multiline `TextInput`, Validate, Label input, Default toggle, Save.
  - Pick File: Launch DocumentPicker, read via FileSystem, fill preview, Validate, Label input, Default toggle, Save.
- Generate mode: show label/type/size/comment inputs; on submit generate and upsert.
- List mode rows:
  - Show label, id, createdAt (formatted), and default badge.
  - Row actions: Select (radio), Copy Public Key, Rename, Set Default, Delete.
  - If no `metadata.publicKey`, action shows “Add Public Key” and opens a small paste dialog; on save, upsert metadata only.

3) Copy public key
- Use `expo-clipboard`:
  - `await Clipboard.setStringAsync(metadata.publicKey)`
  - Show a small toast/snackbar or inline confirmation.

4) Date formatting
- Add `date-fns` and format with either `format` (e.g., `MMM d, yyyy`) or `formatDistanceToNow` for a relative display. Placement: muted line under the label in each row.

5) Validation utilities
- Add a small util module: `parseSshPrivateKey.ts` with functions:
  - `detectPrivateKeyType(pem: string): SshPrivateKeyType | 'openssh' | undefined`
  - `isLikelyValidPrivateKey(pem: string): boolean`
  - These are string/regex based for MVP; we can replace with stronger parsing later.

6) Error handling
- Show inline errors in the import modal (invalid format, unreadable file, empty input).
- Disable Save until validation passes.


## Dependencies to add

- `expo-document-picker` — file selection.
- `expo-file-system` — read selected file contents.
- `expo-clipboard` — copy public key.
- `date-fns` — format timestamps.

Notes:
- Ensure proper installation via `npx expo install expo-document-picker expo-file-system expo-clipboard date-fns`.
- For DocumentPicker, prefer `copyToCacheDirectory: true` to guarantee a readable `uri`.


## Security & Privacy

- Never log key material or show it in error messages.
- Keep logs behind a debug flag; redact key strings in any analytics.
- Continue storing private keys in `SecureStore` (already handled), avoid moving them to less secure storage.


## Testing Plan

- Unit tests for the validation utils with sample PEM strings.
- Manual QA on devices/simulators:
  - Paste invalid/valid keys (OpenSSH, RSA) → proper errors/success.
  - Pick a `.pem`/no-extension text file → reads, validates, stores.
  - Rename, set default, delete flows unchanged.
  - Copy public key present vs. absent → “Add Public Key” flow wiring.
  - CreatedAt formatting appears correctly and is stable across renames.


## Implementation Notes (cross-cutting)

- Keep all key writes going through `upsertPrivateKey` so React Query invalidation stays consistent.
- Preserve `createdAtMs` on upserts (already implemented), add `fingerprint` only once when first inserted.
- If adding new metadata fields, mark them optional in zod to avoid breaking existing entries.
