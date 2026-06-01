#!/usr/bin/env bash

mkdir -p docs/cloned-repos-as-docs ; cd docs/cloned-repos-as-docs

# We clone some of our deps so that coding agents can quickly
# grep for relevant docs, src code, and examples.

# Linting
gh repo clone oxc-project/oxc
gh repo clone oxc-project/oxc-project.github.io

# Build Tools
gh repo clone rolldown/tsdown
gh repo clone rolldown/rolldown
gh repo clone nitrojs/nitro
gh repo clone vitejs/vite
gh repo clone vercel/turborepo
gh repo clone oven-sh/bun

# Frameworks
gh repo clone TanStack/router # (this include code for tanstack start and router)
gh repo clone TanStack/tanstack.com
gh repo clone expo/expo

# Styling
gh repo clone tailwindlabs/tailwindcss
gh repo clone tailwindlabs/tailwindcss.com
gh repo clone nativewind/nativewind
gh repo clone uni-stack/uniwind
gh repo clone better-auth-ui/better-auth-ui # web only
gh repo clone founded-labs/react-native-reusables # has full uniwind support

# Dependencies
gh repo clone TanStack/query
gh repo clone TanStack/db
gh repo clone TanStack/form

# Effect-TS
gh repo clone Effect-TS/effect
gh repo clone Effect-TS/website
gh repo clone kitlangton/effect-solutions
gh repo clone voidhashcom/effect-query
gh repo clone mcrovero/effect-nextjs # This provides good examples on how to use ManagedRuntimes.
gh repo clone PaulJPhilp/EffectPatterns


# Dev env stuff
gh repo clone cachix/devenv

# Testing TODO
# https://github.com/oven-sh/bun/issues/16945
# https://stackoverflow.com/questions/79434739/how-to-setup-vitest-with-react-native-expo-getting-rolluperror-parse-failur
# https://www.reddit.com/r/expo/comments/1inda66/has_any_one_used_vitest_with_expo
gh repo clone wix/Detox # E2E testing in ts
gh repo clone callstack/react-native-testing-library
gh repo clone tstyche/tstyche


# Drizzle testing
gh repo clone rphlmr/drizzle-vitest-pg # Example setup with Vitest and PgLite and drizzle
gh repo clone electric-sql/pglite
# docs/cloned-repos-as-docs/drizzle-orm-docs/src/content/docs/connect-pglite.mdx