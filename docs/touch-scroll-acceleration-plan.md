# Touch Scroll Acceleration (Problem Statement)

## Problem Description
Fast finger swipes feel laggy because touch scroll currently emits tmux scroll commands, sends them over SSH, and only updates the viewport after the round-trip response returns. The existing controller batches scroll lines per frame, but caps line steps and only emits a single page step per flush, so high-velocity swipes can outpace the backlog drain. The goal is to keep tmux copy-mode semantics and improve responsiveness by adaptive acceleration/batching: scale lines per frame and page steps based on velocity/backlog, optionally apply a velocity multiplier (more lines per pixel at higher speed), and coalesce scroll payloads into short windows (16–32ms) to reduce SSH round trips.

## Files To Check/Review
- `packages/react-native-xtermjs-webview/src-internal/touch-scroll-controller.ts`
- `packages/react-native-xtermjs-webview/src/bridge.ts`
- `packages/react-native-xtermjs-webview/src-internal/main.tsx`
- `packages/react-native-xtermjs-webview/src/index.tsx`
- `apps/mobile/src/app/shell/detail.tsx`
