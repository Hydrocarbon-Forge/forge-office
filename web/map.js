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
  const T_WINDOW = 15;

  class OfficeMap {
    constructor() {
      this.tile = TILE;
      this.width = 44; // tightened width in tiles
      this.height = 40; // tightened height in tiles, can grow downward
      this.grid = []; // tile types
      this.solid = []; // boolean solid collision
      this.doors = []; // interactive doors
      this.windows = []; // architectural windows
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
      this.windows = [];

      this.buildBaseRooms();
      this.buildWindows();
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

      // Status Board on Lobby North Wall: left side x:15..19, right side x:24..28
      // Symmetrically centered on their wall spans with equal 1-tile gaps:
      // Left span x:14..20 -> centered board x:15..19 (gap of 1 at 14, gap of 1 at 20)
      // Right span x:23..29 -> centered board x:24..28 (gap of 1 at 23, gap of 1 at 29)
      for (let x = 15; x <= 19; x++) {
        this.setTile(x, 9, T_BOARD, true);
      }
      for (let x = 24; x <= 28; x++) {
        this.setTile(x, 9, T_BOARD, true);
      }
      this.setTile(20, 9, T_FLOOR_LOBBY, false);
      this.setTile(21, 9, T_FLOOR_LOBBY, false);
      this.setTile(22, 9, T_FLOOR_LOBBY, false);
      this.setTile(23, 9, T_FLOOR_LOBBY, false);

      // C6 Front Desk in Lobby (x: 19..23, y: 12)
      for (let x = 19; x <= 23; x++) {
        this.setTile(x, 12, T_DESK, true);
      }

      // 7. Archives south wall & doorway from Lobby South (y: 22, x: 17..26)
      // Solid wall tiles flanking both sides of doorway in Archives wall color
      for (let x = 17; x <= 26; x++) {
        if (x === 21) {
          this.setTile(x, 22, T_DOOR, false);
        } else {
          this.setTile(x, 22, T_WALL, true);
        }
      }
      this.addDoor(21, 22, 'h', 'archives');

      // 8. Initial Archives Hallway (y: 23 to 38)
      this.buildArchivesSection(23, 38);

      // 9. Trading Floor (East South Void: x: 30..42, y: 22..34)
      this.fillRoom(30, 22, 42, 34, T_FLOOR_TRADING);
      this.addDoor(32, 22, 'h', 'trading_floor');
    }

    buildWindows() {
      this.windows = [];
      const addWin = (x, y, orientation = 'h') => {
        this.setTile(x, y, T_WINDOW, true);
        this.windows.push({ x, y, orientation });
      };

      // 1. Claude-Code Office North Wall (y = 1)
      // Panoramic picture window: x: 18..24 framing soaring snowy mountain peaks
      for (let x = 18; x <= 24; x++) addWin(x, 1, 'h');
      addWin(14, 1, 'h');
      addWin(28, 1, 'h');
      addWin(29, 1, 'h');

      // 2. OpenCode Studio
      // North Wall (y = 1)
      addWin(6, 1, 'h');
      addWin(7, 1, 'h');
      // West Wall (x = 1)
      addWin(1, 4, 'v');
      addWin(1, 5, 'v');
      addWin(1, 9, 'v');
      addWin(1, 10, 'v');

      // 3. Gemini / Antigravity Lab
      // North Wall (y = 1)
      addWin(36, 1, 'h');
      addWin(37, 1, 'h');
      addWin(38, 1, 'h');
      // East Wall (x = 42)
      addWin(42, 4, 'v');
      addWin(42, 5, 'v');
      addWin(42, 9, 'v');
      addWin(42, 10, 'v');

      // 4. Break Room
      // West Wall (x = 1)
      addWin(1, 15, 'v');
      addWin(1, 16, 'v');
      addWin(1, 17, 'v');
      // South Wall (y = 22) - panoramic café glass wall overlooking the Alpine Lake!
      for (let x = 4; x <= 10; x++) addWin(x, 22, 'h');

      // 5. Trading Floor
      // West Wall (x = 30) overlooking ravine
      addWin(30, 26, 'v');
      addWin(30, 27, 'v');
      // East Wall (x = 42) overlooking sunrise valley
      addWin(42, 26, 'v');
      addWin(42, 27, 'v');
      // South Wall (y = 34) overlooking southern terrace
      for (let x = 34; x <= 38; x++) addWin(x, 34, 'h');

      // 6. Archives
      // South wall (y = 39) at the end of the center aisle
      addWin(21, 39, 'h');
      addWin(22, 39, 'h');
      // West & East clerestory slot windows
      [25, 29, 33, 37].forEach((y) => {
        addWin(17, y, 'v');
        addWin(26, y, 'v');
      });
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

    assertReachability() {
      const spawn = { x: 21 * TILE + 16, y: 17 * TILE + 16 };
      for (const door of this.doors) {
        const path = this.findPath(spawn.x, spawn.y, door.x, door.y);
        if (!path || path.length === 0) {
          throw new Error(`Reachability assertion failed: Door ${door.name} at (${door.tileX}, ${door.tileY}) unreachable!`);
        }
      }
      for (const [name, wp] of Object.entries(this.waypoints)) {
        const path = this.findPath(spawn.x, spawn.y, wp.x, wp.y);
        if (!path || path.length === 0) {
          throw new Error(`Reachability assertion failed: Waypoint ${name} unreachable!`);
        }
      }
      for (const shelf of this.shelves) {
        const path = this.findPath(spawn.x, spawn.y, shelf.accessX * TILE + 16, shelf.accessY * TILE + 16);
        if (!path || path.length === 0) {
          throw new Error(`Reachability assertion failed: Shelf access (${shelf.accessX}, ${shelf.accessY}) unreachable!`);
        }
      }
      return true;
    }

    populateProjects(projects) {
      if (!Array.isArray(projects)) return false;

      // Sort projects by updated desc (newest first at front of Archives near the door)
      const sorted = [...projects].sort((a, b) => {
        const dateA = a.updated || '';
        const dateB = b.updated || '';
        return dateB.localeCompare(dateA);
      });

      const isNew = this.ensureArchivesCapacity(sorted.length);

      if (!this.projectBoxesMap) {
        this.projectBoxesMap = new Map();
      }

      const activeIds = new Set();

      sorted.forEach((proj, index) => {
        const id = String(proj.id || proj.name || `proj_${index}`);
        activeIds.add(id);
        const shelf = this.shelves[index];
        if (!shelf) return;

        if (this.projectBoxesMap.has(id)) {
          // Existing box: update fields in place
          const box = this.projectBoxesMap.get(id);
          box.project = proj;
          box.shelf = shelf;
          box.x = shelf.tileX * TILE + TILE / 2;
          box.y = shelf.tileY * TILE + TILE / 2;
          box.accessX = shelf.accessX * TILE + TILE / 2;
          box.accessY = shelf.accessY * TILE + TILE / 2;
          box.fadingOut = false;
          box.opacity = 1.0;
        } else {
          // New box
          const box = {
            id,
            project: proj,
            shelf,
            x: shelf.tileX * TILE + TILE / 2,
            y: shelf.tileY * TILE + TILE / 2,
            accessX: shelf.accessX * TILE + TILE / 2,
            accessY: shelf.accessY * TILE + TILE / 2,
            opacity: 1.0,
            fadingOut: false,
            fadeTimer: 0
          };
          this.projectBoxesMap.set(id, box);
        }
      });

      // Mark removed boxes for fade out over ~1s
      for (const [id, box] of this.projectBoxesMap.entries()) {
        if (!activeIds.has(id) && !box.fadingOut) {
          box.fadingOut = true;
          box.fadeTimer = 1.0; // 1 second fade
          if (box.shelf) {
            box.shelf.hasEmptyMark = true;
          }
        }
      }

      this.projectBoxes = Array.from(this.projectBoxesMap.values());

      // Re-run A* reachability assertion after any box layout change
      this.assertReachability();

      return isNew;
    }

    updateProjectBoxes(dt) {
      if (!this.projectBoxesMap) return;
      let changed = false;

      for (const [id, box] of this.projectBoxesMap.entries()) {
        if (box.fadingOut) {
          box.fadeTimer -= dt;
          box.opacity = Math.max(0, box.fadeTimer / 1.0);
          if (box.fadeTimer <= 0) {
            if (box.shelf) {
              box.shelf.hasEmptyMark = true;
            }
            this.projectBoxesMap.delete(id);
            changed = true;
          }
        }
      }

      if (changed) {
        this.projectBoxes = Array.from(this.projectBoxesMap.values());
        this.assertReachability();
      }
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
        // Flanking plants for centered status boards (one each side of each centered strip on row 10)
        { x: 14, y: 10, kind: 'plant', variant: 'potted_monstera' }, // left board left flank
        { x: 20, y: 10, kind: 'plant', variant: 'potted_palm' },     // left board right flank
        { x: 23, y: 10, kind: 'plant', variant: 'potted_fern' },     // right board left flank
        { x: 29, y: 10, kind: 'plant', variant: 'potted_rubber' },   // right board right flank
        { x: 14, y: 21, kind: 'plant', variant: 'potted_fern' },
        { x: 29, y: 21, kind: 'plant', variant: 'potted_rubber' },
        { x: 15, y: 21, w: 2, h: 1, kind: 'bench', variant: 'cushioned_wood', solid: true },
        { x: 14, y: 8, kind: 'framed_art', variant: 'mountain' },
        { x: 29, y: 8, kind: 'framed_art', variant: 'cyber' },
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

      // Assert zero decor tiles intersect T_BOARD tiles (fail build if violated)
      for (const item of this.decor) {
        const w = item.w || 1;
        const h = item.h || 1;
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const tx = item.x + dx;
            const ty = item.y + dy;
            const tile = this.getTile(tx, ty);
            if (tile === T_BOARD) {
              throw new Error(`Decor placement violation: '${item.kind}' at (${tx}, ${ty}) intersects T_BOARD tile!`);
            }
          }
        }
      }
    }

    initLighting() {
      const TILE = 32;
      this.lights = [
        // 1. Lobby (Ceiling center + above C6 desk + status board glow + waiting lamp)
        { room: 'lobby', kind: 'desk', x: 21 * TILE + 16, y: 12 * TILE + 8, radius: 3.5 * TILE, color: '#ffe8c0', intensity: 1.0, extraWarm: true },
        { room: 'lobby', kind: 'ceiling', x: 21 * TILE + 16, y: 16 * TILE + 16, radius: 4.0 * TILE, color: '#ffecd2', intensity: 1.0 },
        { room: 'lobby', kind: 'board', x: 21 * TILE + 16, y: 10 * TILE, radius: 3.5 * TILE, color: '#e6fffa', intensity: 0.95 },
        { room: 'lobby', kind: 'lamp', x: 15 * TILE + 16, y: 12 * TILE + 16, radius: 3.2 * TILE, color: '#ffe4b5', intensity: 0.95, extraWarm: true },

        // 2. OpenCode Studio (Desk + corner bookshelf + entry)
        { room: 'opencode', kind: 'desk', x: 6 * TILE + 16, y: 6 * TILE + 8, radius: 3.5 * TILE, color: '#e6f7ff', intensity: 1.0, extraWarm: true },
        { room: 'opencode', kind: 'corner', x: 4 * TILE + 16, y: 3 * TILE + 16, radius: 3.5 * TILE, color: '#ffe8c0', intensity: 0.95 },
        { room: 'opencode', kind: 'entry', x: 11 * TILE + 16, y: 7 * TILE + 16, radius: 3.2 * TILE, color: '#ffe8c0', intensity: 0.9 },

        // 3. Claude-Code Office (Desk + west corner + east corner + entry)
        { room: 'claude', kind: 'desk', x: 21 * TILE + 16, y: 3 * TILE + 8, radius: 3.5 * TILE, color: '#fff3e0', intensity: 1.0, extraWarm: true },
        { room: 'claude', kind: 'corner', x: 16 * TILE + 16, y: 3 * TILE + 16, radius: 3.5 * TILE, color: '#ffe8c0', intensity: 0.95 },
        { room: 'claude', kind: 'corner', x: 26 * TILE + 16, y: 3 * TILE + 16, radius: 3.5 * TILE, color: '#ffe8c0', intensity: 0.95 },
        { room: 'claude', kind: 'entry', x: 21 * TILE + 16, y: 7 * TILE + 16, radius: 3.0 * TILE, color: '#ffecd2', intensity: 0.9 },

        // 4. Antigravity Lab (Desk + corner server rack + entry)
        { room: 'antigravity', kind: 'desk', x: 37 * TILE + 16, y: 6 * TILE + 8, radius: 3.5 * TILE, color: '#e8f0fe', intensity: 1.0, extraWarm: true },
        { room: 'antigravity', kind: 'corner', x: 39 * TILE + 16, y: 3 * TILE + 16, radius: 3.5 * TILE, color: '#ffe8c0', intensity: 0.95 },
        { room: 'antigravity', kind: 'entry', x: 32 * TILE + 16, y: 7 * TILE + 16, radius: 3.2 * TILE, color: '#ffe8c0', intensity: 0.9 },

        // 5. Break Room (Counter + dining table + entry - strongest warm glow)
        { room: 'breakroom', kind: 'counter', x: 4 * TILE + 16, y: 14 * TILE + 16, radius: 4.0 * TILE, color: '#ffdda1', intensity: 1.0, warmGlow: true },
        { room: 'breakroom', kind: 'table', x: 7 * TILE + 16, y: 18 * TILE + 16, radius: 3.8 * TILE, color: '#ffd699', intensity: 1.0, warmGlow: true },
        { room: 'breakroom', kind: 'entry', x: 11 * TILE + 16, y: 17 * TILE + 16, radius: 3.2 * TILE, color: '#ffe8c0', intensity: 0.9 },

        // 6. Storage Room (Center + entry)
        { room: 'storage', kind: 'ceiling', x: 36 * TILE + 16, y: 16 * TILE + 16, radius: 3.8 * TILE, color: '#f0f4f8', intensity: 0.95 },
        { room: 'storage', kind: 'entry', x: 32 * TILE + 16, y: 17 * TILE + 16, radius: 3.2 * TILE, color: '#ffe8c0', intensity: 0.9 },

        // 7. Trading Floor (Trader desk + entry)
        { room: 'trading', kind: 'desk', x: 37 * TILE + 16, y: 26 * TILE + 16, radius: 4.0 * TILE, color: '#e6fffa', intensity: 1.0, extraWarm: true },
        { room: 'trading', kind: 'entry', x: 32 * TILE + 16, y: 23 * TILE + 16, radius: 3.2 * TILE, color: '#ffe8c0', intensity: 0.9 },

        // 8. Soft entry light by each door
        { room: 'doors', kind: 'door', x: 21 * TILE + 16, y: 8 * TILE + 16, radius: 2.8 * TILE, color: '#ffe8c0', intensity: 0.88 },
        { room: 'doors', kind: 'door', x: 13 * TILE + 16, y: 7 * TILE + 16, radius: 2.8 * TILE, color: '#ffe8c0', intensity: 0.88 },
        { room: 'doors', kind: 'door', x: 30 * TILE + 16, y: 7 * TILE + 16, radius: 2.8 * TILE, color: '#ffe8c0', intensity: 0.88 },
        { room: 'doors', kind: 'door', x: 13 * TILE + 16, y: 17 * TILE + 16, radius: 2.8 * TILE, color: '#ffe8c0', intensity: 0.88 },
        { room: 'doors', kind: 'door', x: 30 * TILE + 16, y: 17 * TILE + 16, radius: 2.8 * TILE, color: '#ffe8c0', intensity: 0.88 },
        { room: 'doors', kind: 'door', x: 21 * TILE + 16, y: 22 * TILE + 16, radius: 3.0 * TILE, color: '#fed7aa', intensity: 0.9 },
        { room: 'doors', kind: 'door', x: 32 * TILE + 16, y: 22 * TILE + 16, radius: 2.8 * TILE, color: '#ffe8c0', intensity: 0.88 },

        // 9. Archives (Finding aids table + amber mood lanterns)
        { room: 'archives', kind: 'table', x: 18 * TILE + 16, y: 23 * TILE + 16, radius: 3.2 * TILE, color: '#fed7aa', intensity: 0.92, amberMood: true }
      ];

      // Archives one lantern per shelf-bay along aisle
      for (let y = 25; y <= this.archivesMaxRow; y += 3) {
        this.lights.push({
          room: 'archives',
          kind: 'bay',
          x: 21.5 * TILE,
          y: y * TILE + 16,
          radius: 3.5 * TILE,
          color: '#ffedd5',
          intensity: 0.9,
          amberMood: true
        });
      }

      this.bakeLightmaps();
    }

    bakeLightmaps() {
      if (typeof document === 'undefined') return;

      const mapW = this.width * TILE;
      const mapH = this.height * TILE;

      if (!this.fullbrightCanvas) {
        this.fullbrightCanvas = document.createElement('canvas');
      }
      this.fullbrightCanvas.width = 1;
      this.fullbrightCanvas.height = 1;

      if (!this.officeLightCanvas) {
        this.officeLightCanvas = document.createElement('canvas');
      }
      this.officeLightCanvas.width = mapW;
      this.officeLightCanvas.height = mapH;

      const ctx = this.officeLightCanvas.getContext('2d');
      ctx.clearRect(0, 0, mapW, mapH);

      // Ambient floor darkness: 1 - 0.62 = 0.38 (rooms stay clearly visible everywhere)
      const ambientFloor = 0.62;
      const ambientDarkness = 1.0 - ambientFloor; // 0.38
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(18, 16, 26, ${ambientDarkness.toFixed(3)})`;
      ctx.fillRect(0, 0, mapW, mapH);

      // Carve out exterior void tiles & windows so outdoor mountain vista retains luminous natural sky and water
      ctx.globalCompositeOperation = 'destination-out';
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const t = this.grid[y * this.width + x];
          if (t === 0 || t === T_WINDOW) {
            ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
          }
        }
      }
      for (const light of this.lights) {
        const rad = light.radius;
        const grad = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, rad);
        const int = light.intensity || 1.0;
        grad.addColorStop(0, `rgba(0, 0, 0, ${int.toFixed(2)})`);
        grad.addColorStop(0.35, `rgba(0, 0, 0, ${(int * 0.82).toFixed(2)})`);
        grad.addColorStop(0.70, `rgba(0, 0, 0, ${(int * 0.40).toFixed(2)})`);
        grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(light.x, light.y, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // Coziness pass: warm tint light pools (source-over with subtle golden/amber pools)
      ctx.globalCompositeOperation = 'source-over';
      for (const light of this.lights) {
        const rad = light.radius;
        let tint = 'rgba(255, 232, 192, 0.18)'; // warm white #ffe8c0
        if (light.warmGlow) {
          tint = 'rgba(255, 215, 140, 0.28)'; // break room strongest warm glow
        } else if (light.extraWarm) {
          tint = 'rgba(255, 235, 170, 0.24)'; // desk lamp extra warm pool
        } else if (light.amberMood) {
          tint = 'rgba(254, 215, 170, 0.16)'; // archives amber mood (>= floor brightness)
        }

        const grad = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, rad);
        grad.addColorStop(0, tint);
        grad.addColorStop(0.5, tint.replace(/[\d\.]+\)$/, '0.08)'));
        grad.addColorStop(1.0, tint.replace(/[\d\.]+\)$/, '0.0)'));

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(light.x, light.y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
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

    getAmbientDarkness() {
      return 0.0;
    }

    renderLightOverlay(viewX, viewY, viewWidth, viewHeight, playerEntities, consoleOnline = true, lightsMode = 'office') {
      if (lightsMode === 'fullbright' || lightsMode === true) {
        return null;
      }
      return this.officeLightCanvas;
    }
  }

  global.OfficeMap = OfficeMap;
  global.TILE = TILE;
  global.T_FLOOR_TRADING = T_FLOOR_TRADING;
})(typeof window !== 'undefined' ? window : global);
