# Publication guard

From the repository root, run with Python 3.12 (no third-party Python packages):

```sh
python scripts/check-public-files.py
python -m unittest discover -s scripts -p 'test_*.py'
```

`npm run security:files` invokes the same checker. CI runs its regression tests and
the strict guard on both Linux and Windows before and after the Node tests. A finding exits with 1;
an enumeration/Git setup error exits with 2. Only a complete scan with no
findings exits with 0. The guard never removes, edits, unstages or uploads files.

The original reviewed-path allowlist is retained in `scripts/check-public-paths.py`
and is also enforced in CI. The separate pinned Gitleaks job scans current files and
the complete Git history.

## What is inspected

In a Git checkout, the default checks all tracked files (even if now ignored) and
non-ignored untracked files. It checks both working contents and staged blobs.
Cleaning a working file does not hide a secret still staged for commit. Conflicted
indexes, missing files, Git enumeration failures and unreviewed submodules/symlinks
fail the check. Paths are escaped; matched values and source lines are never logged.

Without Git metadata the default scans the complete tree. For a prepared export or
release directory, explicitly scan all files, including ignored files:

```sh
python scripts/check-public-files.py --root /path/to/release --all-files
```

The root `.git` metadata is not traversed in either mode. Exclude it from release
archives and use the separate history scan for Git objects.
Strict mode also inspects staged blobs; it does not lose index coverage. CI disables
Python bytecode caching so the regression tests do not create private cache artifacts.

Keep deployment/runtime directories separate from the publication checkout. A live
deployment folder containing `.env`, memory, logs and captures should fail a full-tree
scan. Do not delete operational files or loosen the guard to make that folder pass;
prepare and check a separate reviewed source checkout/export instead. `.gitignore`
helps prevent accidental additions but cannot exempt a tracked file from the guard.

## Policy

The checker rejects:

- Environment/configuration files, accounts, cookies/browser state, token/key files,
  private keys and credential stores. Only named `.env.example`/`.env.sample` and
  `.dev.vars.example`/`.dev.vars.sample` templates are permitted, with content checks.
- Agent/DNA/cognitive memory, previous snapshots and temporary writes, Telegram state,
  catalogs captured from deployment, diaries, lessons, goals and runtime notes.
- Logs, JSONL, databases, HAR files, heap dumps, screenshots/captures, deployment
  journals/backups, local operator scripts and unreviewed root text dumps.
- Downloaded game source directories (`raw/`, `data/`, `live-public/`), dependency,
  cache/build directories, archives, oversized text and uninspected binary files.
- Recognizable provider tokens, private-key headers, JWTs, literal credential
  assignments, bearer credentials and passwords embedded in URLs, including in
  documentation, templates or tests.

Known private paths are rejected without reading their contents. Other text files
are limited to 2 MiB and decoded as UTF-8. Symlinks and Windows reparse points are
rejected instead of followed. New source assets or policy exceptions need a reviewed
change to the checker and tests; there is no inline suppression or per-run bypass.

Examples may use empty values, explicit placeholders such as `YOUR_API_KEY` or
`${API_KEY}`, or clearly marked synthetic test values. Recognizable provider-token
formats are always rejected even if they contain a synthetic marker. Existing
privacy tests use marked synthetic sentinels so the guard need not exempt test files.

This is a current-file publication gate, not a proof that no secret exists. It
does not inspect Git history, decode every possible credential format or inspect
private runtime files. Retain the separate history secret scan documented in the
README and review the publication diff. CI can enforce a release only when the
deployment process requires its successful result.
