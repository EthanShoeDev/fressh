project(ReactNativeTerminal)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME ReactNativeTerminal)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

# The single package .so (§8). It contains:
#   - the Nitro render JNI bridge (cpp-adapter.cpp) -> the Rust render C-ABI
#   - the ubrn-generated uniffi JSI bindings (cpp/generated/shim_uniffi.cpp) +
#     the install glue (cpp-adapter.cpp's nativeInstallRustCrate -> registerModule)
# ...and it LINKS the Rust cdylib `libshim_uniffi.so`, which holds the uniffi
# scaffolding + the render C-ABI + fressh-core's registry statics (ONE copy — so
# the control plane and the render plane see the same sessions).
add_library(${PACKAGE_NAME} SHARED
  src/main/cpp/cpp-adapter.cpp
  ../cpp/generated/shim_uniffi.cpp
)

# CRITICAL: hide all symbols by default; only the JNIEXPORT entry points (which carry
# explicit default visibility) stay exported. Without this, the React/Nitro template
# instantiations we compile in (ShadowNode, State, ConcreteState, StateWrapperImpl,
# RawPropsParser, …) are exported with default visibility and INTERPOSE over
# libreactnative.so's copies at load time. RN core then manipulates Fabric State
# objects through OUR differently-built copies, corrupting the view-state round-trip:
# props parse correctly in cloneProps but come back freed/garbage in updateViewProps,
# so NewStringUTF aborts (and ~HybridTerminalState segfaults). Other Nitro libs
# (e.g. NitroMmkv) export 0 such symbols; this hand-written umbrella must match.
target_compile_options(${PACKAGE_NAME} PRIVATE -fvisibility=hidden -fvisibility-inlines-hidden)
target_link_options(${PACKAGE_NAME} PRIVATE -Wl,--exclude-libs,ALL)

# Nitrogen-generated sources + nitro/fbjni/ReactAndroid (jsi, ReactCommon) linkage
# + their include dirs (the generated uniffi cpp uses <jsi/jsi.h> and
# <ReactCommon/CallInvoker.h>, both provided here).
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/ReactNativeTerminal+autolinking.cmake)

# Resolve uniffi-bindgen-react-native's header-only C++ runtime (UniffiCallInvoker.h
# etc.) by walking up node_modules from this dir (works from the consuming app).
execute_process(
  COMMAND node -e "const fs=require('fs'),p=require('path');let d=process.cwd();while(d.length>1){const c=p.join(d,'node_modules/uniffi-bindgen-react-native/cpp/includes');if(fs.existsSync(c)){process.stdout.write(c);break;}d=p.dirname(d);}"
  WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
  OUTPUT_VARIABLE UNIFFI_INCLUDES
  OUTPUT_STRIP_TRAILING_WHITESPACE)

target_include_directories(${PACKAGE_NAME} PRIVATE
  ${CMAKE_SOURCE_DIR}/../cpp/generated
  ${UNIFFI_INCLUDES}
)

# Required for 16KB page sizes (Android 15+).
set(CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS} -Wl,-z,max-page-size=16384")

# Import the Rust cdylib (built per-ABI by cargo-ndk into jniLibs). It carries BOTH
# the uniffi scaffolding (the ffi_* symbols the generated cpp calls) AND the render
# C-ABI (the fressh_terminal_* symbols the JNI bridge calls), so there is one shared
# registry. Linked SHARED (not a static .a) so neither plane gets its own copy.
cmake_path(SET RUST_LIB
  ${CMAKE_SOURCE_DIR}/src/main/jniLibs/${ANDROID_ABI}/libshim_uniffi.so
  NORMALIZE)
add_library(shim_uniffi SHARED IMPORTED)
# The cargo-ndk cdylib has no SONAME → IMPORTED_NO_SONAME so the NEEDED entry is the
# basename (resolved by the loader from the APK), not the build-time path.
set_target_properties(shim_uniffi PROPERTIES
  IMPORTED_LOCATION ${RUST_LIB}
  IMPORTED_NO_SONAME TRUE)

find_library(LOG_LIB log)

# `android` provides ANativeWindow_fromSurface/_release used by cpp-adapter.
# react/jsi/fbjni/nitro come from the nitrogen autolinking include above.
target_link_libraries(
  ${PACKAGE_NAME}
  shim_uniffi
  android
  ${LOG_LIB}
)
