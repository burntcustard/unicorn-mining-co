# Remote collision presentation — 2026-10-02

Two presentation problems reproduce the reported rubber-banding at 30 Hz:
packet bursts can jump the interpolation clock, and a corrected nearby ship can
jump directly to its new predicted collision pose. Both now preserve the displayed
position at the instant of packet receipt or snapshot application.

## Causes and changes

`RemoteMotion` previously forced its playback cursor forward when a received
snapshot changed the measured interval. The two-packet receipt window produces
uneven intervals on longer round trips. Keeping only four frames could also
discard the endpoint still being drawn when several updates arrived together.
The sampler now keeps the endpoints it needs, with a maximum of 17 frames, and
catches up at no more than twice normal playback speed. Steady delivery retains
the existing two-tick presentation schedule. Long outages reset history rather
than leaving a long queue to drain.

Near the local hull, remote presentation blends into frame prediction so both
ships participate in the shared collision solve. Reconciliation can change that
predicted pose substantially when a collision is learned about. The client now
captures the rendered poses before applying a snapshot and completing its tick,
then preserves those positions and headings with rendering-only correction
offsets. The offsets decay with a 33.3 ms time constant: approximately 95% of an
isolated correction disappears in 100 ms. Physics and controls still update
immediately. Docking, teleports, initial loads and respawns reset presentation
instead of smoothing a discontinuity.

This intentionally permits a brief visual offset from the physical collision
body during correction recovery. The contact regression checks that interpolation
adds no further error beyond that explicit offset. Existing exact contact tests
still cover prediction without a pending visual correction.

## Reproduction and results

The new `tests/remote-contact.test.ts` uses two actual `NetworkClient` instances,
binary snapshots, delta reconstruction, receipt acknowledgements, prediction and
the TypeScript authoritative session. A moving ship bumps a fixed asteroid and
can subsequently hit the observer. It tests observer separations of 0, 85, 110,
160 and 400 world units, with 40 or 90 ms downstream delay and periodic 20 ms
extra delays. Physical narrow-phase queries verify contacts actually occur.

Each case runs ten simulated seconds at 30 Hz simulation and 60 Hz display rate.
After setup, poses are sampled immediately before/after delivery and immediately
before/after a snapshot update at the same timestamp. Three separate process
runs per version, alternating execution order, give **60 cases** in total.

| Maximum instantaneous displacement |                Before |          After |
| ---------------------------------- | --------------------: | -------------: |
| Packet receipt                     | 17.577023 world units |              0 |
| Snapshot application               | 20.465910 world units | 0.000000002539 |

Physical contact-tick counts and final authoritative ship positions and velocities
match exactly between versions and across repetitions. These figures measure
instantaneous presentation discontinuities, not ordinary travel between frames;
physical bumps, changes of direction and catch-up motion still occur.

The baseline is commit `106cee4` (the 30 Hz snapshot change). The
[raw comparison](../../benchmarking/results/2026-10-02-remote-contact.json.gz)
retains all samples, source hashes and baseline client sources. The comparison
uses in-memory socket transport with immediate upstream input/acknowledgement
delivery, so it does not measure WAN loss, GPU rendering or browser stalls.
The existing real WebSocket two-client prediction and bump tests separately pass.

Reproduce the fixed regression suite and comparison with:

```sh
npm run test:prediction
node benchmarking/remote-contact.mjs 106cee4 \
  benchmarking/results/2026-10-02-remote-contact.json.gz
```

The runner compiles both client variants without modifying the checkout. Only
the new continuity assertions are disabled for the baseline; physical-contact
and transport checks remain active for both variants. Temporary bundles are
removed afterward.

## Validation and size

Production builds before and after, the complete `npm test` suite and type-aware
lint pass. Lint retains the two existing `no-new-array` warnings. New tests cover
burst history retention, bounded catch-up, correction continuity and decay,
unchanged mechanics, docking, teleport and reset behavior. The real socket bump
test verifies contact blending adds no interpolation error beyond its explicitly
decaying presentation correction.

Formatting checks pass for the changed files. Repository-wide `format:check`
still reports formatting issues in six existing experiment reports; those
unrelated documents are unchanged.

The client entry changes from 120,491 / 52,997 to 121,545 / 53,432 bytes
(raw / gzip level 1): **+1,054 raw bytes, +435 gzip bytes**. Docked and sound
chunks remain 4,708 and 1,681 raw bytes; docked gzip grows by one byte. The Node
server remains 105,795 raw bytes, with gzip changing from 45,386 to 45,389 bytes
due to shared build property mapping. No server simulation or snapshot rate
changes are part of this fix.
