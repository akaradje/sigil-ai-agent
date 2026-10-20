# Proactive learning and reviewed publication

Enable `SIGIL_PROACTIVE=1` for the controller and `SELF_HEAL_PROACTIVE=1` in the
separate root worker. Existing resource/quest trips, death recovery, sustain,
capacity budgets and input rate limits keep ownership. No unknown control is
automatically clicked just because it was discovered.

`world-knowledge.json` lives in `SIGIL_STATE_DIR`, with an atomic previous snapshot.
It stores the validated public catalog, monster combat stats, definitions of recipes,
skills, class requirements, boss phases, sets and public premium offerings. Rendered
buff status, fresh level rankings and observed combat summaries retain timestamps.
The catalog refreshes every 15 minutes and on reconnect. A changed fingerprint
invalidates prior cap/gear plans and learning contexts. Definitions obtained from
ordinary public asset responses are the only network payloads collected: no socket
interception, credentials, full player dump or unpublished server database.

Published drop probabilities describe the public definitions. Repeated complete
inventory scans can establish *net inventory yield* during a same-map combat window
with at least five observed kills, no inventory losses, no intervening recorded
transaction, no writer/reconnect gap, and at most 15 minutes between scans. This is
not claimed to be the server's true drop probability. Unobservable dungeon conditions,
server multipliers and missing fields remain unknown.

After two continuous idle minutes, a supplied, healthy character with fresh validated
telemetry may start a bounded native-AUTO probe in the normal eligible level band.
An existing craft, class, mining, town, storage or recovery task defers it. Attempts
are separated by ten minutes; hazards and inadequate potions veto input. A known
bag with space is required. A due probe precedes ordinary pet/rank
maintenance; urgent survival, earned point allocation and tame offers retain priority.
If the current eligible map is unproductive and another eligible route exists, a
bounded probe tries the next safe route instead of repeatedly selecting the idle map.
AUTO target
and activation must be verified in the rendered UI. Reward still requires 60 seconds
of observed combat warm-up followed by a separate measurement window. Probe clicks
and walking never count as successful experiments.
Mining trips also require real progress. Five continuously observed minutes without
mining EXP/level or material changes, with at least ten fresh observations, ends the
trip and restores leveling for a thirty-minute resource cooldown. The stall becomes
an evidence-backed development opportunity; a healthy progressing trip is retained.

Development opportunities are persisted and deduplicated: repeated enabled unknown
navigation, new public maps/recipes/caps, thirty continuous minutes of flat comparable
EXP and power, sustained fresh evidence of lagging Top 10, or verified level/gear caps.
When safely idle in a verified town with no owned farm or resource task, one unknown
navigation panel may be opened, its rendered requirements/control contract recorded,
and closed without invoking any panel action. Inspections are spaced ten minutes apart.
At verified caps, a compatible top-tier two-recipe material reserve replaces EXP-only
goals. Cap expansion invalidates that plan. Existing DNA continues measured trials.

The worker accepts at most three jobs per day and one per hour. It may edit the
existing UI/cognition files and progression, character-development and DNA modules.
Controller/input gates, publication/deployment code and regression suites remain
protected. A missing UI contract results in `NO_CHANGE`, not a guessed handler.
Generated regression tests are retained in `cognitive-brain.test.js`. Every baseline
and candidate runs the Node suite, Python suite and both publication guards in the
unprivileged, network-isolated OS sandbox. A ten-minute canary with fresh matching
boot/build evidence precedes commitment; the independent guard retains rollback.

## Automatic GitHub publication

Set `SELF_HEAL_GIT_PUBLISH=1` only after provisioning these root-owned paths:

- `/var/lib/sigil-publication/source`: clean checkout of the reviewed main commit,
  remote `git@github.com:akaradje/sigil-ai-agent.git`.
- `/etc/sigil-publication/deploy_key`: mode 0600, repository-specific write deploy key.
- `/etc/sigil-publication/known_hosts`: verified GitHub host keys.

The candidate sandbox and game user cannot read this credential. Git never uses the
game checkout's hooks/configuration. Only enumerated edited source/test files are
copied into the publisher checkout; protected source must match the trusted snapshot.
The complete suites rerun in the sandbox and both guards inspect the publication
checkout and index. A durable commit receipt precedes a normal fast-forward push to
main. Remote divergence blocks publication; there is no automatic force push or merge.
A lost network response is reconciled using the exact pending commit. Failures retry
after 15 minutes and are visible in the publication projection and Telegram; successful
publication includes its verified commit link. Publication failure does not erase a
healthy live deployment. A later runtime rollback remains in deployment history and
does not rewrite Git history.

For an operator deployment, update both the trusted `source/` snapshot and publisher
checkout to the same reviewed commit while the worker and guard are stopped. Preserve
publication receipts, runtime memory, private config and rollback backups. Inspect the
Dashboard knowledge/probe state and worker ledger after restarting. Tests prove the
implemented contracts; they do not guarantee mastery of future unknown game systems.

## Verified activity watchdog

The independent read-only sampler checks task outcomes even while the decision loop
waits for its input budget. Combat/route stalls require three minutes; mining and town
work require five minutes, at least 30 fresh samples, and no sample gap over 15 seconds.
Combat damage or EXP gains, mining EXP/level or required materials, real town receipts,
and travel displacement count as progress. Command timestamps, changing workflow phases,
unrelated passive mining loot and a responsive HTTP endpoint do not count. Pauses,
outages, loading, invalid telemetry and the first 90 seconds of a reload suspend sampling.

Recovery uses the existing controller and input budget, yielding a stalled resource
excursion to leveling with a 30-minute resource backoff. Persistent stalls advance to a
browser reload and then service restart, with at most three recovery actions per hour
persisted across restarts. A decision cycle blocked for 150 seconds also requests a
service restart, at most once per hour. Pending transactions and critical combat/class
work retain their existing protection. Native AUTO activation or a successful command
does not confirm recovery: fresh productive evidence must return. Telegram reports
attempts separately from confirmed recovery. Unresolved verified stalls become bounded
repair opportunities and fail deployment canary health; the watchdog remains protected
from autonomous candidate edits. Inspect `/health` activity and `strategy.activityWatchdog`
for the observed context, recovery history and evidence.

## Automatic class advancement

A rendered shrine offer on the configured Novice → Mage → Starweaver → Sage path
preempts routine farming, earned-point chores and overdue configuration. A capped job
alone never invents a shrine control. The existing observed CTA and shrine actions
start the trip with native hunting stopped; the persisted class route and active native
job quest own the controller through travel, objectives and turn-in. Safety, death and
existing boss/training safeguards retain priority. Stopped native job quests retry with
failure backoff. Refreshes, resource trips and ordinary farm resumption cannot cancel
class travel. Completion and Telegram success require the same character's displayed
job to actually change; acceptance alone is never reported as a completed promotion.
After promotion the combat profile/configuration is refreshed for the new class.

Class objectives have their own progress clock: unrelated EXP, loot and damage against
other monsters cannot hide a stalled boss quest. After three minutes without objective
progress, the controller can navigate to the exact objective through the unique live
boss-board row, with ordinary hunting stopped during approach. Missing/ambiguous rows
restore native quest ownership. Damage against the actual objective protects ongoing
combat. A bounded model review (five-minute cooldown, three calls/hour persisted across
restarts) may select only evidence-validated navigation, quest resumption, shrine return
or a verified boss-respawn wait. Model failures retain deterministic recovery. Repeated
unsuccessful reviews publish fresh objective evidence to the existing repair pipeline.
`classReview` records attempted requests, validation and selected tasks separately from
observed progress; enabling native AUTO alone never demonstrates model participation.
Generic boss approaches retain their observed destination for up to five minutes;
handoff requires a fresh validated position near that exact map/coordinate. Local native
combat then owns the fight, so restarting the class runner cannot pull the character
back to an obsolete boss-spawn map. The bounded class review uses a small 400-token
response and 60-second request deadline; a failed model request may retry after one
minute while retaining the same three-per-hour budget.
The persisted `classObjective` clock advances only when the observed quest objective
changes. Retrying a command, missing tracker during loading and unrelated EXP cannot
reset it. Older installations can retain the same objective's prior observed review
timestamp without treating a retry request as successful progress.
