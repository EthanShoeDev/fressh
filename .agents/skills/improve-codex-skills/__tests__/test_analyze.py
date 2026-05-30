from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts/analyze.py"
SPEC = importlib.util.spec_from_file_location("improve_codex_skills", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class AnalyzeTests(unittest.TestCase):
    def test_default_artifact_root_uses_improve_codex_skills(self) -> None:
        self.assertTrue((MODULE.REPO_ROOT / ".agents/skills").is_dir())
        self.assertEqual(
            MODULE.ARTIFACT_ROOT,
            MODULE.REPO_ROOT / "docs/tool-output/improve-codex-skills",
        )

    def test_focused_rerun_command_uses_analyze_script_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            skill_path = root / "target-skill"
            skill_path.mkdir()
            (skill_path / "SKILL.md").write_text(
                "---\nname: target-skill\n---\n# Target Skill\n",
                encoding="utf-8",
            )
            trace_path = self.write_session_log(
                root,
                "trace.jsonl",
                session_id="trace",
                timestamp="2026-05-18T00:00:00.000Z",
                cwd="/repo/current",
                entries=[self.exec_command_entry("sed -n '1,80p' target-skill/SKILL.md")],
            )
            out_dir = root / "artifacts"
            original_argv = sys.argv
            sys.argv = [
                "analyze.py",
                "--skill",
                str(skill_path),
                "--trace",
                str(trace_path),
                "--out-dir",
                str(out_dir),
                "--judge",
                "off",
            ]
            try:
                exit_code = MODULE.main()
            finally:
                sys.argv = original_argv

            self.assertEqual(exit_code, 0)
            rerun = (out_dir / "rerun.md").read_text(encoding="utf-8")
            self.assertIn("python3", rerun)
            self.assertIn("scripts/analyze.py", rerun)
            self.assertIn("--trace", rerun)
            self.assertIn(str(trace_path.resolve()), rerun)
            self.assertNotIn("codex" + "-skill-improver", rerun)
            self.assertNotIn("propose" + "_patch", rerun)

    def write_session_log(
        self,
        root: Path,
        relative_path: str,
        *,
        session_id: str,
        timestamp: str,
        cwd: str,
        originator: str = "codex_exec",
        entries: list[dict[str, object]] | None = None,
    ) -> Path:
        path = root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        body_entries = entries or [
            {
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [{"text": "Review this"}],
                },
            }
        ]
        path.write_text(
            "\n".join(
                [
                    json.dumps(
                        {
                            "type": "session_meta",
                            "payload": {
                                "id": session_id,
                                "timestamp": timestamp,
                                "cwd": cwd,
                                "originator": originator,
                            },
                        }
                    ),
                    *(json.dumps(entry) for entry in body_entries),
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        return path

    def exec_command_entry(self, command: str) -> dict[str, object]:
        return {
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "exec_command",
                "arguments": json.dumps({"cmd": command}),
            },
        }

    def parallel_exec_entry(self, *commands: str) -> dict[str, object]:
        return {
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "multi_tool_use.parallel",
                "arguments": json.dumps(
                    {
                        "tool_uses": [
                            {
                                "recipient_name": "functions.exec_command",
                                "parameters": {"cmd": command},
                            }
                            for command in commands
                        ]
                    }
                ),
            },
        }

    def namespaced_exec_command_entry(self, command: str) -> dict[str, object]:
        return {
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "functions.exec_command",
                "arguments": json.dumps({"cmd": command}),
            },
        }

    def custom_exec_command_entry(self, command: str) -> dict[str, object]:
        return {
            "type": "response_item",
            "payload": {
                "type": "custom_tool_call",
                "name": "exec_command",
                "arguments": json.dumps({"cmd": command}),
            },
        }

    def skill_message_entry(self, *, skill_name: str, skill_path: str) -> dict[str, object]:
        return {
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "user",
                "content": [
                    {
                        "text": (
                            "<skill>\n"
                            f"<name>{skill_name}</name>\n"
                            f"<path>{skill_path}</path>\n"
                            "---\n"
                            f"name: {skill_name}\n"
                        )
                    }
                ],
            },
        }

    def test_resolve_target_skill_allows_explicit_external_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_path = Path(tmpdir) / "external-skill"
            skill_path.mkdir()
            (skill_path / "SKILL.md").write_text("# External Skill\n", encoding="utf-8")
            resolved = MODULE.resolve_target_skill(str(skill_path))
        self.assertEqual(resolved, skill_path.resolve())

    def test_resolve_target_skill_rejects_external_path_without_skill_md(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            skill_path = Path(tmpdir) / "not-a-skill"
            skill_path.mkdir()
            with self.assertRaises(SystemExit):
                MODULE.resolve_target_skill(str(skill_path))

    def test_resolve_target_skill_selector_preserves_bare_skill_name_first(self) -> None:
        skill_path = (MODULE.REPO_ROOT / ".agents/skills/rloop-code-fix").resolve()
        selector = MODULE.resolve_target_skill_selector("rloop-code-fix", skill_path)
        self.assertEqual(selector[0], "rloop-code-fix")
        self.assertIn(".agents/skills/rloop-code-fix", selector)

    def test_resolve_log_cwd_hint_supports_env_shorthand(self) -> None:
        resolved = MODULE.resolve_log_cwd_hint("env5")
        self.assertEqual(resolved, (Path.home() / "cube9-env5" / "app").resolve())

    def test_parse_mdev_window_registry_skips_comments_and_warns_for_bad_lines(self) -> None:
        parsed = MODULE.parse_mdev_window_registry(
            "\n"
            "# managed windows\n"
            "7 | F7 | ~/cube9-env7/app\n"
            "bad line\n"
            "x | broken | /tmp/broken\n"
            "8 | | /tmp/missing-name\n"
            "9 | missing-path | \n"
        )

        self.assertEqual(
            parsed["windows"],
            [{"index": "7", "name": "F7", "path": "~/cube9-env7/app"}],
        )
        self.assertEqual(
            parsed["warnings"],
            [
                "Line 4: expected 'index | name | path'",
                "Line 5: index must be a non-negative integer",
                "Line 6: name is required",
                "Line 7: path is required",
            ],
        )

    def test_resolve_mdev_registry_cwd_resolves_by_name_and_expands_home(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            registry_path = Path(tmpdir) / "tmux-windows"
            registry_path.write_text("12 | F7 | ~/cube9-env7/app\n", encoding="utf-8")

            resolved = MODULE.resolve_mdev_registry_cwd(
                mdev_window="F7",
                mdev_index=None,
                registry_path=registry_path,
            )

        self.assertEqual(resolved, (Path.home() / "cube9-env7" / "app").resolve())

    def test_resolve_mdev_registry_cwd_duplicate_names_fail_with_index_guidance(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            registry_path = Path(tmpdir) / "tmux-windows"
            registry_path.write_text(
                "12 | F7 | /tmp/first\n13 | F7 | /tmp/second\n",
                encoding="utf-8",
            )

            with self.assertRaises(SystemExit) as exc:
                MODULE.resolve_mdev_registry_cwd(
                    mdev_window="F7",
                    mdev_index=None,
                    registry_path=registry_path,
                )

        message = str(exc.exception)
        self.assertIn("Multiple mdev tmux windows matched name F7", message)
        self.assertIn(str(registry_path), message)
        self.assertIn("use --mdev-index", message)

    def test_resolve_mdev_registry_cwd_resolves_by_index(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            registry_path = Path(tmpdir) / "tmux-windows"
            registry_path.write_text(
                "7 | F7 | /tmp/wrong\n12 | F12 | ~/cube9-env12/app\n",
                encoding="utf-8",
            )

            resolved = MODULE.resolve_mdev_registry_cwd(
                mdev_window=None,
                mdev_index="12",
                registry_path=registry_path,
            )

        self.assertEqual(resolved, (Path.home() / "cube9-env12" / "app").resolve())

    def test_resolve_tmux_target_cwd_reads_live_pane_path(self) -> None:
        calls: list[list[str]] = []

        def fake_run_command(cmd: list[str], *, cwd: Path | None = None) -> str:
            calls.append(cmd)
            return "/tmp/live-pane\n"

        original = MODULE.run_command
        MODULE.run_command = fake_run_command
        try:
            resolved = MODULE.resolve_tmux_target_cwd("main:F7.0")
        finally:
            MODULE.run_command = original

        self.assertEqual(resolved, Path("/tmp/live-pane").resolve())
        self.assertEqual(
            calls,
            [["tmux", "display-message", "-p", "-t", "main:F7.0", "#{pane_current_path}"]],
        )

    def test_resolve_mdev_registry_cwd_missing_selector_mentions_registry_and_selector(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            registry_path = Path(tmpdir) / "tmux-windows"
            registry_path.write_text("7 | F7 | /tmp/project\n", encoding="utf-8")

            with self.assertRaises(SystemExit) as exc:
                MODULE.resolve_mdev_registry_cwd(
                    mdev_window=None,
                    mdev_index="12",
                    registry_path=registry_path,
                )

        message = str(exc.exception)
        self.assertIn("index 12", message)
        self.assertIn(str(registry_path), message)

    def test_build_session_selection_policy_keeps_explicit_claude_variant_strict(self) -> None:
        policy = MODULE.build_session_selection_policy(".claude/skills/rloop-code-fix-tui")
        self.assertFalse(policy.allow_variant_agnostic_markers)
        self.assertEqual(policy.declaration_markers, ())
        self.assertEqual(policy.artifact_markers, ())

    def test_build_session_selection_policy_keeps_dot_slash_claude_variant_strict(self) -> None:
        policy = MODULE.build_session_selection_policy("./.claude/skills/rloop-code-fix-tui")
        self.assertFalse(policy.allow_variant_agnostic_markers)
        self.assertEqual(policy.declaration_markers, ())
        self.assertEqual(policy.artifact_markers, ())

    def test_build_session_selection_policy_keeps_bare_skill_names_scoped_to_agents(self) -> None:
        policy = MODULE.build_session_selection_policy("rloop-code-fix")
        self.assertFalse(policy.allow_variant_agnostic_markers)
        self.assertEqual(policy.declaration_markers, ())
        self.assertEqual(policy.artifact_markers, ())

    def test_build_session_selection_policy_allows_balanced_markers_for_explicit_agents_selector(self) -> None:
        policy = MODULE.build_session_selection_policy(".agents/skills/rloop-code-fix")
        self.assertTrue(policy.allow_variant_agnostic_markers)
        self.assertIn("Using the `rloop-code-fix` skill", policy.declaration_markers)
        self.assertIn("docs/tool-output/rloop-code-fix/", policy.artifact_markers)

    def test_build_session_selection_policy_disables_balanced_markers_for_external_absolute_selector(
        self,
    ) -> None:
        policy = MODULE.build_session_selection_policy("/tmp/external-skill")
        self.assertFalse(policy.allow_variant_agnostic_markers)
        self.assertEqual(policy.declaration_markers, ())
        self.assertEqual(policy.artifact_markers, ())

    def test_build_session_selection_policy_disables_balanced_markers_for_external_relative_selector(
        self,
    ) -> None:
        policy = MODULE.build_session_selection_policy(("../shared-skill", "/tmp/shared-skill"))
        self.assertFalse(policy.allow_variant_agnostic_markers)
        self.assertEqual(policy.declaration_markers, ())
        self.assertEqual(policy.artifact_markers, ())

    def test_discover_latest_session_log_prefers_latest_matching_cwd(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.write_session_log(
                root,
                "2026/03/16/old.jsonl",
                session_id="older",
                timestamp="2026-03-16T06:00:00.000Z",
                cwd="/repo/current",
            )
            newest = self.write_session_log(
                root,
                "2026/03/16/new.jsonl",
                session_id="newer",
                timestamp="2026-03-16T07:00:00.000Z",
                cwd="/repo/current",
            )
            self.write_session_log(
                root,
                "2026/03/16/other.jsonl",
                session_id="other",
                timestamp="2026-03-16T08:00:00.000Z",
                cwd="/repo/other",
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                sessions_root=root,
            )
        self.assertEqual(selected, newest.resolve())
        self.assertEqual(metadata["source_kind"], "latest_log")
        self.assertEqual(metadata["matched_cwd"], str(Path("/repo/current").resolve()))
        self.assertEqual(metadata["resolved_session_id"], "newer")

    def test_discover_latest_session_log_breaks_timestamp_ties_by_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.write_session_log(
                root,
                "2026/03/16/a.jsonl",
                session_id="first",
                timestamp="2026-03-16T07:00:00.000Z",
                cwd="/repo/current",
            )
            winner = self.write_session_log(
                root,
                "2026/03/16/b.jsonl",
                session_id="second",
                timestamp="2026-03-16T07:00:00.000Z",
                cwd="/repo/current",
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                sessions_root=root,
            )
        self.assertEqual(selected, winner.resolve())
        self.assertEqual(metadata["resolved_session_id"], "second")

    def test_discover_latest_session_log_prefers_target_skill_evidence_over_newer_exec_log(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            older_loop = self.write_session_log(
                root,
                "2026/03/14/loop.jsonl",
                session_id="loop",
                timestamp="2026-03-14T03:47:08.323Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    self.exec_command_entry(
                        "node .agents/skills/rloop-code-fix/scripts/run-artifacts.mjs init --review-id 12345678"
                    ),
                    self.exec_command_entry("codex review --uncommitted"),
                    self.exec_command_entry(
                        "node .agents/skills/rloop-code-fix/scripts/run-artifacts.mjs record --run-dir docs/tool-output/rloop-code-fix/12345678"
                    ),
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/review.jsonl",
                session_id="review-only",
                timestamp="2026-03-16T09:41:39.561Z",
                cwd="/repo/current",
                originator="codex_exec",
                entries=[
                    self.exec_command_entry(
                        "sed -n '1,240p' .agents/skills/rloop-code-fix/scripts/run-external-review-round.mjs"
                    )
                ],
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                target_skill_name="rloop-code-fix",
                sessions_root=root,
            )
        self.assertEqual(selected, older_loop.resolve())
        self.assertEqual(metadata["resolved_session_id"], "loop")
        self.assertEqual(metadata["resolved_session_originator"], "codex_cli_rs")
        self.assertEqual(
            metadata["selection_evidence"],
            {
                "execution_hits": 2,
                "artifact_hits": 0,
                "invocation_hits": 0,
                "consult_hits": 0,
                "declaration_hits": 0,
            },
        )

    def test_discover_latest_session_log_prefers_cli_originator_when_skill_evidence_ties(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            cli_log = self.write_session_log(
                root,
                "2026/03/16/cli.jsonl",
                session_id="cli",
                timestamp="2026-03-16T08:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    self.exec_command_entry(
                        "sed -n '1,200p' .agents/skills/rloop-code-fix/SKILL.md"
                    )
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/exec.jsonl",
                session_id="exec",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/repo/current",
                originator="codex_exec",
                entries=[
                    self.exec_command_entry(
                        "sed -n '1,200p' .agents/skills/rloop-code-fix/SKILL.md"
                    )
                ],
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                target_skill_name="rloop-code-fix",
                sessions_root=root,
            )
        self.assertEqual(selected, cli_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "cli")

    def test_discover_latest_session_log_honors_explicit_claude_skill_variant(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            claude_log = self.write_session_log(
                root,
                "2026/03/15/claude.jsonl",
                session_id="claude",
                timestamp="2026-03-15T08:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    self.exec_command_entry(
                        "sed -n '1,200p' .claude/skills/rloop-code-fix-tui/SKILL.md"
                    )
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/agents.jsonl",
                session_id="agents",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    self.exec_command_entry(
                        "sed -n '1,200p' .agents/skills/rloop-code-fix-tui/SKILL.md"
                    )
                ],
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                target_skill_name=".claude/skills/rloop-code-fix-tui",
                sessions_root=root,
            )
        self.assertEqual(selected, claude_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "claude")

    def test_discover_latest_session_log_does_not_let_artifact_mentions_override_explicit_variant(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            claude_log = self.write_session_log(
                root,
                "2026/03/15/claude.jsonl",
                session_id="claude",
                timestamp="2026-03-15T08:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    self.exec_command_entry(
                        "sed -n '1,200p' .claude/skills/rloop-code-fix-tui/SKILL.md"
                    )
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/agents-noisy.jsonl",
                session_id="agents-noisy",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "message",
                            "role": "assistant",
                            "content": [
                                {
                                    "text": "Using the rloop-code-fix-tui skill and docs/tool-output/rloop-code-fix-tui/example.",
                                }
                            ],
                        },
                    }
                ],
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                target_skill_name=".claude/skills/rloop-code-fix-tui",
                sessions_root=root,
            )
        self.assertEqual(selected, claude_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "claude")

    def test_discover_latest_session_log_honors_dot_prefixed_agents_skill_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            agents_log = self.write_session_log(
                root,
                "2026/03/15/agents.jsonl",
                session_id="agents",
                timestamp="2026-03-15T08:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    self.exec_command_entry(
                        "node .agents/skills/rloop-code-fix/scripts/run-artifacts.mjs init --review-id 12345678"
                    )
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/unrelated.jsonl",
                session_id="unrelated",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                target_skill_name=".agents/skills/rloop-code-fix",
                sessions_root=root,
            )
        self.assertEqual(selected, agents_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "agents")

    def test_discover_latest_session_log_allows_explicit_agents_selector_to_use_declarations(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            agents_log = self.write_session_log(
                root,
                "2026/03/15/agents-declared.jsonl",
                session_id="agents-declared",
                timestamp="2026-03-15T08:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "message",
                            "role": "assistant",
                            "content": [
                                {
                                    "text": "Using the rloop-code-fix skill to review the current diff.",
                                }
                            ],
                        },
                    },
                    self.exec_command_entry("pwd"),
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/unrelated.jsonl",
                session_id="unrelated",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                target_skill_name=".agents/skills/rloop-code-fix",
                sessions_root=root,
            )
        self.assertEqual(selected, agents_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "agents-declared")

    def test_discover_latest_session_log_ignores_announcement_only_sessions(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            consulted_log = self.write_session_log(
                root,
                "2026/03/15/consulted.jsonl",
                session_id="consulted",
                timestamp="2026-03-15T08:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    self.exec_command_entry(
                        "sed -n '1,200p' .agents/skills/rloop-code-fix/SKILL.md"
                    )
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/announcement-only.jsonl",
                session_id="announcement-only",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "message",
                            "role": "assistant",
                            "content": [
                                {
                                    "text": "Using the rloop-code-fix skill to review the current diff.",
                                }
                            ],
                        },
                    }
                ],
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                target_skill_name="rloop-code-fix",
                sessions_root=root,
            )
        self.assertEqual(selected, consulted_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "consulted")

    def test_discover_latest_session_log_counts_parallel_exec_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            parallel_log = self.write_session_log(
                root,
                "2026/03/15/parallel.jsonl",
                session_id="parallel",
                timestamp="2026-03-15T08:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    self.parallel_exec_entry(
                        "sed -n '1,200p' .agents/skills/rloop-code-fix/SKILL.md",
                        "node .agents/skills/rloop-code-fix/scripts/run-artifacts.mjs init --review-id 12345678",
                    )
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/unrelated.jsonl",
                session_id="unrelated",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                target_skill_name="rloop-code-fix",
                sessions_root=root,
            )
        self.assertEqual(selected, parallel_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "parallel")

    def test_discover_latest_session_log_ignores_catalog_and_counts_event_msg_invocation(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            event_log = self.write_session_log(
                root,
                "2026/03/15/event-msg.jsonl",
                session_id="event-msg",
                timestamp="2026-03-15T08:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    {
                        "type": "event_msg",
                        "payload": {
                            "type": "user_message",
                            "message": (
                                "<skill>\n"
                                "<name>oracle-ask</name>\n"
                                "<path>/repo/current/.agents/skills/oracle-ask/SKILL.md</path>\n"
                            ),
                        },
                    },
                    self.exec_command_entry("pwd"),
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/catalog.jsonl",
                session_id="catalog",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "message",
                            "role": "assistant",
                            "content": [
                                {
                                    "text": (
                                        "Available skills:\n"
                                        "<skill>\n"
                                        "<name>oracle-ask</name>\n"
                                        "<path>/repo/current/.agents/skills/oracle-ask/SKILL.md</path>\n"
                                    ),
                                }
                            ],
                        },
                    },
                    self.exec_command_entry("pwd"),
                ],
            )
            selector = MODULE.resolve_target_skill_selector(
                "oracle-ask",
                (MODULE.REPO_ROOT / ".agents/skills/oracle-ask").resolve(),
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                target_skill_name=selector,
                sessions_root=root,
            )
        self.assertEqual(selected, event_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "event-msg")
        self.assertEqual(metadata["selection_evidence"]["invocation_hits"], 1)

    def test_discover_latest_session_log_counts_event_msg_agent_invocation(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            event_log = self.write_session_log(
                root,
                "2026/03/15/agent-event-msg.jsonl",
                session_id="agent-event-msg",
                timestamp="2026-03-15T08:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    {
                        "type": "event_msg",
                        "payload": {
                            "type": "agent_message",
                            "text": (
                                "<skill>\n"
                                "<name>oracle-ask</name>\n"
                                "<path>/repo/current/.agents/skills/oracle-ask/SKILL.md</path>\n"
                            ),
                        },
                    },
                    self.exec_command_entry("pwd"),
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/unrelated.jsonl",
                session_id="unrelated",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[self.exec_command_entry("pwd")],
            )
            selector = MODULE.resolve_target_skill_selector(
                "oracle-ask",
                (MODULE.REPO_ROOT / ".agents/skills/oracle-ask").resolve(),
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                target_skill_name=selector,
                sessions_root=root,
            )
        self.assertEqual(selected, event_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "agent-event-msg")
        self.assertEqual(metadata["selection_evidence"]["invocation_hits"], 1)

    def test_discover_latest_session_log_counts_namespaced_exec_command_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            namespaced_log = self.write_session_log(
                root,
                "2026/03/15/namespaced.jsonl",
                session_id="namespaced",
                timestamp="2026-03-15T08:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    self.namespaced_exec_command_entry(
                        "sed -n '1,200p' .agents/skills/rloop-code-fix/SKILL.md"
                    )
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/unrelated.jsonl",
                session_id="unrelated",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                target_skill_name="rloop-code-fix",
                sessions_root=root,
            )
        self.assertEqual(selected, namespaced_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "namespaced")

    def test_build_session_selection_evidence_counts_custom_tool_call_execution(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            log_path = self.write_session_log(
                root,
                "2026/05/18/custom-tool.jsonl",
                session_id="custom-tool",
                timestamp="2026-05-18T09:00:00.000Z",
                cwd="/repo/current",
                entries=[
                    self.custom_exec_command_entry(
                        "python3 .agents/skills/code-review/scripts/review.py"
                    )
                ],
            )
            evidence = MODULE.build_session_selection_evidence(log_path, "code-review")
        self.assertGreater(evidence.execution_hits, 0)

    def test_discover_latest_session_log_ignores_artifact_mentions_outside_commands(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            consulted_log = self.write_session_log(
                root,
                "2026/03/15/consulted.jsonl",
                session_id="consulted",
                timestamp="2026-03-15T08:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    self.exec_command_entry(
                        "sed -n '1,200p' .agents/skills/rloop-code-fix/SKILL.md"
                    )
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/noisy.jsonl",
                session_id="noisy",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "message",
                            "role": "assistant",
                            "content": [
                                {
                                    "text": "Previous artifacts lived under docs/tool-output/rloop-code-fix/12345678 and docs/run/rloop-code-fix-12345678.md.",
                                }
                            ],
                        },
                    }
                ],
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                target_skill_name="rloop-code-fix",
                sessions_root=root,
            )
        self.assertEqual(selected, consulted_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "consulted")

    def test_discover_latest_session_log_counts_artifact_only_commands_as_skill_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            consulted_log = self.write_session_log(
                root,
                "2026/03/15/consulted.jsonl",
                session_id="consulted",
                timestamp="2026-03-15T08:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    self.exec_command_entry(
                        "sed -n '1,200p' .agents/skills/rloop-code-fix-tui/SKILL.md"
                    )
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/artifact-only.jsonl",
                session_id="artifact-only",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    self.exec_command_entry(
                        "cat docs/run/rloop-code-fix-tui-12345678.md"
                    )
                ],
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                target_skill_name=".agents/skills/rloop-code-fix-tui",
                sessions_root=root,
            )
        self.assertNotEqual(selected, consulted_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "artifact-only")

    def test_discover_latest_session_log_prefers_artifact_evidence_over_declaration_only_signal(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            artifact_log = self.write_session_log(
                root,
                "2026/03/15/artifact.jsonl",
                session_id="artifact",
                timestamp="2026-03-15T08:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    self.exec_command_entry(
                        "cat docs/run/rloop-code-fix-12345678.md"
                    )
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/declaration.jsonl",
                session_id="declaration",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "message",
                            "role": "assistant",
                            "content": [
                                {
                                    "text": "Using the rloop-code-fix skill to review the current diff.",
                                }
                            ],
                        },
                    },
                    self.exec_command_entry("pwd"),
                ],
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                target_skill_name=".agents/skills/rloop-code-fix",
                sessions_root=root,
            )
        self.assertEqual(selected, artifact_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "artifact")

    def test_discover_latest_session_log_honors_explicit_external_skill_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            external_skill = root / "external-skill"
            external_skill.mkdir()
            (external_skill / "SKILL.md").write_text("# External Skill\n", encoding="utf-8")
            external_log = self.write_session_log(
                root,
                "2026/03/15/external.jsonl",
                session_id="external",
                timestamp="2026-03-15T08:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    self.exec_command_entry(
                        f"sed -n '1,120p' {external_skill / 'SKILL.md'}"
                    )
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/unrelated.jsonl",
                session_id="unrelated",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                target_skill_name=str(external_skill),
                sessions_root=root,
            )
        self.assertEqual(selected, external_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "external")

    def test_discover_latest_session_log_does_not_let_basename_only_markers_override_external_skill_path(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            external_skill = root / "external-skill"
            external_skill.mkdir()
            (external_skill / "SKILL.md").write_text("# External Skill\n", encoding="utf-8")
            external_log = self.write_session_log(
                root,
                "2026/03/15/external.jsonl",
                session_id="external",
                timestamp="2026-03-15T08:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    self.exec_command_entry(
                        f"sed -n '1,120p' {external_skill / 'SKILL.md'}"
                    )
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/basename-noise.jsonl",
                session_id="basename-noise",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "message",
                            "role": "assistant",
                            "content": [
                                {
                                    "text": "Using the external-skill skill and docs/tool-output/external-skill/example.",
                                }
                            ],
                        },
                    },
                    self.exec_command_entry(
                        "cat docs/tool-output/external-skill/example.md"
                    ),
                ],
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                target_skill_name=str(external_skill),
                sessions_root=root,
            )
        self.assertEqual(selected, external_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "external")

    def test_discover_latest_session_log_honors_relative_external_skill_selector(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            workspace = root / "workspace"
            workspace.mkdir()
            shared_skill = root / "shared-skill"
            shared_skill.mkdir()
            (shared_skill / "SKILL.md").write_text("# Shared Skill\n", encoding="utf-8")
            relative_log = self.write_session_log(
                root,
                "2026/03/15/relative.jsonl",
                session_id="relative",
                timestamp="2026-03-15T08:00:00.000Z",
                cwd=str(workspace),
                originator="codex_cli_rs",
                entries=[
                    self.exec_command_entry(
                        "sed -n '1,120p' ../shared-skill/SKILL.md"
                    )
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/unrelated.jsonl",
                session_id="unrelated",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=workspace,
                target_skill_name=("../shared-skill", str(shared_skill.resolve())),
                sessions_root=root,
            )
        self.assertEqual(selected, relative_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "relative")

    def test_relative_external_skill_selector_matches_absolute_exec_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            workspace = root / "workspace"
            workspace.mkdir()
            shared_skill = root / "shared-skill"
            shared_skill.mkdir()
            (shared_skill / "SKILL.md").write_text("# Shared Skill\n", encoding="utf-8")
            absolute_log = self.write_session_log(
                root,
                "2026/03/15/absolute.jsonl",
                session_id="absolute",
                timestamp="2026-03-15T08:00:00.000Z",
                cwd=str(workspace),
                originator="codex_cli_rs",
                entries=[
                    self.exec_command_entry(
                        f"sed -n '1,120p' {shared_skill.resolve() / 'SKILL.md'}"
                    )
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/unrelated.jsonl",
                session_id="unrelated",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd=str(workspace),
                originator="codex_cli_rs",
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=workspace,
                target_skill_name=("../shared-skill", str(shared_skill.resolve())),
                sessions_root=root,
            )
        self.assertEqual(selected, absolute_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "absolute")

    def test_explicit_absolute_repo_local_skill_selector_keeps_repo_relative_alias(self) -> None:
        with tempfile.TemporaryDirectory(dir=MODULE.REPO_ROOT) as skill_tmpdir:
            skill_path = Path(skill_tmpdir)
            (skill_path / "SKILL.md").write_text("# Repo Local Skill\n", encoding="utf-8")
            with tempfile.TemporaryDirectory() as sessions_tmpdir:
                sessions_root = Path(sessions_tmpdir)
                repo_relative_selector = str(skill_path.relative_to(MODULE.REPO_ROOT))
                repo_relative_log = self.write_session_log(
                    sessions_root,
                    "2026/03/15/repo-relative.jsonl",
                    session_id="repo-relative",
                    timestamp="2026-03-15T08:00:00.000Z",
                    cwd=str(MODULE.REPO_ROOT),
                    originator="codex_cli_rs",
                    entries=[
                        self.exec_command_entry(
                            f"sed -n '1,120p' {repo_relative_selector}/SKILL.md"
                        )
                    ],
                )
                self.write_session_log(
                    sessions_root,
                    "2026/03/16/unrelated.jsonl",
                    session_id="unrelated",
                    timestamp="2026-03-16T09:00:00.000Z",
                    cwd=str(MODULE.REPO_ROOT),
                    originator="codex_cli_rs",
                )
                selector = MODULE.resolve_target_skill_selector(
                    str(skill_path.resolve()),
                    skill_path.resolve(),
                )
                selected, metadata = MODULE.discover_latest_session_log(
                    cwd_hint=MODULE.REPO_ROOT,
                    target_skill_name=selector,
                    sessions_root=sessions_root,
                )
        self.assertEqual(selected, repo_relative_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "repo-relative")

    def test_explicit_claude_relative_selector_keeps_strict_variant_matching(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            claude_log = self.write_session_log(
                root,
                "2026/03/15/claude.jsonl",
                session_id="claude",
                timestamp="2026-03-15T08:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    self.exec_command_entry(
                        "sed -n '1,120p' .claude/skills/rloop-code-fix-tui/SKILL.md"
                    )
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/agents-noisy.jsonl",
                session_id="agents-noisy",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "message",
                            "role": "assistant",
                            "content": [
                                {
                                    "text": "Using the rloop-code-fix-tui skill and docs/tool-output/rloop-code-fix-tui/example.",
                                }
                            ],
                        },
                    }
                ],
            )
            selector = MODULE.resolve_target_skill_selector(
                ".claude/skills/rloop-code-fix-tui",
                (MODULE.REPO_ROOT / ".claude/skills/rloop-code-fix-tui").resolve(),
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                target_skill_name=selector,
                sessions_root=root,
            )
        self.assertEqual(selected, claude_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "claude")

    def test_discover_latest_session_log_prefers_structured_skill_invocation_over_newer_zero_signal_log(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            invoked_log = self.write_session_log(
                root,
                "2026/03/15/oracle-ask.jsonl",
                session_id="oracle-ask",
                timestamp="2026-03-15T08:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    self.skill_message_entry(
                        skill_name="oracle-ask",
                        skill_path="/home/muly/cube9-env1/app/.agents/skills/oracle-ask/SKILL.md",
                    ),
                    self.exec_command_entry("./node_modules/.bin/zx ask-and-wait --help"),
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/unrelated.jsonl",
                session_id="unrelated",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[self.exec_command_entry("pwd")],
            )
            selector = MODULE.resolve_target_skill_selector(
                "oracle-ask",
                (MODULE.REPO_ROOT / ".agents/skills/oracle-ask").resolve(),
            )
            selected, metadata = MODULE.discover_latest_session_log(
                cwd_hint=Path("/repo/current"),
                target_skill_name=selector,
                sessions_root=root,
            )
        self.assertEqual(selected, invoked_log.resolve())
        self.assertEqual(metadata["resolved_session_id"], "oracle-ask")
        self.assertEqual(metadata["selection_evidence"]["invocation_hits"], 1)

    def test_discover_latest_session_log_rejects_zero_signal_matches_for_target_skill(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.write_session_log(
                root,
                "2026/03/16/unrelated.jsonl",
                session_id="unrelated",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[self.exec_command_entry("pwd")],
            )
            selector = MODULE.resolve_target_skill_selector(
                "oracle-ask",
                (MODULE.REPO_ROOT / ".agents/skills/oracle-ask").resolve(),
            )
            with self.assertRaises(SystemExit) as exc:
                MODULE.discover_latest_session_log(
                    cwd_hint=Path("/repo/current"),
                    target_skill_name=selector,
                    sessions_root=root,
                )
        self.assertIn("matched target skill evidence", str(exc.exception))

    def test_discover_latest_session_log_keeps_variant_matching_strict_for_structured_skill_invocation(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.write_session_log(
                root,
                "2026/03/15/agents.jsonl",
                session_id="agents",
                timestamp="2026-03-15T08:00:00.000Z",
                cwd="/repo/current",
                originator="codex_cli_rs",
                entries=[
                    self.skill_message_entry(
                        skill_name="oracle-ask",
                        skill_path="/home/muly/cube9-env1/app/.agents/skills/oracle-ask/SKILL.md",
                    ),
                    self.exec_command_entry("./node_modules/.bin/zx ask-and-wait --help"),
                ],
            )
            selector = MODULE.resolve_target_skill_selector(
                ".claude/skills/oracle-ask",
                (MODULE.REPO_ROOT / ".claude/skills/oracle-ask").resolve(),
            )
            with self.assertRaises(SystemExit) as exc:
                MODULE.discover_latest_session_log(
                    cwd_hint=Path("/repo/current"),
                    target_skill_name=selector,
                    sessions_root=root,
                )
        self.assertIn("matched target skill evidence", str(exc.exception))

    def test_build_skill_usage_census_counts_real_skill_activity(self) -> None:
        events = [
            {
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {
                            "text": (
                                "<skill>\n"
                                "<name>code-review</name>\n"
                                "<path>/repo/.agents/skills/code-review/SKILL.md</path>\n"
                                "</skill>"
                            )
                        }
                    ],
                },
            },
            self.exec_command_entry("sed -n '1,40p' .agents/skills/code-review/SKILL.md"),
            self.exec_command_entry("python3 .agents/skills/code-review/scripts/review.py"),
            self.exec_command_entry("mkdir -p docs/tool-output/code-review/run-1"),
        ]
        census = MODULE.build_skill_usage_census(events)
        by_name = {item["name"]: item for item in census}
        self.assertEqual(by_name["code-review"]["invocation_hits"], 1)
        self.assertEqual(by_name["code-review"]["consult_hits"], 1)
        self.assertEqual(by_name["code-review"]["execution_hits"], 1)
        self.assertEqual(by_name["code-review"]["artifact_hits"], 1)
        self.assertTrue(by_name["code-review"]["has_tool_activity"])

    def test_build_skill_usage_census_counts_hyphenated_docs_run_artifact_for_known_skill(
        self,
    ) -> None:
        events = [
            {
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {
                            "text": (
                                "<skill>\n"
                                "<name>code-review</name>\n"
                                "<path>/repo/.agents/skills/code-review/SKILL.md</path>\n"
                                "</skill>"
                            )
                        }
                    ],
                },
            },
            self.exec_command_entry("sed -n '1,40p' .agents/skills/code-review/SKILL.md"),
            self.exec_command_entry("python3 .agents/skills/code-review/scripts/review.py"),
            self.exec_command_entry("cat docs/run/code-review-20260518.md"),
            self.exec_command_entry("ls docs/run/code-review-abc/"),
        ]
        census = MODULE.build_skill_usage_census(events)
        by_name = {item["name"]: item for item in census}
        self.assertEqual(by_name["code-review"]["artifact_hits"], 2)
        self.assertNotIn("code", by_name)

    def test_build_skill_usage_census_counts_docs_run_artifact_without_prior_entry(
        self,
    ) -> None:
        events = [
            self.exec_command_entry("cat docs/run/code-review-20260518.md"),
        ]
        census = MODULE.build_skill_usage_census(events)
        by_name = {item["name"]: item for item in census}
        self.assertEqual(by_name["code-review"]["artifact_hits"], 1)
        self.assertTrue(by_name["code-review"]["has_tool_activity"])
        self.assertNotIn("code", by_name)

    def test_build_skill_usage_census_counts_script_reads_as_consult_not_execution(
        self,
    ) -> None:
        for read_command in (
            "sed -n '1,40p' .agents/skills/code-review/scripts/review.py",
            "cat .agents/skills/code-review/scripts/review.py",
            "rg TODO .agents/skills/code-review/scripts/review.py",
        ):
            with self.subTest(read_command=read_command):
                events = [
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "message",
                            "role": "user",
                            "content": [
                                {
                                    "text": (
                                        "<skill>\n"
                                        "<name>code-review</name>\n"
                                        "<path>/repo/.agents/skills/code-review/SKILL.md</path>\n"
                                        "</skill>"
                                    )
                                }
                            ],
                        },
                    },
                    self.exec_command_entry(read_command),
                ]
                census = MODULE.build_skill_usage_census(events)
                by_name = {item["name"]: item for item in census}
                self.assertEqual(by_name["code-review"]["consult_hits"], 1)
                self.assertEqual(by_name["code-review"]["execution_hits"], 0)

    def test_build_skill_usage_census_counts_shell_wrapped_script_reads_as_consult(
        self,
    ) -> None:
        for read_command in (
            "bash -lc 'sed -n 1,40p .agents/skills/code-review/scripts/review.py'",
            "sh -c 'cat .agents/skills/code-review/scripts/review.py'",
        ):
            with self.subTest(read_command=read_command):
                events = [
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "message",
                            "role": "user",
                            "content": [
                                {
                                    "text": (
                                        "<skill>\n"
                                        "<name>code-review</name>\n"
                                        "<path>/repo/.agents/skills/code-review/SKILL.md</path>\n"
                                        "</skill>"
                                    )
                                }
                            ],
                        },
                    },
                    self.exec_command_entry(read_command),
                ]
                census = MODULE.build_skill_usage_census(events)
                by_name = {item["name"]: item for item in census}
                self.assertEqual(by_name["code-review"]["consult_hits"], 1)
                self.assertEqual(by_name["code-review"]["execution_hits"], 0)

    def test_build_skill_usage_census_counts_env_and_sudo_wrapped_script_executions(
        self,
    ) -> None:
        for execution_command in (
            "env -i python3 .agents/skills/code-review/scripts/review.py",
            "sudo -E python3 .agents/skills/code-review/scripts/review.py",
        ):
            with self.subTest(execution_command=execution_command):
                events = [
                    self.exec_command_entry(execution_command),
                ]
                census = MODULE.build_skill_usage_census(events)
                by_name = {item["name"]: item for item in census}
                self.assertEqual(by_name["code-review"]["execution_hits"], 1)
                self.assertEqual(by_name["code-review"]["consult_hits"], 0)

    def test_build_skill_usage_census_detects_exec_json_command_activity(self) -> None:
        events = [
            {"type": "turn.started"},
            {
                "type": "item.completed",
                "item": {
                    "type": "command_execution",
                    "command": "python3 .agents/skills/code-review/scripts/review.py",
                    "aggregated_output": "Process exited with code 0",
                },
            },
            {
                "type": "item.completed",
                "item": {
                    "type": "command_execution",
                    "command": "mkdir -p docs/tool-output/code-review/run-1",
                    "aggregated_output": "Process exited with code 0",
                },
            },
            {"type": "turn.completed", "usage": {"input_tokens": 4}},
        ]
        census = MODULE.build_skill_usage_census(events)
        by_name = {item["name"]: item for item in census}
        self.assertEqual(by_name["code-review"]["execution_hits"], 1)
        self.assertEqual(by_name["code-review"]["artifact_hits"], 1)
        self.assertTrue(by_name["code-review"]["has_tool_activity"])

    def test_build_skill_usage_census_detects_custom_tool_call_command_activity(
        self,
    ) -> None:
        events = [
            {
                "type": "response_item",
                "payload": {
                    "type": "custom_tool_call",
                    "name": "exec_command",
                    "arguments": json.dumps(
                        {"cmd": "python3 .agents/skills/code-review/scripts/review.py"}
                    ),
                },
            }
        ]
        census = MODULE.build_skill_usage_census(events)
        by_name = {item["name"]: item for item in census}
        self.assertEqual(by_name["code-review"]["execution_hits"], 1)
        self.assertTrue(by_name["code-review"]["has_tool_activity"])

    def test_build_skill_usage_census_counts_exec_json_message_skill_invocation(
        self,
    ) -> None:
        events = [
            {"type": "turn.started"},
            {
                "type": "item.completed",
                "item": {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {
                            "text": (
                                "<skill>\n"
                                "<name>code-review</name>\n"
                                "<path>/repo/.agents/skills/code-review/SKILL.md</path>\n"
                                "</skill>"
                            )
                        }
                    ],
                },
            },
            {"type": "turn.completed", "usage": {"input_tokens": 4}},
        ]
        census = MODULE.build_skill_usage_census(events)
        by_name = {item["name"]: item for item in census}
        self.assertEqual(by_name["code-review"]["invocation_hits"], 1)

    def test_build_skill_usage_census_ignores_non_skill_name_xml(self) -> None:
        events = [
            {
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {
                            "text": "Please update <config><name>database</name></config>"
                        }
                    ],
                },
            }
        ]
        self.assertEqual(MODULE.build_skill_usage_census(events), [])

    def test_build_skill_usage_census_ignores_available_skill_catalog_only(self) -> None:
        events = [
            {
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {
                            "text": (
                                "### Available skills\n"
                                "- code-review: Use when reviewing code\n"
                                "- writing-plans: Use when planning work\n"
                            )
                        }
                    ],
                },
            }
        ]
        self.assertEqual(MODULE.build_skill_usage_census(events), [])

    def test_parse_args_accepts_census_without_skill(self) -> None:
        original_argv = sys.argv
        sys.argv = ["analyze.py", "--census", "--log", "sample.jsonl"]
        try:
            args = MODULE.parse_args()
        finally:
            sys.argv = original_argv
        self.assertTrue(args.census)
        self.assertIsNone(args.skill)
        self.assertEqual(args.log, "sample.jsonl")

    def test_parse_args_rejects_census_with_skill(self) -> None:
        original_argv = sys.argv
        sys.argv = ["analyze.py", "--census", "--skill", "code-review"]
        try:
            with self.assertRaises(SystemExit):
                MODULE.parse_args()
        finally:
            sys.argv = original_argv

    def test_render_census_report_outputs_table_and_matched_cwd(self) -> None:
        report = MODULE.render_census_report(
            trace_path=Path("/tmp/session.jsonl"),
            trace_format="stored_session_jsonl",
            source_label="latest_discovered",
            source_metadata={"matched_cwd": "/repo/current"},
            census=[
                {
                    "name": "code-review",
                    "declaration_hits": 0,
                    "invocation_hits": 1,
                    "consult_hits": 1,
                    "execution_hits": 1,
                    "artifact_hits": 1,
                    "has_tool_activity": True,
                }
            ],
        )
        self.assertIn("| Skill | Signals | Hits | Tool Activity |", report)
        self.assertIn(
            "| code-review | execution_hits, artifact_hits, invocation_hits, consult_hits | 4 | yes |",
            report,
        )
        self.assertIn("- Matched cwd: `/repo/current`", report)

    def test_main_census_rerun_preserves_trace_source(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            trace_path = self.write_session_log(
                root,
                "trace.jsonl",
                session_id="trace",
                timestamp="2026-05-18T00:00:00.000Z",
                cwd="/repo/current",
                entries=[self.exec_command_entry("python3 .agents/skills/code-review/scripts/review.py")],
            )
            out_dir = root / "artifacts"
            original_argv = sys.argv
            sys.argv = [
                "analyze.py",
                "--census",
                "--trace",
                str(trace_path),
                "--out-dir",
                str(out_dir),
            ]
            try:
                exit_code = MODULE.main()
            finally:
                sys.argv = original_argv

            self.assertEqual(exit_code, 0)
            rerun = (out_dir / "rerun.md").read_text(encoding="utf-8")
            self.assertIn("--trace", rerun)
            self.assertNotIn("--log", rerun)

    def test_resolve_trace_source_defaults_to_latest_current_repo_log(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            newest = self.write_session_log(
                root,
                "2026/03/16/current.jsonl",
                session_id="current",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd=str(MODULE.REPO_ROOT),
                entries=[
                    self.skill_message_entry(
                        skill_name="improve-codex-skills",
                        skill_path=f"{MODULE.REPO_ROOT}/.agents/skills/improve-codex-skills/SKILL.md",
                    ),
                    self.exec_command_entry("pwd"),
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/other.jsonl",
                session_id="other",
                timestamp="2026-03-16T10:00:00.000Z",
                cwd="/repo/other",
            )
            original = MODULE.default_sessions_root
            MODULE.default_sessions_root = lambda: root
            try:
                args = argparse.Namespace(
                    session_id=None,
                    log=None,
                    trace=None,
                    log_cwd=None,
                    mdev_window=None,
                    mdev_index=None,
                    mdev_registry=None,
                    tmux_target=None,
                    census=False,
                )
                trace_path, source_label, metadata = MODULE.resolve_trace_source(
                    args,
                    root / "artifacts",
                    target_skill_name="improve-codex-skills",
                )
            finally:
                MODULE.default_sessions_root = original
        self.assertEqual(trace_path, newest.resolve())
        self.assertEqual(source_label, "latest_discovered")
        self.assertEqual(metadata["source_kind"], "latest_log")

    def test_resolve_trace_source_uses_log_cwd_hint_for_latest_log(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            expected = self.write_session_log(
                root,
                "2026/03/16/env1.jsonl",
                session_id="env1",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd="/tmp/env1/app",
                entries=[
                    self.skill_message_entry(
                        skill_name="improve-codex-skills",
                        skill_path="/tmp/env1/app/.agents/skills/improve-codex-skills/SKILL.md",
                    ),
                    self.exec_command_entry("pwd"),
                ],
            )
            self.write_session_log(
                root,
                "2026/03/16/current.jsonl",
                session_id="current",
                timestamp="2026-03-16T09:30:00.000Z",
                cwd=str(MODULE.REPO_ROOT),
            )
            original = MODULE.default_sessions_root
            MODULE.default_sessions_root = lambda: root
            try:
                args = argparse.Namespace(
                    session_id=None,
                    log=None,
                    trace=None,
                    log_cwd="/tmp/env1/app",
                    mdev_window=None,
                    mdev_index=None,
                    mdev_registry=None,
                    tmux_target=None,
                    census=False,
                )
                trace_path, source_label, metadata = MODULE.resolve_trace_source(
                    args,
                    root / "artifacts",
                    target_skill_name="improve-codex-skills",
                )
            finally:
                MODULE.default_sessions_root = original
        self.assertEqual(trace_path, expected.resolve())
        self.assertEqual(source_label, "latest_discovered")
        self.assertEqual(metadata["matched_cwd"], str(Path("/tmp/env1/app").resolve()))

    def test_resolve_trace_source_supports_env_shorthand_for_log_cwd(self) -> None:
        target_cwd = (Path.home() / "cube9-env5" / "app").resolve()
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            expected = self.write_session_log(
                root,
                "2026/03/16/env5.jsonl",
                session_id="env5",
                timestamp="2026-03-16T09:00:00.000Z",
                cwd=str(target_cwd),
                entries=[
                    self.skill_message_entry(
                        skill_name="improve-codex-skills",
                        skill_path=f"{target_cwd}/.agents/skills/improve-codex-skills/SKILL.md",
                    ),
                    self.exec_command_entry("pwd"),
                ],
            )
            original = MODULE.default_sessions_root
            MODULE.default_sessions_root = lambda: root
            try:
                args = argparse.Namespace(
                    session_id=None,
                    log=None,
                    trace=None,
                    log_cwd="env5",
                    mdev_window=None,
                    mdev_index=None,
                    mdev_registry=None,
                    tmux_target=None,
                    census=False,
                )
                trace_path, source_label, metadata = MODULE.resolve_trace_source(
                    args,
                    root / "artifacts",
                    target_skill_name="improve-codex-skills",
                )
            finally:
                MODULE.default_sessions_root = original
        self.assertEqual(trace_path, expected.resolve())
        self.assertEqual(source_label, "latest_discovered")
        self.assertEqual(metadata["matched_cwd"], str(target_cwd))

    def test_detect_trace_format_for_stored_session(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            {"type": "response_item", "payload": {"type": "message", "role": "user", "content": []}},
        ]
        self.assertEqual(MODULE.detect_trace_format(events), "stored_session_jsonl")

    def test_detect_trace_format_for_exec_json(self) -> None:
        events = [
            {"type": "thread.started"},
            {"type": "turn.completed", "usage": {"input_tokens": 1}},
        ]
        self.assertEqual(MODULE.detect_trace_format(events), "exec_json")

    def test_redact_text(self) -> None:
        text = "Authorization: Bearer sk-abc12345678901234567890\nHOME=/home/muly"
        redacted = MODULE.redact_text(text)
        self.assertNotIn("sk-abc12345678901234567890", redacted)
        self.assertIn("[REDACTED]", redacted)
        self.assertNotIn("/home/muly", redacted)

    def test_normalize_stored_session_redacts_tool_arguments_without_breaking_json(self) -> None:
        command = (
            "node <<'NODE'\n"
            "const fs = require('fs');\n"
            "const events = fs.readFileSync('/home/muly/cube9-env0/app/docs/tool-output/"
            "rloop-code-fix/07047101/events.jsonl', 'utf8').trim().split('\\\\n')\n"
            "  .map(line => JSON.parse(line));\n"
            "console.log(JSON.stringify({results: events}, null, 2));\n"
            "NODE"
        )
        events = [
            {"type": "session_meta", "payload": {}},
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call",
                    "call_id": "call-1",
                    "name": "exec_command",
                    "arguments": json.dumps({"cmd": command}),
                },
            },
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "call-1",
                    "output": "Process exited with code 0",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")
        tool_args = normalized["turns"][0]["tool_calls"][0]["arguments"]
        self.assertIsInstance(tool_args, dict)
        self.assertIn("cmd", tool_args)
        self.assertIsInstance(tool_args["cmd"], str)
        self.assertNotIn("/home/muly", tool_args["cmd"])

    def test_normalize_stored_session_extracts_command_and_failure(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call",
                    "call_id": "call-1",
                    "name": "exec_command",
                    "arguments": "{\"cmd\":\"yarn missing-command\"}",
                },
            },
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "call-1",
                    "output": "Process exited with code 127\nmissing-command: command not found",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")
        self.assertEqual(normalized["stats"]["command_count"], 1)
        self.assertEqual(normalized["stats"]["failed_command_count"], 1)
        self.assertEqual(normalized["turns"][0]["commands"][0]["ref"], "turn-1.command-1")
        self.assertFalse(normalized["usage"]["has_usage"])

    def test_normalize_stored_session_expands_parallel_exec_commands(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call",
                    "call_id": "call-1",
                    "name": "multi_tool_use.parallel",
                    "arguments": json.dumps(
                        {
                            "tool_uses": [
                                {
                                    "recipient_name": "functions.exec_command",
                                    "parameters": {"cmd": "pwd"},
                                },
                                {
                                    "recipient_name": "functions.exec_command",
                                    "parameters": {"cmd": "git status --short"},
                                },
                            ]
                        }
                    ),
                },
            },
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "call-1",
                    "output": "Process exited with code 0\n",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")
        self.assertEqual(normalized["stats"]["command_count"], 2)
        self.assertEqual(
            [command["ref"] for command in normalized["turns"][0]["commands"]],
            ["turn-1.command-1", "turn-1.command-2"],
        )
        self.assertEqual(
            [command["tool_name"] for command in normalized["turns"][0]["commands"]],
            ["multi_tool_use.parallel", "multi_tool_use.parallel"],
        )

    def test_normalize_stored_session_extracts_token_count_event_msg(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            {
                "type": "event_msg",
                "payload": {
                    "type": "token_count",
                    "info": {
                        "total_token_usage": {
                            "input_tokens": 1200,
                            "cached_input_tokens": 800,
                            "output_tokens": 100,
                            "reasoning_output_tokens": 20,
                            "total_tokens": 1320,
                        },
                        "last_token_usage": {
                            "input_tokens": 300,
                            "cached_input_tokens": 200,
                            "output_tokens": 40,
                            "total_tokens": 340,
                        },
                        "model_context_window": 258400,
                    },
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")
        self.assertTrue(normalized["usage"]["has_usage"])
        self.assertEqual(normalized["usage"]["source"], "session_token_count")
        self.assertEqual(normalized["usage"]["input_tokens"], 1200)
        self.assertEqual(normalized["usage"]["cached_input_tokens"], 800)
        self.assertEqual(normalized["usage"]["output_tokens"], 100)
        self.assertEqual(normalized["usage"]["model_context_window"], 258400)
        self.assertEqual(normalized["usage"]["last_token_usage"]["total_tokens"], 340)

    def test_normalize_exec_trace_groups_turns_and_renders_transcript(self) -> None:
        events = [
            {"type": "turn.started"},
            {
                "type": "item.completed",
                "item": {
                    "type": "message",
                    "role": "user",
                    "content": [{"text": "Inspect the trace"}],
                },
            },
            {
                "type": "item.completed",
                "item": {
                    "type": "command_execution",
                    "command": "python3 tool.py --trace sample.jsonl",
                    "aggregated_output": "Process exited with code 0",
                },
            },
            {"type": "turn.completed", "usage": {"input_tokens": 4}},
        ]
        normalized = MODULE.normalize_trace(events, "exec_json")
        transcript = MODULE.render_markdown_transcript(normalized, "exec_json")
        self.assertEqual(normalized["stats"]["turn_count"], 1)
        self.assertIn("turn-1.user-1", transcript)
        self.assertIn("turn-1.command-1", transcript)
        self.assertEqual(normalized["usage"]["input_tokens"], 4)

    def test_normalize_exec_trace_aggregates_usage_across_turns(self) -> None:
        events = [
            {"type": "turn.started"},
            {"type": "turn.completed", "usage": {"input_tokens": 10, "output_tokens": 2, "total_tokens": 12}},
            {"type": "turn.started"},
            {"type": "turn.completed", "usage": {"input_tokens": 20, "cached_input_tokens": 5, "output_tokens": 3, "total_tokens": 23}},
        ]
        normalized = MODULE.normalize_trace(events, "exec_json")
        self.assertTrue(normalized["usage"]["has_usage"])
        self.assertEqual(normalized["usage"]["source"], "exec_turn_usage")
        self.assertEqual(normalized["usage"]["input_tokens"], 30)
        self.assertEqual(normalized["usage"]["cached_input_tokens"], 5)
        self.assertEqual(normalized["usage"]["output_tokens"], 5)
        self.assertEqual(normalized["usage"]["total_tokens"], 35)
        self.assertEqual(normalized["usage"]["raw_refs"], ["turn-1", "turn-2"])

    def test_build_evidence_pack_marks_diagnosis_only_for_low_signal(self) -> None:
        skill_md = """---
name: sample-skill
description: "Review JSONL traces."
---

# Sample Skill
"""
        normalized = {
            "format": "stored_session_jsonl",
            "turns": [MODULE.make_turn(1)],
            "tool_calls": [],
            "commands": [],
            "user_messages": [{"ref": "turn-1.user-1", "role": "user", "text": "Review this trace"}],
            "assistant_messages": [],
            "event_count": 1,
            "errors": [],
            "usage": {},
            "stats": {
                "event_count": 1,
                "turn_count": 1,
                "tool_call_count": 0,
                "command_count": 0,
                "failed_command_count": 0,
                "message_count": 1,
            },
        }
        findings = MODULE.build_findings(normalized, Path("/tmp/sample-skill"), skill_md)
        evidence = MODULE.build_evidence_pack(normalized, findings, Path("/tmp/sample-skill"), skill_md)
        self.assertTrue(evidence["diagnosis_only"])
        self.assertEqual(evidence["consultation"]["timing"], "never")
        self.assertEqual(evidence["token_review"]["status"], "unavailable")

    def test_build_evidence_pack_collects_referenced_snippets(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            {
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [{"text": "Improve the trace analyzer"}],
                },
            },
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call",
                    "call_id": "call-1",
                    "name": "exec_command",
                    "arguments": "{\"cmd\":\"python3 parse_trace.py sample.jsonl\"}",
                },
            },
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "call-1",
                    "output": "Process exited with code 1\nmissing parser",
                },
            },
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call",
                    "call_id": "call-2",
                    "name": "exec_command",
                    "arguments": "{\"cmd\":\"python3 parse_trace.py sample.jsonl\"}",
                },
            },
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "call-2",
                    "output": "Process exited with code 1\nmissing parser",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")
        skill_md = """---
name: sample-skill
description: "Analyze command traces."
---
"""
        findings = MODULE.build_findings(normalized, Path("/tmp/sample-skill"), skill_md)
        evidence = MODULE.build_evidence_pack(normalized, findings, Path("/tmp/sample-skill"), skill_md)
        refs = {snippet["ref"] for snippet in evidence["evidence_snippets"]}
        self.assertIn("turn-1.command-1", refs)
        self.assertIn("turn-1.command-2", refs)

    def test_build_token_review_emits_savings_opportunities(self) -> None:
        normalized = {
            "usage": {
                "source": "session_token_count",
                "has_usage": True,
                "input_tokens": 12000,
                "cached_input_tokens": 9000,
                "output_tokens": 200,
                "reasoning_output_tokens": 0,
                "total_tokens": 12200,
                "model_context_window": 258400,
                "raw_refs": ["event-2.token-count"],
                "last_token_usage": {},
            }
        }
        findings = [
            MODULE.Finding(
                code="command_thrash",
                title="Command thrash",
                severity="medium",
                category="context_hygiene",
                patch_kind="SKILL_MD_CHANGE",
                evidence_refs=["turn-1.command-1"],
                evidence=["x"],
                recommendation="y",
            )
        ]
        review = MODULE.build_token_review(
            normalized,
            findings,
            {"status": "consulted", "timing": "late", "ref": "turn-1.command-2"},
        )
        self.assertEqual(review["status"], "reviewed")
        self.assertGreaterEqual(len(review["savings_opportunities"]), 2)

    def test_build_report_includes_token_usage_section(self) -> None:
        evidence_pack = {
            "diagnosis_only": False,
            "consultation": {"timing": "early"},
            "steering_markers": [],
            "token_review": {
                "status": "reviewed",
                "observations": ["Total tokens: 100"],
                "savings_opportunities": ["Trim repeated context."],
            },
        }
        normalized = {
            "stats": {
                "event_count": 1,
                "turn_count": 1,
                "tool_call_count": 0,
                "command_count": 0,
                "failed_command_count": 0,
                "message_count": 1,
            },
            "usage": {
                "source": "exec_turn_usage",
                "has_usage": True,
                "input_tokens": 70,
                "cached_input_tokens": 20,
                "output_tokens": 30,
                "reasoning_output_tokens": 0,
                "total_tokens": 100,
                "model_context_window": None,
                "raw_refs": ["turn-1"],
                "last_token_usage": {},
            },
        }
        report = MODULE.build_report(
            skill_path=Path("/tmp/sample-skill"),
            trace_path=Path("/tmp/trace.jsonl"),
            trace_format="exec_json",
            source_label="latest_discovered",
            source_metadata={
                "matched_cwd": "/tmp/source",
                "resolved_session_id": "abc123",
                "resolved_session_timestamp": "2026-03-16T09:00:00.000Z",
            },
            normalized=normalized,
            evidence_pack=evidence_pack,
            diagnosis_only=False,
            findings=[],
            suggestions=[],
            judge_output=None,
            mode="deterministic-only",
            judge_error="",
        )
        self.assertIn("## Token Usage", report)
        self.assertIn("Total tokens: 100", report)
        self.assertIn("Trim repeated context.", report)
        self.assertIn("## Trace Resolution", report)
        self.assertIn("Resolved session id", report)

    def test_build_local_suggestions_maps_patch_kind_to_targets(self) -> None:
        findings = [
            MODULE.Finding(
                code="skill_not_consulted",
                title="Target skill resources were not consulted",
                severity="medium",
                category="procedure",
                patch_kind="SKILL_MD_CHANGE",
                evidence_refs=["turn-1.command-1"],
                evidence=["x"],
                recommendation="Read the bundled references before improvising new steps.",
            ),
            MODULE.Finding(
                code="deterministic_trace_work",
                title="Trace parsing repeated manually",
                severity="low",
                category="deterministic",
                patch_kind="SCRIPT_CHANGE",
                evidence_refs=["turn-2.command-1"],
                evidence=["y"],
                recommendation="Move the repeated parsing into a helper script.",
            ),
        ]

        suggestions = MODULE.build_local_suggestions(findings)

        self.assertEqual(suggestions[0].target, "SKILL.md")
        self.assertEqual(suggestions[0].suggestion, findings[0].recommendation)
        self.assertEqual(suggestions[1].target, "scripts/")

    def test_build_report_lists_suggested_changes_not_proposed_files(self) -> None:
        report = MODULE.build_report(
            skill_path=Path("/tmp/sample-skill"),
            trace_path=Path("/tmp/trace.jsonl"),
            trace_format="stored_session_jsonl",
            source_label="latest_discovered",
            source_metadata={},
            normalized={
                "stats": {"turn_count": 1},
                "usage": {"has_usage": False},
            },
            evidence_pack={
                "diagnosis_only": False,
                "consultation": {"timing": "late"},
                "steering_markers": [],
                "token_review": {"status": "missing"},
            },
            diagnosis_only=False,
            findings=[],
            suggestions=[
                MODULE.SuggestedChange(
                    target="SKILL.md",
                    risk_level="low",
                    rationale="Clarify the workflow stop condition",
                    suggestion="Add an explicit stop rule for low-signal traces.",
                    expected_benefit="Reduces speculative changes.",
                    evidence_refs=["turn-1.command-1"],
                )
            ],
            judge_output=None,
            mode="deterministic-only",
            judge_error="",
        )

        self.assertIn("## Suggested Changes", report)
        self.assertIn("Add an explicit stop rule for low-signal traces.", report)
        self.assertNotIn("## Proposed Files", report)

    def test_resolve_output_diagnosis_only_prefers_judge_flag(self) -> None:
        diagnosis_only = MODULE.resolve_output_diagnosis_only(
            {"diagnosis_only": False},
            {"diagnosis_only": True},
        )
        self.assertTrue(diagnosis_only)

    def test_build_suggestions_respects_judge_diagnosis_only(self) -> None:
        findings = [
            MODULE.Finding(
                code="skill_not_consulted",
                title="Target skill resources were not consulted",
                severity="medium",
                category="procedure",
                patch_kind="SKILL_MD_CHANGE",
                evidence_refs=["turn-1.command-1"],
                evidence=["x"],
                recommendation="Read the bundled references before improvising new steps.",
            )
        ]

        suggestions = MODULE.build_suggestions(
            findings,
            {
                "diagnosis_only": True,
                "breakdowns": [],
            },
        )

        self.assertEqual(suggestions, [])

    def test_build_suggestions_does_not_fallback_after_successful_judge_run(self) -> None:
        findings = [
            MODULE.Finding(
                code="skill_not_consulted",
                title="Target skill resources were not consulted",
                severity="medium",
                category="procedure",
                patch_kind="SKILL_MD_CHANGE",
                evidence_refs=["turn-1.command-1"],
                evidence=["x"],
                recommendation="Read the bundled references before improvising new steps.",
            )
        ]

        suggestions = MODULE.build_suggestions(
            findings,
            {
                "diagnosis_only": False,
                "breakdowns": [],
            },
        )

        self.assertEqual(suggestions, [])

    def test_build_judge_prompt_mentions_evidence_pack_only(self) -> None:
        prompt = MODULE.build_judge_prompt(Path("/tmp/skill"), Path("/tmp/evidence.json"))
        self.assertIn("/tmp/evidence.json", prompt)
        self.assertIn("Use the evidence pack only", prompt)
        self.assertIn("do not rely on any raw trace input", prompt.lower())


if __name__ == "__main__":
    unittest.main()
