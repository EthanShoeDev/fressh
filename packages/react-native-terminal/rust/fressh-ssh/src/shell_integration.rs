//! Automatic, zero-config shell-integration injection (the OSC 633 emitter side).
//!
//! fressh launches the remote interactive shell with VS Code's shell-integration
//! scripts injected — so the shell emits `OSC 633` (cwd, command lifecycle, exit
//! code, command text) that `fressh-core`'s `OscScanner` lifts into `CoreEvent`s.
//! Nothing on the host is changed permanently and no dotfile is touched.
//!
//! ## How (no server, unlike VS Code)
//!
//! VS Code can pass `--init-file`/`$ZDOTDIR` because its server launches the shell.
//! We have no server — but russh's `Channel::exec` lets us launch a *composed*
//! shell instead of a bare `request_shell`. The exec command is a single
//! **`sh -c '<bootstrap>'`**: wrapping in `sh -c` normalizes the interpreter (sshd
//! runs the exec string through the user's login shell, which may be fish/csh — not
//! POSIX — but every shell can invoke `sh -c '…'`). The POSIX bootstrap then:
//!
//! 1. `mktemp -d` a temp dir,
//! 2. `base64 -d` the embedded scripts into it (the payloads are `[A-Za-z0-9+/=]`,
//!    so the bootstrap stays single-quote-free and nests cleanly),
//! 3. `case "$SHELL"` → `exec` the right interactive shell with the script wired in
//!    (`bash --init-file`, `zsh` via `ZDOTDIR`, `fish --init-command`),
//! 4. fall back to a plain `exec "$SHELL" -l` for anything unknown — **never break
//!    the connection.**
//!
//! The scripts replicate login-shell sourcing themselves (VS Code's `VSCODE_SHELL_LOGIN`
//! path), so PATH/env parity with `request_shell`'s login shell is preserved.
//!
//! See docs/projects/terminal-semantic-events.md and `scripts/NOTICE.md` (MIT).
//
// TODO(cleanup): the temp dir is currently orphaned on disconnect. It's a few KB in
// $TMPDIR (usually tmpfs); add an EXIT-trap / fressh-side `rm -rf` sweep keyed off
// the dir path. Tracked in the project doc's delivery section.

use base64::Engine;
use rand::Rng;

const BASH: &str = include_str!("shell_integration/scripts/bash.sh");
const ZSH_RC: &str = include_str!("shell_integration/scripts/zsh-rc.zsh");
const ZSH_ENV: &str = include_str!("shell_integration/scripts/zsh-env.zsh");
const ZSH_PROFILE: &str = include_str!("shell_integration/scripts/zsh-profile.zsh");
const ZSH_LOGIN: &str = include_str!("shell_integration/scripts/zsh-login.zsh");
const FISH: &str = include_str!("shell_integration/scripts/fish.fish");

fn b64(s: &str) -> String {
	base64::engine::general_purpose::STANDARD.encode(s.as_bytes())
}

/// A fresh per-session nonce (hex). VS Code's scripts embed it in `633;E`/env
/// entries; a future scanner check can use it to reject spoofed sequences.
pub fn generate_nonce() -> String {
	let mut rng = rand::thread_rng();
	(0..16)
		.map(|_| format!("{:x}", rng.gen_range(0..16u8)))
		.collect()
}

/// Build the SSH `exec` command that launches an interactive shell with OSC 633
/// shell integration injected. Pass the result to `Channel::exec`.
///
/// INVARIANT: the inner bootstrap must contain no `'` (single quote) so it nests
/// inside `sh -c '…'`. The base64 payloads and the POSIX body below honor that.
pub fn build_exec_command(nonce: &str) -> String {
	// One `printf … | base64 -d > file` per script. zsh needs the four-file
	// ZDOTDIR dance; bash and fish need one file each.
	let bootstrap = format!(
		concat!(
			// A temp dir to hold the materialized scripts; bail to a plain login
			// shell if we can't make one (read-only /tmp, no mktemp, …).
			"d=$(mktemp -d \"${{TMPDIR:-/tmp}}/.fressh.XXXXXX\" 2>/dev/null) || exec \"${{SHELL:-/bin/sh}}\" -l; ",
			"printf %s {bash} | base64 -d > \"$d/bash\" 2>/dev/null; ",
			"printf %s {zrc} | base64 -d > \"$d/.zshrc\" 2>/dev/null; ",
			"printf %s {zenv} | base64 -d > \"$d/.zshenv\" 2>/dev/null; ",
			"printf %s {zprofile} | base64 -d > \"$d/.zprofile\" 2>/dev/null; ",
			"printf %s {zlogin} | base64 -d > \"$d/.zlogin\" 2>/dev/null; ",
			"printf %s {fish} | base64 -d > \"$d/fish\" 2>/dev/null; ",
			"export VSCODE_INJECTION=1 VSCODE_NONCE={nonce} VSCODE_STABLE=1; ",
			"case \"${{SHELL##*/}}\" in ",
			// bash: --init-file sources our script; VSCODE_SHELL_LOGIN makes it
			// replay the login chain (/etc/profile → bash_profile/…).
			"bash) export VSCODE_SHELL_LOGIN=1; exec bash --init-file \"$d/bash\" -i ;; ",
			// zsh: point ZDOTDIR at our dir (the four files restore USER_ZDOTDIR
			// and source the user's real rc). -i -l = interactive login.
			"zsh) export USER_ZDOTDIR=\"${{ZDOTDIR:-$HOME}}\" ZDOTDIR=\"$d\"; exec zsh -i -l ;; ",
			// fish: --init-command sources our script after fish's own config.
			"fish) exec fish -l -C \"source $d/fish\" ;; ",
			// unknown shell: clean up and launch it plainly. Integration just stays
			// inactive; the connection is unaffected.
			"*) rm -rf \"$d\" 2>/dev/null; exec \"${{SHELL:-/bin/sh}}\" -l ;; ",
			"esac"
		),
		bash = b64(BASH),
		zrc = b64(ZSH_RC),
		zenv = b64(ZSH_ENV),
		zprofile = b64(ZSH_PROFILE),
		zlogin = b64(ZSH_LOGIN),
		fish = b64(FISH),
		nonce = nonce,
	);
	format!("sh -c '{bootstrap}'")
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn bootstrap_has_no_single_quote_inside_wrapper() {
		// The whole point of the sh -c '…' wrapping: the body must be quote-free.
		let cmd = build_exec_command("abc123");
		let inner = cmd
			.strip_prefix("sh -c '")
			.and_then(|s| s.strip_suffix('\''))
			.expect("must be wrapped in sh -c '…'");
		assert!(
			!inner.contains('\''),
			"bootstrap body must contain no single quotes"
		);
	}

	#[test]
	fn bootstrap_dispatches_each_known_shell() {
		let cmd = build_exec_command("n");
		for needle in [
			"bash --init-file",
			"ZDOTDIR=",
			"fish -l -C",
			"exec \"${SHELL:-/bin/sh}\" -l", // fallback
			"VSCODE_INJECTION=1",
			"VSCODE_NONCE=n",
		] {
			assert!(cmd.contains(needle), "missing {needle:?} in exec command");
		}
	}

	#[test]
	fn nonce_is_sixteen_hex_chars() {
		let n = generate_nonce();
		assert_eq!(n.len(), 16);
		assert!(n.chars().all(|c| c.is_ascii_hexdigit()));
	}
}
