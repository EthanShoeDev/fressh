# React Native SSH — iOS simulator limitations & paths forward

_Last updated: 2025-09-12_

## TL;DR

- Our current stack (`react-native-ssh-sftp` → `NMSSH (aanah0 fork)` → prebuilt
  OpenSSL/libssh2) **fails on the iOS Simulator** because the vendored native
  libraries are compiled for **iOS device** only (platform: `iphoneos`), not
  **iOS Simulator** (platform: `iphonesimulator`).
- The proper modern fix is to use **XCFrameworks** that include **both** device
  and simulator slices, and have NMSSH link against those instead of raw static
  `.a` libraries.
- We have two main paths:
  1. Keep using the existing RN package, but swap NMSSH’s underlying crypto/SSH
     libs to an **XCFramework** (e.g., from `DimaRU/Libssh2Prebuild`), via a
     tiny CocoaPods change.
  2. Build our **own RN native module** (TurboModule/JSI) that links **libssh2**
     and **OpenSSL** directly (using or adapting the Libssh2Prebuild scripts),
     fixing iOS Simulator support and also addressing Android reliability issues
     (like double “disconnect” callbacks).

---

## Current stack & limitation

### Stack

- App → `react-native-ssh-sftp`
- iOS native → `NMSSH` (via the `aanah0/NMSSH` fork for a newer libssh2
  baseline)
- `NMSSH` bundles **precompiled OpenSSL + libssh2** as static libraries.

### Why iOS Simulator builds fail

- Xcode treats **device** and **simulator** as **different platforms**. Since
  Apple Silicon, both may be `arm64`, but they are **not interchangeable**:
  - Device slice: `ios-arm64` (platform: `iphoneos`)
  - Simulator slices: `ios-arm64` and/or `ios-x86_64` (platform:
    `iphonesimulator`)

- NMSSH’s vendored libs are device-only (`iphoneos`). When the Simulator build
  links those, the linker throws:

  ```
  ld: building for 'iOS-simulator', but linking in object file .../libcrypto.a[arm64] built for 'iOS'
  ```

- **XCFrameworks** solve this: they are a bundle containing the correct slices
  for both platforms. Xcode picks the proper slice automatically.

> Temporary hack (not recommended): exclude `arm64` for the simulator
> (`EXCLUDED_ARCHS[sdk=iphonesimulator*]=arm64`) to force an x86_64 sim under
> Rosetta. This “works” but loses native-sim performance and is brittle.

---

## Path 1 — Keep current RN package; replace NMSSH’s vendored libs with an XCFramework

**Goal:** Do _not_ change `react-native-ssh-sftp` or the NMSSH **API**. Only
change how NMSSH links to OpenSSL/libssh2.

### What we’ll use

- **`DimaRU/Libssh2Prebuild`**: ships a ready-made **XCFramework** (“CSSH”) that
  bundles **libssh2 + OpenSSL** with both **device** and **simulator** slices.
- CocoaPods can consume XCFrameworks via a **binary pod**
  (`vendored_frameworks`), but Libssh2Prebuild is published for **SwiftPM**. So
  we add a tiny **`CSSH-Binary` podspec** that points to its zipped XCFramework.

### Minimal changes

1. **Fork NMSSH** (from `aanah0/NMSSH`) and edit **`NMSSH.podspec`**
   - **Remove** the vendored static libs (the `.a` files).
   - **Add** a dependency on `CSSH-Binary` (our binary pod that vends
     `CSSH.xcframework`).

   **Podspec diff (conceptual):**

   ```diff
   @@
    Pod::Spec.new do |s|
      s.name     = 'NMSSH'
      # ... (other metadata unchanged)

   -  s.vendored_libraries = [
   -    'NMSSH-iOS/Libraries/lib/libssh2.a',
   -    'NMSSH-iOS/Libraries/lib/libssl.a',
   -    'NMSSH-iOS/Libraries/lib/libcrypto.a'
   -  ]
   +  s.dependency 'CSSH-Binary', '~> 1.11'
    end
   ```

2. **Create a tiny binary pod for CSSH** (one-file repo): `CSSH-Binary.podspec`

   ```ruby
   Pod::Spec.new do |s|
     s.name     = 'CSSH-Binary'
     s.version  = '1.11.0' # match the Libssh2/OpenSSL combo you choose
     s.summary  = 'libssh2 + OpenSSL as XCFramework (from DimaRU/Libssh2Prebuild)'
     s.license  = { :type => 'MIT' }
     s.homepage = 'https://github.com/your-org/cssh-binary'
     s.authors  = { 'Your Name' => 'you@example.com' }
     s.platform = :ios, '12.0'
     s.source   = {
       :http => 'https://github.com/DimaRU/Libssh2Prebuild/releases/download/1.11.0-OpenSSL-1-1-1w/CSSH.xcframework.zip'
     }
     s.vendored_frameworks = 'CSSH.xcframework'
   end
   ```

   - You can host the zip yourself if you want deterministic supply (recommended
     for CI).
   - Ensure license attributions (OpenSSL 3.x: Apache-2.0; libssh2:
     BSD-3-Clause) are included in our OSS notices.

3. **Wire via Expo** (`expo-build-properties`) in `app.config.ts`

   ```ts
   [
   	'expo-build-properties',
   	{
   		ios: {
   			extraPods: [
   				// Binary pod that vends the XCFramework
   				{
   					name: 'CSSH-Binary',
   					podspec:
   						'https://raw.githubusercontent.com/your-org/cssh-binary/main/CSSH-Binary.podspec',
   				},
   				// Our NMSSH fork that depends on CSSH-Binary
   				{
   					name: 'NMSSH',
   					git: 'https://github.com/your-org/NMSSH.git',
   					branch: 'cssh-xcframework',
   				},
   			],
   		},
   		android: {
   			packagingOptions: {
   				pickFirst: ['META-INF/versions/9/OSGI-INF/MANIFEST.MF'],
   			},
   		},
   	},
   ];
   ```

4. **Rebuild**

   ```bash
   npx expo prebuild --platform ios --clean
   npx pod-install
   npx expo run:ios   # Simulator should now link correctly
   ```

**Pros**

- Small surface area; we keep the RN package API intact.
- Correct, future-proof device/simulator packaging via XCFrameworks.
- Easy to maintain once the podspecs are set.

**Cons/Risks**

- We maintain a **fork of NMSSH** (podspec only).
- Potential conflicts with tools like **Flipper** if they also touch OpenSSL
  (rare; we can disable Flipper if needed).
- We rely on Libssh2Prebuild versions/tags (or build our own artifacts using
  their scripts).

---

## Path 2 — Build our own RN module (TurboModule/JSI) with libssh2/OpenSSL

**Goal:** Replace `react-native-ssh-sftp` + NMSSH with a **modern RN Native
Module** that links libssh2 directly and ships correct device/simulator binaries
out of the box.

### Why consider this

- Full control over the native surface (events, error handling, cancellation,
  reconnects).
- Fix Android reliability issues we’ve observed (e.g., “disconnect” callback
  firing multiple times, causing dev crashes).
- Avoid legacy Objective-C wrapper constraints; use **TurboModules/JSI**.

### High-level plan

**iOS**

- Use (or adapt) **Libssh2Prebuild build scripts** to produce our own
  **`libssh2.xcframework`** and **`OpenSSL.xcframework`** (or one combined
  framework).
- Publish them as a **binary CocoaPod** (like `CSSH-Binary`) _or_ vendor the
  XCFrameworks in our module pod.
- Write a thin Obj-C++/C++ wrapper exposing the SSH API needed by JS
  (connect/auth/exec/sftp/streaming).
- Export via **TurboModule** (codegen) or **JSI** (C++), and provide a typed TS
  API in the RN package.

**Android**

- Build **libssh2** against **OpenSSL** (or MbedTLS) with the **NDK**.
- Package `.so` libs per ABI (`arm64-v8a`, `x86_64`, etc.).
- Implement JNI layer with strict **once-only** callbacks (disconnect must be
  idempotent), and make the public JS API promise/observable based.
- Add tests that assert no multiple “disconnect” emissions.

**Common**

- Define a **stable JS API**:
  - Connection lifecycle (`connect`, `ready`, `disconnect`),
  - Auth variants (password, key, agent if supported),
  - Exec/PTY streaming,
  - SFTP (get/put/mkdir/list/stat),
  - Structured errors (error codes, host key checks, timeouts),
  - Events (`onData`, `onExit`, `onError`, `onDisconnect`).

- **Testing/CI**: Simulated hosts (Docker) for integration tests; E2E with detox
  where feasible; CI matrix includes iOS Simulator and Android emulators.

**Pros**

- Clean slate, better DX, fewer legacy constraints.
- We can ensure **simulator** support is first-class.
- Fixes Android issues definitively.

**Cons**

- More initial engineering time.
- We own native maintenance across platforms.

---

## Known Android issue in current package

We’ve observed that **disconnect** can trigger the callback **more than once**,
which crashes the app in dev (double resolve/reject or repeated event emission).
If we keep the current package for now:

- Add a JS-side **guard** to make `disconnect()` idempotent (ignore subsequent
  calls/notifications after the first).
- If we fork, fix the native layer so it emits exactly once and cleans up
  listeners predictably.

(If we pursue **Path 2**, we’ll design the native layer so all
callbacks/promises are strictly single-shot and lifecycle-scoped.)

---

## Recommendation

- **Short term:** Implement **Path 1**. It’s the smallest change to unblock
  Simulator builds:
  - Add a `CSSH-Binary` binary pod (vend `CSSH.xcframework`).
  - Fork NMSSH podspec to depend on it.
  - Wire both via `expo-build-properties` `ios.extraPods`.

- **Medium term:** Plan **Path 2** to remove legacy NMSSH constraints and
  resolve Android issues thoroughly using a Nitro/TurboModule with direct
  libssh2 bindings.

---

## Appendix

### A. `CSSH-Binary.podspec` (example)

```ruby
Pod::Spec.new do |s|
  s.name     = 'CSSH-Binary'
  s.version  = '1.11.0'
  s.summary  = 'libssh2 + OpenSSL as XCFramework (from DimaRU/Libssh2Prebuild)'
  s.license  = { :type => 'MIT' }
  s.homepage = 'https://github.com/your-org/cssh-binary'
  s.authors  = { 'Your Name' => 'you@example.com' }
  s.platform = :ios, '12.0'
  s.source   = {
    :http => 'https://github.com/DimaRU/Libssh2Prebuild/releases/download/1.11.0-OpenSSL-1-1-1w/CSSH.xcframework.zip'
  }
  s.vendored_frameworks = 'CSSH.xcframework'
end
```

### B. `NMSSH.podspec` diff (replace vendored `.a` libs)

```diff
-  s.vendored_libraries = [
-    'NMSSH-iOS/Libraries/lib/libssh2.a',
-    'NMSSH-iOS/Libraries/lib/libssl.a',
-    'NMSSH-iOS/Libraries/lib/libcrypto.a'
-  ]
+  s.dependency 'CSSH-Binary', '~> 1.11'
```

### C. `app.config.ts` (Expo)

```ts
plugins: [
	// ...
	[
		'expo-build-properties',
		{
			ios: {
				extraPods: [
					{
						name: 'CSSH-Binary',
						podspec:
							'https://raw.githubusercontent.com/your-org/cssh-binary/main/CSSH-Binary.podspec',
					},
					{
						name: 'NMSSH',
						git: 'https://github.com/your-org/NMSSH.git',
						branch: 'cssh-xcframework',
					},
				],
			},
			android: {
				packagingOptions: {
					pickFirst: ['META-INF/versions/9/OSGI-INF/MANIFEST.MF'],
				},
			},
		},
	],
];
```

### D. Build/Release notes

- **Rebuild steps**

  ```bash
  npx expo prebuild --platform ios --clean
  npx pod-install
  npx expo run:ios
  ```

- **Licenses**: Include OpenSSL and libssh2 license texts in our OSS notice.
- **Flipper**: If linking conflicts appear, disable Flipper in iOS debug builds.

### E. Temporary simulator workaround (not recommended long-term)

In both the app target and Pods project:

```
EXCLUDED_ARCHS[sdk=iphonesimulator*] = arm64
```

This forces an x86_64 Simulator under Rosetta, avoiding the immediate link error
but losing native-sim performance.

---

**Decision log**

- ✅ Adopt Path 1 now (XCFramework via CSSH + NMSSH podspec tweak).
- 🕒 Plan Path 2 (custom RN module) to address Android bugs and own the full
  stack.

# Updates

- 1. Implemented option 1. Seems to be working in simulator
