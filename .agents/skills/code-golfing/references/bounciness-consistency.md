# Bounciness consistency (2026-09-08)

## Retained change

User-approved gameplay alignment: hull and ordinary modules use the shared
`hullBounciness` fallback of `0.2`, and all five active item definitions specify
`bounciness: 0.2`. Only gold and diamond needed their item values changed.
The shield goes from `0.4` to `0.5` to preserve its deliberately strong bounce.

The drill keeps its existing callback: `-1` while activation progress exceeds
`0.5`, otherwise `0`. Its negative value suppresses restitution from either
contact surface while mining. Asteroids remain at `0.1`. All item and module
health values are unchanged; disabled platinum is unchanged.

Measured with `npm run build:fast`, fixed Roadroller settings and 10 advzip
iterations: **13,345 → 13,340 bytes, saving 5 bytes**. Retained after a fresh
baseline and confirmation build. Collision/bounce and docked inventory, menu,
damage, repairs, scoop physics and flight tests pass, as does lint. No browser
playtest was run.

## Alternatives measured

Every row starts from the same 13,345-byte baseline. Only the retained row
below was applied; other candidates were reverted. The drill's special
behavior and all health values were preserved throughout these comparisons.

| Alignment | Shield | Advzip before → after | Result |
|---|---|---|---|
| Shield only | 0.5 | 13345 → 13360B | +15B |
| Hull/ordinary modules at 0.2; original items | 0.4 | 13345 → 13361B | +16B |
| Hull/ordinary modules at 0.2; original items | 0.5 | 13345 → 13360B | +15B |
| Hull/ordinary modules and individual items at 0.2 | 0.4 | 13345 → 13341B | -4B |
| Hull/ordinary modules and individual items at 0.2 | 0.5 | 13345 → 13340B | **Retained, -5B** |
| Hull/ordinary modules at 0.2; item fallback 0.2 | 0.4 | 13345 → 13369B | +24B |
| Hull/ordinary modules at 0.2; item fallback 0.2 | 0.5 | 13345 → 13347B | +2B |
| Also align asteroids; individual items at 0.2 | 0.4 | 13345 → 13341B | -4B |
| Also align asteroids; individual items at 0.2 | 0.5 | 13345 → 13359B | +14B |
| Also align asteroids; item fallback 0.2 | 0.4 | 13345 → 13363B | +18B |
| Also align asteroids; item fallback 0.2 | 0.5 | 13345 → 13347B | +2B |
| Individual items at existing hull/asteroid 0.1 | 0.4 | 13345 → 13344B | -1B |
| Individual items at existing hull/asteroid 0.1 | 0.5 | 13345 → 13362B | +17B |
| Item fallback at existing hull/asteroid 0.1 | 0.4 | 13345 → 13350B | +5B |
| Item fallback at existing hull/asteroid 0.1 | 0.5 | 13345 → 13349B | +4B |

The item fallback removes bounciness from the active definitions and uses
`Object.assign(this, { bounciness: 0.2 }, data)` in `Item` (or `0.1` in the
corresponding rows). Repeated individual values compressed better here.
Savings are not additive with earlier item-health experiments.

An earlier 16-byte-saving candidate removed the shield's high restitution
and moved the drill rule into hitbox creation. It was rejected because the
shield's extra bounce is intentional; do not retry that gameplay change.
