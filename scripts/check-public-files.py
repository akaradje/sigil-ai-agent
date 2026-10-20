#!/usr/bin/env python3
"""Check the publication file set without reading known private/runtime files.

Default: Git tracked + non-ignored untracked files, or the full tree without Git.
--all-files also checks ignored files in a release/export directory. Findings contain
only escaped paths, rule names and line numbers, never matched values or source lines.
This checks current file contents, not Git history; use a history secret scanner too.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys

MAX_BYTES = 2 * 1024 * 1024
PRIVATE_DIRS = {
    ".self-healing", ".cloudflare", "raw", "data", "live-public", "shots", "screenshots", "captures", "logs",
    "runtime", "backups", "deployments", "node_modules", "__pycache__", ".venv",
    "venv", ".wrangler", ".ssh", ".aws", "dist", "build", "coverage", ".self-healing-reports",
    ".self-healing-source-backups", "sigil-self-healing-e2e",
}
PRIVATE_NAMES = {
    "harness.js", ".agent-health.json", "self-healing-events.json", "accounts.json", "account.json", "credentials.json", "cookies.json",
    "storage-state.json", "storagestate.json", "auth.json", "viewer-token.txt",
    "agent-memory.json", "dna-memory.json", ".agi-brain-memory.json",
    "telegram-alerts-state.json", "game-catalog-cache.json", "growth-catalog-live.json",
    "deployment-state.json", "agent-diary.md", "agent-lessons.md", "agent-goal.txt",
    "state.json", "daily.json", "events.json", "repair.json", "health.json", "metrics.json",
    "baseline.json", "candidate.json", "production-before.json", "endpoint.json", "guard-receipt.json",
    "recon.md", "status.md", "id_rsa", "id_ed25519", "id_ecdsa", ".netrc", ".npmrc",
}
PRIVATE_SUFFIXES = (
    ".log", ".jsonl", ".sqlite", ".sqlite3", ".db", ".db-wal", ".db-shm",
    ".pem", ".key", ".p12", ".pfx", ".keystore", ".har", ".heapsnapshot",
    ".tmp", ".bak", ".backup", ".previous", ".pyc", ".zip", ".7z", ".tar",
    ".tar.gz", ".tgz", ".dump", ".sql.gz", ".pid", ".rdb",
)
ROOT_TEXT_ALLOW = {"agent-goal.example.txt", "requirements.txt", "cmakelists.txt", "license.txt"}
SECRET_PATTERNS = (
    ("PRIVATE_KEY", re.compile(r"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----")),
    ("GITHUB_TOKEN", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b")),
    ("AWS_ACCESS_KEY", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("API_TOKEN", re.compile(r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b")),
    ("TELEGRAM_TOKEN", re.compile(r"\b[0-9]{6,12}:[A-Za-z0-9_-]{30,}\b")),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")),
)
# Literal assignments only: variable references, function calls and template
# interpolation in the agent's source are not embedded credentials.
SECRET_NAME = r"(?:[A-Za-z][A-Za-z0-9_]*_)?(?:TOKEN|API_?KEY|PASSWORD|PASSWD|SECRET|COOKIE|SESSION_ID|CHAT_ID)"
QUOTED_ASSIGNMENT = re.compile(
    r"(?<![\w])['\"]?" + SECRET_NAME + r"['\"]?[ \t]*[:=][ \t]*(['\"`])([^\r\n]*?)\1", re.I
)
ENV_ASSIGNMENT = re.compile(r"^[ \t]*" + SECRET_NAME + r"[ \t]*=[ \t]*([^\s'\"#]+)[ \t]*(?:#.*)?$", re.I | re.M)
BEARER = re.compile(r"\bBearer\s+([A-Za-z0-9._~-]{12,})", re.I)
URL_PASSWORD = re.compile(r"\b[a-z][a-z0-9+.-]*://([^\s/:@]+):([^\s/@]+)@", re.I)
PLACEHOLDER = re.compile(
    r"^(?:synthetic(?:[-_ ].*)?|example(?:[-_ ].*)?|dummy(?:[-_ ].*)?|fake(?:[-_ ].*)?|"
    r"test(?:[-_ ].*)?|redacted|\[redacted\]|change[-_ ]?me|replace[-_ ]?me|"
    r"your[-_ ].*|<[^>]*>|\$\{.*\}|\$[A-Za-z_][A-Za-z0-9_]*|[x*.-]+)$", re.I
)


@dataclass(frozen=True)
class Finding:
    path: str
    rule: str
    line: int = 0


def path_rule(name: str) -> str | None:
    parts = PurePosixPath(name.replace("\\", "/")).parts
    if not parts or any(p in {"..", ".git"} for p in parts) or PurePosixPath(name).is_absolute():
        return "INVALID_PUBLIC_PATH"
    lower = [p.lower() for p in parts]
    if any(p in PRIVATE_DIRS for p in lower):
        return "PRIVATE_RUNTIME_DIRECTORY"
    base = lower[-1]
    if base.startswith(".patch-") and base.endswith(".json"):
        return "PRIVATE_RUNTIME_FILE"
    if base in PRIVATE_NAMES or any(base.startswith(n + ".") for n in PRIVATE_NAMES):
        return "PRIVATE_RUNTIME_FILE"
    if base.startswith(("accounts.", "account.")):
        return "PRIVATE_ACCOUNT_FILE"
    template = base.endswith((".env.example", ".env.sample", ".dev.vars.example", ".dev.vars.sample"))
    if not template and (base == ".env" or base.startswith(".env.") or base.endswith(".env") or ".env." in base or base.startswith(".dev.vars")):
        return "ENVIRONMENT_FILE"
    if re.search(r"(?:^|[-_.])(?:token|password|credentials?|cookies?|secret|admin-key|relay-key)(?:[-_.]|$)", base) and not base.endswith((".example", ".sample")):
        return "CREDENTIAL_FILE_NAME"
    if base.endswith(PRIVATE_SUFFIXES) or re.search(r"\.log(?:\.\d+|\.gz)$", base):
        return "PRIVATE_OR_OPAQUE_ARTIFACT"
    if len(parts) == 1:
        if base.endswith(".txt") and base not in ROOT_TEXT_ALLOW:
            return "UNREVIEWED_ROOT_TEXT_DUMP"
        if base.endswith((".py", ".cjs", ".png", ".jpg", ".jpeg", ".webp")):
            return "PRIVATE_OPERATOR_OR_CAPTURE_FILE"
    return None


def placeholder(value: str) -> bool:
    value = value.strip()
    return not value or bool(PLACEHOLDER.fullmatch(value))


def content_findings(name: str, text: str) -> list[Finding]:
    hits: set[Finding] = set()
    def add(rule: str, offset: int) -> None:
        hits.add(Finding(name, rule, text.count("\n", 0, offset) + 1))
    for rule, pattern in SECRET_PATTERNS:
        for match in pattern.finditer(text):
            add(rule, match.start())
    for pattern in (QUOTED_ASSIGNMENT, ENV_ASSIGNMENT):
        for match in pattern.finditer(text):
            value = match.group(2) if pattern is QUOTED_ASSIGNMENT else match.group(1)
            # A cookie prefix such as cookie:'v='+token contains no credential.
            if pattern is QUOTED_ASSIGNMENT and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*=", value) and text[match.end():].lstrip().startswith("+"):
                continue
            if not placeholder(value):
                add("LITERAL_CREDENTIAL", match.start())
    for match in BEARER.finditer(text):
        if not placeholder(match.group(1)):
            add("BEARER_CREDENTIAL", match.start())
    for match in URL_PASSWORD.finditer(text):
        if not placeholder(match.group(2)):
            add("URL_CREDENTIAL", match.start())
    return sorted(hits, key=lambda f: (f.path, f.line, f.rule))


def linked(path: Path) -> bool:
    info = path.lstat()
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    )


def tree_files(root: Path):
    # Do not follow symlinks/junctions, including directories. Denied directories
    # are reported once without enumerating or reading their private contents.
    for child in sorted(root.iterdir()):
        if child.name == ".git":
            continue
        if linked(child) or not child.is_dir():
            yield child
        elif path_rule(child.relative_to(root).as_posix()):
            yield child
        else:
            yield from tree_files_under(root, child)


def tree_files_under(root: Path, folder: Path):
    for child in sorted(folder.iterdir()):
        relative = child.relative_to(root).as_posix()
        if linked(child) or not child.is_dir() or path_rule(relative):
            yield child
        else:
            yield from tree_files_under(root, child)


def publication_files(root: Path, all_files: bool):
    if all_files:
        public, scope, entries = publication_files(root, False)
        files = sorted(set(public) | set(tree_files(root)))
        return files, "strict-all-files (worktree + index)" if entries else "all-files", entries
    if not all_files:
        try:
            probe = subprocess.run(["git", "-C", str(root), "rev-parse", "--show-toplevel"],
                                   capture_output=True, check=False)
        except FileNotFoundError:
            if (root / ".git").exists():
                raise RuntimeError("GIT_UNAVAILABLE") from None
        else:
            if probe.returncode == 0:
                top = Path(probe.stdout.decode("utf-8").strip()).resolve()
                if top != root:
                    raise RuntimeError("ROOT_MUST_BE_GIT_TOPLEVEL")
                result = subprocess.run(["git", "-C", str(root), "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
                                        capture_output=True, check=False)
                if result.returncode:
                    raise RuntimeError("GIT_FILE_LIST_UNAVAILABLE")
                names = set(result.stdout.decode("utf-8").split("\0")) - {""}
                index = subprocess.run(["git", "-C", str(root), "ls-files", "--stage", "-z"],
                                       capture_output=True, check=False)
                if index.returncode:
                    raise RuntimeError("GIT_INDEX_UNAVAILABLE")
                entries = []
                for entry in index.stdout.decode("utf-8").split("\0"):
                    if not entry:
                        continue
                    meta, name = entry.split("\t", 1)
                    mode, blob, stage = meta.split()
                    if stage != "0" or not re.fullmatch(r"[a-f0-9]{40,64}", blob):
                        raise RuntimeError("UNMERGED_OR_INVALID_INDEX")
                    entries.append((mode, blob, name))
                return [root / n for n in sorted(names)], "git-publication (worktree + index)", entries
            if (root / ".git").exists():
                raise RuntimeError("INVALID_GIT_CHECKOUT")
    return list(tree_files(root)), "all-files", []


def inspect_bytes(name: str, raw: bytes, prefix: str = "") -> list[Finding]:
    if len(raw) > MAX_BYTES:
        return [Finding(name, prefix + "OVERSIZED_UNINSPECTED_FILE")]
    try:
        if b"\0" in raw:
            raise UnicodeError
        findings = content_findings(name, raw.decode("utf-8-sig"))
        return [Finding(f.path, prefix + f.rule, f.line) for f in findings]
    except UnicodeError:
        return [Finding(name, prefix + "UNINSPECTED_BINARY_FILE")]


def index_blob(root: Path, blob: str) -> bytes:
    # Bound reads even for a mistakenly staged multi-GB artifact.
    with subprocess.Popen(["git", "-C", str(root), "cat-file", "blob", blob],
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as child:
        raw = child.stdout.read(MAX_BYTES + 1)
        child.stdout.close()
        if len(raw) > MAX_BYTES:
            child.kill()
        try:
            code = child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
            raise RuntimeError("INDEX_BLOB_UNAVAILABLE") from None
        if code and len(raw) <= MAX_BYTES:
            raise RuntimeError("INDEX_BLOB_UNAVAILABLE")
        return raw


def scan(root: Path, all_files: bool = False) -> tuple[list[Finding], int, str]:
    files, scope, entries = publication_files(root, all_files)
    findings: list[Finding] = []
    for file in files:
        name = file.relative_to(root).as_posix()
        rule = path_rule(name)
        if rule:
            findings.append(Finding(name, rule))
            continue
        try:
            # Check ancestors too: a Git-indexed path can sit below a symlink.
            current = root
            for part in file.relative_to(root).parts:
                current = current / part
                if linked(current):
                    break
            else:
                info = file.stat()
                if not stat.S_ISREG(info.st_mode):
                    findings.append(Finding(name, "NON_REGULAR_PUBLIC_FILE"))
                elif info.st_size > MAX_BYTES:
                    findings.append(Finding(name, "OVERSIZED_UNINSPECTED_FILE"))
                else:
                    with file.open("rb") as source:
                        findings.extend(inspect_bytes(name, source.read(MAX_BYTES + 1)))
                continue
            findings.append(Finding(name, "SYMLINK_OR_REPARSE_POINT"))
        except UnicodeError:
            findings.append(Finding(name, "UNINSPECTED_BINARY_FILE"))
        except OSError:
            findings.append(Finding(name, "UNREADABLE_PUBLIC_FILE"))
    for mode, blob, name in entries:
        if path_rule(name):
            continue  # Already rejected without reading its working or staged values.
        if mode not in {"100644", "100755"}:
            findings.append(Finding(name, "NON_REGULAR_INDEX_ENTRY"))
        else:
            findings.extend(inspect_bytes(name, index_blob(root, blob), "INDEX_"))
    return sorted(set(findings), key=lambda f: (f.path, f.line, f.rule)), len(files), scope


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--all-files", action="store_true", help="Also inspect ignored files in a release/export tree")
    args = parser.parse_args(argv)
    try:
        findings, count, scope = scan(args.root.resolve(strict=True), args.all_files)
    except (OSError, RuntimeError, UnicodeError):
        print("PUBLIC_FILES_CHECK_ERROR: unable to enumerate the requested publication root", file=sys.stderr)
        return 2
    for finding in findings:
        print(f"{json.dumps(finding.path, ensure_ascii=True)}:{finding.line}: {finding.rule}")
    print(f"{'FAIL' if findings else 'PASS'}: {count} paths checked ({scope}); {len(findings)} findings. No secret values printed.")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
