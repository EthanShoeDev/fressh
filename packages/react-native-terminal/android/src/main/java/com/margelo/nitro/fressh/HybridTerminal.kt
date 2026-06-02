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
 * Native terminal view (Nitro HybridView). Owns a [SurfaceView]; on surface
 * creation it hands the `ANativeWindow` to the Rust render core (via JNI) and
 * drives a Choreographer (vsync) render loop. Renders a hardcoded demo Term for
 * now — SSH/session attach come later. See docs §5/§10.
 */
@Keep
@DoNotStrip
class HybridTerminal(
  val context: ThemedReactContext,
) : HybridTerminalSpec() {
  private val surfaceView = SurfaceView(context)

  /** Opaque pointer to the native render handle (0 = none). */
  private var nativeHandle: Long = 0L
  private var frameCallback: Choreographer.FrameCallback? = null

  override val view: View = surfaceView

  // Prop: bundled monospace font file path (no fontconfig on mobile, §6).
  override var fontPath: String = ""

  init {
    surfaceView.holder.addCallback(
      object : SurfaceHolder.Callback {
        override fun surfaceCreated(holder: SurfaceHolder) {
          nativeHandle = nativeCreate(holder.surface, resolveFontPath())
          if (nativeHandle != 0L) startRenderLoop()
        }

        override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
          // TODO: forward resize to native once the C-ABI grows a resize entry.
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

  // JNI bridge -> Rust C-ABI (see android/src/main/cpp/cpp-adapter.cpp).
  private external fun nativeCreate(surface: Surface, fontPath: String): Long

  private external fun nativeDraw(handle: Long)

  private external fun nativeDestroy(handle: Long)

  companion object {
    init {
      System.loadLibrary("ReactNativeTerminal")
    }
  }
}
