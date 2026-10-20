# Linux preflight before starting the agent

Run these checks in the reviewed Linux checkout before restarting services. This
document does not trigger deployment, gameplay or Telegram messages.

```sh
set -eu
node --version  # Node.js 22 or newer
npm test
python3 -m unittest discover -s scripts -p 'test_*.py'
python3 scripts/check-public-files.py
```

Two tests skipped on Windows exercise POSIX permissions for the deployment projection
and the isolated verifier snapshot under umask 0077. Linux must run both successfully;
check the test summary for zero failures and zero skips. These tests do not validate
every installed service or timer, or prove that the production OS sandbox can start.
The suite grows when regression tests are added; use its reported total rather than
requiring the earlier 317-test count.

The [publication guard](publication-policy.md) checks working and staged files in a
source Git checkout. A live runtime folder containing configuration and memory must
be kept separate. Check any prepared release/export with `--all-files` before adding
private deployment configuration. A missing checker or any nonzero exit blocks release.

On the configured VPS, inspect the reviewed units and their installed copies:

```sh
systemd-analyze verify "$PWD"/sigil-*.service "$PWD"/sigil-*.timer
stat -c '%a %U:%G %n' sigil-*.service sigil-*.timer
```

Resolve errors against the actual Node/runtime paths, service user, protected source
snapshot and referenced units. Review installed file ownership/permissions separately;
the tests above concern journal/snapshot permissions, not installed unit ownership.
Include the updated cognitive module and tests in the root-owned trusted source snapshot
used by self-evolution before enabling it.

At cold start, the dashboard should show waiting for combat, then a 60-second warm-up,
then measurement. Walking with AUTO enabled alone cannot complete warm-up. A new map,
changed native profile, interrupted combat or missing/stale telemetry restarts it. The
first ordinary experience needs a further full minute; safety incidents are still
recorded during warm-up. Empty memory cannot expand map eligibility or use curiosity to
override the level band, material objectives or DNA exclusions.
