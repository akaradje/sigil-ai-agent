"""Regression tests use generated fake credentials, never real account values."""
import importlib.util
import io
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("check-public-files.py")
SPEC = importlib.util.spec_from_file_location("public_guard", SCRIPT)
GUARD = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = GUARD
SPEC.loader.exec_module(GUARD)


def assignment(name, value, quote="'"):
    return name + " = " + quote + value + quote


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="sigil-public-guard-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def write(self, name, value="// public source\n"):
        file = self.root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(value, encoding="utf-8")
        return file

    def cli(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), "--root", str(self.root), *args],
                              capture_output=True, text=True, check=False)

    def git(self, *args):
        if not shutil.which("git"):
            self.skipTest("Git is required for publication/index regression tests")
        return subprocess.run(["git", "-C", str(self.root), *args], capture_output=True, check=True)

    def init_git(self):
        self.git("init", "-q")

    def test_private_paths_include_brain_backups_game_sources_and_credential_files(self):
        names = [".env", ".env.production", "telegram.env", "telegram.env.local", ".env.example.backup",
                 "accounts.json", "viewer-token.txt", "cloudflare-worker/relay-key.txt",
                 "uptime-worker/.admin-key", "uptime-worker/.dev.vars", "nested/cookies.json",
                 ".agi-brain-memory.json", ".agi-brain-memory.json.previous", ".agi-brain-memory.json.123.tmp",
                 "agent-memory.json.bak", "dna-memory.json.previous", "agent-decisions.jsonl",
                 "agent-diary.md", "agent-lessons.md", "agent.log.1", "foo.sqlite3", "cert.pem",
                 "logs/events.json", "raw/main.js", "data/tables.json", "shots/shot.png",
                 "live-public/index.html", ".self-healing-source-backups/main.js", "bundle.zip",
                 "accounts.csv", "tunnel.py", "capture.txt", "node_modules/module.js", "uptime-worker/dist/index.js"]
        for name in names:
            with self.subTest(name=name):
                self.assertIsNotNone(GUARD.path_rule(name))

    def test_public_source_and_placeholder_templates_are_allowed(self):
        for name in ["agent.js", "cognitive-brain.test.js", "scripts/check-public-files.py", "docs/guide.md",
                     ".github/workflows/ci.yml", ".env.example", "telegram.env.sample", ".dev.vars.example",
                     "agent-goal.example.txt", "sigil-agent.service", "uptime-worker/monitor.mjs"]:
            with self.subTest(name=name):
                self.assertIsNone(GUARD.path_rule(name))
        content = "\n".join(assignment("META_API_KEY", v) for v in ["", "YOUR_API_KEY", "<replace>", "${API_KEY}"])
        self.assertEqual(GUARD.content_findings(".env.example", content), [])

    def test_empty_environment_values_do_not_consume_the_next_line(self):
        text = "META_API_KEY=\nAGENT_BASE=https://example.com\nVIEWER_TOKEN=\n\nTELEGRAM_BOT_TOKEN=\nTELEGRAM_CHAT_ID=\n"
        self.assertEqual(GUARD.content_findings(".env.example", text), [])
        self.assertEqual(GUARD.content_findings(".env.example", text.replace("\n", "\r\n")), [])

    def test_known_secret_shapes_are_detected_in_source_docs_and_templates(self):
        samples = ["gh" + "p_" + "A" * 36, "github_" + "pat_" + "B" * 50,
                   "AK" + "IA" + "C" * 16, "sk-" + "proj-" + "D" * 32,
                   "123456789" + ":" + "E" * 35,
                   "eyJ" + "a" * 16 + "." + "b" * 16 + "." + "c" * 16,
                   "-----BE" + "GIN OPENSSH PRIVATE KEY-----"]
        for name in ["source.js", "README.md", ".env.example", "tests/fixture.js"]:
            for value in samples:
                with self.subTest(name=name, prefix=value[:3]):
                    self.assertTrue(GUARD.content_findings(name, value))

    def test_literal_credentials_include_short_passwords_and_backticks(self):
        for name in ["META_API_KEY", "TELEGRAM_BOT_TOKEN", "password", "SESSION_ID", "TELEGRAM_CHAT_ID"]:
            for quote in ["'", '"', "`", ""]:
                self.assertTrue(GUARD.content_findings("config.js", assignment(name, "do-not-publish", quote)))
        self.assertTrue(GUARD.content_findings("README.md", assignment("PASSWORD", "a")))

    def test_runtime_references_cookie_prefixes_and_marked_synthetic_fixtures_are_allowed(self):
        samples = ["const TOKEN = process.env.TOKEN;", "const PASSWORD = readPassword();",
                   assignment("COOKIE", "v=") + "+token", assignment("TOKEN", "synthetic-private-fixture"),
                   assignment("API_KEY", "${loadKey()}"), "const TOKEN_FILE = 'viewer-token.txt';"]
        for text in samples:
            self.assertEqual(GUARD.content_findings("source.js", text), [], text)

    def test_bearer_and_url_passwords_are_reported_without_weakening_known_token_patterns(self):
        value = "not-for-publication-123"
        self.assertTrue(GUARD.content_findings("config.js", "Bear" + "er " + value))
        self.assertTrue(GUARD.content_findings("README.md", "https://user:" + value + "@example.com"))
        shaped = "gh" + "p_" + "SYNTHETIC" + "A" * 32
        self.assertTrue(GUARD.content_findings(".env.example", assignment("TOKEN", shaped)))

    def test_filesystem_fallback_cannot_hide_ignored_runtime_files(self):
        self.write(".gitignore", ".env\n")
        self.write(".env", "unprinted-private-contents")
        result = self.cli()
        self.assertEqual(result.returncode, 1)
        self.assertIn("ENVIRONMENT_FILE", result.stdout)
        self.assertIn("all-files", result.stdout)
        self.assertNotIn("unprinted-private-contents", result.stdout + result.stderr)

    def test_denied_directories_are_reported_without_reading_nested_private_files(self):
        self.write("shots/private.txt", "not-for-output")
        findings, count, _ = GUARD.scan(self.root)
        self.assertEqual(count, 1)
        self.assertEqual(findings[0].path, "shots")
        self.assertEqual(findings[0].rule, "PRIVATE_RUNTIME_DIRECTORY")

    def test_ignored_local_secret_is_excluded_but_force_tracked_secret_is_rejected(self):
        self.init_git()
        self.write(".gitignore", ".env\n")
        self.write("agent.js")
        self.write(".env", "not-for-output")
        self.git("add", ".gitignore", "agent.js")
        self.assertEqual(self.cli().returncode, 0)
        self.git("add", "-f", ".env")
        result = self.cli()
        self.assertEqual(result.returncode, 1)
        self.assertIn("ENVIRONMENT_FILE", result.stdout)
        self.assertNotIn("not-for-output", result.stdout + result.stderr)

    def test_all_files_option_checks_ignored_files_even_in_git(self):
        self.init_git()
        self.write(".gitignore", ".env\n")
        self.write(".env")
        self.assertEqual(self.cli().returncode, 0)
        self.assertEqual(self.cli("--all-files").returncode, 1)

    def test_untracked_unignored_secret_is_rejected_before_git_add(self):
        self.init_git()
        self.write("config.js", assignment("PASSWORD", "unpublished-value"))
        self.assertEqual(self.cli().returncode, 1)

    def test_secret_in_index_is_detected_even_if_worktree_is_cleaned(self):
        self.init_git()
        credential_value = "staged-only-sensitive-value"
        self.write("config.js", assignment("API_KEY", credential_value))
        self.git("add", "config.js")
        self.write("config.js", "const API_KEY = process.env.API_KEY;\n")
        result = self.cli()
        self.assertEqual(result.returncode, 1)
        self.assertIn("INDEX_LITERAL_CREDENTIAL", result.stdout)
        self.assertNotIn(credential_value, result.stdout + result.stderr)
        strict = self.cli("--all-files")
        self.assertEqual(strict.returncode, 1)
        self.assertIn("INDEX_LITERAL_CREDENTIAL", strict.stdout)

    def test_placeholder_template_with_real_assignment_is_rejected(self):
        self.write(".env.example", assignment("TOKEN", "non-placeholder-value"))
        self.assertEqual(self.cli().returncode, 1)

    def test_symlink_is_not_followed(self):
        target = self.write("outside.cfg", assignment("PASSWORD", "private-target-value"))
        link = self.root / "source.js"
        try:
            link.symlink_to(target)
        except (OSError, NotImplementedError):
            self.skipTest("Creating symlinks requires platform privileges")
        findings, _, _ = GUARD.scan(self.root)
        self.assertIn(GUARD.Finding("source.js", "SYMLINK_OR_REPARSE_POINT"), findings)

    def test_index_symlink_is_rejected_even_with_regular_worktree_file(self):
        self.init_git()
        self.write("source.js", "regular working tree file\n")
        result = subprocess.run(["git", "-C", str(self.root), "hash-object", "-w", "--stdin"],
                                input=b"/outside/private-file", capture_output=True, check=True)
        blob = result.stdout.decode().strip()
        self.git("update-index", "--add", "--cacheinfo", "120000," + blob + ",source.js")
        result = self.cli()
        self.assertEqual(result.returncode, 1)
        self.assertIn("NON_REGULAR_INDEX_ENTRY", result.stdout)

    def test_binary_oversized_and_missing_files_fail_closed(self):
        (self.root / "binary.bin").write_bytes(b"binary\0payload")
        self.write("large.js", "a" * (GUARD.MAX_BYTES + 1))
        findings, _, _ = GUARD.scan(self.root)
        self.assertEqual({f.rule for f in findings}, {"UNINSPECTED_BINARY_FILE", "OVERSIZED_UNINSPECTED_FILE"})
        with patch.object(GUARD, "publication_files", return_value=([self.root / "missing.js"], "fixture", [])):
            self.assertEqual(GUARD.scan(self.root)[0][0].rule, "UNREADABLE_PUBLIC_FILE")

    def test_line_numbers_and_cli_output_never_include_matched_values(self):
        credential_value = "value-that-must-never-be-printed"
        self.write("config.js", "// heading\n" + assignment("PASSWORD", credential_value))
        result = self.cli()
        self.assertEqual(result.returncode, 1)
        self.assertIn('"config.js":2: LITERAL_CREDENTIAL', result.stdout)
        self.assertNotIn(credential_value, result.stdout + result.stderr)

    def test_nonexistent_root_and_broken_git_return_error_without_raw_exception(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "--root", str(self.root / "missing")],
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertNotIn("Traceback", result.stderr)
        self.write(".git", "gitdir: unavailable\n")
        self.assertEqual(self.cli().returncode, 2)

    def test_staged_oversized_blob_is_rejected_even_after_worktree_cleanup(self):
        self.init_git()
        self.write("large.js", "a" * (GUARD.MAX_BYTES + 1))
        self.git("add", "large.js")
        self.write("large.js")
        result = self.cli()
        self.assertEqual(result.returncode, 1)
        self.assertIn("INDEX_OVERSIZED_UNINSPECTED_FILE", result.stdout)

    def test_filenames_are_escaped_in_cli_output(self):
        finding = GUARD.Finding("line\nbreak.js", "LITERAL_CREDENTIAL", 3)
        output = io.StringIO()
        with patch.object(GUARD, "scan", return_value=([finding], 1, "fixture")), patch("sys.stdout", output):
            self.assertEqual(GUARD.main(["--root", str(self.root)]), 1)
        self.assertIn('"line\\nbreak.js":3:', output.getvalue())
        self.assertNotIn("line\nbreak.js", output.getvalue())


if __name__ == "__main__":
    unittest.main()
