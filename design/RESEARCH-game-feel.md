# What makes open-world games feel good: research for Crownfall (Nov 8)

Sources were read by a research pass. Values marked (start) are starting points to tune, not published numbers.

## Camera
- **Orbit model** (Nesky, *50 Camera Mistakes*, GDC 2014, Journey). Keep yaw, pitch, distance and offsets around a pivot. Derive distance and FOV from pitch "like gears": look up and the camera comes in and widens; look down and it pulls back. Player input always beats automatic avoidance.
- **Collision**: snap in within about 0.05 s, ease back out over 0.5–1 s (Cinemachine keeps separate damping for each direction). Over a hill, rise rather than swing. Fade the avatar when the camera is too close.
- **Damping**: `x += (t − x)(1 − e^(−k·dt))`. On foot k is about 8–12; in the chariot about 4–6 for position and 2.5–4 for yaw, so the camera swings wide behind turns.
- **Look-ahead**: velocity × 0.2–0.5 s, capped near 2 m on foot and 6 m in the chariot, heavily smoothed.
- **Framing** (start): pivot at shoulder height (1.5–1.7 m), shifted 0.3–0.5 m sideways. On foot, distance 3.5–5 m at FOV 55–60°. In the chariot, distance 7–10 m at FOV 60°, rising to about 72° at top speed.
- **Recenter**: only while moving, after about 2 s with no look input, eased over about 1.2 s.
- **Mode changes**: blend over 0.4–0.6 s; never cut.

## Movement
- Clip playback should match speed (Forsyth, *How To Walk*). Clamp timeScale to 0.7–1.4 and fake the rest with stride.
- Acceleration curve: reach run speed in about 0.2 s and stop in about 0.15 s.
- Turn rate is about 720°/s at a walk, falling to about 300°/s at a sprint, so you arc when running.
- If the input is more than 135° behind you at low speed, pivot instead of spinning on the spot.
- Lean into turns (roll up to ±12° from yaw rate × speed) and with acceleration (pitch ±5°). Bob 2–3 cm at a walk and 5–7 cm at a run, at twice the step rate.
- RDR2 horses: speed varies continuously within each gait, there's sideways velocity in turns, and deceleration is soft. Rider and horse share the same rhythm.

## Chariot speed
- A higher camera at speed raises perceived speed. **Motion blur lowers it** (Holm et al., 2017), so leave it out.
- Shake uses Eiserloh's trauma model: shake = trauma², from noise, mostly rotational (1–2° at most). Add a low constant rumble that grows with speed.
- Things close to the path (posts, rails, crowd) sell speed. Dust scales with slip.
- Collisions get 60–90 ms of hit-stop, a camera kick, a splinter or dust burst, and a crack sound.

## World look
- Most of the "asset soup" look comes from mixed sources. One grade and one light rig unify them.
- Use warm key light and a cool hemisphere fill (sky about #ffe9c4, ground about #5a6b7a). Put the sun low, 15–35° up. Shadows should be cool, never black, from a tight frustum that follows the player.
- Fog colour should equal the sky at the horizon, with distant hills drifting toward desaturated blue. Pop-in should happen inside the haze.
- Post chain: AO (soft) → bloom (threshold about 0.9, intensity 0.2–0.4) → grade → vignette (about 0.4) → SMAA. Put tone mapping in the composer. Every effect should be subtle enough that you have to toggle it to notice.
- Use a neutral base and keep saturation for focal points: banners, markers, the hippodrome.
- Lived-in clutter belongs where work happens: crates at doors, hay by stables. Vary rotation by ±5–15° and scale by ±10%.
- BOTW's triangle rule: hills hide what's behind them, so cresting one reveals 2–3 lures. Use tall silhouettes and smoke columns.

## Alive
- One wind uniform drives grass, trees, banners, smoke and particles (Ghost of Tsushima).
- Barks come from a rule table that picks the most specific matching line, with an 8–15 s global gap (Valve, Ruskin, GDC 2012).
- NPCs turn their heads to you within 6 m, step aside from chariots and shout. Birds scatter within about 10 m.

## HUD
- Ghost of Tsushima has no waypoint UI: the wind points the way. RDR2 keeps a small minimap and lets you turn everything off.
- GTA V pairs one sans for data with one script face for place names.
- Generic tells: Inter on everything, glass cards, emoji, every meter visible all the time, white text with drop shadow.
- Crafted feel: a period display serif plus small caps, meters that appear only when they change, and region title cards (0.6 s in, 2.5 s hold, 1 s out).

## Missions
- Structure: marker, then a cutscene with a stinger, then a travel leg with dialogue on the move, then the core verb, then a twist halfway, then the return, then PASSED with the tally, then a breather.
- Fail on outcomes, never on the route. Say why in one line. Checkpoint every phase.
- Never use the same verb twice in a row. Give each mission one set piece.

## Audio
- Ambience bed per zone, crossfaded over about 2 s.
- Positional emitters (smithy, market, water).
- Random one-shots every 4–15 s with ±8% pitch.
- Footsteps per surface, triggered from the animation phase, never the same sample twice in a row.
- Hooves per gait. Wheel rumble rises with speed.
- Stingers. Duck the music 6–10 dB under dialogue.

## Key sources
- Nesky, GDC 2014: https://gdcvault.com/play/1020460/50-Camera
- Cinemachine 3rd Person Follow: https://docs.unity3d.com/Packages/com.unity.cinemachine@2.8/manual/Cinemachine3rdPersonFollow.html
- Eiserloh, GDC 2016: https://gdcvault.com/play/1023146/Math-for-Game-Programmers-Juicing
- RDR2 horses: https://www.gamedeveloper.com/design/rockstar-s-quest-for-the-ultimate-video-game-horse
- Holm et al. 2017 (perceived speed): https://eudl.eu/doi/10.1007/978-3-319-55834-9_14
- BOTW triangle rule: https://gmtk.substack.com/p/how-nintendo-solved-zeldas-open-world
- Slow Roads: https://web.dev/case-studies/slow-roads
- Ghost of Tsushima wind: https://gdconf.com/news/see-how-ghost-tsushima’s-guiding-wind-came-life-gdc-2021
- Ruskin, dynamic dialogue: https://cdn.fastly.steamstatic.com/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf
- three.js on feeling faster: https://discourse.threejs.org/t/how-to-feel-faster/94266
