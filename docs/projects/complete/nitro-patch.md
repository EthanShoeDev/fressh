# `patches/nitrogen@0.35.9.patch` — why it exists & how to retire it

We carry a local patch against `nitrogen` (the Nitro view code generator). This
document explains the bug it works around so we can track the upstream fix and
drop the patch once it lands.

**TL;DR:** RN core has a dangling-reference bug in
`ConcreteShadowNode::getConcreteSharedProps()`. Nitro's generated HybridView
`adopt()` is the only caller, so the bug surfaces as **Nitro view props silently
arriving empty** — for us, `<Terminal shellId=… />` rendered a black screen.
The patch makes the generated `adopt()` avoid the broken accessor.

---

## Symptom

`<Terminal shellId={shellId} />` (a Nitro `HybridView`) rendered black. The
native renderer reported `UNBOUND (no shell_id)` even though JS passed a valid
`shellId`. Intermittently it instead crashed with `SIGSEGV` inside
`__android_log_print`/`NewStringUTF` while reading the prop — i.e. the prop value
was freed/garbage, not merely missing.

## Root cause — a dangling reference in React Native core

`node_modules/react-native/ReactCommon/react/renderer/core/ConcreteShadowNode.h`
(RN 0.85.3):

```cpp
const std::shared_ptr<const ConcreteProps>& getConcreteSharedProps() const {
  react_native_assert(BaseShadowNodeT::props_ && "Props must not be `nullptr`.");
  return std::static_pointer_cast<const ConcreteProps>(props_);   // ⚠️ returns a reference to a TEMPORARY
}
```

`std::static_pointer_cast` returns a **new temporary** `shared_ptr`, and the
function's return type is `const&`. So the caller receives a reference to a
`shared_ptr` that is destroyed at the end of the return statement — a dangling
reference / undefined behavior.

Nitro's generated `HybridXComponent.cpp` `adopt()` (the Android path that wraps
props into Fabric state) is the **only** caller:

```cpp
// nitrogen-generated adopt() — BEFORE (buggy)
const std::shared_ptr<const HybridTerminalProps>& constProps =
    concreteShadowNode.getConcreteSharedProps();                       // dangling ref
const std::shared_ptr<HybridTerminalProps>& props =
    std::const_pointer_cast<HybridTerminalProps>(constProps);          // binds the dangling ref
HybridTerminalState state{props};                                      // wraps freed/garbage props
```

In RN 0.85.3 `getConcreteSharedProps()` has **zero callers inside RN itself** —
it's effectively dead code that only Nitro uses. Because it's UB, it usually
"works" (the freed temporary's memory isn't reused before it's read), which is
why Nitro's own example and most apps don't hit it. Our app's memory layout
(Expo bridgeless + the umbrella `.so` fusing uniffi/ubrn/rust/nitro) reuses that
memory deterministically, so the props came back empty → `setShellId(null)` →
unbound/black renderer.

### Evidence (on-device, single `adopt` call)

A probe in `adopt()` compared the two accessors on the same shadow node:

```
getProps()               -> 0x765b9d52f390  typeid = HybridTerminalProps   (correct, shellId size=13)
getConcreteSharedProps() -> 0x765a92df28e8                                  (different object, shellId empty/garbage)
```

`getProps()` returns a reference to the real `props_` member (valid).
`getConcreteSharedProps()` returns the dangling temporary (garbage).

## The fix (what the patch does)

`patches/nitrogen@0.35.9.patch` edits the nitrogen view generator
(`lib/views/CppHybridViewComponent.js` + `src/views/CppHybridViewComponent.ts`)
so the generated `adopt()` casts the **stable `getProps()` member** into a local
`shared_ptr` instead of using the dangling accessor:

```cpp
// AFTER (patched)
auto props = std::const_pointer_cast<HybridTerminalProps>(
    std::static_pointer_cast<const HybridTerminalProps>(shadowNode.getProps()));
HybridTerminalState state{props};
```

The patch contains a second, **cosmetic** change unrelated to the bug:
`RawPropsParser(/* enableJsiParser */ true)` → `RawPropsParser()`. In RN 0.85.3
the `bool` argument is a deprecated no-op
(`RawPropsParser(bool) : RawPropsParser() {}`), so this only mirrors upstream
nitro PR #1345 and changes no behavior. (An earlier theory that the JSI parser
caused the bug was wrong.)

Verified on-device after the fix: a real SSH shell renders —
`fressh_terminal_draw: DRAWN shell_id=ethan@nas.lan:22#1:2`.

## Upstream status (as of 2026-06-02)

| Repo | Finding |
| --- | --- |
| `facebook/react-native` | No issue filed about the `getConcreteSharedProps()` dangling reference. PR [#48710](https://github.com/facebook/react-native/pull/48710) ("feat: Add `getConcretePropsShared()`"), authored by Marc Rousavy (Nitro's author) for "Nitro Views to update state in-place", was merged Jan 2025 — but `getConcretePropsShared()` is **not present in RN 0.85.3**, and the buggy `getConcreteSharedProps()` remains. |
| `mrousavy/nitro` | No issue filed. The generator at `HEAD` still emits the buggy `getConcreteSharedProps()` call (`packages/nitrogen/src/views/CppHybridViewComponent.ts`). |
| `nitrogen` on npm | Latest published is `0.35.9` — the version we patch. |

So the dangling-reference bug appears **unreported** in both repos. It silently
"works" for most people by luck.

## How to tell if/when it's fixed upstream (retire the patch)

On any `react-native-nitro-modules` / `nitrogen` bump (or RN bump), check:

1. **Nitro generator** — does `packages/nitrogen/.../CppHybridViewComponent.{ts,js}`
   still call `getConcreteSharedProps()` in `adopt()`? If it now casts
   `getProps()` (or uses a fixed accessor), the Nitro-side fix has landed.
2. **RN core** — does
   `react-native/ReactCommon/react/renderer/core/ConcreteShadowNode.h`
   `getConcreteSharedProps()` return **by value** (not `const&`), or is there a
   safe `getConcretePropsShared()` that Nitro adopts? Either resolves the root
   defect.
3. **Regenerate & confirm**: run `bun run nitro:codegen` in
   `packages/react-native-terminal` and check the generated
   `nitrogen/generated/shared/c++/views/HybridTerminalComponent.cpp` `adopt()`
   uses a non-dangling props source.

If the upstream code is fixed, delete `patches/nitrogen@0.35.9.patch` and its
entry in `package.json` `patchedDependencies`, then re-run `bun install` and
`nitro:codegen` and re-verify a real shell renders (not black).

## Reproducing / debugging notes

- Build: `nix develop ../../. -c bun run android` from `apps/mobile`.
- Drive + inspect the emulator with `agent-device` (open `dev.fressh.app`, tap
  the "Term" tab → `terminal-test` route; logs via `agent-device logs`).
- For an SSH-free repro, temporarily pass a static `shellId` to the demo
  `<Terminal>` in `apps/mobile/src/app/(tabs)/terminal-test.tsx`; the draw loop
  logging `shell_term MISS for shell_id=<id>` (instead of `UNBOUND`) proves the
  prop reached native.
