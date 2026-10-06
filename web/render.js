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
      this.vistaCanvas = null;
      this.vistaDirty = true;
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
    // Mountain Vista Pre-Rendering & Architectural Windows
    // -------------------------------------------------------------------------
    bakeMountainVista(map) {
      if (typeof document === 'undefined') return;
      const TILE = map.tile || 32;
      const mapW = map.width * TILE;
      const mapH = map.height * TILE;

      if (!this.vistaCanvas) {
        this.vistaCanvas = document.createElement('canvas');
      }
      this.vistaCanvas.width = mapW;
      this.vistaCanvas.height = mapH;
      const ctx = this.vistaCanvas.getContext('2d');
      ctx.clearRect(0, 0, mapW, mapH);

      // 1. Sky & Distant Mountain Peaks (North Vista & Sky Canopy)
      const skyGrad = ctx.createLinearGradient(0, 0, 0, 260);
      skyGrad.addColorStop(0.0, '#232738'); // Deep twilight slate-periwinkle
      skyGrad.addColorStop(0.35, '#3E3B5C'); // Lavender twilight
      skyGrad.addColorStop(0.65, '#6B4D68'); // Dusty rose
      skyGrad.addColorStop(0.85, '#B86858'); // Sunset terracotta
      skyGrad.addColorStop(1.0, '#F4B37D');  // Golden horizon haze
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, mapW, 260);

      // Wispy Cirrus Clouds
      ctx.fillStyle = 'rgba(255, 230, 210, 0.18)';
      ctx.beginPath();
      ctx.ellipse(mapW * 0.22, 38, 170, 13, -0.05, 0, Math.PI * 2);
      ctx.ellipse(mapW * 0.72, 62, 210, 15, 0.04, 0, Math.PI * 2);
      ctx.ellipse(mapW * 0.45, 90, 140, 11, -0.02, 0, Math.PI * 2);
      ctx.fill();

      // Peak Layer 1 (Furthest Snowy Crests)
      ctx.fillStyle = '#31334E';
      ctx.beginPath();
      const p1 = [
        { x: 0, y: 130 }, { x: 120, y: 65 }, { x: 220, y: 110 }, { x: 380, y: 45 },
        { x: 510, y: 105 }, { x: 670, y: 40 }, { x: 800, y: 95 }, { x: 960, y: 55 },
        { x: 1120, y: 110 }, { x: 1260, y: 50 }, { x: mapW, y: 100 }, { x: mapW, y: 260 }, { x: 0, y: 260 }
      ];
      ctx.moveTo(p1[0].x, p1[0].y);
      p1.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.fill();

      // Snow / Quartz Peak Highlights
      ctx.strokeStyle = 'rgba(215, 205, 235, 0.45)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      p1.forEach(p => {
        if (p.y < 85) {
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - 18, p.y + 24);
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + 14, p.y + 20);
        }
      });
      ctx.stroke();

      // Peak Layer 2 (Mid Massif)
      ctx.fillStyle = '#252D42';
      ctx.beginPath();
      const p2 = [
        { x: 0, y: 160 }, { x: 180, y: 95 }, { x: 340, y: 145 }, { x: 560, y: 80 },
        { x: 740, y: 135 }, { x: 890, y: 85 }, { x: 1080, y: 125 }, { x: 1280, y: 75 },
        { x: mapW, y: 120 }, { x: mapW, y: 260 }, { x: 0, y: 260 }
      ];
      ctx.moveTo(p2[0].x, p2[0].y);
      p2.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.fill();

      // Peak Layer 3 (Pine Spire Ridge)
      ctx.fillStyle = '#1D2633';
      ctx.beginPath();
      ctx.moveTo(0, 185);
      for (let x = 0; x <= mapW; x += 16) {
        const ridgeY = 150 + Math.sin(x * 0.015) * 18;
        ctx.lineTo(x, ridgeY);
        ctx.lineTo(x + 5, ridgeY - 9);
        ctx.lineTo(x + 10, ridgeY);
      }
      ctx.lineTo(mapW, 260);
      ctx.lineTo(0, 260);
      ctx.closePath();
      ctx.fill();

      // Atmospheric Valley Mist
      const mistGrad = ctx.createLinearGradient(0, 130, 0, 190);
      mistGrad.addColorStop(0, 'rgba(180, 195, 215, 0.0)');
      mistGrad.addColorStop(0.5, 'rgba(180, 195, 215, 0.35)');
      mistGrad.addColorStop(1, 'rgba(180, 195, 215, 0.0)');
      ctx.fillStyle = mistGrad;
      ctx.fillRect(0, 130, mapW, 60);

      // 2. Base Ground Terrain for Outside Voids
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (map.getTile(x, y) === 0) {
            const px = x * TILE;
            const py = y * TILE;
            let groundColor = '#1C2E24';
            if (x <= 16 && y >= 22) {
              groundColor = '#243A2C'; // Southwest sanctuary: lush meadow
            } else if (x >= 27 && x <= 29 && y >= 22 && y <= 34) {
              groundColor = '#262B34'; // Central ravine: rock bed
            } else if (y < 2) {
              groundColor = '#1D2A26'; // North vista foreground
            }
            ctx.fillStyle = groundColor;
            ctx.fillRect(px, py, TILE, TILE);

            if ((x * 19 + y * 31) % 4 === 1) {
              ctx.fillStyle = 'rgba(70, 110, 80, 0.18)';
              ctx.fillRect(px + 4, py + 8, 3, 6);
              ctx.fillRect(px + 18, py + 14, 3, 5);
            }
          }
        }
      }

      // 3. Central Ravine Cascading Brook (x: 27..29, y: 22..34)
      const ravineX = 27 * TILE;
      const ravineY = 22 * TILE;
      const ravineW = 3 * TILE;
      const ravineH = 13 * TILE;
      ctx.fillStyle = '#222830';
      ctx.fillRect(ravineX, ravineY, ravineW, ravineH);

      ctx.fillStyle = '#23586C';
      ctx.fillRect(ravineX + 16, ravineY, ravineW - 32, ravineH);
      ctx.strokeStyle = 'rgba(180, 230, 245, 0.45)';
      ctx.lineWidth = 1.5;
      for (let ry = ravineY + 10; ry < ravineY + ravineH; ry += 24) {
        ctx.beginPath();
        ctx.moveTo(ravineX + 20, ry);
        ctx.lineTo(ravineX + ravineW - 20, ry + 3);
        ctx.stroke();
      }
      for (let i = 0; i < 7; i++) {
        const bx = ravineX + 16 + (i % 2) * 36 + ((i * 17) % 18);
        const by = ravineY + 20 + i * 50;
        ctx.fillStyle = '#3A404A';
        ctx.beginPath();
        ctx.arc(bx, by, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2D4E39';
        ctx.beginPath();
        ctx.arc(bx, by - 2, 4, 0, Math.PI);
        ctx.fill();
      }

      // 4. Southwest Sanctuary: Alpine Tarn (Mountain Lake)
      const lakeCx = 8 * TILE;
      const lakeCy = 30 * TILE;
      const lakeRx = 190;
      const lakeRy = 120;
      const lakeGrad = ctx.createRadialGradient(lakeCx, lakeCy, 15, lakeCx, lakeCy, lakeRx);
      lakeGrad.addColorStop(0.0, '#0F2432');
      lakeGrad.addColorStop(0.55, '#1B4456');
      lakeGrad.addColorStop(0.85, '#2C6B7E');
      lakeGrad.addColorStop(1.0, '#1E4A3E');

      ctx.save();
      ctx.beginPath();
      const lakeSteps = 36;
      for (let i = 0; i <= lakeSteps; i++) {
        const angle = (i / lakeSteps) * Math.PI * 2;
        const wobble = 1.0 + Math.sin(angle * 3) * 0.07 + Math.cos(angle * 5) * 0.04;
        const px = lakeCx + Math.cos(angle) * lakeRx * wobble;
        const py = lakeCy + Math.sin(angle) * lakeRy * wobble;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = lakeGrad;
      ctx.fill();

      ctx.strokeStyle = '#3F584C';
      ctx.lineWidth = 3;
      ctx.stroke();

      const reflGrad = ctx.createLinearGradient(lakeCx - lakeRx, lakeCy - lakeRy, lakeCx + lakeRx, lakeCy + lakeRy);
      reflGrad.addColorStop(0.2, 'rgba(215, 150, 120, 0.25)');
      reflGrad.addColorStop(0.8, 'rgba(35, 55, 75, 0.30)');
      ctx.fillStyle = reflGrad;
      ctx.fill();

      ctx.strokeStyle = 'rgba(180, 235, 245, 0.28)';
      ctx.lineWidth = 1.2;
      for (let dy = -lakeRy + 20; dy < lakeRy - 15; dy += 18) {
        const chordLen = Math.sqrt(Math.max(0, 1 - (dy / lakeRy) ** 2)) * lakeRx * 0.72;
        ctx.beginPath();
        ctx.moveTo(lakeCx - chordLen + 15, lakeCy + dy);
        ctx.lineTo(lakeCx + chordLen - 15, lakeCy + dy);
        ctx.stroke();
      }

      const shoreRocks = [
        { x: lakeCx - lakeRx * 0.72, y: lakeCy + lakeRy * 0.40, r: 9 },
        { x: lakeCx - lakeRx * 0.45, y: lakeCy + lakeRy * 0.68, r: 7 },
        { x: lakeCx + lakeRx * 0.62, y: lakeCy - lakeRy * 0.32, r: 10 },
        { x: lakeCx + lakeRx * 0.42, y: lakeCy + lakeRy * 0.52, r: 8 },
        { x: lakeCx - 10, y: lakeCy + lakeRy * 0.85, r: 6 }
      ];
      shoreRocks.forEach(rk => {
        ctx.fillStyle = '#3E434D';
        ctx.beginPath();
        ctx.arc(rk.x, rk.y, rk.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#616978';
        ctx.beginPath();
        ctx.arc(rk.x - 2, rk.y - 2, rk.r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.fillStyle = '#265C3E';
      [
        { x: lakeCx - 40, y: lakeCy - 20, r: 5 },
        { x: lakeCx - 55, y: lakeCy - 12, r: 4 },
        { x: lakeCx + 60, y: lakeCy + 25, r: 6 },
        { x: lakeCx + 75, y: lakeCy + 15, r: 5 }
      ].forEach(lp => {
        ctx.beginPath();
        ctx.arc(lp.x, lp.y, lp.r, 0.2, Math.PI * 1.8);
        ctx.fill();
      });
      ctx.restore();

      // Wildflowers across southwest meadow
      const flowerColors = ['#FFE28A', '#F28B66', '#FFFFFF', '#ECC94B'];
      for (let i = 0; i < 45; i++) {
        const fx = 20 + ((i * 37) % 500);
        const fy = 23 * TILE + ((i * 59) % (16 * TILE));
        const distToLake = Math.hypot(fx - lakeCx, fy - lakeCy);
        if (distToLake > 140) {
          ctx.fillStyle = flowerColors[i % flowerColors.length];
          ctx.beginPath();
          ctx.arc(fx, fy, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 5. Wooden Observation Decks
      // Deck A: South of Break Room (y = 23, x: 2..12)
      this.drawObservationDeck(ctx, 2 * TILE, 23 * TILE, 11 * TILE, TILE);
      // Deck B: South of Trading Floor (y = 35, x: 31..41)
      this.drawObservationDeck(ctx, 31 * TILE, 35 * TILE, 11 * TILE, TILE);

      // 6. Foundation Retaining Wall & Cliff Ledges around Building
      this.drawRetainingWallsAndCliffLedges(ctx, map);

      // 7. Multi-Tier Conifer / Pine Trees
      const pinePositions = [
        // North Vista slope
        { x: 2 * TILE + 16, y: 0.8 * TILE, s: 0.95 },
        { x: 9 * TILE, y: 0.5 * TILE, s: 0.85 },
        { x: 15 * TILE, y: 0.7 * TILE, s: 0.90 },
        { x: 27 * TILE, y: 0.6 * TILE, s: 0.90 },
        { x: 33 * TILE, y: 0.8 * TILE, s: 0.95 },
        { x: 41 * TILE, y: 0.6 * TILE, s: 0.85 },
        // West hillside
        { x: 0.4 * TILE, y: 3 * TILE, s: 0.9 },
        { x: 0.3 * TILE, y: 7 * TILE, s: 0.85 },
        { x: 0.5 * TILE, y: 11 * TILE, s: 0.95 },
        { x: 0.4 * TILE, y: 16 * TILE, s: 0.9 },
        { x: 0.5 * TILE, y: 20 * TILE, s: 0.85 },
        // Southwest Lake surroundings
        { x: 2 * TILE, y: 26 * TILE, s: 1.1 },
        { x: 14 * TILE, y: 25 * TILE, s: 1.05 },
        { x: 3 * TILE, y: 35 * TILE, s: 1.15 },
        { x: 13 * TILE, y: 37 * TILE, s: 1.1 },
        { x: 7 * TILE, y: 38 * TILE, s: 1.0 },
        // East Margin
        { x: 43.4 * TILE, y: 3 * TILE, s: 0.9 },
        { x: 43.3 * TILE, y: 9 * TILE, s: 0.85 },
        { x: 43.5 * TILE, y: 15 * TILE, s: 0.95 },
        { x: 43.4 * TILE, y: 24 * TILE, s: 1.0 },
        { x: 43.3 * TILE, y: 30 * TILE, s: 0.9 }
      ];
      pinePositions.forEach(p => {
        this.drawPineTree(ctx, p.x, p.y, p.s);
      });

      this.vistaDirty = false;
    }

    drawObservationDeck(ctx, x, y, w, h) {
      ctx.fillStyle = '#634533';
      ctx.fillRect(x, y, w, h);

      ctx.fillStyle = '#855F47';
      for (let px = x; px < x + w; px += 32) {
        ctx.fillRect(px, y, 31, 2);
      }
      ctx.strokeStyle = '#3E2A1E';
      ctx.lineWidth = 1;
      for (let px = x; px <= x + w; px += 32) {
        ctx.beginPath();
        ctx.moveTo(px, y);
        ctx.lineTo(px, y + h);
        ctx.stroke();
      }

      ctx.fillStyle = '#4E3526';
      ctx.fillRect(x, y + h - 6, w, 2.5);
      ctx.fillRect(x, y + h - 12, w, 1.5);

      for (let px = x; px <= x + w; px += 32) {
        ctx.fillStyle = '#704D37';
        ctx.fillRect(px - 1.5, y + h - 14, 3, 14);
        ctx.fillStyle = '#38251A';
        ctx.fillRect(px - 1.5, y + h - 14, 1, 14);
      }
    }

    drawPineTree(ctx, x, y, scale = 1.0) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);

      ctx.fillStyle = 'rgba(15, 25, 20, 0.4)';
      ctx.beginPath();
      ctx.ellipse(0, 14, 14, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#3A2D23';
      ctx.fillRect(-2.5, 4, 5, 10);

      const tiers = [
        { y: 6, w: 28, h: 14, cBase: '#1B3E32', cHi: '#2D6653' },
        { y: -3, w: 22, h: 12, cBase: '#20473A', cHi: '#347560' },
        { y: -12, w: 16, h: 11, cBase: '#255243', cHi: '#3B846D' },
        { y: -21, w: 9, h: 10, cBase: '#2A5C4C', cHi: '#43947B' }
      ];

      tiers.forEach(t => {
        ctx.fillStyle = t.cBase;
        ctx.beginPath();
        ctx.moveTo(0, t.y - t.h);
        ctx.lineTo(t.w / 2, t.y);
        ctx.lineTo(-t.w / 2, t.y);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = t.cHi;
        ctx.beginPath();
        ctx.moveTo(0, t.y - t.h);
        ctx.lineTo(0, t.y);
        ctx.lineTo(t.w / 2, t.y);
        ctx.closePath();
        ctx.fill();
      });

      ctx.restore();
    }

    drawRetainingWallsAndCliffLedges(ctx, map) {
      const TILE = map.tile || 32;

      ctx.fillStyle = '#383D48';
      for (let x = 1; x <= 42; x++) {
        const px = x * TILE;
        ctx.fillRect(px, 1 * TILE - 4, TILE, 4);
        ctx.fillStyle = '#1B1D22';
        ctx.fillRect(px + TILE - 1, 1 * TILE - 4, 1, 4);
        if (x % 4 === 0) {
          ctx.fillStyle = '#2E4D38';
          ctx.fillRect(px + 4, 1 * TILE - 3, 6, 2);
        }
        ctx.fillStyle = '#383D48';
      }

      for (let y = 1; y <= 22; y++) {
        const py = y * TILE;
        ctx.fillRect(1 * TILE - 4, py, 4, TILE);
        ctx.fillStyle = '#1B1D22';
        ctx.fillRect(1 * TILE - 4, py + TILE - 1, 4, 1);
        ctx.fillStyle = '#383D48';
      }

      for (let y = 1; y <= 34; y++) {
        const py = y * TILE;
        ctx.fillRect(43 * TILE, py, 4, TILE);
        ctx.fillStyle = '#1B1D22';
        ctx.fillRect(43 * TILE, py + TILE - 1, 4, 1);
        ctx.fillStyle = '#383D48';
      }

      const cliffEdges = [
        { x0: 0, y0: 0, x1: map.width * TILE, y1: 8, dir: 'h' },
        { x0: 0, y0: 0, x1: 8, y1: 23 * TILE, dir: 'v' },
        { x0: 0, y0: (map.height - 1) * TILE + 24, x1: map.width * TILE, y1: 8, dir: 'h' },
        { x0: 43.6 * TILE, y0: 0, x1: 8, y1: map.height * TILE, dir: 'v' }
      ];

      cliffEdges.forEach(ce => {
        ctx.fillStyle = '#484E5B';
        ctx.fillRect(ce.x0, ce.y0, ce.x1, ce.y1);
        ctx.fillStyle = '#717B8F';
        ctx.fillRect(ce.x0, ce.y0, ce.x1, 1.5);
        ctx.fillStyle = 'rgba(23, 25, 30, 0.45)';
        if (ce.dir === 'h') {
          ctx.fillRect(ce.x0, ce.y0 + ce.y1, ce.x1, 6);
        } else {
          ctx.fillRect(ce.x0 + ce.x1, ce.y0, 6, ce.y1);
        }
      });
    }

    drawAnimatedVistaAccents(ctx) {
      const now = Date.now();

      // 1. Lake water sparkles (6 pulsing diamond glints)
      const lakeCx = 8 * 32;
      const lakeCy = 30 * 32;
      const glints = [
        { dx: -55, dy: -25 },
        { dx: 45, dy: -15 },
        { dx: -20, dy: 35 },
        { dx: 70, dy: 18 },
        { dx: -70, dy: 10 },
        { dx: 15, dy: -45 }
      ];

      glints.forEach((g, i) => {
        const pulse = 0.35 + 0.35 * Math.sin(now * 0.003 + i * 1.3);
        if (pulse > 0.05) {
          const gx = lakeCx + g.dx;
          const gy = lakeCy + g.dy;
          const r = 2.0;
          ctx.fillStyle = `rgba(255, 250, 230, ${pulse.toFixed(2)})`;
          ctx.beginPath();
          ctx.moveTo(gx, gy - r);
          ctx.lineTo(gx + r, gy);
          ctx.lineTo(gx, gy + r);
          ctx.lineTo(gx - r, gy);
          ctx.closePath();
          ctx.fill();
        }
      });

      // 2. Valley mist wisps (subtle drifting ambient fog)
      const mistDrift = (now * 0.008) % (44 * 32);
      ctx.fillStyle = 'rgba(200, 215, 235, 0.06)';
      ctx.beginPath();
      ctx.ellipse(mistDrift, 160, 180, 22, 0.02, 0, Math.PI * 2);
      ctx.fill();

      const ravineDriftY = 22 * 32 + ((now * 0.006) % (12 * 32));
      ctx.beginPath();
      ctx.ellipse(28.5 * 32, ravineDriftY, 40, 16, 0.05, 0, Math.PI * 2);
      ctx.fill();
    }

    drawArchitecturalWindow(ctx, px, py, TILE, map) {
      const tx = Math.floor(px / TILE);
      const ty = Math.floor(py / TILE);
      const leftTile = map.getTile(tx - 1, ty);
      const rightTile = map.getTile(tx + 1, ty);
      const isHorizontal = (leftTile === 10 || leftTile === 15 || rightTile === 10 || rightTile === 15);

      ctx.save();

      // Outer timber frame borders (drawn as hollow casing around glass opening)
      const inset = 3;
      const gx = px + inset;
      const gy = py + inset;
      const gw = TILE - inset * 2;
      const gh = TILE - inset * 2;

      ctx.fillStyle = '#382A20';
      ctx.fillRect(px, py, TILE, inset); // top border
      ctx.fillRect(px, py + TILE - inset, TILE, inset); // bottom border
      ctx.fillRect(px, py, inset, TILE); // left border
      ctx.fillRect(px + TILE - inset, py, inset, TILE); // right border

      // Glass base tint (clean mountain glass tint)
      ctx.fillStyle = 'rgba(180, 220, 240, 0.12)';
      ctx.fillRect(gx, gy, gw, gh);

      // 45-degree daylight reflection sheen streak
      const glare = ctx.createLinearGradient(gx, gy, gx + gw, gy + gh);
      glare.addColorStop(0.0, 'rgba(255, 255, 255, 0.0)');
      glare.addColorStop(0.35, 'rgba(255, 255, 255, 0.18)');
      glare.addColorStop(0.50, 'rgba(255, 255, 255, 0.0)');
      ctx.fillStyle = glare;
      ctx.fillRect(gx, gy, gw, gh);

      // Wooden window sill ledge
      ctx.fillStyle = '#6E4F39';
      ctx.fillRect(px, py + TILE - 4, TILE, 4);
      ctx.fillStyle = '#936B4E';
      ctx.fillRect(px, py + TILE - 4, TILE, 1.2);
      ctx.fillStyle = 'rgba(20, 15, 10, 0.3)';
      ctx.fillRect(px, py + TILE, TILE, 2.5);

      // Mullion divider bars
      ctx.fillStyle = '#382A20';
      if (isHorizontal) {
        ctx.fillRect(px + Math.floor(TILE / 2) - 1, gy, 2, gh - 1);
        ctx.fillRect(gx, py + 9, gw, 1.5);
      } else {
        ctx.fillRect(gx, py + Math.floor(TILE / 2) - 1, gw, 2);
      }

      // Outer frame border highlight
      ctx.strokeStyle = '#584333';
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);

      ctx.restore();
    }

    // -------------------------------------------------------------------------
    // Map rendering
    // -------------------------------------------------------------------------
    renderMap(map, camera, liveData) {
      const ctx = this.ctx;
      const TILE = map.tile;
      const zoom = (camera && camera.zoom) ? camera.zoom : 1.0;
      const visibleW = camera.width / zoom;
      const visibleH = camera.height / zoom;
      const x0 = Math.max(0, Math.floor(camera.x / TILE));
      const y0 = Math.max(0, Math.floor(camera.y / TILE));
      const x1 = Math.min(map.width - 1, Math.ceil((camera.x + visibleW) / TILE));
      const y1 = Math.min(map.height - 1, Math.ceil((camera.y + visibleH) / TILE));

      // Pass 1: Blit Pre-Rendered Mountain Vista
      if (!this.vistaCanvas || this.vistaDirty) {
        this.bakeMountainVista(map);
      }
      if (this.vistaCanvas) {
        ctx.drawImage(this.vistaCanvas, 0, 0);
      }
      // Pass 1b: Lightweight Animated Vista Accents (water sparkles & drifting mist)
      this.drawAnimatedVistaAccents(ctx);

      // Draw Floor Tiles (Pass 2)
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const type = map.getTile(x, y);
          const px = x * TILE;
          const py = y * TILE;

          if (type === 0 || type === 10 || type === 15) {
            // Void outside or wall/window - handled in separate layers
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
          } else if (type === 4) { // Antigravity / Gemini
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
          } else if (type === 8) { // Trading Floor
            floorBase = '#162C2E'; // Dark teal trading floor
            floorAccent = '#213E42';
          }

          ctx.fillStyle = floorBase;
          ctx.fillRect(px, py, TILE, TILE);

          // Subtle tile grid pattern
          ctx.strokeStyle = floorAccent;
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);

          // Subtle wood-grain / tile procedural variation (2-3 variants per room)
          const grainVariant = (x * 37 + y * 59) % 3;
          if (grainVariant === 1) {
            ctx.strokeStyle = floorAccent;
            ctx.lineWidth = 0.75;
            ctx.beginPath();
            ctx.moveTo(px + 2, py + TILE / 2);
            ctx.lineTo(px + TILE - 2, py + TILE / 2);
            ctx.stroke();
          } else if (grainVariant === 2) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.03)';
            ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
          }
        }
      }

      // Draw Rugs & Accents
      this.drawLobbyRug(ctx, 18 * TILE, 14 * TILE, 7 * TILE, 4 * TILE);

      // Draw Walls & Architectural Windows (Pass 3)
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const type = map.getTile(x, y);
          const px = x * TILE;
          const py = y * TILE;

          if (type === 10) { // Solid Wall
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
            if (y < map.height - 1 && map.getTile(x, y + 1) !== 10 && map.getTile(x, y + 1) !== 15 && map.getTile(x, y + 1) !== 0) {
              ctx.fillStyle = 'rgba(15, 20, 25, 0.35)';
              ctx.fillRect(px, py + TILE, TILE, 6);
            }
          } else if (type === 15) { // Architectural Window
            this.drawArchitecturalWindow(ctx, px, py, TILE, map);
          }
        }
      }

      // Draw Doors
      for (const door of map.doors) {
        this.drawDoor(ctx, door);
      }

      // Draw Main Status Board on North Wall
      this.drawStatusBoard(ctx, liveData, camera);

      // Draw Trading Floor (Dual CRT screens, floating tickers, desk & trader)
      this.drawTradingFloor(ctx, map, liveData);

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

      // 1. Subtle threshold strip on floor across the doorway
      ctx.fillStyle = '#4A3728';
      if (door.orientation === 'v') {
        ctx.fillRect(-TILE / 2 + 10, -TILE / 2, TILE - 20, TILE);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillRect(-TILE / 2 + 12, -TILE / 2, 2, TILE);
      } else {
        ctx.fillRect(-TILE / 2, -TILE / 2 + 10, TILE, TILE - 20);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillRect(-TILE / 2, -TILE / 2 + 12, TILE, 2);
      }

      // 2. Door Frame Jambs & Lintel (wooden/wall trim casing)
      ctx.fillStyle = '#3E2723';
      ctx.strokeStyle = '#271916';
      ctx.lineWidth = 1.5;

      if (door.orientation === 'v') {
        // Vertical door: top & bottom wall jamb posts
        ctx.fillRect(-TILE / 2 + 2, -TILE / 2 - 2, TILE - 4, 4);
        ctx.strokeRect(-TILE / 2 + 2, -TILE / 2 - 2, TILE - 4, 4);
        ctx.fillRect(-TILE / 2 + 2, TILE / 2 - 2, TILE - 4, 4);
        ctx.strokeRect(-TILE / 2 + 2, TILE / 2 - 2, TILE - 4, 4);

        // Vertical door leaf swing
        const swing = door.open * 24;
        ctx.fillStyle = '#8D6E63';
        ctx.strokeStyle = '#3E2723';
        ctx.lineWidth = 2;
        ctx.fillRect(-4 + swing, -TILE / 2 + 4, 8, TILE - 8);
        ctx.strokeRect(-4 + swing, -TILE / 2 + 4, 8, TILE - 8);
        // Panel recessed groove
        ctx.strokeStyle = '#6D4C41';
        ctx.lineWidth = 1;
        ctx.strokeRect(-2 + swing, -TILE / 2 + 7, 4, TILE - 14);
        // Handle
        ctx.fillStyle = '#FFD54F';
        ctx.beginPath();
        ctx.arc(swing, 0, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFA000';
        ctx.stroke();
      } else {
        // Horizontal door: left & right wall jamb posts + top lintel
        ctx.fillRect(-TILE / 2 - 2, -TILE / 2 + 2, 4, TILE - 4);
        ctx.strokeRect(-TILE / 2 - 2, -TILE / 2 + 2, 4, TILE - 4);
        ctx.fillRect(TILE / 2 - 2, -TILE / 2 + 2, 4, TILE - 4);
        ctx.strokeRect(TILE / 2 - 2, -TILE / 2 + 2, 4, TILE - 4);
        // Top lintel beam
        ctx.fillRect(-TILE / 2 - 3, -TILE / 2 - 2, TILE + 6, 5);
        ctx.strokeRect(-TILE / 2 - 3, -TILE / 2 - 2, TILE + 6, 5);

        // Horizontal door leaf swing
        const swing = door.open * 24;
        ctx.fillStyle = '#8D6E63';
        ctx.strokeStyle = '#3E2723';
        ctx.lineWidth = 2;
        ctx.fillRect(-TILE / 2 + 4, -4 - swing, TILE - 8, 8);
        ctx.strokeRect(-TILE / 2 + 4, -4 - swing, TILE - 8, 8);
        // Panel recessed groove
        ctx.strokeStyle = '#6D4C41';
        ctx.lineWidth = 1;
        ctx.strokeRect(-TILE / 2 + 7, -2 - swing, TILE - 14, 4);
        // Handle
        ctx.fillStyle = '#FFD54F';
        ctx.beginPath();
        ctx.arc(0, -swing, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFA000';
        ctx.stroke();
      }

      ctx.restore();
    }

    // -------------------------------------------------------------------------
    // Reusable CRT Panel Frame Helper
    // -------------------------------------------------------------------------
    renderCRTPanel(ctx, px, py, pw, ph, title, isOnline = true) {
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
      if (title) {
        let fontSize = 9.5;
        ctx.font = `bold ${fontSize}px "Segoe UI Rounded", "Nunito", sans-serif`;
        const maxTitleW = pw - 62;
        while (ctx.measureText(title).width > maxTitleW && fontSize > 6) {
          fontSize -= 0.5;
          ctx.font = `bold ${fontSize}px "Segoe UI Rounded", "Nunito", sans-serif`;
        }
        ctx.fillStyle = '#E6FFFA';
        ctx.fillText(title, px + 8, py + 16);
      }

      // Scanlines
      if (this.scanlineCanvas) {
        ctx.fillStyle = ctx.createPattern(this.scanlineCanvas, 'repeat');
        ctx.fillRect(px + 3, py + 3, pw - 6, ph - 6);
      }
    }

    // -------------------------------------------------------------------------
    // Main Status Board (Dual CRT Displays flanking Claude Door)
    // -------------------------------------------------------------------------
    drawStatusBoard(ctx, liveData, camera) {
      const TILE = 32;
      const zoom = (camera && camera.zoom) ? camera.zoom : 1.0;
      const isScreenSpace = Boolean(camera);

      // World positions on north wall
      const worldLx = 14.6 * TILE;
      const worldLy = 8.6 * TILE;
      const worldLw = 4.8 * TILE;
      const worldLh = 3.2 * TILE;

      const worldRx = 24.1 * TILE;
      const worldRy = 8.6 * TILE;
      const worldRw = 4.8 * TILE;
      const worldRh = 3.2 * TILE;

      ctx.save();
      if (isScreenSpace) {
        ctx.setTransform(1, 0, 0, 1, 0, 0); // 1:1 screen pixels
      }

      const lx = isScreenSpace ? Math.round((worldLx - camera.x) * zoom) : worldLx;
      const ly = isScreenSpace ? Math.round((worldLy - camera.y) * zoom) : worldLy;
      const lw = worldLw;
      const lh = worldLh;

      const rx = isScreenSpace ? Math.round((worldRx - camera.x) * zoom) : worldRx;
      const ry = isScreenSpace ? Math.round((worldRy - camera.y) * zoom) : worldRy;
      const rw = worldRw;
      const rh = worldRh;

      if (camera) {
        const minX = Math.min(lx, rx);
        const maxX = Math.max(lx + lw, rx + rw);
        const minY = Math.min(ly, ry);
        const maxY = Math.max(ly + lh, ry + rh);
        if (maxX < 0 || minX > camera.width || maxY < 0 || minY > camera.height) {
          ctx.restore();
          return;
        }
      }

      const isOnline = liveData && liveData.online !== false;
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];
      const summary = (liveData && liveData.summary) || {};
      const sessions = summary.sessions !== undefined ? summary.sessions : '--';
      const messages = summary.messages !== undefined ? summary.messages : '--';
      const toolCalls = summary.tool_calls !== undefined ? summary.tool_calls : '--';
      let tokens = '--';
      const allTok = (liveData && liveData.allTokens !== undefined && liveData.allTokens !== null)
        ? liveData.allTokens
        : (summary.billed_tokens !== undefined ? summary.billed_tokens : null);
      if (allTok !== null && !isNaN(allTok)) {
        tokens = allTok >= 1000000 ? (allTok / 1000000).toFixed(1) + 'M' : (allTok / 1000).toFixed(0) + 'k';
      }

      const renderPanel = (px, py, pw, ph, title) => {
        this.renderCRTPanel(ctx, px, py, pw, ph, title, isOnline);
      };

      // 1. Left Panel (Overview): Centered over board tiles x:15..19
      renderPanel(lx, ly, lw, lh, 'HYDROCARBON FORGE');

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

      // Lower row: People presence chips (Nathan & Gavin)
      const pres = (liveData && liveData.presence) || {};
      const onlineSet = new Set((pres.online || []).map((p) => (p.profile || '').toLowerCase()));
      const disc = pres.discord || {};

      const nathanInOffice = onlineSet.has('nathan');
      const nathanDisc = disc.nathan && disc.nathan.active;
      const nathanAge = (disc.nathan && typeof disc.nathan.age_minutes === 'number') ? disc.nathan.age_minutes : null;

      const gavinInOffice = onlineSet.has('gavin');
      const gavinDisc = disc.gavin && disc.gavin.active;
      const gavinAge = (disc.gavin && typeof disc.gavin.age_minutes === 'number') ? disc.gavin.age_minutes : null;

      const people = [
        {
          name: 'NATHAN',
          office: nathanInOffice,
          discord: nathanDisc,
          age: nathanAge
        },
        {
          name: 'GAVIN',
          office: gavinInOffice,
          discord: gavinDisc,
          age: gavinAge
        }
      ];

      // Subtle divider
      ctx.fillStyle = 'rgba(56, 178, 172, 0.22)';
      ctx.fillRect(lx + 8, ly + 74, lw - 16, 1);

      // Section label
      ctx.fillStyle = '#718096';
      ctx.font = 'bold 6.5px "Segoe UI Rounded", sans-serif';
      ctx.fillText('PEOPLE PRESENCE', lx + 8, ly + 83);

      people.forEach((person, i) => {
        const pxPos = lx + 8 + i * colW1;
        const pyPos = ly + 93;

        let dotColor = '#718096'; // gray default
        let statusText = 'away';
        if (person.office) {
          dotColor = '#48BB78'; // green = in office now
          statusText = 'in office';
        } else if (person.discord) {
          dotColor = '#ECC94B'; // amber = active on discord
          statusText = person.age !== null ? `${person.age}m dc` : 'discord';
        } else if (person.age !== null && person.age < 120) {
          statusText = `${person.age}m ago`;
        }

        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(pxPos + 3, pyPos, 2.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = 'bold 7px "Segoe UI Rounded", sans-serif';
        ctx.fillStyle = '#E2E8F0';
        ctx.fillText(`${person.name}: `, pxPos + 8, pyPos + 2.5);

        const nameWidth = ctx.measureText(`${person.name}: `).width;
        ctx.fillStyle = dotColor;
        ctx.font = '6.5px monospace';
        ctx.fillText(statusText, pxPos + 8 + nameWidth, pyPos + 2.5);
      });

      // 2. Right Panel (Harness Metrics): Centered over board tiles x:24..28 (center 26.5 * TILE)
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
        { name: 'CLAUDE', color: '#E07A5F', sess: (liveData && liveData.claudecode && liveData.claudecode.sessions) || 9 },
        { name: 'GEMINI', color: '#3D5A80', sess: (liveData && liveData.antigravity && liveData.antigravity.sessions) || 48 }
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

      // Divider in right panel
      ctx.fillStyle = 'rgba(56, 178, 172, 0.22)';
      ctx.fillRect(rx + 8, ry + 74, rw - 16, 1);

      ctx.fillStyle = '#718096';
      ctx.font = 'bold 6.5px "Segoe UI Rounded", sans-serif';
      ctx.fillText('LIVE FLOW STATUS', rx + 8, ry + 83);

      const flow = (liveData && liveData.flow) || {};
      const harnessesList = flow.harnesses || [];
      const runningCount = harnessesList.filter(h => h.running).length;
      ctx.fillStyle = runningCount > 0 ? '#48BB78' : '#A0AEC0';
      ctx.beginPath();
      ctx.arc(rx + 11, ry + 93, 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = 'bold 7px "Segoe UI Rounded", sans-serif';
      ctx.fillStyle = '#E2E8F0';
      ctx.fillText(`Active Harnesses: ${runningCount}/${harnessesList.length || 3}`, rx + 16, ry + 95.5);

      ctx.restore();
    }

    // -------------------------------------------------------------------------
    // Trading Floor (Dual CRT Screens, Floating Tickers, Desk & Trader)
    // -------------------------------------------------------------------------
    drawTradingFloor(ctx, map, liveData) {
      const TILE = 32;
      ctx.save();

      const trading = liveData && liveData.trading ? liveData.trading : null;
      const stockData = trading && trading.stock ? trading.stock : null;
      const cryptoData = trading && trading.crypto ? trading.crypto : null;

      // Parse HH:MM from trading.updated (e.g. "2026-10-06T02:54:25.676095+00:00")
      let updatedTimeStr = '--:--';
      if (trading && trading.updated) {
        const m = String(trading.updated).match(/T(\d{2}:\d{2})/);
        if (m) {
          updatedTimeStr = m[1];
        } else {
          try {
            const d = new Date(trading.updated);
            if (!isNaN(d.getTime())) {
              updatedTimeStr = String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
            }
          } catch {}
        }
      }

      // 1. Two Live CRT Screens mounted on room's north wall
      // Screen 1: STOCKS (px: 1064, py: 720, pw: 130, ph: 96)
      const sx1 = 1064;
      const sy1 = 720;
      const sw1 = 130;
      const sh1 = 96;
      this.drawTradingScreen(ctx, sx1, sy1, sw1, sh1, 'STOCKS', stockData, updatedTimeStr);

      // Screen 2: CRYPTO (px: 1204, py: 720, pw: 130, ph: 96)
      const sx2 = 1204;
      const sy2 = 720;
      const sw2 = 130;
      const sh2 = 96;
      this.drawTradingScreen(ctx, sx2, sy2, sw2, sh2, 'CRYPTO', cryptoData, updatedTimeStr);

      // 2. Floating Ticker Chips drifting near the screens
      this.drawFloatingTickers(ctx, stockData, cryptoData);

      // 3. Trader Character & Trading Desk
      // Desk dimensions: x: 1136, y: 870, w: 96, h: 36
      const dx = 1136;
      const dy = 870;
      const dw = 96;
      const dh = 36;
      const tx = 1184; // center of desk
      const ty = 862; // standing/sitting behind desk

      // Decorative chair behind desk
      this.drawChair(ctx, tx, ty + 12, '#1A202C');

      // Trader little person (Among Us avatar with headset and glasses)
      this.renderAvatar(ctx, tx, ty, {
        color: 'ocean',
        hat: 'headset',
        face: 'glasses',
        facing: 1,
        isSitting: true,
        isMoving: false,
        scale: 1.0
      });
      this.renderNameTag(ctx, tx, ty, 'Trader', '#68E7C5');

      // Small trading desk in front of trader
      this.drawDesk(ctx, dx, dy, dw, dh, '#2D3748');

      // Dual trading monitors on desk
      this.drawMonitor(ctx, dx + 26, dy + 8, '#00BBF9', 'STOCKS');
      this.drawMonitor(ctx, dx + 70, dy + 8, '#4FD1C5', 'CRYPTO');

      ctx.restore();
    }

    drawTradingScreen(ctx, px, py, pw, ph, title, data, updatedTimeStr) {
      const hasData = Boolean(data && typeof data === 'object' && data.equity !== undefined && data.equity !== null);
      this.renderCRTPanel(ctx, px, py, pw, ph, title, hasData);

      ctx.save();

      // Top-right status: live dot + updated timestamp
      ctx.fillStyle = hasData ? '#38A169' : '#E53E3E';
      ctx.beginPath();
      ctx.arc(px + pw - 60, py + 12, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '7px monospace';
      ctx.fillStyle = '#81E6D9';
      ctx.textAlign = 'right';
      ctx.fillText(updatedTimeStr ? `updated ${updatedTimeStr}` : '--:--', px + pw - 8, py + 15);
      ctx.textAlign = 'left';

      if (!hasData) {
        ctx.font = 'bold 9px monospace';
        ctx.fillStyle = '#718096';
        ctx.textAlign = 'center';
        ctx.fillText('-- NO DATA --', px + pw / 2, py + ph / 2 + 6);
        ctx.restore();
        return;
      }

      // 1. Big Equity Value ($)
      const eqNum = Number(data.equity);
      let eqStr = '--';
      if (!isNaN(eqNum)) {
        eqStr = '$' + eqNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(eqStr, px + 8, py + 30);

      // 2. Total P&L + %
      const totPnl = typeof data.total_pnl === 'number' ? data.total_pnl : null;
      const totPct = typeof data.total_pct === 'number' ? data.total_pct : null;
      if (totPnl !== null) {
        const isTotPos = totPnl >= 0;
        const totColor = isTotPos ? '#48BB78' : '#F56565';
        const sign = isTotPos ? '+' : '-';
        const totText = `TOT: ${sign}$${Math.abs(totPnl).toFixed(2)} (${sign}${Math.abs(totPct || 0).toFixed(1)}%)`;
        ctx.font = 'bold 7px monospace';
        ctx.fillStyle = totColor;
        ctx.fillText(totText, px + 8, py + 41);
      } else {
        ctx.font = '7px monospace';
        ctx.fillStyle = '#A0AEC0';
        ctx.fillText('TOT: --', px + 8, py + 41);
      }

      // 3. Today P&L
      const dayPnl = typeof data.day_pnl === 'number' ? data.day_pnl : null;
      const dayPct = typeof data.day_pct === 'number' ? data.day_pct : null;
      if (dayPnl !== null) {
        const isDayPos = dayPnl >= 0;
        const dayColor = isDayPos ? '#48BB78' : '#F56565';
        const sign = isDayPos ? '+' : '-';
        const dayText = `1D:  ${sign}$${Math.abs(dayPnl).toFixed(2)} (${sign}${Math.abs(dayPct || 0).toFixed(1)}%)`;
        ctx.font = '7px monospace';
        ctx.fillStyle = dayColor;
        ctx.fillText(dayText, px + 8, py + 50);
      } else {
        ctx.font = '7px monospace';
        ctx.fillStyle = '#A0AEC0';
        ctx.fillText('1D:  --', px + 8, py + 50);
      }

      // Subtle horizontal divider line
      ctx.fillStyle = 'rgba(56, 178, 172, 0.25)';
      ctx.fillRect(px + 8, py + 54, pw - 16, 1);

      // 4. Holdings List (top 2 to leave room for TAXED total)
      const holdings = Array.isArray(data.holdings) ? data.holdings.slice(0, 2) : [];
      holdings.forEach((h, idx) => {
        if (!h) return;
        const hy = py + 64 + idx * 10;
        const sym = String(h.sym || '---').substring(0, 5);

        let pxStr = '--';
        if (typeof h.px === 'number' && !isNaN(h.px)) {
          if (h.px >= 10000) pxStr = (h.px / 1000).toFixed(1) + 'k';
          else if (h.px >= 1000) pxStr = h.px.toFixed(0);
          else if (h.px < 1) pxStr = h.px.toFixed(2);
          else pxStr = h.px.toFixed(2);
        }

        ctx.font = 'bold 7px monospace';
        ctx.fillStyle = '#CBD5E0';
        ctx.fillText(sym, px + 8, hy);

        ctx.font = '7px monospace';
        ctx.fillStyle = '#81E6D9';
        ctx.fillText('$' + pxStr, px + 36, hy);

        // Weight bar
        const barX = px + 82;
        const barW = pw - 90; // ~40px
        const weight = typeof h.w === 'number' ? h.w : 20;
        const barFill = Math.min(1.0, Math.max(0.08, weight / 40));

        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillRect(barX, hy - 5, barW, 4);

        ctx.fillStyle = title === 'CRYPTO' ? '#63B3ED' : '#4FD1C5';
        ctx.fillRect(barX, hy - 5, barW * barFill, 4);
      });

      // 5. Distinct TAXED Total line (real total is the big equity above)
      const taxedTotal = (typeof data.taxed_total === 'number' && !isNaN(data.taxed_total)) ? data.taxed_total : null;
      const capTax = (typeof data.capital_gains_tax === 'number' && !isNaN(data.capital_gains_tax)) ? data.capital_gains_tax : null;

      ctx.font = 'bold 7px monospace';
      ctx.fillStyle = '#ECC94B';
      if (taxedTotal !== null) {
        const taxedStr = '$' + Math.round(taxedTotal).toLocaleString('en-US');
        let taxSuffix = '';
        if (capTax !== null) {
          if (capTax > 0) {
            taxSuffix = ` (-$${Math.round(capTax).toLocaleString('en-US')} tax)`;
          } else {
            taxSuffix = ' ($0 tax)';
          }
        }
        ctx.fillText(`TAXED ${taxedStr}${taxSuffix}`, px + 8, py + 87);
      } else {
        ctx.fillText('TAXED --', px + 8, py + 87);
      }

      ctx.restore();
    }

    drawFloatingTickers(ctx, stockData, cryptoData) {
      const chips = [];

      // Extract from stock holdings
      if (stockData && Array.isArray(stockData.holdings)) {
        for (const h of stockData.holdings) {
          if (h && h.sym && typeof h.px === 'number') {
            const pxStr = h.px >= 1000 ? (h.px / 1000).toFixed(1) + 'k' : (h.px < 1 ? h.px.toFixed(2) : h.px.toFixed(2));
            chips.push({ text: `${h.sym} ${pxStr}`, color: '#4FD1C5' });
            if (chips.length >= 2) break;
          }
        }
      }

      // Extract from crypto holdings
      if (cryptoData && Array.isArray(cryptoData.holdings)) {
        for (const h of cryptoData.holdings) {
          if (h && h.sym && typeof h.px === 'number') {
            const pxStr = h.px >= 1000 ? (h.px / 1000).toFixed(1) + 'k' : (h.px < 1 ? h.px.toFixed(2) : h.px.toFixed(2));
            chips.push({ text: `${h.sym} ${pxStr}`, color: '#63B3ED' });
            if (chips.length >= 4) break;
          }
        }
      }

      // Fallback chips if live data is not available
      if (chips.length < 4) {
        const fallbacks = [
          { text: 'AMD 631.75', color: '#4FD1C5' },
          { text: 'NVDA 185.20', color: '#68E7C5' },
          { text: 'BTC 118k', color: '#63B3ED' },
          { text: 'ETH 3.4k', color: '#90CDF4' }
        ];
        while (chips.length < 4 && fallbacks.length > chips.length) {
          chips.push(fallbacks[chips.length]);
        }
      }

      // 4 base positions drifting near the screens (y: 828..840)
      const basePositions = [
        { x: 1070, y: 828 },
        { x: 1135, y: 840 },
        { x: 1205, y: 828 },
        { x: 1270, y: 840 }
      ];

      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

      chips.slice(0, 4).forEach((chip, i) => {
        const pos = basePositions[i];
        const bob = Math.sin(now * 0.002 + i * 1.5) * 3;
        const drift = Math.cos(now * 0.0015 + i * 1.2) * 2;
        const cx = pos.x + drift;
        const cy = pos.y + bob;

        ctx.save();
        ctx.font = 'bold 7px monospace';
        const tw = ctx.measureText(chip.text).width;
        const cw = tw + 8;
        const ch = 12;

        // Dark background pill
        ctx.fillStyle = 'rgba(15, 23, 28, 0.85)';
        ctx.strokeStyle = chip.color || '#38B2AC';
        ctx.lineWidth = 1;
        this.drawRoundedRect(ctx, cx, cy, cw, ch, 3, true, true);

        // Chip text
        ctx.fillStyle = chip.color || '#81E6D9';
        ctx.fillText(chip.text, cx + 4, cy + 9);
        ctx.restore();
      });
    }

    // -------------------------------------------------------------------------
    // Furniture, Shelves, Desks, Plants, Breakroom
    // -------------------------------------------------------------------------
    drawFurniture(ctx, map, camera, liveData) {
      const TILE = 32;

      // 1. Floor Door Mats & Rugs (Drawn underneath physical items)
      this.drawDoorMat(ctx, 21 * TILE, 8 * TILE, 'peach');  // Claude door
      this.drawDoorMat(ctx, 13 * TILE, 7 * TILE, 'mint');   // OpenCode door
      this.drawDoorMat(ctx, 30 * TILE, 7 * TILE, 'slate');  // Antigravity door
      this.drawDoorMat(ctx, 13 * TILE, 17 * TILE, 'warm');  // Break room door
      this.drawDoorMat(ctx, 30 * TILE, 17 * TILE, 'cool');  // Storage door
      this.drawDoorMat(ctx, 32 * TILE, 22 * TILE, 'teal');  // Trading floor door
      this.drawDoorMat(ctx, 21 * TILE, 22 * TILE, 'coir');  // Archives welcome mat

      // Office Rugs
      this.drawOfficeRug(ctx, 5 * TILE, 8 * TILE, 3 * TILE, 2 * TILE, 'rgba(0, 168, 150, 0.22)');
      this.drawOfficeRug(ctx, 20 * TILE, 5 * TILE, 3 * TILE, 2 * TILE, 'rgba(224, 122, 95, 0.22)');
      this.drawOfficeRug(ctx, 36 * TILE, 8 * TILE, 3 * TILE, 2 * TILE, 'rgba(61, 90, 128, 0.22)');

      // 2. Wall Posters & Framed Art
      this.drawWallPoster(ctx, 9 * TILE + 6, 2 * TILE, 'pixel_art');
      this.drawWallPoster(ctx, 25 * TILE + 6, 2 * TILE, 'neural');
      this.drawWallPoster(ctx, 34 * TILE + 6, 2 * TILE, 'galaxy');
      this.drawFramedArt(ctx, 14 * TILE + 4, 8 * TILE + 4, 'mountain');
      this.drawFramedArt(ctx, 29 * TILE + 4, 8 * TILE + 4, 'cyber');

      // 3. Lobby Furniture
      this.drawDesk(ctx, 19 * TILE, 12 * TILE, 5 * TILE, 1.2 * TILE, '#D7A765');
      this.drawLaptop(ctx, 21 * TILE + 8, 12 * TILE + 4, '#4FD1C5');
      this.drawBell(ctx, 20 * TILE + 10, 12 * TILE + 8);
      this.drawFlowerVase(ctx, 23 * TILE + 6, 12 * TILE + 4);
      this.drawBench(ctx, 15 * TILE, 21 * TILE);
      this.drawFloorLamp(ctx, 15 * TILE + 16, 12 * TILE);

      // 4. OpenCode Desk & Office Setup
      this.drawDesk(ctx, 5 * TILE, 6 * TILE, 3 * TILE, 1.5 * TILE, '#5A6B7C');
      this.drawMonitor(ctx, 6 * TILE + 8, 5.5 * TILE, '#00BBF9', 'code');
      this.drawDeskClutter(ctx, 7 * TILE, 6 * TILE, 'opencode');
      this.drawChair(ctx, 6 * TILE + 8, 7.8 * TILE, '#2C3E50');
      this.drawWhiteboard(ctx, 3 * TILE, 2.5 * TILE, 4 * TILE, 'PIPELINES');
      this.drawBookshelf(ctx, 3 * TILE, 2 * TILE, 2.5 * TILE);
      this.drawOfficeSign(ctx, 12.5 * TILE, 6 * TILE, 'OPENCODE', '#00A896');

      // 5. Claude-Code Desk & Office Setup
      this.drawDesk(ctx, 20 * TILE, 3 * TILE, 3 * TILE, 1.5 * TILE, '#A0522D');
      this.drawMonitor(ctx, 21 * TILE + 8, 2.5 * TILE, '#FB5607', 'writing');
      this.drawDeskClutter(ctx, 22 * TILE, 3 * TILE, 'claude');
      this.drawChair(ctx, 21 * TILE + 8, 4.8 * TILE, '#8B4513');
      this.drawBookshelf(ctx, 15 * TILE, 2 * TILE, 3 * TILE);
      this.drawOfficeSign(ctx, 21 * TILE, 7.5 * TILE, 'CLAUDE-CODE', '#E07A5F');

      // 6. Antigravity Desk & Office Setup
      this.drawDesk(ctx, 36 * TILE, 6 * TILE, 3 * TILE, 1.5 * TILE, '#34495E');
      this.drawMonitor(ctx, 37 * TILE + 8, 5.5 * TILE, '#5AA9E6', 'orchestrator');
      this.drawDeskClutter(ctx, 38 * TILE, 6 * TILE, 'antigravity');
      this.drawChair(ctx, 37 * TILE + 8, 7.8 * TILE, '#1B2631');
      this.drawServerRack(ctx, 40 * TILE, 2.5 * TILE);
      this.drawOfficeSign(ctx, 30.5 * TILE, 6 * TILE, 'ANTIGRAVITY', '#3D5A80');

      // 7. Break Room
      this.drawCoffeeCounter(ctx, 3 * TILE, 14 * TILE, 3.5 * TILE);
      this.drawFridge(ctx, 2 * TILE + 2, 13 * TILE);
      this.drawSnackShelf(ctx, 10 * TILE + 2, 13 * TILE);
      this.drawCafeTable(ctx, 7 * TILE, 18 * TILE);
      this.drawWaterCooler(ctx, 10 * TILE, 15 * TILE);

      // 8. Storage Room
      this.drawServerRack(ctx, 33 * TILE, 14 * TILE);
      this.drawServerRack(ctx, 35.5 * TILE, 14 * TILE);
      this.drawCrateStack(ctx, 38 * TILE, 18 * TILE);
      this.drawOfficeSign(ctx, 32 * TILE + 16, 21.5 * TILE, 'TRADING FLOOR', '#38B2AC');

      // 9. Potted Plants
      // Flanking the centered status boards on row 10 (one each side of each centered strip)
      this.drawPlant(ctx, 14 * TILE, 10 * TILE); // left board left flank
      this.drawPlant(ctx, 20 * TILE, 10 * TILE); // left board right flank
      this.drawPlant(ctx, 23 * TILE, 10 * TILE); // right board left flank
      this.drawPlant(ctx, 29 * TILE, 10 * TILE); // right board right flank
      this.drawPlant(ctx, 14 * TILE, 21 * TILE);
      this.drawPlant(ctx, 29 * TILE, 21 * TILE);
      this.drawPlant(ctx, 11 * TILE, 2.5 * TILE); // OpenCode plant
      this.drawPlant(ctx, 27 * TILE, 2.5 * TILE); // Claude plant
      this.drawPlant(ctx, 32 * TILE, 2.5 * TILE); // Antigravity plant
      this.drawPlant(ctx, 2 * TILE + 4, 21 * TILE); // Break room fern

      // 10. The Archives Shelves, Finding Aids Table, Rolling Ladder
      this.drawFindingAidsTable(ctx, 18 * TILE, 23 * TILE);
      this.drawRollingLadder(ctx, 25 * TILE, 26 * TILE);
      this.drawArchiveShelves(ctx, map, camera);

      // 11. String Lights Along Top Walls
      this.drawStringLights(ctx, map);
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

      // Animated scrolling code lines
      const now = performance.now() / 1000;
      const scrollY = (now * 8) % 16;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - 11, y - 5, 22, 12);
      ctx.clip();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      const widths = [12, 16, 8, 14, 10, 18, 9];
      for (let i = 0; i < 7; i++) {
        const ly = y - 5 + ((i * 4 - scrollY + 28) % 28) - 4;
        ctx.fillRect(x - 9, ly, widths[i % widths.length], 1.5);
      }
      ctx.restore();
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
      // Countertop
      ctx.fillStyle = '#4A5568';
      ctx.fillRect(x, y, w, 20);
      ctx.strokeStyle = '#2D3748';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, 20);

      // Espresso Machine
      ctx.fillStyle = '#2D3748';
      ctx.fillRect(x + 4, y - 8, 24, 18);
      ctx.strokeStyle = '#A0AEC0';
      ctx.strokeRect(x + 4, y - 8, 24, 18);
      ctx.fillStyle = '#E2E8F0';
      ctx.fillRect(x + 7, y - 5, 18, 6);

      // Coffee pot with dark roast
      ctx.fillStyle = 'rgba(74, 44, 23, 0.9)';
      ctx.fillRect(x + 32, y - 4, 12, 12);
      ctx.strokeStyle = '#E2E8F0';
      ctx.strokeRect(x + 32, y - 4, 12, 12);

      // Electric Kettle
      ctx.fillStyle = '#E2E8F0';
      ctx.beginPath();
      ctx.arc(x + 54, y + 4, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4A5568';
      ctx.stroke();
      ctx.fillRect(x + 58, y + 1, 4, 3); // Kettle spout

      // Mugs
      ctx.fillStyle = '#E53E3E';
      ctx.fillRect(x + 68, y + 2, 6, 8);
      ctx.fillStyle = '#3182CE';
      ctx.fillRect(x + 78, y + 2, 6, 8);
    }

    drawCafeTable(ctx, x, y) {
      // 4 Chairs around table
      this.drawChair(ctx, x, y - 26, '#8B4513');
      this.drawChair(ctx, x, y + 26, '#8B4513');
      this.drawChair(ctx, x - 26, y, '#8B4513');
      this.drawChair(ctx, x + 26, y, '#8B4513');

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

    drawFridge(ctx, x, y) {
      // Brushed steel tall fridge
      ctx.fillStyle = '#CBD5E0';
      ctx.fillRect(x, y, 26, 36);
      ctx.strokeStyle = '#718096';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, 26, 36);

      // Freezer split line
      ctx.strokeStyle = '#4A5568';
      ctx.beginPath();
      ctx.moveTo(x, y + 14);
      ctx.lineTo(x + 26, y + 14);
      ctx.stroke();

      // Handles
      ctx.fillStyle = '#4A5568';
      ctx.fillRect(x + 20, y + 4, 3, 6);
      ctx.fillRect(x + 20, y + 18, 3, 10);
    }

    drawSnackShelf(ctx, x, y) {
      ctx.fillStyle = '#8B5A2B';
      ctx.fillRect(x, y, 28, 32);
      ctx.strokeStyle = '#4A2A0C';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, 28, 32);

      // Shelves with snack packets
      const chipColors = ['#E53E3E', '#DD6B20', '#38A169', '#3182CE', '#D69E2E'];
      for (let s = 0; s < 3; s++) {
        const sy = y + 4 + s * 10;
        ctx.strokeStyle = '#4A2A0C';
        ctx.beginPath();
        ctx.moveTo(x, sy + 7);
        ctx.lineTo(x + 28, sy + 7);
        ctx.stroke();

        for (let b = 0; b < 3; b++) {
          ctx.fillStyle = chipColors[(s * 3 + b) % chipColors.length];
          ctx.fillRect(x + 3 + b * 8, sy, 6, 7);
        }
      }
    }

    drawBench(ctx, x, y) {
      // Cushioned wood bench
      ctx.fillStyle = '#8B5A2B';
      ctx.fillRect(x, y + 4, 60, 18);
      ctx.strokeStyle = '#4A2A0C';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y + 4, 60, 18);

      // Cushion on top
      ctx.fillStyle = '#319795';
      ctx.fillRect(x + 4, y + 6, 52, 12);
      ctx.strokeStyle = '#234E52';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 4, y + 6, 52, 12);
    }

    drawFramedArt(ctx, x, y, variant) {
      ctx.fillStyle = '#8B5A2B';
      ctx.fillRect(x, y, 24, 20);
      ctx.strokeStyle = '#D69E2E';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, 24, 20);

      if (variant === 'mountain') {
        ctx.fillStyle = '#81E6D9';
        ctx.fillRect(x + 2, y + 2, 20, 16);
        ctx.fillStyle = '#2C7A7B';
        ctx.beginPath();
        ctx.moveTo(x + 3, y + 17);
        ctx.lineTo(x + 10, y + 6);
        ctx.lineTo(x + 16, y + 17);
        ctx.fill();
        ctx.fillStyle = '#FFD166';
        ctx.beginPath();
        ctx.arc(x + 17, y + 6, 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#1A202C';
        ctx.fillRect(x + 2, y + 2, 20, 16);
        ctx.fillStyle = '#9F7AEA';
        ctx.fillRect(x + 5, y + 5, 8, 8);
        ctx.fillStyle = '#38B2AC';
        ctx.fillRect(x + 11, y + 9, 8, 7);
      }
    }

    drawFloorLamp(ctx, x, y) {
      ctx.fillStyle = '#D69E2E';
      ctx.beginPath();
      ctx.arc(x, y + 16, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#B7791F';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x, y + 16);
      ctx.lineTo(x, y - 6);
      ctx.stroke();

      ctx.fillStyle = '#FEFCBF';
      ctx.beginPath();
      ctx.moveTo(x - 9, y);
      ctx.lineTo(x - 6, y - 8);
      ctx.lineTo(x + 6, y - 8);
      ctx.lineTo(x + 9, y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#D69E2E';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    drawDoorMat(ctx, x, y, variant) {
      ctx.fillStyle = '#C05621';
      if (variant === 'coir') ctx.fillStyle = '#B7791F';
      else if (variant === 'mint') ctx.fillStyle = '#319795';
      else if (variant === 'peach') ctx.fillStyle = '#DD6B20';
      else if (variant === 'slate') ctx.fillStyle = '#4A5568';
      else if (variant === 'teal') ctx.fillStyle = '#285E61';

      ctx.fillRect(x + 2, y + 6, 28, 18);
      ctx.strokeStyle = '#1A202C';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 2, y + 6, 28, 18);

      ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.lineWidth = 1;
      for (let lx = x + 6; lx < x + 26; lx += 4) {
        ctx.beginPath();
        ctx.moveTo(lx, y + 8);
        ctx.lineTo(lx, y + 22);
        ctx.stroke();
      }
    }

    drawOfficeRug(ctx, x, y, w, h, color) {
      ctx.fillStyle = color;
      this.drawRoundedRect(ctx, x, y, w, h, 8, true, false);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1.5;
      this.drawRoundedRect(ctx, x + 2, y + 2, w - 4, h - 4, 6, false, true);
    }

    drawDeskClutter(ctx, x, y, variant) {
      ctx.fillStyle = variant === 'opencode' ? '#3182CE' : (variant === 'claude' ? '#E53E3E' : '#38A169');
      ctx.fillRect(x + 2, y + 6, 5, 6);

      ctx.fillStyle = '#FEFCBF';
      ctx.fillRect(x + 10, y + 5, 6, 6);
      ctx.strokeStyle = '#D69E2E';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(x + 10, y + 5, 6, 6);

      ctx.fillStyle = '#EDF2F7';
      ctx.fillRect(x + 18, y + 4, 8, 10);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x + 19, y + 3, 8, 10);
      ctx.strokeStyle = '#A0AEC0';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(x + 19, y + 3, 8, 10);
    }

    drawWallPoster(ctx, x, y, variant) {
      ctx.fillStyle = '#1A202C';
      ctx.fillRect(x, y, 20, 16);
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, 20, 16);

      if (variant === 'pixel_art') {
        ctx.fillStyle = '#00BBF9';
        ctx.fillRect(x + 4, y + 4, 12, 8);
        ctx.fillStyle = '#FFD166';
        ctx.fillRect(x + 8, y + 6, 4, 4);
      } else if (variant === 'neural') {
        ctx.fillStyle = '#FF5E7E';
        ctx.beginPath();
        ctx.arc(x + 6, y + 8, 2, 0, Math.PI * 2);
        ctx.arc(x + 14, y + 5, 2, 0, Math.PI * 2);
        ctx.arc(x + 14, y + 11, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FED7D7';
        ctx.beginPath();
        ctx.moveTo(x + 6, y + 8);
        ctx.lineTo(x + 14, y + 5);
        ctx.moveTo(x + 6, y + 8);
        ctx.lineTo(x + 14, y + 11);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#3D5A80';
        ctx.fillRect(x + 2, y + 2, 16, 12);
        ctx.fillStyle = '#E0FBFC';
        ctx.beginPath();
        ctx.arc(x + 10, y + 8, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawFindingAidsTable(ctx, x, y) {
      ctx.fillStyle = '#7B341E';
      ctx.fillRect(x, y, 30, 24);
      ctx.strokeStyle = '#3C180A';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, 30, 24);

      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 3; c++) {
          ctx.fillStyle = '#9C4221';
          ctx.fillRect(x + 3 + c * 9, y + 4 + r * 9, 7, 7);
          ctx.fillStyle = '#D69E2E';
          ctx.fillRect(x + 5 + c * 9, y + 7 + r * 9, 3, 1.5);
        }
      }

      ctx.fillStyle = '#2D3748';
      ctx.fillRect(x + 2, y + 21, 26, 7);
      ctx.fillStyle = '#FFD54F';
      ctx.font = 'bold 5.5px sans-serif';
      ctx.fillText('FINDING AIDS', x + 3, y + 26);
    }

    drawRollingLadder(ctx, x, y) {
      ctx.save();
      ctx.strokeStyle = '#D69E2E';
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 6, y + 44);
      ctx.moveTo(x + 14, y);
      ctx.lineTo(x + 20, y + 44);
      ctx.stroke();

      for (let i = 0; i < 5; i++) {
        const t = (i + 1) / 6;
        ctx.beginPath();
        ctx.moveTo(x + t * 6, y + t * 44);
        ctx.lineTo(x + 14 + t * 6, y + t * 44);
        ctx.stroke();
      }

      ctx.fillStyle = '#2D3748';
      ctx.beginPath();
      ctx.arc(x + 6, y + 45, 2.5, 0, Math.PI * 2);
      ctx.arc(x + 20, y + 45, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawStringLights(ctx, map) {
      const now = performance.now();
      const rooms = [
        { x0: 14, x1: 29, y: 2 },  // Claude
        { x0: 2, x1: 12, y: 2 },   // OpenCode
        { x0: 31, x1: 41, y: 2 },  // Antigravity
        { x0: 14, x1: 29, y: 9 },  // Lobby
        { x0: 2, x1: 12, y: 13 },  // Breakroom
        { x0: 31, x1: 41, y: 13 }  // Storage
      ];

      for (const r of rooms) {
        const startX = r.x0 * 32;
        const endX = r.x1 * 32 + 32;
        const py = r.y * 32 + 4;

        ctx.strokeStyle = 'rgba(60, 60, 60, 0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(startX, py);

        const segments = Math.max(1, Math.floor((endX - startX) / 24));
        for (let s = 0; s < segments; s++) {
          const segX0 = startX + s * 24;
          const segX1 = Math.min(endX, segX0 + 24);
          const midX = (segX0 + segX1) / 2;
          const dip = 3.5;
          ctx.quadraticCurveTo(midX, py + dip, segX1, py);
        }
        ctx.stroke();

        for (let px = startX + 12; px < endX; px += 24) {
          const sway = Math.sin(now / 700 + px * 0.2) * 1.0;
          const ly = py + 3 + sway;

          ctx.fillStyle = 'rgba(255, 220, 130, 0.35)';
          ctx.beginPath();
          ctx.arc(px, ly, 4.5, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#FFF9DB';
          ctx.beginPath();
          ctx.arc(px, ly, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
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

      // 1. Draw all shelves & empty-shelf marks
      for (const shelf of map.shelves) {
        const sx = shelf.tileX * TILE;
        const sy = shelf.tileY * TILE;

        // Wooden/Metal Shelving frame
        ctx.fillStyle = '#4A5568';
        ctx.fillRect(sx, sy, TILE, TILE * 2);
        ctx.strokeStyle = '#2D3748';
        ctx.lineWidth = 2;
        ctx.strokeRect(sx, sy, TILE, TILE * 2);

        // Shelf divider bar
        ctx.fillStyle = '#718096';
        ctx.fillRect(sx, sy + TILE - 2, TILE, 4);

        // Subtle empty-shelf mark if space was previously occupied
        if (shelf.hasEmptyMark) {
          ctx.save();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
          ctx.fillRect(sx + 4, sy + 6, TILE - 8, 20);
          ctx.strokeStyle = 'rgba(160, 174, 192, 0.3)';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);
          ctx.strokeRect(sx + 4, sy + 6, TILE - 8, 20);
          // Faint empty dust silhouette
          ctx.fillStyle = 'rgba(210, 180, 140, 0.12)';
          ctx.fillRect(sx + 6, sy + 8, TILE - 12, 16);
          ctx.restore();
        }
      }

      // 2. Draw Project Boxes on shelves
      for (const box of map.projectBoxes) {
        const shelf = box.shelf;
        if (!shelf) continue;
        const sx = shelf.tileX * TILE;
        const sy = shelf.tileY * TILE;
        const opacity = box.opacity !== undefined ? box.opacity : 1.0;
        if (opacity <= 0.001) continue;

        ctx.save();
        ctx.globalAlpha = opacity;

        const proj = box.project;
        const isDeployed = proj.deployed === true;
        const boxColor = isDeployed ? '#38A169' : '#DD6B20';

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
        ctx.fillRect(bx + 4, by, 5, bh);

        // Project label tag
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(bx + 10, by + 3, 11, 14);
        ctx.strokeStyle = '#718096';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(bx + 10, by + 3, 11, 14);

        // Deployed badge dot (green dot vs gray dot)
        ctx.fillStyle = isDeployed ? '#38A169' : '#A0AEC0';
        ctx.beginPath();
        ctx.arc(bx + 13, by + 6, 1.8, 0, Math.PI * 2);
        ctx.fill();

        // Project name initials on tag
        ctx.fillStyle = '#1A202C';
        ctx.font = 'bold 5.5px sans-serif';
        const initial = (proj.name || 'P').substring(0, 2);
        ctx.fillText(initial, bx + 11, by + 13);

        // Updated date small text on bottom edge of box
        if (proj.updated) {
          ctx.fillStyle = '#5A4A3A';
          ctx.font = '5px monospace';
          const shortDate = proj.updated.substring(5); // e.g. "10-05"
          ctx.fillText(shortDate, bx + 3, by + bh - 2);
        }

        ctx.restore();
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

      // Direction change squash (e.g. 1.15x / 0.88x on turn)
      const squashX = options.squashX || 1.0;
      const squashY = options.squashY || 1.0;
      ctx.scale(squashX, squashY);

      // Sinusoidal body bob (amplitude 1.5px, half the stride frequency)
      const walkPhase = (frame % 4) / 4;
      const bob = options.isMoving ? Math.sin(walkPhase * Math.PI * 2) * 1.5 * scale : 0;
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

      // 2. Legs / Feet (4-frame cycle with alternating leg spread)
      ctx.fillStyle = pal.dark;
      if (!isSitting) {
        if (!options.isMoving) {
          // Standing neutral
          this.drawRoundedRect(ctx, -7, 8, 6, 8, 3, true, true);
          this.drawRoundedRect(ctx, 2, 8, 6, 8, 3, true, true);
        } else {
          const f = frame % 4;
          if (f === 0) {
            // Frame 0: Left leg forward (-9), right leg back (4)
            this.drawRoundedRect(ctx, -9, 7, 6, 8, 3, true, true);
            this.drawRoundedRect(ctx, 4, 9, 6, 7, 3, true, true);
          } else if (f === 1) {
            // Frame 1: Passing position (legs aligned, body lifted)
            this.drawRoundedRect(ctx, -7, 8, 6, 8, 3, true, true);
            this.drawRoundedRect(ctx, 2, 8, 6, 8, 3, true, true);
          } else if (f === 2) {
            // Frame 2: Right leg forward (4), left leg back (-9)
            this.drawRoundedRect(ctx, -9, 9, 6, 7, 3, true, true);
            this.drawRoundedRect(ctx, 4, 7, 6, 8, 3, true, true);
          } else {
            // Frame 3: Passing position
            this.drawRoundedRect(ctx, -7, 8, 6, 8, 3, true, true);
            this.drawRoundedRect(ctx, 2, 8, 6, 8, 3, true, true);
          }
        }
      } else {
        // Tucked feet when sitting
        this.drawRoundedRect(ctx, -5, 8, 10, 5, 2, true, true);
      }

      // Arm swing opposite the legs (drawn behind body)
      if (!isSitting && options.isMoving) {
        const f = frame % 4;
        const armOffset = f === 0 ? -2.5 : (f === 2 ? 2.5 : 0);
        ctx.fillStyle = pal.fill;
        ctx.strokeStyle = '#22252A';
        ctx.lineWidth = 2;
        this.drawRoundedRect(ctx, -3 + armOffset, -2, 5, 8, 2.5, true, true);
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
          // Over-ear headphones (OpenCode) - snug headband resting right on head top (y = -16)
          ctx.strokeStyle = '#2D3748';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, -7, 10.5, Math.PI * 0.88, Math.PI * 2.12);
          ctx.stroke();
          // Earcups hugging sides of the head at ear height
          ctx.fillStyle = '#4FD1C5';
          this.drawRoundedRect(ctx, -12, -11, 4, 8, 2, true, true);
          this.drawRoundedRect(ctx, 8, -11, 4, 8, 2, true, true);
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
    renderNameTag(ctx, x, y, name, color = '#FFFFFF', alpha = 1.0, subText = null, subColor = '#A0AEC0') {
      ctx.save();
      if (alpha !== undefined && alpha !== 1.0) {
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      }
      ctx.textAlign = 'center';
      const text = (name || 'Visitor').substring(0, 16);

      if (subText) {
        ctx.font = 'bold 9px "Segoe UI Rounded", "Nunito", sans-serif';
        const mainWidth = ctx.measureText(text).width;
        ctx.font = '8px "Segoe UI Rounded", "Nunito", sans-serif';
        const subWidth = ctx.measureText(subText).width;
        const tw = Math.max(mainWidth, subWidth) + 12;
        const th = 24;

        // Dark background pill
        ctx.fillStyle = 'rgba(23, 25, 35, 0.84)';
        this.drawRoundedRect(ctx, x - tw / 2, y - 42, tw, th, 4, true, false);

        // Name
        ctx.font = 'bold 9px "Segoe UI Rounded", "Nunito", sans-serif';
        ctx.fillStyle = color;
        ctx.fillText(text, x, y - 30);

        // Status subtext
        ctx.font = '8px "Segoe UI Rounded", "Nunito", sans-serif';
        ctx.fillStyle = subColor;
        ctx.fillText(subText, x, y - 20);
      } else {
        ctx.font = 'bold 9px "Segoe UI Rounded", "Nunito", sans-serif';
        const metrics = ctx.measureText(text);
        const tw = metrics.width + 10;
        const th = 14;

        // Dark background pill
        ctx.fillStyle = 'rgba(23, 25, 35, 0.78)';
        this.drawRoundedRect(ctx, x - tw / 2, y - 32, tw, th, 4, true, false);

        ctx.fillStyle = color;
        ctx.fillText(text, x, y - 22);
      }
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
