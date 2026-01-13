#!/usr/bin/env bun
/**
 * Scans the repository for lint ignore comments and generates a markdown report.
 * Uses git ls-files to respect .gitignore.
 * @see docs/cloned-repos-as-docs/effect/packages/cli/README.md
 * @see docs/cloned-repos-as-docs/effect/packages/platform/src/Command.ts
 */
import { Options } from '@effect/cli';
import * as CliCommand from '@effect/cli/Command';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import * as Command from '@effect/platform/Command';
import { FileSystem } from '@effect/platform';
import { Array as A, Effect, Option } from 'effect';

const COMMAND_NAME = 'scrutinize-lint-ignores';

// Patterns to search for (require comment syntax to avoid matching regex/string literals)
const LINT_IGNORE_PATTERNS = [
  { regex: /\/[/*]\s*eslint-disable/, name: 'eslint-disable' },
  { regex: /\/[/*]\s*oxlint-disable/, name: 'oxlint-disable' },
  { regex: /\/[/*]\s*prettier-ignore/, name: 'prettier-ignore' },
  { regex: /\/[/*]\s*oxfmt-ignore/, name: 'oxfmt-ignore' },
  { regex: /\/[/*]\s*biome-ignore/, name: 'biome-ignore' },
  { regex: /\/\/\s*@ts-ignore/, name: '@ts-ignore' },
  { regex: /\/\/\s*@ts-expect-error/, name: '@ts-expect-error' },
  { regex: /\/\/\s*@ts-nocheck/, name: '@ts-nocheck' },
];

// File extensions to scan
const SOURCE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.vue',
  '.svelte',
];

interface LintIgnoreMatch {
  file: string;
  line: number;
  pattern: string;
  context: string[];
}

const getTrackedFiles = Effect.gen(function* () {
  const command = Command.make('git', 'ls-files');
  const output = yield* Command.string(command);
  return output
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
});

const SCRIPT_NAME = 'scrutinize-lint-ignores';

const isSourceFile = (file: string): boolean =>
  SOURCE_EXTENSIONS.some((ext) => file.endsWith(ext)) &&
  !file.includes(SCRIPT_NAME);

const findLintIgnores = (
  filePath: string,
  lines: string[],
  contextLines: number,
): LintIgnoreMatch[] => {
  const matches: LintIgnoreMatch[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (!line) {
      continue;
    }

    for (const { regex, name } of LINT_IGNORE_PATTERNS) {
      if (regex.test(line)) {
        const matchLineNum = lineIndex + 1;
        const start = Math.max(0, lineIndex - contextLines);
        const end = Math.min(lines.length, lineIndex + contextLines + 1);
        const context = lines.slice(start, end).map((contextLine, idx) => {
          const lineNum = start + idx + 1;
          const marker = lineNum === matchLineNum ? '>' : ' ';
          return `${marker} ${lineNum.toString().padStart(4)}: ${contextLine}`;
        });

        matches.push({
          file: filePath,
          line: matchLineNum,
          pattern: name,
          context,
        });
        // Only match once per line
        break;
      }
    }
  }

  return matches;
};

const scanFile = (filePath: string, contextLines: number) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(filePath);
    return findLintIgnores(filePath, text.split('\n'), contextLines);
  });

const generateMarkdownReport = (
  matches: LintIgnoreMatch[],
  outputPath: Option.Option<string>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const groupedByFile = new Map<string, LintIgnoreMatch[]>();
    for (const match of matches) {
      const existing = groupedByFile.get(match.file) ?? [];
      existing.push(match);
      groupedByFile.set(match.file, existing);
    }

    const groupedByPattern = new Map<string, LintIgnoreMatch[]>();
    for (const match of matches) {
      const existing = groupedByPattern.get(match.pattern) ?? [];
      existing.push(match);
      groupedByPattern.set(match.pattern, existing);
    }

    let md = `# Lint Ignore Report\n\n`;
    md += `Generated: ${new Date().toISOString()}\n\n`;
    md += `## Summary\n\n`;
    md += `- **Total lint ignores found:** ${matches.length}\n`;
    md += `- **Files with lint ignores:** ${groupedByFile.size}\n\n`;

    type FileEntry = [string, LintIgnoreMatch[]];

    const sorted = <T>(arr: T[], fn: (a: T, b: T) => number): T[] =>
      arr.toSorted(fn);

    const patternEntries = [...groupedByPattern.entries()];
    const fileEntries: FileEntry[] = [...groupedByFile.entries()];

    md += `### By Pattern Type\n\n`;
    md += `| Pattern | Count |\n`;
    md += `|---------|-------|\n`;
    for (const [pattern, patternMatches] of sorted(
      patternEntries,
      (a, b) => b[1].length - a[1].length,
    )) {
      md += `| \`${pattern}\` | ${patternMatches.length} |\n`;
    }
    md += `\n`;

    md += `### By File\n\n`;
    md += `| File | Count |\n`;
    md += `|------|-------|\n`;
    for (const [file, fileMatches] of sorted(
      fileEntries,
      (a, b) => b[1].length - a[1].length,
    )) {
      md += `| \`${file}\` | ${fileMatches.length} |\n`;
    }
    md += `\n`;

    md += `## Detailed Findings\n\n`;

    for (const [file, fileMatches] of sorted(fileEntries, (a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      md += `### \`${file}\`\n\n`;

      for (const match of sorted(fileMatches, (a, b) => a.line - b.line)) {
        md += `#### Line ${match.line} (\`${match.pattern}\`)\n\n`;
        md += `\`\`\`typescript\n`;
        md += match.context.join('\n');
        md += `\n\`\`\`\n\n`;
      }
    }

    md += `---\n\n`;
    md += `## Questions to Consider\n\n`;
    md += `If there is anything in common with these lint ignores, consider:\n\n`;
    md += `1. **Can we fix the underlying issues?** Some ignores might be hiding real problems that should be addressed.\n\n`;
    md += `2. **Is the linter being too strict?** If many ignores are for the same rule, perhaps that rule should be configured differently or disabled globally.\n\n`;
    md += `3. **Should we update the linter config?** Consider adding rules to \`.eslintrc\`, \`oxlint.json\`, or \`.prettierrc\` to globally or locally ignore certain patterns.\n\n`;
    md += `4. **Are there patterns we can refactor?** Sometimes lint ignores indicate code that could be written differently to satisfy the linter.\n\n`;
    md += `5. **Do we need inline ignores at all?** Each ignore should have a good reason - consider adding comments explaining why the ignore is necessary.\n`;

    if (Option.isSome(outputPath)) {
      yield* fs.writeFileString(outputPath.value, md);
      console.error(`Report also written to: ${outputPath.value}`);
    }

    return md;
  });

const main = (contextLines: number, outputPath: Option.Option<string>) =>
  Effect.gen(function* () {
    // Progress messages go to stderr so they don't interfere with stdout report
    console.error('Scanning repository for lint ignores...\n');

    const allFiles = yield* getTrackedFiles;
    const sourceFiles = allFiles.filter(isSourceFile);

    console.error(`Found ${sourceFiles.length} source files to scan\n`);

    const results = yield* Effect.all(
      sourceFiles.map((f) =>
        scanFile(f, contextLines).pipe(
          Effect.catchAll((_e) => Effect.succeed([] as LintIgnoreMatch[])),
        ),
      ),
      { concurrency: 10 },
    );

    const allMatches = A.flatten(results);

    if (allMatches.length === 0) {
      console.error('No lint ignores found in the repository.');
      return;
    }

    console.error(`Found ${allMatches.length} lint ignore(s)\n`);

    const report = yield* generateMarkdownReport(allMatches, outputPath);

    // Always output report to stdout
    console.log(report);
  });

const command = CliCommand.make(
  COMMAND_NAME,
  {
    context: Options.integer('context').pipe(
      Options.withAlias('c'),
      Options.withDefault(3),
      Options.withDescription(
        'Number of context lines to show around each match',
      ),
    ),
    output: Options.file('output').pipe(
      Options.withAlias('o'),
      Options.optional,
      Options.withDescription('Output file path for the markdown report'),
    ),
  },
  ({ context, output }) => main(context, output),
);

const run = CliCommand.run(command, {
  name: COMMAND_NAME,
  version: '0.0.1',
});

run(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
