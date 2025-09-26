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
          starship
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

        starshipToml = pkgs.writeText "starship.toml" ''
          # project-scoped Starship config (no files under ~/.config)
          add_newline = false
          format = "$nix_shell$directory$rust$python$cmd_duration$character"

          [nix_shell]
          disabled = false
          format = "[$symbol]($style) "
          symbol = "nix-fressh "
          pure_msg = ""
          impure_msg = "(impure) "
          style = "bold cyan"

          [directory]
          format = "[$path]($style) "
          truncation_length = 0
          truncate_to_repo = false
          home_symbol = "~"

          [character]
          success_symbol = "[➜](bold green) "
          error_symbol   = "[✗](bold red) "

        '';

        starshipBootstrap = pkgs.writeText "fressh-starship-bootstrap.sh" ''
          if [[ -n ''${__FRESSH_STARSHIP_INIT-} ]]; then
            if [[ -n ''${FRESSH_OLD_PROMPT_COMMAND:-} ]]; then
              PROMPT_COMMAND=''${FRESSH_OLD_PROMPT_COMMAND}
            else
              unset PROMPT_COMMAND
            fi
            unset FRESSH_OLD_PROMPT_COMMAND
            return
          fi

          __FRESSH_STARSHIP_INIT=1

          if [[ -n ''${FRESSH_OLD_PROMPT_COMMAND:-} ]]; then
            PROMPT_COMMAND=''${FRESSH_OLD_PROMPT_COMMAND}
          else
            unset PROMPT_COMMAND
          fi

          if [[ ''${TERM_PROGRAM:-} == "vscode" ]] && command -v code >/dev/null; then
            if ! declare -F __vsc_prompt_cmd_original >/dev/null; then
              . "$(code --locate-shell-integration-path bash)"
            fi
          fi

          unset FRESSH_OLD_PROMPT_COMMAND

          if command -v starship >/dev/null; then
            eval "$(starship init bash)"

            if [[ -t 1 ]]; then
              local __fressh_first_prompt
              __fressh_first_prompt="$(STARSHIP_SHELL=bash starship prompt 2>/dev/null)"
              if [[ -n "''${__fressh_first_prompt}" ]]; then
                PS1="''${__fressh_first_prompt}"
              fi
              unset __fressh_first_prompt
            fi
          fi
        '';

        commonAndroidInit = sdkRoot: ''
          export ANDROID_SDK_ROOT="${sdkRoot}"
          export ANDROID_HOME="${sdkRoot}"
          export PATH="$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"
          export ANDROID_NDK_ROOT="$ANDROID_SDK_ROOT/ndk/${ndkVer}"
          export ANDROID_NDK_HOME="$ANDROID_NDK_ROOT"
          export ANDROID_NDK="$ANDROID_NDK_ROOT"
          export GRADLE_OPTS="-Dorg.gradle.project.android.aapt2FromMavenOverride=${sdkRoot}/build-tools/36.0.0/aapt2 -Dorg.gradle.project.android.builder.sdkDownload=false"
          export STARSHIP_CONFIG=${starshipToml}
          export STARSHIP_CACHE="$PWD/.starship-cache"
          mkdir -p "$STARSHIP_CACHE"

          export FRESSH_DEVENV=1
          export FRESSH_STARSHIP_PREINIT=${starshipBootstrap}
          export FRESSH_OLD_PROMPT_COMMAND=''${PROMPT_COMMAND:-}
          export PROMPT_COMMAND=". \"$FRESSH_STARSHIP_PREINIT\""
        '';
      in {
        default = pkgs.mkShell {
          packages = defaultPkgs ++ [remoteAndroidSdk.androidSdk];
          shellHook =
            commonAndroidInit remoteAndroidSdk.sdkRoot;
        };

        android-emulator = pkgs.mkShell {
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
