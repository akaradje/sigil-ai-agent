# Keep runtime outside the source checkout

`SIGIL_STATE_DIR` is an absolute directory outside the source tree. Agent, supervisor,
viewer, Telegram observer and standalone CognitiveBrain use the same setting. It holds
memory (including previous snapshots), log/JSONL, diary/lessons, goals/tactics and the
catalog cache. `AGENT_DIR`/`SIGIL_DIR` continue to identify the source/legacy directory;
do not change them to point at state storage. Source build fingerprints and trusted
self-evolution snapshots still refer to source files.

Set `SIGIL_STATE_DIR` in the environment of **every** service. Without it the legacy
location remains unchanged. This opt-in avoids silently replacing an existing learned
brain with an empty one. Startup also refuses a new external directory when primary
memory/alert state exists only at the old location. In-source destinations and directory
aliases resolving back into the source are rejected.

`SIGIL_CONFIG_DIR` optionally separates private `.env`, `telegram.env` and
`viewer-token.txt`; it defaults to the state directory. These are separate from the
root-owned self-evolution configuration/journals, which already live outside source.

## One-time migration

1. Stop the agent, supervisor and Telegram writer before copying. The initial migration
   needs a consistent snapshot; subsequent source checks do not require stopping the bot.
2. Run the migration tool as the service user. It defaults to a dry run, prints filenames
   only, and never removes originals. Use a fresh destination: existing files are not
   overwritten or merged. Logs are streamed; JSON is validated and memory identity,
   backups and the alert queue are preserved byte-for-byte. A changing source aborts.
3. After a successful copy, set the shared environment for all services, and verify their
   private config loading, ownership and permissions before starting them again.
4. Keep the old files as a private backup outside the publication checkout after
   verifying the new runtime. The copier does not archive/delete the originals, raw
   game downloads, screenshots, accounts or private operator tooling. Those existing
   artifacts still make a full-tree publication check fail until separated from source.

Windows PowerShell, from the repository root:

```powershell
$sigilState = Join-Path $env:LOCALAPPDATA 'sigil-ai-agent\state'
node scripts/migrate-state.js --from . --to $sigilState --include-config
# With writers stopped and the dry-run reviewed:
node scripts/migrate-state.js --from . --to $sigilState --include-config --copy
$env:SIGIL_STATE_DIR = $sigilState
# Set the same environment in each service/terminal. Load the private config explicitly:
node --env-file="$sigilState\.env" agent.js
```

Use the same `--env-file` for supervisor/viewer/alerts when launching them directly.
The legacy npm commands load a source `.env` if it exists; an external config should
be loaded explicitly rather than relying on that legacy path.

On Linux, provision `/var/lib/sigil-ai-agent` with mode 0700 and ownership for the
actual service user, then run the equivalent copy as that user:

```sh
node scripts/migrate-state.js --from /opt/sigil-agent --to /var/lib/sigil-ai-agent --include-config
node scripts/migrate-state.js --from /opt/sigil-agent --to /var/lib/sigil-ai-agent --include-config --copy
```

An unprivileged alternative is an absolute path under `~/.local/state/sigil-ai-agent`.
New copied files have mode 0600 on POSIX. Existing directory permissions are not changed.
Do not run a root-owned copy and then make private memory/config world-readable to let
the game user access it; provision and copy with the correct ownership.

For the four game services in systemd, use reviewed drop-ins for the actual service
names, replacing their legacy environment-file entry, for example:

```ini
[Service]
Environment=SIGIL_STATE_DIR=/var/lib/sigil-ai-agent
Environment=SIGIL_CONFIG_DIR=/var/lib/sigil-ai-agent
EnvironmentFile=
EnvironmentFile=/var/lib/sigil-ai-agent/.env
```

Agent, supervisor, viewer and Telegram must receive the same state/config paths. Also
provide the two path variables to the independent self-healing worker/guard and
isolated-check service, without replacing their root-only environment-file entries.
Set their `SIGIL_DIR` to the actual source checkout too; the isolated production check
now hashes configuration in the configured directory. Keep their root-only
model/deployment config separate. Update the reviewed
`source/` snapshot with `runtime-paths.js`, its test and `scripts/migrate-state.js` along
with the changed sources before enabling self-evolution. Inspect any service filesystem
sandbox restrictions against the new location. No service files are installed or
restarted by these changes. External harness/account files and private operator scripts
need their own configuration; the public agent does not manage those tools.

## Development and release checks

In Git, the default publication guard checks tracked/staged files and unignored new
files, allowing private local files that Git excludes. `--all-files` checks ignored
files too, and now also checks the index. CI uses this strict mode before and after
Node tests, with Python bytecode caching disabled. Nothing is deleted to make it pass.

If starting from a directory without Git metadata, clone the repository first. A
worktree/archive from `HEAD` includes only committed changes; commit the reviewed
updates before creating a release worktree.
In a real clean repository, use a committed source worktree or export and re-run the
strict guard. Runtime separation alone does not clean old private files or prove that
every secret has been detected; the publication policy and release checks still apply.
