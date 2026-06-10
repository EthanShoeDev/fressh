// Render-plane C-ABI declarations (the iOS analogue of the `extern "C"` block in
// Android's cpp-adapter.cpp). Lets HybridTerminal.swift call the Rust render
// entry points in shim_uniffi.xcframework. Symbols are defined in
// shim-uniffi/src/render.rs; the staticlib is linked via the podspec.
//
// `window` is a `CAMetalLayer*` on iOS (ANGLE→Metal, §5). The handle is opaque.

#ifndef FRESSH_TERMINAL_RENDER_ABI_H
#define FRESSH_TERMINAL_RENDER_ABI_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/// Create an EGL/GLES2 (ANGLE→Metal) renderer for `window` (a `CAMetalLayer*`),
/// optionally bound to `shell_id`. Returns NULL on failure (see the unified log).
void *fressh_terminal_attach(void *window, const char *font_path,
                             const char *config_json, const char *shell_id);

/// (Re)bind the view to a shell id (e.g. once `startShell` resolves on the JS side).
void fressh_terminal_set_shell(void *handle, const char *shell_id);

/// Apply a new render config (JSON, physical px) at runtime.
void fressh_terminal_set_config(void *handle, const char *config_json);

/// Draw one frame (the bound shell's `Term`, or a cleared frame). Call per vsync.
void fressh_terminal_draw(void *handle);

/// Re-sync the renderer to the surface's current size (call on layout changes).
void fressh_terminal_resize(void *handle);

/// Send user input (stdin) to the bound shell.
void fressh_terminal_send_input(void *handle, const uint8_t *data, size_t len);

/// Drop the renderer/EGL context. The shell's `Term` stays alive in the registry,
/// so re-attaching to the same `shellId` resumes instantly (§9).
void fressh_terminal_destroy(void *handle);

#ifdef __cplusplus
}
#endif

#endif /* FRESSH_TERMINAL_RENDER_ABI_H */
