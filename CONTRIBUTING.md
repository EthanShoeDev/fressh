# Development with Nix (Android/Expo)

This repo ships a Nix **flake** that provides reproducible dev shells for React
Native + Expo and Android workflows. You don’t need global installs of
Node/Watchman/Android SDK—the shell provides everything.

## Prereqs

- Nix with flakes enabled (`nix --version` should work)
- (Optional, recommended) [`direnv`](https://direnv.net/) +
  [`nix-direnv`](https://github.com/nix-community/nix-direnv) to auto-enter
  shells

## Shell variants

We publish three dev shells:

- **`default`** – minimal JS toolchain you always want (Node, pnpm, watchman,
  git, jq, just)
- **`android-local`** – adds a full **Android SDK** + **Emulator** + **API 36
  Google Play x86_64** system image Good when you run the emulator **on your
  machine**.
- **`android-remote`** – no emulator/image; adds **adb** + **scrcpy** Good when
  you run an emulator **on a remote server** and mirror/control it locally.

Pick one per your setup.

## Quick start

### A) One-off use (no direnv)

```bash
# Minimal JS shell
nix develop .#default

# Local emulator workflow (SDK + emulator + API 36 image)
nix develop .#android-local

# Remote emulator workflow (adb + scrcpy only)
nix develop .#android-remote
```

### B) Auto-enter with direnv (recommended)

Create `.envrc` at the project root:

```bash
# choose one:
use flake .#android-local
# use flake .#android-remote
# use flake .#default
```

Then:

```bash
direnv allow
```

Any new shell in this folder will enter the selected dev shell automatically.

## What the shell sets up

- **Node/PNPM/Watchman/Git/JQ/Just** (all shells)
- **ANDROID_SDK_ROOT / ANDROID_HOME** (in `android-local`; points to the
  immutable SDK built by Nix)
- **adb / emulator / sdkmanager / avdmanager** (in `android-local`)
- **adb / scrcpy** (in `android-remote`)

> Tip: we keep the Android SDK fully **immutable** (declarative). You don’t
> “install packages” via Android Studio; the flake lists exactly which
> components are present.

## Local emulator workflow (`android-local`)

1. Enter the shell:

```bash
nix develop .#android-local
```

2. (First time) Create an AVD for API 36 (Google Play, x86_64):

```bash
avdmanager create avd -n a36-play-x86_64 \
  -k "system-images;android-36;google_apis_playstore;x86_64"
```

3. Run the emulator:

```bash
# GUI window (desktop)
emulator @a36-play-x86_64

# Headless (CI/servers):
emulator @a36-play-x86_64 -no-window -no-audio
# If no KVM: add -gpu swiftshader_indirect
```

4. Verify `adb` sees it:

```bash
adb devices
```

5. Run your typical Expo/RN commands (Metro, build, etc.) inside the shell.

> **macOS users**: You can still build Android in this shell. The
> `android-local` shell provides `platform-tools` + SDK commands; the GUI
> Android Studio app is optional. If you prefer to use the macOS GUI emulator
> instead of the Nix one, that’s fine—use `default` or `android-remote` and keep
> your local Android Studio install.

## Remote emulator workflow (`android-remote`)

Use this when your emulator runs on a remote Linux box (often headless/KVM).

1. Enter the shell:

```bash
nix develop .#android-remote
```

2. SSH-tunnel the **remote adb server** back to your machine:

```bash
ssh -N -L 5037:127.0.0.1:5037 user@remote-host
```

3. Point `adb` at the forwarded server and verify:

```bash
adb -H 127.0.0.1 -P 5037 devices
```

4. Mirror/control the remote emulator window locally:

```bash
scrcpy
```

That’s it—everything flows through SSH, and you don’t need any extra ports.

## Common tasks

- Check versions:

  ```bash
  adb version
  sdkmanager --version
  avdmanager --help
  ```

- Upgrade/change Android components Edit the system image or
  build-tools/platforms listed in `flake.nix` under the `androidSdk36`
  definition, then re-enter the shell.

- Clean emulators/AVDs AVDs live in `~/.android/avd` by default. You can remove
  an AVD with:

  ```bash
  avdmanager delete avd -n a36-play-x86_64
  ```

## Troubleshooting

- **Emulator is very slow / won’t start** (Linux): Ensure `/dev/kvm` exists and
  your user has permission (`kvm` group). Headless servers without KVM can still
  run, but add `-gpu swiftshader_indirect` and expect reduced performance.

- **`adb` doesn’t see the emulator**: Kill any stray local adb server and retry:

  ```bash
  adb kill-server
  adb start-server
  adb devices
  ```

- **Gradle/Java mismatch**: If your Android Gradle Plugin complains about Java,
  pin the JDK you need in the dev shell and set `JAVA_HOME`. (You can add a JDK
  to `defaultPkgs` in the flake if your project requires a specific version.)

- **Expo/Metro can’t find Android SDK**: Confirm `echo $ANDROID_SDK_ROOT` prints
  a path in the `android-local` shell.

## CI usage

You can build/test in CI with:

```bash
nix develop --command bash -lc 'pnpm install && pnpm test'
```

or pick a specific shell:

```bash
nix develop .#android-local --command bash -lc 'just android-build'
```

---

If you want, I can add a tiny `Justfile` with `just avd-create`, `just avd-run`,
and `just adb-tunnel-remote` helpers so the common commands are one-liners.

## Enable Nix flakes globally

If you see errors like:

```
error: experimental Nix feature 'nix-command' is disabled; add '--extra-experimental-features nix-command' to enable it
```

…it means flakes are not enabled in your Nix configuration yet.

You can enable them permanently with a one-liner:

```bash
sudo mkdir -p /etc/nix && echo 'experimental-features = nix-command flakes' | sudo tee /etc/nix/nix.conf
```

Then restart your shell (or `nix-daemon` on macOS), and the error goes away.

From now on you can just run:

```bash
nix develop .#android-local
```

without passing any extra flags.
