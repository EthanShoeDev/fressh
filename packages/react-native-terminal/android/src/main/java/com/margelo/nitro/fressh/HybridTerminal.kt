package com.margelo.nitro.fressh

import android.view.Choreographer
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.uimanager.ThemedReactContext

/**
 * Native terminal view (Nitro HybridView, the render plane §10). Owns a
 * [SurfaceView]; on surface creation it hands the `ANativeWindow` + the bound
 * `shellId` to the Rust render C-ABI (via JNI) and drives a Choreographer (vsync)
 * loop that draws the shell's durable `Term` from fressh-core's registry. The
 * byte stream never reaches JS. See docs §5/§10.
 */
@Keep
@DoNotStrip
class HybridTerminal(
  val context: ThemedReactContext,
) : HybridTerminalSpec() {
  // Plain SurfaceView: the buffer auto-tracks the view bounds. Keeping the grid in
  // lockstep with the on-screen size when the keyboard opens/closes is handled on the
  // Rust side, which polls the *settled* surface size from the draw loop (eglQuerySurface
  // lags the new geometry by a frame, so a one-shot read in surfaceChanged is unreliable
  // — esp. on GROW). The JS side (terminal flex:1 + the toolbar's keyboard-height-driven
  // marginBottom) is what actually resizes this view in both directions. See
  // docs/projects/complete/renderer-mismatched-selection-cutoff-scrollback.md.
  private val surfaceView = SurfaceView(context)

  /** Opaque pointer to the native render handle (0 = none). */
  private var nativeHandle: Long = 0L
  private var frameCallback: Choreographer.FrameCallback? = null

  override val view: View = surfaceView

  // Prop: bundled monospace font file path (no fontconfig on mobile, §6).
  override var fontPath: String = ""

  // Prop: render config as a JSON blob (physical px), assembled by the JS
  // <Terminal config={...}> wrapper. Carries color scheme, padding, cursor style,
  // bold-is-bright, font size. Live changes reflow the shell — a bonus over
  // desktop alacritty's restart-to-apply. We just forward the string; the renderer
  // parses + diffs it.
  override var configJson: String? = null
    set(value) {
      field = value
      if (nativeHandle != 0L) {
        nativeSetConfig(nativeHandle, value)
      }
    }

  // Prop: the durable shell to render. Rebinds the native view on change so the
  // same surface can follow a (re)started shell without a remount.
  override var shellId: String? = null
    set(value) {
      field = value
      if (nativeHandle != 0L) {
        nativeSetShell(nativeHandle, value)
      }
    }

  init {
    surfaceView.holder.addCallback(
      object : SurfaceHolder.Callback {
        override fun surfaceCreated(holder: SurfaceHolder) {
          nativeHandle = nativeAttach(holder.surface, resolveFontPath(), configJson, shellId)
          if (nativeHandle != 0L) startRenderLoop()
        }

        override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
          if (nativeHandle != 0L) nativeResize(nativeHandle)
        }

        override fun surfaceDestroyed(holder: SurfaceHolder) {
          stopRenderLoop()
          if (nativeHandle != 0L) {
            nativeDestroy(nativeHandle)
            nativeHandle = 0L
          }
        }
      },
    )
  }

  /**
   * The native renderer needs a font *file* path. If RN didn't supply one, fall
   * back to the bundled DejaVu Sans Mono asset, extracted to filesDir once.
   */
  private fun resolveFontPath(): String {
    if (fontPath.isNotEmpty()) return fontPath
    val out = java.io.File(context.filesDir, "DejaVuSansMono.ttf")
    if (!out.exists()) {
      context.assets.open("fonts/DejaVuSansMono.ttf").use { input ->
        out.outputStream().use { output -> input.copyTo(output) }
      }
    }
    return out.absolutePath
  }

  private fun startRenderLoop() {
    val callback =
      object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
          if (nativeHandle == 0L) return
          nativeDraw(nativeHandle)
          Choreographer.getInstance().postFrameCallback(this)
        }
      }
    frameCallback = callback
    Choreographer.getInstance().postFrameCallback(callback)
  }

  private fun stopRenderLoop() {
    frameCallback?.let { Choreographer.getInstance().removeFrameCallback(it) }
    frameCallback = null
  }

  // JNI bridge -> Rust render C-ABI (see android/src/main/cpp/cpp-adapter.cpp).
  private external fun nativeAttach(
    surface: Surface,
    fontPath: String,
    configJson: String?,
    shellId: String?,
  ): Long

  private external fun nativeSetShell(handle: Long, shellId: String?)

  private external fun nativeSetConfig(handle: Long, configJson: String?)

  private external fun nativeDraw(handle: Long)

  private external fun nativeResize(handle: Long)

  private external fun nativeSendInput(handle: Long, data: ByteArray)

  private external fun nativeDestroy(handle: Long)

  companion object {
    init {
      System.loadLibrary("ReactNativeTerminal")
    }
  }
}
