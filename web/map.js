// web/map.js — Grid map, rooms, dynamic Archives expansion, lighting, doors, and A* pathfinding
(function (global) {
  const TILE = 32;

  // Tile types
  const T_EMPTY = 0;
  const T_FLOOR_LOBBY = 1;
  const T_FLOOR_OPENCODE = 2;
  const T_FLOOR_CLAUDE = 3;
  const T_FLOOR_ANTIGRAVITY = 4;
  const T_FLOOR_BREAKROOM = 5;
  const T_FLOOR_STORAGE = 6;
  const T_FLOOR_ARCHIVES = 7;
  const T_FLOOR_TRADING = 8;
  const T_WALL = 10;
  const T_DOOR = 11;
  const T_SHELF = 12;
  const T_DESK = 13;
  const T_BOARD = 14;

  class OfficeMap {
    constructor() {
      this.tile = TILE;
      this.width = 44; // tightened width in tiles
      this.height = 40; // tightened height in tiles, can grow downward
      this.grid = []; // tile types
      this.solid = []; // boolean solid collision
      this.doors = []; // interactive doors
      this.lights = []; // light sources
      this.shelves = []; // archive shelf slots
      this.projectBoxes = []; // project boxes on shelves
      this.waypoints = {}; // named waypoints for agents
      this.decor = []; // procedural decor layer
      this.lightCanvas = null;
      this.lightCtx = null;
      this.lightDirty = true;
      this.archivesMaxRow = 38;

      this.init();
    }

    init() {
      this.grid = new Array(this.width * this.height).fill(T_EMPTY);
      this.solid = new Array(this.width * this.height).fill(true);
      this.decor = [];

      this.buildBaseRooms();
      this.buildWaypoints();
      this.buildDecor();
      this.initLighting();
    }

    setTile(x, y, type, isSolid = false) {
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
      const idx = y * this.width + x;
      this.grid[idx] = type;
      this.solid[idx] = isSolid;
    }

    getTile(x, y) {
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) return T_WALL;
      return this.grid[y * this.width + x];
    }

    isSolid(x, y) {
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) return true;
      return this.solid[y * this.width + x];
    }

    fillRoom(x0, y0, x1, y1, floorType) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (x === x0 || x === x1 || y === y0 || y === y1) {
            this.setTile(x, y, T_WALL, true);
          } else {
            this.setTile(x, y, floorType, false);
          }
        }
      }
    }

    addDoor(x, y, orientation = 'v', name = '') {
      this.setTile(x, y, T_DOOR, false);
      this.doors.push({
        x: x * TILE + TILE / 2,
        y: y * TILE + TILE / 2,
        tileX: x,
        tileY: y,
        orientation,
        name,
        open: 0, // 0 = closed, 1 = fully open
        targetOpen: 0
      });
    }

    buildBaseRooms() {
      // 1. Claude-Code Office (Center North: x: 13..30, y: 1..8)
      this.fillRoom(13, 1, 30, 8, T_FLOOR_CLAUDE);
      this.addDoor(21, 8, 'h', 'claude');

      // 2. OpenCode Studio (West North: x: 1..13, y: 1..12)
      this.fillRoom(1, 1, 13, 12, T_FLOOR_OPENCODE);
      this.addDoor(13, 7, 'v', 'opencode');

      // 3. Antigravity Lab (East North: x: 30..42, y: 1..12)
      this.fillRoom(30, 1, 42, 12, T_FLOOR_ANTIGRAVITY);
      this.addDoor(30, 7, 'v', 'antigravity');

      // 4. Break Room (West South: x: 1..13, y: 12..22)
      this.fillRoom(1, 12, 13, 22, T_FLOOR_BREAKROOM);
      this.addDoor(13, 17, 'v', 'breakroom');

      // 5. Storage Room (East South: x: 30..42, y: 12..22)
      this.fillRoom(30, 12, 42, 22, T_FLOOR_STORAGE);
      this.addDoor(30, 17, 'v', 'storage');

      // 6. Lobby (Center: x: 13..30, y: 8..22)
      this.fillRoom(13, 8, 30, 22, T_FLOOR_LOBBY);

      // Re-punch the shared doors on Lobby walls
      this.setTile(21, 8, T_DOOR, false);
      this.setTile(13, 7, T_DOOR, false);
      this.setTile(30, 7, T_DOOR, false);
      this.setTile(13, 17, T_DOOR, false);
      this.setTile(30, 17, T_DOOR, false);

      // Status Board on Lobby North Wall: left side x:15..19, right side x:23..27
      // Leaving x:20..22 as open lobby floor for the Claude doorway
      for (let x = 15; x <= 19; x++) {
        this.setTile(x, 9, T_BOARD, true);
      }
      for (let x = 23; x <= 27; x++) {
        this.setTile(x, 9, T_BOARD, true);
      }
      this.setTile(21, 9, T_FLOOR_LOBBY, false);

      // C6 Front Desk in Lobby (x: 19..23, y: 12)
      for (let x = 19; x <= 23; x++) {
        this.setTile(x, 12, T_DESK, true);
      }

      // 7. Opening to Archives from Lobby South (y: 22, x: 19..24)
      for (let x = 19; x <= 24; x++) {
        this.setTile(x, 22, T_FLOOR_LOBBY, false);
      }
      this.addDoor(21, 22, 'h', 'archives');

      // 8. Initial Archives Hallway (y: 23 to 38)
      this.buildArchivesSection(23, 38);

      // 9. Trading Floor (East South Void: x: 30..42, y: 22..34)
      this.fillRoom(30, 22, 42, 34, T_FLOOR_TRADING);
      this.addDoor(32, 22, 'h', 'trading_floor');
    }

    buildArchivesSection(startY, endY) {
      for (let y = startY; y <= endY; y++) {
        // Walls on left (x=17) and right (x=26)
        this.setTile(17, y, T_WALL, true);
        this.setTile(26, y, T_WALL, true);

        // Floor inside archives (x: 18..25)
        for (let x = 18; x <= 25; x++) {
          this.setTile(x, y, T_FLOOR_ARCHIVES, false);
        }
      }

      // Bottom back wall for archives
      for (let x = 17; x <= 26; x++) {
        this.setTile(x, endY + 1, T_WALL, true);
      }

      // Shelf slots along aisles:
      // Left shelves at x: 19, Right shelves at x: 24
      // Aisle at x: 21..22
      for (let y = startY + 1; y <= endY - 1; y += 2) {
        // Left shelf
        this.setTile(19, y, T_SHELF, true);
        this.setTile(19, y + 1, T_SHELF, true);
        // Right shelf
        this.setTile(24, y, T_SHELF, true);
        this.setTile(24, y + 1, T_SHELF, true);

        this.shelves.push({ side: 'left', tileX: 19, tileY: y, accessX: 21, accessY: y });
        this.shelves.push({ side: 'right', tileX: 24, tileY: y, accessX: 22, accessY: y });
      }

      this.archivesMaxRow = endY;
      this.lightDirty = true;
    }

    // Dynamic extension for incoming projects
    ensureArchivesCapacity(neededSlots) {
      if (this.shelves.length >= neededSlots) return false;

      const additionalSlots = neededSlots - this.shelves.length;
      const additionalRows = Math.ceil(additionalSlots / 2) * 2 + 4;
      const oldMax = this.archivesMaxRow;
      const newMax = oldMax + additionalRows;

      // Expand grid height if necessary
      if (newMax + 4 > this.height) {
        const oldHeight = this.height;
        this.height = newMax + 10;
        const newGrid = new Array(this.width * this.height).fill(T_EMPTY);
        const newSolid = new Array(this.width * this.height).fill(true);

        for (let y = 0; y < oldHeight; y++) {
          for (let x = 0; x < this.width; x++) {
            const idxOld = y * this.width + x;
            const idxNew = y * this.width + x;
            newGrid[idxNew] = this.grid[idxOld];
            newSolid[idxNew] = this.solid[idxOld];
          }
        }
        this.grid = newGrid;
        this.solid = newSolid;
      }

      // Clear old back wall
      for (let x = 17; x <= 26; x++) {
        this.setTile(x, oldMax + 1, T_FLOOR_ARCHIVES, false);
      }

      this.buildArchivesSection(oldMax + 1, newMax);
      this.initLighting();
      return true;
    }

    populateProjects(projects) {
      const isNew = this.ensureArchivesCapacity(projects.length);
      this.projectBoxes = [];

      projects.forEach((proj, index) => {
        const shelf = this.shelves[index];
        if (shelf) {
          this.projectBoxes.push({
            project: proj,
            shelf,
            x: shelf.tileX * TILE + TILE / 2,
            y: shelf.tileY * TILE + TILE / 2,
            accessX: shelf.accessX * TILE + TILE / 2,
            accessY: shelf.accessY * TILE + TILE / 2
          });
        }
      });

      return isNew;
    }

    buildWaypoints() {
      this.waypoints = {
        'claude_desk': { x: 21 * TILE + 16, y: 4 * TILE + 16 },
        'claude_door': { x: 21 * TILE + 16, y: 8 * TILE + 16 },
        'opencode_desk': { x: 6 * TILE + 16, y: 7 * TILE + 16 },
        'opencode_door': { x: 13 * TILE + 16, y: 7 * TILE + 16 },
        'antigravity_desk': { x: 37 * TILE + 16, y: 7 * TILE + 16 },
        'antigravity_door': { x: 30 * TILE + 16, y: 7 * TILE + 16 },
        'lobby_center': { x: 21 * TILE + 16, y: 16 * TILE + 16 },
        'c6_front': { x: 21 * TILE + 16, y: 14 * TILE + 16 },
        'breakroom_door': { x: 13 * TILE + 16, y: 17 * TILE + 16 },
        'coffee_machine': { x: 4 * TILE + 16, y: 15 * TILE + 16 },
        'break_table': { x: 7 * TILE + 16, y: 18 * TILE + 16 },
        'archives_door': { x: 21 * TILE + 16, y: 22 * TILE + 16 },
        'archives_top': { x: 21 * TILE + 16, y: 25 * TILE + 16 },
        'trading_floor': { x: 37 * TILE + 16, y: 28 * TILE + 16 }
      };
    }

    buildDecor() {
      this.decor = [
        // Lobby Decor
        { x: 18, y: 11, w: 7, h: 4, kind: 'rug_reception', variant: 'teal_gold' },
        { x: 21, y: 22, kind: 'door_mat', variant: 'coir' }, // Welcome mat at archives door
        { x: 21, y: 8, kind: 'door_mat', variant: 'peach' },  // Claude door mat
        { x: 13, y: 7, kind: 'door_mat', variant: 'mint' },   // OpenCode door mat
        { x: 30, y: 7, kind: 'door_mat', variant: 'slate' },  // Antigravity door mat
        { x: 13, y: 17, kind: 'door_mat', variant: 'warm' },  // Break room door mat
        { x: 30, y: 17, kind: 'door_mat', variant: 'cool' },  // Storage door mat
        { x: 32, y: 22, kind: 'door_mat', variant: 'teal' },  // Trading floor door mat
        { x: 14, y: 10, kind: 'plant', variant: 'potted_monstera' },
        { x: 29, y: 10, kind: 'plant', variant: 'potted_palm' },
        { x: 14, y: 21, kind: 'plant', variant: 'potted_fern' },
        { x: 29, y: 21, kind: 'plant', variant: 'potted_rubber' },
        { x: 15, y: 21, w: 2, h: 1, kind: 'bench', variant: 'cushioned_wood', solid: true },
        { x: 14, y: 9, kind: 'framed_art', variant: 'mountain' },
        { x: 28, y: 9, kind: 'framed_art', variant: 'cyber' },
        { x: 15, y: 12, kind: 'floor_lamp', variant: 'warm' },

        // OpenCode Studio Decor
        { x: 5, y: 8, w: 3, h: 2, kind: 'office_rug', variant: 'mint' },
        { x: 9, y: 2, kind: 'wall_poster', variant: 'pixel_art' },
        { x: 3, y: 2, w: 2, h: 1, kind: 'bookshelf', variant: 'tech', solid: true },
        { x: 11, y: 2, kind: 'plant', variant: 'monstera' },
        { x: 6, y: 6, kind: 'desk_clutter', variant: 'opencode' },
        { x: 5, y: 6, kind: 'desk_lamp', variant: 'cyan' },

        // Claude-Code Office Decor
        { x: 20, y: 5, w: 3, h: 2, kind: 'office_rug', variant: 'peach' },
        { x: 25, y: 2, kind: 'wall_poster', variant: 'neural' },
        { x: 15, y: 2, w: 2, h: 1, kind: 'bookshelf', variant: 'classics', solid: true },
        { x: 27, y: 2, kind: 'plant', variant: 'succulent' },
        { x: 21, y: 3, kind: 'desk_clutter', variant: 'claude' },
        { x: 20, y: 3, kind: 'desk_lamp', variant: 'amber' },

        // Antigravity Lab Decor
        { x: 36, y: 8, w: 3, h: 2, kind: 'office_rug', variant: 'slate' },
        { x: 34, y: 2, kind: 'wall_poster', variant: 'galaxy' },
        { x: 40, y: 2, w: 1, h: 1, kind: 'equipment_shelf', variant: 'telemetry', solid: true },
        { x: 32, y: 2, kind: 'plant', variant: 'snake' },
        { x: 37, y: 6, kind: 'desk_clutter', variant: 'antigravity' },
        { x: 38, y: 6, kind: 'desk_lamp', variant: 'blue' },

        // Break Room Decor
        { x: 2, y: 13, kind: 'fridge', variant: 'steel', solid: true },
        { x: 3, y: 14, w: 3, h: 1, kind: 'kitchen_counter', solid: true },
        { x: 10, y: 13, kind: 'snack_shelf', variant: 'pantry', solid: true },
        { x: 7, y: 18, kind: 'cafe_table_4', solid: true },
        { x: 2, y: 21, kind: 'plant', variant: 'fern' },

        // Archives Decor
        { x: 18, y: 23, w: 1, h: 1, kind: 'finding_aids_table', solid: true },
        { x: 25, y: 26, kind: 'rolling_ladder', variant: 'brass' }
      ];

      // Mark solid tiles for physical decor
      for (const item of this.decor) {
        if (item.solid) {
          const w = item.w || 1;
          const h = item.h || 1;
          for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
              const tx = item.x + dx;
              const ty = item.y + dy;
              if (tx >= 0 && tx < this.width && ty >= 0 && ty < this.height) {
                this.solid[ty * this.width + tx] = true;
              }
            }
          }
        }
      }
    }

    initLighting() {
      this.lights = [
        // Status board & lobby glow
        { x: 21 * TILE + 16, y: 11 * TILE, radius: 240, color: 'rgba(90, 214, 160, 0.45)', flicker: 0 },
        // C6 desk lamp
        { x: 21 * TILE + 16, y: 12 * TILE, radius: 140, color: 'rgba(255, 235, 150, 0.55)', flicker: 0 },
        // Lobby floor lamp
        { x: 15 * TILE + 16, y: 12 * TILE + 16, radius: 120, color: 'rgba(255, 230, 160, 0.45)', flicker: 0 },
        // Archives finding aids lamp
        { x: 18 * TILE + 16, y: 23 * TILE + 16, radius: 100, color: 'rgba(255, 220, 140, 0.45)', flicker: 0 },
        // OpenCode monitor & desk lamp
        { x: 6 * TILE + 16, y: 6 * TILE, radius: 150, color: 'rgba(0, 200, 180, 0.5)', flicker: 0.05 },
        { x: 5 * TILE + 16, y: 6 * TILE + 16, radius: 90, color: 'rgba(200, 245, 255, 0.4)', flicker: 0 },
        // Claude monitor & desk lamp
        { x: 21 * TILE + 16, y: 3 * TILE, radius: 150, color: 'rgba(255, 140, 66, 0.5)', flicker: 0.05 },
        { x: 20 * TILE + 16, y: 3 * TILE + 16, radius: 90, color: 'rgba(255, 230, 170, 0.4)', flicker: 0 },
        // Antigravity monitor & desk lamp
        { x: 37 * TILE + 16, y: 6 * TILE, radius: 150, color: 'rgba(90, 169, 230, 0.5)', flicker: 0.05 },
        { x: 38 * TILE + 16, y: 6 * TILE + 16, radius: 90, color: 'rgba(210, 235, 255, 0.4)', flicker: 0 },
        // Break room warm light
        { x: 7 * TILE, y: 17 * TILE, radius: 180, color: 'rgba(255, 220, 140, 0.5)', flicker: 0 },
        // Storage room cool light
        { x: 36 * TILE, y: 17 * TILE, radius: 180, color: 'rgba(200, 220, 255, 0.45)', flicker: 0 },
        // Trading floor glow & monitor light
        { x: 37 * TILE, y: 26 * TILE, radius: 240, color: 'rgba(56, 178, 172, 0.5)', flicker: 0.03 }
      ];

      // Add Archive lantern lights along the aisle every 4 tiles
      for (let y = 25; y <= this.archivesMaxRow; y += 4) {
        this.lights.push({
          x: 21.5 * TILE,
          y: y * TILE,
          radius: 130,
          color: 'rgba(255, 230, 170, 0.48)',
          flicker: 0
        });
      }

      this.lightDirty = true;
    }

    updateDoors(entities, sfx) {
      for (const door of this.doors) {
        let shouldOpen = false;
        for (const ent of entities) {
          const dx = ent.x - door.x;
          const dy = ent.y - door.y;
          if (dx * dx + dy * dy < 54 * 54) {
            shouldOpen = true;
            break;
          }
        }

        door.targetOpen = shouldOpen ? 1 : 0;
        const prevOpen = door.open;
        door.open += (door.targetOpen - door.open) * 0.18;

        // Trigger creak on opening transition
        if (sfx && prevOpen < 0.2 && door.open >= 0.2) {
          sfx.playDoorCreak();
        }
      }
    }

    checkCircleCollision(x, y, radius) {
      const minTileX = Math.floor((x - radius) / TILE);
      const maxTileX = Math.floor((x + radius) / TILE);
      const minTileY = Math.floor((y - radius) / TILE);
      const maxTileY = Math.floor((y + radius) / TILE);

      for (let ty = minTileY; ty <= maxTileY; ty++) {
        for (let tx = minTileX; tx <= maxTileX; tx++) {
          if (this.isSolid(tx, ty)) {
            // Check box-circle collision
            const nearestX = Math.max(tx * TILE, Math.min(x, (tx + 1) * TILE));
            const nearestY = Math.max(ty * TILE, Math.min(y, (ty + 1) * TILE));
            const dx = x - nearestX;
            const dy = y - nearestY;
            if (dx * dx + dy * dy < radius * radius) {
              return true;
            }
          }
        }
      }
      return false;
    }

    // A* Pathfinding implementation
    findPath(startX, startY, targetX, targetY) {
      const sTx = Math.floor(startX / TILE);
      const sTy = Math.floor(startY / TILE);
      const tTx = Math.floor(targetX / TILE);
      const tTy = Math.floor(targetY / TILE);

      if (sTx === tTx && sTy === tTy) {
        return [{ x: targetX, y: targetY }];
      }

      // Check if target is solid, if so find nearest open neighbor
      let finalTargetX = tTx;
      let finalTargetY = tTy;
      if (this.isSolid(tTx, tTy)) {
        const neighbors = [
          [tTx + 1, tTy], [tTx - 1, tTy], [tTx, tTy + 1], [tTx, tTy - 1]
        ];
        let found = false;
        for (const [nx, ny] of neighbors) {
          if (!this.isSolid(nx, ny)) {
            finalTargetX = nx;
            finalTargetY = ny;
            found = true;
            break;
          }
        }
        if (!found) return null;
      }

      const openSet = [];
      const closedSet = new Uint8Array(this.width * this.height);
      const cameFrom = new Int32Array(this.width * this.height).fill(-1);
      const gScore = new Float32Array(this.width * this.height).fill(Infinity);
      const fScore = new Float32Array(this.width * this.height).fill(Infinity);

      const startIdx = sTy * this.width + sTx;
      const targetIdx = finalTargetY * this.width + finalTargetX;

      gScore[startIdx] = 0;
      fScore[startIdx] = Math.hypot(finalTargetX - sTx, finalTargetY - sTy);
      openSet.push({ idx: startIdx, f: fScore[startIdx] });

      const dirs = [
        { dx: 1, dy: 0, cost: 1 },
        { dx: -1, dy: 0, cost: 1 },
        { dx: 0, dy: 1, cost: 1 },
        { dx: 0, dy: -1, cost: 1 }
      ];

      let iterations = 0;
      while (openSet.length > 0 && iterations++ < 1200) {
        // Find node in openSet with lowest fScore
        let bestIdx = 0;
        for (let i = 1; i < openSet.length; i++) {
          if (openSet[i].f < openSet[bestIdx].f) {
            bestIdx = i;
          }
        }
        const current = openSet.splice(bestIdx, 1)[0].idx;

        if (current === targetIdx) {
          // Reconstruct path
          const path = [];
          let curr = current;
          while (curr !== -1) {
            const cx = curr % this.width;
            const cy = Math.floor(curr / this.width);
            path.unshift({ x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2 });
            curr = cameFrom[curr];
          }
          if (path.length > 0) {
            path[path.length - 1] = { x: targetX, y: targetY };
          }
          return path;
        }

        closedSet[current] = 1;
        const curX = current % this.width;
        const curY = Math.floor(current / this.width);

        for (const dir of dirs) {
          const nx = curX + dir.dx;
          const ny = curY + dir.dy;
          if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
          if (this.isSolid(nx, ny)) continue;

          const neighborIdx = ny * this.width + nx;
          if (closedSet[neighborIdx]) continue;

          const tentativeG = gScore[current] + dir.cost;
          if (tentativeG < gScore[neighborIdx]) {
            cameFrom[neighborIdx] = current;
            gScore[neighborIdx] = tentativeG;
            const h = Math.hypot(finalTargetX - nx, finalTargetY - ny);
            fScore[neighborIdx] = tentativeG + h;

            const existing = openSet.find((item) => item.idx === neighborIdx);
            if (!existing) {
              openSet.push({ idx: neighborIdx, f: fScore[neighborIdx] });
            } else {
              existing.f = fScore[neighborIdx];
            }
          }
        }
      }

      return null; // No path found
    }

    getAmbientDarkness(consoleOnline = true, lightsSetting = false) {
      if (lightsSetting) {
        // Darkness disabled entirely: ambient 0.0 ("not dark at all")
        return 0.0;
      }

      const now = new Date();
      const hours = now.getHours() + now.getMinutes() / 60;
      let ambient = 0.12;

      // Real local time of day:
      // daytime (7:00–19:00) ≈ 0.12 (nearly fully lit, just a hint of mood)
      // dusk transition (19:00–21:00) ≈ smooth transition from 0.12 to 0.60
      // dawn transition (5:00–7:00) ≈ smooth transition from 0.60 to 0.12
      // night (21:00–5:00) ≈ 0.60
      if (hours >= 7 && hours <= 19) {
        ambient = 0.12;
      } else if (hours > 19 && hours < 21) {
        const t = (hours - 19) / 2;
        ambient = 0.12 + t * (0.60 - 0.12);
      } else if (hours >= 5 && hours < 7) {
        const t = (hours - 5) / 2;
        ambient = 0.60 - t * (0.60 - 0.12);
      } else {
        ambient = 0.60;
      }

      // Small additional dimmer on top if console is offline (+0.12)
      if (!consoleOnline) {
        ambient += 0.12;
      }

      return Math.min(0.95, ambient);
    }

    renderLightOverlay(viewX, viewY, viewWidth, viewHeight, playerEntities, consoleOnline = true, lightsSetting = false) {
      if (!this.lightCanvas) {
        this.lightCanvas = document.createElement('canvas');
        this.lightCtx = this.lightCanvas.getContext('2d');
      }

      if (this.lightCanvas.width !== viewWidth || this.lightCanvas.height !== viewHeight) {
        this.lightCanvas.width = viewWidth;
        this.lightCanvas.height = viewHeight;
        this.lightDirty = true;
      }

      const ctx = this.lightCtx;
      const ambientDark = this.getAmbientDarkness(consoleOnline, lightsSetting);

      if (ambientDark <= 0.001) {
        // Full bright setting active: no dark overlay at all!
        ctx.clearRect(0, 0, viewWidth, viewHeight);
        return this.lightCanvas;
      }

      // Ambient dark multiply layer
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(14, 18, 28, ${ambientDark.toFixed(3)})`;
      ctx.fillRect(0, 0, viewWidth, viewHeight);

      // Carve out light holes with destination-out
      ctx.globalCompositeOperation = 'destination-out';

      // Scale hole carving intensity by daytime darkness factor (subtler holes during bright day, prominent at night)
      const dayFactor = Math.min(1.0, ambientDark / 0.60);

      // 1. Static office lights
      for (const light of this.lights) {
        const lx = light.x - viewX;
        const ly = light.y - viewY;
        const flicker = light.flicker ? (Math.random() - 0.5) * light.flicker * light.radius * Math.max(0.5, dayFactor) : 0;
        const rad = light.radius + flicker;

        if (lx + rad < 0 || lx - rad > viewWidth || ly + rad < 0 || ly - rad > viewHeight) {
          continue;
        }

        const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, rad);
        const baseIntensity = consoleOnline ? 0.94 : 0.65;
        const intensity = baseIntensity * Math.max(0.35, dayFactor);
        grad.addColorStop(0, `rgba(0, 0, 0, ${intensity.toFixed(2)})`);
        grad.addColorStop(0.5, `rgba(0, 0, 0, ${(intensity * 0.6).toFixed(2)})`);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(lx, ly, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2. Personal auras for human players (they carry a soft warm lantern/aura)
      if (playerEntities) {
        for (const p of playerEntities) {
          const px = p.x - viewX;
          const py = p.y - viewY;
          const rad = 100;
          const grad = ctx.createRadialGradient(px, py, 0, px, py, rad);
          const pIntensity = 0.85 * Math.max(0.35, dayFactor);
          grad.addColorStop(0, `rgba(0, 0, 0, ${pIntensity.toFixed(2)})`);
          grad.addColorStop(0.6, `rgba(0, 0, 0, ${(pIntensity * 0.4).toFixed(2)})`);
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(px, py, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      return this.lightCanvas;
    }
  }

  global.OfficeMap = OfficeMap;
  global.TILE = TILE;
  global.T_FLOOR_TRADING = T_FLOOR_TRADING;
})(typeof window !== 'undefined' ? window : global);
