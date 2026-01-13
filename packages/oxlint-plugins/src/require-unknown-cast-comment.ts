// Requires a comment explaining why `as unknown as` casts are used
// These casts bypass TypeScript's type system entirely and should be justified

import { type Rule } from 'eslint';

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require a comment explaining why double type assertions are used',
    },
    messages: {
      missingComment:
        'Add a comment explaining why this double type assertion is necessary.',
    },
  },
  create(context) {
    // Pattern to match `as unknown as` with optional whitespace
    const castPattern = /as\s+unknown\s+as\b/g;

    return {
      Program() {
        const { sourceCode } = context;
        const text = sourceCode.getText();
        const lines = text.split('\n');
        const comments = sourceCode.getAllComments();

        // Build a set of comment lines for quick lookup
        const commentLineEndings = new Set<number>();
        for (const comment of comments) {
          if (comment.loc) {
            commentLineEndings.add(comment.loc.end.line);
          }
        }

        // Check if a line has an explanatory comment (same line or line before)
        const hasExplanatoryComment = (lineNum: number): boolean => {
          // Check comments on same line or line before
          for (const comment of comments) {
            const commentEndLine = comment.loc?.end.line ?? 0;
            if (commentEndLine !== lineNum && commentEndLine !== lineNum - 1) {
              continue;
            }

            const text = comment.value.trim();
            // Ensure it's not just a disable directive
            if (
              text.length > 0 &&
              !text.startsWith('eslint-disable') &&
              !text.startsWith('oxlint-disable') &&
              !text.startsWith('@ts-')
            ) {
              return true;
            }
          }
          return false;
        };

        // Scan each line for `as unknown as` pattern
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineNum = i + 1; // 1-indexed

          // Skip comment lines
          if (
            line.trimStart().startsWith('//') ||
            line.trimStart().startsWith('*')
          ) {
            continue;
          }

          castPattern.lastIndex = 0;
          const match = castPattern.exec(line);

          if (match && !hasExplanatoryComment(lineNum)) {
            // Find the column where the match starts
            const col = match.index;

            context.report({
              messageId: 'missingComment',
              loc: {
                start: { line: lineNum, column: col },
                end: { line: lineNum, column: col + match[0].length },
              },
            });
          }
        }
      },
    };
  },
};

const plugin = {
  meta: {
    name: 'unknown-cast',
  },
  rules: {
    'require-comment': rule,
  },
};

export default plugin;
