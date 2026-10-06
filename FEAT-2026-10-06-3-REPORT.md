# FEAT-2026-10-06-3 Report — Forge Office Round 3

**Date:** 2026-10-06  
**Status:** All 8 Items Implemented & Verified  
**Server State:** Test server stopped; live service on port 8904 untouched (PID 560491)  

---

## Executive Summary

All eight features specified in `FEAT-2026-10-06-3.md` have been implemented in exact order with zero npm dependencies, using pure vanilla JavaScript and procedural HTML5 Canvas art. All automated tests pass:
- `test/reachability-test.js`: 78/78 reachability targets passed (A* pathfinding, doors, waypoints, archive shelf expansion).
- `test/voice-test.js`: DDA raycast wall occlusion math, distance gain, cutoff frequency, and network relay verified (200px chunk delivered < 100ms; >800px chunk dropped).
- `test/browser-test.js`: Headless Chromium CDP boot test passed (Nathan profile, smooth zoom, lighting toggle, minimap, clock, voice mic denial fallback, 0 console errors).
- Curl checks against `PORT=8999` verified 200 OK on `/`, `/api/flow`, `/api/office/presence`.

---

## Per-Item Status & Root Cause Verification

### 1. Dynamic Projects Reconciliation & Shelf Layout
- **C6-Diagnosed Root Cause:** `web/map.js` `populateProjects()` diffed only by array length and only added boxes when length increased, leaving removed boxes forever and ignoring changes to `deployed`/`updated`.
- **Actual Root Cause Verified:** Confirmed. The previous implementation checked `if (projects.length <= this.projectBoxes.length) return false;` and never removed or updated existing box objects.
- **Implementation:**
  - `web/map.js`: `populateProjects()` reconciles against `projects` every 30s. Boxes are keyed by `id` in `this.projectBoxesMap`.
  - Added / existing boxes update fields in place: name, description, deployed status, updated timestamp, and shelf binding.
  - Removed project boxes trigger a 1s fade-out animation via `updateProjectBoxes(dt)`. Once faded, the shelf slot retains an empty-shelf silhouette mark (`hasEmptyMark = true`), keeping the Archives room footprint intact.
  - Sorted projects by `updated` descending so newest projects are filed nearest the Archives entrance door.
  - Re-evaluates `assertReachability()` on any box layout modification.
  - `web/game.js`: `renderInteractPrompt()` displays title + description tooltip-ish label. `inspectProject()` displays status dot, `● DEPLOYED` badge with outbound hyperlink (`target="_blank" rel="noopener noreferrer"`), and update date.
- **Verification:** `node test/reachability-test.js` passed all 78 reachability assertions.

### 2. Symmetrically Centered Status Boards & Decor Collision Assertions
- **C6-Diagnosed Root Cause:** Cozy decor placed potted plants on north wall tiles sharing `T_BOARD`, and board strips were off-center relative to their wall spans.
- **Actual Root Cause Verified:** Confirmed. The left board spanned `x: 15..19` on wall run `x: 14..20` (1-tile gap to west wall at 14, 1-tile gap to Claude door at 20). However, the right board spanned `x: 23..27` on wall run `x: 23..29` (1-tile gap to Claude door at 22, but a 2-tile gap to east wall at 30).
- **Implementation:**
  - `web/map.js`: Right board strip adjusted to `x: 24..28`, achieving exact mathematical symmetry with 1-tile gaps on both sides (x=23 and x=29).
  - Decor placement rule: Hard assertion in `buildDecor()` throws a build error if any decor tile intersects `T_BOARD`.
  - Decor visual placement: Plants flank both boards on row 10 (`x: 14, 20, 23, 29`), leaving the boards unobstructed. Framed art was repositioned to row 8.
  - `web/render.js`: Left CRT panel centered at `lx = 14.6 * TILE`, right CRT panel at `rx = 24.1 * TILE`.
- **Verification:** Assertion check passed; zero decor-board intersections.

### 3. Connected Archives Door Frame
- **C6-Diagnosed Root Cause:** The Archives doorway tile was visually disconnected with no wall casing or floor threshold.
- **Actual Root Cause Verified:** Confirmed. Row 22 in `web/map.js` was previously filled with floor tiles from `x: 19..24` with no flanking wall enclosure.
- **Implementation:**
  - `web/map.js`: Enclosed row 22 with solid wall tiles flanking the door: `(18..20, 22)` and `(22..25, 22)`, with the walkable doorway tile at `(21, 22)`.
  - `web/render.js`: Upgraded `drawDoor()` to render complete architectural door casings: vertical jamb posts, top lintel beam, subtle floor threshold strip, recessed door panel grooves, and polished brass handles across all 7 doors on the map.
- **Verification:** All 7 doors remain reachable in A* pathfinding.

### 4. Smooth Zoom
- **Implementation:**
  - Camera zoom range: `0.6×` to `1.8×`, starting at `1.25×`.
  - Smooth exponential lerp smoothing in `update(dt)` (`camera.zoom += (targetZoom - zoom) * 0.15`).
  - Input methods:
    - Mouse wheel zoom centered on cursor screen position.
    - Touch pinch zoom with midpoint anchor.
    - Keyboard `+`/`=` and `-`/`_` zoom keys.
  - Viewport camera clamp correctly accounts for zoom scale at all levels (`visibleW = camera.width / zoom`, `visibleH = camera.height / zoom`).
  - Minimap and status board CRT panels stay in screen-space (1:1 unscaled pixels, crisp text and scanlines).
- **Verification:** `test/browser-test.js` verified starting zoom `1.25`, `+` key increased to `1.4375`, `-` key decreased to `1.088`.

### 5. Lighting Study — Office Lights Mode vs Fullbright
- **C6-Diagnosed Root Cause:** FIX-2026-10-06-1 used time-of-day ambient sync curves and personal player light cutouts.
- **Actual Root Cause Verified:** Confirmed. The game previously computed ambient darkness from local clock time and carved personal 100px cutouts around each player.
- **Implementation:**
  - Removed time-of-day sync and personal player cutouts entirely.
  - Two modes, toggled with `N` key and start screen checkbox, persisted in `localStorage`:
    - **Fullbright:** Identity render (no lighting overlay).
    - **Office Lights (Default):** Baked lightmap canvas rendered directly in world space with zero per-frame cost.
  - Brightness formula: `ambient_floor = 0.62` (`ambientDarkness = 0.38`), with smooth quadratic falloff around ceiling and desk point lights.
- **Lighting Study Parameters:**
  - **Ambient Floor:** `0.62` (never dark; all rooms and corridors clearly visible).
  - **Falloff Curve:** Quadratic attenuation:
    - Center ($r = 0$): Intensity $1.0$
    - $r = 0.35 R$: Intensity $\times 0.82$
    - $r = 0.70 R$: Intensity $\times 0.40$
    - $r = 1.00 R$: Falloff to ambient floor ($0.0$)
  - **Tints:** Warm white `#ffe8c0` (`rgba(255, 232, 192, 0.18)`), desk lamp warm pools (`rgba(255, 235, 170, 0.24)`), break room glow (`rgba(255, 215, 140, 0.28)`), Archives amber mood (`rgba(254, 215, 170, 0.16)`).
  - **Per-Room Point Light Positions:**
    - *Lobby:* Reception desk `(688, 400)` rad 4.2T #ffe8c0 (1.0); Center `(688, 560)` rad 4.5T #fff1d6 (0.95); West lamp `(496, 400)` rad 3.2T #fed7aa (0.85).
    - *OpenCode Studio:* Desk `(208, 208)` rad 3.5T #e0fbf7 (1.0); Corner `(144, 144)` rad 3.8T #e6fffa (0.9); Entry `(400, 240)` rad 3.2T #ffe8c0 (0.88).
    - *Claude-Code Quarters:* Desk `(688, 112)` rad 3.5T #fff5eb (1.0); Lounge `(560, 176)` rad 3.6T #fed7aa (0.92); Bookshelf `(816, 176)` rad 3.6T #ffedd5 (0.9).
    - *Antigravity Lab:* Desk `(1200, 208)` rad 3.5T #ebf8ff (1.0); Telemetry `(1264, 144)` rad 3.8T #e2e8f0 (0.92); Entry `(1040, 240)` rad 3.2T #ffe8c0 (0.88).
    - *Break Room & Cafe:* Coffee machine `(144, 496)` rad 3.8T #fef3c7 (1.05); Table `(240, 592)` rad 4.0T #fde68a (1.0); Entry `(400, 560)` rad 3.2T #ffe8c0 (0.88).
    - *Storage:* Center `(1168, 528)` rad 3.8T #f0f4f8 (0.95); Entry `(1040, 560)` rad 3.2T #ffe8c0 (0.9).
    - *Trading Floor:* Desk `(1200, 848)` rad 4.0T #e6fffa (1.0); Entry `(1040, 752)` rad 3.2T #ffe8c0 (0.9).
    - *Doors:* 7 entry lights (rad 2.8T–3.0T, #ffe8c0, 0.88–0.90).
    - *Archives:* Finding table `(592, 752)` rad 3.2T #fed7aa (0.92); Shelf-bay aisle lanterns every 3 rows `(688, y)` rad 3.5T #ffedd5 (0.9).
  - **Rendered Screenshots:**
    - Office Lights Mode: `test/screenshots/lighting-study-office.png`
    - Fullbright Mode: `test/screenshots/lighting-study-fullbright.png`

### 6. C6 Context-Aware Scenario Engine
- **C6-Diagnosed Root Cause:** C6 previously spoke generic canned lines automatically upon player proximity (<75px).
- **Actual Root Cause Verified:** Confirmed. `updateC6()` had called `triggerC6Dialogue()` whenever `inRange && !c6.playerInRange`.
- **Implementation:**
  - Removed spontaneous speech on proximity (C6 stands up and waves as a visual greeting only).
  - Speech triggers strictly on user interaction (E key or mouse click near reception desk).
  - Scenario Engine: evaluates state summary across telemetry:
    1. `service_red`: Alert on down/unhealthy telemetry services.
    2. `antigravity_with_subagents`: Active subagents working in the lab.
    3. `multiple_working`: Multiple harnesses running concurrent sessions.
    4. `new_project_box`: Newest project delivery filed in the Archives.
    5. `opencode_working`: OpenCode active coding sessions.
    6. `claude_working`: Claude-Code active coding sessions.
    7. `trading_active`: Active stock/crypto paper trading equity.
    8. `presence_active`: Nathan / Gavin Discord presence synchronization.
    9. `just_arrived`: Welcome-back greeting with session duration.
    10. `everyone_idle`: Peaceful quiet-day lines.
  - Pools of 3 variants each defined in `data/office.json`. Dynamic token interpolation (`{service}`, `{duration}`, `{project}`, `{subagent_count}`).
  - Variant cycling on mash E: subsequent E presses within 9s advance through variants of the matched scenario without re-rolling. No repeats per session.

### 7. Agent Behavior & Sprite Polish
- **a) Agent Desk Crossover:**
  - C6-diagnosed root cause confirmed: waypoints and home targets were shared.
  - Fixed: All harness agents have isolated office bounding boxes and waypoint sets. Desk sitting behavior strictly targets each harness agent's own desk seat (`homeX, homeY`). C6 reception seat is C6-only.
- **b) OpenCode Headphones Offset:**
  - C6-diagnosed root cause confirmed: Headband arc center was `y = -14` with radius `11`, peaking at `y = -25` (9px above head).
  - Fixed: Adjusted arc center to `y = -7` with radius `10.5` in `web/render.js`, resting snugly at `y = -17.5` directly on the head top (`y = -16`), with earcups hugging at `y = -11`.
- **c) 4-Frame Walk Cycle:**
  - Upgraded avatar movement from 2-frame bob to 4-frame walk cycle:
    - Alternating leg spread: frame 0 (left forward/right back), frame 1 (passing), frame 2 (right forward/left back), frame 3 (passing).
    - Sinusoidal body bob (1.5px amplitude at half stride frequency).
    - Arm swing opposite legs.
    - Directional squash on turn.
    - Parameterized across players, harness agents (120ms cycle), and subagents (fast 60ms shuffle).

### 8. Proximity Voice Chat (Players Only)
- **Implementation:**
  - `web/voice.js`:
    - **Capture:** 48kHz mono PCM16, 960-sample chunks (~20ms). Noise suppression & echo cancellation on.
    - **Gate & AGC:** RMS gate `> 0.06` over 3 consecutive chunks; AGC normalization to ~0.8 peak; throttled to 1 chunk / ~20ms. Sends `{ t: 'va', d, l }` over WS.
    - **Server Relay (`server.js`):** Broadcasts voice chunks to all joined clients within 800px. Drops beyond 800px. No echo back to sender.
    - **Receiver Playback:** Ring buffer per source (~150ms jitter buffer), played at 48kHz through `AudioContext`.
    - **Distance Gain:** `gain = clamp(1 - d/800, 0, 1)`.
    - **Lowpass Filter:** `freq = lerp(6000, 900, d/800)`.
    - **DDA Raycast Wall Occlusion:** Raycasts tile grid every 100ms. 0 wall hits $\to 1.0$, 1 hit $\to 0.45$, 2+ hits $\to 0.15$. Doorway tiles count as half-hits ($0.5$).
    - **Gain Smoothing:** 200ms attack / 400ms release to eliminate edge flicker.
    - **Controls & HUD:** `V` key toggles voice-only mute; `M` mutes both voice and SFX; start screen mic checkbox; HUD mic pill (`MIC: ON` / `MIC: MUTED` / `TALKING`) and speaking indicator.
    - **Graceful Fallback:** If mic permission is denied, notifies `"Mic unavailable — you can still hear others"` with zero exceptions.
- **Verification (`test/voice-test.js`):**
  - Unit tests: Distance gain math (0px $\to$ 1.0, 200px $\to$ 0.75, 400px $\to$ 0.5, 800px+ $\to$ 0.0); Lowpass frequency math (0px $\to$ 6000Hz, 400px $\to$ 3450Hz, 800px+ $\to$ 900Hz); Attack/release smoothing; DDA raycast wall occlusion (0 hits $\to$ 1.0, 1 wall $\to$ 0.45, 2+ walls $\to$ 0.15, 1 door $\to$ 0.45, 2 doors $\to$ 0.45, 1 wall + 2 doors $\to$ 0.15).
  - Network relay test: Two fake clients over WebSocket on `PORT=8999`. Sender 200px away delivered audio packet in $< 100$ms. Moving receiver beyond 800px delivered 0 packets.

---

## Automated Test Log Outputs

```
$ node test/reachability-test.js
--- Starting Office Reachability Test ---
Lobby spawn at (688, 560) [tile 21, 17]
Checking 7 doors...
PASS: All 7 doors reachable.
Checking 14 named waypoints...
PASS: All 14 waypoints reachable.
PASS: C6 desk reachable.
Checking 14 archive shelves access tiles...
PASS: All 14 initial archive shelf access tiles reachable.
Expanded archives to 78 tiles tall, total shelves: 42. Testing access...
PASS: All 42 shelves reachable after dynamic expansion.
--- ALL 78 REACHABILITY TARGETS PASSED ---

$ PORT=8999 node test/voice-test.js
--- Running Voice Chat Math & Occlusion Unit Tests ---
PASS: Distance gain math (0px -> 1.0, 200px -> 0.75, 400px -> 0.5, 800px+ -> 0.0)
PASS: Lowpass cutoff frequency math (0px -> 6000Hz, 400px -> 3450Hz, 800px+ -> 900Hz)
PASS: Gain smoothing (attack 100ms: 0.393, release 100ms: 0.779)
PASS: DDA 0 wall hits -> 1.0
PASS: DDA 1 wall hit -> 0.45
PASS: DDA 2+ wall hits -> 0.15
PASS: DDA 1 doorway half-hit -> 0.45
PASS: DDA 2 doorways (1.0 hit) -> 0.45
PASS: DDA wall + doorways (>= 1.5 hits) -> 0.15
--- Running Voice Chat Network Relay Integration Test ---
Forge Office running on http://127.0.0.1:8999
PASS: Sender 200px away delivered chunk to receiver within 0ms (< 100ms threshold)
PASS: Sender beyond 800px delivered 0 packets (properly dropped by server proximity filter)
PASS: Network relay tests complete
--- ALL VOICE TESTS PASSED ---

$ PORT=8999 node test/browser-test.js
--- Starting Headless Chromium Boot Check against http://127.0.0.1:8999 ---
Forge Office running on http://127.0.0.1:8999
Step A: Checking start screen profile cards...
Start screen check: { nathan: true, gavin: true, guest: true, nathanSelected: true, canvas: true, gameExists: true }
Step B: Selecting Nathan profile and entering office...
After enter office check: { gameStarted: true, playerName: 'Nathan', playerProfile: 'nathan', playerColor: 'teal', playerHat: 'cap' }
Step C: Checking minimap panel...
Minimap check: { panelExists: true, canvasExists: true, canvasW: 180, canvasH: 164, isCollapsed: false, roomsCount: 8 }
Step D: Testing minimap toggle with B key...
Minimap collapsed after B key: true
Step E: Opening CLOCK panel with K key...
Clock panel check: { clockOpen: true, nathanBlock: true, gavinBlock: true, nathanStatusText: 'Away', gavinStatusText: 'Away', presenceChip: 'Nathan (You): In Office' }
Step F: Testing click-to-move on minimap...
Minimap click-to-move result: { hasPath: true, pathLength: 9 }
Step G: Testing zoom controls (+/- keys and wheel)...
Initial camera zoom: 1.25
Target zoom after '+' key: 1.4375
Target zoom after '-' key: 1.08804375
Step H: Testing lighting modes and capturing screenshots for lighting study...
Default lights mode: office
Saved office lights mode screenshot to /home/bsmt-pc/HydrocarbonForge/Projects/forge-office/test/screenshots/lighting-study-office.png (245600 bytes b64)
Lights mode after N toggle: fullbright, HUD label: 💡 LIGHTS: fullbright
Saved fullbright mode screenshot to /home/bsmt-pc/HydrocarbonForge/Projects/forge-office/test/screenshots/lighting-study-fullbright.png (110040 bytes b64)
Step I: Testing Voice mic enable (graceful handling when mic denied)...
Recent game notifications: [ 'Pathfinding to BREAK...', 'Lights: Fullbright', 'Lights: Office Warm (Default)', 'Mic unavailable — you can still hear others' ]
Console error count: 0
--- ALL BROWSER BOOT CHECKS PASSED ---

$ curl http://127.0.0.1:8999/ (200 OK, 9857 bytes)
$ curl http://127.0.0.1:8999/api/flow (200 OK, 8758 bytes)
$ curl http://127.0.0.1:8999/api/office/presence (200 OK, 407 bytes)
```

---

## Port & Process Safety Verification

- Port `8999`: Test server closed immediately following test completion. Port is free.
- Port `8904`: Live production service remains running untouched with PID `560491`.
