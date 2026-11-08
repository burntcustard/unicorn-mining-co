---
name: sound-design
description: Create and revise procedural one-shot sounds, audition them in the Sound Editor, and compare or fit them to recorded references. Use for UI cues, navigation, selection, and other game sound events.
---

# Sound design

- Use `src/specs/sounds/ui.ts` as the UI anchor. Favor short sci-fi electronics
  inspired by Star Wars, Elite Dangerous, and arcade games. Share motifs
  across related actions. Use the fewest layers
  that give the intended sound, up to eight for UI, and at most three decimal
  places per property.
- For a new sound, normally offer three distinct, descriptively named
  `SoundEffect[]` specs. Once the user chooses one, focus edits on that spec.
  Connect sounds to gameplay only when requested.
- Reuse the running Sound Editor or run `npm run tool:sound-editor` and open
  Vite's printed URL, starting at port 3100. Save pending drafts before
  external edits because a reload replaces edits to that sound. Select or
  play a cue to enable audio, then keep it selected for live replay.
- Save reusable layers under `src/specs/sounds/unassigned/` as named
  `SoundEffect` specs. The editor's **Save layer** and **Add to event** create
  independent copies.
- Compare the exact authored values before and after an edit. Check the full
  event and audition rapid navigation at 50 ms intervals. Use measurements
  to verify requested changes and listening to judge the result.

Use the [analysis workflow](references/workflow.md) for extraction, fitting,
and before-and-after checks. Store recordings, decoded clips, and generated
audio outside the repository.

## Inspiration videos

- [Elite Dangerous cockpit audio](https://www.youtube.com/watch?v=1d_76OqDvNU): Inspired the UI navigation sounds and Acquire Target, which grew from the cockpit panel-opening chirp.
- [Plasma weapon reference](https://www.youtube.com/watch?v=LrjcvwJ6af8): Inspired Plasma Accelerator Ready, Fire, and Ammo Explode, including the brief projectile whoosh before impact.
- [Star Wars seismic charge](https://www.youtube.com/watch?v=j9cQNaJtiec): Inspired the subtle pressure swell and resonant plasma character explored for Plasma Accelerator Ammo Explode.
