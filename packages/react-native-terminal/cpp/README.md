# `cpp/` — native umbrella glue

Hand-authored C++ that ties the package's one `.so`/framework together (§8):

- the umbrella adapter that registers the TurboModule + Nitro view
- the Nitro view's C++ that calls **fressh-core's C-ABI** for the render plane
  (`attach(shellId, surface)`, `render_frame`, `send_input`, `detach`)

Generated C++ (regenerated, gitignored) lands in `cpp/generated/` (ubrn shim)
and `nitrogen/generated/` (Nitro view). This dir holds only the hand-written
adapter sources.

> Scaffold stub — empty until the umbrella build is wired (see
> `../android/CMakeLists.txt`).
