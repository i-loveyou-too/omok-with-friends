# Final game assets

Approved character sprites live under `characters/<character>/` and are wired only through `characters/manifest.ts`.

Each character has 512×512 transparent WebP files for:

- idle, selected, my turn, waiting, thinking
- win, lose, disconnected, reconnected
- six reaction poses

The files are deterministic crops from the matching character's own final master sheet. Do not mix sources, trace the character artwork, or hard-code sprite paths inside components.

Board lines, stones, last-move/forbidden markers, buttons, speech bubbles, backgrounds, and decorative elements remain interactive DOM/CSS/SVG. Dynamic labels, scores, room codes, and reactions remain accessible HTML text.
