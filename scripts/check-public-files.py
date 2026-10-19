"""Deny unreviewed tracked files. Never print file contents or matched secret values."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
ALLOWED = {
    '.gitignore', '.env.example', '.github/workflows/ci.yml',
    'README.md', 'package.json', 'agent-goal.example.txt',
    'agent.js', 'game-intelligence.js', 'game-intelligence.test.js',
    'supervisor.js', 'viewer.js', 'viewer.test.js',
    'autonomy.js', 'autonomy.test.js', 'game-catalog.js', 'server-availability.js',
    'ui-resilience.js', 'ui-resilience.test.js',
    'game-telemetry.js', 'game-telemetry.test.js',
    'progression.js', 'progression.test.js', 'session-hygiene.js', 'session-hygiene.test.js',
    'strategy-dna.js', 'strategy-dna.test.js',
    'self-evolution.js', 'self-evolution-runner.js', 'self-evolution.test.js', 'sigil-self-healing.service',
    'telegram-alerts.js', 'telegram-alerts.test.js',
    'sigil-agent.service', 'sigil-supervisor.service', 'sigil-telegram.service',
    'sigil-viewer.service',
    'sigil-harness.service',
    'sigil-display.service', 'sigil-display.timer',
    'docs/harness-api.md', 'scripts/check-public-files.py',
    'uptime-worker/README.md', 'uptime-worker/monitor.mjs',
    'uptime-worker/monitor.test.mjs', 'uptime-worker/wrangler.toml',
    'cloudflare-worker/README.md', 'cloudflare-worker/src/index.js',
    'cloudflare-worker/wrangler.toml',
}

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
    if name == '.env.example':
        for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
            key, sep, value = line.partition('=')
            if sep and any(word in key.upper() for word in ('TOKEN', 'SECRET', 'PASSWORD', 'API_KEY', 'CHAT_ID', 'RELAY_KEY')) and value.strip():
                bad.append(name)
                print(f'Non-empty secret example: {name}:{number}')
print(f'Public file policy: {len(files)} tracked files, {len(bad)} violations')
sys.exit(bool(bad))
