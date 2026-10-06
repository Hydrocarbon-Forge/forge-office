# TASK: Add a Trading Floor room to the Forge Office

You are extending the **forge-office** project — a tile-based 2D little-people
office game (pure JS, zero dependencies, ~4,000 lines). Tile size is 32px.

Gavin asked: add a small room with stock numbers, with a screen showing the
portfolio numbers, that updates with the hourly trading job, and supports a
second crypto portfolio. The DATA backend is ALREADY BUILT (see below) — your
job is the OFFICE UI ONLY.

## Files (read these first)
- `web/map.js` — grid, rooms, tile types, doors, waypoints, lights, A* pathing.
- `web/render.js` — `renderMap(map, camera, liveData)`, `drawStatusBoard`,
  `drawFurniture`, `renderAvatar(ctx,x,y,{color,hat,face,...})`, floor palettes.
- `web/game.js` — `this.liveData` cache + `setupDataPoller()` (fetches
  `/api/*` into `liveData`), render loop calls `renderer.renderMap(...)` and
  `agents.render(...)`.
- `server.js` — ALREADY serves `/data/*` from the `data/` folder. Do NOT edit
  it. `/data/trading.json` is already reachable.
- `data/trading.json` — the live payload (already exists and is written hourly
  by an external job). Shape:

```
{
  "updated": "2026-10-06T02:54:25+00:00",
  "updated_ts": 1791255265.676,
  "stock":  { "label":"STOCKS", "subtitle":"...", "equity":99999.98,
              "start":100000, "total_pnl":-0.02, "total_pct":-0.0,
              "day_pnl":-0.01, "day_pct":-0.0, "cash":0.0, "cash_pct":0.0,
              "holdings":[{"sym":"AMD","qty":31.66,"px":631.75,"val":20000,"w":20.0}],
              "trades_now":[], "n_trades":11, "quotes_ok":20, "quotes_total":20 },
  "crypto": { /* same shape */ },
  "errors": []
}
```
Either `stock` or `crypto` may be `null` on a failed tick — handle it.

## Deliverables (do all 4)

### 1. New floor type + room
- Add `T_FLOOR_TRADING = 8` in `map.js` and a distinct floor palette for it in
  `render.js` (e.g. a dark teal "trading desk" grid — pick colors that read as
  a trading floor, keep the existing per-room pattern of `floorBase` +
  `floorAccent`).
- In `map.js` `buildBaseRooms()`, build a **Trading Floor** room in free void
  space (the bottom-left or bottom-right region is free; archives occupy only
  x17..26, y23..38). The room must be **walkable and connected**: open a door
  into it from an existing room (e.g. from the lobby or a side room) so the
  little people and the player can get there. Add the room to `waypoints`
  (`trading_floor`) and add a light in `initLighting()`.

### 2. Two live screens (the star feature)
- On the room's north (or back) wall, mount **two big CRT-style screens**
  side by side: a **STOCKS** screen and a **CRYPTO** screen. Reuse the visual
  language of `drawStatusBoard` (dark frame, teal border, phosphor gradient,
  scanlines) — you may factor a `renderPanel`-style helper.
- Each screen shows, from `liveData.trading.<stock|crypto>`:
  - big **equity** `$` value,
  - **total P&L** with color (green if ≥ 0, red if < 0) + `%`,
  - **today** P&L,
  - the top few **holdings** as `SYM  price` rows with a tiny up/down or weight
    bar,
  - a small `updated HH:MM` timestamp.
- **Graceful degradation:** if `liveData.trading` is missing/null, or that
  portfolio is null, render the frame with `--` / "NO DATA" — never throw,
  never leave a blank crash. Guard every field read.

### 3. Floating "stock numbers" in the room
- Scatter a few **floating ticker tags** (small rounded chips showing e.g.
  `AMD 631.75`, `BTC 118k`, `+12%`) drifting gently inside the room near the
  screens — the "stock numbers in the room" Gavin asked for. Derive the tickers
  from the live `holdings` when available (so they reflect real data), falling
  back to a couple of static chips when there's no data. Animate them with a
  slow bob using the render time (keep it cheap — a handful of chips).

### 4. A trader character
- Place **one little person** (a "trader") standing at a small trading desk in
  the room, drawn with the existing `renderAvatar(ctx, x, y, {color, hat, face, ...})`
  (pick a distinct color/hat, e.g. a headset or bowler). It should be a
  static decorative sprite drawn in `drawFurniture` (or a small dedicated
  `drawTradingFloor`) — no new pathfinding/AI needed.

## Data wiring
- In `game.js`, extend `setupDataPoller()` (or add a sibling) to fetch
  `/data/trading.json` → `this.liveData.trading`. Add `trading: null` to the
  initial `liveData` object. Poll every **60 s** (the trading job runs hourly;
  a 60 s poll keeps it fresh without hammering the server) and also do an
  initial fetch. Wrap in try/catch — a failed fetch must NOT break the app.
- Pass `liveData` into the trading-floor rendering (it already flows through
  `renderMap(map, camera, liveData)` → call your new `drawTradingFloor(ctx, map, liveData)`
  from within `renderMap`, near where `drawStatusBoard`/`drawFurniture` are).

## Constraints
- Do NOT restart the running office service (the owner handles that).
- Do NOT modify `server.js` (routing already works).
- Do NOT break existing rooms, agents, lighting, or the existing status board.
- Keep it dependency-free (no new libs, no npm).
- Match the existing code style (IIFE globals, `TILE` constant, `ctx` canvas ops).
- After editing, run `node --check web/map.js web/render.js web/game.js` and
  make sure all pass with no syntax errors.

## Verification (do this, report results)
1. `node --check` on the three edited files — must be clean.
2. Write a **small throwaway node script** (then delete it) that stubs a
   canvas/ctx, loads `map.js` + `render.js`, builds the map, and asserts:
   (a) a trading-floor tile region exists (scan `map.grid` for `T_FLOOR_TRADING`
   and report its bounding box), (b) the room is walkable (the door tile is not
   solid and connects to an existing room), (c) a light + waypoint were added.
   Report the bounding box + door location.
3. Report the exact screen pixel positions you drew, so the owner can verify
   in a live browser.

Be specific and concrete in your final report: files changed, the room's tile
bounding box + door location, the two screens' pixel coords, `node --check`
results, and the deterministic geometry check output.
