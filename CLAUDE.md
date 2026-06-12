Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## Patched dependencies

Every `bun patch` entry in `patchedDependencies` is documented in
`docs/bun-patches.md` — why it exists and its upstream issue. Whenever you add,
update, or remove a patch, update that doc in the same change.

## TypeScript Return Types

Prefer inferred return types over explicit ones. Explicit return types add verbosity, are harder to maintain, and become brittle when implementation changes.

```typescript
// Good - let TypeScript infer the return type
function getUser(id: string) {
	return db.users.find((u) => u.id === id);
}

// Bad - explicit return type that must be manually kept in sync
function getUser(id: string): User | undefined {
	return db.users.find((u) => u.id === id);
}
```

## CLI Commands in TypeScript

When writing TypeScript code that executes CLI/bash commands, use the helpers in `packages/shared/src/cli-utils.ts`. At minimum, always log what command is being run.

```typescript
import { CommandUtils } from '@wisely/shared/cli-utils';
import { Command } from '@effect/platform';

// Always log the command being run
CommandUtils.withLog(Command.make('git', 'status'), CommandUtils.runString);

// Use runString when you need the full buffered output
const output =
	yield * CommandUtils.runString(Command.make('git', 'log', '--oneline'));

// Use bufferStringStream to both buffer output AND stream to stdout
const proc = yield * Command.start(Command.make('git', 'log'));
const output =
	yield *
	CommandUtils.bufferStringStream(proc.stdout, (chunk) =>
		Effect.sync(() => process.stdout.write(chunk)),
	);

// Use runCommandInherit to stream to terminal (but you can't capture the output)
yield * CommandUtils.runCommandInheritWithLog(Command.make('npm', 'install'));
```
