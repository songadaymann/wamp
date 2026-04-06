# Room Music Design Principles

These came out of the room-music sequencer / phrase-library session and should guide future passes.

## Core Direction

- The music tool should feel like part of the room editor, not a separate app bolted on top.
- The room itself is the instrument. Keep the music surface spatial and tied to the room grid.
- Favor immediacy over complexity. Builders should be composing quickly, not managing a DAW.

## Layout

- Keep music authoring over the room canvas whenever possible.
- Minimize top chrome. The top strip should stay compact, single-line, and only hold the most-used controls.
- Put repetitive composition surfaces directly on the room, not buried in side panels.
- Reserve side areas for support tasks like library browsing, metadata, or secondary controls.

## Visual Style

- Use a flat, bold, retro game feel. Avoid glassmorphism, soft blur, and generic gradient-heavy UI.
- Pull highlight colors from the active tileset or the established game palette instead of inventing a separate UI palette.
- Keep instrument colors consistent everywhere:
  - sequencer notes
  - arranger lanes
  - phrase library cards
  - instrument tabs
- Empty and filled states should be clearly different shapes or fills, not just opacity variants.
- Outer structural frames should use neutral contrast colors like white unless a strong accent is truly needed.

## Controls

- Prefer icons where the meaning is obvious: play/stop, save, publish, instrument tabs.
- Keep words for mode switches and musical concepts: `Sequencer`, `Arrange`, `Scale Lock`, `Chromatic`, `Tempo`, `Swing`.
- Repeated authoring flows should reduce clicks:
  - after assigning a phrase, advance to the next slot
  - click-to-place / click-to-remove is better than exposing separate draw and erase tools for music
- When music mode is open, the rest of the editor should not compete with it.

## Phrase Library

- Show the information creators actually need when choosing phrases:
  - sample name
  - key
  - original BPM
  - creator
  - room name or coordinates
- Do not waste card space on information already communicated elsewhere, like instrument type if color/icon already shows it.
- Drag-and-drop should be the primary arrangement gesture, with click assignment as fallback.

## Feedback

- Use immediate sound feedback for hover, place, clear, and successful assignment actions.
- Tooltip timing should feel instant.
- Tooltips and helper text should match the same visual language as the rest of the editor.
- Save and publish actions should live inside the music UI, not require context-switching back to general editor controls.

## Musical Behavior

- Room playback should only loop through meaningful filled content, not padded silence.
- If only early slots are populated, loop early.
- If one instrument extends further than others, the full arrangement length should follow the last filled slot across all instruments.
- Tempo and swing are first-class musical controls and should affect real playback, not just UI labels.

## Implementation Guardrails

- Metadata edits must count as real room-music changes.
- Do not reuse playback cache keys as editor dirty-checks if those keys omit editable metadata.
- Keep safety Worker and safety Pages deploys aligned whenever the feature spans frontend and backend.
- Prefer extending the dedicated music modules over pushing more logic into general editor monolith code.
