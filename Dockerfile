FROM nixos/nix:latest

# Enable flakes and nix-command
RUN mkdir -p /etc/nix && \
    echo 'experimental-features = nix-command flakes' > /etc/nix/nix.conf && \
    echo 'accept-flake-config = true' >> /etc/nix/nix.conf

WORKDIR /workspace

COPY flake.nix flake.lock .
RUN nix develop .#android-remote

# Pre-populate pnpm store from lockfile only (fast, cacheable)
COPY pnpm-lock.yaml ./
COPY patches/* ./patches/
RUN nix develop .#android-remote -c pnpm fetch

# Now copy full source and link from the store (no network)
COPY . .
RUN nix develop .#android-remote -c pnpm install --offline --frozen-lockfile