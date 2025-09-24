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
        ];

        defaultPkgs = with pkgs; [
          # System
          bash
          git
          pkg-config
          jq
          # JS
          nodejs_22
          turbo
          nodePackages.pnpm
          yarn
          watchman
          # Rust
          rustToolchain
          cargo-ndk
          # Android build helpers
          jdk17
          gradle_8
          scrcpy
          # Misc
          cmake
          ninja
          just
          alejandra
          clang-tools
        ];

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
            build-tools-35-0-0
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
          export ANDROID_SDK_ROOT="${sdkRoot}"
          export ANDROID_HOME="${sdkRoot}"
          export PATH="$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"
          export ANDROID_NDK_ROOT="$ANDROID_SDK_ROOT/ndk/${ndkVer}"
          export ANDROID_NDK_HOME="$ANDROID_NDK_ROOT"
          export ANDROID_NDK="$ANDROID_NDK_ROOT"
        '';
      in {
        default = pkgs.mkShell {
          packages = defaultPkgs ++ [remoteAndroidSdk.androidSdk];
          shellHook =
            commonAndroidInit remoteAndroidSdk.sdkRoot
            + ''
              echo "You are using the defaul nix dev shell. Noice."
            '';
        };

        android-emulator = pkgs.mkShell {
          packages = defaultPkgs ++ [fullAndroidSdk.androidSdk];
          shellHook =
            commonAndroidInit fullAndroidSdk.sdkRoot
            + ''
              echo "You are using the android-emulator nix dev shell. Noice."
            '';
        };
      }
    );

    formatter = forAllSystems (
      {pkgs}:
        pkgs.alejandra
    );
  };
}
