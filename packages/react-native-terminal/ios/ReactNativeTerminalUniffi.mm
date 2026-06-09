// Control-plane installer (iOS) — the analogue of Android's
// ReactNativeTerminalModule.kt + cpp-adapter.cpp `nativeInstallRustCrate` (§5/§8).
//
// JS calls `ReactNativeTerminalUniffi.installRustCrate()` once at startup
// (src/ssh.ts → ensureNativeInstalled). That installs the
// `globalThis.NativeShimUniffi` host object the ubrn-generated TS bindings call;
// without it the first uniffi call throws "Cannot read property
// 'ubrn_uniffi_shim_uniffi_fn_func_*' of undefined".
//
// We hand-wire this (rather than `ubrn build`'s generated TurboModule) so the
// Rust links into the SAME pod/binary as the Nitro render view → ONE copy of
// fressh-core's registry statics (§8). We call the lower-level
// `NativeShimUniffi::registerModule` primitive directly, exactly like Android.
//
// Mechanism: a non-codegen C++ TurboModule. The install host function receives
// the `jsi::Runtime&` directly (no fragile bridge-runtime lookup, which is awkward
// in bridgeless mode) and the CallInvoker from `params.jsInvoker`.
//
// CRITICAL: the class MUST conform to `RCTTurboModule`. RCTTurboModuleManager gates
// the whole getTurboModule: path on `conformsToProtocol:@protocol(RCTTurboModule)`
// (RCTTurboModuleManager.mm) — without it the module is treated as a legacy interop
// module, getTurboModule: is never called, and the `methodMap_` methods (incl.
// installRustCrate) never surface to JS. This app is new-arch only (Nitro mandates
// it), so no old-arch fallback is needed.

#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <ReactCommon/RCTTurboModule.h>

#include <memory>

#include "shim_uniffi.hpp" // ::NativeShimUniffi::registerModule

namespace fressh_terminal_install {
using namespace facebook;
using namespace facebook::react;

// TurboModule carrying the CallInvoker so the install host function can hand it to
// registerModule (Rust uses it to call back into JS for the event sink).
class ReactNativeTerminalUniffiModule : public ObjCTurboModule {
public:
  ReactNativeTerminalUniffiModule(const ObjCTurboModule::InitParams &params);
  std::shared_ptr<CallInvoker> callInvoker;
};

// Installs globalThis.NativeShimUniffi. Synchronous: ssh.ts uses the bindings
// immediately after this returns. Returns true on success (parity with Android's
// boolean nativeInstallRustCrate).
static jsi::Value installRustCrate(jsi::Runtime &rt, TurboModule &turboModule,
                                   const jsi::Value * /*args*/, size_t /*count*/) {
  auto &tm = static_cast<ReactNativeTerminalUniffiModule &>(turboModule);
  ::NativeShimUniffi::registerModule(rt, tm.callInvoker);
  return jsi::Value(true);
}

ReactNativeTerminalUniffiModule::ReactNativeTerminalUniffiModule(
    const ObjCTurboModule::InitParams &params)
    : ObjCTurboModule(params), callInvoker(params.jsInvoker) {
  methodMap_["installRustCrate"] = MethodMetadata{0, installRustCrate};
}
} // namespace fressh_terminal_install

@interface ReactNativeTerminalUniffi : NSObject <RCTBridgeModule, RCTTurboModule>
@end

@implementation ReactNativeTerminalUniffi

// Module name = "ReactNativeTerminalUniffi" (matches the TurboModuleRegistry lookup
// in ssh.ts and the Android ReactNativeTerminalModule.NAME).
RCT_EXPORT_MODULE()

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<fressh_terminal_install::ReactNativeTerminalUniffiModule>(params);
}

@end
