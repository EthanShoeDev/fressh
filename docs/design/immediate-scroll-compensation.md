# Immediate Scroll Compensation (Cursor Edge Anchoring) Plan

**Overall Progress:** `100%`

## Tasks:

- [x] 🟩 **Step 1: Add anchor state + logic in touch scroll controller**
  - [x] 🟩 Track last scroll direction and reset it on exit/reset paths
  - [x] 🟩 Anchor cursor to top/bottom only on first scroll or direction change
  - [x] 🟩 Keep anchors hardcoded to vi defaults (`H`/`L`)

- [x] 🟩 **Step 2: Ensure flush ordering and pointer-state behavior match UX**
  - [x] 🟩 Anchor only after copy-mode is fully on
  - [x] 🟩 Do not re-anchor on same-direction new drags
  - [x] 🟩 Allow re-anchor on direction change across separate drags

- [x] 🟩 **Step 3: Regenerate internal WebView build artifact**
  - [x] 🟩 Run the package build for `dist-internal`
  - [x] 🟩 Confirm generated artifact matches source changes
