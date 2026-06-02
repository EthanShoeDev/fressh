# ─── UMBRELLA CMake (hand-authored) ──────────────────────────────────────────
# STUB — structure only. See docs/projects/native-rendering-refactor.md §8.
#
# Neither ubrn nor nitrogen expects to share a package, so we hand-author ONE
# target that produces ONE .so, linking everything statically so fressh-core's
# registry/runtime statics are a single shared instance (§8):
#
#   1. import the cargo staticlib:  libfressh_core.a / libshim_uniffi.a
#        add_library(fressh_core STATIC IMPORTED)
#        set_target_properties(... IMPORTED_LOCATION
#            src/main/jniLibs/${ANDROID_ABI}/libshim_uniffi.a)
#   2. add ubrn's generated C++ shim sources (cpp/generated/*.cpp)
#   3. add nitrogen's generated view sources (nitrogen/generated/android/**)
#   4. add our umbrella adapter (cpp/*.cpp) + the Nitro view C++ that calls
#      fressh-core's C-ABI for the render plane
#   5. link: ReactAndroid::reactnative, fbjni, jsi, log, EGL, GLESv2, + the
#      rust staticlib
#
# Base the boilerplate (ReactAndroid version sniffing, 16KB page alignment) on
# packages/react-native-uniffi-russh/android/CMakeLists.txt.

cmake_minimum_required(VERSION 3.9.0)
project(ReactNativeTerminal)

# TODO(scaffold): implement the umbrella target described above.
message(WARNING "ReactNativeTerminal CMakeLists is a scaffold stub — not buildable yet.")
