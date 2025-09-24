# syntax=docker/dockerfile:1.4
FROM nixos/nix:latest

RUN mkdir -p /etc/nix && \
    echo 'experimental-features = nix-command flakes' > /etc/nix/nix.conf && \
    echo 'accept-flake-config = true' >> /etc/nix/nix.conf

WORKDIR /workspace

ENV PNPM_STORE_PATH=/pnpm/store

COPY flake.nix flake.lock ./
RUN nix develop -c true

COPY pnpm-lock.yaml ./
COPY patches/* ./patches/
RUN --mount=type=cache,target=/pnpm/store,id=fressh-pnpm,sharing=locked \
    nix develop -c pnpm fetch

COPY package.json pnpm-workspace.yaml ./
COPY apps/mobile/package.json ./apps/mobile/
COPY apps/web/package.json ./apps/web/
COPY packages/react-native-uniffi-russh/package.json ./packages/react-native-uniffi-russh/
COPY packages/react-native-xtermjs-webview/package.json ./packages/react-native-xtermjs-webview/
COPY packages/assets/package.json ./packages/assets/
# RUN --mount=type=cache,target=/pnpm/store,id=fressh-pnpm,sharing=locked \
#     nix develop -c pnpm install --frozen-lockfile --offline

COPY . .
RUN --mount=type=cache,target=/pnpm/store,id=fressh-pnpm,sharing=locked \
    nix develop -c pnpm install --frozen-lockfile

CMD ["nix", "develop"]
