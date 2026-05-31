# `shell/detail.tsx` decomposition design

## Context

`apps/mobile/src/app/shell/detail.tsx` is the shell detail screen — the
component shown after a successful SSH connection. It has grown to
**3,642 lines** across many iterations and now owns nine distinct
feature concerns in one file:

1. Terminal/PTY I/O and rendering
2. Keyboard definitions, modifiers, and slot-press dispatch
3. Wispr text-entry automation (Android accessibility-service driven)
4. Agent notifications (route handling, visibility acks)
5. Tmux control shell and scrollback
6. Command execution and presets
7. Browser actions and host URLs (side-channel commands)
8. Feature request modal (creates GitHub issues via SSH side channel)
9. Skill discovery and selector

This was flagged in the cross-codebase zero-tech-debt audit (PRs #67,
#68, #69, #74) and tracked in issue #71. The file is the only
remaining structural target; everything else flagged in the audit has
been addressed.

The pain points are concrete:

- A single file owns ~12 feature concerns
- Wispr alone holds **24 refs** and **~700 LOC of callbacks** for one
  state machine — most of those refs are logical state that could be a
  reducer field
- Test coverage on `detail.tsx` itself is thin; the pure-logic lib
  modules around it are well-tested but the orchestration glue is not
- A single broken effect can break unrelated features

## Goals

- Reduce `detail.tsx` to a coordinator (~900–1,300 LOC) that wires
  four feature hooks and renders the modal/keyboard/terminal tree.
  Going below ~900 LOC would require extracting the agent-notification
  route-handler effect, which is screen-level and out of scope here.
- Make each feature concern independently understandable and editable
  by extracting it into its own file under `apps/mobile/src/lib/`.
- Preserve every observable behavior of the current screen, with
  redesign opportunities taken aggressively only inside hooks (where
  the surface is internal) and conservatively where they cross feature
  boundaries.
- Keep external public API stable: no symbol renames for the lib
  modules already imported elsewhere, no breaking changes to the
  search-params contract.
- Ship as four independent PRs in a specific order. Each PR leaves the
  app in a fully working state and is independently revertible.

## Non-Goals

- Do not change any user-visible behavior. No new features, no UI
  reshuffles, no animation changes (modulo the Aggressive redesign in
  PR 2, called out explicitly below).
- Do not change the public API of existing lib modules. The hooks
  consume them but the lib surface stays the same.
- Do not introduce a new state-management library (Redux, XState,
  etc.). Use `useReducer` from React for the Wispr session redesign.
- Do not add hook-level unit tests; keep the existing convention of
  testing pure logic only (node:test on lib modules).
- Do not extract the agent-notification route-handler effect from
  `detail.tsx`. It is a screen-level concern (depends on the current
  route being the shell detail) and stays in the coordinator.

## Architecture

### Target end state

```tsx
// apps/mobile/src/app/shell/detail.tsx (post-decomposition, ~900–1,300 LOC)
export default function ShellDetail() {
  const params = useLocalSearchParams();
  const { connection, shell } = useShellConnection(params);

  const terminal = useShellTerminalSession({ shell, connection, /* tmux config */ });
  const keyboard = useShellKeyboardDispatch({ writer: terminal.writer });
  const wispr    = useWisprSession({ /* deps */ });
  const modals   = useShellModalControllers({ /* deps */ });

  // Residual screen-level state: focus refs, app-state, agent-notif route handler.

  return (
    <KeyboardAvoidingView ...>
      <TerminalErrorBoundary>
        <XtermJsWebView {...terminal.props} />
        {terminal.scrollbackJumpToLiveButton}
      </TerminalErrorBoundary>
      <TerminalKeyboard {...keyboard.props} />
      <CommandPresetsModal {...modals.commandPresets} />
      <BrowserActionsModal {...modals.browserActions} />
      <TerminalCommanderModal {...modals.commander} />
      <SkillSelectorModal {...modals.skillSelector} />
      <TextEntryModal {...modals.textEntry} {...wispr.textEntryProps} />
      <HostUrlModal {...modals.hostUrl} />
      <ConfigureModal {...modals.configure} />
      <FeatureRequestModal {...modals.featureRequest} />
      {/* reconnect overlay, keyboard flash toast */}
    </KeyboardAvoidingView>
  );
}
```

### File layout

Four new files in `apps/mobile/src/lib/` (matching the existing
convention of `auto-connect.tsx`, `AgentNotificationBridgeManager.tsx`,
`theme.tsx`):

| File | Hook(s) | Pure-logic siblings (existing) |
|---|---|---|
| `shell-modals.tsx` | `useFeatureRequestController`, `useSkillSelectorController`, `useBrowserActionsController`, `useShellSimpleModals` | extends `repo-feature-request.ts`, `host-browser-actions.ts`, `skill-discovery.ts` |
| `wispr-session.tsx` | `useWisprSession` | extends `wispr-automation.ts` (new `reduceWisprSessionState`, `decideTapWisprWithinRetryWindow`) |
| `shell-keyboard.tsx` | `useShellKeyboardDispatch` | extends `keyboard-actions.ts` (new `resolveSlotPressIntent` if extraction is feasible) |
| `shell-terminal.tsx` | `useShellTerminalSession` | reuses `terminal-input-payloads.ts`, `tmux-scrollback.ts`, `shell-live-input.ts` (no new pure logic) |

### Boundary contract for each hook

- Takes ambient deps as input (connection, shell, search params, cross-hook handlers)
- Owns its own state internally (refs, `useState`, reducers)
- Exposes a small typed surface:
  - A `props` bundle for the React tree (spread directly onto a component)
  - Handler callbacks the coordinator or other hooks need

### Extraction order

The PRs land in this order. Each builds on the prior one being merged
to `main`.

1. **PR 1 — Modal controllers.** Lowest risk; establishes the
   extraction pattern. ~400 LOC out of `detail.tsx`.
2. **PR 2 — Wispr session.** Highest risk and largest win.
   ~700–750 LOC out. Includes the Aggressive reducer redesign.
3. **PR 3 — Keyboard dispatch.** ~350–400 LOC out. Depends on the
   modal/Wispr open callbacks from PRs 1 and 2.
4. **PR 4 — Terminal/PTY session.** Most foundational layer.
   ~700–800 LOC out. Leaves the coordinator at ~900–1,300 LOC.

---

## PR 1 — Modal controllers

### State moved out of `detail.tsx`

`useFeatureRequestController`:

- State: `featureRequestOpen`, `featureRequestSubmitting`,
  `featureRequestTargetRepository`, `featureRequestResolvingTarget`,
  `featureRequestError`.
- Refs: `featureRequestResolveRequestIdRef`,
  `featureRequestSubmitRequestIdRef`,
  `featureRequestSubmitInFlightRef`,
  `featureRequestSourceStaleRef`.
- Callbacks: `handleOpenFeatureRequest`, `handleFeatureRequestSubmit`
  (85 LOC), `closeFeatureRequest`,
  `resolveCurrentGitHubRepository` (33 LOC).

`useSkillSelectorController`:

- State: `skillSelectorOpen`, `skillSelectorSkills`,
  `skillSelectorLoading`, `skillSelectorError`.
- Refs: `skillSelectorRequestIdRef`,
  `skillSelectorActiveSourceKeyRef`.
- Callbacks: `handleOpenSkillSelector` (55 LOC),
  `handleCloseSkillSelector`, `handleSelectSkill`.

`useBrowserActionsController` (BrowserActions + HostURL + GitHub
targets bundled, since they share `runHostBrowserCommand`):

- State: `browserActionsOpen`, `hostUrlModalState`,
  `hostUrlModalSubmitting`, `hostUrlModalError`, request-ID refs.
- Callbacks: `handleOpenBrowserActions`, `handleOpenGitHubTarget`,
  `handleOpenGitHubIssuesTarget`, `handleOpenGitHubPullsTarget`,
  `handleOpenHostDiffity`, `handleOpenHostUrlSlot`,
  `handleEditHostUrlSlot`, `handleCloseHostUrlModal`,
  `handleSubmitHostUrlModal`, `resolveHostBrowserPanePath` (70 LOC).

`useShellSimpleModals` (open/close only, no controller logic):

- State: `commandPresetsOpen`, `commanderOpen`, `textEntryOpen`,
  `configureOpen`.

### Hook surfaces

```ts
function useFeatureRequestController(deps): {
  modalProps: { open, submitting, targetRepository, resolving, error, onClose, onSubmit };
  open: () => Promise<void>;
}

function useSkillSelectorController(deps): {
  modalProps: { open, skills, loading, error, onClose, onSelect };
  open: () => Promise<void>;
}

function useBrowserActionsController(deps): {
  browserActionsProps: { open, onClose, onGitHubIssues, onGitHubPulls, onUrlSlotPress, onUrlSlotEdit, ... };
  hostUrlProps: { state, submitting, error, onClose, onSubmit };
  open: () => void;
}

function useShellSimpleModals(): {
  commandPresets: { open, onOpen, onClose };
  commander: { open, onOpen, onClose };
  textEntry: { open, onOpen, onClose };
  configure: { open, onOpen, onClose };
}
```

### Aggressive redesign opportunities

- `handleFeatureRequestSubmit` (85 LOC) interleaves request-ID
  tracking, side-channel calls, alert dialogs, and state updates.
  Extract the pure parsing (extract issue URL from side-channel
  output) to `repo-feature-request.ts` as a tested helper. Hook keeps
  only orchestration.
- The request-ID dedupe pattern repeats in 5+ places across
  `detail.tsx`. Extract a small reusable helper, e.g.
  `lib/request-id.ts::useRequestId()` returning
  `{ next(): number, isCurrent(id: number): boolean }`.
- Drop the `<modal>SourceStaleRef` flags where the request-ID pattern
  already covers staleness.

### Tests

- `repo-feature-request.test.ts` — add cases for the new issue-URL
  parser (pure, node:test).
- `host-url-slots.test.ts` — add if pure URL-slot validation logic is
  extracted.
- No tests for the React hooks themselves.

### Risk areas

- `closeFeatureRequest` returns a `boolean` (success). Several call
  sites await this return value. Preserve the signature.
- `handleOpenSkillSelector` closes other modals before opening. The
  "close everything else first" pattern repeats across handlers; the
  hooks must preserve the order to avoid focus / animation glitches.

### Size estimate

- `shell-modals.tsx`: ~500 LOC (including the four hooks + pure
  helpers).
- `detail.tsx` shrinks by ~400 LOC.

---

## PR 2 — Wispr session

The largest and most aggressive cut. `detail.tsx` today holds **24
refs and ~700 LOC of callbacks** for Wispr. The existing
`apps/mobile/src/lib/wispr-automation.ts` (post-PR #68) already has a
state-machine reducer for the `WisprAutomationState` enum. Extend
that pattern to absorb the rest of the Wispr state.

### State to extract

The 24 refs in `detail.tsx`, grouped by purpose:

| Group | Items |
|---|---|
| Request tracking | `autoStartedRequestId`, `controlTapStartedRequestId`, `timedOutStartRequestId`, `wisprTextEntryRequestIdRef` |
| Close queue | `pendingAutoCloseRequestsRef` (Map), `closeInFlightRef`, `wisprStartMarkersRef` (Map) |
| Timeouts | `wisprOpeningTimeoutRef`, `wisprStartTimeoutRef`, `wisprAutoCloseBlockingTimeoutRef`, `wisprAutoCloseRetryTimeoutsRef` (Map) |
| Text-entry context | `textEntryOpenRef`, `autoWisprEnabledRef`, `wisprTextEntryValueRef`, `cleanupWisprTextEntryOnUnmountRef` |
| Misc latches | (rest) |

### Pure-logic extensions in `wispr-automation.ts`

- **New type `WisprSessionState`** covering the request-tracking and
  close-queue fields currently held in refs.
- **New reducer `reduceWisprSessionState(state, event)`** — extends
  `reduceWisprAutomationState` to fold in request-tracking and
  close-queue transitions. The `WisprAutomationEvent` union grows
  with events like `pressed`, `controlTapStarted`,
  `controlTapTimedOut`, `closeRequested`, `closeRetryScheduled`,
  `closeCompleted`.
- **New decision helper
  `decideTapWisprWithinRetryWindow(state, nowMs, lastTapAtMs)`**
  returning `{ shouldTap: bool, nextDelayMs: number }`. Replaces the
  imperative retry loop in `tapWisprControlWithinRetryWindow`
  (60-LOC callback at L1260–1319 today).
- The reducer stays pure. All timeout/native-call side effects stay
  outside it.

### New file `wispr-session.tsx`

- Exports `useWisprSession(deps)`.
- Internally:
  - One `useReducer(reduceWisprSessionState, initialState)` replacing
    the 24 logical-state refs.
  - A small set of timer refs (`wisprOpeningTimeoutRef`,
    `wisprStartTimeoutRef`, `wisprAutoCloseBlockingTimeoutRef`,
    `wisprAutoCloseRetryTimeoutsRef`). These are genuinely React-side
    effects (need lifecycle cleanup), not logical state, so they stay
    as refs.
  - Native-module calls (`wisprAutomationNative.tapWisprControl()`,
    `tapScreen()`, `getStatus()`, `openAccessibilitySettings()`) are
    wrapped inline; the existing `tapWisprControlWithTimeout` utility
    is reused.
  - Mount effect: subscribe to Wispr native status. Unmount effect:
    clear all timers and dispatch a `reset` event.

### Hook surface

```ts
function useWisprSession(deps: {
  connection: SshConnection | null;
  shell: ShellHandle | null;
  textEntryOpen: boolean;
  closeTextEntry: () => void;
  autoWisprEnabled: boolean;
  onAutoWisprChange: (b: boolean) => void;
}) {
  return {
    state: WisprAutomationState;
    availability: WisprTextEditorAvailability;
    control: TextEntryWisprControl;
    textEntryProps: {
      wisprMode: boolean;
      wisprControl: TextEntryWisprControl;
      onWisprFocus: (value, bounds) => void;
      onWisprAutoStartChange: (enabled: boolean) => void;
      onWisprSetup: () => void;
      onValueChange: (value: string) => void;
    };
    onOpenTextEditor: () => Promise<void>;
    onCloseTextEntry: () => Promise<void>;
  };
}
```

### Aggressive redesign ledger

Each of these is called out in the PR description with before/after
evidence so a reviewer can audit the redesign explicitly:

1. **24 refs → 1 reducer state + ~5 timer refs.** Each ref that held
   logical state is mapped to a reducer field; each ref that held a
   `setTimeout` handle stays a ref.
2. **`tapWisprControlWithinRetryWindow` (60 LOC imperative retry)**
   → split into pure `decideTapWisprWithinRetryWindow` (decision) +
   tiny effect loop in the hook (mechanism). Tested in node.
3. **`handleWisprTextEntryFocus` (137 LOC)** → orchestrator method on
   the hook that dispatches reducer events at each step. No new
   logic; control flow rearranged into reducer events + side-effect
   calls.
4. **Close-queue Map → reducer field of type
   `WisprPendingAutoCloseRequest[]`.** Existing pure helpers
   `resolveWisprPendingAutoCloseRequests` and
   `resolveWisprAutoCloseOnTextEntryClose` are already tested; reuse
   them inside the reducer.

### Tests

- Extend `wispr-automation.test.ts` with cases for
  `reduceWisprSessionState`'s new transitions (~15–20 new tests).
- Test `decideTapWisprWithinRetryWindow` with timing edge cases
  (retry window expired, late native success, late native failure).
- No hook-level tests.

### Risk areas

- **Native-module call timing.** Today, `tapWisprControl()` is called
  inside a loop with imperative timers. If the reducer doesn't model
  the timer state correctly, retry behavior could regress. Mitigation:
  add cases for "retry window expired", "late native success", "late
  native failure".
- **Cleanup-on-unmount.** The effect at L1954 today cleans up Wispr
  state on unmount. The hook's cleanup return must do the equivalent
  (clear all timers, dispatch a `reset` event).
- **`cleanupWisprTextEntryOnUnmountRef` crosses the PR 1 / PR 2
  boundary.** The cleanup ref is invoked from `handleCloseTextEntry`,
  which lives in PR 1. The hook exposes `onCloseTextEntry` so the
  modal controller can await it.

### Size estimate

- `wispr-automation.ts`: +200 LOC (new reducer + decision helper).
- `wispr-session.tsx`: ~600 LOC.
- Test additions: ~250 LOC.
- `detail.tsx` shrinks by ~750 LOC.

---

## PR 3 — Keyboard dispatch

### State to extract

| Group | Items |
|---|---|
| Config-derived memos | `keyboardsById`, `activeKeyboardIds`, `availableKeyboardIds`, `selectedKeyboardId`, `currentKeyboard`, `currentMacros` |
| Preference | `preferredKeyboardId` |
| Sync refs | `availableKeyboardIdsRef`, `selectedKeyboardIdRef` |
| Modifiers | `modifierKeysActive` (Map) |
| Switch animation | `flashOpacity` (Animated.Value), `isFirstMount` |
| Command execution | `commandTimeoutsRef`, `clearCommandTimeouts`, `sendCommandStep`, `runCommandSteps` |
| Command presets | `runCommandPreset`, `toggleModifier` |
| Keyboard selection | `rotateKeyboard`, `selectKeyboardIfExists` |
| Action routing | `actionContext` (57-LOC memo), `handleAction`, `handleSlotPress` (65 LOC) |

### Hook surface

```ts
function useShellKeyboardDispatch(deps: {
  shellConfig: ShellConfig | null;
  sendBytesRaw: (bytes: Uint8Array) => void;
  sendTextRaw: (text: string) => void;
  // Cross-feature dispatch from PR 1 + PR 2:
  openCommandPresets: () => void;
  openCommander: () => void;
  openBrowserActions: () => void;
  openSkillSelector: () => Promise<void>;
  openTextEntry: () => void;
  openWisprTextEditor: () => Promise<void>;
  // ... (full deps mirrored from current actionContext)
}) {
  return {
    keyboardProps: {
      currentKeyboard,
      currentMacros,
      availableKeyboardIds,
      modifierKeysActive,
      onSlotPress,
      onRotateKeyboard,
      onModifierToggle,
      flashOpacity,
    };
    onRunCommandPreset: (preset: CommandPreset) => void;
    sendTextWithModifiers: (text: string) => void;
  };
}
```

### Aggressive redesign opportunities

1. **Extract `resolveSlotPressIntent`** from `handleSlotPress`
   (currently a 65-LOC `switch (slot.type)` over modifier / text /
   bytes / macro / action). Make the routing a pure function
   returning a discriminated-union intent; the hook executes the
   intent. The switch becomes node:test-able.
2. **Drop the sync-refs (`availableKeyboardIdsRef`,
   `selectedKeyboardIdRef`) where possible.** With React 19 and
   stable callback deps, these can often be replaced by reading the
   values directly via effect deps. Defer if the React complexity
   gets in the way.
3. **Consolidate the keyboard-switch flash animation.** Move
   `flashOpacity`, `isFirstMount`, and the L668 effect into the hook;
   expose `flashOpacity` as part of `keyboardProps`.

### Tests

- `keyboard-actions.test.ts` — add cases for `resolveSlotPressIntent`
  (the switch over slot type). ~10–15 new tests, pure node:test.
- No hook tests.

### Risk areas

- **Depends on PR 1 (modal openers) and PR 2 (Wispr openers).** Must
  land after both. If a slot tries to open a modal that has not been
  hooked yet, the slot becomes a no-op.
- **Macro execution timing.** `runCommandSteps` schedules
  `setTimeout`s; `clearCommandTimeouts` is called from an unmount
  effect. The hook needs the same lifecycle cleanup to avoid leaked
  timers after unmount.
- **Preferences persistence.** `preferredKeyboardId` is persisted via
  the `preferences` API. Load on mount, save on change. Same pattern
  inside the hook.

### Size estimate

- `shell-keyboard.tsx`: ~350 LOC.
- `keyboard-actions.ts`: +60 LOC if `resolveSlotPressIntent` is
  extracted.
- Test additions: ~80 LOC.
- `detail.tsx` shrinks by ~400 LOC.

---

## PR 4 — Terminal/PTY session

### State to extract

| Group | Items |
|---|---|
| Terminal lifecycle | `xtermRef`, `listenerIdRef`, `attachedShellKeyRef`, `hasAttachedOnceRef`, `terminalReady`, `hasRenderedTerminal`, `attachShellToTerminal` (81 LOC), `handleTerminalInitialized` |
| Writer / send-family | `writerRef`, `commandTimeoutsRef`, `writeToShell`, `sendBytesOrdered`, `sendBytesQueued`, `sendBytesRaw`, `sendLiteralInputSegments`, `sendBytesWithModifiers`, `sendTextRaw`, `sendTextWithModifiers`, `sendLiveInputSegments` |
| Tmux control shell | `tmuxControlShellRef`, `tmuxControlListenerRef`, `tmuxControlWriterRef`, `tmuxTarget`, `tmuxEnabled`, `tmuxControlReady`, `tmuxControlRestartNonce`, `handleTmuxControlUnavailable`, `sendTmuxControlCommand` |
| Scrollback | `scrollbackActive`, `scrollbackActiveRef`, `scrollbackPhaseRef`, `clearScrollbackState`, `handleScrollbackModeChange`, `handleTmuxEnterCopyMode`, `handleTmuxScrollBatch`, `handleWebViewInput`, `handleJumpToLive` |
| Resize | `resizeTimeoutRef`, `lastSizeRef`, `handleTerminalResize` |
| Touch-scroll config | `touchScrollConfig` (Android-only memo, 50+ LOC) |
| Selection | `selectionModeEnabled`, `lastSelectionRef`, `handleCopySelection`, `exitSelectionMode`, `handleSelectionChanged`, `handleSelectionModeChange` |

### Hook surface

```ts
function useShellTerminalSession(deps: {
  connection: SshConnection | null;
  shell: ShellHandle | null;
  tmuxEnabled: boolean;
  tmuxTarget: string;
  modifierKeysActive: ModifierKeysState;
  systemKeyboardEnabled: boolean;
  selectionModeEnabled: boolean;
  onSelectionChange: (sel: Selection) => void;
}) {
  return {
    terminalProps: {
      ref: xtermRef,
      onInitialized, onResize, onInput, onSelection,
      onSelectionModeChange, onScrollbackModeChange,
      onTmuxEnterCopyMode, onTmuxScrollBatch,
      touchScrollConfig,
      theme,
    };
    writer: {
      sendBytesRaw,
      sendBytesQueued,
      sendBytesWithModifiers,
      sendTextRaw,
      sendTextWithModifiers,
      sendLiteralInputSegments,
    };
    scrollback: { active, jumpToLive };
    selection: { onCopySelection, exitSelectionMode };
    tmuxControl: { sendCommand, isReady };
    terminalReady;
    hasRenderedTerminal;
  };
}
```

### Aggressive redesign opportunities (kept tighter than PR 2)

1. **Consolidate the four "are we ready to render?" booleans.** Today
   `ready`, `terminalReady`, `hasRenderedTerminal`, `hasShownRef`,
   plus `tmuxControlReady`. Replace with a single
   `readyState: 'initializing' | 'rendering' | 'attached' | 'tmux-ready'`.
2. **Collapse the `sendBytes*` / `sendText*` family.** Today there
   are 7 send variants distinguished by ordering, batching,
   scrollback-exit, and modifier application. Expose 3 from the hook
   surface; variants with no callers get deleted.

### What stays in `detail.tsx`

- Search-params parsing and connection/shell lookup
- `resolveKeySecurity`
- App-state tracking (`isFocusedRef`, `isAppActiveRef`, app-state
  listener effect)
- Focus refs used by agent-notification visibility
- Agent-notification route handler effect (lines ~2154–2256)
- Four hook calls + prop threading
- JSX tree

### Tests

No new tests required. The pure logic was already extracted by prior
cleanup work. `shell-live-input.test.ts`,
`tmux-scrollback.test.ts`, `terminal-input-payloads.test.ts`
continue to pass.

### Risk areas

- **Listener attachment race.** `attachShellToTerminal` has subtle
  guards: read head buffer, mark `hasAttachedOnceRef`, attach live
  listener, handle case where shell changes mid-attach. The hook
  must preserve every guard.
- **Tmux control shell + main shell coordination.** Two side-channel
  paths to the same SSH connection. The tmux-control-restart-nonce
  pattern stays as-is; the hook still gates on `tmuxControlReady`
  before sending control commands.
- **Cross-PR writer contract.** PR 3's keyboard hook calls
  `writer.sendBytesRaw` etc. by the time this PR lands. Mitigation:
  during PR 3, define the writer interface as a TypeScript type that
  lives in `shell-terminal.tsx` from the start, even while
  `detail.tsx` still implements it inline. PR 4 then just moves the
  implementation.

### Size estimate

- `shell-terminal.tsx`: ~700 LOC.
- `detail.tsx` shrinks by ~700–800 LOC.
- After this PR: `detail.tsx` at ~900–1,300 LOC.

---

## Cross-cutting concerns

### Error handling — preserved as-is

The codebase has a consistent pattern:

```ts
try { ... } catch (error) { logger.warn('message', error); /* fallback */ }
```

This appears 30+ times across `detail.tsx`. **Every hook preserves
these try/catch blocks unchanged.** The Aggressive redesigns in PR 2
and PR 3 reorganize control flow but never strip error handling.
Each hook's logger uses `rootLogger.extend('<Feature>')` matching the
existing convention.

### Intermediate states between PRs

Each PR leaves the app in a working state.

| After PR | `detail.tsx` size | What's extracted |
|---|---|---|
| PR 1 | ~3,200 LOC | 4 modal-controller hooks |
| PR 2 | ~2,450 LOC | + Wispr session hook |
| PR 3 | ~2,050 LOC | + keyboard dispatch hook |
| PR 4 | ~900–1,300 LOC | + terminal/PTY session hook |

No feature flags or rollout gates needed. Each PR is a structural
refactor with no user-visible behavior change (modulo the Aggressive
reducer redesign in PR 2, which is what carries the most risk).

### Test verification per PR

| Gate | Check |
|---|---|
| Source-level | `pnpm typecheck` clean; `pnpm lint:check` no new issues |
| Behavior-pure | `pnpm test:integration` — all 381+ tests pass |
| Mobile feature | Smoke-test on Android device for the PR's feature surface |
| External API | No public symbol renamed |

### Rollback strategy

Each PR is a single coherent commit. Reverting one PR removes one
hook and restores the relevant code to `detail.tsx`. If PR 2's
Aggressive Wispr reducer turns out to introduce a regression that's
hard to fix forward, revert PR 2 and re-do the cut as a strict
mechanical extraction (no reducer redesign) in a follow-up.

---

## Acceptance criteria

For the overall decomposition (across all four PRs):

- [ ] `detail.tsx` ends at ~900–1,300 LOC.
- [ ] Four new files exist in `apps/mobile/src/lib/`: `shell-modals.tsx`,
  `wispr-session.tsx`, `shell-keyboard.tsx`, `shell-terminal.tsx`.
- [ ] No user-visible behavior change on Android: agent notifications,
  Wispr text entry, command presets, browser actions, host URLs,
  feature requests, skill selector, command palette, terminal
  rendering, tmux scrollback all still work.
- [ ] `pnpm typecheck`, `pnpm test:integration`, `pnpm lint:check`
  all clean after each PR and at the end.
- [ ] Wispr session's reducer state covers all 24 of today's logical
  refs; only timer-handle refs remain.
- [ ] New tests cover `reduceWisprSessionState`,
  `decideTapWisprWithinRetryWindow`, and `resolveSlotPressIntent`
  (if extracted).
- [ ] No public symbol in any `apps/mobile/src/lib/` module is renamed
  or removed by these PRs.

For each PR independently:

- [ ] The PR's source diff is reviewable in one sitting (~600 LOC
  net, larger for PR 2).
- [ ] The PR's description calls out every Aggressive redesign with
  before/after evidence.
- [ ] The PR can be reverted in isolation without breaking the
  previously-merged PRs.

---

## Open questions

- **PR 3 sync-refs (`availableKeyboardIdsRef`,
  `selectedKeyboardIdRef`).** The modernization to drop these is a
  "take it if React's complexity allows" — concrete decision deferred
  until the PR is being written.
- **PR 4 send-family collapse.** Whether to collapse 7 send variants
  to 3 in PR 4 or in a follow-up depends on how deep the call-site
  audit goes. Default plan: take it in PR 4 to avoid an in-flight
  intermediate state.

---

## Plan handoff

This spec covers four PRs. The writing-plans skill should produce
**one implementation plan per PR**, starting with PR 1 (modal
controllers). After PR 1 merges, the next session generates the plan
for PR 2; same for PRs 3 and 4. This keeps each plan small,
reviewable, and aligned with the merge cadence.

The first plan should target **PR 1 — Modal controllers** as
described in the section above. The remaining three PRs stay
captured here as scope but do not get their own plans until their
prerequisites merge.
