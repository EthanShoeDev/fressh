import NitroModules
import QuartzCore
import UIKit

/// CAMetalLayer-backed view that drives the Rust render C-ABI (ANGLE→Metal, §5) —
/// the iOS analogue of HybridTerminal.kt's `SurfaceView` + `Choreographer` loop.
///
/// On first layout it `fressh_terminal_attach`es its `CAMetalLayer` to ANGLE,
/// runs a `CADisplayLink` (vsync) loop → `fressh_terminal_draw` (which looks the
/// shell's durable `Term` up from fressh-core's registry by `shellId` and draws it
/// — the byte stream never reaches JS), and forwards shellId/config/resize/teardown
/// to the C-ABI. Changing `shellId` rebinds (instant reattach, full scrollback, §9).
final class TerminalMetalView: UIView {
  // The view's backing layer IS a CAMetalLayer — what ANGLE renders into via Metal.
  override class var layerClass: AnyClass { CAMetalLayer.self }
  private var metalLayer: CAMetalLayer { layer as! CAMetalLayer }

  /// Opaque Rust render handle (nil = not attached).
  private var handle: UnsafeMutableRawPointer?
  private var displayLink: CADisplayLink?

  /// Bundled monospace font file path (no fontconfig on mobile, §6/§8).
  var fontPath: String = ""

  /// Render config JSON (physical px), assembled by the JS `<Terminal config>` wrapper.
  var configJson: String? {
    didSet {
      guard let handle else { return }
      withOptCString(configJson) { fressh_terminal_set_config(handle, $0) }
    }
  }

  /// The durable shell to render. Rebinds the live view without a remount.
  var shellId: String? {
    didSet {
      guard let handle else { return }
      withOptCString(shellId) { fressh_terminal_set_shell(handle, $0) }
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { teardown() } else { attachIfNeeded() }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    syncDrawableSize()
    // Attach once we have real bounds; afterwards just keep the grid in lockstep
    // with the on-screen size (keyboard open/close), mirroring the Android resize poll.
    if handle != nil {
      fressh_terminal_resize(handle)
    } else {
      attachIfNeeded()
    }
  }

  /// Keep the Metal drawable in physical px (logical bounds × screen scale).
  private func syncDrawableSize() {
    let scale = window?.screen.scale ?? UIScreen.main.scale
    metalLayer.contentsScale = scale
    let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
    if size.width > 0, size.height > 0 { metalLayer.drawableSize = size }
  }

  private func attachIfNeeded() {
    guard handle == nil, window != nil, bounds.width > 0, bounds.height > 0 else { return }
    syncDrawableSize()
    let layerPtr = Unmanaged.passUnretained(metalLayer).toOpaque()
    handle = resolveFontPath().withCString { fp in
      withOptCString(configJson) { cfg in
        withOptCString(shellId) { sid in
          fressh_terminal_attach(layerPtr, fp, cfg, sid)
        }
      }
    }
    if handle != nil { startRenderLoop() }
  }

  private func startRenderLoop() {
    let link = CADisplayLink(target: self, selector: #selector(onFrame))
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  @objc private func onFrame() {
    guard let handle else { return }
    fressh_terminal_draw(handle)
  }

  /// Drop the renderer/EGL context. The shell's `Term` survives in the registry,
  /// so a later attach to the same `shellId` resumes instantly (§9).
  func teardown() {
    displayLink?.invalidate()
    displayLink = nil
    if let handle {
      fressh_terminal_destroy(handle)
      self.handle = nil
    }
  }

  /// The native renderer needs a font *file* path. Fall back to the bundled
  /// DejaVu Sans Mono shipped in the podspec resource bundle.
  private func resolveFontPath() -> String {
    if !fontPath.isEmpty { return fontPath }
    let owner = Bundle(for: TerminalMetalView.self)
    if let bundleURL = owner.url(forResource: "FresshTerminalFonts", withExtension: "bundle"),
      let resources = Bundle(url: bundleURL),
      let font = resources.path(forResource: "DejaVuSansMono", ofType: "ttf")
    {
      return font
    }
    return owner.path(forResource: "DejaVuSansMono", ofType: "ttf") ?? ""
  }

  deinit { teardown() }
}

/// Call `body` with a C string for `s`, or NULL when `s` is nil.
private func withOptCString<R>(_ s: String?, _ body: (UnsafePointer<CChar>?) -> R) -> R {
  if let s { return s.withCString { body($0) } }
  return body(nil)
}

/// iOS implementation of the `Terminal` Nitro HybridView (the render plane, §10).
/// Owns the `CAMetalLayer` view and forwards props to it.
class HybridTerminal: HybridTerminalSpec {
  private let metalView = TerminalMetalView()
  var view: UIView { metalView }

  var fontPath: String = "" {
    didSet { metalView.fontPath = fontPath }
  }
  var configJson: String? {
    didSet { metalView.configJson = configJson }
  }
  var shellId: String? {
    didSet { metalView.shellId = shellId }
  }

  func onDropView() {
    metalView.teardown()
  }
}
