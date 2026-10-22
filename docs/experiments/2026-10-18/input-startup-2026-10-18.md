# Browser input and startup follow-up — October 18, 2026

> Evidence for this completed investigation is in the
> [2026-10-18 archive](../../../benchmarking/archive/README.md#2026-10-18).
> Restore the original paths and reproduction instructions with
> `node benchmarking/tools/extract-experiments.ts 2026-10-18`.

The performance changes use the same production code in Chrome and Firefox.
The HUD map-size cache uses `ResizeObserver`; there is no Firefox detection or
forced graphics preference. Browser-specific automation in the input runner
uses Chrome CDP or Firefox BiDi, outside the shipped game.

The preceding [HUD investigation](performance-fixes-2026-10-18.md) measured
Firefox tab CPU falling from 16.80 to 16.29 seconds in a 20-second profile,
approximately 3%. Ordinary flight captures measured frame work falling from
7.71 to 7.29 ms, 5.4%, and FPS changing from 96.46 to 97.30. These sequential
captures establish a modest saving, not a reliable general FPS increase.
Chrome's earlier acceptance captures stayed around 119–120 FPS in the 1440p
scenarios and the 4K flight check. Those rendering suites were not repeated in
this follow-up; the new browser measurements target input and startup.

No browser-dependent production alternative was retained, so no new settings
toggle is needed for these changes. A future alternative that trades performance
between browsers should remain user-selectable with a suitable browser default.

## What was failing

Earlier benchmark startup problems came from stale assumptions about menus,
profile creation, and lazy module paths. Those runner repairs preceded the
completed 16-case live rerun. The subsequent three failures in nine local
captures were **first-input latency assertions**, not failed application starts.

This investigation found both measurement errors and real delays:

- The old input runner timestamped a key after its CDP acknowledgement. Local
  movement could already have occurred before the recorded edge. Interpolating
  a baseline across that edge compounded the error.
- Its artificial network delay used page timers. A nominal 5 ms outgoing delay
  stretched to 25 ms during first-key work. A worker-owned-socket experiment
  also introduced extra Firefox transport scheduling: the worker reported a send
  at 6 ms, but Go read it at 33.6 or 44.1 ms. Go applied those inputs within
  0.3 ms of reading them. Those worker captures are diagnostic only.
- Creating the audio context blocked the first key for approximately 40–44 ms
  in the initial Chrome traces, before networking received the changed control.
- A decoded snapshot could be deferred another frame even when the client had
  already reached its simulation tick. The rAF timestamp can predate receipt
  although the frame callback executes after it.

The last issue reproduced after the audio and measurement repairs. In
`final-firefox-5-3`, the observer decoded the first changed control at 45 ms.
Its frame timestamp was 40.5 ms, so reconciliation waited until the next frame;
smoothing then held the old displayed pose for that frame. First displayed
motion was recorded at 79 ms, versus 8 ms locally: a 71 ms difference against
the unchanged 60 ms limit. This failed capture remains saved.

## Changes kept

Keyboard controls are now recorded and sent before synchronous audio unlocking. Play
initializes audio alongside world entry; an actual gameplay key still resumes
a suspended context. Audio initialization remains a real one-time cost, now
paid during Play rather than the first flight control. In the two-browser
fixture it sometimes took 100 ms; this change does not eliminate that CPU work.
Menu preparation still creates no audio context, and audio setup failure does
not block world entry.

A decoded snapshot now reconciles immediately if its tick has already been
reached. A snapshot ahead of the client clock still waits until its receipt
boundary is due. Regression tests cover equal and ahead client ticks, deferred
future snapshots, and recovery beyond the prediction horizon. The simulation
clock, prediction horizon, and reconciliation smoothing rules are unchanged.

The benchmark records actual DOM key-event time and the last completed frame
before the event. It keeps rAF simulation timestamps for sustained trajectory
fitting, and completion timestamps for first-response timing. The fitted-lag
search now covers both directions equally, avoiding the old −30 ms boundary.
These are JavaScript frame-completion measurements, not physical display scanout.

Artificial transit now runs in the existing Vite proxy, retaining native browser
WebSockets. Only explicitly marked benchmark connections get the delay, only
under the development server. Production and preview connections are unaffected.
The hook models latency for this small input fixture, not bandwidth or socket
backpressure. The runner also checks browser errors and audio state, bounds
automation waits, and closes game connections before stopping its browser.

## Verification

Chrome entries use the installed Chromium 155; Firefox is version 158.
All final captures used two isolated clients, a 1440 × 900 viewport, 5 ms transit
each way, and 16 steering edges. The unchanged first-response and sustained-lag
limits remain below **60 ms**. Builds, tests, and profiles did not compete with
the captures. Visible-window runs used the ordinary desktop renderer.

| Browser/mode             | Captures passing | Pilot first response ms | Observer first response ms | Observer minus pilot ms | Sustained fitted lag ms |
| ------------------------ | ---------------- | ----------------------- | -------------------------- | ----------------------- | ----------------------- |
| Chrome, visible          | 3/3              | 6.6–11.2                | 41.2–58.1                  | 30.0–47.0               | −1, 7, 14               |
| Firefox, visible         | 3/3              | 9–16                    | 50–68                      | 40–59                   | −20, −14, 11            |
| Chrome, default headless | 1/1              | 19.8                    | 53.2                       | 33.4                    | −1                      |

All seven captures retained the piloted ship, reported no browser errors, and
unlocked the pilot's audio successfully. Firefox's 59 ms maximum has little
margin against 60 ms. This is a successful repeated check on this host, not a
guarantee against future scheduling stalls. Separate client clocks can still
produce different sustained phases; there is no added snapshot playback buffer.

The full suite passed: **65 Node test entries and all Go packages**. Production
UI checks passed after the final snapshot change, including deferred startup,
navigation, identity, preferences, preview, layout, docking, trade, repair,
paint, focus, and launch. The UI suite explicitly verifies zero audio contexts
during preparation and one after Play. Production builds and lint passed.

| Emitted resource                      | Before bytes | After bytes | Change |
| ------------------------------------- | ------------ | ----------- | ------ |
| All JavaScript chunks                 | 270,583      | 270,666     | +83    |
| Sum of gzip-level-1 JavaScript chunks | 113,259      | 113,291     | +32    |
| CSS                                   | 17,465       | 17,465      | 0      |
| Stripped server                       | 13,164,704   | 13,164,704  | 0      |

The baseline here is the preceding recovery/HUD follow-up. The Go product code
did not change in this follow-up; temporary input tracing was removed and the
files restored exactly. Nothing was deployed. Investigation-owned services and
browser processes were stopped.

## Evidence and reproduction

The [retained evidence](../../../benchmarking/archive/README.md#2026-10-18)
contains all 42 captures from this investigation, including failures, temporary
server timing logs, final source snapshots, a product patch, source hashes,
resource sizes, and verification logs. Only the seven `verified-*` captures
represent the final implementation. Other captures use intermediate code or
measurement methods and must not be pooled into a final pass rate.

Start the standard Go server and Vite frontend, then run each browser serially:

```sh
INPUT_RESPONSE_HEADFUL=1 node benchmarking/tools/input-response-browser.ts benchmarking/local/response-chrome.json.gz 5 chrome
INPUT_RESPONSE_HEADFUL=1 node benchmarking/tools/input-response-browser.ts benchmarking/local/response-firefox.json.gz 5 firefox
```

Set `CHROME_BIN` or `FIREFOX_BIN` for a non-default installed executable. Snap
browsers need a `TMPDIR` visible inside their sandbox, such as a directory under
`benchmarking/local/`. Omitting `INPUT_RESPONSE_HEADFUL` uses headless mode;
omitting the browser argument selects Chrome. A delay of zero keeps the ordinary
native socket without proxy emulation. Firefox headless diagnostic captures had
approximately 50 ms frame-interval p95, substantially worse than visible windows;
they are retained but do not represent the final desktop acceptance runs.
