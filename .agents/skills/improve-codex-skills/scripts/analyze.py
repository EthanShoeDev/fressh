#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import uuid
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

SCRIPT_PATH = Path(__file__).resolve()
SKILL_DIR = SCRIPT_PATH.parent.parent


def discover_repo_root(start: Path) -> Path:
    for candidate in (start, *start.parents):
        if (candidate / "skills-origin.json").exists() and (candidate / "skills").is_dir():
            return candidate
    return start.parents[2]


REPO_ROOT = discover_repo_root(SKILL_DIR)
TRACE_HELPER_DIR = SKILL_DIR / "scripts"
FIND_SESSION_SCRIPT = TRACE_HELPER_DIR / "find-session-log.sh"
SUMMARIZE_SESSION_SCRIPT = TRACE_HELPER_DIR / "summarize-session.sh"
PATCH_SCHEMA_PATH = SKILL_DIR / "references/patch-proposal.schema.json"
JUDGE_SCHEMA_PATH = SKILL_DIR / "references/judge-output.schema.json"
POSTMORTEM_JUDGE_SCHEMA_PATH = SKILL_DIR / "references/postmortem-judge-output.schema.json"
QUICK_VALIDATE_PATH = Path.home() / ".codex/skills/.system/skill-creator/scripts/quick_validate.py"
ARTIFACT_ROOT = REPO_ROOT / "docs/tool-output/improve-codex-skills"
DIMENSION_NAMES = [
    "intent_adherence",
    "step_clarity",
    "user_steering_load",
    "context_hygiene",
    "tooling_appropriateness",
    "verification_behavior",
]
POSTMORTEM_JUDGE_CATEGORIES = {"tool", "skill", "workflow", "docs", "token"}

SECRET_PATTERNS = [
    re.compile(r"Authorization:\s*Bearer\s+\S+", re.IGNORECASE),
    re.compile(r"x-api-key:\s*\S+", re.IGNORECASE),
    re.compile(r"sk-[A-Za-z0-9]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"\bghp_[A-Za-z0-9]{30,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
    re.compile(r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*\S+"),
    re.compile(r"^[A-Z0-9_]*(KEY|SECRET|TOKEN)[A-Z0-9_]*=.*$", re.MULTILINE),
    re.compile(
        r"-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----[\s\S]*?-----END (?:RSA|EC|OPENSSH|PRIVATE) KEY-----"
    ),
]
PREREQUISITE_PATTERNS = [
    re.compile(r"\bnot found\b", re.IGNORECASE),
    re.compile(r"\bno such file\b", re.IGNORECASE),
    re.compile(r"\bmissing\b", re.IGNORECASE),
    re.compile(r"\brequired\b", re.IGNORECASE),
    re.compile(r"\bunknown argument\b", re.IGNORECASE),
    re.compile(r"\bpermission denied\b", re.IGNORECASE),
    re.compile(r"\bfailed to load skill\b", re.IGNORECASE),
]
POSTMORTEM_MISSING_FAILURE_PATTERNS = [
    re.compile(
        r"\bmissing\s+(?:(?:credential|credentials|environment|file|files|path|paths|config|configuration|dependency|dependencies|tool|command|schema|input|output|SKILL\.md)\b|\[HOST\])",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bmissing\s*:\s*(?:(?:credential|credentials|environment|file|files|path|paths|config|configuration|dependency|dependencies|tool|command|schema|input|output|SKILL\.md)\b|\[HOST\])",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:\b(?:credential|credentials|environment|file|files|path|paths|config|configuration|dependency|dependencies|tool|command|schema|input|output|SKILL\.md)|\[HOST\])\s+missing\b",
        re.IGNORECASE,
    ),
]
POSTMORTEM_DIRECT_TOOL_FAILURE_PATTERNS = [
    re.compile(r"Expected date", re.IGNORECASE),
    re.compile(r"Invalid environment variables", re.IGNORECASE),
    re.compile(r"Invalid option", re.IGNORECASE),
]
POSTMORTEM_NEGATED_MISSING_SUCCESS_PATTERNS = [
    re.compile(r"\b(?:no|zero)\s+missing\b", re.IGNORECASE),
    re.compile(r"\b0\s+missing\b", re.IGNORECASE),
]
POSTMORTEM_NEGATED_REQUIRED_SUCCESS_PATTERNS = [
    re.compile(r"\bno\s+changes?\s+required\b", re.IGNORECASE),
    re.compile(r"\b0\s+required\s+changes?\b", re.IGNORECASE),
    re.compile(r"\ball\s+required\s+checks?\s+passed\b", re.IGNORECASE),
]
POSTMORTEM_NONZERO_TOOL_FAILURE_PATTERNS = [
    re.compile(r"\bfailed\b", re.IGNORECASE),
    re.compile(r"\bblocked\b", re.IGNORECASE),
]
POSTMORTEM_REVIEWER_FINDING_PATTERNS = [
    re.compile(r"\bFindings:\s*(?:\n|\r\n?)\s*(?:[-*]\s*)?(?:\[[Pp][0-3]\]|\d+\.)", re.IGNORECASE),
    re.compile(r"^\s*(?:[-*]\s*)?\[[Pp][0-3]\]\s+", re.MULTILINE),
]
POSTMORTEM_STATUS_FAILURE_PATTERNS = [
    re.compile(r"\b(?:blocked|failed):", re.IGNORECASE),
    re.compile(r"\bblocked\s+(?:by|on|because)\b", re.IGNORECASE),
    re.compile(r"\bfailed\s+to\b", re.IGNORECASE),
    re.compile(r"\bstatus:\s*(?:blocked|failed)\b", re.IGNORECASE),
]
POSTMORTEM_EXPLICIT_STATUS_LINE_PATTERNS = [
    re.compile(r"^\s*(?:blocked|failed):", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*status:\s*(?:blocked|failed)\b", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*blocked\s+(?:by|on|because)\b", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*failed\s+to\b", re.IGNORECASE | re.MULTILINE),
]
POSTMORTEM_ZERO_STATUS_COUNT_KEYS = {"blocked", "failed"}
POSTMORTEM_LIFECYCLE_PATTERNS = [
    re.compile(r"direct Prisma", re.IGNORECASE),
    re.compile(r"\bbypassed\b", re.IGNORECASE),
    re.compile(r"pendingConfig", re.IGNORECASE),
    re.compile(r"changeLogEvent", re.IGNORECASE),
    re.compile(r"\breconcile\b", re.IGNORECASE),
]
POSTMORTEM_LIFECYCLE_CONTEXT_PATTERNS = [
    re.compile(r"\bcaveats?:.*(?:direct Prisma|bypassed|pendingConfig|changeLogEvent|reconcile)", re.IGNORECASE),
    re.compile(r"\b(?:used|using)\s+direct Prisma\b", re.IGNORECASE),
    re.compile(r"\bdirect Prisma\s+writes?\b", re.IGNORECASE),
    re.compile(
        r"\b(?:skipped|missing|bypass(?:ed)?|direct writes?)\b.*\b(?:pendingConfig|changeLogEvent|reconcile)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:pendingConfig|changeLogEvent|reconcile)\b.*\b(?:bypass(?:ed)?|skipped|missing)\b",
        re.IGNORECASE,
    ),
]
POSTMORTEM_LIFECYCLE_NEGATION_PATTERNS = [
    re.compile(
        r"\b(?:did not|didn't)\s+(?:use|using)\s+direct Prisma\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bnot\s+using\s+direct Prisma\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:did not|didn't)\s+bypass(?:ed)?\b[^.]{0,80}\b(?:pendingConfig|changeLogEvent|reconcile)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bnot\s+bypass(?:ed)?\b[^.]{0,80}\b(?:pendingConfig|changeLogEvent|reconcile)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\bnever\s+(?:used?|using)\s+direct Prisma\b", re.IGNORECASE),
    re.compile(
        r"\bnever\s+bypass(?:ed)?\b[^.]{0,80}\b(?:pendingConfig|changeLogEvent|reconcile)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\bdirect Prisma\s+writes?\s+were\s+not\s+used\b", re.IGNORECASE),
    re.compile(
        r"\b(?:pendingConfig|changeLogEvent|reconcile)\b[^.]{0,80}\bwas\s+not\s+bypassed\b",
        re.IGNORECASE,
    ),
    re.compile(r"\bwithout\s+bypassing\b", re.IGNORECASE),
    re.compile(r"\bno\s+direct Prisma\b", re.IGNORECASE),
]

POSTMORTEM_OVERCLAIM_PATTERNS = [
    re.compile(r"not plan-approved", re.IGNORECASE),
    re.compile(r"generated code not (?:imported|updated|fixed)", re.IGNORECASE),
    re.compile(r"no generated-code-fixed", re.IGNORECASE),
    re.compile(r"plans remain `?DRAFT`?", re.IGNORECASE),
]
STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "help",
    "how",
    "i",
    "if",
    "in",
    "into",
    "is",
    "it",
    "me",
    "my",
    "of",
    "on",
    "or",
    "our",
    "please",
    "should",
    "that",
    "the",
    "this",
    "to",
    "use",
    "we",
    "what",
    "when",
    "with",
    "you",
}

TOKEN_USAGE_KEYS = (
    "input_tokens",
    "cached_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens",
)
ENV_SHORTHAND_PATTERN = re.compile(r"env(\d+)", re.IGNORECASE)
SESSION_SELECTION_SIGNAL_PRIORITY = (
    "execution_hits",
    "artifact_hits",
    "invocation_hits",
    "consult_hits",
    "declaration_hits",
)


@dataclass(frozen=True)
class SessionSelectionEvidence:
    execution_hits: int = 0
    artifact_hits: int = 0
    invocation_hits: int = 0
    consult_hits: int = 0
    declaration_hits: int = 0

    def sort_key(self) -> tuple[int, ...]:
        return tuple(
            component
            for signal_name in SESSION_SELECTION_SIGNAL_PRIORITY
            for component in (
                1 if getattr(self, signal_name) else 0,
                getattr(self, signal_name),
            )
        )

    def to_metadata(self) -> dict[str, int]:
        return {
            "execution_hits": self.execution_hits,
            "artifact_hits": self.artifact_hits,
            "invocation_hits": self.invocation_hits,
            "consult_hits": self.consult_hits,
            "declaration_hits": self.declaration_hits,
        }

    def has_signal(self) -> bool:
        return any(getattr(self, signal_name) for signal_name in SESSION_SELECTION_SIGNAL_PRIORITY)


@dataclass(frozen=True)
class SessionSelectionPolicy:
    selectors: tuple[str, ...] = ()
    primary_selector: str | None = None
    skill_roots: tuple[str, ...] = ()
    artifact_skill_name: str | None = None
    allow_variant_agnostic_markers: bool = True

    @property
    def artifact_markers(self) -> tuple[str, ...]:
        if not self.allow_variant_agnostic_markers or not self.artifact_skill_name:
            return ()
        return (
            f"docs/tool-output/{self.artifact_skill_name}/",
            f"docs/run/{self.artifact_skill_name}-",
        )

    @property
    def declaration_markers(self) -> tuple[str, ...]:
        if not self.allow_variant_agnostic_markers or not self.artifact_skill_name:
            return ()
        return (
            f"Using the `{self.artifact_skill_name}` skill",
            f"Using the {self.artifact_skill_name} skill",
        )

    @property
    def declaration_requires_tool_activity(self) -> bool:
        return True

    @property
    def structured_invocation_path_suffixes(self) -> tuple[str, ...]:
        suffixes: list[str] = []
        for skill_root in self.skill_roots:
            normalized_root = skill_root.lstrip("./")
            suffixes.extend(
                (
                    f"{skill_root}SKILL.md",
                    f"{normalized_root}SKILL.md",
                )
            )
        return tuple(dict.fromkeys(suffix for suffix in suffixes if suffix))


@dataclass
class Finding:
    code: str
    title: str
    severity: str
    category: str
    patch_kind: str
    evidence_refs: list[str]
    evidence: list[str]
    recommendation: str

    def to_dict(self) -> dict[str, object]:
        return {
            "code": self.code,
            "title": self.title,
            "severity": self.severity,
            "category": self.category,
            "patch_kind": self.patch_kind,
            "evidence_refs": self.evidence_refs,
            "evidence": self.evidence,
            "recommendation": self.recommendation,
        }


@dataclass
class SuggestedChange:
    target: str
    risk_level: str
    rationale: str
    suggestion: str
    expected_benefit: str
    evidence_refs: list[str]

    def to_dict(self) -> dict[str, object]:
        return {
            "target": self.target,
            "risk_level": self.risk_level,
            "rationale": self.rationale,
            "suggestion": self.suggestion,
            "expected_benefit": self.expected_benefit,
            "evidence_refs": self.evidence_refs,
        }


@dataclass
class PostmortemFact:
    id: str
    category: str
    severity: str
    kind: str
    title: str
    snippet: str
    evidence_ref: str | None

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "category": self.category,
            "severity": self.severity,
            "kind": self.kind,
            "title": self.title,
            "snippet": self.snippet,
            "evidence_ref": self.evidence_ref,
        }


@dataclass
class PostmortemSuggestion:
    title: str
    category: str
    severity: str
    rationale: str
    evidence_refs: list[str]
    fact_refs: list[str] = field(default_factory=list)
    suggested_target: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "title": self.title,
            "category": self.category,
            "severity": self.severity,
            "rationale": self.rationale,
            "evidence_refs": self.evidence_refs,
            "fact_refs": self.fact_refs,
            "suggested_target": self.suggested_target,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Analyze Codex logs and report skill-improvement findings plus suggested changes.",
    )
    parser.add_argument(
        "--skill",
        help="Repo-local skill path, bare skill name, or explicit path to a skill directory",
    )
    parser.add_argument(
        "--census",
        action="store_true",
        help="List skills observed in the selected trace instead of analyzing one target skill",
    )
    parser.add_argument(
        "--postmortem",
        action="store_true",
        help="Analyze a whole session as a workflow/tooling postmortem instead of one target skill.",
    )
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--session-id", help="Codex session id")
    source.add_argument("--log", help="Path to a stored session JSONL log")
    source.add_argument("--trace", help="Path to a codex exec --json trace file")
    parser.add_argument(
        "--log-cwd",
        help="When no explicit source is given, use the latest stored session log whose recorded cwd matches this folder. Shorthand like 'env5' resolves to '~/cube9-env5/app'.",
    )
    parser.add_argument(
        "--mdev-window",
        help="Resolve --log-cwd from ~/.config/mdev/tmux-windows by window name",
    )
    parser.add_argument(
        "--mdev-index",
        help="Resolve --log-cwd from ~/.config/mdev/tmux-windows by window index",
    )
    parser.add_argument("--mdev-registry", help="Override the mdev tmux window registry path")
    parser.add_argument(
        "--tmux-target",
        help="Resolve --log-cwd from a live tmux target's pane_current_path",
    )
    parser.add_argument("--out-dir", help="Artifact directory (defaults to docs/tool-output/...)")
    parser.add_argument(
        "--judge",
        choices=("on", "off"),
        default="on",
        help="Run the default Codex-backed judge stage (default: on).",
    )
    parser.add_argument(
        "--use-codex",
        action="store_true",
        help="Deprecated alias for enabling the judge stage.",
    )
    parser.add_argument(
        "--codex-model",
        default="gpt-5.4",
        help="Model passed to codex exec for the judge stage.",
    )
    args = parser.parse_args()
    selected_modes = sum(
        1
        for enabled in (
            bool(args.census),
            bool(args.postmortem),
            args.skill is not None,
        )
        if enabled
    )
    if selected_modes == 0:
        parser.error("--skill is required unless --census or --postmortem is used")
    if selected_modes > 1:
        parser.error("Pass only one of --skill, --census, or --postmortem")
    if args.skill is not None and not args.skill.strip():
        parser.error("--skill cannot be empty")
    return args


def resolve_target_skill(raw_skill: str) -> Path:
    raw_path = Path(raw_skill)
    if raw_path.exists():
        skill_path = raw_path.resolve()
        if not (skill_path / "SKILL.md").exists():
            raise SystemExit(f"Target skill is missing SKILL.md: {skill_path}")
        return skill_path
    else:
        skill_path = (REPO_ROOT / ".agents/skills" / raw_skill).resolve()
    if not skill_path.exists():
        raise SystemExit(f"Target skill not found: {raw_skill}")
    skill_root = (REPO_ROOT / ".agents/skills").resolve()
    try:
        skill_path.relative_to(skill_root)
    except ValueError as exc:
        raise SystemExit(f"Target skill must live under {skill_root}") from exc
    if not (skill_path / "SKILL.md").exists():
        raise SystemExit(f"Target skill is missing SKILL.md: {skill_path}")
    return skill_path


def resolve_target_skill_selector(raw_skill: str, skill_path: Path) -> tuple[str, ...]:
    raw_selector = raw_skill.strip()
    if is_variant_specific_selector(raw_selector):
        selectors = [raw_selector]
        raw_path = Path(raw_selector)
        if not raw_path.is_absolute():
            selectors.append(str((REPO_ROOT / raw_path).absolute()))
        return tuple(selector for selector in dict.fromkeys(selectors) if selector)

    raw_path = Path(raw_selector)
    if raw_path.exists():
        selectors: list[str] = []
        if not raw_path.is_absolute():
            selectors.append(raw_selector)
        if skill_path.is_relative_to(REPO_ROOT):
            selectors.append(
                normalize_repo_relative_selector(str(skill_path.relative_to(REPO_ROOT)))
            )
        selectors.append(str(skill_path))
        return tuple(selector for selector in dict.fromkeys(selectors) if selector)

    if skill_path.is_relative_to(REPO_ROOT):
        selectors = [raw_selector]
        selectors.append(
            normalize_repo_relative_selector(str(skill_path.relative_to(REPO_ROOT)))
        )
        selectors.append(str(skill_path))
        return tuple(selector for selector in dict.fromkeys(selectors) if selector)

    return (str(skill_path),)


def normalize_repo_relative_selector(selector: str) -> str:
    if "/" not in selector and not selector.startswith("."):
        return f"./{selector}"
    return selector


def ensure_jsonl_path(path: Path) -> None:
    if path.suffix == ".json":
        raise SystemExit(
            "Legacy rollout .json logs are unsupported. Provide a session .jsonl file or a saved codex exec --json trace."
        )
    if path.suffix != ".jsonl":
        raise SystemExit(f"Expected a .jsonl file, got: {path}")


def run_command(cmd: list[str], *, cwd: Path | None = None) -> str:
    result = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or "unknown error"
        raise RuntimeError(f"{' '.join(cmd)} failed: {message}")
    return result.stdout


def default_sessions_root() -> Path:
    configured = os.environ.get("CODEX_SESSIONS_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return (Path.home() / ".codex" / "sessions").resolve()


def default_mdev_registry_path() -> Path:
    return (Path.home() / ".config" / "mdev" / "tmux-windows").resolve()


def parse_mdev_window_registry(content: str) -> dict[str, object]:
    windows: list[dict[str, str]] = []
    warnings: list[str] = []
    for line_number, line in enumerate(content.splitlines(), start=1):
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#"):
            continue
        parts = [part.strip() for part in line.split("|")]
        if len(parts) != 3:
            warnings.append(f"Line {line_number}: expected 'index | name | path'")
            continue
        index, name, path = parts
        if not re.fullmatch(r"\d+", index):
            warnings.append(f"Line {line_number}: index must be a non-negative integer")
            continue
        if not name:
            warnings.append(f"Line {line_number}: name is required")
            continue
        if not path:
            warnings.append(f"Line {line_number}: path is required")
            continue
        windows.append({"index": index, "name": name, "path": path})
    return {"windows": windows, "warnings": warnings}


def resolve_mdev_registry_cwd(
    *,
    mdev_window: str | None,
    mdev_index: str | None,
    registry_path: Path,
) -> Path:
    if mdev_window and mdev_index:
        raise SystemExit("Pass only one of --mdev-window or --mdev-index")
    if not mdev_window and not mdev_index:
        raise SystemExit("Missing mdev selector: pass --mdev-window or --mdev-index")
    if not registry_path.exists():
        raise SystemExit(f"mdev tmux registry not found: {registry_path}")
    parsed = parse_mdev_window_registry(registry_path.read_text(encoding="utf-8"))
    windows = parsed["windows"]
    assert isinstance(windows, list)
    if mdev_window:
        matches = [
            window
            for window in windows
            if isinstance(window, dict) and window.get("name") == mdev_window
        ]
        selector = f"name {mdev_window}"
    else:
        matches = [
            window
            for window in windows
            if isinstance(window, dict) and window.get("index") == mdev_index
        ]
        selector = f"index {mdev_index}"
    if not matches:
        raise SystemExit(f"No mdev tmux window matched {selector} in {registry_path}")
    if len(matches) > 1:
        raise SystemExit(
            f"Multiple mdev tmux windows matched name {mdev_window} in {registry_path}; use --mdev-index"
        )
    raw_path = str(matches[0]["path"])
    return Path(raw_path).expanduser().resolve()


def resolve_tmux_target_cwd(raw_target: str) -> Path:
    output = run_command(
        ["tmux", "display-message", "-p", "-t", raw_target, "#{pane_current_path}"]
    ).strip()
    if not output:
        raise SystemExit(f"tmux target did not report a pane current path: {raw_target}")
    return Path(output).expanduser().resolve()


def resolve_log_cwd_hint(raw_hint: str | None) -> Path:
    if not raw_hint:
        return REPO_ROOT
    shorthand_match = ENV_SHORTHAND_PATTERN.fullmatch(raw_hint.strip())
    if shorthand_match:
        env_number = shorthand_match.group(1)
        return (Path.home() / f"cube9-env{env_number}" / "app").resolve()
    return Path(raw_hint).expanduser().resolve()


def read_session_meta(path: Path) -> dict[str, object] | None:
    try:
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    return None
                if isinstance(payload, dict) and payload.get("type") == "session_meta":
                    return payload
    except OSError:
        return None
    return None


def latest_session_sort_key(path: Path, session_meta: dict[str, object]) -> tuple[int, str, int, str]:
    payload = first_dict(session_meta.get("payload"))
    timestamp = payload.get("timestamp") or session_meta.get("timestamp")
    timestamp_text = str(timestamp) if isinstance(timestamp, str) else ""
    try:
        mtime_ns = path.stat().st_mtime_ns
    except OSError:
        mtime_ns = 0
    return (1 if timestamp_text else 0, timestamp_text, mtime_ns, str(path))


def session_originator_preference(originator: object) -> int:
    if originator == "codex_cli_rs":
        return 2
    if originator in {"codex_cli", "cli"}:
        return 1
    return 0


def normalize_target_skill_selectors(
    target_skill_name: str | tuple[str, ...] | None,
) -> tuple[str, ...]:
    if target_skill_name is None:
        return ()
    if isinstance(target_skill_name, tuple):
        return tuple(
            selector.strip() for selector in target_skill_name if selector and selector.strip()
        )
    selector = target_skill_name.strip()
    return (selector,) if selector else ()


def is_variant_specific_selector(selector: str | None) -> bool:
    if not selector:
        return False
    normalized_selector = selector.strip().rstrip("/")
    if normalized_selector.startswith("./"):
        normalized_selector = normalized_selector[2:]
    return normalized_selector.startswith(".claude/skills/")


def selector_allows_variant_agnostic_markers(selector: str | None) -> bool:
    if not selector:
        return False
    normalized_selector = selector.strip().rstrip("/")
    if normalized_selector.startswith("./"):
        normalized_selector = normalized_selector[2:]
    if not normalized_selector or is_variant_specific_selector(normalized_selector):
        return False
    if normalized_selector.startswith("/"):
        try:
            return Path(normalized_selector).resolve().is_relative_to(REPO_ROOT)
        except OSError:
            return False
    if "/" not in normalized_selector or normalized_selector.startswith("../"):
        return False
    try:
        return (REPO_ROOT / normalized_selector).resolve().is_relative_to(REPO_ROOT)
    except OSError:
        return False


def build_session_selection_policy(
    target_skill_name: str | tuple[str, ...] | None,
) -> SessionSelectionPolicy:
    selectors = normalize_target_skill_selectors(target_skill_name)
    if not selectors:
        return SessionSelectionPolicy()

    skill_roots: list[str] = []
    artifact_skill_name = None
    primary_selector = selectors[0]

    for skill_selector in selectors:
        absolute_selector = skill_selector.rstrip("/")
        if absolute_selector.startswith("/"):
            skill_roots.append(f"{absolute_selector}/")
            artifact_skill_name = artifact_skill_name or Path(absolute_selector).name
            continue

        normalized_selector = skill_selector.rstrip("/")
        if not normalized_selector:
            continue

        if "/" in normalized_selector:
            relative_selector = (
                normalized_selector[2:]
                if normalized_selector.startswith("./")
                else normalized_selector
            )
            candidate_roots = [
                normalized_selector,
                relative_selector,
                f"./{relative_selector}",
            ]
            skill_roots.extend(
                f"{candidate_root.rstrip('/')}/"
                for candidate_root in candidate_roots
                if candidate_root
            )
            artifact_skill_name = artifact_skill_name or Path(normalized_selector).name
            continue

        skill_roots.extend(
            (
                f".agents/skills/{normalized_selector}/",
                f"./.agents/skills/{normalized_selector}/",
            )
        )
        artifact_skill_name = artifact_skill_name or normalized_selector

    return SessionSelectionPolicy(
        selectors=selectors,
        primary_selector=primary_selector,
        skill_roots=tuple(dict.fromkeys(skill_roots)),
        artifact_skill_name=artifact_skill_name,
        allow_variant_agnostic_markers=selector_allows_variant_agnostic_markers(
            primary_selector
        ),
    )


def classify_command_selection_signal(
    command: str, policy: SessionSelectionPolicy
) -> tuple[bool, bool, int]:
    command_matches_execution_path = (
        any(f"node {skill_root}" in command for skill_root in policy.skill_roots)
        or any(f"python3 {skill_root}" in command for skill_root in policy.skill_roots)
        or any(f"bash {skill_root}" in command for skill_root in policy.skill_roots)
        or any(f"sh {skill_root}" in command for skill_root in policy.skill_roots)
        or any(command.startswith(skill_root) for skill_root in policy.skill_roots)
    )
    command_matches_consult_path = any(
        f"{skill_root}SKILL.md" in command
        or f"{skill_root}scripts/" in command
        or f"{skill_root}references/" in command
        for skill_root in policy.skill_roots
    )
    artifact_hits = sum(command.count(marker) for marker in policy.artifact_markers)
    return command_matches_execution_path, command_matches_consult_path, artifact_hits


def extract_exec_commands(payload: dict[str, object]) -> list[str]:
    if payload.get("type") not in {"function_call", "custom_tool_call"}:
        return []

    function_name = payload.get("name")
    arguments = parse_jsonish(payload.get("arguments"))

    if function_name in {"exec_command", "functions.exec_command"}:
        command = arguments.get("cmd")
        return [command] if isinstance(command, str) else []

    if function_name != "multi_tool_use.parallel":
        return []

    commands: list[str] = []
    tool_uses = arguments.get("tool_uses")
    if not isinstance(tool_uses, list):
        return commands

    for tool_use in tool_uses:
        if not isinstance(tool_use, dict):
            continue
        if tool_use.get("recipient_name") not in {"functions.exec_command", "exec_command"}:
            continue
        parameters = first_dict(tool_use.get("parameters"))
        command = parameters.get("cmd")
        if isinstance(command, str):
            commands.append(command)

    return commands


def is_available_skills_catalog_text(text: str) -> bool:
    lower_text = text.lower()
    if "available skills" not in lower_text:
        return False
    return "<skill>" in text and "<name>" in text and "<path>" in text


def extract_event_message_text(payload: dict[str, object]) -> str:
    parts: list[str] = []
    for key in ("message", "text", "content"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            parts.append(value.strip())
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, str) and item.strip():
                    parts.append(item.strip())
                elif isinstance(item, dict):
                    for item_key in ("message", "text", "content"):
                        item_value = item.get(item_key)
                        if isinstance(item_value, str) and item_value.strip():
                            parts.append(item_value.strip())
    return "\n".join(parts)


def count_session_message_selection_hits(
    message_text: str, policy: SessionSelectionPolicy
) -> tuple[int, int]:
    if is_available_skills_catalog_text(message_text):
        return 0, 0
    invocation_hits = count_structured_invocation_hits(message_text, policy)
    declaration_hits = sum(message_text.count(marker) for marker in policy.declaration_markers)
    return invocation_hits, declaration_hits


def build_session_selection_evidence(
    candidate: Path, target_skill_name: str | tuple[str, ...] | None
) -> SessionSelectionEvidence:
    policy = build_session_selection_policy(target_skill_name)
    if not policy.skill_roots or not policy.artifact_skill_name:
        return SessionSelectionEvidence()

    execution_hits = 0
    artifact_hits = 0
    invocation_hits = 0
    consult_hits = 0
    declaration_hits = 0
    has_tool_activity = False

    try:
        with candidate.open(encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(event, dict):
                    continue

                payload = first_dict(event.get("payload"))
                event_type = event.get("type")

                if event_type == "response_item" and payload.get("type") in {
                    "function_call",
                    "custom_tool_call",
                }:
                    has_tool_activity = True
                    for command in extract_exec_commands(payload):
                        (
                            command_matches_execution_path,
                            command_matches_consult_path,
                            command_artifact_hits,
                        ) = classify_command_selection_signal(command, policy)

                        if command_matches_execution_path:
                            execution_hits += 1
                        elif command_matches_consult_path:
                            consult_hits += 1

                        artifact_hits += command_artifact_hits
                    continue

                if event_type == "response_item" and payload.get("type") == "message":
                    fragments: list[str] = []
                    for item in payload.get("content", []):
                        if not isinstance(item, dict):
                            continue
                        for key in ("text", "input_text", "output_text"):
                            value = item.get(key)
                            if isinstance(value, str):
                                fragments.append(value)
                    message_text = " ".join(fragments)
                    message_invocation_hits, message_declaration_hits = (
                        count_session_message_selection_hits(message_text, policy)
                    )
                    invocation_hits += message_invocation_hits
                    declaration_hits += message_declaration_hits
                    continue

                if event_type == "event_msg" and payload.get("type") in {
                    "user_message",
                    "agent_message",
                }:
                    message_text = extract_event_message_text(payload)
                    message_invocation_hits, message_declaration_hits = (
                        count_session_message_selection_hits(message_text, policy)
                    )
                    invocation_hits += message_invocation_hits
                    declaration_hits += message_declaration_hits
    except OSError:
        return SessionSelectionEvidence()

    if (
        policy.declaration_requires_tool_activity
        and not has_tool_activity
        and execution_hits == 0
        and artifact_hits == 0
        and consult_hits == 0
    ):
        invocation_hits = 0
        declaration_hits = 0

    return SessionSelectionEvidence(
        execution_hits=execution_hits,
        artifact_hits=artifact_hits,
        invocation_hits=invocation_hits,
        consult_hits=consult_hits,
        declaration_hits=declaration_hits,
    )


def discover_latest_session_log(
    *,
    cwd_hint: Path,
    target_skill_name: str | tuple[str, ...] | None = None,
    sessions_root: Path | None = None,
) -> tuple[Path, dict[str, object]]:
    root = (sessions_root or default_sessions_root()).expanduser().resolve()
    if not root.exists():
        raise SystemExit(f"Sessions root not found: {root}")

    target_cwd = cwd_hint.expanduser().resolve()
    best_path: Path | None = None
    best_meta: dict[str, object] | None = None
    best_evidence: SessionSelectionEvidence | None = None
    best_key: tuple[tuple[int, ...], int, tuple[int, str, int, str]] | None = None
    saw_matching_cwd = False

    for candidate in root.rglob("*.jsonl"):
        session_meta = read_session_meta(candidate)
        if session_meta is None:
            continue
        payload = first_dict(session_meta.get("payload"))
        recorded_cwd = payload.get("cwd")
        if not isinstance(recorded_cwd, str):
            continue
        try:
            candidate_cwd = Path(recorded_cwd).expanduser().resolve()
        except OSError:
            continue
        if candidate_cwd != target_cwd:
            continue
        saw_matching_cwd = True
        evidence = build_session_selection_evidence(candidate, target_skill_name)
        originator = payload.get("originator")
        candidate_key = (
            evidence.sort_key(),
            session_originator_preference(originator),
            latest_session_sort_key(candidate, session_meta),
        )
        if best_key is None or candidate_key > best_key:
            best_key = candidate_key
            best_path = candidate.resolve()
            best_meta = session_meta
            best_evidence = evidence

    if best_path is None or best_meta is None:
        raise SystemExit(f"No stored session log found for cwd: {target_cwd}")
    if target_skill_name and saw_matching_cwd and best_evidence is not None and not best_evidence.has_signal():
        raise SystemExit(
            f"No stored session log matched target skill evidence for cwd: {target_cwd}"
        )

    payload = first_dict(best_meta.get("payload"))
    metadata: dict[str, object] = {
        "source_kind": "latest_log",
        "matched_cwd": str(target_cwd),
    }
    if isinstance(payload.get("id"), str):
        metadata["resolved_session_id"] = payload["id"]
    if isinstance(payload.get("timestamp"), str):
        metadata["resolved_session_timestamp"] = payload["timestamp"]
    if isinstance(payload.get("originator"), str):
        metadata["resolved_session_originator"] = payload["originator"]
    if best_evidence is not None:
        metadata["selection_evidence"] = best_evidence.to_metadata()
    return best_path, metadata


def resolve_trace_source(
    args: argparse.Namespace,
    out_dir: Path,
    *,
    target_skill_name: str | tuple[str, ...] | None = None,
) -> tuple[Path, str, dict[str, object]]:
    metadata: dict[str, object] = {}
    if args.session_id:
        if not FIND_SESSION_SCRIPT.exists():
            raise SystemExit(f"Missing helper script: {FIND_SESSION_SCRIPT}")
        log_text = run_command(
            [str(FIND_SESSION_SCRIPT), "--sessionId", args.session_id],
            cwd=REPO_ROOT,
        )
        log_path = Path(log_text.strip().splitlines()[0]).resolve()
        ensure_jsonl_path(log_path)
        metadata["session_id"] = args.session_id
        metadata["source_kind"] = "session_id"
        if SUMMARIZE_SESSION_SCRIPT.exists():
            summary_path = out_dir / "trace-summary.json"
            run_command(
                [
                    str(SUMMARIZE_SESSION_SCRIPT),
                    "--sessionId",
                    args.session_id,
                    "--out",
                    str(summary_path),
                ],
                cwd=REPO_ROOT,
            )
            try:
                metadata["helper_summary"] = json.loads(summary_path.read_text())
            except json.JSONDecodeError:
                metadata["helper_summary"] = {"error": "Failed to parse summarize-session output"}
        return log_path, "stored_session_jsonl", metadata
    if args.log or args.trace:
        raw_path = Path(args.log or args.trace).expanduser().resolve()
        ensure_jsonl_path(raw_path)
        if not raw_path.exists():
            raise SystemExit(f"Trace file not found: {raw_path}")
        metadata["source_kind"] = "log_path" if args.log else "trace_path"
        return raw_path, "user_supplied", metadata

    if args.tmux_target:
        cwd_hint = resolve_tmux_target_cwd(args.tmux_target)
        metadata["tmux_target"] = args.tmux_target
    elif args.mdev_window or args.mdev_index:
        registry_path = (
            Path(args.mdev_registry).expanduser().resolve()
            if args.mdev_registry
            else default_mdev_registry_path()
        )
        cwd_hint = resolve_mdev_registry_cwd(
            mdev_window=args.mdev_window,
            mdev_index=args.mdev_index,
            registry_path=registry_path,
        )
        metadata["mdev_registry"] = str(registry_path)
        if args.mdev_window:
            metadata["mdev_window"] = args.mdev_window
        if args.mdev_index:
            metadata["mdev_index"] = args.mdev_index
    else:
        cwd_hint = resolve_log_cwd_hint(args.log_cwd)
    log_path, latest_metadata = discover_latest_session_log(
        cwd_hint=cwd_hint,
        target_skill_name=target_skill_name,
    )
    metadata.update(latest_metadata)
    return log_path, "latest_discovered", metadata


def read_jsonl(path: Path) -> tuple[list[str], list[dict[str, object]]]:
    raw_lines = path.read_text().splitlines()
    events: list[dict[str, object]] = []
    for index, line in enumerate(raw_lines, start=1):
        if not line.strip():
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"Invalid JSON on line {index} of {path}: {exc}") from exc
        if isinstance(parsed, dict):
            events.append(parsed)
    if not events:
        raise SystemExit(f"No JSON events found in {path}")
    return raw_lines, events


def detect_trace_format(events: list[dict[str, object]]) -> str:
    event_types = {str(event.get("type", "")) for event in events}
    if "session_meta" in event_types or "response_item" in event_types:
        return "stored_session_jsonl"
    if any("." in event_type for event_type in event_types) or "error" in event_types:
        return "exec_json"
    return "unknown_jsonl"


def first_dict(*values: object) -> dict[str, object]:
    for value in values:
        if isinstance(value, dict):
            return value
    return {}


def parse_jsonish(value: object) -> dict[str, object]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str):
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def redact_text(text: str) -> str:
    redacted = text
    for pattern in SECRET_PATTERNS:
        redacted = pattern.sub("[REDACTED]", redacted)
    home = str(Path.home())
    redacted = redacted.replace(home, "$HOME")
    redacted = re.sub(
        r"\b[a-z0-9.-]+(?:\.[a-z0-9.-]+)+\b",
        lambda match: "[HOST]" if "." in match.group(0) and "/" not in match.group(0) else match.group(0),
        redacted,
        flags=re.IGNORECASE,
    )
    return redacted


def count_structured_invocation_hits(
    message_text: str, policy: SessionSelectionPolicy
) -> int:
    if not message_text or not policy.structured_invocation_path_suffixes:
        return 0

    hits = 0
    for path_text in re.findall(r"<path>(.*?)</path>", message_text):
        if any(
            path_text.endswith(path_suffix)
            for path_suffix in policy.structured_invocation_path_suffixes
        ):
            hits += 1
    return hits


SKILL_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]*$")


def skill_name_from_path_text(path_text: str) -> str | None:
    match = re.search(r"(?:^|[\s/])\.agents/skills/([^/\s]+)/", path_text)
    if match:
        return match.group(1)
    tool_output_match = re.search(r"docs/tool-output/([a-z0-9._-]+)/", path_text)
    if tool_output_match:
        return tool_output_match.group(1)
    run_match = re.search(
        r"docs/run/([a-z0-9._-]+?)-(?=\d{8}(?:\D|$)|\d{4}(?:\D|$)|[0-9a-f]{6,}(?:\D|$)|run(?:\D|$)|\d(?:\D|$))",
        path_text,
    )
    if run_match:
        return run_match.group(1)
    return None


SCRIPT_EXECUTORS = {
    "bash",
    "bun",
    "deno",
    "node",
    "npx",
    "perl",
    "python",
    "python3",
    "ruby",
    "sh",
    "zsh",
}
SCRIPT_READERS = {
    "awk",
    "bat",
    "cat",
    "cut",
    "find",
    "git grep",
    "grep",
    "head",
    "jq",
    "less",
    "ls",
    "more",
    "nl",
    "rg",
    "sed",
    "sort",
    "tail",
    "tee",
    "tr",
    "uniq",
    "wc",
}
INSPECTION_SETUP_COMMANDS = {
    "cd",
    "mkdir",
    "pwd",
    "set",
    "true",
}


def command_tokens(command: str) -> list[str]:
    try:
        return shlex.split(command)
    except ValueError:
        return command.split()


def skip_env_wrapper_options(tokens: list[str]) -> list[str]:
    index = 1
    while index < len(tokens):
        token = tokens[index]
        if token == "--":
            index += 1
            break
        if "=" in token and not token.startswith(("./", "/", ".agents/")):
            index += 1
            continue
        if token.startswith("-"):
            index += 1
            if token in {"-u", "--unset", "-C", "--chdir"} and index < len(tokens):
                index += 1
            continue
        break
    return tokens[index:]


def skip_sudo_wrapper_options(tokens: list[str]) -> list[str]:
    index = 1
    options_with_values = {
        "-A",
        "-a",
        "-b",
        "-C",
        "-c",
        "-D",
        "-g",
        "-h",
        "-p",
        "-R",
        "-r",
        "-T",
        "-t",
        "-U",
        "-u",
        "--askpass",
        "--background",
        "--chdir",
        "--close-from",
        "--group",
        "--host",
        "--login-class",
        "--prompt",
        "--role",
        "--type",
        "--user",
    }
    while index < len(tokens):
        token = tokens[index]
        if token == "--":
            index += 1
            break
        if not token.startswith("-"):
            break
        index += 1
        if token in options_with_values and index < len(tokens):
            index += 1
    return tokens[index:]


def shell_inner_command(tokens: list[str]) -> str | None:
    index = 1
    options_with_values = {"-o", "+o", "-O", "+O", "--rcfile", "--init-file"}
    while index < len(tokens):
        token = tokens[index]
        if token == "--":
            return None
        if not token.startswith(("-", "+")):
            return None
        if token in options_with_values:
            index += 2
            continue
        if token.startswith("--"):
            index += 1
            continue
        short_options = token.lstrip("-+")
        if "o" in short_options or "O" in short_options:
            index += 2
            continue
        if "c" in short_options:
            inner_index = index + 1
            if inner_index < len(tokens) and tokens[inner_index] == "--":
                inner_index += 1
            return tokens[inner_index] if inner_index < len(tokens) else None
        index += 1
    return None


def command_invokes_skill_script_tokens(tokens: list[str], skill_name: str) -> bool:
    if not tokens:
        return False
    command_name = Path(tokens[0]).name
    if command_name == "env":
        return command_invokes_skill_script_tokens(
            skip_env_wrapper_options(tokens),
            skill_name,
        )
    if command_name == "sudo":
        return command_invokes_skill_script_tokens(
            skip_sudo_wrapper_options(tokens),
            skill_name,
        )
    if command_name in SCRIPT_READERS:
        return False
    if command_name in {"bash", "sh", "zsh"}:
        inner_command = shell_inner_command(tokens)
        if inner_command is not None:
            return command_invokes_skill_script(inner_command, skill_name)
    marker = f".agents/skills/{skill_name}/scripts/"
    if command_name in SCRIPT_EXECUTORS:
        return any(marker in token for token in tokens[1:])
    return marker in tokens[0]


def command_invokes_skill_script(command: str, skill_name: str) -> bool:
    marker = f".agents/skills/{skill_name}/scripts/"
    if marker not in command:
        return False
    return command_invokes_skill_script_tokens(command_tokens(command), skill_name)


def extract_raw_command_execution_commands(payload: dict[str, object]) -> list[str]:
    if payload.get("type") != "command_execution":
        return []
    command = (
        payload.get("command")
        or payload.get("cmd")
        or first_dict(payload.get("input")).get("cmd")
    )
    return [command] if isinstance(command, str) else []


def ensure_usage_entry(usage: dict[str, dict[str, object]], name: str) -> dict[str, object]:
    if name not in usage:
        usage[name] = {
            "name": name,
            "declaration_hits": 0,
            "invocation_hits": 0,
            "consult_hits": 0,
            "execution_hits": 0,
            "artifact_hits": 0,
            "has_tool_activity": False,
        }
    return usage[name]


def looks_like_available_skill_catalog(text: str) -> bool:
    lowered = text.lower()
    return "available skills" in lowered or "skills list" in lowered or "skill catalog" in lowered


def extract_structured_skill_invocation_names(message_text: str) -> list[str]:
    names: list[str] = []
    for skill_block in re.findall(r"<skill\b[^>]*>(.*?)</skill>", message_text, flags=re.IGNORECASE | re.DOTALL):
        name_match = re.search(r"<name>([a-z0-9._-]+)</name>", skill_block, flags=re.IGNORECASE)
        path_match = re.search(r"<path>(.*?)</path>", skill_block, flags=re.IGNORECASE | re.DOTALL)
        if not name_match or not path_match:
            continue
        name = name_match.group(1)
        path_text = path_match.group(1).strip()
        if not SKILL_NAME_PATTERN.fullmatch(name):
            continue
        if not path_text.endswith("SKILL.md"):
            continue
        if skill_name_from_path_text(path_text) != name:
            continue
        names.append(name)
    return names


def build_skill_usage_census(events: list[dict[str, object]]) -> list[dict[str, object]]:
    usage: dict[str, dict[str, object]] = {}
    for event in events:
        payload = first_dict(event.get("payload"), event.get("item"), event.get("data"))
        event_type = event.get("type")

        if payload.get("type") == "message":
            message_text = extract_message_text(payload)
            if looks_like_available_skill_catalog(message_text):
                continue
            for name in extract_structured_skill_invocation_names(message_text):
                ensure_usage_entry(usage, name)["invocation_hits"] += 1
            for marker_name in re.findall(r"Using the `?([a-z0-9._-]+)`? skill", message_text, flags=re.IGNORECASE):
                if SKILL_NAME_PATTERN.fullmatch(marker_name):
                    ensure_usage_entry(usage, marker_name)["declaration_hits"] += 1
            continue

        if event_type == "event_msg" and payload.get("type") in {"user_message", "agent_message"}:
            message_text = extract_event_message_text(payload)
            if looks_like_available_skill_catalog(message_text):
                continue
            for name in extract_structured_skill_invocation_names(message_text):
                ensure_usage_entry(usage, name)["invocation_hits"] += 1
            for marker_name in re.findall(r"Using the `?([a-z0-9._-]+)`? skill", message_text, flags=re.IGNORECASE):
                if SKILL_NAME_PATTERN.fullmatch(marker_name):
                    ensure_usage_entry(usage, marker_name)["declaration_hits"] += 1
            continue

        commands = []
        if event_type == "response_item" and payload.get("type") in {"function_call", "custom_tool_call"}:
            commands = extract_exec_commands(payload)
        elif payload.get("type") == "command_execution":
            commands = extract_raw_command_execution_commands(payload)

        if commands:
            for command in commands:
                artifact_matched_known_skill = False
                for known_name, known_entry in usage.items():
                    if (
                        f"docs/tool-output/{known_name}/" in command
                        or f"docs/run/{known_name}-" in command
                    ):
                        known_entry["has_tool_activity"] = True
                        known_entry["artifact_hits"] += 1
                        artifact_matched_known_skill = True

                skill_name = skill_name_from_path_text(command)
                if not skill_name or not SKILL_NAME_PATTERN.fullmatch(skill_name):
                    continue
                entry = ensure_usage_entry(usage, skill_name)
                entry["has_tool_activity"] = True
                if command_invokes_skill_script(command, skill_name):
                    entry["execution_hits"] += 1
                elif f".agents/skills/{skill_name}/" in command:
                    entry["consult_hits"] += 1
                if (
                    f"docs/tool-output/{skill_name}/" in command
                    or f"docs/run/{skill_name}-" in command
                ) and not artifact_matched_known_skill:
                    entry["artifact_hits"] += 1

    active_items = [
        item
        for item in usage.values()
        if item["has_tool_activity"]
        or item["execution_hits"]
        or item["artifact_hits"]
        or item["consult_hits"]
        or item["invocation_hits"]
        or item["declaration_hits"]
    ]
    active_items.sort(key=lambda item: str(item["name"]))
    return active_items


def redact_value(value: object) -> object:
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, list):
        return [redact_value(item) for item in value]
    if isinstance(value, dict):
        return {key: redact_value(item) for key, item in value.items()}
    return value


def tokenize(text: str) -> list[str]:
    return [token for token in re.findall(r"[a-z0-9]+", text.lower()) if token not in STOPWORDS]


def normalize_command_text(command: str) -> str:
    return re.sub(r"\s+", " ", command).strip()


def extract_exit_code(output: str) -> int | None:
    match = re.search(r"Process exited with code (\d+)", output)
    if match:
        return int(match.group(1))
    return None


def extract_message_text(payload: dict[str, object]) -> str:
    parts: list[str] = []
    content = payload.get("content", [])
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict):
                for key in ("text", "input_text", "output_text"):
                    value = item.get(key)
                    if isinstance(value, str) and value.strip():
                        parts.append(value.strip())
    if parts:
        return "\n".join(parts)
    for key in ("text", "message", "content"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def make_turn(index: int) -> dict[str, object]:
    return {
        "index": index,
        "ref": f"turn-{index}",
        "status": "open",
        "messages": [],
        "commands": [],
        "tool_calls": [],
        "reasoning": [],
        "errors": [],
    }


def add_message(
    turn: dict[str, object],
    role: str,
    text: str,
    *,
    source: str | None = None,
) -> dict[str, object]:
    entry_index = len(turn["messages"]) + 1
    message = {
        "ref": f"{turn['ref']}.{role}-{entry_index}",
        "role": role,
        "text": redact_text(text),
    }
    if source:
        message["source"] = source
    turn["messages"].append(message)
    return message


def add_reasoning(turn: dict[str, object], text: str) -> dict[str, object]:
    entry_index = len(turn["reasoning"]) + 1
    item = {
        "ref": f"{turn['ref']}.reasoning-{entry_index}",
        "text": redact_text(text),
    }
    turn["reasoning"].append(item)
    return item


def add_command(
    turn: dict[str, object],
    *,
    tool_name: str,
    command: str,
    output: str,
    exit_code: int | None,
    shared_output: bool = False,
) -> dict[str, object]:
    entry_index = len(turn["commands"]) + 1
    item = {
        "ref": f"{turn['ref']}.command-{entry_index}",
        "tool_name": tool_name,
        "command": redact_text(command),
        "output": redact_text(output),
        "exit_code": exit_code,
    }
    if shared_output:
        item["shared_output"] = True
    turn["commands"].append(item)
    return item


def add_tool_call(
    turn: dict[str, object],
    *,
    name: str,
    arguments: dict[str, object],
    output: str,
) -> dict[str, object]:
    entry_index = len(turn["tool_calls"]) + 1
    item = {
        "ref": f"{turn['ref']}.tool-{entry_index}",
        "name": name,
        "arguments": redact_value(arguments),
        "output": redact_text(output),
    }
    turn["tool_calls"].append(item)
    return item


def add_error(turn: dict[str, object], message: str) -> dict[str, object]:
    entry_index = len(turn["errors"]) + 1
    item = {
        "ref": f"{turn['ref']}.error-{entry_index}",
        "message": redact_text(message),
    }
    turn["errors"].append(item)
    return item


def is_failed_command(command: dict[str, object]) -> bool:
    exit_code = command.get("exit_code")
    if isinstance(exit_code, int) and exit_code != 0:
        return True
    output = str(command.get("output", ""))
    if "failed to load skill" in output.lower():
        return True
    return False


def build_stats(normalized: dict[str, object]) -> dict[str, int]:
    commands = normalized["commands"]
    messages = normalized["user_messages"] + normalized["assistant_messages"]
    return {
        "event_count": int(normalized.get("event_count", 0)),
        "turn_count": len(normalized["turns"]),
        "tool_call_count": len(normalized["tool_calls"]),
        "command_count": len(commands),
        "failed_command_count": len([command for command in commands if is_failed_command(command)]),
        "message_count": len(messages),
    }


def empty_token_usage(*, source: str = "missing") -> dict[str, object]:
    return {
        "source": source,
        "has_usage": False,
        "input_tokens": None,
        "cached_input_tokens": None,
        "output_tokens": None,
        "reasoning_output_tokens": None,
        "total_tokens": None,
        "model_context_window": None,
        "raw_refs": [],
        "last_token_usage": {},
    }


def sanitize_usage_payload(payload: dict[str, object], *, source: str, raw_ref: str | None = None) -> dict[str, object]:
    usage = empty_token_usage(source=source)
    for key in TOKEN_USAGE_KEYS:
        value = payload.get(key)
        if isinstance(value, int):
            usage[key] = value
            usage["has_usage"] = True
    model_context_window = payload.get("model_context_window")
    if isinstance(model_context_window, int):
        usage["model_context_window"] = model_context_window
    if raw_ref:
        usage["raw_refs"] = [raw_ref]
    if usage["total_tokens"] is None:
        computed_total = sum(
            value
            for value in (
                usage["input_tokens"],
                usage["output_tokens"],
                usage["reasoning_output_tokens"],
            )
            if isinstance(value, int)
        )
        if computed_total:
            usage["total_tokens"] = computed_total
            usage["has_usage"] = True
    return usage


def merge_usage_totals(base: dict[str, object], incoming: dict[str, object]) -> dict[str, object]:
    merged = empty_token_usage(source=str(base.get("source") or incoming.get("source") or "missing"))
    merged["has_usage"] = bool(base.get("has_usage")) or bool(incoming.get("has_usage"))
    raw_refs: list[str] = []
    for candidate in (base.get("raw_refs"), incoming.get("raw_refs")):
        if isinstance(candidate, list):
            for ref in candidate:
                if isinstance(ref, str) and ref not in raw_refs:
                    raw_refs.append(ref)
    merged["raw_refs"] = raw_refs
    for key in TOKEN_USAGE_KEYS:
        base_value = base.get(key)
        incoming_value = incoming.get(key)
        values = [value for value in (base_value, incoming_value) if isinstance(value, int)]
        merged[key] = sum(values) if values else None
        if values:
            merged["has_usage"] = True
    merged["model_context_window"] = (
        incoming.get("model_context_window")
        if isinstance(incoming.get("model_context_window"), int)
        else base.get("model_context_window")
    )
    last_usage = incoming.get("last_token_usage") or base.get("last_token_usage") or {}
    merged["last_token_usage"] = last_usage if isinstance(last_usage, dict) else {}
    return merged


def extract_session_token_usage(events: list[dict[str, object]]) -> dict[str, object]:
    latest_total = empty_token_usage(source="missing")
    latest_last_usage: dict[str, object] = {}
    for index, event in enumerate(events, start=1):
        if event.get("type") != "event_msg":
            continue
        payload = event.get("payload")
        if not isinstance(payload, dict) or payload.get("type") != "token_count":
            continue
        info = first_dict(payload.get("info"))
        total_usage = first_dict(info.get("total_token_usage"))
        if total_usage:
            latest_total = sanitize_usage_payload(
                {
                    **total_usage,
                    "model_context_window": info.get("model_context_window"),
                },
                source="session_token_count",
                raw_ref=f"event-{index}.token-count",
            )
        last_usage = first_dict(info.get("last_token_usage"))
        if last_usage:
            latest_last_usage = sanitize_usage_payload(
                last_usage,
                source="session_token_count_last",
                raw_ref=f"event-{index}.token-count",
            )
    if latest_last_usage:
        latest_total["last_token_usage"] = latest_last_usage
    return latest_total


def extract_exec_token_usage(turn_usages: list[dict[str, object]]) -> dict[str, object]:
    aggregated = empty_token_usage(source="exec_turn_usage")
    for usage in turn_usages:
        aggregated = merge_usage_totals(aggregated, usage)
    if aggregated["has_usage"]:
        aggregated["source"] = "exec_turn_usage"
    return aggregated


def summarize_token_usage(usage: dict[str, object]) -> list[str]:
    if not usage.get("has_usage"):
        return ["Token usage was not present in the supplied log."]
    observations: list[str] = []
    if isinstance(usage.get("total_tokens"), int):
        observations.append(f"Total tokens: {usage['total_tokens']}")
    if isinstance(usage.get("input_tokens"), int):
        observations.append(f"Input tokens: {usage['input_tokens']}")
    if isinstance(usage.get("cached_input_tokens"), int):
        observations.append(f"Cached input tokens: {usage['cached_input_tokens']}")
    if isinstance(usage.get("output_tokens"), int):
        observations.append(f"Output tokens: {usage['output_tokens']}")
    last_usage = usage.get("last_token_usage")
    if isinstance(last_usage, dict) and last_usage.get("has_usage") and isinstance(last_usage.get("total_tokens"), int):
        observations.append(f"Last observed step tokens: {last_usage['total_tokens']}")
    return observations


def has_high_token_usage(usage: dict[str, object]) -> bool:
    total_tokens = usage.get("total_tokens")
    input_tokens = usage.get("input_tokens")
    cached_input_tokens = usage.get("cached_input_tokens")
    output_tokens = usage.get("output_tokens")
    last_usage = first_dict(usage.get("last_token_usage"))
    last_total_tokens = last_usage.get("total_tokens")
    return (
        (isinstance(total_tokens, int) and total_tokens >= 100000)
        or (isinstance(input_tokens, int) and input_tokens >= 50000)
        or (
            isinstance(cached_input_tokens, int)
            and cached_input_tokens >= 50000
            and isinstance(input_tokens, int)
            and input_tokens > 0
            and cached_input_tokens >= input_tokens // 2
        )
        or (
            isinstance(input_tokens, int)
            and isinstance(output_tokens, int)
            and input_tokens >= 5000
            and input_tokens >= output_tokens * 10
        )
        or (isinstance(last_total_tokens, int) and last_total_tokens >= 50000)
    )


def build_token_review(
    normalized: dict[str, object],
    findings: list[Finding],
    consultation: dict[str, object],
) -> dict[str, object]:
    usage = normalized.get("usage", empty_token_usage())
    if not isinstance(usage, dict) or not usage.get("has_usage"):
        return {
            "status": "unavailable",
            "observations": ["The supplied log did not contain usable token accounting fields."],
            "savings_opportunities": [],
        }

    observations = summarize_token_usage(usage)
    opportunities: list[str] = []
    input_tokens = usage.get("input_tokens")
    cached_input_tokens = usage.get("cached_input_tokens")
    output_tokens = usage.get("output_tokens")
    total_tokens = usage.get("total_tokens")

    if isinstance(cached_input_tokens, int) and isinstance(input_tokens, int) and input_tokens > 0:
        if cached_input_tokens >= max(1000, input_tokens // 2):
            opportunities.append(
                "Large cached-input footprint: review whether the skill is repeatedly loading the same references or carrying forward more context than necessary."
            )
    if isinstance(input_tokens, int) and isinstance(output_tokens, int) and input_tokens >= max(5000, output_tokens * 10):
        opportunities.append(
            "Input-heavy run relative to output: tighten early stopping, shorten repeated summaries, and avoid loading low-value reference material."
        )
    if consultation.get("timing") in {"late", "never"}:
        opportunities.append(
            "Target skill consultation happened late or not at all: load the skill resources earlier so the run does less improvisation and fewer wasted tokens."
        )
    finding_codes = {finding.code for finding in findings}
    if "command_thrash" in finding_codes or "repeated_failure" in finding_codes:
        opportunities.append(
            "Repeated retries and command thrash consume extra tokens: stop after the second similar failure and switch to diagnosis or root-cause review."
        )
    if "low_signal_trace" in finding_codes and isinstance(total_tokens, int) and total_tokens > 0:
        opportunities.append(
            "Low-signal traces still consumed tokens: prefer a diagnosis-only exit earlier instead of continuing the workflow without stronger evidence."
        )

    deduped_opportunities: list[str] = []
    for item in opportunities:
        if item not in deduped_opportunities:
            deduped_opportunities.append(item)

    return {
        "status": "reviewed",
        "observations": observations,
        "savings_opportunities": deduped_opportunities,
    }


def snippet(text: str, limit: int = 300) -> str:
    cleaned = re.sub(r"\s+", " ", redact_text(text)).strip()
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 3].rstrip() + "..."


def next_fact_id(category_counts: Counter[str], category: str) -> str:
    category_counts[category] += 1
    return f"{category}-{category_counts[category]}"


def add_postmortem_fact(
    facts: list[PostmortemFact],
    category_counts: Counter[str],
    *,
    category: str,
    severity: str,
    title: str,
    text: str,
    evidence_ref: str | None,
    kind: str = "observed",
) -> None:
    fact = PostmortemFact(
        id=next_fact_id(category_counts, category),
        category=category,
        severity=severity,
        kind=kind,
        title=title,
        snippet=snippet(text),
        evidence_ref=evidence_ref,
    )
    if not fact.snippet:
        return
    facts.append(fact)


def text_matches_any(text: str, patterns: list[re.Pattern[str]]) -> bool:
    return any(pattern.search(text) for pattern in patterns)


def postmortem_clauses(text: str) -> list[str]:
    clauses = [
        clause.strip()
        for clause in re.split(
            r"(?<=[.!?])\s+|[\n\r]+|[;]|\bbut\b|,\s*(?:then|and)\b|\band\s+then\b",
            text,
            flags=re.IGNORECASE,
        )
    ]
    return [clause for clause in clauses if clause] or [text]


def has_negated_missing_success(text: str) -> bool:
    return text_matches_any(text, POSTMORTEM_NEGATED_MISSING_SUCCESS_PATTERNS)


def has_negated_prerequisite_success(text: str) -> bool:
    return has_negated_missing_success(text) or text_matches_any(
        text, POSTMORTEM_NEGATED_REQUIRED_SUCCESS_PATTERNS
    )


def has_missing_resource_failure(text: str) -> bool:
    searchable_text = re.sub(
        r"\b(?:no|zero|0)\s+missing\b[^:\n\r,;]*:\s+",
        "",
        text,
        flags=re.IGNORECASE,
    )
    return any(
        text_matches_any(clause, POSTMORTEM_MISSING_FAILURE_PATTERNS)
        and not has_negated_missing_success(clause)
        for clause in re.split(r"[\n\r,;]+|\s+-\s+|\b(?:and|but)\b", searchable_text, flags=re.IGNORECASE)
        if clause.strip()
    )


def has_specific_postmortem_tool_signal(text: str) -> bool:
    if text_matches_any(text, POSTMORTEM_DIRECT_TOOL_FAILURE_PATTERNS):
        return True
    return has_missing_resource_failure(text)


def has_non_shell_direct_tool_signal(text: str) -> bool:
    return text_matches_any(
        text,
        [
            re.compile(r"Invalid environment variables", re.IGNORECASE),
            re.compile(r"Invalid option", re.IGNORECASE),
        ],
    )


def has_non_shell_postmortem_tool_signal(text: str) -> bool:
    if has_missing_resource_failure(text):
        return True
    if has_non_shell_direct_tool_signal(text):
        return True
    return any(
        text_matches_any(clause, PREREQUISITE_PATTERNS)
        and not has_negated_prerequisite_success(clause)
        for clause in re.split(r"[\n\r,;]+|\s+-\s+|\b(?:and|but)\b", text, flags=re.IGNORECASE)
        if clause.strip()
    )


def has_postmortem_status_failure(text: str) -> bool:
    return text_matches_any(text, POSTMORTEM_STATUS_FAILURE_PATTERNS)


def is_zero_count_status_summary_line(line: str) -> bool:
    count_fields = list(re.finditer(r"\b([A-Za-z][A-Za-z -]*):\s*(\d+)\b", line))
    if not count_fields:
        return False

    has_status_count = False
    for match in count_fields:
        key_words = set(match.group(1).lower().split())
        count = int(match.group(2))
        if key_words & POSTMORTEM_ZERO_STATUS_COUNT_KEYS:
            has_status_count = True
            if count != 0:
                return False
    if not has_status_count:
        return False

    residual = re.sub(r"\b[A-Za-z][A-Za-z -]*:\s*\d+\b", "", line)
    residual = re.sub(r"[\s,;:.]+", " ", residual).strip().lower()
    residual_words = set(residual.split()) if residual else set()
    return residual_words <= {"summary", "status", "test", "tests", "result", "results"}


def has_actionable_postmortem_status_failure(text: str) -> bool:
    for line in text.splitlines():
        if is_zero_count_status_summary_line(line):
            continue
        if text_matches_any(line, POSTMORTEM_STATUS_FAILURE_PATTERNS):
            return True
    return False


def has_nonzero_exit_marker(text: str) -> bool:
    return any(int(code) != 0 for code in re.findall(r"Process exited with code (\d+)", text))


def has_postmortem_reviewer_finding(text: str) -> bool:
    return text_matches_any(text, POSTMORTEM_REVIEWER_FINDING_PATTERNS)


def has_explicit_postmortem_status_line(text: str) -> bool:
    return text_matches_any(text, POSTMORTEM_EXPLICIT_STATUS_LINE_PATTERNS)


def is_postmortem_lifecycle_signal_segment(segment: str) -> bool:
    return (
        text_matches_any(segment, POSTMORTEM_LIFECYCLE_PATTERNS)
        and not text_matches_any(segment, POSTMORTEM_LIFECYCLE_NEGATION_PATTERNS)
        and text_matches_any(segment, POSTMORTEM_LIFECYCLE_CONTEXT_PATTERNS)
    )


def postmortem_lifecycle_signal_segments(text: str) -> list[str]:
    return [
        segment
        for segment in postmortem_clauses(text)
        if is_postmortem_lifecycle_signal_segment(segment)
    ]


def has_postmortem_lifecycle_signal(text: str) -> bool:
    return bool(postmortem_lifecycle_signal_segments(text))


def postmortem_lifecycle_severity(text: str) -> str:
    for segment in postmortem_lifecycle_signal_segments(text):
        lowered_segment = segment.lower()
        if "direct prisma" in lowered_segment or "bypassed" in lowered_segment:
            return "high"
    return "medium"


def is_nonzero_exit_code(value: object) -> bool:
    if isinstance(value, int):
        return value != 0
    if isinstance(value, str) and value.strip():
        try:
            return int(value) != 0
        except ValueError:
            return False
    return False


def command_name_from_text(command_text: str) -> str:
    try:
        tokens = shlex.split(command_text)
    except ValueError:
        return ""
    if not tokens:
        return ""

    while tokens and "=" in tokens[0] and not tokens[0].startswith(("./", "/", ".agents/")):
        tokens = tokens[1:]
    if not tokens:
        return ""

    if tokens[0] == "cd":
        if "&&" in tokens:
            next_command = tokens[tokens.index("&&") + 1 :]
            return command_name_from_text(shlex.join(next_command)) if next_command else ""
        for index, token in enumerate(tokens):
            if token.endswith(";"):
                next_command = tokens[index + 1 :]
                return command_name_from_text(shlex.join(next_command)) if next_command else ""

    command_name = Path(tokens[0]).name
    if command_name == "env":
        tokens = skip_env_wrapper_options(tokens)
        return command_name_from_text(shlex.join(tokens)) if tokens else ""
    if command_name == "sudo":
        tokens = skip_sudo_wrapper_options(tokens)
        return command_name_from_text(shlex.join(tokens)) if tokens else ""
    if command_name in {"bash", "sh", "zsh"}:
        inner_command = shell_inner_command(tokens)
        if inner_command:
            return command_name_from_text(inner_command)
    if command_name == "git":
        index = 1
        while index < len(tokens):
            token = tokens[index]
            if token in {"-C", "-c", "--git-dir", "--work-tree"}:
                index += 2
                continue
            if token.startswith("-"):
                index += 1
                continue
            break
        if index < len(tokens) and tokens[index] == "grep":
            return "git grep"
    return command_name


def quoted_shell_segments(command_text: str) -> set[str]:
    segments: set[str] = set()
    current: list[str] = []
    quote: str | None = None
    escaped = False
    for char in command_text:
        if escaped:
            if quote is not None:
                current.append(char)
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if quote is None:
            if char in {"'", '"'}:
                quote = char
                current = []
            continue
        if char == quote:
            segments.add("".join(current))
            quote = None
            current = []
            continue
        current.append(char)
    return segments


def command_names_from_text(command_text: str) -> list[str]:
    try:
        tokens = shlex.split(command_text)
    except ValueError:
        return []
    if not tokens:
        return []

    while tokens and "=" in tokens[0] and not tokens[0].startswith(("./", "/", ".agents/")):
        tokens = tokens[1:]
    if not tokens:
        return []

    command_name = Path(tokens[0]).name
    if command_name == "env":
        tokens = skip_env_wrapper_options(tokens)
        return command_names_from_text(shlex.join(tokens)) if tokens else []
    if command_name == "sudo":
        tokens = skip_sudo_wrapper_options(tokens)
        return command_names_from_text(shlex.join(tokens)) if tokens else []
    if command_name in {"bash", "sh", "zsh"}:
        inner_command = shell_inner_command(tokens)
        if inner_command:
            return command_names_from_text(inner_command)

    tokens = split_compound_shell_operator_tokens(tokens, quoted_shell_segments(command_text))
    names: list[str] = []
    segment: list[str] = []

    def append_segment_name() -> None:
        if not segment:
            return
        name = command_name_from_text(shlex.join(segment))
        if name:
            names.append(name)

    for token in tokens:
        stripped = token.strip()
        if stripped in {"&&", "||", "|", ";"}:
            append_segment_name()
            segment = []
            continue
        segment.append(token)
        if stripped.endswith(";"):
            append_segment_name()
            segment = []
    append_segment_name()
    if not names:
        name = command_name_from_text(command_text)
        if name:
            names.append(name)
    return names


def split_compound_shell_operator_tokens(tokens: list[str], protected_tokens: set[str] | None = None) -> list[str]:
    compact_command_start = (
        r"(?:[./]|node\b|python3?\b|bash\b|sh\b|bun\b|npx\b|pytest\b|deno\b|ruby\b|perl\b|rg\b|grep\b|git\b|sed\b|cat\b|awk\b|find\b|ls\b|head\b|tail\b|nl\b|wc\b)"
    )
    protected_tokens = protected_tokens or set()
    split_tokens: list[str] = []
    for token in tokens:
        if token in protected_tokens:
            parts = [token]
        elif "|" in token and not any(operator in token for operator in ("&&", "||", ";")):
            parts = (
                re.split(r"(\|)", token)
                if re.search(rf"[^\s]\|{compact_command_start}", token)
                else [token]
            )
        elif ";" in token and not any(operator in token for operator in ("&&", "||", "|")):
            parts = (
                re.split(r"(;)", token)
                if re.search(rf";{compact_command_start}", token)
                else [token]
            )
        else:
            parts = re.split(r"(&&|\|\||[;|])", token)
        split_tokens.extend(part for part in parts if part)
    return split_tokens


def is_content_inspection_command(command_text: str) -> bool:
    return any(name in SCRIPT_READERS for name in command_names_from_text(command_text))


def has_non_inspection_work_command(command_text: str) -> bool:
    return any(
        name not in SCRIPT_READERS and name not in INSPECTION_SETUP_COMMANDS
        for name in command_names_from_text(command_text)
    )


def is_postmortem_signal_work_command(command_text: str) -> bool:
    lowered = command_text.lower()
    return any(
        marker in lowered
        for marker in (
            "core8",
            "workflow",
            "trpc",
            "codex-review",
            "review-adapter",
        )
    )


def is_search_command(command_text: str) -> bool:
    return any(name in {"grep", "rg", "git grep"} for name in command_names_from_text(command_text))


def has_parallel_non_exec_tool_call(tool_call: dict[str, object]) -> bool:
    arguments = parse_jsonish(tool_call.get("arguments"))
    tool_uses = arguments.get("tool_uses")
    if not isinstance(tool_uses, list):
        return False
    return any(
        isinstance(tool_use, dict)
        and tool_use.get("recipient_name") not in {"functions.exec_command", "exec_command"}
        for tool_use in tool_uses
    )


def is_search_no_match_output(output_text: str) -> bool:
    stripped = output_text.strip()
    if not stripped:
        return True
    if re.fullmatch(r"Process exited with code 1", stripped) is not None:
        return True
    output_match = re.search(r"(?ms)^Output:\s*(.*)\Z", stripped)
    return "Process exited with code 1" in stripped and bool(
        output_match and not output_match.group(1).strip()
    )


def is_shared_search_no_match_output(output_text: str) -> bool:
    return "Process exited with code 1" in output_text and is_search_no_match_output(output_text)


def is_obvious_reader_failure_command(command_text: str) -> bool:
    return (
        re.search(r"\b(?:missing|not[-_ ]found|no[-_ ]such)(?:[._/-]|\b)", command_text, re.IGNORECASE)
        is not None
        or re.search(r"\b2>\s*/dev/null\b|2>/dev/null", command_text) is not None
    )


def extract_postmortem_facts(normalized: dict[str, object]) -> list[PostmortemFact]:
    facts: list[PostmortemFact] = []
    category_counts: Counter[str] = Counter()
    seen_shared_failure_outputs: set[str] = set()
    commands = [command for command in normalized.get("commands", []) if isinstance(command, dict)]
    shared_search_no_match_outputs = {
        str(command.get("output", ""))
        for command in commands
        if command.get("shared_output") is True
        and is_search_command(str(command.get("command", "")))
        and is_shared_search_no_match_output(str(command.get("output", "")))
    }
    shared_successful_inspection_outputs = {
        str(command.get("output", ""))
        for command in commands
        if command.get("shared_output") is True
        and not is_nonzero_exit_code(command.get("exit_code"))
        and is_content_inspection_command(str(command.get("command", "")))
    }
    shared_successful_search_outputs = {
        str(command.get("output", ""))
        for command in commands
        if command.get("shared_output") is True
        and not is_nonzero_exit_code(command.get("exit_code"))
        and is_search_command(str(command.get("command", "")))
    }
    shared_successful_non_inspection_outputs = {
        str(command.get("output", ""))
        for command in commands
        if command.get("shared_output") is True
        and not is_nonzero_exit_code(command.get("exit_code"))
        and not is_content_inspection_command(str(command.get("command", "")))
    }
    shared_nonzero_action_outputs = {
        str(command.get("output", ""))
        for command in commands
        if command.get("shared_output") is True
        and (
            is_nonzero_exit_code(command.get("exit_code"))
            or has_nonzero_exit_marker(str(command.get("output", "")))
        )
        and (
            has_non_inspection_work_command(str(command.get("command", "")))
            or is_content_inspection_command(str(command.get("command", "")))
        )
    }
    shared_nonzero_work_outputs = {
        str(command.get("output", ""))
        for command in commands
        if command.get("shared_output") is True
        and (
            is_nonzero_exit_code(command.get("exit_code"))
            or has_nonzero_exit_marker(str(command.get("output", "")))
        )
        and has_non_inspection_work_command(str(command.get("command", "")))
    }
    shared_nonzero_work_counts = Counter(
        str(command.get("output", ""))
        for command in commands
        if command.get("shared_output") is True
        and (
            is_nonzero_exit_code(command.get("exit_code"))
            or has_nonzero_exit_marker(str(command.get("output", "")))
        )
        and has_non_inspection_work_command(str(command.get("command", "")))
    )
    shared_ambiguous_nonzero_outputs = {
        output for output, count in shared_nonzero_work_counts.items() if count > 1
    }
    shared_nonzero_inspection_outputs = {
        str(command.get("output", ""))
        for command in commands
        if command.get("shared_output") is True
        and (
            is_nonzero_exit_code(command.get("exit_code"))
            or has_nonzero_exit_marker(str(command.get("output", "")))
        )
        and is_content_inspection_command(str(command.get("command", "")))
    }
    shared_ambiguous_nonzero_outputs.update(
        output
        for output in shared_nonzero_work_outputs
        if output in shared_nonzero_inspection_outputs
    )
    shared_parallel_non_exec_outputs = {
        str(tool_call.get("output", ""))
        for tool_call in normalized.get("tool_calls", [])
        if isinstance(tool_call, dict)
        and str(tool_call.get("name", "")) == "multi_tool_use.parallel"
        and has_parallel_non_exec_tool_call(tool_call)
    }
    for command in commands:
        command_text = str(command.get("command", ""))
        output_text = str(command.get("output", ""))
        combined = f"{command_text}\n{output_text}"
        exit_code = command.get("exit_code")
        has_shared_output = command.get("shared_output") is True
        has_nonzero_exit = is_nonzero_exit_code(exit_code) or (
            has_shared_output and has_nonzero_exit_marker(output_text)
        )
        has_specific_tool_signal = has_specific_postmortem_tool_signal(output_text)
        has_nonzero_tool_signal = text_matches_any(
            output_text,
            POSTMORTEM_NONZERO_TOOL_FAILURE_PATTERNS,
        )
        has_reviewer_finding = has_postmortem_reviewer_finding(output_text)
        has_status_failure = has_postmortem_status_failure(output_text)
        has_actionable_status_failure = has_actionable_postmortem_status_failure(output_text)
        is_inspection_command = is_content_inspection_command(command_text)
        has_work_command = has_non_inspection_work_command(command_text)
        has_signal_work_command = is_postmortem_signal_work_command(command_text)
        is_inspection_only_command = (
            is_inspection_command and not has_work_command
        )
        is_search_no_match = (
            is_search_command(command_text)
            and is_search_no_match_output(output_text)
            and (
                exit_code == 1
                or exit_code == "1"
                or (has_shared_output and is_shared_search_no_match_output(output_text))
            )
        )
        if is_search_no_match:
            continue
        if (
            has_shared_output
            and output_text in shared_search_no_match_outputs
            and not is_search_command(command_text)
            and not has_work_command
            and not is_obvious_reader_failure_command(command_text)
        ):
            continue
        if (
            has_shared_output
            and has_nonzero_exit
            and output_text in shared_ambiguous_nonzero_outputs
        ):
            continue
        if has_shared_output and output_text in shared_parallel_non_exec_outputs:
            continue
        if (
            has_shared_output
            and has_nonzero_exit
            and output_text in shared_nonzero_work_outputs
            and not has_work_command
        ):
            continue
        if (
            has_shared_output
            and has_nonzero_exit
            and output_text in shared_nonzero_action_outputs
            and not has_work_command
            and not is_inspection_command
        ):
            continue
        if (
            has_shared_output
            and output_text in shared_successful_search_outputs
            and not has_nonzero_exit
            and not (
                has_signal_work_command
                and has_explicit_postmortem_status_line(output_text)
                and has_actionable_status_failure
            )
            and not (has_signal_work_command and has_specific_tool_signal)
        ):
            continue
        if (
            has_shared_output
            and output_text in shared_successful_inspection_outputs
            and not has_nonzero_exit
            and output_text not in shared_successful_non_inspection_outputs
            and not has_specific_tool_signal
            and not has_reviewer_finding
            and not (has_actionable_status_failure and has_work_command)
        ):
            continue
        if (
            has_shared_output
            and output_text in shared_successful_search_outputs
            and not has_nonzero_exit
            and not has_specific_tool_signal
            and not has_reviewer_finding
            and not (has_actionable_status_failure and has_work_command)
        ):
            continue
        if (
            has_shared_output
            and has_explicit_postmortem_status_line(output_text)
            and has_actionable_status_failure
            and has_work_command
        ):
            if output_text in seen_shared_failure_outputs:
                continue
            seen_shared_failure_outputs.add(output_text)
            add_postmortem_fact(
                facts,
                category_counts,
                category="tool",
                severity="high",
                title="Command or tool path failed",
                text=combined,
                evidence_ref=str(command.get("ref")) if command.get("ref") else None,
            )
            continue
        if has_shared_output and (has_specific_tool_signal or has_reviewer_finding) and has_work_command:
            if output_text in seen_shared_failure_outputs:
                continue
            seen_shared_failure_outputs.add(output_text)
            add_postmortem_fact(
                facts,
                category_counts,
                category="tool",
                severity="high",
                title="Command or tool path failed",
                text=combined,
                evidence_ref=str(command.get("ref")) if command.get("ref") else None,
            )
            continue
        if has_shared_output and has_nonzero_exit:
            if output_text in seen_shared_failure_outputs:
                continue
            seen_shared_failure_outputs.add(output_text)
            add_postmortem_fact(
                facts,
                category_counts,
                category="tool",
                severity="high" if has_nonzero_tool_signal or has_status_failure else "medium",
                title="Command or tool path failed",
                text=combined,
                evidence_ref=str(command.get("ref")) if command.get("ref") else None,
            )
            continue
        if (
            has_nonzero_exit
            or (has_specific_tool_signal and not is_inspection_only_command and not has_shared_output)
            or (has_reviewer_finding and not is_inspection_only_command and not has_shared_output)
            or (
                has_actionable_status_failure
                and not is_inspection_only_command
                and not has_shared_output
            )
        ):
            add_postmortem_fact(
                facts,
                category_counts,
                category="tool",
                severity="high"
                if (
                    "Expected date" in output_text
                    or "Invalid environment" in output_text
                    or has_nonzero_tool_signal
                    or has_specific_tool_signal
                    or has_reviewer_finding
                    or has_status_failure
                )
                else "medium",
                title="Command or tool path failed",
                text=combined,
                evidence_ref=str(command.get("ref")) if command.get("ref") else None,
            )

    command_tool_names = {"exec_command", "functions.exec_command"}
    for tool_call in normalized.get("tool_calls", []):
        if not isinstance(tool_call, dict):
            continue
        name = str(tool_call.get("name", ""))
        if name in command_tool_names:
            continue
        output_text = str(tool_call.get("output", ""))
        if (
            name == "multi_tool_use.parallel"
            and commands
            and output_text not in shared_ambiguous_nonzero_outputs
            and not has_parallel_non_exec_tool_call(tool_call)
        ):
            continue
        if not output_text:
            continue
        if (
            has_actionable_postmortem_status_failure(output_text)
            or has_postmortem_reviewer_finding(output_text)
            or has_non_shell_postmortem_tool_signal(output_text)
            or (name == "multi_tool_use.parallel" and has_nonzero_exit_marker(output_text))
        ):
            add_postmortem_fact(
                facts,
                category_counts,
                category="tool",
                severity="high",
                title="Tool call failure or blocker",
                text=f"{name}\n{output_text}",
                evidence_ref=str(tool_call.get("ref")) if tool_call.get("ref") else None,
            )

    for error in normalized.get("errors", []):
        if not isinstance(error, dict):
            continue
        raw_message = error.get("message", "")
        if not isinstance(raw_message, str):
            continue
        message = raw_message.strip()
        if not message:
            continue
        add_postmortem_fact(
            facts,
            category_counts,
            category="tool",
            severity="high",
            title="Trace error event",
            text=message,
            evidence_ref=str(error.get("ref")) if error.get("ref") else None,
        )

    for message in normalized.get("assistant_messages", []):
        if not isinstance(message, dict):
            continue
        text = str(message.get("text", ""))
        ref = str(message.get("ref")) if message.get("ref") else None
        if message.get("source") == "event_msg":
            add_postmortem_fact(
                facts,
                category_counts,
                category="workflow",
                severity="low",
                title="Narrative milestone",
                text=text,
                evidence_ref=ref,
            )
        if has_postmortem_lifecycle_signal(text):
            add_postmortem_fact(
                facts,
                category_counts,
                category="workflow",
                severity=postmortem_lifecycle_severity(text),
                title="Workflow bypass or lifecycle caveat",
                text=text,
                evidence_ref=ref,
            )
        if text_matches_any(text, POSTMORTEM_OVERCLAIM_PATTERNS):
            add_postmortem_fact(
                facts,
                category_counts,
                category="workflow",
                severity="medium",
                title="No-overclaim caveat",
                text=text,
                evidence_ref=ref,
            )

    for message in normalized.get("user_messages", []):
        if not isinstance(message, dict):
            continue
        if message.get("source") != "event_msg":
            continue
        text = str(message.get("text", ""))
        ref = str(message.get("ref")) if message.get("ref") else None
        add_postmortem_fact(
            facts,
            category_counts,
            category="workflow",
            severity="low",
            title="Narrative milestone",
            text=text,
            evidence_ref=ref,
        )

    usage = first_dict(normalized.get("usage"))
    if usage.get("has_usage") and isinstance(usage.get("total_tokens"), int):
        raw_refs = usage.get("raw_refs")
        evidence_ref = None
        if isinstance(raw_refs, list) and raw_refs:
            evidence_ref = str(raw_refs[-1])
        token_title = (
            "High token usage observed"
            if has_high_token_usage(usage)
            else "Token accounting available"
        )
        add_postmortem_fact(
            facts,
            category_counts,
            category="token",
            severity="medium",
            title=token_title,
            text="; ".join(summarize_token_usage(usage)),
            evidence_ref=evidence_ref,
        )

    if not facts:
        add_postmortem_fact(
            facts,
            category_counts,
            category="workflow",
            severity="low",
            title="Low-signal postmortem",
            text="The trace did not contain strong command failure, lifecycle bypass, or token accounting signals.",
            evidence_ref=None,
        )

    return facts


POSTMORTEM_SEVERITY_RANK = {"low": 1, "medium": 2, "high": 3}


def strongest_postmortem_severity(facts: list[PostmortemFact], default: str = "medium") -> str:
    if not facts:
        return default
    return max(
        facts,
        key=lambda fact: POSTMORTEM_SEVERITY_RANK.get(fact.severity, 0),
    ).severity


def is_low_signal_postmortem(facts: list[PostmortemFact]) -> bool:
    return (
        len(facts) == 1
        and facts[0].category == "workflow"
        and facts[0].severity == "low"
        and facts[0].title == "Low-signal postmortem"
    )


def is_actionable_postmortem_fact(fact: PostmortemFact) -> bool:
    if fact.title in {"Low-signal postmortem", "Narrative milestone", "Token accounting available"}:
        return False
    return fact.severity in {"medium", "high"}


def build_postmortem_suggestions(facts: list[PostmortemFact]) -> list[PostmortemSuggestion]:
    if is_low_signal_postmortem(facts):
        return []

    by_category: dict[str, list[PostmortemFact]] = {}
    for fact in facts:
        if not is_actionable_postmortem_fact(fact):
            continue
        by_category.setdefault(fact.category, []).append(fact)

    suggestions: list[PostmortemSuggestion] = []

    if "tool" in by_category:
        suggestions.append(
            PostmortemSuggestion(
                title="Harden the supported tool or CLI path",
                category="tool",
                severity=strongest_postmortem_severity(by_category["tool"]),
                rationale="One or more supported command paths failed before the workflow could complete normally.",
                evidence_refs=[
                    fact.evidence_ref
                    for fact in by_category["tool"]
                    if fact.evidence_ref
                ],
                suggested_target="tooling/CLI command surface",
            )
        )

    if "workflow" in by_category:
        suggestions.append(
            PostmortemSuggestion(
                title="Clarify lifecycle-safe operator workflow",
                category="workflow",
                severity=strongest_postmortem_severity(by_category["workflow"]),
                rationale=(
                    "The session showed lifecycle caveats, bypasses, or no-overclaim risks "
                    "that need explicit workflow support."
                ),
                evidence_refs=[
                    fact.evidence_ref
                    for fact in by_category["workflow"]
                    if fact.evidence_ref
                ],
                suggested_target="skills and operator workflow docs",
            )
        )

    if "token" in by_category:
        suggestions.append(
            PostmortemSuggestion(
                title="Add token budget checkpoints",
                category="token",
                severity=strongest_postmortem_severity(by_category["token"]),
                rationale=(
                    "The session used enough context that future runs need an explicit budget "
                    "checkpoint before repeating large inputs or review loops."
                ),
                evidence_refs=[
                    fact.evidence_ref
                    for fact in by_category["token"]
                    if fact.evidence_ref
                ],
                suggested_target="skills and operator workflow docs",
            )
        )

    return suggestions


def is_postmortem_command_failure_fact(fact: PostmortemFact) -> bool:
    return (
        is_actionable_postmortem_fact(fact)
        and fact.category == "tool"
        and isinstance(fact.evidence_ref, str)
        and fact.title
        in {"Command or tool path failed", "Tool call failure or blocker", "Trace error event"}
    )


def count_postmortem_command_failure_facts(facts: list[PostmortemFact]) -> int:
    refs = {
        fact.evidence_ref
        for fact in facts
        if is_postmortem_command_failure_fact(fact) and fact.evidence_ref
    }
    return len(refs)


def count_postmortem_commands(normalized: dict[str, object], failed_command_count: int) -> int:
    stats = first_dict(normalized.get("stats"))
    commands = [
        command for command in normalized.get("commands", []) if isinstance(command, dict)
    ]
    stats_command_count = stats.get("command_count")
    if isinstance(stats_command_count, int):
        return max(stats_command_count, len(commands), failed_command_count)
    return max(len(commands), failed_command_count)


def build_postmortem_timeline(normalized: dict[str, object], failed_command_count: int) -> list[str]:
    lines: list[str] = []
    user_messages = [
        message for message in normalized.get("user_messages", []) if isinstance(message, dict)
    ]
    assistant_messages = [
        message for message in normalized.get("assistant_messages", []) if isinstance(message, dict)
    ]

    if user_messages:
        first_user_text = snippet(str(user_messages[0].get("text", "")), limit=180)
        if first_user_text:
            lines.append(f"- Initial request: {first_user_text}")

    if failed_command_count:
        lines.append(f"- Failed supported command paths: {failed_command_count}")
    else:
        lines.append("- No command failures were detected.")

    if assistant_messages:
        final_assistant_text = snippet(str(assistant_messages[-1].get("text", "")), limit=220)
        if final_assistant_text:
            lines.append(f"- Final assistant caveat or outcome: {final_assistant_text}")

    return lines


def render_fact_list(facts: list[PostmortemFact]) -> list[str]:
    if not facts:
        return ["- No facts in this category."]
    lines: list[str] = []
    for fact in facts:
        fact_ref = f" Fact: `{fact.id}`."
        ref = f" Trace ref: `{fact.evidence_ref}`." if fact.evidence_ref else ""
        lines.append(
            f"- **{fact.title}** (`{fact.category}`, `{fact.severity}`, {fact.kind.title()}). "
            f"{fact.snippet}{fact_ref}{ref}"
        )
    return lines


def build_postmortem_next_steps(facts: list[PostmortemFact]) -> list[str]:
    actionable_facts = [fact for fact in facts if is_actionable_postmortem_fact(fact)]
    if not actionable_facts:
        return ["- Capture clearer command, artifact, and outcome evidence before rerunning the postmortem."]

    categories = {fact.category for fact in actionable_facts}
    titles = {fact.title for fact in actionable_facts}
    lines: list[str] = []

    if "tool" in categories:
        lines.append(
            "- Prefer supported commands when available; if a supported path fails, record the exact error before switching approach."
        )
    if "Workflow bypass or lifecycle caveat" in titles:
        lines.append(
            "- Stop when a workflow lifecycle bypass would be required and record the blocker before using a direct workaround."
        )
    elif "workflow" in categories:
        lines.append("- Add an explicit checkpoint before changing workflow state or switching strategy.")
    if "No-overclaim caveat" in titles:
        lines.append("- State draft, approval, and generated-output caveats only when the trace supports them.")
    if "token" in categories:
        lines.append("- Set a token budget checkpoint before repeating large context or review loops.")

    return lines


def build_postmortem_report(
    *,
    trace_path: Path,
    trace_format: str,
    source_label: str,
    source_metadata: dict[str, object],
    normalized: dict[str, object],
    facts: list[PostmortemFact],
    suggestions: list[PostmortemSuggestion],
    mode: str,
    judge_output: dict[str, object] | None,
    judge_error: str,
) -> str:
    observed_facts = [fact for fact in facts if fact.kind == "observed"]
    observed_failure_facts = [
        fact for fact in observed_facts if is_actionable_postmortem_fact(fact)
    ]
    inferred_facts = [fact for fact in facts if fact.kind == "inferred"]
    facts_by_category: dict[str, list[PostmortemFact]] = {}
    for fact in facts:
        facts_by_category.setdefault(fact.category, []).append(fact)
    failed_command_count = count_postmortem_command_failure_facts(observed_failure_facts)
    command_count = count_postmortem_commands(normalized, failed_command_count)

    lines = [
        "# Codex Session Postmortem",
        "",
        f"- Trace path: `{trace_path}`",
        f"- Trace format: `{trace_format}`",
        f"- Trace source: `{source_label}`",
        f"- Analysis mode: `{mode}`",
    ]
    session_id = source_metadata.get("session_id") or source_metadata.get("resolved_session_id")
    if isinstance(session_id, str):
        lines.append(f"- Session id: `{session_id}`")
    matched_cwd = source_metadata.get("matched_cwd")
    if isinstance(matched_cwd, str):
        lines.append(f"- Matched cwd: `{matched_cwd}`")

    lines.extend(["", "## What Happened?", ""])
    lines.extend(build_postmortem_timeline(normalized, failed_command_count))
    lines.append("")
    stats = first_dict(normalized.get("stats"))
    for key in ("event_count", "turn_count", "command_count", "failed_command_count", "tool_call_count"):
        if key in stats:
            if key == "failed_command_count":
                value = failed_command_count
            elif key == "command_count":
                value = command_count
            else:
                value = stats[key]
            lines.append(f"- {key.replace('_', ' ').title()}: {value}")
    if not stats:
        lines.append("- Trace statistics were unavailable.")

    lines.extend(["", "## What Failed?", "", "### Observed", ""])
    if failed_command_count == 0:
        lines.append("- No command failures were detected.")
    if observed_failure_facts:
        lines.extend(render_fact_list(observed_failure_facts))
    else:
        lines.append("- No observed failure facts were extracted.")

    lines.extend(["", "## Why Did It Fail?", "", "### Inferred", ""])
    if inferred_facts:
        lines.extend(render_fact_list(inferred_facts))
    else:
        lines.append("- No additional inferred facts were generated beyond the observed evidence.")

    lines.extend(["", "### Categories", ""])
    for category in sorted(facts_by_category):
        lines.append(f"- `{category}`: {len(facts_by_category[category])} fact(s)")

    lines.extend(["", "## Token Review", ""])
    usage = first_dict(normalized.get("usage"))
    if usage.get("has_usage"):
        for observation in summarize_token_usage(usage):
            lines.append(f"- {observation}")
    else:
        lines.append("- Token review unavailable because the trace did not expose token accounting fields.")

    if judge_output:
        lines.extend(["", "## Judge Synthesis", ""])
        lines.append(f"- Summary: {judge_output.get('summary', '')}")
    elif judge_error:
        lines.extend(["", "## Judge Synthesis", ""])
        lines.append("- Judge stage failed; deterministic postmortem output was used.")
        lines.append(f"- Error: {judge_error}")

    lines.extend(["", "## What Should Change?", ""])
    if suggestions:
        for suggestion in suggestions:
            lines.append(f"- **{suggestion.title}** (`{suggestion.category}`, `{suggestion.severity}`)")
            lines.append(f"  Rationale: {suggestion.rationale}")
            if suggestion.suggested_target:
                lines.append(f"  Target: `{suggestion.suggested_target}`")
            if suggestion.fact_refs:
                lines.append(f"  Fact refs: {', '.join(suggestion.fact_refs)}")
            if suggestion.evidence_refs:
                lines.append(f"  Trace refs: {', '.join(suggestion.evidence_refs)}")
    else:
        lines.append("- No concrete recommendation was generated.")

    lines.extend(["", "## What Should We Do Next Time?", ""])
    lines.extend(build_postmortem_next_steps(facts))
    return "\n".join(lines).rstrip() + "\n"


def normalize_stored_session(events: list[dict[str, object]]) -> dict[str, object]:
    outputs_by_call_id: dict[str, str] = {}
    turn = make_turn(1)
    for event in events:
        if event.get("type") != "response_item":
            continue
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        if payload.get("type") not in {"function_call_output", "custom_tool_call_output"}:
            continue
        call_id = payload.get("call_id")
        output = payload.get("output")
        if isinstance(call_id, str) and isinstance(output, str):
            outputs_by_call_id[call_id] = output

    for event in events:
        event_type = event.get("type")
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        if event_type == "event_msg" and payload.get("type") in {"user_message", "agent_message"}:
            text = extract_event_message_text(payload)
            if text:
                role = "user" if payload.get("type") == "user_message" else "assistant"
                add_message(turn, role, text, source="event_msg")
            continue
        if event_type != "response_item":
            continue
        payload_type = str(payload.get("type", ""))
        if payload_type == "message":
            text = extract_message_text(payload)
            if not text:
                continue
            role = str(payload.get("role", "assistant"))
            add_message(turn, role if role in {"user", "assistant"} else "assistant", text)
        elif payload_type == "reasoning":
            summary = extract_message_text(payload) or str(payload.get("summary", "")).strip()
            if summary:
                add_reasoning(turn, summary)
        elif payload_type in {"function_call", "custom_tool_call"}:
            arguments = parse_jsonish(payload.get("arguments"))
            name = str(payload.get("name", payload_type))
            call_id = str(payload.get("call_id", ""))
            output_text = outputs_by_call_id.get(call_id, "")
            tool_call = add_tool_call(turn, name=name, arguments=arguments, output=output_text)
            if name in {"exec_command", "functions.exec_command"}:
                command = arguments.get("cmd")
                if isinstance(command, str):
                    add_command(
                        turn,
                        tool_name=name,
                        command=command,
                        output=output_text,
                        exit_code=extract_exit_code(output_text),
                    )
            elif name == "multi_tool_use.parallel":
                for command in extract_exec_commands(payload):
                    add_command(
                        turn,
                        tool_name=name,
                        command=command,
                        output=output_text,
                        exit_code=extract_exit_code(output_text),
                        shared_output=True,
                    )
            tool_call["call_id"] = call_id

    turn["status"] = "completed"
    normalized = {
        "format": "stored_session_jsonl",
        "turns": [turn],
        "tool_calls": list(turn["tool_calls"]),
        "commands": list(turn["commands"]),
        "user_messages": [item for item in turn["messages"] if item["role"] == "user"],
        "assistant_messages": [item for item in turn["messages"] if item["role"] == "assistant"],
        "event_count": len(events),
        "errors": list(turn["errors"]),
        "usage": extract_session_token_usage(events),
    }
    normalized["stats"] = build_stats(normalized)
    return normalized


def normalize_exec_trace(events: list[dict[str, object]]) -> dict[str, object]:
    turns: list[dict[str, object]] = []
    current_turn: dict[str, object] | None = None
    turn_usages: list[dict[str, object]] = []

    def ensure_turn() -> dict[str, object]:
        nonlocal current_turn
        if current_turn is None:
            current_turn = make_turn(len(turns) + 1)
        return current_turn

    for event in events:
        event_type = str(event.get("type", ""))
        if event_type == "turn.started":
            if current_turn is not None:
                current_turn["status"] = "completed"
                turns.append(current_turn)
            current_turn = make_turn(len(turns) + 1)
            continue

        payload = first_dict(event.get("item"), event.get("payload"), event.get("data"))
        turn = ensure_turn()

        if event_type == "error":
            message = event.get("message") or payload.get("message")
            if isinstance(message, str):
                add_error(turn, message)
            continue

        item_type = str(payload.get("type", event_type))
        if item_type == "message":
            text = extract_message_text(payload)
            if text:
                role = str(payload.get("role", event.get("role", "assistant")))
                add_message(turn, role if role in {"user", "assistant"} else "assistant", text)
        elif item_type == "reasoning":
            summary = extract_message_text(payload) or str(payload.get("summary", "")).strip()
            if summary:
                add_reasoning(turn, summary)
        elif item_type == "command_execution":
            command = (
                payload.get("command")
                or payload.get("cmd")
                or first_dict(payload.get("input")).get("cmd")
            )
            output_text = (
                payload.get("aggregated_output")
                or payload.get("output")
                or first_dict(payload.get("result")).get("output")
                or ""
            )
            result = first_dict(payload.get("result"))
            exit_code = payload.get("exit_code")
            if not isinstance(exit_code, int):
                exit_code = result.get("exit_code")
            if isinstance(command, str):
                add_command(
                    turn,
                    tool_name="command_execution",
                    command=command,
                    output=str(output_text),
                    exit_code=exit_code
                    if isinstance(exit_code, int)
                    else extract_exit_code(str(output_text)),
                )
        elif item_type not in {
            "thread.started",
            "turn.started",
            "turn.completed",
            "turn.failed",
            "",
        }:
            output = payload.get("output") or first_dict(payload.get("result")).get("output") or ""
            add_tool_call(
                turn,
                name=item_type,
                arguments=payload,
                output=output if isinstance(output, str) else "",
            )

        if event_type in {"turn.completed", "turn.failed"}:
            turn["status"] = "failed" if event_type == "turn.failed" else str(event.get("status", "completed"))
            if event_type == "turn.failed":
                message = event.get("message") or payload.get("message")
                if isinstance(message, str) and message.strip():
                    add_error(turn, message)
            candidate_usage = first_dict(event.get("usage"), payload.get("usage"))
            if candidate_usage:
                turn_usages.append(
                    sanitize_usage_payload(
                        candidate_usage,
                        source="exec_turn_usage",
                        raw_ref=str(turn["ref"]),
                    )
                )
            turns.append(turn)
            current_turn = None

    if current_turn is not None:
        current_turn["status"] = "completed"
        turns.append(current_turn)

    normalized = {
        "format": "exec_json",
        "turns": turns or [make_turn(1)],
        "tool_calls": [item for turn in turns for item in turn["tool_calls"]],
        "commands": [item for turn in turns for item in turn["commands"]],
        "user_messages": [item for turn in turns for item in turn["messages"] if item["role"] == "user"],
        "assistant_messages": [item for turn in turns for item in turn["messages"] if item["role"] == "assistant"],
        "event_count": len(events),
        "errors": [item for turn in turns for item in turn["errors"]],
        "usage": extract_exec_token_usage(turn_usages),
    }
    normalized["stats"] = build_stats(normalized)
    return normalized


def normalize_trace(events: list[dict[str, object]], trace_format: str) -> dict[str, object]:
    if trace_format == "stored_session_jsonl":
        return normalize_stored_session(events)
    if trace_format == "exec_json":
        return normalize_exec_trace(events)
    normalized = {
        "format": trace_format,
        "turns": [make_turn(1)],
        "tool_calls": [],
        "commands": [],
        "user_messages": [],
        "assistant_messages": [],
        "event_count": len(events),
        "errors": [],
        "usage": empty_token_usage(),
    }
    normalized["stats"] = build_stats(normalized)
    return normalized


def render_markdown_transcript(normalized: dict[str, object], trace_format: str) -> str:
    lines = [
        "# Codex Trace Transcript",
        "",
        f"- trace_format: `{trace_format}`",
        f"- turns: {len(normalized['turns'])}",
        "",
    ]
    token_usage = normalized.get("usage", {})
    if isinstance(token_usage, dict):
        lines.extend(["## Token Usage", ""])
        for observation in summarize_token_usage(token_usage):
            lines.append(f"- {observation}")
        raw_refs = token_usage.get("raw_refs")
        if isinstance(raw_refs, list) and raw_refs:
            lines.append(f"- Source refs: {', '.join(str(ref) for ref in raw_refs)}")
        lines.append("")
    for turn in normalized["turns"]:
        lines.append(f"## {turn['ref']} ({turn['status']})")
        lines.append("")
        for message in turn["messages"]:
            lines.append(f"### {message['ref']} [{message['role']}]")
            lines.append("")
            lines.append(message["text"] or "(empty)")
            lines.append("")
        for reasoning in turn["reasoning"]:
            lines.append(f"### {reasoning['ref']} [reasoning]")
            lines.append("")
            lines.append(reasoning["text"] or "(empty)")
            lines.append("")
        for command in turn["commands"]:
            lines.append(f"### {command['ref']} [command]")
            lines.append("")
            lines.append(f"- tool: `{command['tool_name']}`")
            lines.append(f"- command: `{command['command']}`")
            lines.append(f"- exit_code: `{command['exit_code']}`")
            if command["output"]:
                lines.extend(
                    [
                        "",
                        "```text",
                        command["output"],
                        "```",
                    ]
                )
            lines.append("")
        for tool_call in turn["tool_calls"]:
            lines.append(f"### {tool_call['ref']} [tool]")
            lines.append("")
            lines.append(f"- name: `{tool_call['name']}`")
            lines.extend(
                [
                    "",
                    "```json",
                    json.dumps(tool_call["arguments"], indent=2, sort_keys=True),
                    "```",
                    "",
                ]
            )
        for error in turn["errors"]:
            lines.append(f"### {error['ref']} [error]")
            lines.append("")
            lines.append(error["message"])
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def extract_frontmatter_description(skill_md: str) -> str:
    match = re.search(r"^---\n(.*?)\n---", skill_md, re.DOTALL)
    if not match:
        return ""
    frontmatter = match.group(1)
    description_match = re.search(r'^description:\s*(.+)$', frontmatter, re.MULTILINE)
    if not description_match:
        return ""
    description_value = description_match.group(1).strip()
    if description_value.startswith('"') and description_value.endswith('"'):
        try:
            return json.loads(description_value)
        except json.JSONDecodeError:
            return description_value.strip('"')
    return description_value


def extract_request_snippets(user_messages: Iterable[dict[str, object] | str]) -> list[str]:
    snippets: list[str] = []
    for item in user_messages:
        message = item if isinstance(item, str) else str(item.get("text", ""))
        for line in message.splitlines():
            cleaned = re.sub(r"\s+", " ", line).strip(" -#*")
            if not cleaned:
                continue
            lower_cleaned = cleaned.lower()
            if cleaned.startswith("<") and cleaned.endswith(">"):
                continue
            if "instructions for" in lower_cleaned or "agents.md" in lower_cleaned:
                continue
            if cleaned.isupper() and len(cleaned) > 12:
                continue
            if len(cleaned) > 90:
                cleaned = cleaned[:87].rstrip() + "..."
            if cleaned not in snippets:
                snippets.append(cleaned)
            if len(snippets) >= 3:
                return snippets
    return snippets


def infer_skill_consultation(normalized: dict[str, object], skill_path: Path) -> dict[str, object]:
    target_mentions = [
        skill_path.name,
        str(skill_path),
        str(skill_path / "SKILL.md"),
        str(skill_path / "scripts"),
        str(skill_path / "references"),
    ]
    actions: list[dict[str, object]] = []
    for command in normalized["commands"]:
        actions.append(
            {
                "ref": command["ref"],
                "text": f"{command['command']} {command['output']}",
            }
        )
    for tool_call in normalized["tool_calls"]:
        actions.append(
            {
                "ref": tool_call["ref"],
                "text": json.dumps(tool_call["arguments"], sort_keys=True),
            }
        )
    for index, action in enumerate(actions):
        if any(mention in action["text"] for mention in target_mentions):
            if index <= 1:
                timing = "early"
            elif index < max(2, len(actions) // 2):
                timing = "mid"
            else:
                timing = "late"
            return {
                "status": "consulted",
                "timing": timing,
                "ref": action["ref"],
            }
    return {
        "status": "not_consulted",
        "timing": "never",
        "ref": None,
    }


def infer_steering_markers(normalized: dict[str, object]) -> list[dict[str, str]]:
    markers: list[dict[str, str]] = []
    user_messages = normalized["user_messages"]
    for index, message in enumerate(user_messages):
        if index == 0:
            continue
        markers.append(
            {
                "ref": str(message["ref"]),
                "reason": "Additional user input after the initial request suggests steering or correction.",
                "snippet": str(message["text"])[:140],
            }
        )
    return markers


def build_findings(
    normalized: dict[str, object],
    skill_path: Path,
    skill_md: str,
) -> list[Finding]:
    findings: list[Finding] = []
    commands = [command for command in normalized["commands"] if isinstance(command, dict)]
    failed_commands = [command for command in commands if is_failed_command(command)]
    consultation = infer_skill_consultation(normalized, skill_path)
    repeated_failures = Counter(normalize_command_text(str(command.get("command", ""))) for command in failed_commands)
    repeated_failure_commands = [
        command_text
        for command_text, count in repeated_failures.items()
        if command_text and count >= 2
    ]
    if repeated_failure_commands:
        refs = [command["ref"] for command in failed_commands if normalize_command_text(str(command.get("command", ""))) in repeated_failure_commands]
        findings.append(
            Finding(
                code="repeated_failure",
                title="Repeated failing command",
                severity="high",
                category="procedure",
                patch_kind="SKILL_MD_CHANGE",
                evidence_refs=refs[:3],
                evidence=[f"Repeated failing command: `{command}`" for command in repeated_failure_commands[:3]],
                recommendation="Add a retry guardrail and explicit prerequisite checks before repeating the same command.",
            )
        )

    prerequisite_evidence: list[str] = []
    prerequisite_refs: list[str] = []
    for command in failed_commands:
        output = str(command.get("output", ""))
        for pattern in PREREQUISITE_PATTERNS:
            if pattern.search(output):
                prerequisite_evidence.append(f"`{command.get('command', '')}` -> {pattern.pattern}")
                prerequisite_refs.append(str(command.get("ref")))
                break
    if prerequisite_evidence:
        findings.append(
            Finding(
                code="prerequisite_gap",
                title="Prerequisite or environment gap",
                severity="medium",
                category="procedure",
                patch_kind="SKILL_MD_CHANGE",
                evidence_refs=prerequisite_refs[:4],
                evidence=prerequisite_evidence[:4],
                recommendation="Document a preflight step for missing tools, invalid paths, or unsupported inputs before the main workflow runs.",
            )
        )

    unique_commands = {
        normalize_command_text(str(command.get("command", "")))
        for command in commands
        if command.get("command")
    }
    if len(commands) >= 6 and len(unique_commands) <= max(1, len(commands) // 2):
        findings.append(
            Finding(
                code="command_thrash",
                title="Command thrash",
                severity="medium",
                category="context_hygiene",
                patch_kind="SKILL_MD_CHANGE",
                evidence_refs=[str(command["ref"]) for command in commands[:3]],
                evidence=[f"{len(commands)} commands with only {len(unique_commands)} unique command bodies"],
                recommendation="Prefer one fully-shaped command over incremental retries; shape output flags and paths up front.",
            )
        )

    jsonl_commands = [
        command
        for command in commands
        if ".jsonl" in str(command.get("command", "")) and any(token in str(command.get("command", "")) for token in ("jq ", "python ", "python3 ", "rg "))
    ]
    if len(jsonl_commands) >= 3:
        findings.append(
            Finding(
                code="deterministic_trace_work",
                title="Trace parsing work is being repeated manually",
                severity="medium",
                category="deterministic",
                patch_kind="SCRIPT_CHANGE",
                evidence_refs=[str(command["ref"]) for command in jsonl_commands[:3]],
                evidence=[normalize_command_text(str(command["command"])) for command in jsonl_commands[:3]],
                recommendation="Bundle the repeated trace parsing flow into a deterministic helper script instead of rewriting shell/jq commands in every run.",
            )
        )

    if consultation["status"] != "consulted":
        findings.append(
            Finding(
                code="skill_not_consulted",
                title="Target skill resources were not consulted",
                severity="medium",
                category="procedure",
                patch_kind="SKILL_MD_CHANGE",
                evidence_refs=[],
                evidence=["No command or tool call referenced the target skill path, scripts, or references."],
                recommendation="Add an explicit early step to read the target skill's bundled resources before improvising new commands.",
            )
        )

    user_messages = normalized["user_messages"]
    description_tokens = set(tokenize(extract_frontmatter_description(skill_md)))
    request_tokens = tokenize(" ".join(extract_request_snippets(user_messages)))
    missing_tokens = [token for token in request_tokens if token not in description_tokens and len(token) >= 5]
    if missing_tokens:
        findings.append(
            Finding(
                code="trigger_gap",
                title="Description may miss user phrasing",
                severity="low",
                category="routing",
                patch_kind="SKILL_MD_CHANGE",
                evidence_refs=[str(user_messages[0]["ref"])] if user_messages else [],
                evidence=[f"Observed request terms absent from description: {', '.join(missing_tokens[:6])}"],
                recommendation="Broaden the frontmatter description with stable user phrases that recur in traces.",
            )
        )

    if not commands and not normalized["tool_calls"]:
        findings.append(
            Finding(
                code="low_signal_trace",
                title="Low-signal trace",
                severity="low",
                category="verification",
                patch_kind="DIAGNOSIS_ONLY",
                evidence_refs=[],
                evidence=["The trace contained little or no executable work."],
                recommendation="Prefer a richer rerun trace before proposing workflow changes.",
            )
        )
    return findings


def build_skill_summary(skill_path: Path, skill_md: str) -> dict[str, object]:
    references = sorted(path.name for path in (skill_path / "references").glob("*")) if (skill_path / "references").exists() else []
    scripts = sorted(path.name for path in (skill_path / "scripts").glob("*")) if (skill_path / "scripts").exists() else []
    return {
        "name": skill_path.name,
        "path": str(skill_path),
        "description": extract_frontmatter_description(skill_md),
        "has_references": bool(references),
        "references": references,
        "has_scripts": bool(scripts),
        "scripts": scripts,
    }


def build_evidence_pack(
    normalized: dict[str, object],
    findings: list[Finding],
    skill_path: Path,
    skill_md: str,
) -> dict[str, object]:
    consultation = infer_skill_consultation(normalized, skill_path)
    steering_markers = infer_steering_markers(normalized)
    token_review = build_token_review(normalized, findings, consultation)
    evidence_snippets: list[dict[str, str]] = []
    seen_refs: set[str] = set()
    for finding in findings:
        for ref in finding.evidence_refs:
            if ref in seen_refs:
                continue
            seen_refs.add(ref)
            snippet = find_transcript_snippet(normalized, ref)
            if snippet:
                evidence_snippets.append(snippet)

    diagnosis_only = all(finding.patch_kind == "DIAGNOSIS_ONLY" for finding in findings) or (
        not findings or (
            normalized["stats"]["failed_command_count"] == 0
            and not steering_markers
            and consultation["status"] == "not_consulted"
            and normalized["stats"]["command_count"] == 0
        )
    )

    return {
        "skill_summary": build_skill_summary(skill_path, skill_md),
        "trace_summary": {
            "format": normalized["format"],
            "stats": normalized["stats"],
            "token_usage": normalized.get("usage", empty_token_usage()),
        },
        "consultation": consultation,
        "steering_markers": steering_markers,
        "request_snippets": extract_request_snippets(normalized["user_messages"]),
        "findings": [finding.to_dict() for finding in findings],
        "evidence_snippets": evidence_snippets,
        "token_review": token_review,
        "diagnosis_only": diagnosis_only,
    }


def find_transcript_snippet(normalized: dict[str, object], ref: str) -> dict[str, str] | None:
    for turn in normalized["turns"]:
        for bucket, key in (
            ("messages", "text"),
            ("reasoning", "text"),
            ("commands", "command"),
            ("errors", "message"),
            ("tool_calls", "name"),
        ):
            for item in turn[bucket]:
                if item["ref"] == ref:
                    if bucket == "commands":
                        text = f"{item['command']}\n{item['output']}".strip()
                    elif bucket == "tool_calls":
                        text = json.dumps(item["arguments"], sort_keys=True)
                    else:
                        text = str(item[key])
                    return {
                        "ref": ref,
                        "text": text[:500],
                    }
    return None


def build_judge_prompt(skill_path: Path, evidence_path: Path) -> str:
    return f"""
Inspect the repo-local skill at {skill_path}.
Read the redacted evidence pack at {evidence_path}.

Return JSON only, matching the provided schema.

Rules:
- Evaluate workflow quality, not prose style.
- Use the evidence pack only; do not rely on any raw trace input outside that file.
- Default to diagnosis_only when the evidence is weak or contradictory.
- Prefer SKILL.md suggestion targets first.
- Allow references/ suggestions only when the evidence points to reusable checklists, schemas, or long-form guidance.
- Allow scripts/ suggestions only when the evidence shows repeated deterministic work.
- Do not propose assets/ changes.
- Use `breakdowns` for the actionable advice. Ignore `patches`; this workflow is report-only.
""".strip()


def run_judge_prompt(
    prompt: str,
    output_dir: Path,
    model: str,
    schema_path: Path = JUDGE_SCHEMA_PATH,
) -> dict[str, object]:
    codex_output = output_dir / "judge-output.json"
    cmd = [
        "codex",
        "exec",
        "-m",
        model,
        "-s",
        "read-only",
        "--skip-git-repo-check",
        "-C",
        str(REPO_ROOT),
        "--output-schema",
        str(schema_path),
        "-o",
        str(codex_output),
        prompt,
    ]
    result = subprocess.run(
        cmd,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "codex exec failed")
    payload = json.loads(codex_output.read_text())
    if not isinstance(payload, dict):
        raise RuntimeError("Judge output was not a JSON object")
    for name in DIMENSION_NAMES:
        if name not in first_dict(payload.get("dimension_scores")):
            raise RuntimeError(f"Judge output missing dimension score: {name}")
    return payload


def run_judge(skill_path: Path, evidence_path: Path, output_dir: Path, model: str) -> dict[str, object]:
    return run_judge_prompt(
        build_judge_prompt(skill_path, evidence_path),
        output_dir,
        model,
    )


def patch_kind_to_target(patch_kind: str) -> str:
    mapping = {
        "SKILL_MD_CHANGE": "SKILL.md",
        "REFERENCES_CHANGE": "references/",
        "SCRIPT_CHANGE": "scripts/",
        "TOOLING_CHANGE": "agents/openai.yaml",
        "DIAGNOSIS_ONLY": "diagnosis_only",
    }
    return mapping.get(patch_kind, "SKILL.md")


def build_local_suggestions(findings: list[Finding]) -> list[SuggestedChange]:
    suggestions: list[SuggestedChange] = []
    for finding in findings:
        if finding.patch_kind == "DIAGNOSIS_ONLY":
            continue
        suggestions.append(
            SuggestedChange(
                target=patch_kind_to_target(finding.patch_kind),
                risk_level=finding.severity,
                rationale=finding.title,
                suggestion=finding.recommendation,
                expected_benefit="Reduce recurrence of the observed trace-backed failure.",
                evidence_refs=finding.evidence_refs,
            )
        )
    return suggestions


def judge_breakdown_patch_kind(breakdown: dict[str, object]) -> str:
    return str(breakdown.get("patch_kind", "SKILL_MD_CHANGE"))


def judge_breakdown_risk(breakdown: dict[str, object]) -> str:
    return str(breakdown.get("risk", breakdown.get("severity", "medium")))


def judge_breakdown_evidence_refs(breakdown: dict[str, object]) -> list[str]:
    refs = breakdown.get("evidence_refs", [])
    if not isinstance(refs, list):
        return []
    return [str(ref) for ref in refs if isinstance(ref, str)]


def judge_breakdown_fact_refs(breakdown: dict[str, object]) -> list[str]:
    refs = breakdown.get("fact_refs", [])
    if not isinstance(refs, list):
        return []
    return [str(ref) for ref in refs if isinstance(ref, str)]


def build_suggestions(
    findings: list[Finding], judge_output: dict[str, object] | None
) -> list[SuggestedChange]:
    if judge_output:
        if bool(judge_output.get("diagnosis_only")):
            return []
        suggestions: list[SuggestedChange] = []
        breakdowns = judge_output.get("breakdowns", [])
        if isinstance(breakdowns, list):
            for breakdown in breakdowns:
                if not isinstance(breakdown, dict):
                    continue
                suggestion = str(breakdown.get("proposed_change", "")).strip()
                if not suggestion:
                    continue
                suggestions.append(
                    SuggestedChange(
                        target=patch_kind_to_target(judge_breakdown_patch_kind(breakdown)),
                        risk_level=judge_breakdown_risk(breakdown),
                        rationale=str(breakdown.get("title", "Untitled")),
                        suggestion=suggestion,
                        expected_benefit=str(
                            breakdown.get("expected_benefit", "")
                        ).strip(),
                        evidence_refs=judge_breakdown_evidence_refs(breakdown),
                    )
                )
        return suggestions
    return build_local_suggestions(findings)


def resolve_output_diagnosis_only(
    evidence_pack: dict[str, object], judge_output: dict[str, object] | None
) -> bool:
    if judge_output is not None:
        return bool(judge_output.get("diagnosis_only"))
    return bool(evidence_pack.get("diagnosis_only"))


def build_report(
    *,
    skill_path: Path,
    trace_path: Path,
    trace_format: str,
    source_label: str,
    source_metadata: dict[str, object],
    normalized: dict[str, object],
    evidence_pack: dict[str, object],
    diagnosis_only: bool,
    findings: list[Finding],
    suggestions: list[SuggestedChange],
    judge_output: dict[str, object] | None,
    mode: str,
    judge_error: str,
) -> str:
    lines = [
        f"# Skill Improvement Report: {skill_path.name}",
        "",
        f"- Target skill: `{skill_path}`",
        f"- Trace path: `{trace_path}`",
        f"- Trace format: `{trace_format}`",
        f"- Trace source: `{source_label}`",
        f"- Analysis mode: `{mode}`",
        f"- Diagnosis only: `{diagnosis_only}`",
        "",
        "## Stats",
        "",
    ]
    for key, value in normalized["stats"].items():
        lines.append(f"- {key.replace('_', ' ').title()}: {value}")
    matched_cwd = source_metadata.get("matched_cwd")
    resolved_session_id = source_metadata.get("resolved_session_id")
    if isinstance(matched_cwd, str) or isinstance(resolved_session_id, str):
        lines.extend(["", "## Trace Resolution", ""])
        if isinstance(matched_cwd, str):
            lines.append(f"- Matched cwd: `{matched_cwd}`")
        if isinstance(resolved_session_id, str):
            lines.append(f"- Resolved session id: `{resolved_session_id}`")
        resolved_timestamp = source_metadata.get("resolved_session_timestamp")
        if isinstance(resolved_timestamp, str):
            lines.append(f"- Resolved session timestamp: `{resolved_timestamp}`")
        resolved_originator = source_metadata.get("resolved_session_originator")
        if isinstance(resolved_originator, str):
            lines.append(f"- Resolved session originator: `{resolved_originator}`")
        selection_evidence = first_dict(source_metadata.get("selection_evidence"))
        if selection_evidence:
            evidence_summary = ", ".join(
                f"{key.replace('_', ' ')}={value}"
                for key, value in selection_evidence.items()
                if isinstance(value, int) and value > 0
            )
            if evidence_summary:
                lines.append(f"- Selection evidence: {evidence_summary}")
    lines.extend(
        [
            "",
            "## Token Usage",
            "",
        ]
    )
    token_usage = first_dict(normalized.get("usage"))
    token_review = first_dict(evidence_pack.get("token_review"))
    for observation in summarize_token_usage(token_usage):
        lines.append(f"- {observation}")
    if token_review.get("status") == "reviewed":
        opportunities = token_review.get("savings_opportunities")
        if isinstance(opportunities, list) and opportunities:
            lines.extend(["", "### Token Savings Review", ""])
            for opportunity in opportunities:
                lines.append(f"- {opportunity}")
        else:
            lines.append("- No clear token-saving opportunity was identifiable from the log alone.")
    else:
        lines.append("- Token savings review unavailable because the trace did not expose token accounting fields.")
    lines.extend(
        [
            "",
            "## Deterministic Findings",
            "",
        ]
    )
    actionable_findings = [finding for finding in findings if finding.patch_kind != "DIAGNOSIS_ONLY"]
    if actionable_findings:
        for finding in actionable_findings:
            lines.append(f"- **{finding.title}** ({finding.severity}, {finding.category})")
            for evidence in finding.evidence:
                lines.append(f"  Evidence: {evidence}")
            if finding.evidence_refs:
                lines.append(f"  Refs: {', '.join(finding.evidence_refs)}")
            lines.append(f"  Recommendation: {finding.recommendation}")
    else:
        lines.append("- No strong deterministic findings were detected.")

    lines.extend(
        [
            "",
            "## Steering And Consultation",
            "",
            f"- Target consultation: `{evidence_pack['consultation']['timing']}`",
            f"- Steering markers: {len(evidence_pack['steering_markers'])}",
            "",
        ]
    )
    if judge_output:
        lines.extend(
            [
                "## Judge Findings",
                "",
                f"- Summary: {judge_output.get('summary', '')}",
                "",
            ]
        )
        scores = first_dict(judge_output.get("dimension_scores"))
        for name in DIMENSION_NAMES:
            score = first_dict(scores.get(name)).get("score")
            rationale = first_dict(scores.get(name)).get("rationale")
            lines.append(f"- **{name}**: {score} :: {rationale}")
        breakdowns = judge_output.get("breakdowns", [])
        if isinstance(breakdowns, list):
            lines.extend(["", "### Top Breakdowns", ""])
            for breakdown in breakdowns:
                if not isinstance(breakdown, dict):
                    continue
                lines.append(
                    f"- **{breakdown.get('title', 'Untitled')}** ({breakdown.get('severity', 'unknown')}, {breakdown.get('patch_kind', 'DIAGNOSIS_ONLY')})"
                )
                refs = breakdown.get("evidence_refs", [])
                if isinstance(refs, list) and refs:
                    lines.append(f"  Refs: {', '.join(str(ref) for ref in refs)}")
                lines.append(f"  Change: {breakdown.get('proposed_change', '')}")
                lines.append(f"  Benefit: {breakdown.get('expected_benefit', '')}")
    elif judge_error:
        lines.extend(
            [
                "## Judge Findings",
                "",
                f"- Judge stage failed; local fallback was used.",
                f"- Error: {judge_error}",
                "",
            ]
        )

    lines.extend(["## Suggested Changes", ""])
    if suggestions:
        for suggestion in suggestions:
            lines.append(
                f"- `{suggestion.target}` ({suggestion.risk_level}): {suggestion.rationale}"
            )
            lines.append(f"  Suggestion: {suggestion.suggestion}")
            if suggestion.expected_benefit:
                lines.append(f"  Benefit: {suggestion.expected_benefit}")
            if suggestion.evidence_refs:
                lines.append(f"  Refs: {', '.join(suggestion.evidence_refs)}")
    else:
        lines.append("- No concrete change suggestion was emitted.")
    return "\n".join(lines).rstrip() + "\n"


def build_out_dir(raw_out_dir: str | None) -> Path:
    if raw_out_dir:
        return Path(raw_out_dir).expanduser().resolve()
    run_id = uuid.uuid4().hex[:8]
    return ARTIFACT_ROOT / run_id


def should_run_judge(args: argparse.Namespace) -> bool:
    if args.use_codex:
        return True
    return args.judge == "on"


def dump_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def append_trace_source_to_rerun_command(
    command: list[str],
    args: argparse.Namespace,
    trace_path: Path,
) -> None:
    if args.session_id:
        command.extend(["--session-id", args.session_id])
    elif args.log:
        command.extend(["--log", str(Path(args.log).expanduser().resolve())])
    elif args.trace:
        command.extend(["--trace", str(Path(args.trace).expanduser().resolve())])
    else:
        command.extend(["--log", str(trace_path)])


def append_judge_options_to_rerun_command(command: list[str], args: argparse.Namespace) -> None:
    if args.judge == "off":
        command.extend(["--judge", "off"])
    if args.use_codex:
        command.append("--use-codex")
    if args.codex_model != "gpt-5.4":
        command.extend(["--codex-model", args.codex_model])


def build_postmortem_judge_prompt(facts_path: Path) -> str:
    return f"""
Read the redacted postmortem fact pack at {facts_path}.

Return JSON only, matching the provided schema.

Rules:
- Evaluate the whole session workflow, not one skill.
- Use only the postmortem fact pack. Do not inspect the raw trace.
- Treat fact snippets with kind=observed as observed facts.
- Treat recommendations as inferred recommendations unless directly supported by fact ids.
- Set each breakdown's fact_refs to postmortem fact ids from the fact pack.
- Leave evidence_refs empty for postmortem breakdowns.
- Group recommendations into tool, skill, workflow, docs, or token categories.
- Do not invent new facts.
- Use `breakdowns` for the actionable advice. Ignore `patches`; this workflow is report-only.
- Default to diagnosis_only when the facts are weak or contradictory.
""".strip()


def redacted_postmortem_fact_source(
    trace_path: Path, metadata: dict[str, object]
) -> tuple[str, dict[str, object]]:
    redacted_metadata = redact_value(metadata)
    if not isinstance(redacted_metadata, dict):
        redacted_metadata = {}
    return redact_text(str(trace_path)), redacted_metadata


def run_postmortem_judge(
    facts_path: Path,
    output_dir: Path,
    model: str,
) -> dict[str, object]:
    return run_judge_prompt(
        build_postmortem_judge_prompt(facts_path),
        output_dir,
        model,
        schema_path=POSTMORTEM_JUDGE_SCHEMA_PATH,
    )


def postmortem_category_from_patch_kind(patch_kind: str) -> str:
    if patch_kind in {"SCRIPT_CHANGE", "TOOLING_CHANGE"}:
        return "tool"
    if patch_kind == "REFERENCES_CHANGE":
        return "docs"
    if patch_kind == "SKILL_MD_CHANGE":
        return "skill"
    return "workflow"


def postmortem_category_from_breakdown(breakdown: dict[str, object]) -> str:
    category = str(breakdown.get("category", "")).strip()
    if category in POSTMORTEM_JUDGE_CATEGORIES:
        return category
    return postmortem_category_from_patch_kind(judge_breakdown_patch_kind(breakdown))


def merge_postmortem_judge_suggestions(
    local_suggestions: list[PostmortemSuggestion],
    judge_output: dict[str, object] | None,
    fact_ref_by_id: dict[str, str | None],
) -> list[PostmortemSuggestion]:
    if not judge_output:
        return local_suggestions
    if bool(judge_output.get("diagnosis_only")):
        return []

    merged = list(local_suggestions)
    breakdowns = judge_output.get("breakdowns", [])
    if not isinstance(breakdowns, list):
        return merged

    for breakdown in breakdowns:
        if not isinstance(breakdown, dict):
            continue
        title = str(breakdown.get("title", "")).strip()
        proposed_change = str(breakdown.get("proposed_change", "")).strip()
        if not title or not proposed_change:
            continue
        patch_kind = judge_breakdown_patch_kind(breakdown)
        fact_refs = judge_breakdown_fact_refs(breakdown)
        if not fact_refs or any(ref not in fact_ref_by_id for ref in fact_refs):
            continue
        if judge_breakdown_evidence_refs(breakdown):
            continue
        evidence_refs = []
        seen_trace_refs: set[str] = set()
        for fact_ref in fact_refs:
            trace_ref = fact_ref_by_id[fact_ref]
            if trace_ref and trace_ref not in seen_trace_refs:
                seen_trace_refs.add(trace_ref)
                evidence_refs.append(trace_ref)
        merged.append(
            PostmortemSuggestion(
                title=title,
                category=postmortem_category_from_breakdown(breakdown),
                severity=judge_breakdown_risk(breakdown),
                rationale=proposed_change,
                evidence_refs=evidence_refs,
                fact_refs=fact_refs,
                suggested_target=patch_kind_to_target(patch_kind),
            )
        )
    return merged


def run_postmortem(args: argparse.Namespace, out_dir: Path) -> int:
    trace_path, source_label, metadata = resolve_trace_source(
        args,
        out_dir,
        target_skill_name=None,
    )
    raw_lines, events = read_jsonl(trace_path)
    trace_format = detect_trace_format(events)
    normalized = normalize_trace(events, trace_format)
    facts = extract_postmortem_facts(normalized)
    suggestions = build_postmortem_suggestions(facts)
    diagnosis_only = not suggestions

    redacted_trace_path = out_dir / "redacted-trace.jsonl"
    redacted_trace_path.write_text("\n".join(redact_text(line) for line in raw_lines) + "\n")
    dump_json(out_dir / "normalized-trace.json", normalized)
    (out_dir / "transcript.md").write_text(render_markdown_transcript(normalized, trace_format))
    fact_trace_path, fact_metadata = redacted_postmortem_fact_source(trace_path, metadata)

    facts_payload = {
        "trace_path": fact_trace_path,
        "trace_format": trace_format,
        "source_label": source_label,
        "source_metadata": fact_metadata,
        "facts": [fact.to_dict() for fact in facts],
        "token_usage": normalized.get("usage", empty_token_usage()),
        "deterministic_diagnosis_only": diagnosis_only,
    }
    facts_path = out_dir / "postmortem-facts.json"
    dump_json(facts_path, facts_payload)

    judge_output: dict[str, object] | None = None
    judge_error = ""
    mode = "deterministic-only"
    if should_run_judge(args):
        try:
            judge_output = run_postmortem_judge(facts_path, out_dir, args.codex_model)
            mode = "judge"
        except Exception as exc:  # noqa: BLE001
            judge_error = str(exc)
            mode = "judge-fallback"

    suggestions = merge_postmortem_judge_suggestions(
        suggestions,
        judge_output,
        {fact.id: fact.evidence_ref for fact in facts},
    )
    diagnosis_only = not suggestions

    report = build_postmortem_report(
        trace_path=trace_path,
        trace_format=trace_format,
        source_label=source_label,
        source_metadata=metadata,
        normalized=normalized,
        facts=facts,
        suggestions=suggestions,
        mode=mode,
        judge_output=judge_output,
        judge_error=judge_error,
    )
    (out_dir / "postmortem-report.md").write_text(report)

    dump_json(
        out_dir / "postmortem-suggestions.json",
        {
            "summary": (
                judge_output.get("summary", "")
                if judge_output
                else (
                    "Deterministic postmortem suggestions"
                    if suggestions
                    else "No concrete postmortem suggestions"
                )
            ),
            "mode": mode,
            "diagnosis_only": diagnosis_only,
            "suggestions": [suggestion.to_dict() for suggestion in suggestions],
        },
    )

    if judge_output is None:
        dump_json(
            out_dir / "judge-output.json",
            {
                "status": "skipped" if not should_run_judge(args) else "failed",
                "error": judge_error,
            },
        )

    rerun_command = ["python3", str(SCRIPT_PATH), "--postmortem"]
    append_trace_source_to_rerun_command(rerun_command, args, trace_path)
    append_judge_options_to_rerun_command(rerun_command, args)
    rerun_lines = [
        "# Rerun",
        "",
        "- This workflow is report-only. No skill copy, patch diff, or GitHub issue was materialized.",
        "",
        f"`{' '.join(shlex.quote(part) for part in rerun_command)}`",
        "",
    ]
    if judge_error:
        rerun_lines.extend(["Judge error:", "", judge_error, ""])
    (out_dir / "rerun.md").write_text("\n".join(rerun_lines))

    print(str(out_dir))
    return 0


def render_census_report(
    *,
    trace_path: Path,
    trace_format: str,
    source_label: str,
    source_metadata: dict[str, object],
    census: list[dict[str, object]],
) -> str:
    lines = [
        "# Codex Skill Usage Census",
        "",
        f"- Trace path: `{trace_path}`",
        f"- Trace format: `{trace_format}`",
        f"- Trace source: `{source_label}`",
        "",
        "| Skill | Signals | Hits | Tool Activity |",
        "| --- | --- | ---: | --- |",
    ]
    if not census:
        lines.append("| none | none | 0 | no |")
        return "\n".join(lines) + "\n"
    for item in census:
        signal_names = [
            name
            for name in (
                "execution_hits",
                "artifact_hits",
                "invocation_hits",
                "consult_hits",
                "declaration_hits",
            )
            if isinstance(item.get(name), int) and item[name] > 0
        ]
        hit_count = sum(int(item[name]) for name in signal_names)
        lines.append(
            f"| {item['name']} | {', '.join(signal_names)} | {hit_count} | {'yes' if item['has_tool_activity'] else 'no'} |"
        )
    matched_cwd = source_metadata.get("matched_cwd")
    if isinstance(matched_cwd, str):
        lines.extend(["", f"- Matched cwd: `{matched_cwd}`"])
    return "\n".join(lines) + "\n"


def main() -> int:
    args = parse_args()
    out_dir = build_out_dir(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.postmortem:
        return run_postmortem(args, out_dir)

    if args.census:
        trace_path, source_label, metadata = resolve_trace_source(
            args,
            out_dir,
            target_skill_name=None,
        )
        raw_lines, events = read_jsonl(trace_path)
        trace_format = detect_trace_format(events)
        normalized = normalize_trace(events, trace_format)
        census = build_skill_usage_census(events)
        redacted_trace_path = out_dir / "redacted-trace.jsonl"
        redacted_trace_path.write_text("\n".join(redact_text(line) for line in raw_lines) + "\n")
        dump_json(out_dir / "normalized-trace.json", normalized)
        (out_dir / "transcript.md").write_text(render_markdown_transcript(normalized, trace_format))
        dump_json(out_dir / "census.json", {"skills": census, "source_metadata": metadata})
        (out_dir / "report.md").write_text(
            render_census_report(
                trace_path=trace_path,
                trace_format=trace_format,
                source_label=source_label,
                source_metadata=metadata,
                census=census,
            )
        )
        rerun_command = ["python3", str(SCRIPT_PATH), "--census"]
        append_trace_source_to_rerun_command(rerun_command, args, trace_path)
        (out_dir / "rerun.md").write_text(
            "# Rerun\n\n"
            "- This workflow is report-only.\n\n"
            f"`{' '.join(shlex.quote(part) for part in rerun_command)}`\n"
        )
        print(str(out_dir))
        return 0

    assert args.skill
    skill_path = resolve_target_skill(args.skill)
    target_skill_selector = resolve_target_skill_selector(args.skill, skill_path)

    trace_path, source_label, metadata = resolve_trace_source(
        args,
        out_dir,
        target_skill_name=target_skill_selector,
    )
    raw_lines, events = read_jsonl(trace_path)
    trace_format = detect_trace_format(events)
    normalized = normalize_trace(events, trace_format)
    skill_md = (skill_path / "SKILL.md").read_text()
    findings = build_findings(normalized, skill_path, skill_md)
    evidence_pack = build_evidence_pack(normalized, findings, skill_path, skill_md)

    redacted_trace_path = out_dir / "redacted-trace.jsonl"
    redacted_trace_path.write_text("\n".join(redact_text(line) for line in raw_lines) + "\n")
    dump_json(out_dir / "normalized-trace.json", normalized)
    (out_dir / "transcript.md").write_text(render_markdown_transcript(normalized, trace_format))
    evidence_path = out_dir / "evidence.json"
    dump_json(evidence_path, evidence_pack)
    dump_json(
        out_dir / "diagnosis.json",
        {
            "trace_path": str(trace_path),
            "trace_format": trace_format,
            "source_label": source_label,
            "source_metadata": metadata,
            "findings": [finding.to_dict() for finding in findings],
            "diagnosis_only": evidence_pack["diagnosis_only"],
            "consultation": evidence_pack["consultation"],
            "steering_markers": evidence_pack["steering_markers"],
            "token_usage": normalized.get("usage", empty_token_usage()),
            "token_review": evidence_pack.get("token_review", {}),
        },
    )

    judge_output: dict[str, object] | None = None
    judge_error = ""
    mode = "deterministic-only"

    if should_run_judge(args):
        try:
            judge_output = run_judge(skill_path, evidence_path, out_dir, args.codex_model)
            mode = "judge"
        except Exception as exc:  # noqa: BLE001
            judge_error = str(exc)
            mode = "judge-fallback"

    suggestions = build_suggestions(findings, judge_output)
    diagnosis_only = resolve_output_diagnosis_only(evidence_pack, judge_output)

    report = build_report(
        skill_path=skill_path,
        trace_path=trace_path,
        trace_format=trace_format,
        source_label=source_label,
        source_metadata=metadata,
        normalized=normalized,
        evidence_pack=evidence_pack,
        diagnosis_only=diagnosis_only,
        findings=findings,
        suggestions=suggestions,
        judge_output=judge_output,
        mode=mode,
        judge_error=judge_error,
    )
    (out_dir / "report.md").write_text(report)

    suggestions_payload: dict[str, object] = {
        "summary": judge_output.get("summary", "") if judge_output else ("Local fallback suggestions" if suggestions else "No concrete suggestions"),
        "suggestions": [suggestion.to_dict() for suggestion in suggestions],
        "mode": mode,
        "diagnosis_only": diagnosis_only,
    }
    dump_json(out_dir / "suggestions.json", suggestions_payload)

    rerun_command = ["python3", str(SCRIPT_PATH), "--skill", str(skill_path)]
    append_trace_source_to_rerun_command(rerun_command, args, trace_path)
    append_judge_options_to_rerun_command(rerun_command, args)
    rerun_lines = [
        "# Rerun",
        "",
        "- This workflow is report-only. No candidate skill copy or patch diff was materialized.",
        "",
        f"`{' '.join(shlex.quote(part) for part in rerun_command)}`",
        "",
    ]
    if judge_error:
        rerun_lines.extend(["Judge error:", "", judge_error, ""])
    (out_dir / "rerun.md").write_text("\n".join(rerun_lines))

    if judge_output is None:
        dump_json(
            out_dir / "judge-output.json",
            {
                "status": "skipped" if not should_run_judge(args) else "failed",
                "error": judge_error,
            },
        )

    print(str(out_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main())
