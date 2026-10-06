// web/render.js — Visual engine: sprite generation & caching, Among Us avatars, furniture, status board, scanlines
(function (global) {
  const COLOR_PALETTE = {
    'coral': { fill: '#FF5E7E', dark: '#C92A45', highlight: '#FF94AB' },
    'ocean': { fill: '#3A86FF', dark: '#1B54B8', highlight: '#7DB1FF' },
    'mint': { fill: '#06D6A0', dark: '#049E75', highlight: '#68E7C5' },
    'lemon': { fill: '#FFD166', dark: '#C49729', highlight: '#FFE29A' },
    'lavender': { fill: '#9D4EDD', dark: '#6A23A8', highlight: '#C58BF2' },
    'tangerine': { fill: '#FB5607', dark: '#BD3B00', highlight: '#FD8E56' },
    'teal': { fill: '#00BBF9', dark: '#0083B0', highlight: '#60D4FB' },
    'sand': { fill: '#E0A96D', dark: '#A8733A', highlight: '#EAC397' },
    'ruby': { fill: '#D90429', dark: '#8C0017', highlight: '#E8526C' },
    'cloud': { fill: '#83C5BE', dark: '#4E8780', highlight: '#B0DAD6' }
  };

  function resolveColor(c) {
    if (typeof c === 'string' && COLOR_PALETTE[c.toLowerCase()]) {
      return COLOR_PALETTE[c.toLowerCase()];
    }
    // Hex string fallback
    const hex = (typeof c === 'string' && c.startsWith('#')) ? c : '#FF5E7E';
    return { fill: hex, dark: '#22252A', highlight: '#FFFFFF' };
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = window.devicePixelRatio || 1;
      this.spriteCache = new Map();
      this.scanlineCanvas = null;
      this.initScanlines();
    }

    resize(width, height) {
      this.dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.floor(width * this.dpr);
      this.canvas.height = Math.floor(height * this.dpr);
      this.canvas.style.width = width + 'px';
      this.canvas.style.height = height + 'px';
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    initScanlines() {
      this.scanlineCanvas = document.createElement('canvas');
      this.scanlineCanvas.width = 4;
      this.scanlineCanvas.height = 4;
      const sctx = this.scanlineCanvas.getContext('2d');
      sctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      sctx.fillRect(0, 2, 4, 2);
    }

    clear() {
      this.ctx.fillStyle = '#1A1C23';
      this.ctx.fillRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
    }

    // -------------------------------------------------------------------------
    // Map rendering
    // -------------------------------------------------------------------------
    renderMap(map, camera, liveData) {
      const ctx = this.ctx;
      const TILE = map.tile;
      const x0 = Math.max(0, Math.floor(camera.x / TILE));
      const y0 = Math.max(0, Math.floor(camera.y / TILE));
      const x1 = Math.min(map.width - 1, Math.ceil((camera.x + camera.width) / TILE));
      const y1 = Math.min(map.height - 1, Math.ceil((camera.y + camera.height) / TILE));

      // Draw Floor Tiles
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const type = map.getTile(x, y);
          const px = x * TILE;
          const py = y * TILE;

          if (type === 0) {
            // Void outside
            ctx.fillStyle = '#14161C';
            ctx.fillRect(px, py, TILE, TILE);
            continue;
          }

          // Distinct floor palettes per room
          let floorBase = '#F4E8C1';
          let floorAccent = '#E5D6A7';

          if (type === 1) { // Lobby
            floorBase = '#F3E5AB'; // Warm parquet
            floorAccent = '#E5D491';
          } else if (type === 2) { // OpenCode
            floorBase = '#D0EFEA'; // Cool mint grid
            floorAccent = '#BBE4DD';
          } else if (type === 3) { // Claude
            floorBase = '#FCEADE'; // Soft terracotta peach
            floorAccent = '#F2D8C7';
          } else if (type === 4) { // Antigravity
            floorBase = '#D9E8F5'; // High-tech pale slate
            floorAccent = '#C4DAEB';
          } else if (type === 5) { // Breakroom
            floorBase = '#FFF3CD'; // Warm cafe tile
            floorAccent = '#FFEAA7';
          } else if (type === 6) { // Storage
            floorBase = '#D6DBDF'; // Concrete slab
            floorAccent = '#C4C9CC';
          } else if (type === 7) { // Archives
            floorBase = '#E5E7E9'; // Archival library floor
            floorAccent = '#D7DBDD';
          }

          ctx.fillStyle = floorBase;
          ctx.fillRect(px, py, TILE, TILE);

          // Subtle tile grid pattern
          ctx.strokeStyle = floorAccent;
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
        }
      }

      // Draw Rugs & Accents
      this.drawLobbyRug(ctx, 18 * TILE, 14 * TILE, 7 * TILE, 4 * TILE);

      // Draw Walls (with 2.5D depth)
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const type = map.getTile(x, y);
          const px = x * TILE;
          const py = y * TILE;

          if (type === 10) { // Wall
            // Wall front face
            ctx.fillStyle = '#2C3539';
            ctx.fillRect(px, py, TILE, TILE);

            // Wall top highlight
            ctx.fillStyle = '#4A5568';
            ctx.fillRect(px, py, TILE, 6);

            // Wall outline
            ctx.strokeStyle = '#1A202C';
            ctx.lineWidth = 2;
            ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);

            // Wall drop shadow onto floor below
            if (y < map.height - 1 && map.getTile(x, y + 1) !== 10) {
              ctx.fillStyle = 'rgba(15, 20, 25, 0.35)';
              ctx.fillRect(px, py + TILE, TILE, 6);
            }
          }
        }
      }

      // Draw Doors
      for (const door of map.doors) {
        this.drawDoor(ctx, door);
      }

      // Draw Main Status Board on North Wall
      this.drawStatusBoard(ctx, liveData);

      // Draw Furniture & Room Decor
      this.drawFurniture(ctx, map, camera, liveData);
    }

    drawLobbyRug(ctx, rx, ry, rw, rh) {
      // Chunky warm rug in center lobby
      ctx.fillStyle = 'rgba(192, 57, 43, 0.22)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = '#C0392B';
      ctx.lineWidth = 2;
      ctx.strokeRect(rx + 2, ry + 2, rw - 4, rh - 4);
      ctx.fillStyle = '#F39C12';
      // Rug diamond pattern
      ctx.fillRect(rx + rw / 2 - 12, ry + rh / 2 - 12, 24, 24);
    }

    drawDoor(ctx, door) {
      const TILE = 32;
      ctx.save();
      ctx.translate(door.x, door.y);

      // Door frame
      ctx.strokeStyle = '#3E2723';
      ctx.lineWidth = 3;

      if (door.orientation === 'v') {
        // Vertical doorway
        const swing = door.open * 24;
        ctx.fillStyle = '#8D6E63';
        ctx.fillRect(-4 + swing, -TILE / 2 + 2, 8, TILE - 4);
        ctx.strokeRect(-4 + swing, -TILE / 2 + 2, 8, TILE - 4);
        // Handle
        ctx.fillStyle = '#FFD54F';
        ctx.beginPath();
        ctx.arc(swing, 0, 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Horizontal doorway
        const swing = door.open * 24;
        ctx.fillStyle = '#8D6E63';
        ctx.fillRect(-TILE / 2 + 2, -4 - swing, TILE - 4, 8);
        ctx.strokeRect(-TILE / 2 + 2, -4 - swing, TILE - 4, 8);
        // Handle
        ctx.fillStyle = '#FFD54F';
        ctx.beginPath();
        ctx.arc(0, -swing, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    // -------------------------------------------------------------------------
    // Main Status Board (Live cluster stats & scanlines)
    // -------------------------------------------------------------------------
    // Main Status Board (Dual CRT Displays flanking Claude Door)
    // -------------------------------------------------------------------------
    drawStatusBoard(ctx, liveData) {
      const TILE = 32;
      ctx.save();

      const isOnline = liveData && liveData.online !== false;
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];
      const summary = (liveData && liveData.summary) || {};
      const sessions = summary.sessions !== undefined ? summary.sessions : '--';
      const messages = summary.messages !== undefined ? summary.messages : '--';
      const toolCalls = summary.tool_calls !== undefined ? summary.tool_calls : '--';
      const tokens = summary.total_tokens !== undefined ? (summary.total_tokens > 1000000 ? (summary.total_tokens / 1000000).toFixed(1) + 'M' : (summary.total_tokens / 1000).toFixed(0) + 'k') : '--';

      const renderPanel = (px, py, pw, ph, title) => {
        // Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(px + 4, py + 4, pw, ph);

        // Frame
        ctx.fillStyle = '#1E252B';
        ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = '#38B2AC';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(px, py, pw, ph);

        // Phosphor CRT background
        const screenGrad = ctx.createLinearGradient(px, py, px, py + ph);
        screenGrad.addColorStop(0, isOnline ? '#0A2528' : '#1A181C');
        screenGrad.addColorStop(1, isOnline ? '#051416' : '#0F0E10');
        ctx.fillStyle = screenGrad;
        ctx.fillRect(px + 3, py + 3, pw - 6, ph - 6);

        // Title
        ctx.font = 'bold 10px "Segoe UI Rounded", "Nunito", sans-serif';
        ctx.fillStyle = '#E6FFFA';
        ctx.fillText(title, px + 8, py + 16);

        // Scanlines
        if (this.scanlineCanvas) {
          ctx.fillStyle = ctx.createPattern(this.scanlineCanvas, 'repeat');
          ctx.fillRect(px + 3, py + 3, pw - 6, ph - 6);
        }
      };

      // 1. Left Panel (Overview): x: 14.5 * TILE, y: 8.6 * TILE, w: 5.8 * TILE, h: 2.5 * TILE
      const lx = 14.5 * TILE;
      const ly = 8.6 * TILE;
      const lw = 5.8 * TILE;
      const lh = 2.5 * TILE;
      renderPanel(lx, ly, lw, lh, 'FORGE CLUSTER');

      // Online pill & clock
      ctx.fillStyle = isOnline ? '#38A169' : '#E53E3E';
      ctx.beginPath();
      ctx.arc(lx + lw - 54, ly + 13, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = 'bold 8px "Segoe UI Rounded", sans-serif';
      ctx.fillStyle = isOnline ? '#48BB78' : '#F56565';
      ctx.fillText(isOnline ? 'ONLINE' : 'OFFLINE', lx + lw - 46, ly + 16);

      ctx.fillStyle = '#81E6D9';
      ctx.font = '8px monospace';
      ctx.fillText(timeStr, lx + 8, ly + 32);

      // Stats row in left panel
      const colW1 = (lw - 16) / 2;
      const statsLeft = [
        { label: 'SESSIONS', val: String(sessions), color: '#4FD1C5' },
        { label: 'TOKENS', val: String(tokens), color: '#F687B3' }
      ];
      statsLeft.forEach((st, i) => {
        const sx = lx + 8 + i * colW1;
        ctx.fillStyle = '#A0AEC0';
        ctx.font = '7px "Segoe UI Rounded", sans-serif';
        ctx.fillText(st.label, sx, ly + 46);

        ctx.fillStyle = st.color;
        ctx.font = 'bold 13px monospace';
        ctx.fillText(st.val, sx, ly + 62);

        // Mini ticking bar
        const barW = colW1 - 10;
        const tickVal = ((Date.now() / 800 + i * 1.5) % 3) / 3;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillRect(sx, ly + 67, barW, 3);
        ctx.fillStyle = st.color;
        ctx.fillRect(sx, ly + 67, barW * (0.3 + tickVal * 0.7), 3);
      });

      // 2. Right Panel (Harness Metrics): x: 21.7 * TILE, y: 8.6 * TILE, w: 5.8 * TILE, h: 2.5 * TILE
      const rx = 21.7 * TILE;
      const ry = 8.6 * TILE;
      const rw = 5.8 * TILE;
      const rh = 2.5 * TILE;
      renderPanel(rx, ry, rw, rh, 'HARNESS METRICS');

      // Mini stats in right panel: TOOL CALLS & MESSAGES
      const colW2 = (rw - 16) / 2;
      const statsRight = [
        { label: 'MESSAGES', val: String(messages), color: '#63B3ED' },
        { label: 'TOOL CALLS', val: String(toolCalls), color: '#F6E05E' }
      ];
      statsRight.forEach((st, i) => {
        const sx = rx + 8 + i * colW2;
        ctx.fillStyle = '#A0AEC0';
        ctx.font = '7px "Segoe UI Rounded", sans-serif';
        ctx.fillText(st.label, sx, ry + 32);

        ctx.fillStyle = st.color;
        ctx.font = 'bold 12px monospace';
        ctx.fillText(st.val, sx, ry + 46);
      });

      // Lower row: Harness Agents
      const harnesses = [
        { name: 'OPEN', color: '#00A896', sess: (liveData && liveData.opencode && liveData.opencode.sessions) || 22 },
        { name: 'CLAUDE', color: '#E07A5F', sess: 18 },
        { name: 'AGY', color: '#3D5A80', sess: (liveData && liveData.antigravity && liveData.antigravity.sessions) || 38 }
      ];
      const hColW = (rw - 16) / 3;
      harnesses.forEach((harn, i) => {
        const hx = rx + 8 + i * hColW;
        ctx.fillStyle = harn.color;
        ctx.beginPath();
        ctx.arc(hx + 3, ry + 62, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = 'bold 7px "Segoe UI Rounded", sans-serif';
        ctx.fillStyle = '#E2E8F0';
        ctx.fillText(`${harn.name}:${harn.sess}`, hx + 8, ry + 65);
      });

      ctx.restore();
    }

    // -------------------------------------------------------------------------
    // Furniture, Shelves, Desks, Plants, Breakroom
    // -------------------------------------------------------------------------
    drawFurniture(ctx, map, camera, liveData) {
      const TILE = 32;

      // 1. C6 Front Desk (Lobby center: x: 19..23, y: 12)
      this.drawDesk(ctx, 19 * TILE, 12 * TILE, 5 * TILE, 1.2 * TILE, '#D7A765');
      // Laptop on C6 desk
      this.drawLaptop(ctx, 21 * TILE + 8, 12 * TILE + 4, '#4FD1C5');
      // Reception Bell
      this.drawBell(ctx, 20 * TILE + 10, 12 * TILE + 8);
      // Potted flower
      this.drawFlowerVase(ctx, 23 * TILE + 6, 12 * TILE + 4);

      // 2. OpenCode Desk & Office Setup (West North: x: 1..13, y: 1..12)
      this.drawDesk(ctx, 5 * TILE, 6 * TILE, 3 * TILE, 1.5 * TILE, '#5A6B7C');
      this.drawMonitor(ctx, 6 * TILE + 8, 5.5 * TILE, '#00BBF9', 'code');
      this.drawChair(ctx, 6 * TILE + 8, 7.8 * TILE, '#2C3E50');
      this.drawWhiteboard(ctx, 3 * TILE, 2.5 * TILE, 4 * TILE, 'PIPELINES');
      this.drawOfficeSign(ctx, 12.5 * TILE, 6 * TILE, 'OPENCODE', '#00A896');

      // 3. Claude-Code Desk & Office Setup (Center North: x: 13..30, y: 1..8)
      this.drawDesk(ctx, 20 * TILE, 3 * TILE, 3 * TILE, 1.5 * TILE, '#A0522D');
      this.drawMonitor(ctx, 21 * TILE + 8, 2.5 * TILE, '#FB5607', 'writing');
      this.drawChair(ctx, 21 * TILE + 8, 4.8 * TILE, '#8B4513');
      this.drawBookshelf(ctx, 15 * TILE, 2 * TILE, 3 * TILE);
      this.drawOfficeSign(ctx, 21 * TILE, 7.5 * TILE, 'CLAUDE-CODE', '#E07A5F');

      // 4. Antigravity Desk & Office Setup (East North: x: 30..42, y: 1..12)
      this.drawDesk(ctx, 36 * TILE, 6 * TILE, 3 * TILE, 1.5 * TILE, '#34495E');
      this.drawMonitor(ctx, 37 * TILE + 8, 5.5 * TILE, '#5AA9E6', 'orchestrator');
      this.drawChair(ctx, 37 * TILE + 8, 7.8 * TILE, '#1B2631');
      this.drawServerRack(ctx, 40 * TILE, 2.5 * TILE);
      this.drawOfficeSign(ctx, 30.5 * TILE, 6 * TILE, 'ANTIGRAVITY', '#3D5A80');

      // 5. Break Room (West South: x: 1..13, y: 12..22)
      this.drawCoffeeCounter(ctx, 3 * TILE, 14 * TILE, 3.5 * TILE);
      this.drawCafeTable(ctx, 7 * TILE, 18 * TILE);
      this.drawWaterCooler(ctx, 10 * TILE, 14 * TILE);

      // 6. Storage Room (East South: x: 30..42, y: 12..22)
      this.drawServerRack(ctx, 33 * TILE, 14 * TILE);
      this.drawServerRack(ctx, 35.5 * TILE, 14 * TILE);
      this.drawCrateStack(ctx, 38 * TILE, 18 * TILE);

      // 7. Decorative Potted Plants in Lobby corners
      this.drawPlant(ctx, 15 * TILE, 10 * TILE);
      this.drawPlant(ctx, 28 * TILE, 10 * TILE);
      this.drawPlant(ctx, 15 * TILE, 20 * TILE);
      this.drawPlant(ctx, 28 * TILE, 20 * TILE);

      // 8. The Archives Shelves & Project Boxes
      this.drawArchiveShelves(ctx, map, camera);
    }

    drawDesk(ctx, x, y, w, h, woodColor) {
      // Chunky drop shadow
      ctx.fillStyle = 'rgba(20, 25, 35, 0.25)';
      ctx.fillRect(x + 4, y + 4, w, h);
      // Desk top
      ctx.fillStyle = woodColor;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#22252A';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      // Desk highlight line
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.fillRect(x + 2, y + 2, w - 4, 3);
    }

    drawChair(ctx, x, y, color) {
      // Swivel chair seat
      ctx.fillStyle = 'rgba(20, 25, 35, 0.2)';
      ctx.beginPath();
      ctx.arc(x + 2, y + 2, 9, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#22252A';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    drawMonitor(ctx, x, y, screenColor, text) {
      // Monitor stand
      ctx.fillStyle = '#4A5568';
      ctx.fillRect(x - 3, y + 8, 6, 6);
      ctx.fillRect(x - 8, y + 13, 16, 3);

      // Monitor screen housing
      ctx.fillStyle = '#1A202C';
      ctx.fillRect(x - 14, y - 8, 28, 18);
      ctx.strokeStyle = '#2D3748';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 14, y - 8, 28, 18);

      // Glowing screen face
      ctx.fillStyle = screenColor;
      ctx.fillRect(x - 11, y - 5, 22, 12);

      // Code lines on screen
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x - 9, y - 3, 12, 1.5);
      ctx.fillRect(x - 9, y, 16, 1.5);
      ctx.fillRect(x - 9, y + 3, 8, 1.5);
    }

    drawLaptop(ctx, x, y, screenColor) {
      ctx.fillStyle = '#4A5568';
      ctx.fillRect(x - 10, y - 6, 20, 12);
      ctx.strokeStyle = '#2D3748';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 10, y - 6, 20, 12);

      ctx.fillStyle = screenColor;
      ctx.fillRect(x - 8, y - 4, 16, 8);
    }

    drawBell(ctx, x, y) {
      ctx.fillStyle = '#D69E2E';
      ctx.beginPath();
      ctx.arc(x, y, 5, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = '#744210';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    drawFlowerVase(ctx, x, y) {
      ctx.fillStyle = '#E2E8F0';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#E53E3E';
      ctx.beginPath();
      ctx.arc(x, y - 4, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    drawPlant(ctx, x, y) {
      // Pot
      ctx.fillStyle = 'rgba(20, 25, 35, 0.2)';
      ctx.fillRect(x - 8, y + 4, 20, 12);
      ctx.fillStyle = '#C05621';
      ctx.fillRect(x - 10, y - 2, 20, 14);
      ctx.strokeStyle = '#7B341E';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 10, y - 2, 20, 14);

      // Foliage
      ctx.fillStyle = '#38A169';
      ctx.beginPath();
      ctx.arc(x, y - 8, 12, 0, Math.PI * 2);
      ctx.arc(x - 6, y - 4, 9, 0, Math.PI * 2);
      ctx.arc(x + 6, y - 4, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#22543D';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    drawOfficeSign(ctx, x, y, name, accentColor) {
      ctx.fillStyle = '#2D3748';
      ctx.fillRect(x - 30, y - 8, 60, 16);
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 30, y - 8, 60, 16);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 8px "Segoe UI Rounded", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(name, x, y + 4);
      ctx.textAlign = 'left';
    }

    drawWhiteboard(ctx, x, y, w, title) {
      ctx.fillStyle = '#EDF2F7';
      ctx.fillRect(x, y, w, 8);
      ctx.strokeStyle = '#A0AEC0';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, 8);

      ctx.fillStyle = '#4A5568';
      ctx.font = 'bold 7px sans-serif';
      ctx.fillText(title, x + 4, y + 6);
    }

    drawBookshelf(ctx, x, y, w) {
      ctx.fillStyle = '#7B341E';
      ctx.fillRect(x, y, w, 14);
      ctx.strokeStyle = '#4A2112';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, 14);

      // Book spines
      const colors = ['#E53E3E', '#3182CE', '#38A169', '#D69E2E', '#805AD5'];
      for (let bx = x + 4; bx < x + w - 4; bx += 5) {
        ctx.fillStyle = colors[Math.floor(bx) % colors.length];
        ctx.fillRect(bx, y + 2, 4, 10);
      }
    }

    drawServerRack(ctx, x, y) {
      ctx.fillStyle = '#1A202C';
      ctx.fillRect(x, y, 24, 40);
      ctx.strokeStyle = '#2D3748';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, 24, 40);

      // Blinking LEDs
      const t = Math.floor(Date.now() / 400);
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = '#4A5568';
        ctx.fillRect(x + 3, y + 4 + i * 9, 18, 6);
        ctx.fillStyle = ((t + i) % 2 === 0) ? '#48BB78' : '#38A169';
        ctx.fillRect(x + 5, y + 6 + i * 9, 2, 2);
        ctx.fillStyle = ((t + i) % 3 === 0) ? '#ED8936' : '#C05621';
        ctx.fillRect(x + 9, y + 6 + i * 9, 2, 2);
      }
    }

    drawCoffeeCounter(ctx, x, y, w) {
      // Counter
      ctx.fillStyle = '#4A5568';
      ctx.fillRect(x, y, w, 18);
      ctx.strokeStyle = '#2D3748';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, 18);

      // Espresso Machine
      ctx.fillStyle = '#E2E8F0';
      ctx.fillRect(x + 6, y - 6, 22, 16);
      ctx.strokeStyle = '#A0AEC0';
      ctx.strokeRect(x + 6, y - 6, 22, 16);

      // Coffee pot with brown coffee
      ctx.fillStyle = 'rgba(107, 70, 41, 0.85)';
      ctx.fillRect(x + 34, y - 2, 12, 12);
      ctx.strokeStyle = '#E2E8F0';
      ctx.strokeRect(x + 34, y - 2, 12, 12);

      // Mugs
      ctx.fillStyle = '#E53E3E';
      ctx.fillRect(x + 52, y + 2, 6, 8);
      ctx.fillStyle = '#3182CE';
      ctx.fillRect(x + 62, y + 2, 6, 8);
    }

    drawCafeTable(ctx, x, y) {
      // Table shadow
      ctx.fillStyle = 'rgba(20, 25, 35, 0.2)';
      ctx.beginPath();
      ctx.arc(x + 3, y + 3, 20, 0, Math.PI * 2);
      ctx.fill();

      // Round wooden tabletop
      ctx.fillStyle = '#ED8936';
      ctx.beginPath();
      ctx.arc(x, y, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#C05621';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Donut box on table
      ctx.fillStyle = '#FEB2B2';
      ctx.fillRect(x - 8, y - 8, 16, 16);
      ctx.strokeStyle = '#E53E3E';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 8, y - 8, 16, 16);
    }

    drawWaterCooler(ctx, x, y) {
      ctx.fillStyle = '#EDF2F7';
      ctx.fillRect(x - 8, y + 2, 16, 22);
      ctx.strokeStyle = '#CBD5E0';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 8, y + 2, 16, 22);

      // Blue water bottle on top
      ctx.fillStyle = '#63B3ED';
      ctx.beginPath();
      ctx.arc(x, y - 4, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    drawCrateStack(ctx, x, y) {
      ctx.fillStyle = '#D69E2E';
      ctx.fillRect(x, y, 20, 20);
      ctx.strokeStyle = '#975A16';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, 20, 20);
      // Tape
      ctx.fillStyle = '#ECC94B';
      ctx.fillRect(x + 7, y, 6, 20);
    }

    // -------------------------------------------------------------------------
    // The Archives: Shelves & Project Boxes
    // -------------------------------------------------------------------------
    drawArchiveShelves(ctx, map, camera) {
      const TILE = 32;

      // Group project boxes by shelf
      for (const box of map.projectBoxes) {
        const shelf = box.shelf;
        const sx = shelf.tileX * TILE;
        const sy = shelf.tileY * TILE;

        // Draw Wooden/Metal Shelving
        ctx.fillStyle = '#4A5568';
        ctx.fillRect(sx, sy, TILE, TILE * 2);
        ctx.strokeStyle = '#2D3748';
        ctx.lineWidth = 2;
        ctx.strokeRect(sx, sy, TILE, TILE * 2);

        // Shelf divider bar
        ctx.fillStyle = '#718096';
        ctx.fillRect(sx, sy + TILE - 2, TILE, 4);

        // Draw the Project Box on the shelf
        const proj = box.project;
        const isDeployed = proj.deployed === true;
        const boxColor = isDeployed ? '#38A169' : '#DD6B20'; // Green for deployed, warm amber for development

        const bx = sx + 4;
        const by = sy + 6;
        const bw = TILE - 8;
        const bh = 20;

        // Box shadow
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(bx + 2, by + 2, bw, bh);

        // Cardboard box body
        ctx.fillStyle = '#D2B48C';
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = '#8B5A2B';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, by, bw, bh);

        // Colored status tape
        ctx.fillStyle = boxColor;
        ctx.fillRect(bx + 4, by, 6, bh);

        // Project label tag
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(bx + 11, by + 4, 10, 11);
        ctx.strokeStyle = '#718096';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(bx + 11, by + 4, 10, 11);

        // Short project name on tag
        ctx.fillStyle = '#1A202C';
        ctx.font = 'bold 6px sans-serif';
        const initial = (proj.name || 'P').substring(0, 2);
        ctx.fillText(initial, bx + 12, by + 12);
      }
    }

    // -------------------------------------------------------------------------
    // Among Us style Avatar Rendering with Offscreen Caching
    // -------------------------------------------------------------------------
    renderAvatar(ctx, x, y, options) {
      // options: { color, hat, face, trail, frame, facing, isMoving, isSitting, isTyping, papers, scale }
      const colorKey = options.color || 'coral';
      const hatKey = options.hat || 'none';
      const faceKey = options.face || 'classic';
      const frame = options.frame || 0; // 0 or 1 for walk cycle
      const facing = options.facing !== undefined ? options.facing : 1; // 1 = right, -1 = left
      const isSitting = options.isSitting || false;
      const papers = options.papers || false;
      const scale = options.scale || 1.0;

      ctx.save();
      if (options.alpha !== undefined) {
        ctx.globalAlpha = Math.max(0, Math.min(1, options.alpha));
      }
      ctx.translate(x, y);

      // Offset drop shadow (no blur)
      ctx.fillStyle = 'rgba(20, 25, 35, 0.28)';
      ctx.beginPath();
      ctx.ellipse(0, 14 * scale, 12 * scale, 6 * scale, 0, 0, Math.PI * 2);
      ctx.fill();

      // Bobbing during walk cycle
      const bob = options.isMoving ? (frame === 1 ? -2 * scale : 0) : 0;
      ctx.translate(0, bob);

      // Facing horizontal flip
      ctx.scale(facing, 1);
      ctx.scale(scale, scale);

      const pal = resolveColor(colorKey);

      // 1. Oxygen Tank / Backpack (drawn behind main body when facing sideways)
      ctx.fillStyle = pal.dark;
      ctx.strokeStyle = '#22252A';
      ctx.lineWidth = 2.5;
      this.drawRoundedRect(ctx, -14, -6, 7, 18, 3, true, true);

      // 2. Tiny Feet (2-frame cycle)
      ctx.fillStyle = pal.dark;
      if (!isSitting) {
        if (frame === 0) {
          // Left foot forward, right foot back
          this.drawRoundedRect(ctx, -7, 8, 6, 8, 3, true, true);
          this.drawRoundedRect(ctx, 2, 9, 6, 7, 3, true, true);
        } else {
          // Right foot forward, left foot back
          this.drawRoundedRect(ctx, -7, 9, 6, 7, 3, true, true);
          this.drawRoundedRect(ctx, 2, 8, 6, 8, 3, true, true);
        }
      } else {
        // Tucked feet when sitting
        this.drawRoundedRect(ctx, -5, 8, 10, 5, 2, true, true);
      }

      // 3. Main Capsule / Blob Body
      ctx.fillStyle = pal.fill;
      ctx.strokeStyle = '#22252A';
      ctx.lineWidth = 2.5;
      this.drawCapsuleBody(ctx, -10, -16, 20, 26);

      // Body highlight curve
      ctx.strokeStyle = pal.highlight;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(-2, -10, 6, Math.PI * 0.9, Math.PI * 1.5);
      ctx.stroke();

      // 4. Visor / Face
      this.drawVisor(ctx, 0, -10, faceKey);

      // 5. Hat
      if (hatKey && hatKey !== 'none') {
        this.drawHat(ctx, hatKey);
      }

      // 6. Carrying Papers sprite
      if (papers) {
        this.drawPapersStack(ctx, 4, 0);
      }

      ctx.restore();
    }

    drawCapsuleBody(ctx, x, y, w, h) {
      const r = w / 2;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, 6);
      ctx.arcTo(x, y + h, x, y, 6);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    drawRoundedRect(ctx, x, y, w, h, r, fill, stroke) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      if (fill) ctx.fill();
      if (stroke) ctx.stroke();
    }

    drawVisor(ctx, vx, vy, faceType) {
      // Visor pill
      const vw = 13;
      const vh = 9;
      ctx.fillStyle = '#68D8D6';
      ctx.strokeStyle = '#22252A';
      ctx.lineWidth = 2;
      this.drawRoundedRect(ctx, vx, vy, vw, vh, 4, true, true);

      // Visor reflection shine
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.ellipse(vx + 3, vy + 2.5, 3, 1.2, -0.2, 0, Math.PI * 2);
      ctx.fill();

      // Face specifics
      if (faceType === 'glasses') {
        ctx.strokeStyle = '#1A202C';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(vx + 1, vy + 1, 5, 6);
        ctx.strokeRect(vx + 7, vy + 1, 5, 6);
        ctx.beginPath();
        ctx.moveTo(vx + 6, vy + 3);
        ctx.lineTo(vx + 7, vy + 3);
        ctx.stroke();
      } else if (faceType === 'blush') {
        ctx.fillStyle = 'rgba(255, 94, 126, 0.65)';
        ctx.beginPath();
        ctx.ellipse(vx + 2, vy + 6, 2, 1, 0, 0, Math.PI * 2);
        ctx.ellipse(vx + 9, vy + 6, 2, 1, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (faceType === 'cyborg') {
        ctx.fillStyle = '#E53E3E';
        ctx.fillRect(vx + 7, vy + 3, 4, 3);
        ctx.fillStyle = '#FC8181';
        ctx.fillRect(vx + 8, vy + 4, 2, 1);
      }
    }

    drawHat(ctx, hatType) {
      ctx.save();
      ctx.strokeStyle = '#22252A';
      ctx.lineWidth = 2;

      switch (hatType) {
        case 'cap':
          // Ball cap
          ctx.fillStyle = '#E53E3E';
          this.drawRoundedRect(ctx, -10, -21, 18, 7, 3, true, true);
          // Brim
          ctx.fillStyle = '#C53030';
          this.drawRoundedRect(ctx, 2, -17, 10, 4, 2, true, true);
          break;

        case 'beanie':
          // Knit beanie with pompom
          ctx.fillStyle = '#DD6B20';
          this.drawRoundedRect(ctx, -9, -23, 17, 9, 4, true, true);
          // Fold
          ctx.fillStyle = '#C05621';
          this.drawRoundedRect(ctx, -10, -17, 19, 4, 2, true, true);
          // Pompom
          ctx.fillStyle = '#FBD38D';
          ctx.beginPath();
          ctx.arc(-1, -24, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;

        case 'crown':
          // Golden crown
          ctx.fillStyle = '#ECC94B';
          ctx.beginPath();
          ctx.moveTo(-9, -16);
          ctx.lineTo(-9, -23);
          ctx.lineTo(-5, -19);
          ctx.lineTo(0, -24);
          ctx.lineTo(5, -19);
          ctx.lineTo(9, -23);
          ctx.lineTo(9, -16);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          // Jewels
          ctx.fillStyle = '#E53E3E';
          ctx.beginPath();
          ctx.arc(0, -18, 1.5, 0, Math.PI * 2);
          ctx.fill();
          break;

        case 'hard-hat':
          // Construction helmet
          ctx.fillStyle = '#ECC94B';
          this.drawRoundedRect(ctx, -10, -23, 19, 9, 5, true, true);
          ctx.fillStyle = '#D69E2E';
          this.drawRoundedRect(ctx, -12, -16, 23, 4, 2, true, true);
          break;

        case 'wizard':
          // Wizard cone hat
          ctx.fillStyle = '#805AD5';
          ctx.beginPath();
          ctx.moveTo(-11, -16);
          ctx.lineTo(1, -29);
          ctx.lineTo(11, -16);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          // Yellow stars
          ctx.fillStyle = '#ECC94B';
          ctx.beginPath();
          ctx.arc(0, -21, 2, 0, Math.PI * 2);
          ctx.fill();
          break;

        case 'halo':
          // Floating golden halo
          ctx.fillStyle = 'rgba(255, 230, 100, 0.4)';
          ctx.strokeStyle = '#ECC94B';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.ellipse(0, -23, 10, 3.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;

        case 'bow':
          // Red ribbon bow
          ctx.fillStyle = '#E53E3E';
          ctx.beginPath();
          ctx.moveTo(0, -18);
          ctx.lineTo(-7, -22);
          ctx.lineTo(-7, -14);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(0, -18);
          ctx.lineTo(7, -22);
          ctx.lineTo(7, -14);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#9B2C2C';
          ctx.beginPath();
          ctx.arc(0, -18, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;

        case 'headphones':
          // Over-ear headphones (OpenCode)
          ctx.strokeStyle = '#2D3748';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, -14, 11, Math.PI * 0.9, Math.PI * 2.1);
          ctx.stroke();
          // Earcups
          ctx.fillStyle = '#4FD1C5';
          this.drawRoundedRect(ctx, -12, -15, 4, 8, 2, true, true);
          this.drawRoundedRect(ctx, 8, -15, 4, 8, 2, true, true);
          break;

        case 'beret':
          // French artist beret (Claude-Code)
          ctx.fillStyle = '#C53030';
          ctx.beginPath();
          ctx.ellipse(0, -18, 12, 5, -0.15, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // Stem
          ctx.beginPath();
          ctx.moveTo(0, -22);
          ctx.lineTo(1, -25);
          ctx.stroke();
          break;

        case 'antenna':
          // Robot antenna (Antigravity)
          ctx.strokeStyle = '#4A5568';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(0, -16);
          ctx.lineTo(0, -25);
          ctx.stroke();
          // Glowing orb
          ctx.fillStyle = '#63B3ED';
          ctx.beginPath();
          ctx.arc(0, -26, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;

        case 'headset':
          // Front desk headset (C6)
          ctx.strokeStyle = '#2D3748';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(0, -15, 10, Math.PI * 0.8, Math.PI * 2);
          ctx.stroke();
          // Earpiece & boom mic
          ctx.fillStyle = '#ECC94B';
          this.drawRoundedRect(ctx, -11, -15, 3, 6, 1, true, true);
          ctx.strokeStyle = '#2D3748';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(-10, -12);
          ctx.lineTo(-4, -6);
          ctx.stroke();
          break;
      }

      ctx.restore();
    }

    drawPapersStack(ctx, x, y) {
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#718096';
      ctx.lineWidth = 1;

      for (let i = 0; i < 3; i++) {
        ctx.fillRect(x + i, y + i * 2, 8, 10);
        ctx.strokeRect(x + i, y + i * 2, 8, 10);
      }
    }

    // -------------------------------------------------------------------------
    // Name Tags & Speech Bubbles
    // -------------------------------------------------------------------------
    renderNameTag(ctx, x, y, name, color = '#FFFFFF', alpha = 1.0) {
      ctx.save();
      if (alpha !== undefined && alpha !== 1.0) {
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      }
      ctx.font = 'bold 9px "Segoe UI Rounded", "Nunito", sans-serif';
      ctx.textAlign = 'center';
      const text = (name || 'Visitor').substring(0, 16);
      const metrics = ctx.measureText(text);
      const tw = metrics.width + 10;
      const th = 14;

      // Dark background pill
      ctx.fillStyle = 'rgba(23, 25, 35, 0.78)';
      this.drawRoundedRect(ctx, x - tw / 2, y - 32, tw, th, 4, true, false);

      ctx.fillStyle = color;
      ctx.fillText(text, x, y - 22);
      ctx.restore();
    }

    renderSpeechBubble(ctx, x, y, text, progress = 1.0) {
      if (!text) return;
      ctx.save();

      const typedCount = Math.floor(text.length * progress);
      const displayText = text.substring(0, typedCount);

      ctx.font = 'bold 11px "Segoe UI Rounded", "Nunito", sans-serif';
      const metrics = ctx.measureText(text);
      const bw = Math.max(50, metrics.width + 18);
      const bh = 24;
      const bx = x - bw / 2;
      const by = y - 48;

      // Drop shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      this.drawRoundedRect(ctx, bx + 2, by + 2, bw, bh, 6, true, false);

      // Bubble body
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#22252A';
      ctx.lineWidth = 2;
      this.drawRoundedRect(ctx, bx, by, bw, bh, 6, true, true);

      // Tail pointing down
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(x - 5, by + bh);
      ctx.lineTo(x, by + bh + 6);
      ctx.lineTo(x + 5, by + bh);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Fix internal tail seam
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x - 4, by + bh - 2, 8, 3);

      // Text inside
      ctx.fillStyle = '#1A202C';
      ctx.textAlign = 'center';
      ctx.fillText(displayText, x, by + 16);

      ctx.restore();
    }
  }

  global.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : global);
