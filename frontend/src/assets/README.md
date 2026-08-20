# Asset slots

Character images are intentionally not bundled. Add approved files under
`characters/<character>/` and connect their URLs in `characters/manifest.ts`.
The manifest already has slots for default, turn, waiting, thinking, win,
lose, disconnected, reconnected and reaction states.

Optional visual assets can be organized under:

- `reactions/`
- `board/`
- `backgrounds/`
- `decorations/`
- `ui/`

All dynamic labels, scores, room codes and reactions remain HTML text. The
board is rendered as interactive HTML/CSS rather than an image.

