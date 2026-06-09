#!/usr/bin/env bash
#
# Build the single native crate `shim-uniffi` for iOS and package it as an
# `.xcframework` the podspec links (§1 / §8). This is the iOS analogue of the
# package's `build:android` (`cargo ndk … -p shim-uniffi`): one staticlib carrying
# BOTH planes (uniffi control plane + render C-ABI) so there is exactly ONE copy of
# fressh-core's registry statics.
#
# Unlike `main`'s react-native-uniffi-russh/rust/build-ios.sh, we do NOT run
# uniffi-bindgen-swift / emit a modulemap: this branch consumes ubrn's *JSI*
# bindings (generated C++ in `cpp/generated/shim_uniffi.cpp` calls the crate's
# `ffi_*` symbols), so the xcframework only needs the static archive — no headers.
# The TS/C++ bindings come from the cross-platform `ubrn:generate` (host `.a`).
#
# Targets: aarch64-apple-ios (device); aarch64-apple-ios-sim + x86_64-apple-ios
# (simulator) lipo'd into one fat slice. An xcframework keeps the two arm64 slices
# (device vs sim) apart — they can't be lipo'd together.
#
# Run from the `rust/` dir (the package scripts do: `cd rust && ./build-ios.sh`).

set -euo pipefail

LIB=shim_uniffi # cargo crate `shim-uniffi` → libshim_uniffi.a
PROFILE=release
PROFILE_DIR=release # cargo's target/<triple>/<dir>; `release` for --release

for arg in "$@"; do
	case $arg in
	--debug)
		PROFILE=debug
		PROFILE_DIR=debug
		;;
	esac
done

DEVICE_TARGET=aarch64-apple-ios
SIM_TARGETS=(aarch64-apple-ios-sim x86_64-apple-ios)
FAT_SIM_DIR="target/ios-simulator-fat/${PROFILE_DIR}"
OUT_XCFRAMEWORK="../${LIB}.xcframework" # package root (gitignored; globbed into `files`)

cargo_flags=(-p shim-uniffi)
[ "$PROFILE" = "release" ] && cargo_flags+=(--release)

echo "▸ Building lib${LIB}.a for device + simulator (${PROFILE})"
for target in "$DEVICE_TARGET" "${SIM_TARGETS[@]}"; do
	echo "  - $target"
	cargo build "${cargo_flags[@]}" --target "$target"
done

echo "▸ lipo'ing the simulator slices → fat lib"
mkdir -p "$FAT_SIM_DIR"
sim_libs=()
for target in "${SIM_TARGETS[@]}"; do
	sim_libs+=("target/${target}/${PROFILE_DIR}/lib${LIB}.a")
done
lipo -create "${sim_libs[@]}" -output "${FAT_SIM_DIR}/lib${LIB}.a"

echo "▸ Creating ${OUT_XCFRAMEWORK}"
rm -rf "$OUT_XCFRAMEWORK" # xcodebuild refuses to overwrite an existing output
xcodebuild -create-xcframework \
	-library "target/${DEVICE_TARGET}/${PROFILE_DIR}/lib${LIB}.a" \
	-library "${FAT_SIM_DIR}/lib${LIB}.a" \
	-output "$OUT_XCFRAMEWORK"

echo "✓ Built ${OUT_XCFRAMEWORK}"
