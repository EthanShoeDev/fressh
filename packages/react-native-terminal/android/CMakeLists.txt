project(ReactNativeTerminal)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME ReactNativeTerminal)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

# Our JNI bridge (HybridTerminal.kt <-> Rust C-ABI).
add_library(${PACKAGE_NAME} SHARED
  src/main/cpp/cpp-adapter.cpp
)

# Nitrogen-generated sources + nitro/fbjni/ReactAndroid linkage.
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/ReactNativeTerminal+autolinking.cmake)

# Required for 16KB page sizes (Android 15+).
set(CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS} -Wl,-z,max-page-size=16384")

# Import the Rust render lib (cdylib built per-ABI by cargo-ndk into jniLibs;
# Gradle packages jniLibs/*.so into the APK automatically, so we link the .so).
cmake_path(SET RUST_LIB
  ${CMAKE_SOURCE_DIR}/src/main/jniLibs/${ANDROID_ABI}/libfressh_render.so
  NORMALIZE)
add_library(fressh_render SHARED IMPORTED)
# The cargo-ndk-built cdylib has no SONAME, so linking it by full path would bake
# the build-time path into our NEEDED entry (dlopen then fails at runtime with
# "library ".../jniLibs/.../libfressh_render.so" not found"). IMPORTED_NO_SONAME
# makes CMake link via -l so the NEEDED entry is just "libfressh_render.so", which
# Gradle packages into the APK and the loader resolves by basename.
set_target_properties(fressh_render PROPERTIES
  IMPORTED_LOCATION ${RUST_LIB}
  IMPORTED_NO_SONAME TRUE)

find_library(LOG_LIB log)

# `android` provides ANativeWindow_fromSurface/_release used by cpp-adapter.
target_link_libraries(
  ${PACKAGE_NAME}
  fressh_render
  android
  ${LOG_LIB}
)
