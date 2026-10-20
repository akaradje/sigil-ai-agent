"""Deny unreviewed tracked files. Never print file contents or matched secret values."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
ALLOWED = {
    '.gitattributes',
    '.env.example',
    '.github/workflows/ci.yml',
    '.gitignore',
    'README.md',
    'agent-goal.example.txt',
    'agent.js',
    'activity-watchdog.js',
    'activity-watchdog.test.js',
    'autonomy.js',
    'autonomy.test.js',
    'character-development.js',
    'character-development.test.js',
    'cloudflare-worker/README.md',
    'cloudflare-worker/src/index.js',
    'cloudflare-worker/wrangler.toml',
    'cognitive-brain.js',
    'cognitive-brain.test.js',
    'world-knowledge.js',
    'world-knowledge.test.js',
    'proactive-planner.js',
    'proactive-planner.test.js',
    'self-publication.js',
    'self-publication.test.js',
    'self-evolution.candidate.test.js',
    'docs/proactive-evolution.md',
    'docs/harness-api.md',
    'docs/linux-preflight.md',
    'docs/publication-policy.md',
    'docs/runtime-storage.md',
    'game-catalog.js',
    'game-intelligence.js',
    'game-intelligence.test.js',
    'game-telemetry.js',
    'game-telemetry.test.js',
    'package.json',
    'progression.js',
    'progression.test.js',
    'runtime-paths.js',
    'runtime-paths.test.js',
    'scripts/check-public-files.py',
    'scripts/check-public-paths.py',
    'scripts/migrate-state.js',
    'scripts/test_check_public_files.py',
    'self-deployment.js',
    'self-deployment.test.js',
    'self-evolution-runner.js',
    'self-evolution.js',
    'self-evolution.test.js',
    'self-healing-check.js',
    'self-healing-check.test.js',
    'server-availability.js',
    'session-hygiene.js',
    'session-hygiene.test.js',
    'sigil-agent.service',
    'sigil-display.service',
    'sigil-display.timer',
    'sigil-harness.service',
    'sigil-self-healing-check.service',
    'sigil-self-healing-check.timer',
    'sigil-self-healing-guard.service',
    'sigil-self-healing-guard.timer',
    'sigil-self-healing.service',
    'sigil-supervisor.service',
    'sigil-telegram.service',
    'sigil-viewer.service',
    'strategy-dna.js',
    'strategy-dna.test.js',
    'supervisor.js',
    'telegram-alerts.js',
    'telegram-alerts.test.js',
    'ui-resilience.js',
    'ui-resilience.test.js',
    'uptime-worker/README.md',
    'uptime-worker/monitor.mjs',
    'uptime-worker/monitor.test.mjs',
    'uptime-worker/wrangler.toml',
    'viewer.js',
    'viewer.test.js',
}

if sys.argv[1:] == ['--export']:
    files = [p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*') if '.git' not in p.relative_to(ROOT).parts and (p.is_file() or p.is_symlink())]
elif sys.argv[1:]:
    raise SystemExit('Unsupported public-paths arguments')
else:
    result = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, capture_output=True, check=True)
    files = [name for name in result.stdout.decode().split('\0') if name]
bad = sorted(set(files) - ALLOWED)
for name in bad:
    print(f'Unreviewed tracked path: {name}')
for name in files:
    path = ROOT / name
    if path.is_symlink():
        bad.append(name)
        print(f'Symlink is not allowed: {name}')
        continue
    if name == '.env.example':
        for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
            key, sep, value = line.partition('=')
            if sep and any(word in key.upper() for word in ('TOKEN', 'SECRET', 'PASSWORD', 'API_KEY', 'CHAT_ID', 'RELAY_KEY')) and value.strip():
                bad.append(name)
                print(f'Non-empty secret example: {name}:{number}')
print(f'Public file policy: {len(files)} tracked files, {len(bad)} violations')
sys.exit(bool(bad))
