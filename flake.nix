{
  description = "Expo RN devshells (local emulator / remote AVD)";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
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
    android-nixpkgs,
    fenix,
    ...
  }: let
    systems = ["x86_64-linux" "aarch64-darwin" "x86_64-darwin"];

    overlays = [
      android-nixpkgs.overlays.default
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
        ];

        defaultPkgs = with pkgs; [
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
        ];

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
