# Local browser harness contract

Provide your own adapter bound to `127.0.0.1:4799`. The adapter owns a browser page already
authenticated to your game account. No account credentials or browser profiles are included here.
Never expose this API through the viewer or a public reverse proxy: `/eval` executes JavaScript.

| GET endpoint | Expected response/behavior |
| --- | --- |
| `/eval?expr=<URL-encoded JS>` | Evaluate the expression in the game page and return its string result as plain text. Expressions returning `JSON.stringify(...)` must not be JSON-encoded again. |
| `/screenshot` | Raw JPEG bytes of the game viewport. |
| `/click?x=<number>&y=<number>` | A normal pointer click at viewport coordinates, then a short plain-text acknowledgement. |
| `/type?key=<key>` | One normal keyboard press, e.g. `Escape`, `Space`, `k`, `3`. |
| `/typestr?str=<text>` | Normal keyboard text input in the active field. |

The agent reads visible DOM and derives coordinates from current controls. Its scrolling expressions
only bring an observed control into view. Do not implement hidden game-state mutation or server
commands in the adapter. Use a real display/browser focus compatible with `xdotool` for held keys.

Only one character controller should own the browser. The viewer receives screenshots/state via
explicit read-only routes; it must never forward arbitrary harness requests. Keep login recovery,
browser process lifecycle, cookie storage, and optional `sigil-harness.service` configuration private.
