# FORGE OFFICE — Virtual Office (build spec)

You are building **Forge Office**: a multiplayer, local-LAN virtual office where two people walk around as customizable avatars while stylized "harness agent" avatars go about their work. Top-down 2D with 2.5D perspective (Among Us / Prison Architect style: you see the whole room, rooms are only visible when lit, chunky stylized vector art).

## Stack (hard constraints)
- **Vanilla JS + HTML5 Canvas only. NO npm install, NO dependencies, NO external assets.** The host machine has no GPU and limited RAM — everything generated in code: sprites, tiles, SFX.
- Node.js v26 is available. `node server.js` must run the server with zero `npm install`.
- WebSocket multiplayer: implement the server-side upgrade **by hand** (raw `http` upgrade + `crypto` for SHA-1 handshake). Do NOT use the `ws` package.
- Everything client-rendered on a single canvas. 60fps target with ~40 sprites.
- Art: flat vector shapes, thick outlines, soft pastel-but-bold palette, chunky shadows (offset, no blur). Among Us characters = simple capsule/blob body, tiny feet, name tag above head. Prison Architect vibe = top-down rooms, furniture, visible "paper" details.

## Files to create (in this directory)
```
server.js          # Node: static file server + /bridge WS + /api/proxy -> 127.0.0.1:8903
web/index.html
web/style.css
web/app.js         # split into multiple files is fine (game.js, agents.js, net.js, sfx.js, ...)
data/office.json   # cosmetics catalog + canned chat lines + seed data (agents, layout overrides)
test/bridge-test.js  # automated test of the WS bridge (see verification)
```

## Map & rooms (top-down, camera follows player, whole map visible when zoomed out)
One building, warm "indie game" aesthetic. Grid-based (cells ~32px). Rooms:
1. **Lobby / Front Desk (center)** — entrance at bottom. C6 (the assistant) sits at a front desk facing the entrance, right in front of the **Main Status Board** (large wall screen, center of lobby, mounted on the back wall). The board shows LIVE data (see Data section): per-harness stats (sessions, tokens, activity), a clock, service health. Animated: bars/numbers tick, subtle scanlines.
2. **Harness offices (one per harness)** — each gets its own office with desk + computer + chair, a door to the lobby, and a sign with the harness name. Offices: `opencode`, `claude-code`, `antigravity`. Each harness avatar has its own default look (opencode = teal blob w/ headphones, claude-code = orange-ish blob w/ beret, antigravity = blue-ish blob w/ antenna) but users can also re-skin them.
3. **The Archives** — hallway extending down/away from the lobby. Long room of **project boxes on shelves**; each box labeled with a project name. Room **grows infinitely in one direction**: for every new project (from the console API) another shelf+box extends the room; walls, floor, lighting, and the pathfinding grid all extend dynamically. Boxes are interactable (E): a small label popup with project name, description, deployed?, last updated.
4. **Break room** — coffee machine, table, chairs. Agents wander here.
5. Optionally a small **storage/buffer room** if it fits the layout.

Walls are solid; doors are gaps that render as doors (animated open/close, creak SFX). Lighting: **per-room baked light** — rooms are dim/unseen until a light source exists: lamps (glow radius), the status board glows the lobby, screen glows in offices. Implement as: base map drawn dark (multiply ~0.25), then light overlays (radial gradients, `screen`/`lighter` composite) baked to an offscreen canvas, only re-rendered when lights change. This is the "you have to be in a lit room to see it" feel from the brief.

## Entities
### Players (real humans, 2 at a time but support up to ~8)
- Custom **name** (free text, max 16 chars, set on join + changeable).
- **Cosmetics** (all in data/office.json, combined freely): 10 body colors, 8 hats (none, cap, beanie, crown, hard hat, wizard, halo, bow), 4 trails (none, sparkle, star, bubble), 4 skin/face types. ~200 combos. `C` key opens a small cosmetics panel. Equip = chime SFX + tiny sparkle burst.
- Movement: WASD/arrows, smooth acceleration + friction, diagonal normalized, `Shift` = sprint. Walk animation = 2-frame foot cycle + bob. Footstep SFX (soft squeak, rate-scaled to speed).
- Name tag above head, rounded rect, follows.
- Touch input: virtual joystick (left) + sprint button (right) for mobile browsers.
- Collision vs walls/furniture via grid (circle vs solid cells).

### C6 (the assistant, at the front desk)
- Stationed at the desk, idle animation (typing on a small laptop, occasional look-up).
- **Walk up to C6 (within radius) → chat bubble appears above C6's head with a pregenerated line** (10+ lines in office.json, picked cycling/random), **typed character-by-character** (typewriter, ~25ms/char, soft blip per char, bubble pops in with a ding). Re-approaching after leaving triggers the next line. Lines are casual: "hi! welcome to the office", "board's looking good today", "the archives keep growing — check the new box", etc.
- Also small reactions: wave when a player enters the lobby; C6 stands up when a player approaches the desk (idle → stand transition).

### Harness agents (opencode, claude-code, antigravity avatars)
- Each lives in its own office. **States**: idle (at desk, typing anim, screen glow flickers), working (faster typing, "zzz/steam" particles from the monitor, occasionally stands), moving (walks lobby → break room → lobby or to the Archives to fetch papers), on coffee.
- **Pathfinding: A* on the grid** (rebuild only when the map changes, e.g. archives extend). Waypoints: office door → lobby → break room / archives shelf. Papers: when "fetching", they carry a tiny stack of papers sprite.
- **Subagents**: when a harness is "working" (driven by live activity, see Data), a **tiny avatar** (half size, same color family, small name tag like "sub") appears *inside that harness's office* running around (little errand loop). 0–3 subagents based on activity level.
- Agent behavior driven by a shared deterministic "office brain": seeded PRNG + live stats modulate state-machine timers, so both clients see the same behavior without server-side simulation.
- Agents occasionally emit **tiny speech bubbles** (single words: "hm", "compiling", "coffee?") with the same typewriter effect.

## Live data (main board + agent behavior)
Console API at **`http://127.0.0.1:8903`** (the browser fetches `/api/...` same-origin; `server.js` proxies `/api/*` → `http://127.0.0.1:8903/api/*` and passes through the JSON). Endpoints + shapes (verified):
- `GET /api/summary` → `{sessions, messages, user_messages, tool_calls, api_calls, input_tokens, output_tokens, total_tokens, billed_tokens, total_hours_active, avg_session_duration_s, generated_at}`
- `GET /api/opencode` → `{sessions, models:[{model, sessions, input_tokens, output_tokens, ...}]}`
- `GET /api/antigravity` → same shape
- `GET /api/projects` → `[{id, name, path, description, deployed, tags[], updated, service?, deployment_url?}]`
- `GET /api/health` → `{ok, port, services:[...], projects:bool}`
The board polls `/api/summary` + harness endpoints every 15s and `/api/projects` every 30s (new project → grow the archives + "new box!" jingle). Board also shows a small "CONSOLE ONLINE/OFFLINE" dot (fetch /api/health). Offline = board dims, agents get bored (sit more).

## Multiplayer (the bridge)
`server.js` serves `web/` and accepts a single WebSocket at `/bridge` (hand-rolled upgrade, no deps). JSON messages:
- client→server: `join {name, cosmetics}` | `move {x,y,dir,facing}` (throttle 15Hz) | `equip {cosmetics}` | `name {name}`
- server→client: `welcome {you, players:[...], agentsSeed}` | `player-join` | `player-leave` | `move {id,x,y,dir}` (relayed, 15Hz) | `equip` | `name`
- Remote players render with the same sprite system (interpolated position, lerp 120ms). Heartbeat 5s; drop after 12s silent.
- Both humans can be in the same room at once; players block paths of agents (simple repulsion, no re-path).

## Sound (all synthesized WebAudio, no audio files)
- Footsteps (filtered noise ticks), door creak (sawtooth glide), bubble pop + blip per typed char, chime (equip), "ding" (bubble opens), ambient office hum (low filtered noise, quiet), monitor clacks when agents type fast, coffee machine gurgles, "new box" jingle (3-note), UI ticks. Master mute `M`. Autoplay policy: start audio on first input; a big "CLICK TO ENTER OFFICE" start screen doubles as the name + cosmetics setup (this is the join screen).
- Start screen: name input + cosmetic picker + Enter button. Polished, styled to match the game.

## Performance
- One canvas, devicePixelRatio-aware. Light overlays pre-baked. Sprites = cached offscreen canvases per (character, frame, cosmetics) — build lazily. Pause rAF when `document.hidden`. A* grid ~64x48 cells. Keep JS heap < 150MB.

## Constraints
- No network fetches except the same-origin `/api/*` proxy (which hits localhost:8903 server-side). No CDN, no fonts from the web (use a chunky rounded font stack: `"Segoe UI Rounded", "Nunito", system-ui` — system fonts only).
- No `npm install`, no build step. `node server.js` is the whole server story.
- Bind `0.0.0.0:8904` (LAN friends join via `http://192.168.1.201:8904`).
- Code must pass `node --check` on every JS file.

## Verification (do ALL, report results)
1. `node --check server.js` and every web/*.js (via `node --check` on each).
2. Start `node server.js`; `curl -s http://127.0.0.1:8904/` returns index.html; `curl -s http://127.0.0.1:8904/api/summary` returns the proxied console JSON (confirm `sessions` field present).
3. Write `test/bridge-test.js`: opens 2 WS clients (use `http` upgrade by hand or a minimal raw impl), client A joins + sends moves, client B joins and receives A's presence + moves; assert round-trip < 500ms; print PASS/FAIL. Run it.
4. Simulate a 2-minute "play" headless is not required; instead print a `CHECKLIST.md`-style summary of what you implemented vs the spec.
5. Leave the server STOPPED (C6 starts the systemd service itself).

## Priority (if you run low on time, do in this order)
1. Map + art + lighting + player movement (the core feel)
2. C6 + typewriter chat + cosmetics + start screen
3. Harness agents + A* + subagents + archives (growing) + live data board
4. Multiplayer bridge
5. Sound polish

Build everything. Verify per the checklist. Stop before starting any system service.
