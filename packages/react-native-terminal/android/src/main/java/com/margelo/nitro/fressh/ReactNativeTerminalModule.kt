package com.margelo.nitro.fressh

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.turbomodule.core.interfaces.CallInvokerHolder

/**
 * Installs the uniffi control-plane JSI bindings (the `globalThis.NativeShimUniffi`
 * host object the ubrn-generated TS calls). JS invokes [installRustCrate] once at
 * startup (see `src/ssh.ts`), which hands the JSI runtime pointer + the
 * `CallInvokerHolder` to native; `nativeInstallRustCrate` (cpp-adapter.cpp) reaches
 * the C++ CallInvoker via fbjni `cthis()` (RN 0.85 dropped the old field) and calls
 * `NativeShimUniffi::registerModule`. Lives in the SAME .so as the Nitro render
 * plane so both share one `fressh-core` registry. (§8/§10)
 */
@ReactModule(name = ReactNativeTerminalModule.NAME)
class ReactNativeTerminalModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName() = NAME

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun installRustCrate(): Boolean {
    val runtimePointer = reactContext.javaScriptContextHolder?.get() ?: return false
    val callInvokerHolder = reactContext.jsCallInvokerHolder ?: return false
    return nativeInstallRustCrate(runtimePointer, callInvokerHolder)
  }

  private external fun nativeInstallRustCrate(
    runtimePointer: Long,
    callInvokerHolder: CallInvokerHolder,
  ): Boolean

  companion object {
    const val NAME = "ReactNativeTerminalUniffi"

    init {
      System.loadLibrary("ReactNativeTerminal")
    }
  }
}
