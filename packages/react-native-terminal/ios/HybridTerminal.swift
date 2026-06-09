import NitroModules
import UIKit

/// iOS implementation of the `Terminal` Nitro HybridView (the render plane, §10).
///
/// **STUB (Milestone A).** Android drives the render C-ABI
/// (`fressh_terminal_attach`/`draw`/…) off a `SurfaceView` + GLES2/EGL. iOS has no
/// EGL: GLES runs via ANGLE→Metal over a `CAMetalLayer` (§5), which is the next
/// milestone. Until then this view exists only so the Nitro autolinking compiles
/// and the control plane (SSH) can ship on iOS — it stores the props and draws a
/// solid background, nothing more. The durable `Term` keeps filling in
/// `fressh-core`'s registry regardless, so wiring the real renderer later is purely
/// additive (attach a `CAMetalLayer`, start a `CADisplayLink` loop, forward these
/// props to the C-ABI — mirror `HybridTerminal.kt`).
class HybridTerminal: HybridTerminalSpec {
  // A plain placeholder UIView. Dark so a mounted-but-unrendered terminal is
  // visibly distinct from a layout bug. Becomes the CAMetalLayer host in Milestone B.
  var view: UIView = {
    let v = UIView()
    v.backgroundColor = .black
    return v
  }()

  // Props (stored; forwarded to the render C-ABI once the renderer lands).

  /// Bundled monospace font file path (no fontconfig on mobile, §6).
  var fontPath: String = ""

  /// Render config JSON (physical px) assembled by the JS `<Terminal config>` wrapper.
  var configJson: String? = nil

  /// The durable shell to render, by id. Unset → cleared frame.
  var shellId: String? = nil
}
