#!/usr/bin/env bash
#
# Vendor prebuilt ANGLE (libEGL + libGLESv2, Metal backend) for iOS — the GLES2
# driver our renderer runs over on iOS (Strategy A + ANGLE→Metal, §2/§5). ANGLE
# has no published iOS dylibs from Google; we use the kivy/angle-builder release,
# which packages mainline ANGLE as `libEGL.xcframework` + `libGLESv2.xcframework`
# (each device + arm64/x64 simulator), with the dlopen-able dynamic libs our
# `khronos-egl` `dynamic` path resolves at runtime.
#
# Extracts the two xcframeworks to the PACKAGE ROOT, where they are COMMITTED
# (stable third-party prebuilts — see .gitignore, which ignores only the
# rust-derived shim_uniffi.xcframework). So this only needs re-running when bumping
# the pinned tag, NOT on every clean checkout. Pin the tag; bump deliberately. Run
# from the package dir: `bun run angle:fetch`.

set -euo pipefail

# Pinned ANGLE release (kivy/angle-builder). Bump intentionally + re-verify.
ANGLE_REPO="kivy/angle-builder"
ANGLE_TAG="chromium-7151_rev1"
ANGLE_ASSET="angle-iphoneall-universal.tar.gz" # device + arm64/x64 sim, universal

# Package root = parent of this script's ios/ dir.
PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "▸ Downloading ANGLE ${ANGLE_TAG}/${ANGLE_ASSET}"
gh release download "$ANGLE_TAG" -R "$ANGLE_REPO" -p "$ANGLE_ASSET" -D "$TMP"

echo "▸ Extracting libEGL.xcframework + libGLESv2.xcframework → ${PKG_DIR}"
tar xzf "$TMP/$ANGLE_ASSET" -C "$TMP"
for fw in libEGL.xcframework libGLESv2.xcframework; do
	rm -rf "${PKG_DIR:?}/${fw}"
	cp -R "$TMP/$fw" "$PKG_DIR/$fw"
	echo "  ✓ $fw"
done

echo "✓ ANGLE vendored at ${PKG_DIR} (libEGL.xcframework, libGLESv2.xcframework)"
