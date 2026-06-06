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
    def fail_postmortem_judge(
        self,
        _facts_path: Path,
        _output_dir: Path,
        _model: str,
    ) -> dict[str, object]:
        raise RuntimeError("simulated postmortem judge failure")

    def test_default_artifact_root_uses_improve_codex_skills(self) -> None:
        self.assertTrue((MODULE.REPO_ROOT / ".agents/skills").exists())
        self.assertEqual(
            MODULE.ARTIFACT_ROOT,
            MODULE.REPO_ROOT / "docs/tool-output/improve-codex-skills",
        )

    def test_parse_args_allows_postmortem_without_skill(self) -> None:
        original_argv = sys.argv
        sys.argv = ["analyze.py", "--postmortem", "--session-id", "abc123", "--judge", "off"]
        try:
            args = MODULE.parse_args()
        finally:
            sys.argv = original_argv

        self.assertTrue(args.postmortem)
        self.assertIsNone(args.skill)
        self.assertFalse(args.census)
        self.assertEqual(args.session_id, "abc123")

    def test_parse_args_rejects_postmortem_with_skill(self) -> None:
        original_argv = sys.argv
        sys.argv = [
            "analyze.py",
            "--postmortem",
            "--skill",
            "code-review",
            "--session-id",
            "abc123",
        ]
        try:
            with self.assertRaises(SystemExit):
                MODULE.parse_args()
        finally:
            sys.argv = original_argv

    def test_parse_args_rejects_postmortem_with_empty_skill(self) -> None:
        original_argv = sys.argv
        sys.argv = ["analyze.py", "--postmortem", "--skill", "", "--session-id", "abc123"]
        try:
            with self.assertRaises(SystemExit):
                MODULE.parse_args()
        finally:
            sys.argv = original_argv

    def test_parse_args_rejects_empty_skill(self) -> None:
        original_argv = sys.argv
        sys.argv = ["analyze.py", "--skill", "", "--session-id", "abc123"]
        try:
            with self.assertRaises(SystemExit):
                MODULE.parse_args()
        finally:
            sys.argv = original_argv

    def test_parse_args_rejects_postmortem_with_census(self) -> None:
        original_argv = sys.argv
        sys.argv = ["analyze.py", "--postmortem", "--census", "--session-id", "abc123"]
        try:
            with self.assertRaises(SystemExit):
                MODULE.parse_args()
        finally:
            sys.argv = original_argv

    def test_parse_args_still_requires_skill_for_focused_mode(self) -> None:
        original_argv = sys.argv
        sys.argv = ["analyze.py", "--session-id", "abc123", "--judge", "off"]
        try:
            with self.assertRaises(SystemExit):
                MODULE.parse_args()
        finally:
            sys.argv = original_argv

    def test_postmortem_main_writes_expected_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            trace_path = self.write_session_log(
                root,
                "trace.jsonl",
                session_id="postmortem-trace",
                timestamp="2026-06-03T00:00:00.000Z",
                cwd="/repo/current",
                entries=[
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "function_call",
                            "name": "exec_command",
                            "call_id": "call-1",
                            "arguments": json.dumps(
                                {"cmd": "./bin/core8 data trpc call --router personnel"}
                            ),
                        },
                    },
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "function_call_output",
                            "call_id": "call-1",
                            "output": (
                                "Process exited with code 1\n"
                                "Output:\n"
                                "personnel.hireDate: Expected date, received string"
                            ),
                        },
                    },
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "message",
                            "role": "assistant",
                            "content": [
                                {
                                    "type": "output_text",
                                    "text": (
                                        "Caveats: used direct Prisma; plans remain DRAFT; "
                                        "generated code not imported."
                                    ),
                                }
                            ],
                        },
                    },
                ],
            )
            out_dir = root / "artifacts"
            original_argv = sys.argv
            sys.argv = [
                "analyze.py",
                "--postmortem",
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
            self.assertTrue((out_dir / "postmortem-report.md").exists())
            self.assertTrue((out_dir / "postmortem-facts.json").exists())
            self.assertTrue((out_dir / "postmortem-suggestions.json").exists())
            self.assertTrue((out_dir / "redacted-trace.jsonl").exists())
            self.assertTrue((out_dir / "normalized-trace.json").exists())
            self.assertTrue((out_dir / "transcript.md").exists())
            self.assertTrue((out_dir / "rerun.md").exists())
            self.assertTrue((out_dir / "judge-output.json").exists())

            redacted_trace = (out_dir / "redacted-trace.jsonl").read_text(encoding="utf-8")
            self.assertIn("session_meta", redacted_trace)
            normalized_payload = json.loads((out_dir / "normalized-trace.json").read_text(encoding="utf-8"))
            self.assertEqual(normalized_payload["format"], "stored_session_jsonl")
            self.assertEqual(normalized_payload["stats"]["command_count"], 1)

            facts_payload = json.loads((out_dir / "postmortem-facts.json").read_text(encoding="utf-8"))
            self.assertEqual(facts_payload["trace_format"], "stored_session_jsonl")
            self.assertEqual(facts_payload["source_label"], "user_supplied")
            self.assertEqual(facts_payload["source_metadata"]["source_kind"], "trace_path")
            self.assertNotEqual(facts_payload["trace_path"], str(trace_path.resolve()))
            self.assertNotIn("trace.jsonl", facts_payload["trace_path"])
            self.assertFalse(facts_payload["deterministic_diagnosis_only"])
            self.assertTrue(any(fact["category"] == "tool" for fact in facts_payload["facts"]))
            self.assertTrue(any(fact["category"] == "workflow" for fact in facts_payload["facts"]))

            suggestions_payload = json.loads(
                (out_dir / "postmortem-suggestions.json").read_text(encoding="utf-8")
            )
            self.assertEqual(suggestions_payload["mode"], "deterministic-only")
            self.assertFalse(suggestions_payload["diagnosis_only"])
            self.assertTrue(any(item["category"] == "tool" for item in suggestions_payload["suggestions"]))

            judge_payload = json.loads((out_dir / "judge-output.json").read_text(encoding="utf-8"))
            self.assertEqual(judge_payload["status"], "skipped")
            self.assertEqual(judge_payload["error"], "")

            report = (out_dir / "postmortem-report.md").read_text(encoding="utf-8")
            self.assertIn("Codex Session Postmortem", report)
            self.assertIn("Expected date", report)
            self.assertIn("direct Prisma", report)

            rerun = (out_dir / "rerun.md").read_text(encoding="utf-8")
            self.assertIn("--postmortem", rerun)
            self.assertIn("--trace", rerun)
            self.assertIn(str(trace_path.resolve()), rerun)

    def test_postmortem_main_summarizes_empty_suggestions_as_diagnosis_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            trace_path = self.write_session_log(
                root,
                "trace.jsonl",
                session_id="low-signal",
                timestamp="2026-06-03T00:00:00.000Z",
                cwd="/repo/current",
            )
            out_dir = root / "artifacts"
            original_argv = sys.argv
            sys.argv = [
                "analyze.py",
                "--postmortem",
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
            suggestions_payload = json.loads(
                (out_dir / "postmortem-suggestions.json").read_text(encoding="utf-8")
            )
            self.assertTrue(suggestions_payload["diagnosis_only"])
            self.assertEqual(suggestions_payload["suggestions"], [])
            self.assertEqual(suggestions_payload["summary"], "No concrete postmortem suggestions")

    def test_postmortem_rerun_preserves_use_codex_alias(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            trace_path = self.write_session_log(
                root,
                "trace.jsonl",
                session_id="judge-fallback",
                timestamp="2026-06-03T00:00:00.000Z",
                cwd="/repo/current",
            )
            out_dir = root / "artifacts"
            original_argv = sys.argv
            sys.argv = [
                "analyze.py",
                "--postmortem",
                "--trace",
                str(trace_path),
                "--out-dir",
                str(out_dir),
                "--judge",
                "off",
                "--use-codex",
            ]
            original_judge = MODULE.run_postmortem_judge
            MODULE.run_postmortem_judge = self.fail_postmortem_judge
            try:
                exit_code = MODULE.main()
            finally:
                sys.argv = original_argv
                MODULE.run_postmortem_judge = original_judge

            self.assertEqual(exit_code, 0)
            rerun = (out_dir / "rerun.md").read_text(encoding="utf-8")
            self.assertIn("--judge off", rerun)
            self.assertIn("--use-codex", rerun)
            judge_payload = json.loads((out_dir / "judge-output.json").read_text(encoding="utf-8"))
            self.assertEqual(judge_payload["status"], "failed")
            self.assertIn("simulated postmortem judge failure", judge_payload["error"])

    def test_postmortem_rerun_preserves_custom_codex_model(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            trace_path = self.write_session_log(
                root,
                "trace.jsonl",
                session_id="judge-model",
                timestamp="2026-06-03T00:00:00.000Z",
                cwd="/repo/current",
            )
            out_dir = root / "artifacts"
            original_argv = sys.argv
            sys.argv = [
                "analyze.py",
                "--postmortem",
                "--trace",
                str(trace_path),
                "--out-dir",
                str(out_dir),
                "--codex-model",
                "custom-model",
            ]
            original_judge = MODULE.run_postmortem_judge
            MODULE.run_postmortem_judge = self.fail_postmortem_judge
            try:
                exit_code = MODULE.main()
            finally:
                sys.argv = original_argv
                MODULE.run_postmortem_judge = original_judge

            self.assertEqual(exit_code, 0)
            rerun = (out_dir / "rerun.md").read_text(encoding="utf-8")
            self.assertIn("--codex-model custom-model", rerun)
            suggestions_payload = json.loads(
                (out_dir / "postmortem-suggestions.json").read_text(encoding="utf-8")
            )
            self.assertEqual(suggestions_payload["mode"], "judge-fallback")
            report = (out_dir / "postmortem-report.md").read_text(encoding="utf-8")
            self.assertIn("Judge stage failed", report)
            self.assertIn("simulated postmortem judge failure", report)

    def test_postmortem_judge_fallback_keeps_deterministic_suggestions(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            trace_path = self.write_session_log(
                root,
                "trace.jsonl",
                session_id="judge-fallback-actionable",
                timestamp="2026-06-03T00:00:00.000Z",
                cwd="/repo/current",
                entries=[
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "function_call",
                            "name": "exec_command",
                            "call_id": "call-1",
                            "arguments": json.dumps(
                                {"cmd": "./bin/core8 data trpc call --router personnel"}
                            ),
                        },
                    },
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "function_call_output",
                            "call_id": "call-1",
                            "output": (
                                "Process exited with code 1\n"
                                "Output:\n"
                                "personnel.hireDate: Expected date, received string"
                            ),
                        },
                    },
                ],
            )
            out_dir = root / "artifacts"
            original_argv = sys.argv
            original_judge = MODULE.run_postmortem_judge
            MODULE.run_postmortem_judge = self.fail_postmortem_judge
            sys.argv = [
                "analyze.py",
                "--postmortem",
                "--trace",
                str(trace_path),
                "--out-dir",
                str(out_dir),
            ]
            try:
                exit_code = MODULE.main()
            finally:
                sys.argv = original_argv
                MODULE.run_postmortem_judge = original_judge

            self.assertEqual(exit_code, 0)
            suggestions_payload = json.loads(
                (out_dir / "postmortem-suggestions.json").read_text(encoding="utf-8")
            )
            self.assertEqual(suggestions_payload["mode"], "judge-fallback")
            self.assertFalse(suggestions_payload["diagnosis_only"])
            self.assertTrue(
                any(
                    item["category"] == "tool"
                    and item["title"] == "Harden the supported tool or CLI path"
                    for item in suggestions_payload["suggestions"]
                )
            )

            report = (out_dir / "postmortem-report.md").read_text(encoding="utf-8")
            self.assertIn("Harden the supported tool or CLI path", report)
            self.assertIn("Judge stage failed", report)
            self.assertIn("simulated postmortem judge failure", report)

    def test_postmortem_main_merges_successful_judge_suggestions(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            trace_path = self.write_session_log(
                root,
                "trace.jsonl",
                session_id="judge-success",
                timestamp="2026-06-03T00:00:00.000Z",
                cwd="/repo/current",
                entries=[
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "message",
                            "role": "user",
                            "content": [{"type": "input_text", "text": "Review this"}],
                        },
                    },
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "message",
                            "role": "assistant",
                            "content": [
                                {
                                    "type": "output_text",
                                    "text": "Token usage was high and the workflow needed more checkpoints.",
                                }
                            ],
                        },
                    },
                ],
            )
            out_dir = root / "artifacts"
            cited_fact_id = ""
            cited_trace_ref = ""

            def successful_judge(
                facts_path: Path,
                _output_dir: Path,
                _model: str,
            ) -> dict[str, object]:
                nonlocal cited_fact_id, cited_trace_ref
                facts_payload = json.loads(facts_path.read_text(encoding="utf-8"))
                cited_fact = next(
                    (
                        fact
                        for fact in facts_payload["facts"]
                        if isinstance(fact.get("evidence_ref"), str)
                    ),
                    facts_payload["facts"][0],
                )
                cited_fact_id = str(cited_fact["id"])
                cited_trace_ref = (
                    str(cited_fact["evidence_ref"])
                    if isinstance(cited_fact.get("evidence_ref"), str)
                    else ""
                )
                return {
                    "summary": "Judge found token workflow improvements.",
                    "diagnosis_only": False,
                    "breakdowns": [
                        {
                            "title": "Add token budget checkpoints",
                            "severity": "medium",
                            "category": "token",
                            "patch_kind": "SKILL_MD_CHANGE",
                            "evidence_refs": [],
                            "fact_refs": [cited_fact_id],
                            "expected_benefit": "Keeps long postmortems bounded.",
                            "risk": "low",
                            "proposed_change": "Require token budget checkpointing in long postmortems.",
                        }
                    ],
                    "patches": [],
                }

            original_argv = sys.argv
            original_judge = MODULE.run_postmortem_judge
            MODULE.run_postmortem_judge = successful_judge
            sys.argv = [
                "analyze.py",
                "--postmortem",
                "--trace",
                str(trace_path),
                "--out-dir",
                str(out_dir),
            ]
            try:
                exit_code = MODULE.main()
            finally:
                sys.argv = original_argv
                MODULE.run_postmortem_judge = original_judge

            self.assertEqual(exit_code, 0)
            suggestions_payload = json.loads(
                (out_dir / "postmortem-suggestions.json").read_text(encoding="utf-8")
            )
            self.assertEqual(suggestions_payload["mode"], "judge")
            self.assertFalse(suggestions_payload["diagnosis_only"])
            self.assertTrue(
                any(
                    item["title"] == "Add token budget checkpoints"
                    and item["category"] == "token"
                    and item["fact_refs"] == [cited_fact_id]
                    and item["evidence_refs"] == ([cited_trace_ref] if cited_trace_ref else [])
                    for item in suggestions_payload["suggestions"]
                )
            )
            self.assertFalse(
                any(
                    cited_fact_id in item["evidence_refs"]
                    for item in suggestions_payload["suggestions"]
                )
            )
            report = (out_dir / "postmortem-report.md").read_text(encoding="utf-8")
            self.assertIn("Judge found token workflow improvements.", report)
            self.assertIn("Add token budget checkpoints", report)
            self.assertIn("`token`", report)
            self.assertIn(f"Fact refs: {cited_fact_id}", report)

    def test_postmortem_judge_diagnosis_only_overrides_local_suggestions(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            trace_path = self.write_session_log(
                root,
                "trace.jsonl",
                session_id="judge-diagnosis-only",
                timestamp="2026-06-03T00:00:00.000Z",
                cwd="/repo/current",
                entries=[
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "function_call",
                            "name": "exec_command",
                            "call_id": "call-1",
                            "arguments": json.dumps(
                                {"cmd": "./bin/core8 data trpc call --router personnel"}
                            ),
                        },
                    },
                    {
                        "type": "response_item",
                        "payload": {
                            "type": "function_call_output",
                            "call_id": "call-1",
                            "output": (
                                "Process exited with code 1\n"
                                "personnel.hireDate: Expected date, received string"
                            ),
                        },
                    },
                ],
            )
            out_dir = root / "artifacts"

            def diagnosis_only_judge(
                _facts_path: Path,
                _output_dir: Path,
                _model: str,
            ) -> dict[str, object]:
                return {
                    "summary": "Judge found the evidence too weak for recommendations.",
                    "diagnosis_only": True,
                    "dimension_scores": {
                        name: {"score": 1, "rationale": "weak evidence"}
                        for name in MODULE.DIMENSION_NAMES
                    },
                    "breakdowns": [],
                    "patches": [],
                }

            original_argv = sys.argv
            original_judge = MODULE.run_postmortem_judge
            MODULE.run_postmortem_judge = diagnosis_only_judge
            sys.argv = [
                "analyze.py",
                "--postmortem",
                "--trace",
                str(trace_path),
                "--out-dir",
                str(out_dir),
            ]
            try:
                exit_code = MODULE.main()
            finally:
                sys.argv = original_argv
                MODULE.run_postmortem_judge = original_judge

            self.assertEqual(exit_code, 0)
            suggestions_payload = json.loads(
                (out_dir / "postmortem-suggestions.json").read_text(encoding="utf-8")
            )
            self.assertEqual(suggestions_payload["mode"], "judge")
            self.assertTrue(suggestions_payload["diagnosis_only"])
            self.assertEqual(suggestions_payload["suggestions"], [])

    def test_append_trace_source_to_rerun_command_preserves_source_variants(self) -> None:
        cases = [
            (
                argparse.Namespace(session_id="abc123", log=None, trace=None),
                ["--session-id", "abc123"],
            ),
            (
                argparse.Namespace(session_id=None, log="/tmp/session.jsonl", trace=None),
                ["--log", str(Path("/tmp/session.jsonl").resolve())],
            ),
            (
                argparse.Namespace(session_id=None, log=None, trace="/tmp/trace.jsonl"),
                ["--trace", str(Path("/tmp/trace.jsonl").resolve())],
            ),
            (
                argparse.Namespace(session_id=None, log=None, trace=None),
                ["--log", "/tmp/discovered.jsonl"],
            ),
        ]

        for args, expected_tail in cases:
            with self.subTest(expected_tail=expected_tail):
                command = ["python3", "analyze.py", "--postmortem"]

                MODULE.append_trace_source_to_rerun_command(
                    command,
                    args,
                    Path("/tmp/discovered.jsonl"),
                )

                self.assertEqual(command[-2:], expected_tail)

    def test_extract_postmortem_facts_categorizes_tool_failure(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 1},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "./bin/core8 data trpc call --router personnel",
                    "output": "personnel.hireDate: Expected date, received string",
                    "exit_code": 1,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertTrue(any(fact.category == "tool" for fact in facts))
        self.assertTrue(any("Expected date" in fact.snippet for fact in facts))
        self.assertTrue(all(fact.kind == "observed" for fact in facts))

    def test_extract_postmortem_facts_matches_expected_date_without_received_string(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "./bin/core8 data trpc call --router personnel",
                    "output": "personnel.hireDate: Expected date",
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertTrue(any(fact.category == "tool" for fact in facts))
        self.assertTrue(any("Expected date" in fact.snippet for fact in facts))

    def test_extract_postmortem_facts_captures_chained_reader_and_expected_date_command(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "sed -n '1,20p' notes.txt && ./bin/core8 data trpc call",
                    "output": "personnel.hireDate: Expected date",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertIn("Expected date", facts[0].snippet)

    def test_extract_postmortem_facts_does_not_treat_zero_failed_success_as_tool_failure(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "pytest",
                    "output": "100 passed, 0 failed",
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertTrue(
            any(
                fact.category == "workflow" and fact.title == "Low-signal postmortem"
                for fact in facts
            )
        )

    def test_extract_postmortem_facts_ignores_successful_search_output_matches(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": 'rg "Expected date" skills/improve-codex-skills',
                    "output": 'skills/improve-codex-skills/__tests__/test_analyze.py: "Expected date"',
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_wrapped_successful_search_output_matches(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": 'bash -lc \'rg "Expected date" skills/improve-codex-skills\'',
                    "output": 'skills/improve-codex-skills/__tests__/test_analyze.py: "Expected date"',
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_env_shell_wrapped_search_output_matches(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": 'env PYTHONPATH=. bash -lc \'rg "Expected date" skills/improve-codex-skills\'',
                    "output": 'skills/improve-codex-skills/__tests__/test_analyze.py: "Expected date"',
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_optioned_shell_wrapped_search_output_matches(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": 'bash -o pipefail -lc \'rg "Expected date" skills/improve-codex-skills\'',
                    "output": 'skills/improve-codex-skills/__tests__/test_analyze.py: "Expected date"',
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_strict_shell_wrapped_search_output_matches(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": 'bash -euo pipefail -c \'rg "Expected date" skills/improve-codex-skills\'',
                    "output": 'skills/improve-codex-skills/__tests__/test_analyze.py: "Expected date"',
                    "exit_code": 0,
                },
                {
                    "ref": "turn-1.command-2",
                    "command": 'bash -euxo pipefail -c \'rg "Expected date" skills/improve-codex-skills\'',
                    "output": 'skills/improve-codex-skills/__tests__/test_analyze.py: "Expected date"',
                    "exit_code": 0,
                },
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_assignment_prefixed_search_output_matches(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": 'PYTHONPATH=. rg "Expected date" skills/improve-codex-skills',
                    "output": 'skills/improve-codex-skills/__tests__/test_analyze.py: "Expected date"',
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_chained_setup_search_output_matches(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": 'bash -lc \'mkdir -p tmp && rg "Expected date" skills/improve-codex-skills\'',
                    "output": 'skills/improve-codex-skills/__tests__/test_analyze.py: "Expected date"',
                    "exit_code": 0,
                },
                {
                    "ref": "turn-1.command-2",
                    "command": 'bash -lc \'set -e; rg "blocked:" notes.txt\'',
                    "output": "blocked: appears in a fixture",
                    "exit_code": 0,
                },
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_bat_reader_output_matches(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "bat skills/improve-codex-skills/__tests__/test_analyze.py",
                    "output": 'self.assertIn("Expected date", fact.snippet)',
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_wc_reader_output_matches(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "wc -l notes.txt",
                    "output": "Expected date  notes.txt",
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_reader_status_text_output_matches(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "sed -n '1,80p' notes.txt",
                    "output": "blocked: missing credentials",
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_search_no_match_exit(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 1},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": 'rg "not-present" skills/improve-codex-skills',
                    "output": "",
                    "exit_code": 1,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_captures_search_error_empty_output(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 1},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": 'rg "(" notes.txt 2>/dev/null',
                    "output": "",
                    "exit_code": 2,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")

    def test_extract_postmortem_facts_ignores_search_no_match_wrapper_output(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 1},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": 'rg "not-present" skills/improve-codex-skills',
                    "output": "Process exited with code 1",
                    "exit_code": 1,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_search_no_match_wrapper_metadata(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 1},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": 'rg "not-present" skills/improve-codex-skills',
                    "output": (
                        "Chunk ID: abc123\n"
                        "Process exited with code 1\n"
                        "Original token count: 0\n"
                        "Output:"
                    ),
                    "exit_code": 1,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_captures_search_wrapper_real_error_output(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 1},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": 'rg "Expected date" missing.txt',
                    "output": (
                        "Chunk ID: abc123\n"
                        "Process exited with code 1\n"
                        "Original token count: 8\n"
                        "Output:\n"
                        "rg: missing.txt: No such file or directory"
                    ),
                    "exit_code": 1,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")
        self.assertEqual(facts[0].evidence_ref, "turn-1.command-1")
        self.assertIn("No such file", facts[0].snippet)

    def test_extract_postmortem_facts_ignores_git_grep_reader_output_matches(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": 'git grep "Expected date"',
                    "output": 'skills/improve-codex-skills/__tests__/test_analyze.py: "Expected date"',
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_cd_wrapped_search_output_matches(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": 'bash -lc \'cd /repo && rg "Expected date" skills\'',
                    "output": 'skills/improve-codex-skills/__tests__/test_analyze.py: "Expected date"',
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_semicolon_cd_wrapped_search_output_matches(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": 'bash -lc \'cd /repo; rg "Expected date" skills\'',
                    "output": 'skills/improve-codex-skills/__tests__/test_analyze.py: "Expected date"',
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_bash_c_dash_dash_search_output_matches(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": 'bash -c -- \'rg "Expected date" notes.txt\'',
                    "output": "notes.txt: Expected date",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_sh_c_dash_dash_search_output_matches(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": 'sh -c -- \'grep "blocked:" notes.txt\'',
                    "output": "blocked: appears in a fixture",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_compact_semicolon_cd_wrapped_rg_status_match(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": 'bash -lc \'cd /repo;rg "blocked:" notes.txt\'',
                    "output": "blocked: appears in a fixture",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_compact_semicolon_cd_wrapped_grep_status_match(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": 'bash -lc \'cd /repo;grep "blocked:" notes.txt\'',
                    "output": "blocked: appears in a fixture",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_git_c_grep_reader_output_matches(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": 'git -C /repo grep "Expected date"',
                    "output": 'skills/improve-codex-skills/__tests__/test_analyze.py: "Expected date"',
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_parallel_sibling_search_output_matches(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry("pwd", 'rg "Expected date" skills/improve-codex-skills'),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": (
                        "Process exited with code 0\n"
                        'skills/improve-codex-skills/__tests__/test_analyze.py: "Expected date"'
                    ),
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_parallel_sibling_search_no_match(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry("pwd", 'rg "not-present" skills/improve-codex-skills'),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": (
                        "Chunk ID: abc123\n"
                        "Process exited with code 1\n"
                        "Original token count: 0\n"
                        "Output:"
                    ),
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_parallel_reader_sibling_search_no_match(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry("ls fixtures", 'rg "not-present" notes.txt'),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 1\nOutput:",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_parallel_search_no_match_after_successful_sibling(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry("pwd", 'rg "not-present" notes.txt'),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 0\n/home/repo\nProcess exited with code 1\nOutput:",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_captures_parallel_shared_non_search_no_match_failure(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry("pwd", "cat missing.txt 2>/dev/null"),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 1\nOutput:",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")

    def test_extract_postmortem_facts_captures_parallel_mixed_search_no_match_and_non_search_failure(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry(
                'rg "not-present" skills/improve-codex-skills',
                "cat missing.txt 2>/dev/null",
            ),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 1\nOutput:",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")

    def test_extract_postmortem_facts_groups_parallel_reader_and_work_nonzero_output(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry("cat missing.txt", "node check.js"),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 1\nOutput:",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        tool_facts = [fact for fact in facts if fact.category == "tool"]
        self.assertEqual(len(tool_facts), 1)
        self.assertEqual(tool_facts[0].evidence_ref, "turn-1.tool-1")
        self.assertIn("multi_tool_use.parallel", tool_facts[0].snippet)
        self.assertNotIn("node check.js", tool_facts[0].snippet)

    def test_extract_postmortem_facts_captures_parallel_search_no_match_and_work_failure(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry(
                'rg "not-present" skills/improve-codex-skills',
                "./bin/core8 workflow run",
            ),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 1\nOutput:",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        tool_facts = [fact for fact in facts if fact.category == "tool"]
        self.assertEqual(len(tool_facts), 1)
        self.assertEqual(tool_facts[0].evidence_ref, "turn-1.tool-1")
        self.assertEqual(tool_facts[0].title, "Tool call failure or blocker")
        self.assertIn("multi_tool_use.parallel", tool_facts[0].snippet)

    def test_extract_postmortem_facts_captures_parallel_shared_output_blocker(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry("pwd", "git status --short"),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 0\nOutput:\nblocked: missing credentials",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")
        self.assertEqual(facts[0].severity, "high")

    def test_extract_postmortem_facts_captures_parallel_reader_plus_non_reader_blocker(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry("sed -n '1,20p' notes.txt", "node check.js"),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 0\nOutput:\nblocked: missing credentials",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        tool_facts = [fact for fact in facts if fact.category == "tool"]
        self.assertEqual(len(tool_facts), 1)
        self.assertEqual(tool_facts[0].evidence_ref, "turn-1.command-2")
        self.assertIn("node [HOST]", tool_facts[0].snippet)
        self.assertNotIn("pwd", tool_facts[0].snippet)
        self.assertTrue(any("blocked: missing credentials" in fact.snippet for fact in facts))

    def test_extract_postmortem_facts_captures_parallel_reader_plus_plain_blocker(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry("sed -n '1,20p' notes.txt", "node check.js"),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 0\nOutput:\nblocked: waiting on vendor API",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len([fact for fact in facts if fact.category == "tool"]), 1)
        self.assertTrue(any("blocked: waiting on vendor API" in fact.snippet for fact in facts))

    def test_extract_postmortem_facts_captures_parallel_later_sibling_nonzero_exit(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry('rg "Expected date" skills/improve-codex-skills', "node check.js"),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": (
                        "Process exited with code 0\n"
                        'skills/improve-codex-skills/__tests__/test_analyze.py: "Expected date"\n'
                        "Process exited with code 2\n"
                        "node: check.js not found"
                    ),
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        tool_facts = [fact for fact in facts if fact.category == "tool"]
        self.assertEqual(len(tool_facts), 1)
        self.assertEqual(tool_facts[0].evidence_ref, "turn-1.tool-1")
        self.assertIn("multi_tool_use.parallel", tool_facts[0].snippet)
        self.assertNotIn('rg "Expected date"', tool_facts[0].snippet)

    def test_extract_postmortem_facts_captures_parallel_later_nonzero_after_plain_search(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry('rg "present" notes.txt', "node check.js"),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": (
                        "Process exited with code 0\n"
                        "notes.txt:present\n"
                        "Process exited with code 2\n"
                        "node: check.js not found"
                    ),
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        tool_facts = [fact for fact in facts if fact.category == "tool"]
        self.assertEqual(len(tool_facts), 1)
        self.assertEqual(tool_facts[0].evidence_ref, "turn-1.tool-1")
        self.assertIn("multi_tool_use.parallel", tool_facts[0].snippet)
        self.assertNotIn('rg "present"', tool_facts[0].snippet)

    def test_extract_postmortem_facts_deduplicates_parallel_shared_nonzero_output(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry("pwd", "node missing-script.js"),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 2\nOutput:\nnode: missing-script.js not found",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        tool_facts = [fact for fact in facts if fact.category == "tool"]
        self.assertEqual(len(tool_facts), 1)
        self.assertEqual(tool_facts[0].evidence_ref, "turn-1.command-2")
        self.assertIn("node [HOST]", tool_facts[0].snippet)
        self.assertNotIn("pwd", tool_facts[0].snippet)

    def test_extract_postmortem_facts_groups_ambiguous_parallel_work_failures(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry("node scripts/check-ok.js", "node scripts/check-missing.js"),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 2\nOutput:\nnode: scripts/check-missing.js not found",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        tool_facts = [fact for fact in facts if fact.category == "tool"]
        self.assertEqual(len(tool_facts), 1)
        self.assertEqual(tool_facts[0].evidence_ref, "turn-1.tool-1")
        self.assertIn("multi_tool_use.parallel", tool_facts[0].snippet)
        self.assertNotIn("node scripts/check-ok.js", tool_facts[0].snippet)

    def test_extract_postmortem_facts_ignores_parallel_search_output_status_text_matches(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry("pwd", 'rg "blocked:" skills/improve-codex-skills'),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": (
                        "Process exited with code 0\n"
                        "Output:\n"
                        'skills/improve-codex-skills/__tests__/test_analyze.py: "blocked:"'
                    ),
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_unqualified_parallel_search_no_match(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry_with_recipient("exec_command", 'rg "not-present" notes.txt'),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 1\nOutput:",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_parallel_no_heading_search_status_text_matches(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry("pwd", 'rg --no-heading "blocked:" notes.txt'),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 0\nOutput:\nblocked: appears in a fixture",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_parallel_search_output_specific_signal(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry("node -e 'console.log(1)'", 'rg "Expected date" notes.txt'),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 0\nOutput:\nnotes.txt: Expected date",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_captures_path_prefixed_direct_signal_with_core8_sibling(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry('rg "Expected date" notes.txt', "./bin/core8 data trpc call"),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 0\nOutput:\nnotes.txt: Expected date",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")
        self.assertEqual(facts[0].evidence_ref, "turn-1.command-2")
        self.assertIn("Expected date", facts[0].snippet)

    def test_extract_postmortem_facts_ignores_quoted_search_regex_alternation_output(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": 'rg "blocked|failed" notes.txt',
                    "output": "blocked: appears in a fixture",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_search_output_piped_to_tee(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": 'rg "Expected date" notes.txt | tee /tmp/out',
                    "output": "notes.txt: Expected date",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_search_output_piped_to_jq(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": 'rg "blocked:" notes.txt | jq -R .',
                    "output": '"blocked: appears in a fixture"',
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_quoted_search_regex_pipe_command_word_output(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": 'rg "Expected date|node" notes.txt',
                    "output": "notes.txt: Expected date",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_quoted_search_regex_semicolon_output(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": 'rg "blocked;failed" notes.txt',
                    "output": "blocked: appears in a fixture",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_quoted_search_regex_semicolon_command_word_output(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": 'rg "blocked;python3" notes.txt',
                    "output": "blocked: appears in a fixture",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_find_inspection_output_matches(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": 'find . -name "*Expected date*"',
                    "output": "./fixtures/Expected date sample.txt",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_ls_inspection_output_matches(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "ls fixtures",
                    "output": "Expected date sample.txt",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_captures_parallel_search_plus_status_blocker(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry('rg "blocked:" notes.txt', "./bin/core8 workflow status"),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 0\nOutput:\nblocked: waiting on vendor API",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")
        self.assertEqual(facts[0].evidence_ref, "turn-1.command-2")
        self.assertIn("blocked: waiting on vendor API", facts[0].snippet)

    def test_extract_postmortem_facts_captures_parallel_search_plus_work_specific_signal(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry('rg "Expected date" notes.txt', "./bin/core8 data trpc call"),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 0\nOutput:\npersonnel.hireDate: Expected date",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")
        self.assertEqual(facts[0].evidence_ref, "turn-1.command-2")
        self.assertIn("Expected date", facts[0].snippet)

    def test_extract_postmortem_facts_captures_parallel_expected_date_signal(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry("./bin/core8 data trpc call"),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 0\nOutput:\npersonnel.hireDate: Expected date",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len([fact for fact in facts if fact.category == "tool"]), 1)
        self.assertTrue(any("Expected date" in fact.snippet for fact in facts))

    def test_extract_postmortem_facts_captures_parallel_plain_work_direct_signal(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry("node check.js"),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 0\nOutput:\npersonnel.hireDate: Expected date",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")
        self.assertEqual(facts[0].evidence_ref, "turn-1.command-1")

    def test_extract_postmortem_facts_captures_parallel_reviewer_findings(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry("codex-review-adapter"),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 0\nOutput:\nFindings:\n[P1] Missing workflow guard",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len([fact for fact in facts if fact.category == "tool"]), 1)
        self.assertTrue(any("[P1] Missing workflow guard" in fact.snippet for fact in facts))

    def test_extract_postmortem_facts_captures_parallel_markdown_bullet_reviewer_findings(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry("codex-review-adapter"),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": "Process exited with code 0\nOutput:\nFindings:\n- [P1] Missing workflow guard",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len([fact for fact in facts if fact.category == "tool"]), 1)
        self.assertTrue(any("[P1] Missing workflow guard" in fact.snippet for fact in facts))

    def test_extract_postmortem_facts_ignores_parallel_zero_count_status_summary(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            self.parallel_exec_entry("sed -n '1,20p' notes.txt", "./bin/core8 workflow status"),
            {
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "",
                    "output": (
                        "Process exited with code 0\n"
                        "Output:\n"
                        "failed: 0, skipped: 0\n"
                        "blocked: 0, waiting: 0"
                    ),
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_captures_silent_nonzero_reader_failure(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 1},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "sed -n '1,20p' missing.txt 2>/dev/null",
                    "output": "",
                    "exit_code": 2,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")
        self.assertEqual(facts[0].evidence_ref, "turn-1.command-1")

    def test_extract_postmortem_facts_categorizes_plain_nonzero_command(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 1},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "./bin/core8 workflow run",
                    "output": "Process exited with code 1",
                    "exit_code": 1,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")
        self.assertEqual(facts[0].severity, "medium")
        self.assertEqual(facts[0].evidence_ref, "turn-1.command-1")

    def test_extract_postmortem_facts_captures_reader_and_status_without_separator_spaces(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "sed -n '1,20p' notes.txt&&./bin/core8 workflow status",
                    "output": "blocked: missing credentials",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertIn("blocked: missing credentials", facts[0].snippet)

    def test_extract_postmortem_facts_captures_reader_and_status_without_semicolon_space(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "sed -n '1,20p' notes.txt;./bin/core8 workflow status",
                    "output": "blocked: missing credentials",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertIn("blocked: missing credentials", facts[0].snippet)

    def test_extract_postmortem_facts_captures_reader_and_status_without_pipe_space(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "cat notes.txt|./bin/core8 workflow status",
                    "output": "blocked: missing credentials",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertIn("blocked: missing credentials", facts[0].snippet)

    def test_extract_postmortem_facts_captures_reader_and_bare_executable_without_pipe_space(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "cat notes.txt|node scripts/check.js",
                    "output": "blocked: missing credentials",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertIn("blocked: missing credentials", facts[0].snippet)

    def test_extract_postmortem_facts_captures_reader_and_bun_without_pipe_space(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "cat notes.txt|bun test",
                    "output": "blocked: missing credentials",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertIn("blocked: missing credentials", facts[0].snippet)

    def test_extract_postmortem_facts_captures_reader_and_node_without_semicolon_space(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "cat notes.txt;node scripts/check.js",
                    "output": "blocked: missing credentials",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertIn("blocked: missing credentials", facts[0].snippet)

    def test_extract_postmortem_facts_captures_reader_and_python_without_semicolon_space(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "cat notes.txt;python3 scripts/check.py",
                    "output": "blocked: missing credentials",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertIn("blocked: missing credentials", facts[0].snippet)

    def test_extract_postmortem_facts_ignores_zero_exit_failed_count_summary(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "pytest --summary",
                    "output": "passed: 100\nfailed: 0",
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_contextual_zero_count_status_summary(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "validator --summary",
                    "output": "Summary: failed: 0, skipped: 0, blocked: 0\nTests failed: 0",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_inline_zero_count_status_summary(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "validator --summary",
                    "output": "failed: 0, skipped: 0\nblocked: 0, waiting: 0",
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_captures_zero_count_summary_with_actionable_failure(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "./bin/core8 workflow status",
                    "output": "failed: 0, blocked: 0, failed to load config",
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        tool_facts = [fact for fact in facts if fact.category == "tool"]
        self.assertEqual(len(tool_facts), 1)
        self.assertEqual(tool_facts[0].title, "Command or tool path failed")
        self.assertIn("failed to load config", tool_facts[0].snippet)

    def test_extract_postmortem_facts_captures_mixed_zero_count_and_blocker_status(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "./bin/core8 workflow status",
                    "output": "failed: 0\nblocked: waiting on vendor API",
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertIn("blocked: waiting", facts[0].snippet)

    def test_extract_postmortem_facts_captures_chained_reader_and_status_command(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "sed -n '1,20p' notes.txt && ./bin/core8 workflow status",
                    "output": "blocked: missing credentials",
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")
        self.assertIn("blocked: missing credentials", facts[0].snippet)

    def test_extract_postmortem_facts_captures_chained_reader_and_reviewer_findings(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "sed -n '1,20p' notes.txt && codex-review-adapter",
                    "output": "Findings:\n[P1] Missing workflow guard",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertIn("[P1] Missing workflow guard", facts[0].snippet)

    def test_extract_postmortem_facts_categorizes_zero_exit_blocker_status(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "./bin/core8 workflow status",
                    "output": "blocked: missing credentials",
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")
        self.assertEqual(facts[0].severity, "high")
        self.assertEqual(facts[0].evidence_ref, "turn-1.command-1")
        self.assertIn("blocked: missing credentials", facts[0].snippet)

    def test_extract_postmortem_facts_categorizes_zero_exit_blocked_by_status(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "./bin/core8 workflow status",
                    "output": "blocked by missing credentials",
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")
        self.assertEqual(facts[0].severity, "high")
        self.assertEqual(facts[0].evidence_ref, "turn-1.command-1")

    def test_extract_postmortem_facts_categorizes_zero_exit_failed_to_status(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "./bin/core8 workflow status",
                    "output": "failed to load skill: missing SKILL.md",
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")
        self.assertEqual(facts[0].severity, "high")
        self.assertEqual(facts[0].evidence_ref, "turn-1.command-1")

    def test_extract_postmortem_facts_categorizes_zero_exit_missing_output(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "./bin/core8 workflow status",
                    "output": "missing credentials for environment",
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")

    def test_extract_postmortem_facts_categorizes_missing_resource_after_zero_missing_summary(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "./bin/core8 workflow validate",
                    "output": "0 missing files\nmissing credentials",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")
        self.assertIn("missing credentials", facts[0].snippet)

    def test_extract_postmortem_facts_categorizes_missing_resource_after_no_missing_clause(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "./bin/core8 workflow validate",
                    "output": "No missing files, missing credentials",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")
        self.assertIn("missing credentials", facts[0].snippet)

    def test_extract_postmortem_facts_categorizes_missing_resource_after_no_missing_colon(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "./bin/core8 workflow validate",
                    "output": "No missing files: missing credentials",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")
        self.assertIn("missing credentials", facts[0].snippet)

    def test_extract_postmortem_facts_categorizes_missing_resource_after_zero_missing_dash(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "./bin/core8 workflow validate",
                    "output": "0 missing files - missing credentials",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")
        self.assertIn("missing credentials", facts[0].snippet)

    def test_extract_postmortem_facts_categorizes_missing_resource_after_no_missing_but(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "./bin/core8 workflow validate",
                    "output": "No missing files but credentials missing",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")
        self.assertIn("credentials missing", facts[0].snippet)

    def test_extract_postmortem_facts_categorizes_redacted_missing_file_output(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "./bin/core8 workflow validate",
                    "output": "missing [HOST]",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")

    def test_extract_postmortem_facts_categorizes_colon_missing_file_output(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "./bin/core8 workflow validate",
                    "output": "missing: [HOST]",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")

    def test_extract_postmortem_facts_ignores_zero_missing_success_summary(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "validator --summary",
                    "output": "120 checked, 0 missing",
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_negated_missing_success_text(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "./bin/core8 workflow validate",
                    "output": "No missing credentials; all checks passed",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_captures_missing_after_negated_missing_clause(self) -> None:
        normalized = self.postmortem_normalized(
            commands=[
                {
                    "ref": "turn-1.command-1",
                    "command": "./bin/core8 workflow validate",
                    "output": "No missing credentials; missing schema file",
                    "exit_code": 0,
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertIn("missing schema file", facts[0].snippet)

    def test_extract_postmortem_facts_categorizes_zero_exit_reviewer_findings(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "codex-review-adapter",
                    "output": "Findings:\n[P1] Missing workflow guard",
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Command or tool path failed")

    def test_extract_postmortem_facts_categorizes_non_shell_tool_call_blocker(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [
                {
                    "ref": "turn-1.tool-1",
                    "name": "mcp.example.call",
                    "arguments": {"input": "value"},
                    "output": "status: failed because the project is missing credentials",
                }
            ],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Tool call failure or blocker")
        self.assertEqual(facts[0].severity, "high")
        self.assertEqual(facts[0].evidence_ref, "turn-1.tool-1")
        self.assertIn("status: failed", facts[0].snippet)

    def test_extract_postmortem_facts_categorizes_parallel_non_exec_tool_call_blocker(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [
                {
                    "ref": "turn-1.tool-1",
                    "name": "multi_tool_use.parallel",
                    "arguments": {
                        "tool_uses": [
                            {
                                "recipient_name": "mcp.example.call",
                                "parameters": {"input": "value"},
                            }
                        ]
                    },
                    "output": "status: failed because the resource is missing credentials",
                }
            ],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Tool call failure or blocker")
        self.assertEqual(facts[0].severity, "high")
        self.assertEqual(facts[0].evidence_ref, "turn-1.tool-1")

    def test_extract_postmortem_facts_categorizes_mixed_parallel_non_exec_tool_call_blocker(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "tool_name": "multi_tool_use.parallel",
                    "command": "pwd",
                    "output": "status: failed because the resource is missing credentials",
                    "exit_code": 0,
                    "shared_output": True,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [
                {
                    "ref": "turn-1.tool-1",
                    "name": "multi_tool_use.parallel",
                    "arguments": {
                        "tool_uses": [
                            {
                                "recipient_name": "functions.exec_command",
                                "parameters": {"cmd": "pwd"},
                            },
                            {
                                "recipient_name": "mcp.example.call",
                                "parameters": {"input": "value"},
                            },
                        ]
                    },
                    "output": "status: failed because the resource is missing credentials",
                }
            ],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        tool_facts = [fact for fact in facts if fact.category == "tool"]
        self.assertEqual(len(tool_facts), 1)
        self.assertEqual(tool_facts[0].title, "Tool call failure or blocker")
        self.assertEqual(tool_facts[0].evidence_ref, "turn-1.tool-1")

    def test_extract_postmortem_facts_categorizes_mixed_parallel_work_and_non_exec_tool_call_blocker(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "tool_name": "multi_tool_use.parallel",
                    "command": "node check.js",
                    "output": "status: failed because the resource is missing credentials",
                    "exit_code": 0,
                    "shared_output": True,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [
                {
                    "ref": "turn-1.tool-1",
                    "name": "multi_tool_use.parallel",
                    "arguments": {
                        "tool_uses": [
                            {
                                "recipient_name": "functions.exec_command",
                                "parameters": {"cmd": "node check.js"},
                            },
                            {
                                "recipient_name": "mcp.example.call",
                                "parameters": {"input": "value"},
                            },
                        ]
                    },
                    "output": "status: failed because the resource is missing credentials",
                }
            ],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        tool_facts = [fact for fact in facts if fact.category == "tool"]
        self.assertEqual(len(tool_facts), 1)
        self.assertEqual(tool_facts[0].title, "Tool call failure or blocker")
        self.assertEqual(tool_facts[0].evidence_ref, "turn-1.tool-1")
        self.assertNotIn("node check.js", tool_facts[0].snippet)

    def test_extract_postmortem_facts_ignores_non_shell_tool_call_failed_zero_summary(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [
                {
                    "ref": "turn-1.tool-1",
                    "name": "mcp.example.call",
                    "arguments": {"input": "value"},
                    "output": "failed: 0",
                }
            ],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_non_shell_tool_call_inline_zero_summary(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [
                {
                    "ref": "turn-1.tool-1",
                    "name": "mcp.example.call",
                    "arguments": {"input": "value"},
                    "output": "failed: 0, skipped: 0\nblocked: 0, waiting: 0",
                }
            ],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_non_shell_tool_call_zero_missing_summary(self) -> None:
        normalized = self.postmortem_normalized(
            tool_calls=[
                {
                    "ref": "turn-1.tool-1",
                    "name": "mcp.example.call",
                    "arguments": {"input": "value"},
                    "output": "Summary: 0 missing",
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_non_shell_tool_call_no_missing_summary(self) -> None:
        normalized = self.postmortem_normalized(
            tool_calls=[
                {
                    "ref": "turn-1.tool-1",
                    "name": "mcp.example.call",
                    "arguments": {"input": "value"},
                    "output": "No missing dependencies",
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_non_shell_tool_call_required_success_summaries(self) -> None:
        for output in (
            "No changes required",
            "0 required changes",
            "All required checks passed",
        ):
            with self.subTest(output=output):
                normalized = self.postmortem_normalized(
                    tool_calls=[
                        {
                            "ref": "turn-1.tool-1",
                            "name": "mcp.example.call",
                            "arguments": {"input": "value"},
                            "output": output,
                        }
                    ]
                )

                facts = MODULE.extract_postmortem_facts(normalized)

                self.assertEqual(len(facts), 1)
                self.assertFalse(any(fact.category == "tool" for fact in facts))
                self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_categorizes_non_shell_tool_call_no_missing_then_no_such_file(self) -> None:
        normalized = self.postmortem_normalized(
            tool_calls=[
                {
                    "ref": "turn-1.tool-1",
                    "name": "functions.view_image",
                    "arguments": {"path": "/tmp/missing.png"},
                    "output": "No missing files; No such file: /tmp/missing.png",
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Tool call failure or blocker")

    def test_extract_postmortem_facts_categorizes_non_shell_tool_call_zero_missing_then_invalid_option(self) -> None:
        normalized = self.postmortem_normalized(
            tool_calls=[
                {
                    "ref": "turn-1.tool-1",
                    "name": "mcp.example.call",
                    "arguments": {"mode": "bad"},
                    "output": "zero missing dependencies; Invalid option --mode",
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Tool call failure or blocker")

    def test_extract_postmortem_facts_categorizes_normalized_trace_error(self) -> None:
        normalized = {
            "format": "exec_json",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "errors": [
                {
                    "ref": "turn-1.error-1",
                    "message": "failed to load skill: missing SKILL.md",
                }
            ],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Trace error event")
        self.assertEqual(facts[0].severity, "high")
        self.assertEqual(facts[0].evidence_ref, "turn-1.error-1")

    def test_extract_postmortem_facts_categorizes_exec_json_tool_output_blocker(self) -> None:
        events = [
            {"type": "turn.started"},
            {
                "type": "item.completed",
                "item": {
                    "type": "mcp.example.call",
                    "input": {"value": "abc"},
                    "output": "status: failed because the project is missing credentials",
                },
            },
            {"type": "turn.completed"},
        ]
        normalized = MODULE.normalize_trace(events, "exec_json")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Tool call failure or blocker")
        self.assertEqual(facts[0].evidence_ref, "turn-1.tool-1")

    def test_extract_postmortem_facts_categorizes_exec_json_result_output_blocker(self) -> None:
        events = [
            {"type": "turn.started"},
            {
                "type": "item.completed",
                "item": {
                    "type": "mcp.example.call",
                    "input": {"value": "abc"},
                    "result": {"output": "status: failed because the project is missing credentials"},
                },
            },
            {"type": "turn.completed"},
        ]
        normalized = MODULE.normalize_trace(events, "exec_json")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Tool call failure or blocker")
        self.assertEqual(facts[0].evidence_ref, "turn-1.tool-1")

    def test_extract_postmortem_facts_categorizes_non_shell_tool_call_failed_status_text(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [
                {
                    "ref": "turn-1.tool-1",
                    "name": "mcp.example.call",
                    "arguments": {"input": "value"},
                    "output": "failed: the project is missing credentials",
                }
            ],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Tool call failure or blocker")
        self.assertEqual(facts[0].severity, "high")
        self.assertEqual(facts[0].evidence_ref, "turn-1.tool-1")
        self.assertIn("failed:", facts[0].snippet)

    def test_extract_postmortem_facts_categorizes_non_shell_tool_call_reviewer_findings(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [
                {
                    "ref": "turn-1.tool-1",
                    "name": "reviewer.example",
                    "arguments": {"input": "value"},
                    "output": "Findings:\n[P2] Missing evidence reference",
                }
            ],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Tool call failure or blocker")

    def test_extract_postmortem_facts_categorizes_non_shell_tool_call_no_such_file_output(self) -> None:
        normalized = self.postmortem_normalized(
            tool_calls=[
                {
                    "ref": "turn-1.tool-1",
                    "name": "functions.view_image",
                    "arguments": {"path": "/tmp/missing.png"},
                    "output": "No such file: /tmp/missing.png",
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Tool call failure or blocker")

    def test_extract_postmortem_facts_categorizes_non_shell_tool_call_missing_output(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [
                {
                    "ref": "turn-1.tool-1",
                    "name": "mcp.example.call",
                    "arguments": {"input": "value"},
                    "output": "missing credentials for environment",
                }
            ],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")
        self.assertEqual(facts[0].title, "Tool call failure or blocker")

    def test_extract_postmortem_facts_ignores_non_shell_tool_call_zero_failed_summary(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [
                {
                    "ref": "turn-1.tool-1",
                    "name": "mcp.example.call",
                    "arguments": {"input": "value"},
                    "output": "100 passed, 0 failed",
                }
            ],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_non_shell_tool_call_bare_expected_date(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [
                {
                    "ref": "turn-1.tool-1",
                    "name": "mcp.example.call",
                    "arguments": {"input": "value"},
                    "output": "personnel.hireDate: Expected date",
                }
            ],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "tool" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_categorizes_lifecycle_bypass(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [
                {
                    "ref": "turn-1.assistant-1",
                    "text": "Caveats: used direct Prisma writes; bypassed pendingConfig, changeLogEvent, and reconcile.",
                }
            ],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertTrue(any(fact.category == "workflow" for fact in facts))
        self.assertTrue(any("direct Prisma" in fact.snippet for fact in facts))

    def test_extract_postmortem_facts_categorizes_direct_prisma_lifecycle_bypass_high_severity_case_insensitive(self) -> None:
        normalized = self.postmortem_normalized(
            assistant_messages=[
                {
                    "ref": "turn-1.assistant-1",
                    "text": "Caveat: used Direct Prisma writes.",
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        workflow_facts = [fact for fact in facts if fact.title == "Workflow bypass or lifecycle caveat"]
        self.assertEqual(len(workflow_facts), 1)
        self.assertEqual(workflow_facts[0].severity, "high")

    def test_extract_postmortem_facts_categorizes_bypassed_lifecycle_high_severity_case_insensitive(self) -> None:
        normalized = self.postmortem_normalized(
            assistant_messages=[
                {
                    "ref": "turn-1.assistant-1",
                    "text": "Caveat: Bypassed pendingConfig.",
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        workflow_facts = [fact for fact in facts if fact.title == "Workflow bypass or lifecycle caveat"]
        self.assertEqual(len(workflow_facts), 1)
        self.assertEqual(workflow_facts[0].severity, "high")

    def test_extract_postmortem_facts_scopes_lifecycle_severity_after_negated_direct_prisma(self) -> None:
        normalized = self.postmortem_normalized(
            assistant_messages=[
                {
                    "ref": "turn-1.assistant-1",
                    "text": "I did not use direct Prisma. Caveat: missing reconcile step.",
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        workflow_facts = [fact for fact in facts if fact.title == "Workflow bypass or lifecycle caveat"]
        self.assertEqual(len(workflow_facts), 1)
        self.assertEqual(workflow_facts[0].severity, "medium")

    def test_extract_postmortem_facts_scopes_lifecycle_severity_after_negated_bypass(self) -> None:
        normalized = self.postmortem_normalized(
            assistant_messages=[
                {
                    "ref": "turn-1.assistant-1",
                    "text": "I did not bypass pendingConfig. Caveat: missing reconcile step.",
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        workflow_facts = [fact for fact in facts if fact.title == "Workflow bypass or lifecycle caveat"]
        self.assertEqual(len(workflow_facts), 1)
        self.assertEqual(workflow_facts[0].severity, "medium")

    def test_extract_postmortem_facts_categorizes_lifecycle_bypass_after_sentence_scoped_negation(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [
                {
                    "ref": "turn-1.assistant-1",
                    "text": (
                        "I did not use direct Prisma in the first attempt. "
                        "Caveat: bypassed pendingConfig during final import."
                    ),
                }
            ],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertTrue(any(fact.category == "workflow" for fact in facts))
        self.assertTrue(any("bypassed pendingConfig" in fact.snippet for fact in facts))

    def test_extract_postmortem_facts_categorizes_lifecycle_use_after_comma_then_negation(self) -> None:
        normalized = self.postmortem_normalized(
            assistant_messages=[
                {
                    "ref": "turn-1.assistant-1",
                    "text": (
                        "I did not use direct Prisma in the first attempt, "
                        "then used direct Prisma writes in the final fallback."
                    ),
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertTrue(any(fact.category == "workflow" for fact in facts))
        self.assertTrue(any("used direct Prisma writes" in fact.snippet for fact in facts))

    def test_extract_postmortem_facts_categorizes_lifecycle_use_after_and_then_negation(self) -> None:
        normalized = self.postmortem_normalized(
            assistant_messages=[
                {
                    "ref": "turn-1.assistant-1",
                    "text": (
                        "I did not use direct Prisma initially and then used direct Prisma "
                        "writes in the final fallback."
                    ),
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertTrue(any(fact.category == "workflow" for fact in facts))
        self.assertTrue(any("used direct Prisma writes" in fact.snippet for fact in facts))

    def test_extract_postmortem_facts_categorizes_lifecycle_bypass_after_same_sentence_negation(self) -> None:
        normalized = self.postmortem_normalized(
            assistant_messages=[
                {
                    "ref": "turn-1.assistant-1",
                    "text": "I did not use direct Prisma, but I bypassed pendingConfig during import.",
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertTrue(any(fact.category == "workflow" for fact in facts))
        self.assertTrue(any("bypassed pendingConfig" in fact.snippet for fact in facts))

    def test_extract_postmortem_facts_categorizes_lifecycle_bypass_after_comma_and_negation(self) -> None:
        normalized = self.postmortem_normalized(
            assistant_messages=[
                {
                    "ref": "turn-1.assistant-1",
                    "text": "I did not use direct Prisma, and I bypassed pendingConfig during import.",
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        workflow_facts = [fact for fact in facts if fact.title == "Workflow bypass or lifecycle caveat"]
        self.assertEqual(len(workflow_facts), 1)
        self.assertEqual(workflow_facts[0].severity, "high")
        self.assertIn("bypassed pendingConfig", workflow_facts[0].snippet)

    def test_extract_postmortem_facts_categorizes_lifecycle_caveat_after_newline_negation(self) -> None:
        normalized = self.postmortem_normalized(
            assistant_messages=[
                {
                    "ref": "turn-1.assistant-1",
                    "text": "I did not use direct Prisma\nCaveat: missing reconcile step.",
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        workflow_facts = [fact for fact in facts if fact.title == "Workflow bypass or lifecycle caveat"]
        self.assertEqual(len(workflow_facts), 1)
        self.assertEqual(workflow_facts[0].severity, "medium")
        self.assertIn("missing reconcile", workflow_facts[0].snippet)

    def test_extract_postmortem_facts_categorizes_lifecycle_bypass_after_unrelated_negation(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [
                {
                    "ref": "turn-1.assistant-1",
                    "text": (
                        "I did not find a supported CLI path, so I used direct Prisma writes "
                        "and bypassed pendingConfig."
                    ),
                }
            ],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertTrue(any(fact.category == "workflow" for fact in facts))
        self.assertTrue(any("direct Prisma" in fact.snippet for fact in facts))

    def test_extract_postmortem_facts_captures_event_msg_narrative_milestone(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            {
                "type": "event_msg",
                "payload": {
                    "type": "user_message",
                    "message": "Initial goal: investigate Core8 CLI postmortem flow.",
                },
            },
            {
                "type": "event_msg",
                "payload": {
                    "type": "agent_message",
                    "message": "Phase marker: tried supported CLI path before fallback.",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)
        narrative_facts = [fact for fact in facts if fact.title == "Narrative milestone"]

        self.assertEqual(len(narrative_facts), 2)
        self.assertTrue(any("Initial goal" in fact.snippet for fact in narrative_facts))

    def test_extract_postmortem_facts_ignores_negated_lifecycle_mentions(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [
                {
                    "ref": "turn-1.assistant-1",
                    "text": "I did not use direct Prisma writes and did not bypass pendingConfig.",
                }
            ],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_contraction_lifecycle_negation(self) -> None:
        normalized = self.postmortem_normalized(
            assistant_messages=[
                {
                    "ref": "turn-1.assistant-1",
                    "text": "I didn't use direct Prisma writes for this task.",
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "workflow" and fact.severity == "high" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_not_using_direct_prisma_lifecycle_negation(self) -> None:
        normalized = self.postmortem_normalized(
            assistant_messages=[
                {
                    "ref": "turn-1.assistant-1",
                    "text": "Caveat: not using direct Prisma writes.",
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "workflow" and fact.severity == "high" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_not_bypassed_lifecycle_negation(self) -> None:
        normalized = self.postmortem_normalized(
            assistant_messages=[
                {
                    "ref": "turn-1.assistant-1",
                    "text": "Caveat: not bypassed pendingConfig.",
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "workflow" and fact.severity == "high" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_never_direct_prisma_lifecycle_negation(self) -> None:
        normalized = self.postmortem_normalized(
            assistant_messages=[
                {
                    "ref": "turn-1.assistant-1",
                    "text": "I never used direct Prisma writes for this task.",
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "workflow" and fact.severity == "high" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_never_bypassed_lifecycle_negation(self) -> None:
        normalized = self.postmortem_normalized(
            assistant_messages=[
                {
                    "ref": "turn-1.assistant-1",
                    "text": "I never bypassed pendingConfig, changeLogEvent, or reconcile.",
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "workflow" and fact.severity == "high" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_passive_direct_prisma_lifecycle_negation(self) -> None:
        normalized = self.postmortem_normalized(
            assistant_messages=[
                {
                    "ref": "turn-1.assistant-1",
                    "text": "Direct Prisma writes were not used.",
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "workflow" and fact.severity == "high" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_passive_pending_config_lifecycle_negation(self) -> None:
        normalized = self.postmortem_normalized(
            assistant_messages=[
                {
                    "ref": "turn-1.assistant-1",
                    "text": "pendingConfig was not bypassed; changeLogEvent was recorded.",
                }
            ]
        )

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertFalse(any(fact.category == "workflow" and fact.severity == "high" for fact in facts))
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_neutral_lifecycle_mentions(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [
                {
                    "ref": "turn-1.assistant-1",
                    "text": "I reviewed pendingConfig and changeLogEvent handling in the docs.",
                }
            ],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_ignores_unrelated_bypassed_mentions(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [
                {
                    "ref": "turn-1.assistant-1",
                    "text": "I bypassed the cache during local benchmarking.",
                }
            ],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_categorizes_stored_event_msg_lifecycle_bypass(self) -> None:
        events = [
            {"type": "session_meta", "payload": {}},
            {
                "type": "event_msg",
                "payload": {
                    "type": "agent_message",
                    "message": "Caveats: used direct Prisma writes; bypassed pendingConfig.",
                },
            },
        ]
        normalized = MODULE.normalize_trace(events, "stored_session_jsonl")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertTrue(any(fact.category == "workflow" for fact in facts))
        self.assertTrue(any("direct Prisma" in fact.snippet for fact in facts))

    def test_extract_postmortem_facts_categorizes_overclaim_caveat(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [
                {
                    "ref": "turn-1.assistant-1",
                    "text": "Generated code not updated; output is not plan-approved.",
                }
            ],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)
        overclaim_facts = [fact for fact in facts if fact.title == "No-overclaim caveat"]

        self.assertEqual(len(overclaim_facts), 1)
        self.assertEqual(overclaim_facts[0].category, "workflow")
        self.assertEqual(overclaim_facts[0].severity, "medium")
        self.assertEqual(overclaim_facts[0].evidence_ref, "turn-1.assistant-1")
        self.assertIn("Generated code not updated", overclaim_facts[0].snippet)

    def test_extract_postmortem_facts_does_not_treat_plain_draft_as_lifecycle_caveat(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [
                {
                    "ref": "turn-1.assistant-1",
                    "text": "I will draft a short summary for review.",
                }
            ],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].title, "Low-signal postmortem")

    def test_extract_postmortem_facts_captures_plans_remain_draft_overclaim(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [
                {
                    "ref": "turn-1.assistant-1",
                    "text": "Caveat: plans remain DRAFT and are not approved.",
                }
            ],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

        facts = MODULE.extract_postmortem_facts(normalized)
        overclaim_facts = [fact for fact in facts if fact.title == "No-overclaim caveat"]

        self.assertEqual(len(overclaim_facts), 1)
        self.assertEqual(overclaim_facts[0].category, "workflow")
        self.assertEqual(overclaim_facts[0].evidence_ref, "turn-1.assistant-1")
        self.assertIn("plans remain DRAFT", overclaim_facts[0].snippet)

    def test_extract_postmortem_facts_captures_token_usage_fact(self) -> None:
        usage = MODULE.empty_token_usage(source="session_token_count")
        usage.update(
            {
                "has_usage": True,
                "total_tokens": 29000000,
                "input_tokens": 28000000,
                "cached_input_tokens": 27000000,
                "output_tokens": 100000,
                "raw_refs": ["event-10.token-count"],
            }
        )
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": usage,
        }

        facts = MODULE.extract_postmortem_facts(normalized)
        token_facts = [fact for fact in facts if fact.category == "token"]

        self.assertEqual(len(token_facts), 1)
        self.assertEqual(token_facts[0].title, "High token usage observed")
        self.assertEqual(token_facts[0].severity, "medium")
        self.assertEqual(token_facts[0].evidence_ref, "event-10.token-count")
        self.assertIn("29000000", token_facts[0].snippet)

    def test_extract_postmortem_facts_uses_latest_token_ref_for_aggregated_usage(self) -> None:
        usage = MODULE.empty_token_usage(source="exec_turn_usage")
        usage.update(
            {
                "has_usage": True,
                "total_tokens": 300,
                "input_tokens": 200,
                "output_tokens": 100,
                "raw_refs": ["turn-1.usage", "turn-2.usage"],
            }
        )
        normalized = {
            "format": "exec_trace_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": [],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": usage,
        }

        facts = MODULE.extract_postmortem_facts(normalized)
        token_facts = [fact for fact in facts if fact.category == "token"]

        self.assertEqual(len(token_facts), 1)
        self.assertEqual(token_facts[0].title, "Token accounting available")
        self.assertEqual(token_facts[0].evidence_ref, "turn-2.usage")
        self.assertIn("300", token_facts[0].snippet)

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

    def postmortem_normalized(
        self,
        *,
        commands: list[dict[str, object]] | None = None,
        assistant_messages: list[dict[str, object]] | None = None,
        user_messages: list[dict[str, object]] | None = None,
        tool_calls: list[dict[str, object]] | None = None,
    ) -> dict[str, object]:
        return {
            "format": "stored_session_jsonl",
            "stats": {"failed_command_count": 0},
            "commands": commands or [],
            "assistant_messages": assistant_messages or [],
            "user_messages": user_messages or [],
            "tool_calls": tool_calls or [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }

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

    def parallel_exec_entry_with_recipient(self, recipient_name: str, command: str) -> dict[str, object]:
        return {
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "multi_tool_use.parallel",
                "arguments": json.dumps(
                    {
                        "tool_uses": [
                            {
                                "recipient_name": recipient_name,
                                "parameters": {"cmd": command},
                            }
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

    def test_redacted_postmortem_fact_source_redacts_trace_path_and_metadata(self) -> None:
        home_trace_path = Path.home() / "private/project/session.jsonl"
        trace_path, metadata = MODULE.redacted_postmortem_fact_source(
            home_trace_path,
            {
                "source_kind": "session_id",
                "matched_cwd": str(Path.home() / "private/project"),
                "helper_summary": {
                    "cwd": str(Path.home() / "private/project"),
                    "remote": "repo.internal.example.com",
                },
            },
        )

        self.assertNotIn(str(Path.home()), trace_path)
        self.assertNotIn(str(Path.home()), json.dumps(metadata))
        self.assertIn("$HOME", trace_path)
        self.assertNotIn("session.jsonl", trace_path)
        self.assertEqual(metadata["matched_cwd"], "$HOME/private/project")
        self.assertEqual(metadata["helper_summary"]["remote"], "[HOST]")

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
            [command["shared_output"] for command in normalized["turns"][0]["commands"]],
            [True, True],
        )
        self.assertEqual(
            [command["shared_output"] for command in normalized["commands"]],
            [True, True],
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

    def test_normalize_exec_trace_records_failed_turn_message_as_error(self) -> None:
        events = [
            {"type": "turn.started"},
            {"type": "turn.failed", "message": "failed to load skill: missing SKILL.md"},
        ]
        normalized = MODULE.normalize_trace(events, "exec_json")

        facts = MODULE.extract_postmortem_facts(normalized)

        self.assertEqual(normalized["turns"][0]["status"], "failed")
        self.assertEqual(len(normalized["errors"]), 1)
        self.assertEqual(normalized["errors"][0]["message"], "failed to load skill: missing [HOST]")
        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].title, "Trace error event")

    def test_normalize_exec_trace_uses_nested_result_exit_code_for_command_execution(self) -> None:
        events = [
            {"type": "turn.started"},
            {
                "type": "item.completed",
                "item": {
                    "type": "command_execution",
                    "command": "node missing-script.js",
                    "result": {"output": "", "exit_code": 2},
                },
            },
            {"type": "turn.completed"},
        ]
        normalized = MODULE.normalize_trace(events, "exec_json")

        self.assertEqual(normalized["commands"][0]["exit_code"], 2)
        facts = MODULE.extract_postmortem_facts(normalized)
        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].category, "tool")

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

    def test_build_postmortem_suggestions_groups_fact_categories(self) -> None:
        facts = [
            MODULE.PostmortemFact(
                id="tool-1",
                category="tool",
                severity="high",
                kind="observed",
                title="Command or tool path failed",
                snippet="Invalid environment variables",
                evidence_ref="turn-1.command-1",
            ),
            MODULE.PostmortemFact(
                id="workflow-1",
                category="workflow",
                severity="high",
                kind="observed",
                title="Workflow bypass or lifecycle caveat",
                snippet="direct Prisma bypassed pendingConfig",
                evidence_ref="turn-1.assistant-1",
            ),
        ]

        suggestions = MODULE.build_postmortem_suggestions(facts)

        self.assertTrue(any(suggestion.category == "tool" for suggestion in suggestions))
        self.assertTrue(any(suggestion.category == "workflow" for suggestion in suggestions))
        self.assertTrue(any("turn-1.command-1" in suggestion.evidence_refs for suggestion in suggestions))

    def test_build_postmortem_judge_prompt_uses_fact_pack_not_raw_trace(self) -> None:
        prompt = MODULE.build_postmortem_judge_prompt(Path("/tmp/postmortem-facts.json"))

        self.assertIn("/tmp/postmortem-facts.json", prompt)
        self.assertIn("Do not inspect the raw trace", prompt)
        self.assertIn("observed facts", prompt)
        self.assertIn("inferred recommendations", prompt)
        self.assertIn("fact_refs", prompt)

    def test_run_postmortem_judge_uses_postmortem_prompt_and_shared_runner(self) -> None:
        captured: list[tuple[str, Path, str, Path]] = []
        payload = {
            "summary": "ok",
            "diagnosis_only": False,
            "dimension_scores": {
                name: {"score": 3, "rationale": "ok"}
                for name in MODULE.DIMENSION_NAMES
            },
            "breakdowns": [],
            "patches": [],
        }

        def fake_run_judge_prompt(
            prompt: str,
            output_dir: Path,
            model: str,
            schema_path: Path = MODULE.JUDGE_SCHEMA_PATH,
        ) -> dict[str, object]:
            captured.append((prompt, output_dir, model, schema_path))
            return payload

        original_runner = MODULE.run_judge_prompt
        MODULE.run_judge_prompt = fake_run_judge_prompt
        try:
            result = MODULE.run_postmortem_judge(
                Path("/tmp/postmortem-facts.json"),
                Path("/tmp/postmortem-output"),
                "model-x",
            )
        finally:
            MODULE.run_judge_prompt = original_runner

        self.assertIs(result, payload)
        self.assertEqual(len(captured), 1)
        prompt, output_dir, model, schema_path = captured[0]
        self.assertEqual(output_dir, Path("/tmp/postmortem-output"))
        self.assertEqual(model, "model-x")
        self.assertEqual(schema_path, MODULE.POSTMORTEM_JUDGE_SCHEMA_PATH)
        self.assertIn("/tmp/postmortem-facts.json", prompt)
        self.assertIn("fact_refs", prompt)
        self.assertNotIn("Inspect the repo-local skill", prompt)

    def test_run_judge_uses_focused_schema_and_prompt(self) -> None:
        captured: list[tuple[str, Path, str, Path]] = []
        payload = {
            "summary": "ok",
            "diagnosis_only": False,
            "dimension_scores": {
                name: {"score": 3, "rationale": "ok"}
                for name in MODULE.DIMENSION_NAMES
            },
            "breakdowns": [],
            "patches": [],
        }

        def fake_run_judge_prompt(
            prompt: str,
            output_dir: Path,
            model: str,
            schema_path: Path = MODULE.JUDGE_SCHEMA_PATH,
        ) -> dict[str, object]:
            captured.append((prompt, output_dir, model, schema_path))
            return payload

        original_runner = MODULE.run_judge_prompt
        MODULE.run_judge_prompt = fake_run_judge_prompt
        try:
            result = MODULE.run_judge(
                Path("/tmp/skill"),
                Path("/tmp/evidence.json"),
                Path("/tmp/focused-output"),
                "model-y",
            )
        finally:
            MODULE.run_judge_prompt = original_runner

        self.assertIs(result, payload)
        self.assertEqual(len(captured), 1)
        prompt, output_dir, model, schema_path = captured[0]
        self.assertEqual(output_dir, Path("/tmp/focused-output"))
        self.assertEqual(model, "model-y")
        self.assertEqual(schema_path, MODULE.JUDGE_SCHEMA_PATH)
        self.assertIn("Inspect the repo-local skill", prompt)
        self.assertIn("/tmp/evidence.json", prompt)
        self.assertNotIn("postmortem fact pack", prompt)

    def test_merge_postmortem_judge_suggestions_adds_ranked_breakdowns(self) -> None:
        local_suggestions = [
            MODULE.PostmortemSuggestion(
                title="Clarify lifecycle-safe operator workflow",
                category="workflow",
                severity="high",
                rationale="Observed lifecycle bypass.",
                evidence_refs=["turn-1.assistant-1"],
                suggested_target="skills and operator workflow docs",
            )
        ]
        judge_output = {
            "diagnosis_only": False,
            "breakdowns": [
                {
                    "title": "Add durable workflow checkpoints",
                    "category": "workflow",
                    "patch_kind": "SKILL_MD_CHANGE",
                    "risk": "medium",
                    "proposed_change": (
                        "Require a pre-write lifecycle checkpoint when direct data writes "
                        "are being considered."
                    ),
                    "expected_benefit": "Reduces direct-write bypasses.",
                    "evidence_refs": [],
                    "fact_refs": ["workflow-1"],
                }
            ],
        }

        suggestions = MODULE.merge_postmortem_judge_suggestions(
            local_suggestions,
            judge_output,
            {"workflow-1": "turn-1.assistant-1"},
        )

        self.assertEqual(len(suggestions), 2)
        self.assertTrue(any(suggestion.title == "Add durable workflow checkpoints" for suggestion in suggestions))
        self.assertTrue(any(suggestion.category == "workflow" for suggestion in suggestions))
        self.assertTrue(any(suggestion.fact_refs == ["workflow-1"] for suggestion in suggestions))
        self.assertTrue(any(suggestion.evidence_refs == ["turn-1.assistant-1"] for suggestion in suggestions))

    def test_merge_postmortem_judge_suggestions_drops_uncited_breakdowns(self) -> None:
        judge_output = {
            "diagnosis_only": False,
            "breakdowns": [
                {
                    "title": "Uncited recommendation",
                    "category": "workflow",
                    "patch_kind": "SKILL_MD_CHANGE",
                    "risk": "medium",
                    "proposed_change": "Add an unsupported workflow recommendation.",
                    "expected_benefit": "Would be useful if grounded.",
                    "evidence_refs": [],
                    "fact_refs": [],
                },
                {
                    "title": "Unknown citation recommendation",
                    "category": "workflow",
                    "patch_kind": "SKILL_MD_CHANGE",
                    "risk": "medium",
                    "proposed_change": "Add a recommendation citing an unknown fact.",
                    "expected_benefit": "Would be useful if grounded.",
                    "evidence_refs": [],
                    "fact_refs": ["missing-1"],
                },
                {
                    "title": "Mixed citation recommendation",
                    "category": "workflow",
                    "patch_kind": "SKILL_MD_CHANGE",
                    "risk": "medium",
                    "proposed_change": "Add a recommendation mixing fact and trace refs.",
                    "expected_benefit": "Would be useful if grounded.",
                    "evidence_refs": ["turn-1.assistant-1"],
                    "fact_refs": ["workflow-1"],
                },
            ],
        }

        suggestions = MODULE.merge_postmortem_judge_suggestions(
            [],
            judge_output,
            {"workflow-1": "turn-1.assistant-1"},
        )

        self.assertEqual(suggestions, [])

    def test_judge_schemas_keep_focused_and_postmortem_contracts_separate(self) -> None:
        focused_schema = json.loads(MODULE.JUDGE_SCHEMA_PATH.read_text(encoding="utf-8"))
        postmortem_schema = json.loads(
            MODULE.POSTMORTEM_JUDGE_SCHEMA_PATH.read_text(encoding="utf-8")
        )
        focused_breakdown_schema = focused_schema["$defs"]["breakdown"]
        postmortem_breakdown_schema = postmortem_schema["$defs"]["breakdown"]
        focused_categories = focused_breakdown_schema["properties"]["category"]["enum"]
        postmortem_categories = postmortem_breakdown_schema["properties"]["category"]["enum"]
        focused_properties = focused_breakdown_schema["properties"]
        postmortem_properties = postmortem_breakdown_schema["properties"]

        for category in ("routing", "procedure", "deterministic", "context_hygiene", "tooling", "verification"):
            self.assertIn(category, focused_categories)
        for category in ("tool", "skill", "workflow", "docs", "token"):
            self.assertNotIn(category, focused_categories)
            self.assertIn(category, postmortem_categories)
        self.assertNotIn("fact_refs", focused_properties)
        self.assertIn("fact_refs", postmortem_properties)
        self.assertIn("fact_refs", postmortem_breakdown_schema["required"])
        self.assertEqual(postmortem_properties["fact_refs"]["type"], "array")
        self.assertEqual(postmortem_properties["fact_refs"]["minItems"], 1)
        self.assertEqual(postmortem_properties["fact_refs"]["items"]["type"], "string")
        self.assertEqual(postmortem_properties["fact_refs"]["items"]["minLength"], 1)
        self.assertEqual(postmortem_properties["evidence_refs"]["maxItems"], 0)

        postmortem_breakdown = {
            "title": "Add token budget checkpoints",
            "severity": "medium",
            "category": "token",
            "patch_kind": "SKILL_MD_CHANGE",
            "evidence_refs": [],
            "fact_refs": ["workflow-1"],
            "expected_benefit": "Keeps long postmortems bounded.",
            "risk": "low",
            "proposed_change": "Require token budget checkpointing in long postmortems.",
        }
        focused_breakdown = {
            "title": "Read skill first",
            "severity": "medium",
            "category": "procedure",
            "patch_kind": "SKILL_MD_CHANGE",
            "evidence_refs": ["turn-1.command-1"],
            "expected_benefit": "Keeps skill review grounded.",
            "risk": "low",
            "proposed_change": "Require reading the skill before judging.",
        }

        for breakdown in (postmortem_breakdown, focused_breakdown):
            schema = postmortem_breakdown_schema if "fact_refs" in breakdown else focused_breakdown_schema
            properties = schema["properties"]
            categories = properties["category"]["enum"]
            self.assertTrue(set(schema["required"]).issubset(breakdown))
            self.assertTrue(set(breakdown).issubset(properties))
            self.assertIn(breakdown["category"], categories)
            self.assertIn(
                breakdown["patch_kind"],
                properties["patch_kind"]["enum"],
            )
            self.assertIn(breakdown["severity"], properties["severity"]["enum"])
            self.assertIn(breakdown["risk"], properties["risk"]["enum"])

    def test_build_postmortem_report_separates_observed_and_inferred(self) -> None:
        facts = [
            MODULE.PostmortemFact(
                id="tool-1",
                category="tool",
                severity="high",
                kind="observed",
                title="Command or tool path failed",
                snippet="Expected date, received string",
                evidence_ref="turn-1.command-1",
            ),
            MODULE.PostmortemFact(
                id="workflow-1",
                category="workflow",
                severity="medium",
                kind="inferred",
                title="Supported workflow gap",
                snippet="Supported import path did not cover required lifecycle.",
                evidence_ref="turn-1.command-1",
            ),
        ]
        suggestions = MODULE.build_postmortem_suggestions(facts)
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"command_count": 1, "failed_command_count": 1},
            "usage": MODULE.empty_token_usage(),
        }

        report = MODULE.build_postmortem_report(
            trace_path=Path("/tmp/session.jsonl"),
            trace_format="stored_session_jsonl",
            source_label="session_id",
            source_metadata={"session_id": "abc123"},
            normalized=normalized,
            facts=facts,
            suggestions=suggestions,
            mode="deterministic-only",
            judge_output=None,
            judge_error="",
        )

        self.assertIn("## What Happened?", report)
        self.assertIn("## What Failed?", report)
        self.assertIn("## Why Did It Fail?", report)
        self.assertIn("## What Should Change?", report)
        self.assertIn("Observed", report)
        self.assertIn("Inferred", report)
        what_failed = report.split("## What Failed?", 1)[1].split("## Why Did It Fail?", 1)[0]
        why_failed = report.split("## Why Did It Fail?", 1)[1].split("## Token Review", 1)[0]
        what_should_change = report.split("## What Should Change?", 1)[1].split(
            "## What Should We Do Next Time?", 1
        )[0]
        self.assertIn("Expected date, received string", what_failed)
        self.assertNotIn("Supported import path", what_failed)
        self.assertIn("Supported import path", why_failed)
        self.assertIn("Harden the supported tool or CLI path", what_should_change)
        self.assertIn("One or more supported command paths failed", what_should_change)
        self.assertIn("tooling/CLI command surface", what_should_change)
        self.assertIn("turn-1.command-1", what_should_change)

    def test_build_postmortem_suggestions_returns_empty_for_low_signal(self) -> None:
        facts = [
            MODULE.PostmortemFact(
                id="workflow-1",
                category="workflow",
                severity="low",
                kind="observed",
                title="Low-signal postmortem",
                snippet="The trace did not contain strong command failure, lifecycle bypass, or token accounting signals.",
                evidence_ref=None,
            )
        ]

        self.assertEqual(MODULE.build_postmortem_suggestions(facts), [])

    def test_build_postmortem_report_next_steps_follow_fact_categories(self) -> None:
        facts = [
            MODULE.PostmortemFact(
                id="tool-1",
                category="tool",
                severity="medium",
                kind="observed",
                title="Command or tool path failed",
                snippet="generic-tool failed with exit code 1",
                evidence_ref="turn-1.command-1",
            )
        ]
        report = MODULE.build_postmortem_report(
            trace_path=Path("/tmp/session.jsonl"),
            trace_format="stored_session_jsonl",
            source_label="trace",
            source_metadata={},
            normalized={
                "format": "stored_session_jsonl",
                "stats": {"command_count": 1, "failed_command_count": 1},
                "commands": [
                    {
                        "ref": "turn-1.command-1",
                        "command": "generic-tool run",
                        "output": "Process exited with code 1",
                        "exit_code": 1,
                    }
                ],
                "user_messages": [],
                "assistant_messages": [],
                "usage": MODULE.empty_token_usage(),
            },
            facts=facts,
            suggestions=MODULE.build_postmortem_suggestions(facts),
            mode="deterministic-only",
            judge_output=None,
            judge_error="",
        )

        next_steps = report.split("## What Should We Do Next Time?", 1)[1]
        self.assertIn("Prefer supported commands", next_steps)
        self.assertNotIn("lifecycle bypass", next_steps)
        self.assertNotIn("direct workaround", next_steps)
        self.assertNotIn("draft", next_steps)
        self.assertNotIn("live-data", next_steps)

    def test_build_postmortem_suggestions_ignores_narrative_milestone_only_facts(self) -> None:
        facts = [
            MODULE.PostmortemFact(
                id="workflow-1",
                category="workflow",
                severity="low",
                kind="observed",
                title="Narrative milestone",
                snippet="Initial goal: investigate Core8 CLI postmortem flow.",
                evidence_ref="turn-1.user-1",
            ),
            MODULE.PostmortemFact(
                id="workflow-2",
                category="workflow",
                severity="low",
                kind="observed",
                title="Narrative milestone",
                snippet="Phase marker: tried supported CLI path before fallback.",
                evidence_ref="turn-1.assistant-1",
            ),
        ]

        self.assertEqual(MODULE.build_postmortem_suggestions(facts), [])

    def test_build_postmortem_suggestions_ignores_token_accounting_only_fact(self) -> None:
        facts = [
            MODULE.PostmortemFact(
                id="token-1",
                category="token",
                severity="medium",
                kind="observed",
                title="Token accounting available",
                snippet="Total tokens: 100; Input tokens: 70; Output tokens: 30",
                evidence_ref="turn-1",
            )
        ]

        self.assertEqual(MODULE.build_postmortem_suggestions(facts), [])

    def test_build_postmortem_suggestions_keeps_high_token_only_fact_actionable(self) -> None:
        facts = [
            MODULE.PostmortemFact(
                id="token-1",
                category="token",
                severity="medium",
                kind="observed",
                title="High token usage observed",
                snippet="Total tokens: 29000000; Input tokens: 28000000; Cached input tokens: 27000000",
                evidence_ref="event-10.token-count",
            )
        ]

        suggestions = MODULE.build_postmortem_suggestions(facts)

        self.assertEqual(len(suggestions), 1)
        self.assertEqual(suggestions[0].title, "Add token budget checkpoints")
        self.assertEqual(suggestions[0].category, "token")
        self.assertEqual(suggestions[0].evidence_refs, ["event-10.token-count"])

    def test_build_postmortem_report_says_when_no_command_failures_found(self) -> None:
        facts = [
            MODULE.PostmortemFact(
                id="workflow-1",
                category="workflow",
                severity="low",
                kind="observed",
                title="Low-signal postmortem",
                snippet="No strong failure signals.",
                evidence_ref=None,
            )
        ]
        report = MODULE.build_postmortem_report(
            trace_path=Path("/tmp/session.jsonl"),
            trace_format="stored_session_jsonl",
            source_label="trace",
            source_metadata={},
            normalized={
                "format": "stored_session_jsonl",
                "stats": {"command_count": 1, "failed_command_count": 0},
                "usage": MODULE.empty_token_usage(),
                "user_messages": [],
                "assistant_messages": [],
                "commands": [],
            },
            facts=facts,
            suggestions=[],
            mode="deterministic-only",
            judge_output=None,
            judge_error="",
        )

        self.assertIn("No command failures were detected", report)

    def test_build_postmortem_report_uses_failed_command_count_when_commands_absent(self) -> None:
        report = MODULE.build_postmortem_report(
            trace_path=Path("/tmp/session.jsonl"),
            trace_format="stored_session_jsonl",
            source_label="trace",
            source_metadata={},
            normalized={
                "format": "stored_session_jsonl",
                "stats": {"command_count": 1, "failed_command_count": 1},
                "usage": MODULE.empty_token_usage(),
            },
            facts=[
                MODULE.PostmortemFact(
                    id="tool-1",
                    category="tool",
                    severity="high",
                    kind="observed",
                    title="Command or tool path failed",
                    snippet="Expected date, received string",
                    evidence_ref="turn-1.command-1",
                )
            ],
            suggestions=[],
            mode="deterministic-only",
            judge_output=None,
            judge_error="",
        )

        self.assertIn("Failed supported command paths: 1", report)
        self.assertNotIn("No command failures were detected", report)

    def test_build_postmortem_report_uses_failed_commands_when_stats_are_stale_zero(self) -> None:
        report = MODULE.build_postmortem_report(
            trace_path=Path("/tmp/session.jsonl"),
            trace_format="stored_session_jsonl",
            source_label="trace",
            source_metadata={},
            normalized={
                "format": "stored_session_jsonl",
                "stats": {"command_count": 1, "failed_command_count": 0},
                "commands": [
                    {
                        "ref": "turn-1.command-1",
                        "command": "node fail.js",
                        "output": "Process exited with code 1",
                        "exit_code": 1,
                    }
                ],
                "usage": MODULE.empty_token_usage(),
            },
            facts=[
                MODULE.PostmortemFact(
                    id="tool-1",
                    category="tool",
                    severity="medium",
                    kind="observed",
                    title="Command or tool path failed",
                    snippet="node fail.js Process exited with code 1",
                    evidence_ref="turn-1.command-1",
                )
            ],
            suggestions=[],
            mode="deterministic-only",
            judge_output=None,
            judge_error="",
        )

        self.assertIn("Failed supported command paths: 1", report)
        self.assertIn("Failed Command Count: 1", report)
        self.assertNotIn("Failed Command Count: 0", report)
        self.assertNotIn("No command failures were detected", report)

    def test_build_postmortem_report_uses_failed_commands_when_positive_stats_undercount(self) -> None:
        report = MODULE.build_postmortem_report(
            trace_path=Path("/tmp/session.jsonl"),
            trace_format="stored_session_jsonl",
            source_label="trace",
            source_metadata={},
            normalized={
                "format": "stored_session_jsonl",
                "stats": {"command_count": 2, "failed_command_count": 1},
                "commands": [
                    {
                        "ref": "turn-1.command-1",
                        "command": "node fail-one.js",
                        "output": "Process exited with code 1",
                        "exit_code": 1,
                    },
                    {
                        "ref": "turn-1.command-2",
                        "command": "node fail-two.js",
                        "output": "Process exited with code 2",
                        "exit_code": 2,
                    },
                ],
                "usage": MODULE.empty_token_usage(),
            },
            facts=[
                MODULE.PostmortemFact(
                    id="tool-1",
                    category="tool",
                    severity="medium",
                    kind="observed",
                    title="Command or tool path failed",
                    snippet="node fail-one.js Process exited with code 1",
                    evidence_ref="turn-1.command-1",
                ),
                MODULE.PostmortemFact(
                    id="tool-2",
                    category="tool",
                    severity="medium",
                    kind="observed",
                    title="Command or tool path failed",
                    snippet="node fail-two.js Process exited with code 2",
                    evidence_ref="turn-1.command-2",
                ),
            ],
            suggestions=[],
            mode="deterministic-only",
            judge_output=None,
            judge_error="",
        )

        self.assertIn("Failed supported command paths: 2", report)
        self.assertIn("Failed Command Count: 2", report)
        self.assertNotIn("Failed Command Count: 1", report)

    def test_build_postmortem_report_counts_output_detected_command_failures(self) -> None:
        report = MODULE.build_postmortem_report(
            trace_path=Path("/tmp/session.jsonl"),
            trace_format="stored_session_jsonl",
            source_label="trace",
            source_metadata={},
            normalized={
                "format": "stored_session_jsonl",
                "stats": {"command_count": 1, "failed_command_count": 0},
                "commands": [
                    {
                        "ref": "turn-1.command-1",
                        "command": "codex skill load missing",
                        "output": "failed to load skill: missing SKILL.md",
                        "exit_code": 0,
                    }
                ],
                "usage": MODULE.empty_token_usage(),
            },
            facts=[
                MODULE.PostmortemFact(
                    id="tool-1",
                    category="tool",
                    severity="high",
                    kind="observed",
                    title="Command or tool path failed",
                    snippet="failed to load skill: missing SKILL.md",
                    evidence_ref="turn-1.command-1",
                )
            ],
            suggestions=[],
            mode="deterministic-only",
            judge_output=None,
            judge_error="",
        )

        self.assertIn("Failed supported command paths: 1", report)
        self.assertIn("Failed Command Count: 1", report)
        self.assertNotIn("No command failures were detected", report)

    def test_build_postmortem_report_counts_exit_zero_postmortem_specific_command_failure(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"command_count": 1, "failed_command_count": 0},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "./bin/core8 data trpc call --router personnel",
                    "output": "personnel.hireDate: Expected date",
                    "exit_code": 0,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }
        facts = MODULE.extract_postmortem_facts(normalized)

        report = MODULE.build_postmortem_report(
            trace_path=Path("/tmp/session.jsonl"),
            trace_format="stored_session_jsonl",
            source_label="trace",
            source_metadata={},
            normalized=normalized,
            facts=facts,
            suggestions=[],
            mode="deterministic-only",
            judge_output=None,
            judge_error="",
        )

        self.assertIn("Failed supported command paths: 1", report)
        self.assertIn("Failed Command Count: 1", report)
        self.assertNotIn("No command failures were detected", report)

    def test_build_postmortem_report_counts_tool_call_failure_fact(self) -> None:
        facts = [
            MODULE.PostmortemFact(
                id="tool-1",
                category="tool",
                severity="high",
                kind="observed",
                title="Tool call failure or blocker",
                snippet="multi_tool_use.parallel Process exited with code 1",
                evidence_ref="turn-1.tool-1",
            )
        ]
        report = MODULE.build_postmortem_report(
            trace_path=Path("/tmp/session.jsonl"),
            trace_format="stored_session_jsonl",
            source_label="trace",
            source_metadata={},
            normalized={
                "format": "stored_session_jsonl",
                "stats": {"command_count": 0, "failed_command_count": 0},
                "commands": [],
                "usage": MODULE.empty_token_usage(),
            },
            facts=facts,
            suggestions=[],
            mode="deterministic-only",
            judge_output=None,
            judge_error="",
        )

        self.assertIn("Failed supported command paths: 1", report)
        self.assertIn("Failed Command Count: 1", report)
        self.assertNotIn("No command failures were detected", report)

    def test_build_postmortem_report_ignores_search_no_match_command_exit(self) -> None:
        normalized = {
            "format": "stored_session_jsonl",
            "stats": {"command_count": 1, "failed_command_count": 1},
            "commands": [
                {
                    "ref": "turn-1.command-1",
                    "command": "rg absent-pattern skills",
                    "output": "Process exited with code 1",
                    "exit_code": 1,
                }
            ],
            "assistant_messages": [],
            "user_messages": [],
            "tool_calls": [],
            "turns": [],
            "usage": MODULE.empty_token_usage(),
        }
        facts = MODULE.extract_postmortem_facts(normalized)

        report = MODULE.build_postmortem_report(
            trace_path=Path("/tmp/session.jsonl"),
            trace_format="stored_session_jsonl",
            source_label="trace",
            source_metadata={},
            normalized=normalized,
            facts=facts,
            suggestions=[],
            mode="deterministic-only",
            judge_output=None,
            judge_error="",
        )

        self.assertIn("No command failures were detected", report)
        self.assertIn("Failed Command Count: 0", report)
        self.assertNotIn("Failed supported command paths", report)

    def test_build_postmortem_report_uses_command_rows_when_stats_command_count_is_stale(self) -> None:
        report = MODULE.build_postmortem_report(
            trace_path=Path("/tmp/session.jsonl"),
            trace_format="stored_session_jsonl",
            source_label="trace",
            source_metadata={},
            normalized={
                "format": "stored_session_jsonl",
                "stats": {"command_count": 0, "failed_command_count": 0},
                "commands": [
                    {
                        "ref": "turn-1.command-1",
                        "command": "node fail.js",
                        "output": "Process exited with code 1",
                        "exit_code": 1,
                    }
                ],
                "usage": MODULE.empty_token_usage(),
            },
            facts=[
                MODULE.PostmortemFact(
                    id="tool-1",
                    category="tool",
                    severity="medium",
                    kind="observed",
                    title="Command or tool path failed",
                    snippet="node fail.js Process exited with code 1",
                    evidence_ref="turn-1.command-1",
                )
            ],
            suggestions=[],
            mode="deterministic-only",
            judge_output=None,
            judge_error="",
        )

        self.assertIn("Command Count: 1", report)
        self.assertNotIn("Command Count: 0", report)

    def test_build_postmortem_report_keeps_informational_facts_out_of_failures(self) -> None:
        facts = [
            MODULE.PostmortemFact(
                id="workflow-1",
                category="workflow",
                severity="low",
                kind="observed",
                title="Narrative milestone",
                snippet="Initial goal: investigate Core8 CLI postmortem flow.",
                evidence_ref="turn-1.user-1",
            ),
            MODULE.PostmortemFact(
                id="token-1",
                category="token",
                severity="medium",
                kind="observed",
                title="Token accounting available",
                snippet="Total tokens: 100; Input tokens: 70; Output tokens: 30",
                evidence_ref="turn-1",
            ),
        ]

        report = MODULE.build_postmortem_report(
            trace_path=Path("/tmp/session.jsonl"),
            trace_format="stored_session_jsonl",
            source_label="trace",
            source_metadata={},
            normalized={
                "format": "stored_session_jsonl",
                "stats": {"command_count": 0, "failed_command_count": 0},
                "usage": MODULE.empty_token_usage(),
            },
            facts=facts,
            suggestions=[],
            mode="deterministic-only",
            judge_output=None,
            judge_error="",
        )

        what_failed = report.split("## What Failed?", 1)[1].split("## Why Did It Fail?", 1)[0]
        self.assertIn("No command failures were detected", what_failed)
        self.assertNotIn("Initial goal", what_failed)
        self.assertNotIn("Total tokens: 100", what_failed)

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

    def test_skill_doc_documents_postmortem_mode(self) -> None:
        skill_md = (MODULE.SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        postmortem_section = skill_md.split("### Session Postmortem", 1)[1].split(
            "## Escalation Table", 1
        )[0]

        self.assertIn("--postmortem", skill_md)
        self.assertIn("postmortem-report.md", postmortem_section)
        self.assertIn("postmortem-facts.json", postmortem_section)
        self.assertIn("postmortem-suggestions.json", postmortem_section)
        self.assertIn("observed facts", postmortem_section)
        self.assertIn("inferred recommendations", postmortem_section)
        self.assertNotIn("evidence.json", postmortem_section)
        report_checks = skill_md.split("## Report Checks", 1)[1]
        postmortem_check = report_checks.split("- In postmortem mode", 1)[1].split(
            "- Confirm that `judge-output.json`", 1
        )[0]
        self.assertIn("postmortem-facts.json", postmortem_check)
        self.assertNotIn("evidence.json", postmortem_check)


if __name__ == "__main__":
    unittest.main()
