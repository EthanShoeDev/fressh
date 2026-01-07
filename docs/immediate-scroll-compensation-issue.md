# Immediate Scroll Compensation (Cursor Edge Anchoring) - Current Problem

## Problem Description (Exact)
In tmux copy-mode, the cursor begins on the bottom line of the viewport. When the user drags to scroll, Up/Down arrow keys first move the cursor inside the visible page before the viewport itself scrolls. This creates a dead zone:

- First drag: content does not move immediately; the cursor moves first.
- Direction reversal: after scrolling up, reversing direction again makes the cursor traverse the screen before the viewport follows.

This feels laggy and unlike native touch scrolling. The expected UX is that content moves immediately on the first drag and on every direction reversal.

## What Was Implemented (Exact)
Anchoring logic was added in the WebView touch scroll controller to move the copy-mode cursor to the edge of the viewport before emitting scroll keys, so the first arrow key immediately scrolls the viewport.

### File: `packages/react-native-xtermjs-webview/src-internal/main.tsx`

Added constants and state:

```ts
			const keyUp = '\x1b[A';
			const keyDown = '\x1b[B';
			const keyPageUp = '\x1b[5~';
			const keyPageDown = '\x1b[6~';
			// vi-style copy-mode anchors: top/bottom of screen.
			const anchorUpKey = 'H';
			const anchorDownKey = 'L';
			const anchorOnDirectionChange = true;

			// Track last scroll direction to anchor immediately on first scroll
			// and on direction reversals (including across separate drags).
			// We intentionally do NOT reset this on pointer-up so same-direction
			// drags keep fine-grained control without re-anchoring.
			let lastScrollDirection: ScrollDirection | null = null;
```

Reset the direction on state resets and exit:

```ts
			const resetState = () => {
				resetPendingScroll();
				releasePointerCapture();
				resetPointerTracking();
				state = 'Idle';
				copyModeState = 'off';
				copyModeConfidence = 'uncertain';
				entryIntent = null;
				lastScrollDirection = null;
				scrollbackActive = false;
				scrollbackPhase = 'active';
			};

			const exitScrollback = (opts?: { emitExit?: boolean; requestId?: number }) => {
				const emitExit = opts?.emitExit ?? true;
				const requestId = opts?.requestId;
				resetPendingScroll();
				releasePointerCapture();
				state = 'Idle';
				pendingPointerUp = false;
				pointerIsDown = false;
				lastScrollDirection = null;
				let recoveryRequested = false;
```

Anchor before emitting scroll keys:

```ts
			const flushPendingLines = () => {
				const cfg = getActiveConfig();
				if (!cfg) return;
				if (copyModeState !== 'on') return;
				if (!pendingLines) return;

				const direction = pendingLines > 0 ? 1 : -1;
				const scrollDirection: ScrollDirection = direction > 0 ? 'up' : 'down';
				// Anchor the cursor at the viewport edge so the next arrow key
				// scrolls immediately (no dead zone). Only anchor on first scroll
				// or when direction changes.
				if (anchorOnDirectionChange && scrollDirection !== lastScrollDirection) {
					sendScrollInput(
						scrollDirection === 'up' ? anchorUpKey : anchorDownKey,
					);
				}
				lastScrollDirection = scrollDirection;

				const absPending = Math.abs(pendingLines);
				const pageStep = Math.max(10, term.rows - 1);
```

### Build Artifact
`packages/react-native-xtermjs-webview/dist-internal/index.html` was regenerated via:

```bash
pnpm --filter @fressh/react-native-xtermjs-webview run build:internal
```

## Current Status
Despite the above change, the Immediate Scroll Compensation issue is still present. The scroll still feels delayed, suggesting the anchor keys are not taking effect (or are not being interpreted by tmux copy-mode as expected).
