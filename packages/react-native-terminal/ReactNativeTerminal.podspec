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
  # statics — ONE copy, §8), plus ANGLE's libEGL/libGLESv2 (dynamic, Metal backend
  # — the GLES2 driver the renderer runs over on iOS, §2/§5). The ANGLE frameworks
  # must be EMBEDDED: dyld loads them at launch and egl.rs resolves their symbols
  # from the process image (Library::this()). Fetch them with `bun run angle:fetch`.
  s.vendored_frameworks = [
    "shim_uniffi.xcframework",
    "libEGL.xcframework",
    "libGLESv2.xcframework",
  ]

  # Expose the render C-ABI header in the module umbrella so HybridTerminal.swift can
  # call fressh_terminal_* (Swift imports the module's PUBLIC headers). Setting
  # public_header_files restricts the public set, so this must be additive with
  # nitrogen's — which appends to it in add_nitrogen_files below.
  s.public_header_files = "ios/FresshTerminalRenderABI.h"

  # Bundled monospace font for the renderer — FreeType rasterizes it by file path
  # (no fontconfig on mobile, §6/§8). HybridTerminal.swift resolves it from this
  # bundle. The Android side ships the same DejaVuSansMono.ttf as an asset.
  s.resource_bundles = {
    "FresshTerminalFonts" => ["ios/fonts/*.ttf"],
  }

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
