require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# The iOS analogue of the umbrella android/CMakeLists (§8): one pod that compiles
# BOTH planes into the app and links ONE Rust staticlib so there is a single copy
# of fressh-core's registry statics.
#
#   - Control plane: the ubrn-generated JSI bindings C++ (cpp/generated/*.cpp →
#     NativeShimUniffi::registerModule) + our hand-authored ios/*.mm installer
#     (mirrors Android's nativeInstallRustCrate; calls registerModule directly —
#     we run `ubrn generate`, NOT `ubrn build`, so ubrn does not own this build).
#   - Render plane: the Nitro HybridView (nitrogen sources via add_nitrogen_files +
#     our ios/HybridTerminal.swift). On iOS this is a STUB for now — GLES via
#     ANGLE→Metal lands later (§5); the view compiles and draws nothing.
#   - Rust: shim_uniffi.xcframework (built by `bun run build:ios` → rust/build-ios.sh),
#     carrying the uniffi scaffolding + render C-ABI + the shared registry statics.

Pod::Spec.new do |s|
  s.name         = "ReactNativeTerminal"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/EthanShoeDev/fressh.git", :tag => "#{s.version}" }

  # Hand-authored iOS sources (the .mm installer + the Nitro Swift view) and the
  # ubrn-generated JSI bindings C++. add_nitrogen_files (below) APPENDS the
  # nitrogen-generated specs/bridges to this list.
  s.source_files = [
    "ios/**/*.{h,m,mm,swift}",
    "cpp/generated/**/*.{h,hpp,c,cpp}",
  ]

  # The single Rust staticlib (control plane + render C-ABI + fressh-core registry
  # statics — ONE copy, §8). Device + simulator slices in one xcframework.
  s.vendored_frameworks = "shim_uniffi.xcframework"

  # Brings ubrn's header-only C++ runtime (UniffiCallInvoker.h, RustArcPtr.h, …)
  # onto the header path — the generated bindings #include these. Android resolves
  # the same dir by walking node_modules in CMake; on iOS the pod dependency does it.
  s.dependency "uniffi-bindgen-react-native"

  s.pod_target_xcconfig = {
    # The generated bindings + Nitro require C++20.
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    # `#include "shim_uniffi.hpp"` from our .mm + the generated .cpp.
    "HEADER_SEARCH_PATHS" => "\"$(PODS_TARGET_SRCROOT)/cpp/generated\"",
  }

  # React-Core / ReactCommon (turbomodule/core for ObjCTurboModule), Folly, etc.
  install_modules_dependencies(s)

  # Nitro HybridView (render plane): appends nitrogen's generated specs + bridges
  # to source_files, adds the NitroModules dependency, and merges the C++ <-> Swift
  # interop xcconfig. Loaded last so it extends (not overwrites) the above.
  load File.join(__dir__, "nitrogen", "generated", "ios", "ReactNativeTerminal+autolinking.rb")
  add_nitrogen_files(s)
end
