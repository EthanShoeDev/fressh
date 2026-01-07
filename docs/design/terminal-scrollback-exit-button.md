# Scrollback Exit Button Relocation Plan

**Overall Progress:** `100%`

## Tasks:

- [x] 🟩 **Step 1: Locate and remove the existing top “Scrollback · Jump to live” pill**
  - [x] 🟩 Identify the current top-center overlay in `apps/mobile/src/app/shell/detail.tsx`
  - [x] 🟩 Remove the pill container while preserving the existing `scrollbackVisible` gating and handler (`handleJumpToLive`)

- [x] 🟩 **Step 2: Add a terminal-area wrapper and bottom-right FAB**
  - [x] 🟩 Wrap `XtermJsWebView` in a `View` with `flex: 1` to host overlays inside the terminal area
  - [x] 🟩 Render a round `Pressable` anchored bottom-right within that wrapper
  - [x] 🟩 Use Lucide `ArrowDownToLine` icon and keep visibility `scrollbackVisible` (Android + iOS)
  - [x] 🟩 Ensure the button sits above the terminal area (not over the keyboard) by placing it inside the terminal wrapper

- [x] 🟩 **Step 3: Verify interactions and layout constraints**
  - [x] 🟩 Confirm the button only appears when `scrollbackActive && scrollbackPhase === 'active'`
  - [x] 🟩 Confirm the button triggers `handleJumpToLive` and does not block terminal input outside its bounds
  - [x] 🟩 Check Android + iOS safe-area spacing and that the button stays within the terminal area
