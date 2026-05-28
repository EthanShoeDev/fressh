import { quoteShell } from '@/lib/host-browser-actions';

const githubRepositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function parseGitHubRepositoryRemoteUrl(
	remoteUrl: string,
): string | null {
	const trimmed = remoteUrl.trim();
	const patterns = [
		/^git@github\.com:([^/\s]+\/[^/\s]+?)(?:\.git)?$/,
		/^ssh:\/\/git@github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?$/,
		/^https:\/\/github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/,
	];
	for (const pattern of patterns) {
		const repository = trimmed.match(pattern)?.[1];
		if (repository && githubRepositoryPattern.test(repository)) {
			return repository;
		}
	}
	return null;
}

export function parseGitHubRepositoryResolutionOutput(
	output: string,
): string | null {
	for (const line of output.split(/[\r\n]+/).reverse()) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (githubRepositoryPattern.test(trimmed)) return trimmed;
		const remoteRepository = parseGitHubRepositoryRemoteUrl(trimmed);
		if (remoteRepository) return remoteRepository;
	}
	return null;
}

export function buildResolveGitHubRepositoryCommand(panePath: string): string {
	return [
		`cd ${quoteShell(panePath)} || exit 1`,
		"repo=''",
		'if command -v gh >/dev/null 2>&1; then',
		'  repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)',
		'fi',
		'if [ -z "$repo" ]; then',
		'  repo=$(git remote get-url origin 2>/dev/null || true)',
		'fi',
		'printf \'%s\\n\' "$repo"',
	].join('\n');
}

export function buildCreateGitHubIssueCommand({
	description,
	repository,
}: {
	description: string;
	repository: string;
}): string {
	const escapedDescription = quoteShell(description);
	const escapedRepository = quoteShell(repository);
	const escapedPrompt = quoteShell(
		'Generate a concise GitHub issue title (max 72 chars) for this feature request. Return only the title line, no quotes.',
	);

	return `
description=${escapedDescription}
repository=${escapedRepository}
prompt=${escapedPrompt}
prompt=$(printf '%s\\n\\n%s\\n' "$prompt" "$description")

if ! command -v gh >/dev/null 2>&1; then
  echo 'gh CLI not found. Install and authenticate GitHub CLI (gh auth login).' >&2
  false
elif ! command -v claude >/dev/null 2>&1; then
  echo 'claude CLI not found. Install Claude Code CLI (claude).' >&2
  false
else
  claude_help=$(claude --help 2>/dev/null)
  raw_title=''
  if printf '%s' "$claude_help" | grep -q -- '--print'; then
    raw_title=$(claude --print "$prompt")
  elif printf '%s' "$claude_help" | grep -q -- ' -p'; then
    raw_title=$(claude -p "$prompt")
  else
    echo 'claude CLI does not support --print or -p prompt flags.' >&2
    false
  fi
  claude_status=$?
  if [ $claude_status -ne 0 ]; then
    echo 'Claude failed to generate a title.' >&2
    false
  else
    title=$(printf '%s' "$raw_title" | tr -d '\\r' | head -n 1 | sed 's/^['"'"'"[:space:]]*//;s/['"'"'"[:space:]]*$//' | tr -s '[:space:]' ' ')
    title=$(printf '%s' "$title" | cut -c1-72)
    if [ -z "$title" ]; then
      echo 'Claude returned an empty title.' >&2
      false
    else
      gh issue create --repo "$repository" --title "Feature Request: $title" --body "$description"
    fi
  fi
fi
`.trim();
}
