{
  description = "Expo RN devshells (local emulator / remote AVD)";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # Newer pin for fast-moving tools that lag in the main locked nixpkgs.
    # secretspec's vault/OpenBao provider needs >= 0.10 (locked nixpkgs has 0.3.3,
    # which has no `openbao` backend). Additive: does not move the main toolchain.
    nixpkgs-recent.url = "github:NixOS/nixpkgs/nixos-unstable";
    android-nixpkgs = {
      url = "github:tadfisher/android-nixpkgs";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    fenix = {
      url = "github:nix-community/fenix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  nixConfig = {
    extra-substituters = [
      "https://android-nixpkgs.cachix.org"
      "https://nix-community.cachix.org"
    ];
    extra-trusted-public-keys = [
      "android-nixpkgs.cachix.org-1:2lZoPmwoyTVGaNDHqa6A32tdn8Gc0aMWBRrfXN1H3dQ="
      "nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs="
    ];
  };

  outputs = {
    self,
    nixpkgs,
    nixpkgs-recent,
    android-nixpkgs,
    fenix,
    ...
  }: let
    systems = ["x86_64-linux" "aarch64-darwin" "x86_64-darwin"];

    overlays = [
      android-nixpkgs.overlays.default
      # Pull secretspec from the newer pin so its vault/OpenBao provider exists
      # (the locked nixpkgs ships 0.3.3, which has no `openbao` backend).
      (_final: prev: {
        secretspec =
          (import nixpkgs-recent {
            inherit (prev) system;
            config.allowUnfree = true;
          })
          .secretspec;
      })
      # bun 1.3.14: the screenshot pipeline's resize step uses the native Bun.Image
      # API, which landed in 1.3.14 (apps/mobile/scripts/screenshot-derive.ts), but
      # nixpkgs is deliberately held at 1.3.13 — the 1.3.14 bump is stuck in draft
      # because `bun build --compile` produces segfaulting binaries on Nix:
      #   nixpkgs PR: https://github.com/NixOS/nixpkgs/pull/519796
      #   bun issue:  https://github.com/oven-sh/bun/issues/31023
      # That regression only affects `bun build --compile`, which this repo does NOT
      # use (our bun scripts run interpreted), so 1.3.14 is safe here. Re-point bun's
      # prebuilt sources at the official 1.3.14 release — same per-platform asset
      # layout nixpkgs uses, so its sourceRoot / autoPatchelf wiring still applies.
      # Drop this overlay once PR 519796 lands (nixpkgs bun >= 1.3.14).
      (_final: prev: {
        bun = prev.bun.overrideAttrs (old: {
          version = "1.3.14";
          # `src` is derived from passthru.sources (overridden below), so the version
          # bump without a direct `src` override is intentional — flag it, else
          # overrideAttrs warns on every eval (and aborts under abort-on-warn).
          __intentionallyOverridingVersion = true;
          passthru =
            old.passthru
            // {
              sources = {
                "aarch64-darwin" = prev.fetchurl {
                  url = "https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-darwin-aarch64.zip";
                  hash = "sha256-2LliIYKK1vl6x6wKt+lYcjQa92MAHogD6CZ2UsJlJiA=";
                };
                "aarch64-linux" = prev.fetchurl {
                  url = "https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-aarch64.zip";
                  hash = "sha256-on/7Y6gxA3WDbg1vZorhf6jY0YuIw3yCHGUzGXOhmjs=";
                };
                "x86_64-darwin" = prev.fetchurl {
                  url = "https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-darwin-x64-baseline.zip";
                  hash = "sha256-PjWtb1OXGpg0v55nhuKt9ytfGSHMmpxf3gc9KXKUQHY=";
                };
                "x86_64-linux" = prev.fetchurl {
                  url = "https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-x64.zip";
                  hash = "sha256-lR7iruhV8IWVruxiJSJqKY0/6oOj3NZGXAnLzN9+hI8=";
                };
              };
            };
        });
      })
    ];

    forAllSystems = f:
      nixpkgs.lib.genAttrs systems (
        system:
          f {
            pkgs = import nixpkgs {
              inherit system overlays;
              config.allowUnfree = true; # emulator is unfree
            };
          }
      );
  in {
    devShells = forAllSystems (
      {pkgs}: let
        fen = fenix.packages.${pkgs.system};
        rustToolchain = fen.combine [
          (fen.stable.withComponents [
            "cargo"
            "clippy"
            "rust-src"
            "rustc"
            "rustfmt"
          ])

          fen.targets.aarch64-linux-android.stable.rust-std
          fen.targets.armv7-linux-androideabi.stable.rust-std
          fen.targets.x86_64-linux-android.stable.rust-std
          fen.targets.i686-linux-android.stable.rust-std
          fen.targets.aarch64-apple-ios.stable.rust-std
          fen.targets.aarch64-apple-ios-sim.stable.rust-std
          # build-ios.sh also builds the Intel-simulator slice of the xcframework
          fen.targets.x86_64-apple-ios.stable.rust-std
        ];

        defaultPkgs = with pkgs;
          [
            bash
            git
            pkg-config
            # crossfont (alacritty font rasterization) needs FreeType + fontconfig
            # for the host build of the vendored renderer. (react-native-terminal)
            freetype
            fontconfig
            jq
            nodejs_22
            turbo
            bun
            watchman
            rustToolchain
            cargo-ndk
            jdk17
            gradle_8
            scrcpy
            cmake
            ninja
            just
            alejandra
            clang-tools
            maestro # mobile UI automation, drives the screenshot flow
            secretspec # declarative secrets for signed builds / releases (secretspec.toml)
            # Store automation (Track B, no EAS): match (iOS signing), pilot/deliver
            # (TestFlight/App Store), supply (Play tracks + listings). Lanes live in
            # apps/mobile/fastlane/. See docs/projects/ci-building-and-releasing.md.
            fastlane
          ]
          # gym (fastlane ios build) archives the expo-prebuild workspace, which
          # needs CocoaPods on the PATH (prebuild runs `pod install`).
          ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [pkgs.cocoapods];

        mkShellFn =
          if pkgs.stdenv.isDarwin
          then pkgs.mkShellNoCC
          else pkgs.mkShell;

        ndkId = "27-1-12297006"; # nix flake show github:tadfisher/android-nixpkgs | grep ndk
        ndkAttr = "ndk-${ndkId}";
        ndkVer = builtins.replaceStrings ["-"] ["."] ndkId;

        defaultAndroidPkgs = sdk: let
          ndkPkg = builtins.getAttr ndkAttr sdk;
        in
          with sdk; [
            cmdline-tools-latest
            platform-tools
            platforms-android-36
            platforms-android-35
            build-tools-35-0-0
            build-tools-36-0-0
            cmake-3-22-1
            ndkPkg
          ];

        makeAndroidSdk = mode: let
          androidSdk = pkgs.androidSdk (
            sdk:
              if mode == "full"
              then
                (with sdk;
                  [
                    emulator
                    system-images-android-36-1-google-apis-x86-64 # nix flake show github:tadfisher/android-nixpkgs | grep system-images-android-36
                  ]
                  ++ (defaultAndroidPkgs sdk))
              else if mode == "remote"
              then (defaultAndroidPkgs sdk)
              else throw "makeAndroidSdk: unknown mode '${mode}'. Use \"full\" or \"remote\"."
          );
          sdkRoot = "${androidSdk}/share/android-sdk";
        in {inherit androidSdk sdkRoot;};

        fullAndroidSdk = makeAndroidSdk "full";
        remoteAndroidSdk = makeAndroidSdk "remote";

        commonAndroidInit = sdkRoot: ''
          unset ANDROID_SDK_ROOT
          unset ANDROID_HOME
          export ANDROID_SDK_ROOT="${sdkRoot}"
          export ANDROID_HOME="${sdkRoot}"
          export PATH="$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"
          export ANDROID_NDK_ROOT="$ANDROID_SDK_ROOT/ndk/${ndkVer}"
          export ANDROID_NDK_HOME="$ANDROID_NDK_ROOT"
          export ANDROID_NDK="$ANDROID_NDK_ROOT"
          export GRADLE_OPTS="-Dorg.gradle.project.android.aapt2FromMavenOverride=${sdkRoot}/build-tools/36.0.0/aapt2 -Dorg.gradle.project.android.builder.sdkDownload=false"
        '';
      in {
        default = mkShellFn {
          packages = defaultPkgs ++ [remoteAndroidSdk.androidSdk];
          shellHook =
            commonAndroidInit remoteAndroidSdk.sdkRoot;
        };

        android-emulator = mkShellFn {
          packages = defaultPkgs ++ [fullAndroidSdk.androidSdk];
          shellHook =
            commonAndroidInit fullAndroidSdk.sdkRoot;
        };
      }
    );

    formatter = forAllSystems (
      {pkgs}:
        pkgs.alejandra
    );
  };
}
