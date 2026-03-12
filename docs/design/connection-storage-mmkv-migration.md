# Connection Storage MMKV Migration Plan

**Overall Progress:** `100%`

## Tasks:

- [x] 🟩 **Step 1: Move saved connections to MMKV**
  - [x] 🟩 Add a small MMKV-backed storage layer for saved connection entries
  - [x] 🟩 Keep the existing `secretsManager.connections` query/utils API unchanged for callers
  - [x] 🟩 Leave private key storage on the existing SecureStore-backed path

- [x] 🟩 **Step 2: Add one-way legacy migration**
  - [x] 🟩 Read legacy SecureStore connection entries on startup
  - [x] 🟩 Merge by connection id and keep the newer entry by `metadata.modifiedAtMs`
  - [x] 🟩 Delete legacy SecureStore connection data after successful migration
  - [x] 🟩 Skip unreadable legacy entries and log them without user-facing UI

- [x] 🟩 **Step 3: Wire migration into app startup paths**
  - [x] 🟩 Ensure migration completes before connection list/get reads used by host screen, auto-connect, and backup/export
  - [x] 🟩 Preserve existing saved connection shape, timestamps, label, and normalized connection values

- [x] 🟩 **Step 4: Add regression coverage**
  - [x] 🟩 Add a small JS integration test setup for `apps/mobile`
  - [x] 🟩 Add one test that simulates a missing legacy manifest chunk and verifies SSH connect still succeeds
  - [x] 🟩 Verify the successful connect persists the saved connection in MMKV instead of being blocked by legacy corruption

- [x] 🟩 **Step 5: Validate**
  - [x] 🟩 Run the relevant mobile lint/check command
  - [x] 🟩 Run the new regression test
