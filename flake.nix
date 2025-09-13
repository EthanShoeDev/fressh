{
  description = "Expo RN devshells (local emulator / remote AVD)";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # Android SDK as packages
    android-nixpkgs = {
      url = "github:tadfisher/android-nixpkgs";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, android-nixpkgs, ... }:
  let
    systems = [ "x86_64-linux" "aarch64-darwin" "x86_64-darwin" ];
    forAllSystems = f: nixpkgs.lib.genAttrs systems (system:
      f {
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ android-nixpkgs.overlays.default ];
          config.allowUnfree = true; # emulator is unfree
        };
      }
    );
  in
  {
    devShells = forAllSystems ({ pkgs }: let
      makeAndroidSdk = mode:
        let
          androidSdk = pkgs.androidSdk (sdk:
           if mode == "full" then
              (with sdk; [
                cmdline-tools-latest
                platform-tools
                emulator
                build-tools-36-0-0
                platforms-android-36
                system-images-android-36-0-Baklava-google-apis-playstore-x86-64
                # Add NDK + CMake for native builds
                ndk-26-1-10909125
                cmake-3-22-1
              ])
            else if mode == "remote" then
              (with sdk; [
                cmdline-tools-latest   # ← required for a valid SDK
                platform-tools         # adb/fastboot
              ])
            else
              throw "makeAndroidSdk: unknown mode '${mode}'. Use \"full\" or \"remote\"."
          );

          # Standard path from nixpkgs' androidSdk wrapper
          # https://ryantm.github.io/nixpkgs/languages-frameworks/android/#notes-on-environment-variables-in-android-projects
          sdkRoot = "${androidSdk}/libexec/android-sdk";
        in
        {
          inherit androidSdk sdkRoot;
        };

      fullAndroidSdk   = makeAndroidSdk "full";
      remoteAndroidSdk = makeAndroidSdk "remote";

      defaultPkgs = with pkgs; [
        nodejs_22
        nodePackages.pnpm
        git
        just
        jq
        watchman
        jdk17
        gradle_8
      ];
    in {

      # Minimal: only universal dev tools you always want
      default = pkgs.mkShell {
        packages = defaultPkgs;
      };

      # Local emulator: full SDK + AVD bits for API 36
      android-local = pkgs.mkShell {
        packages = defaultPkgs ++ [ fullAndroidSdk.androidSdk ];
        shellHook = ''
          # Resolve SDK root robustly (libexec first, then share)
          _CANDS=(
            "${fullAndroidSdk.sdkRoot}"
            "${fullAndroidSdk.androidSdk}/libexec/android-sdk"
            "${fullAndroidSdk.androidSdk}/share/android-sdk"
          )
          for p in "''${_CANDS[@]}"; do
            if [ -d "$p" ]; then
              export ANDROID_SDK_ROOT="$p"
              export ANDROID_HOME="$p"
              break
            fi
          done

          if [ -z "$ANDROID_SDK_ROOT" ]; then
            echo "❌ Could not locate ANDROID_SDK_ROOT in Nix store. Check androidSdk composition."
            return 1
          fi

          # Ensure Nix adb/emulator/cmdline-tools win over system tools
          export PATH="$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"
          hash -r

          echo "ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT"
          which -a adb || true
          which -a emulator || true
          which -a avdmanager || true

          # quick sanity
          adb version || true
          emulator -version || true
          avdmanager --help >/dev/null || true
        '';
      };

      # Remote AVD workflow: no emulator/image; add scrcpy + adb only
      android-remote = pkgs.mkShell {
      packages = defaultPkgs ++ [
        remoteAndroidSdk.androidSdk  # provides adb/fastboot only
        pkgs.scrcpy
      ];
      shellHook = ''
        export ANDROID_SDK_ROOT="${remoteAndroidSdk.sdkRoot}"
        export ANDROID_HOME="${remoteAndroidSdk.sdkRoot}"
        export PATH="${remoteAndroidSdk.sdkRoot}/platform-tools:$PATH"
        hash -r
        echo "Using Nix adb from: $ANDROID_SDK_ROOT"
        which -a adb
        adb version || true
        echo "Tip: ssh -N -L 5037:127.0.0.1:5037 user@remote && scrcpy"
      '';
    };
    });
  };
}
