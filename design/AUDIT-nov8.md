# Play-mode audit, Nov 8: why it reads as "AI sloppy"

Screens: scratchpad au0–au4 (spawn, walking, countryside, Vinehold market, Emberfall).

## The tells, worst first

1. **Three art styles at once.** Generated buildings are textured and almost photoreal. The characters and horses are realistic. My Blender props and the chariot are flat, untextured toy colours. Nothing ties them together, and that clash is the biggest giveaway.
2. **Flat noon light.** The sky is near-white, there's no atmosphere and no colour grade. Shadows are weak, there's no ambient occlusion where walls meet the ground, and far things are as sharp and saturated as near ones. Fog starts at 700, far beyond anything you see on foot.
3. **The ground is a tiled photo.** The grass is noisy and repeats. Roads are beige ribbons with hard edges, and nothing grows along them: no grass blades, stones, flowers or mud.
4. **Trees fall apart up close.** The canopies are big boxy polygons wrapped in a leaf photo. The camera sits inside them (soft circles are ignored by the camera check).
5. **Floating labels in the world.** Landmark names ("Polosukhin's Reach", "Mumtaz Hippodrome") hang in the air in play mode. There's a "Test Lord / House Velmont" nameplate on your own head, and Html name tags on the mission givers. No GTA, RDR or Ghost game does this.
6. **Desktop chrome over the game.** "Map view" and "Built on NEAR" buttons sit top left, beside a tutorial box with a hard edge. The status text is tiny and grey, and "Practice purse · not on chain yet" is on screen the whole time.
7. **Stiff body.** One walk clip with no lean, no start or stop, and no turn. The camera locks the character dead centre and never leads.
8. **Empty world.** A handful of walkers, no ambient sound bed (wind, birds, crowd, water), no birds, no smoke from chimneys, nothing swaying.
9. **The chariot looks like a toy.** A flat yellow tub on a brown box, next to realistic horses.
10. **Odd scale.** Market stalls and wells are the right size for a person but tiny next to the buildings. Barrels have no texture.

## Direction

Push one look: grounded, warm, late-afternoon realism, painted rather than photographic. That means:
- Grade everything with the same light and post chain (AO, fog, grade, vignette) so mixed sources read as one world.
- Give hand-made props the same texture treatment as the buildings: triplanar wood, cloth and stone, so nothing is flat-coloured.
- Strip every world-space label in play. The radar, the markers and the area name do that job.
