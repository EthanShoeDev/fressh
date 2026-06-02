package com.margelo.nitro.fressh

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.margelo.nitro.fressh.views.HybridTerminalManager

/**
 * ReactPackage for the terminal package. Three jobs:
 *  1. Its mere presence lets React Native autolinking detect this package and
 *     build/link its `android/build.gradle` (and thus libReactNativeTerminal.so).
 *  2. Registers the "Terminal" Nitro HybridView's generated ViewManager so Fabric
 *     can resolve <Terminal/> (else: "Can't find ViewManager 'Terminal'").
 *  3. Registers [ReactNativeTerminalModule], whose `installRustCrate()` installs
 *     the uniffi control-plane JSI bindings (globalThis.NativeShimUniffi).
 * The Nitro native C++ side (HybridObjects) is registered via [ReactNativeTerminalOnLoad]
 * in the static initializer below.
 */
class ReactNativeTerminalPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(ReactNativeTerminalModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    listOf(HybridTerminalManager())

  companion object {
    init {
      ReactNativeTerminalOnLoad.initializeNative()
    }
  }
}
