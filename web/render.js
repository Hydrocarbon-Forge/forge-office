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

  // Seeded Mulberry32 PRNG for deterministic exterior terrain & feature generation
  class SeededRNG {
    constructor(seed = 0x5EED88) {
      this.s = seed >>> 0;
    }
    next() {
      let t = (this.s += 0x6D2B79F5) >>> 0;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    range(min, max) {
      return min + this.next() * (max - min);
    }
    rangeInt(min, max) {
      return Math.floor(this.range(min, max + 1));
    }
  }

  // Bounding exclusion mask: protects office building interior and observation decks from collision
  function isExcludedPosition(x, y, margin = 28) {
    if (x >= 32 - margin && x <= 1376 + margin) {
      if (y >= 32 - margin && y <= 704 + margin) return true;
      if (x >= 960 - margin && x <= 1376 + margin && y >= 704 - margin && y <= 1120 + margin) return true;
      if (x >= 544 - margin && x <= 832 + margin && y >= 704 - margin && y <= 1248 + margin) return true;
    }
    if (x >= 64 - margin && x <= 416 + margin && y >= 736 - margin && y <= 768 + margin) return true;
    if (x >= 992 - margin && x <= 1344 + margin && y >= 1120 - margin && y <= 1152 + margin) return true;
    return false;
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
      const w = this.canvas.width / this.dpr;
      const h = this.canvas.height / this.dpr;
      // Screen-space background gradient continuing the vista so screen edges never show dead background
      const grad = this.ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0.0, '#8FC7EA'); // Soft azure daytime sky top
      grad.addColorStop(0.38, '#CBE4F2'); // Sky-to-horizon transition
      grad.addColorStop(0.45, '#EAF4DC'); // Warm horizon haze (~45% down the screen)
      grad.addColorStop(0.50, '#5C8A50'); // Meadow ridge
      grad.addColorStop(1.0, '#3E6B3F'); // Brighter green meadow ground
      this.ctx.fillStyle = grad;
      this.ctx.fillRect(0, 0, w, h);
    }

    // -------------------------------------------------------------------------
    // Mountain Vista Pre-Rendering & Architectural Windows
    // -------------------------------------------------------------------------
    bakeMountainVista(map) {
      if (typeof document === 'undefined') return;
      const TILE = map.tile || 32;
      const mapW = map.width * TILE;
      const mapH = map.height * TILE;
      const margin = 1024;
      this.vistaMargin = margin;
      const totalW = mapW + margin * 2;
      const totalH = mapH + margin * 2;

      if (!this.vistaCanvas) {
        this.vistaCanvas = document.createElement('canvas');
      }
      this.vistaCanvas.width = totalW;
      this.vistaCanvas.height = totalH;
      const ctx = this.vistaCanvas.getContext('2d');
      ctx.clearRect(0, 0, totalW, totalH);

      ctx.save();
      ctx.translate(margin, margin);

      // 1. Sky & Distant Mountain Peaks (North Vista & Sky Canopy)
      // Bright daytime sky gradient: soft azure top -> pale warm haze at horizon
      const skyGrad = ctx.createLinearGradient(0, -margin, 0, 260);
      skyGrad.addColorStop(0.0, '#8FC7EA'); // Soft azure
      skyGrad.addColorStop(Math.min(1.0, (margin + 60) / (margin + 260)), '#8FC7EA');
      skyGrad.addColorStop(Math.min(1.0, (margin + 170) / (margin + 260)), '#BFE0F2');
      skyGrad.addColorStop(1.0, '#EAF4DC');  // Pale warm haze near horizon
      ctx.fillStyle = skyGrad;
      ctx.fillRect(-margin, -margin, totalW, 260 + margin);

      // Soft Sun (pale yellow disc + gentle glow)
      const sunX = mapW * 0.72;
      const sunY = 70;
      const sunGlow = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 70);
      sunGlow.addColorStop(0.0, 'rgba(255, 253, 220, 0.95)');
      sunGlow.addColorStop(0.25, 'rgba(255, 248, 195, 0.50)');
      sunGlow.addColorStop(0.60, 'rgba(255, 242, 180, 0.18)');
      sunGlow.addColorStop(1.0, 'rgba(255, 242, 180, 0.0)');
      ctx.fillStyle = sunGlow;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 70, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFDE8';
      ctx.beginPath();
      ctx.arc(sunX, sunY, 14, 0, Math.PI * 2);
      ctx.fill();

      // Wispy Cirrus Clouds
      ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
      ctx.beginPath();
      ctx.ellipse(mapW * 0.22, 42, 180, 14, -0.05, 0, Math.PI * 2);
      ctx.ellipse(mapW * 0.82, 60, 220, 16, 0.04, 0, Math.PI * 2);
      ctx.ellipse(mapW * 0.45, 95, 150, 12, -0.02, 0, Math.PI * 2);
      ctx.ellipse(-300, 55, 240, 15, 0.02, 0, Math.PI * 2);
      ctx.ellipse(mapW + 350, 75, 260, 16, -0.03, 0, Math.PI * 2);
      ctx.fill();

      // Peak Layer 1 (Furthest Snowy Crests — airy soft blue-lilac #9FB4D8)
      ctx.fillStyle = '#9FB4D8';
      ctx.beginPath();
      const p1 = [
        { x: -margin, y: 110 }, { x: -800, y: 55 }, { x: -620, y: 105 }, { x: -440, y: 45 }, { x: -280, y: 95 }, { x: -140, y: 50 },
        { x: 0, y: 130 }, { x: 120, y: 65 }, { x: 220, y: 110 }, { x: 380, y: 45 },
        { x: 510, y: 105 }, { x: 670, y: 40 }, { x: 800, y: 95 }, { x: 960, y: 55 },
        { x: 1120, y: 110 }, { x: 1260, y: 50 }, { x: mapW, y: 100 },
        { x: mapW + 150, y: 55 }, { x: mapW + 320, y: 105 }, { x: mapW + 500, y: 45 }, { x: mapW + 680, y: 95 }, { x: mapW + 850, y: 50 }, { x: mapW + margin, y: 110 },
        { x: mapW + margin, y: 260 }, { x: -margin, y: 260 }
      ];
      ctx.moveTo(p1[0].x, p1[0].y);
      p1.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.fill();

      // Snow / Quartz Peak Highlights
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.70)';
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

      // Peak Layer 2 (Mid Massif — soft blue-slate #7496B2)
      ctx.fillStyle = '#7496B2';
      ctx.beginPath();
      const p2 = [
        { x: -margin, y: 130 }, { x: -750, y: 90 }, { x: -550, y: 140 }, { x: -350, y: 85 }, { x: -180, y: 135 },
        { x: 0, y: 160 }, { x: 180, y: 95 }, { x: 340, y: 145 }, { x: 560, y: 80 },
        { x: 740, y: 135 }, { x: 890, y: 85 }, { x: 1080, y: 125 }, { x: 1280, y: 75 },
        { x: mapW, y: 120 },
        { x: mapW + 180, y: 80 }, { x: mapW + 360, y: 135 }, { x: mapW + 580, y: 85 }, { x: mapW + 780, y: 140 }, { x: mapW + margin, y: 125 },
        { x: mapW + margin, y: 260 }, { x: -margin, y: 260 }
      ];
      ctx.moveTo(p2[0].x, p2[0].y);
      p2.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.fill();

      // Peak Layer 3 (Pine Spire Ridge — mountain pine green #466A52)
      ctx.fillStyle = '#466A52';
      ctx.beginPath();
      ctx.moveTo(-margin, 185);
      for (let x = -margin; x <= mapW + margin; x += 16) {
        const ridgeY = 150 + Math.sin(x * 0.015) * 18;
        ctx.lineTo(x, ridgeY);
        ctx.lineTo(x + 5, ridgeY - 9);
        ctx.lineTo(x + 10, ridgeY);
      }
      ctx.lineTo(mapW + margin, 260);
      ctx.lineTo(-margin, 260);
      ctx.closePath();
      ctx.fill();

      // Atmospheric Valley Mist
      const mistGrad = ctx.createLinearGradient(0, 130, 0, 190);
      mistGrad.addColorStop(0, 'rgba(235, 245, 255, 0.0)');
      mistGrad.addColorStop(0.5, 'rgba(235, 245, 255, 0.35)');
      mistGrad.addColorStop(1, 'rgba(235, 245, 255, 0.0)');
      ctx.fillStyle = mistGrad;
      ctx.fillRect(-margin, 130, totalW, 60);

      // 2. High-Effort Procedural Terrain Base (multi-stop rolling gradients & organic biomes)
      const terrainGrad = ctx.createLinearGradient(0, 260, 0, mapH + margin);
      terrainGrad.addColorStop(0.0, '#4E7C42');  // North foothill green
      terrainGrad.addColorStop(0.25, '#528246'); // Upper valley green
      terrainGrad.addColorStop(0.55, '#4A763F'); // Mid meadow green
      terrainGrad.addColorStop(0.85, '#446E3A'); // Rolling south slope
      terrainGrad.addColorStop(1.0, '#3D6334');  // Distant southern ridge green
      ctx.fillStyle = terrainGrad;
      ctx.fillRect(-margin, 260, totalW, mapH + margin - 260);

      // Seeded PRNG for stable, reload-deterministic organic landscape
      const rng = new SeededRNG(0x5EED88);

      // Biome Knolls & Rolling Swells (large organic soft overlapping patches)
      const swells = [
        // West / Northwest upland turf swells
        { x: -500, y: 400, rx: 420, ry: 260, c: '#6B8E4E', a: 0.35 },
        { x: -280, y: 700, rx: 340, ry: 220, c: '#5E8246', a: 0.30 },
        { x: -650, y: 950, rx: 480, ry: 300, c: '#6B8E4E', a: 0.25 },
        // East / Southeast sunny pasture swells
        { x: mapW + 280, y: 450, rx: 380, ry: 240, c: '#5D8C4E', a: 0.40 },
        { x: mapW + 550, y: 800, rx: 460, ry: 320, c: '#6E9B56', a: 0.30 },
        { x: mapW + 320, y: 1200, rx: 420, ry: 280, c: '#5D8C4E', a: 0.35 },
        { x: mapW + 600, y: 1600, rx: 500, ry: 340, c: '#6E9B56', a: 0.28 },
        // Southwest Tarn lush hollow
        { x: 180, y: 980, rx: 380, ry: 260, c: '#528246', a: 0.45 },
        { x: -120, y: 1250, rx: 360, ry: 240, c: '#48753E', a: 0.35 },
        // Southern deep valley rolling ridges
        { x: 300, y: mapH + 350, rx: 650, ry: 280, c: '#4E7C42', a: 0.35 },
        { x: 1000, y: mapH + 450, rx: 700, ry: 320, c: '#5D8C4E', a: 0.30 },
        { x: -200, y: mapH + 500, rx: 600, ry: 300, c: '#446E3A', a: 0.35 },
        { x: 600, y: mapH + 750, rx: 800, ry: 320, c: '#3D6334', a: 0.40 }
      ];

      swells.forEach(s => {
        ctx.save();
        ctx.globalAlpha = s.a;
        ctx.fillStyle = s.c;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, s.rx, s.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // Organic soil / loam patches in dry meadows
      const soilPatches = [
        { x: -380, y: 520, rx: 55, ry: 30 },
        { x: -160, y: 340, rx: 45, ry: 24 },
        { x: mapW + 380, y: 640, rx: 65, ry: 35 },
        { x: mapW + 520, y: 1050, rx: 75, ry: 40 },
        { x: 600, y: mapH + 280, rx: 85, ry: 42 }
      ];
      soilPatches.forEach(sp => {
        ctx.save();
        ctx.fillStyle = 'rgba(90, 74, 56, 0.22)';
        ctx.beginPath();
        ctx.ellipse(sp.x, sp.y, sp.rx, sp.ry, 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // Stippled grass dither tufts across open exterior
      ctx.fillStyle = 'rgba(110, 175, 90, 0.25)';
      for (let i = 0; i < 180; i++) {
        const gx = -margin + 40 + rng.range(0, totalW - 80);
        const gy = 270 + rng.range(0, mapH + margin - 300);
        if (!isExcludedPosition(gx, gy, 16)) {
          ctx.fillRect(gx, gy, 3, 5);
          ctx.fillRect(gx + 4, gy + 2, 2, 4);
        }
      }

      // 3. Watercourses: Western Tumbling Mountain Brook & Central Ravine Grotto
      // Western Mountain Brook (cascading from northern gap x: -140, y: 100 down to Tarn bay at x: 180, y: 850)
      const westBrookStartY = 100;
      const westBrookEndY = 850;
      const westBrookStep = 20;

      // West brook stony bed
      ctx.fillStyle = '#343A42';
      ctx.beginPath();
      for (let y = westBrookStartY; y <= westBrookEndY; y += westBrookStep) {
        const progress = (y - westBrookStartY) / (westBrookEndY - westBrookStartY);
        const xc = -140 + progress * 320 + Math.sin((y - 100) * 0.014) * 22;
        const w = 34 + Math.sin((y - 100) * 0.02) * 8;
        if (y === westBrookStartY) ctx.moveTo(xc - w / 2, y);
        else ctx.lineTo(xc - w / 2, y);
      }
      for (let y = westBrookEndY; y >= westBrookStartY; y -= westBrookStep) {
        const progress = (y - westBrookStartY) / (westBrookEndY - westBrookStartY);
        const xc = -140 + progress * 320 + Math.sin((y - 100) * 0.014) * 22;
        const w = 34 + Math.sin((y - 100) * 0.02) * 8;
        ctx.lineTo(xc + w / 2, y);
      }
      ctx.closePath();
      ctx.fill();

      // West brook sunlit blue water channel
      ctx.fillStyle = '#4C86A8';
      ctx.beginPath();
      for (let y = westBrookStartY; y <= westBrookEndY; y += westBrookStep) {
        const progress = (y - westBrookStartY) / (westBrookEndY - westBrookStartY);
        const xc = -140 + progress * 320 + Math.sin((y - 100) * 0.014) * 22;
        const w = 22 + Math.sin((y - 100) * 0.02) * 6;
        if (y === westBrookStartY) ctx.moveTo(xc - w / 2, y);
        else ctx.lineTo(xc - w / 2, y);
      }
      for (let y = westBrookEndY; y >= westBrookStartY; y -= westBrookStep) {
        const progress = (y - westBrookStartY) / (westBrookEndY - westBrookStartY);
        const xc = -140 + progress * 320 + Math.sin((y - 100) * 0.014) * 22;
        const w = 22 + Math.sin((y - 100) * 0.02) * 6;
        ctx.lineTo(xc + w / 2, y);
      }
      ctx.closePath();
      ctx.fill();

      // West brook white-water riffles
      ctx.strokeStyle = 'rgba(235, 250, 255, 0.65)';
      ctx.lineWidth = 1.3;
      for (let ry = westBrookStartY + 15; ry < westBrookEndY; ry += 32) {
        const progress = (ry - westBrookStartY) / (westBrookEndY - westBrookStartY);
        const xc = -140 + progress * 320 + Math.sin((ry - 100) * 0.014) * 22;
        ctx.beginPath();
        ctx.moveTo(xc - 10, ry);
        ctx.lineTo(xc + 10, ry + 2);
        ctx.stroke();
      }

      // Central Ravine Grotto (quiet mossy cleft between Archives and Trading floor)
      const brookStartY = 22 * TILE; // 704px
      const brookEndY = mapH + margin;
      const stepY = 24;

      // Draw stony ravine trench
      ctx.fillStyle = '#363C44';
      ctx.beginPath();
      for (let y = brookStartY; y <= brookEndY; y += stepY) {
        const xc = 912 + Math.sin((y - 704) * 0.012) * 28 + Math.cos((y - 704) * 0.025) * 14;
        const w = 52 + Math.sin((y - 704) * 0.018) * 10 + 36;
        if (y === brookStartY) ctx.moveTo(xc - w / 2, y);
        else ctx.lineTo(xc - w / 2, y);
      }
      for (let y = brookEndY; y >= brookStartY; y -= stepY) {
        const xc = 912 + Math.sin((y - 704) * 0.012) * 28 + Math.cos((y - 704) * 0.025) * 14;
        const w = 52 + Math.sin((y - 704) * 0.018) * 10 + 36;
        ctx.lineTo(xc + w / 2, y);
      }
      ctx.closePath();
      ctx.fill();

      // Gravel banks along ravine
      ctx.fillStyle = '#4E5560';
      for (let y = brookStartY + 10; y < brookEndY; y += 48) {
        const xc = 912 + Math.sin((y - 704) * 0.012) * 28 + Math.cos((y - 704) * 0.025) * 14;
        ctx.fillRect(xc - 38, y, 6, 12);
        ctx.fillRect(xc + 32, y + 16, 7, 10);
      }

      // Sunlit blue water channel
      ctx.fillStyle = '#4C86A8';
      ctx.beginPath();
      for (let y = brookStartY; y <= brookEndY; y += stepY) {
        const xc = 912 + Math.sin((y - 704) * 0.012) * 28 + Math.cos((y - 704) * 0.025) * 14;
        const w = 44 + Math.sin((y - 704) * 0.018) * 10;
        if (y === brookStartY) ctx.moveTo(xc - w / 2, y);
        else ctx.lineTo(xc - w / 2, y);
      }
      for (let y = brookEndY; y >= brookStartY; y -= stepY) {
        const xc = 912 + Math.sin((y - 704) * 0.012) * 28 + Math.cos((y - 704) * 0.025) * 14;
        const w = 44 + Math.sin((y - 704) * 0.018) * 10;
        ctx.lineTo(xc + w / 2, y);
      }
      ctx.closePath();
      ctx.fill();

      // Water white-water riffles
      ctx.strokeStyle = 'rgba(235, 250, 255, 0.65)';
      ctx.lineWidth = 1.5;
      for (let ry = brookStartY + 12; ry < brookEndY; ry += 28) {
        const xc = 912 + Math.sin((ry - 704) * 0.012) * 28 + Math.cos((ry - 704) * 0.025) * 14;
        ctx.beginPath();
        ctx.moveTo(xc - 18, ry);
        ctx.lineTo(xc + 18, ry + 3);
        ctx.stroke();
      }

      // River boulders along the brook
      for (let i = 0; i < 14; i++) {
        const by = brookStartY + 25 + i * 80;
        const xc = 912 + Math.sin((by - 704) * 0.012) * 28 + Math.cos((by - 704) * 0.025) * 14;
        const bx = xc + (i % 2 === 0 ? -12 : 14) + ((i * 17) % 8 - 4);
        ctx.fillStyle = '#4E5560';
        ctx.beginPath();
        ctx.arc(bx, by, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3A6248';
        ctx.beginPath();
        ctx.arc(bx, by - 2, 3.5, 0, Math.PI);
        ctx.fill();
      }

      // Stepping stones across the shallow brook entry into Tarn at x = 160, y = 870
      this.drawSteppingStones(ctx, 160, 870);

      // 4. Southwest Sanctuary: Alpine Tarn with Multi-Frequency Organic Shoreline
      const lakeCx = 8 * TILE; // 256px
      const lakeCy = 31 * TILE; // 992px
      const lakeRx = 220;
      const lakeRy = 145;

      // 60-step organic shoreline polygon
      const lakeSteps = 60;
      const shorePoints = [];
      for (let i = 0; i <= lakeSteps; i++) {
        const angle = (i / lakeSteps) * Math.PI * 2;
        const wobble = 1.0 + 0.08 * Math.sin(3 * angle + 0.4) + 0.05 * Math.cos(5 * angle - 0.2) + 0.03 * Math.sin(8 * angle + 1.1);
        shorePoints.push({
          angle,
          x: lakeCx + Math.cos(angle) * lakeRx * wobble,
          y: lakeCy + Math.sin(angle) * lakeRy * wobble,
          sandX: lakeCx + Math.cos(angle) * (lakeRx + 16) * wobble,
          sandY: lakeCy + Math.sin(angle) * (lakeRy + 12) * wobble
        });
      }

      // 4a. Sand / pebble beach fringe
      ctx.fillStyle = '#C2B28F';
      ctx.beginPath();
      ctx.moveTo(shorePoints[0].sandX, shorePoints[0].sandY);
      shorePoints.forEach(p => ctx.lineTo(p.sandX, p.sandY));
      ctx.closePath();
      ctx.fill();

      // 4b. Deep water basin with radial gradient
      const lakeGrad = ctx.createRadialGradient(lakeCx - 30, lakeCy - 20, 15, lakeCx, lakeCy, lakeRx);
      lakeGrad.addColorStop(0.0, '#2D5E7B');
      lakeGrad.addColorStop(0.55, '#3D7699');
      lakeGrad.addColorStop(0.85, '#4C86A8');
      lakeGrad.addColorStop(1.0, '#5A96A6');

      ctx.fillStyle = lakeGrad;
      ctx.beginPath();
      ctx.moveTo(shorePoints[0].x, shorePoints[0].y);
      shorePoints.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.fill();

      // Aqua littoral fringe stroke
      ctx.strokeStyle = '#5A96A6';
      ctx.lineWidth = 4;
      ctx.stroke();

      // Daylight reflection sheen wash
      const reflGrad = ctx.createLinearGradient(lakeCx - lakeRx, lakeCy - lakeRy, lakeCx + lakeRx, lakeCy + lakeRy);
      reflGrad.addColorStop(0.2, 'rgba(255, 255, 230, 0.28)');
      reflGrad.addColorStop(0.8, 'rgba(130, 195, 225, 0.22)');
      ctx.fillStyle = reflGrad;
      ctx.beginPath();
      ctx.moveTo(shorePoints[0].x, shorePoints[0].y);
      shorePoints.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.fill();

      // Gentle water wave lines
      ctx.strokeStyle = 'rgba(235, 250, 255, 0.50)';
      ctx.lineWidth = 1.2;
      for (let dy = -lakeRy + 25; dy < lakeRy - 20; dy += 22) {
        const chordLen = Math.sqrt(Math.max(0, 1 - (dy / lakeRy) ** 2)) * lakeRx * 0.70;
        ctx.beginPath();
        ctx.moveTo(lakeCx - chordLen + 15, lakeCy + dy);
        ctx.lineTo(lakeCx + chordLen - 15, lakeCy + dy);
        ctx.stroke();
      }

      // Shoreline boulders around tarn
      const shoreRocks = [
        { x: lakeCx - lakeRx * 0.76, y: lakeCy + lakeRy * 0.35, r: 9 },
        { x: lakeCx - lakeRx * 0.48, y: lakeCy + lakeRy * 0.72, r: 7.5 },
        { x: lakeCx + lakeRx * 0.65, y: lakeCy - lakeRy * 0.28, r: 10 },
        { x: lakeCx + lakeRx * 0.44, y: lakeCy + lakeRy * 0.56, r: 8 },
        { x: lakeCx - 15, y: lakeCy + lakeRy * 0.88, r: 6.5 },
        { x: lakeCx + 80, y: lakeCy + lakeRy * 0.75, r: 7 }
      ];
      shoreRocks.forEach(rk => {
        ctx.fillStyle = '#4E5560';
        ctx.beginPath();
        ctx.arc(rk.x, rk.y, rk.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#737B8A';
        ctx.beginPath();
        ctx.arc(rk.x - 2, rk.y - 2, rk.r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      });

      // Lily pads on calm waters
      ctx.fillStyle = '#3A8253';
      [
        { x: lakeCx - 50, y: lakeCy - 25, r: 6 },
        { x: lakeCx - 70, y: lakeCy - 15, r: 5 },
        { x: lakeCx + 75, y: lakeCy + 35, r: 7 },
        { x: lakeCx + 95, y: lakeCy + 22, r: 5.5 },
        { x: lakeCx - 30, y: lakeCy + 60, r: 6 }
      ].forEach(lp => {
        ctx.beginPath();
        ctx.arc(lp.x, lp.y, lp.r, 0.2, Math.PI * 1.8);
        ctx.fill();
      });

      // Feature 1: Rustic Wooden Dock extending into tarn from northern grassy shore
      this.drawRusticDock(ctx, 260, 845);

      // 5. Walking Trails (Integrated Procedural Dirt Paths)
      // Main Eastern Trail: south of Deck B winding southeast through pasture gate into sunrise meadows
      const mainTrailPoints = [
        { x: 1168, y: 1152 },
        { x: 1260, y: 1220 },
        { x: 1380, y: 1280 },
        { x: 1520, y: 1380 },
        { x: 1700, y: 1540 },
        { x: 1920, y: 1720 },
        { x: 2120, y: 1920 }
      ];
      this.drawWindingPath(ctx, mainTrailPoints, 18);

      // Western Overlook Trail: from Deck A through trail junction and across footbridge to Vista Bench
      const westOverlookTrail = [
        { x: 160, y: 768 },
        { x: 110, y: 740 },
        { x: 40, y: 620 },
        { x: -10, y: 520 },
        { x: -30, y: 460 },
        { x: -50, y: 400 },
        { x: -110, y: 280 },
        { x: -180, y: 160 }
      ];
      this.drawWindingPath(ctx, westOverlookTrail, 16);

      // Western Tarn & Campsite Trail: from junction to dock and around sandy shore to campsite fire pit
      const westTarnTrail = [
        { x: 110, y: 740 },
        { x: 180, y: 800 },
        { x: 260, y: 845 },
        { x: 140, y: 920 },
        { x: 40, y: 1020 },
        { x: -60, y: 1120 },
        { x: -140, y: 1180 }
      ];
      this.drawWindingPath(ctx, westTarnTrail, 14);

      // Connective Feature: Rustic Wooden Footbridge crossing the mountain brook
      this.drawWoodenFootbridge(ctx, -30, 460);

      // 6. Scattered Small Sculpted Features
      // Feature 2: Stone Fire Pit & Benches (secluded sheltered campsite clearing with safe firebreak)
      this.drawStoneFirePit(ctx, -140, 1180);

      // Feature 3: Glacial Boulders (placed across highlands, tarn shores, and pastures)
      const boulderSpawns = [
        { x: -120, y: 200, r: 16, s: 2 },
        { x: -320, y: 380, r: 22, s: 5 },
        { x: -180, y: 560, r: 14, s: 7 },
        { x: -450, y: 750, r: 18, s: 3 },
        { x: 120, y: 1080, r: 12, s: 9 },
        { x: 420, y: 920, r: 14, s: 4 },
        { x: -140, y: 1380, r: 16, s: 6 },
        { x: 1550, y: 720, r: 15, s: 8 },
        { x: 1780, y: 1280, r: 20, s: 1 },
        { x: 2050, y: 1620, r: 18, s: 11 },
        { x: 620, y: mapH + 340, r: 16, s: 13 }
      ];
      boulderSpawns.forEach(b => {
        if (!isExcludedPosition(b.x, b.y, b.r + 4)) {
          this.drawGlacialBoulder(ctx, b.x, b.y, b.r, b.s);
        }
      });

      // Feature 5: Wetland Cattails & Tall Reeds
      const cattailLocs = [
        { x: 90, y: 950, s: 1 },
        { x: 150, y: 1100, s: 3 },
        { x: 380, y: 1050, s: 5 },
        { x: 320, y: 910, s: 7 },
        { x: 865, y: 820, s: 2 },
        { x: 955, y: 870, s: 4 },
        { x: 860, y: 1020, s: 6 },
        { x: 960, y: 1150, s: 8 }
      ];
      cattailLocs.forEach(c => this.drawCattailClump(ctx, c.x, c.y, c.s));

      // Feature 6: Directional Trail Signposts at real trail junctions
      this.drawTrailSignpost(ctx, 110, 740);
      this.drawTrailSignpost(ctx, 1420, 1190);

      // Feature 7: Mountain Stone Cairns
      this.drawStoneCairn(ctx, -240, 280);
      this.drawStoneCairn(ctx, 1750, 450);

      // Feature 8: Split-Rail Fence Remnants
      this.drawSplitRailFence(ctx, 1520, 920, 80);
      this.drawSplitRailFence(ctx, 1640, 1420, 96);

      // Feature 9: Fallen Mossy Cedar Logs
      this.drawFallenLog(ctx, 340, 1350);
      this.drawFallenLog(ctx, -150, 520);

      // Feature 11: Secluded Mountain Vista Park Bench (oriented facing north peaks)
      this.drawVistaBench(ctx, -180, 140);

      // Feature 12: Forest Sunbeam Shafts
      this.drawSunbeamShaft(ctx, -200, 400, 180, 32);
      this.drawSunbeamShaft(ctx, 1600, 600, 220, 36);

      // Feature 13: Mushroom Fairy Ring in shaded southern pine grove
      this.drawMushroomFairyRing(ctx, 80, 1380);

      // Feature 4: Four-Species Wildflower Clusters
      const flowerLocs = [
        // Columbine (species 0)
        { x: -80, y: 920, count: 14, sp: 0, s: 3 },
        { x: 420, y: 1120, count: 16, sp: 0, s: 5 },
        { x: 1420, y: 550, count: 18, sp: 0, s: 9 },
        // Buttercups (species 1)
        { x: 80, y: 1250, count: 20, sp: 1, s: 2 },
        { x: 1560, y: 840, count: 22, sp: 1, s: 4 },
        { x: 1850, y: 1650, count: 25, sp: 1, s: 8 },
        // Daisies / Edelweiss (species 2)
        { x: -300, y: 320, count: 15, sp: 2, s: 7 },
        { x: 1680, y: 400, count: 18, sp: 2, s: 1 },
        { x: -180, y: 720, count: 14, sp: 2, s: 11 },
        // Poppies (species 3)
        { x: 1480, y: 1150, count: 16, sp: 3, s: 6 },
        { x: 1720, y: 1350, count: 20, sp: 3, s: 10 },
        { x: 280, y: mapH + 220, count: 18, sp: 3, s: 12 }
      ];
      flowerLocs.forEach(fl => this.drawWildflowerCluster(ctx, fl.x, fl.y, fl.count, fl.sp, fl.s));

      // 7. Multi-Tier Conifer / Pine Trees (Organized into natural groves and Y-sorted)
      const pineList = [];

      // Core foreground / boundary pines
      const corePines = [
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
      corePines.forEach(p => pineList.push(p));

      // Natural Groves defined by centers and radii
      const groves = [
        { cx: -220, cy: 480, r: 180, count: 14 },
        { cx: -180, cy: 1080, r: 220, count: 16 },
        { cx: 180, cy: 1260, r: 140, count: 9 },
        { cx: 1700, cy: 1100, r: 240, count: 20 },
        { cx: 1950, cy: 420, r: 200, count: 14 },
        { cx: 450, cy: mapH + 300, r: 260, count: 16 },
        { cx: 1150, cy: mapH + 320, r: 240, count: 15 },
        { cx: -350, cy: 1150, r: 200, count: 12 }
      ];

      groves.forEach(g => {
        for (let i = 0; i < g.count; i++) {
          const angle = rng.range(0, Math.PI * 2);
          const dist = Math.sqrt(rng.next()) * g.r;
          const tx = g.cx + Math.cos(angle) * dist;
          const ty = g.cy + Math.sin(angle) * dist;
          const scale = rng.range(0.85, 1.2);
          if (!isExcludedPosition(tx, ty, 20)) {
            pineList.push({ x: tx, y: ty, s: scale });
          }
        }
      });

      // Loose tree bands along north foothills and southern boundary
      for (let i = 0; i < 18; i++) {
        const tx = -600 + i * 145 + rng.range(-30, 30);
        const ty = rng.range(30, 110);
        if (!isExcludedPosition(tx, ty, 20)) {
          pineList.push({ x: tx, y: ty, s: rng.range(0.8, 1.0) });
        }
      }
      for (let i = 0; i < 20; i++) {
        const tx = -700 + i * 155 + rng.range(-40, 40);
        const ty = mapH + rng.range(420, 750);
        pineList.push({ x: tx, y: ty, s: rng.range(0.9, 1.25) });
      }

      // Sort pines by Y coordinate for natural depth ordering
      pineList.sort((a, b) => a.y - b.y);
      pineList.forEach(p => {
        this.drawPineTree(ctx, p.x, p.y, p.s);
      });

      // 8. Architectural Foundation Apron, Observation Decks & Retaining Walls
      this.drawBuildingTransitionApron(ctx, map);
      this.drawObservationDeck(ctx, 2 * TILE, 23 * TILE, 11 * TILE, TILE);
      this.drawObservationDeck(ctx, 31 * TILE, 35 * TILE, 11 * TILE, TILE);
      this.drawRetainingWallsAndCliffLedges(ctx, map);

      // 9. Southern Atmospheric Aerial Depth Wash (y > 1500)
      const hazeGrad = ctx.createLinearGradient(0, 1500, 0, mapH + margin);
      hazeGrad.addColorStop(0.0, 'rgba(234, 244, 220, 0.0)');
      hazeGrad.addColorStop(1.0, 'rgba(234, 244, 220, 0.22)');
      ctx.fillStyle = hazeGrad;
      ctx.fillRect(-margin, 1500, totalW, mapH + margin - 1500);

      ctx.restore();
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

    drawBuildingTransitionApron(ctx, map) {
      const TILE = map.tile || 32;
      const isSolidBuildingTile = (x, y) => {
        if (x < 0 || x >= map.width || y < 0 || y >= map.height) return false;
        const t = map.getTile(x, y);
        return t !== 0; // Any interior room, floor, wall, window
      };

      ctx.save();

      // 1. Foundation Gravel Apron (warm stone/gravel #8C7B62 / #B8A890, ~1.5 tiles wide)
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (isSolidBuildingTile(x, y)) continue;

          // Check distance to closest building tile
          let dist = 999;
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (isSolidBuildingTile(x + dx, y + dy)) {
                const d = Math.hypot(dx, dy);
                if (d < dist) dist = d;
              }
            }
          }

          if (dist <= 2.2) {
            const px = x * TILE;
            const py = y * TILE;
            const alpha = Math.max(0, 1.0 - (dist - 0.7) / 1.5);

            // Layer 1: Warm crushed gravel blend
            ctx.fillStyle = '#8C7B62';
            ctx.globalAlpha = alpha * 0.45;
            ctx.fillRect(px, py, TILE, TILE);

            // Layer 2: Flagstone / paving apron closest to wall (dist <= 1.2)
            if (dist <= 1.2) {
              ctx.fillStyle = '#5A4D41';
              ctx.globalAlpha = 0.25;
              ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
            }

            // Layer 3: Grass edge fringe dither specks
            ctx.fillStyle = '#5D8C4E';
            ctx.globalAlpha = (1.0 - alpha) * 0.40;
            if ((x * 13 + y * 29) % 3 === 0) {
              ctx.fillRect(px + 4, py + 6, 4, 6);
              ctx.fillRect(px + 18, py + 12, 3, 5);
            }
          }
        }
      }
      ctx.globalAlpha = 1.0;

      // 2. Foundation Stone Retaining Curb (tight 4px band along all exterior walls)
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const t = map.getTile(x, y);
          if (t === 10 || t === 15) { // Solid wall or window
            const px = x * TILE;
            const py = y * TILE;

            if (y > 0 && map.getTile(x, y - 1) === 0) {
              // North edge curb
              ctx.fillStyle = '#7D6F5A';
              ctx.fillRect(px, py - 4, TILE, 4);
              ctx.fillStyle = 'rgba(15, 20, 25, 0.40)';
              ctx.fillRect(px, py - 1, TILE, 1);
            }
            if (y < map.height - 1 && map.getTile(x, y + 1) === 0) {
              // South edge curb
              ctx.fillStyle = '#5A4D41';
              ctx.fillRect(px, py + TILE, TILE, 4);
            }
            if (x > 0 && map.getTile(x - 1, y) === 0) {
              // West edge curb
              ctx.fillStyle = '#6E5D4B';
              ctx.fillRect(px - 4, py, 4, TILE);
            }
            if (x < map.width - 1 && map.getTile(x + 1, y) === 0) {
              // East edge curb
              ctx.fillStyle = '#8C7B62';
              ctx.fillRect(px + TILE, py, 4, TILE);
            }
          }
        }
      }

      // 3. Directional Building Drop Shadow onto Exterior Ground
      // Sun is at top-right (x ~ 1013, y ~ 70), so shadows fall DOWN and to the LEFT (~225 deg)
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const t = map.getTile(x, y);
          if (t === 10 || t === 15) {
            const px = x * TILE;
            const py = y * TILE;

            // South shadow (falling downwards by 18px)
            if (y < map.height - 1 && map.getTile(x, y + 1) === 0) {
              const shadowH = 18;
              const grad = ctx.createLinearGradient(px, py + TILE, px, py + TILE + shadowH);
              grad.addColorStop(0, 'rgba(18, 28, 20, 0.38)');
              grad.addColorStop(1, 'rgba(18, 28, 20, 0.0)');
              ctx.fillStyle = grad;
              ctx.fillRect(px - 6, py + TILE, TILE + 6, shadowH);
            }

            // West shadow (falling leftwards by 16px)
            if (x > 0 && map.getTile(x - 1, y) === 0) {
              const shadowW = 16;
              const grad = ctx.createLinearGradient(px, py, px - shadowW, py);
              grad.addColorStop(0, 'rgba(18, 28, 20, 0.35)');
              grad.addColorStop(1, 'rgba(18, 28, 20, 0.0)');
              ctx.fillStyle = grad;
              ctx.fillRect(px - shadowW, py, shadowW, TILE + 10);
            }
          }
        }
      }

      ctx.restore();
    }

    drawWoodenFootbridge(ctx, x, y) {
      ctx.save();
      // Arched wooden footbridge across brook
      ctx.fillStyle = 'rgba(15, 25, 35, 0.45)';
      ctx.fillRect(x - 22, y - 10, 44, 20);

      // Support pilings / stone abutments on banks
      ctx.fillStyle = '#4A3525';
      ctx.fillRect(x - 24, y - 12, 6, 24);
      ctx.fillRect(x + 18, y - 12, 6, 24);

      // Stringers / arched side beams
      ctx.fillStyle = '#3E2A1C';
      ctx.fillRect(x - 22, y - 11, 44, 3);
      ctx.fillRect(x - 22, y + 8, 44, 3);

      // Deck planks (7 weathered cedar cross-planks)
      for (let i = 0; i < 9; i++) {
        const px = x - 20 + i * 4.6;
        const arch = Math.sin((i / 8) * Math.PI) * 2;
        ctx.fillStyle = (i % 2 === 0) ? '#6E4D34' : '#63452E';
        ctx.fillRect(px, y - 10 - arch, 3.8, 20);
        ctx.fillStyle = '#856043';
        ctx.fillRect(px, y - 10 - arch, 3.8, 1);
      }

      // Handrails and posts
      ctx.fillStyle = '#5A3E2A';
      [-18, -6, 6, 18].forEach(bx => {
        ctx.fillRect(x + bx - 1, y - 15, 2, 5);
        ctx.fillRect(x + bx - 1, y + 10, 2, 5);
      });
      ctx.fillStyle = '#78553C';
      ctx.fillRect(x - 22, y - 15, 44, 2);
      ctx.fillRect(x - 22, y + 14, 44, 2);

      // Water foam wake ribbons against upstream abutments
      ctx.strokeStyle = 'rgba(240, 252, 255, 0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 24, y - 12);
      ctx.lineTo(x - 20, y - 14);
      ctx.moveTo(x + 18, y - 12);
      ctx.lineTo(x + 22, y - 14);
      ctx.stroke();

      ctx.restore();
    }

    drawRetainingWallsAndCliffLedges(ctx, map) {
      const TILE = map.tile || 32;

      // Clean northern foundation stone retaining ledge at y = 1 * TILE
      ctx.fillStyle = '#484E5B';
      for (let x = 1; x <= 42; x++) {
        const px = x * TILE;
        ctx.fillRect(px, 1 * TILE - 4, TILE, 4);
        ctx.fillStyle = '#2A2E36';
        ctx.fillRect(px + TILE - 1, 1 * TILE - 4, 1, 4);
        if (x % 4 === 0) {
          ctx.fillStyle = '#3A6248'; // Moss tufts on retaining wall
          ctx.fillRect(px + 4, 1 * TILE - 3, 6, 2);
        }
        ctx.fillStyle = '#484E5B';
      }
    }

    drawRusticDock(ctx, x, y) {
      ctx.save();
      // 1. Water shadow under dock
      ctx.fillStyle = 'rgba(15, 30, 40, 0.45)';
      ctx.fillRect(x - 14, y, 28, 68);

      // 2. Heavy wooden support pilings (4 pilings in water)
      const pilings = [
        { px: x - 10, py: y + 20 }, { px: x + 10, py: y + 20 },
        { px: x - 10, py: y + 56 }, { px: x + 10, py: y + 56 }
      ];
      pilings.forEach(p => {
        ctx.fillStyle = '#261A12'; // Waterlogged wood
        ctx.beginPath();
        ctx.arc(p.px, p.py + 4, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4A3423';
        ctx.fillRect(p.px - 3, p.py - 6, 6, 10);
        // Water ripple ring around piling
        ctx.strokeStyle = 'rgba(210, 240, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(p.px - 5, p.py + 2, 10, 4);
      });

      // 3. Main stringers / support beams
      ctx.fillStyle = '#3E2A1C';
      ctx.fillRect(x - 11, y, 4, 64);
      ctx.fillRect(x + 7, y, 4, 64);

      // 4. Individual weathered deck planks (10 cross planks)
      for (let i = 0; i < 10; i++) {
        const py = y + i * 6.2;
        const plankW = 26 + ((i % 3) * 1.5);
        const px = x - plankW / 2;
        ctx.fillStyle = (i % 2 === 0) ? '#6E4D34' : '#63452E';
        ctx.fillRect(px, py, plankW, 5.2);
        ctx.fillStyle = '#856043';
        ctx.fillRect(px, py, plankW, 1.2);
        ctx.fillStyle = '#1D140D';
        ctx.fillRect(px + 3, py + 2, 1, 1.2);
        ctx.fillRect(px + plankW - 4, py + 2, 1, 1.2);
      }

      // 5. Mooring bollard & coiled rope at dock end
      ctx.fillStyle = '#2A1C12';
      ctx.fillRect(x + 7, y + 58, 4, 6);
      ctx.strokeStyle = '#8B7355';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x + 7, y + 58, 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    drawStoneFirePit(ctx, x, y) {
      ctx.save();
      // Scorch mark
      const sootGrad = ctx.createRadialGradient(x, y, 2, x, y, 22);
      sootGrad.addColorStop(0.0, 'rgba(25, 20, 18, 0.70)');
      sootGrad.addColorStop(0.5, 'rgba(45, 38, 32, 0.40)');
      sootGrad.addColorStop(1.0, 'rgba(45, 38, 32, 0.0)');
      ctx.fillStyle = sootGrad;
      ctx.beginPath();
      ctx.arc(x, y, 22, 0, Math.PI * 2);
      ctx.fill();

      // Ash and charcoal center
      ctx.fillStyle = '#221F1E';
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6E6662';
      ctx.fillRect(x - 3, y - 2, 6, 4);

      // Ring of 10 river stones
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * Math.PI * 2;
        const sx = x + Math.cos(angle) * 11.5;
        const sy = y + Math.sin(angle) * 11.5;
        ctx.fillStyle = '#20242B';
        ctx.beginPath();
        ctx.arc(sx - 1, sy + 1, 3.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = (i % 2 === 0) ? '#5A626E' : '#4E5560';
        ctx.beginPath();
        ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#7E8796';
        ctx.beginPath();
        ctx.arc(sx + 0.8, sy - 0.8, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      // Two split-log benches
      this.drawLogBench(ctx, x, y - 26, 28, 7, 0);
      this.drawLogBench(ctx, x - 26, y, 7, 28, 0);
      ctx.restore();
    }

    drawLogBench(ctx, bx, by, w, h, rot) {
      ctx.save();
      ctx.translate(bx, by);
      ctx.fillStyle = 'rgba(20, 25, 20, 0.35)';
      ctx.fillRect(-w/2 - 2, -h/2 + 3, w, h);
      ctx.fillStyle = '#5A3E28';
      ctx.fillRect(-w/2, -h/2, w, h);
      ctx.fillStyle = '#825C3D';
      ctx.fillRect(-w/2 + 1, -h/2 + 1, w - 2, h - 3);
      ctx.fillStyle = '#9C704C';
      ctx.fillRect(-w/2 + 3, -h/2 + 2, w - 6, 1);
      ctx.restore();
    }

    drawGlacialBoulder(ctx, x, y, r, seed = 1) {
      ctx.save();
      ctx.fillStyle = 'rgba(20, 30, 25, 0.45)';
      ctx.beginPath();
      ctx.ellipse(x - r * 0.25, y + r * 0.35, r * 1.1, r * 0.55, -0.15, 0, Math.PI * 2);
      ctx.fill();

      const points = [];
      const sides = 7;
      for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2;
        const wobble = 1.0 + (((seed * 37 + i * 19) % 10) - 5) * 0.04;
        points.push({
          x: x + Math.cos(angle) * r * wobble,
          y: y + Math.sin(angle) * (r * 0.75) * wobble
        });
      }

      ctx.fillStyle = '#4E5560';
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      points.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.fill();

      // Shaded bottom facet
      ctx.fillStyle = '#363C44';
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x, y + r * 0.65);
      ctx.lineTo(x + r * 0.8, y + r * 0.2);
      ctx.lineTo(x, y);
      ctx.closePath();
      ctx.fill();

      // Sunlit top-right facet
      ctx.fillStyle = '#737B8A';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.2, y - r * 0.65);
      ctx.lineTo(x + r * 0.85, y - r * 0.3);
      ctx.lineTo(x + r * 0.4, y + r * 0.1);
      ctx.lineTo(x - r * 0.1, y - r * 0.1);
      ctx.closePath();
      ctx.fill();

      // Moss cap on top
      ctx.fillStyle = '#3A6248';
      ctx.beginPath();
      ctx.ellipse(x + r * 0.1, y - r * 0.35, r * 0.65, r * 0.3, 0.1, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4E8058';
      ctx.fillRect(x, y - r * 0.4, r * 0.4, 2);
      ctx.restore();
    }

    drawWildflowerCluster(ctx, x, y, count, species, seed = 1) {
      ctx.save();
      for (let i = 0; i < count; i++) {
        const fx = x + (((seed * 31 + i * 47) % 32) - 16);
        const fy = y + (((seed * 59 + i * 23) % 24) - 12);
        ctx.fillStyle = '#386333';
        ctx.fillRect(fx, fy, 1, 3);

        if (species === 0) { // Columbine
          ctx.fillStyle = (i % 2 === 0) ? '#5E6AD2' : '#8C7CE6';
          ctx.beginPath();
          ctx.arc(fx, fy - 1, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#FFF8D6';
          ctx.fillRect(fx - 0.5, fy - 1.5, 1, 1);
        } else if (species === 1) { // Buttercup
          ctx.fillStyle = '#FFD13B';
          ctx.beginPath();
          ctx.arc(fx, fy - 1, 2.0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#E28E2B';
          ctx.fillRect(fx - 0.5, fy - 1.5, 1, 1);
        } else if (species === 2) { // Edelweiss / Daisy
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(fx, fy - 1, 2.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ECC94B';
          ctx.beginPath();
          ctx.arc(fx, fy - 1, 1.0, 0, Math.PI * 2);
          ctx.fill();
        } else { // Poppy
          ctx.fillStyle = '#FF5E5B';
          ctx.beginPath();
          ctx.arc(fx, fy - 1, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#3D1A1A';
          ctx.fillRect(fx - 0.5, fy - 1.5, 1, 1);
        }
      }
      ctx.restore();
    }

    drawCattailClump(ctx, x, y, seed = 1) {
      ctx.save();
      ctx.fillStyle = 'rgba(20, 35, 20, 0.35)';
      ctx.beginPath();
      ctx.ellipse(x, y + 2, 10, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineWidth = 1.2;
      const blades = [-7, -4, -1, 2, 5, 8];
      blades.forEach((dx, idx) => {
        const tipCurve = dx * 1.4 + ((seed * 11 + idx * 7) % 5 - 2);
        ctx.strokeStyle = (idx % 2 === 0) ? '#4A7C3D' : '#3B6330';
        ctx.beginPath();
        ctx.moveTo(x + dx * 0.6, y);
        ctx.quadraticCurveTo(x + dx, y - 10, x + dx + tipCurve, y - 18 - (idx % 3) * 3);
        ctx.stroke();
      });

      const spikes = [{ dx: -2, h: 20 }, { dx: 3, h: 22 }];
      spikes.forEach(s => {
        ctx.strokeStyle = '#2F4F24';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(x + s.dx, y);
        ctx.lineTo(x + s.dx, y - s.h);
        ctx.stroke();

        ctx.fillStyle = '#5A361D';
        ctx.fillRect(x + s.dx - 1.5, y - s.h + 3, 3, 7.5);
        ctx.fillStyle = '#7A4D2E';
        ctx.fillRect(x + s.dx, y - s.h + 3, 1.2, 7.5);
        ctx.fillStyle = '#2F4F24';
        ctx.fillRect(x + s.dx - 0.5, y - s.h, 1, 3);
      });
      ctx.restore();
    }

    drawTrailSignpost(ctx, x, y) {
      ctx.save();
      ctx.fillStyle = 'rgba(20, 25, 20, 0.40)';
      ctx.fillRect(x - 6, y + 1, 8, 3);

      ctx.fillStyle = '#4E3827';
      ctx.fillRect(x - 2, y - 22, 4, 24);
      ctx.fillStyle = '#6E523A';
      ctx.fillRect(x, y - 22, 2, 24);

      // Sign Arm 1 (North)
      ctx.fillStyle = '#75543B';
      ctx.fillRect(x - 2, y - 20, 16, 5);
      ctx.beginPath();
      ctx.moveTo(x + 14, y - 22.5);
      ctx.lineTo(x + 19, y - 17.5);
      ctx.lineTo(x + 14, y - 12.5);
      ctx.fill();
      ctx.fillStyle = '#301F14';
      ctx.fillRect(x + 1, y - 18, 10, 1.2);

      // Sign Arm 2 (West)
      ctx.fillStyle = '#654731';
      ctx.fillRect(x - 14, y - 13, 14, 5);
      ctx.beginPath();
      ctx.moveTo(x - 14, y - 15.5);
      ctx.lineTo(x - 19, y - 10.5);
      ctx.lineTo(x - 14, y - 5.5);
      ctx.fill();
      ctx.fillStyle = '#301F14';
      ctx.fillRect(x - 12, y - 11, 8, 1.2);
      ctx.restore();
    }

    drawStoneCairn(ctx, x, y) {
      ctx.save();
      ctx.fillStyle = 'rgba(25, 30, 25, 0.40)';
      ctx.beginPath();
      ctx.ellipse(x - 2, y + 2, 10, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();

      const stones = [
        { w: 16, h: 4.5, dy: 0, c: '#4E5560', cHi: '#737B8A' },
        { w: 13, h: 4.0, dy: -4, c: '#5A626E', cHi: '#808997' },
        { w: 10, h: 3.5, dy: -7.5, c: '#4E5560', cHi: '#737B8A' },
        { w: 7,  h: 3.2, dy: -10.5, c: '#5A626E', cHi: '#808997' },
        { w: 4.5, h: 4.0, dy: -14.0, c: '#6B7482', cHi: '#919BAA' }
      ];

      stones.forEach(s => {
        const sy = y + s.dy;
        ctx.fillStyle = s.c;
        ctx.beginPath();
        ctx.ellipse(x, sy, s.w / 2, s.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = s.cHi;
        ctx.beginPath();
        ctx.ellipse(x + s.w * 0.15, sy - s.h * 0.2, s.w * 0.3, s.h * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    drawSplitRailFence(ctx, x, y, len = 72) {
      ctx.save();
      const numBays = Math.floor(len / 32);
      for (let b = 0; b < numBays; b++) {
        const px0 = x + b * 32;
        const px1 = px0 + 32;
        const py = y + (b % 2) * 6;

        ctx.fillStyle = 'rgba(20, 25, 20, 0.35)';
        ctx.fillRect(px0 - 4, py + 2, 6, 2.5);

        ctx.strokeStyle = '#4A3728';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(px0, py - 4);
        ctx.lineTo(px1, py - 6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px0, py - 11);
        ctx.lineTo(px1, py - 13);
        ctx.stroke();

        ctx.strokeStyle = '#6E533E';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(px0, py - 12);
        ctx.lineTo(px1, py - 14);
        ctx.stroke();

        ctx.fillStyle = '#3E2D20';
        ctx.fillRect(px0 - 2, py - 16, 4, 18);
        ctx.fillStyle = '#5A4230';
        ctx.fillRect(px0, py - 16, 1.8, 18);
      }
      ctx.restore();
    }

    drawFallenLog(ctx, x, y) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.25);

      ctx.fillStyle = 'rgba(15, 25, 20, 0.45)';
      ctx.fillRect(-22, 4, 46, 5);

      ctx.fillStyle = '#3E2D22';
      ctx.fillRect(-22, -4, 44, 8);
      ctx.fillStyle = '#553F30';
      ctx.fillRect(-20, -3, 40, 2);

      ctx.fillStyle = '#8C684B';
      ctx.beginPath();
      ctx.ellipse(-22, 0, 2.5, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#553F30';
      ctx.fillRect(-22, -1, 1, 2);

      ctx.fillStyle = '#3E2D22';
      ctx.fillRect(4, -8, 3, 5);

      ctx.fillStyle = '#3B683D';
      ctx.fillRect(-12, -4.5, 24, 2);
      ctx.fillStyle = '#528C55';
      ctx.fillRect(-6, -4.5, 12, 1);

      ctx.fillStyle = '#E5D8BE';
      ctx.beginPath();
      ctx.arc(8, -4, 2.2, Math.PI, Math.PI * 2);
      ctx.arc(14, -4, 1.8, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawSteppingStones(ctx, startX, startY) {
      ctx.save();
      const stones = [
        { dx: -24, dy: -3, rx: 5.5, ry: 4.0 },
        { dx: -12, dy: 1,  rx: 5.0, ry: 4.5 },
        { dx: 0,   dy: -2, rx: 6.0, ry: 4.5 },
        { dx: 13,  dy: 2,  rx: 5.2, ry: 4.0 },
        { dx: 25,  dy: -1, rx: 5.0, ry: 3.8 }
      ];

      stones.forEach(s => {
        const sx = startX + s.dx;
        const sy = startY + s.dy;

        ctx.strokeStyle = 'rgba(235, 250, 255, 0.70)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(sx, sy - 1, s.rx + 2, Math.PI * 0.9, Math.PI * 2.1);
        ctx.stroke();

        ctx.fillStyle = '#2A303A';
        ctx.beginPath();
        ctx.ellipse(sx - 1, sy + 1.5, s.rx, s.ry, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#5A626E';
        ctx.beginPath();
        ctx.ellipse(sx, sy, s.rx, s.ry, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#7E8898';
        ctx.beginPath();
        ctx.ellipse(sx + 1, sy - 1, s.rx * 0.5, s.ry * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    drawVistaBench(ctx, x, y) {
      ctx.save();
      // 1. Ground shadow (falling south)
      ctx.fillStyle = 'rgba(20, 25, 20, 0.35)';
      ctx.fillRect(x - 13, y + 4, 26, 4);

      // 2. Dark wrought iron A-frame legs
      ctx.fillStyle = '#1D2228';
      ctx.fillRect(x - 9, y - 3, 2.5, 9);
      ctx.fillRect(x + 7, y - 3, 2.5, 9);

      // 3. Wood seat slats (north side, facing northern peaks)
      ctx.fillStyle = '#78553C';
      ctx.fillRect(x - 11, y - 4, 22, 4);
      ctx.fillStyle = '#9C704C'; // Sunlit wood highlight on front edge
      ctx.fillRect(x - 11, y - 4, 22, 1);

      // 4. Wood backrest slats (south side, behind viewer)
      ctx.fillStyle = '#5A3D28';
      ctx.fillRect(x - 11, y + 1, 22, 2.5);
      ctx.fillRect(x - 11, y + 4.5, 22, 2.5);
      ctx.fillStyle = '#78553C';
      ctx.fillRect(x - 11, y + 1, 22, 0.8);
      ctx.restore();
    }

    drawSunbeamShaft(ctx, x, y, len = 180, w = 32) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI * 0.75); // 135 deg: rays project down-left (~225 deg), consistent with sun at upper right (1013, 70)

      const beamGrad = ctx.createLinearGradient(0, -w/2, 0, w/2);
      beamGrad.addColorStop(0.0, 'rgba(255, 252, 220, 0.0)');
      beamGrad.addColorStop(0.5, 'rgba(255, 250, 215, 0.08)');
      beamGrad.addColorStop(1.0, 'rgba(255, 252, 220, 0.0)');

      ctx.fillStyle = beamGrad;
      ctx.fillRect(0, -w/2, len, w);
      ctx.restore();
    }

    drawMushroomFairyRing(ctx, x, y) {
      ctx.save();
      ctx.strokeStyle = 'rgba(90, 160, 80, 0.35)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.stroke();

      for (let i = 0; i < 7; i++) {
        const angle = (i / 7) * Math.PI * 2;
        const mx = x + Math.cos(angle) * 14;
        const my = y + Math.sin(angle) * 14;

        ctx.fillStyle = '#EDE8DB';
        ctx.fillRect(mx - 0.7, my - 2, 1.4, 3);

        ctx.fillStyle = '#D92B2B';
        ctx.beginPath();
        ctx.arc(mx, my - 2.5, 2.2, Math.PI, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(mx - 1, my - 3.5, 0.7, 0.7);
        ctx.fillRect(mx + 0.5, my - 3.0, 0.7, 0.7);
      }
      ctx.restore();
    }

    drawWindingPath(ctx, points, width = 20) {
      if (!points || points.length < 2) return;
      ctx.save();
      ctx.strokeStyle = 'rgba(155, 140, 116, 0.55)';
      ctx.lineWidth = width + 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        const xc = (points[i - 1].x + points[i].x) / 2;
        const yc = (points[i - 1].y + points[i].y) / 2;
        ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, xc, yc);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      ctx.stroke();

      ctx.strokeStyle = '#8C7B62';
      ctx.lineWidth = width;
      ctx.stroke();

      ctx.strokeStyle = '#7A6952';
      ctx.lineWidth = width - 6;
      ctx.stroke();
      ctx.restore();
    }

    drawSoaringHawk(ctx, hx, hy, angle, flap) {
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(angle);
      ctx.fillStyle = '#2C221E';
      ctx.fillRect(-1, -3, 2, 6);
      const wingAngle = Math.max(-0.4, Math.min(0.4, flap * 0.3));
      ctx.strokeStyle = '#2C221E';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-6, -wingAngle * 5);
      ctx.lineTo(-12, -wingAngle * 2.5);
      ctx.moveTo(0, 0);
      ctx.lineTo(6, -wingAngle * 5);
      ctx.lineTo(12, -wingAngle * 2.5);
      ctx.stroke();
      ctx.restore();
    }

    drawAnimatedVistaAccents(ctx) {
      const now = Date.now();

      // 1. Lake water sparkles & brook riffle pulses (8 lake diamond glints + 4 brook riffles)
      const lakeCx = 8 * 32;
      const lakeCy = 31 * 32;
      const glints = [
        { dx: -65, dy: -28 },
        { dx: 55, dy: -18 },
        { dx: -25, dy: 42 },
        { dx: 80, dy: 22 },
        { dx: -80, dy: 12 },
        { dx: 18, dy: -52 },
        { dx: -35, dy: -10 },
        { dx: 40, dy: 45 }
      ];

      glints.forEach((g, i) => {
        const pulse = Math.sin(now * 0.0035 + i * 1.3);
        if (pulse > 0.15) {
          const gx = lakeCx + g.dx;
          const gy = lakeCy + g.dy;
          const r = 2.4 * pulse;
          ctx.fillStyle = `rgba(255, 252, 235, ${(pulse * 0.85).toFixed(2)})`;
          ctx.beginPath();
          ctx.moveTo(gx, gy - r);
          ctx.lineTo(gx + r, gy);
          ctx.lineTo(gx, gy + r);
          ctx.lineTo(gx - r, gy);
          ctx.closePath();
          ctx.fill();
        }
      });

      // Brook riffle sparkles
      for (let i = 0; i < 4; i++) {
        const ry = 780 + i * 110;
        const rx = 912 + Math.sin((ry - 704) * 0.012) * 28 + Math.cos((ry - 704) * 0.025) * 14;
        const pulse = Math.sin(now * 0.004 + i * 1.7);
        if (pulse > 0.2) {
          ctx.fillStyle = `rgba(240, 252, 255, ${(pulse * 0.7).toFixed(2)})`;
          ctx.fillRect(rx - 2, ry, 4, 1.5);
        }
      }

      // 2. Valley mist wisps (subtle drifting ambient fog)
      const mistDrift = ((now * 0.008) % 3456) - 1024;
      ctx.fillStyle = 'rgba(200, 215, 235, 0.06)';
      ctx.beginPath();
      ctx.ellipse(mistDrift, 160, 200, 24, 0.02, 0, Math.PI * 2);
      ctx.fill();

      // 3. Distant soaring hawks (2 circling parametric birds)
      const hawkTime = now * 0.0006;
      const h1x = -150 + Math.cos(hawkTime) * 180;
      const h1y = 90 + Math.sin(hawkTime) * 55;
      const h1Angle = Math.atan2(Math.cos(hawkTime) * 55, -Math.sin(hawkTime) * 180);
      const h1Flap = Math.sin(now * 0.006);
      this.drawSoaringHawk(ctx, h1x, h1y, h1Angle, h1Flap);

      const h2Time = now * 0.00045 + 2.5;
      const h2x = 1650 + Math.cos(h2Time) * 220;
      const h2y = 80 + Math.sin(h2Time) * 65;
      const h2Angle = Math.atan2(Math.cos(h2Time) * 65, -Math.sin(h2Time) * 220);
      const h2Flap = Math.sin(now * 0.005 + 1.2);
      this.drawSoaringHawk(ctx, h2x, h2y, h2Angle, h2Flap);

      // 4. Summer pollen motes / floating petal particles (16 drifting motes)
      for (let i = 0; i < 16; i++) {
        const seedOffset = i * 211;
        const px = (((seedOffset - now * 0.02) % 3000) + 3000) % 3000 - 800;
        const py = (((seedOffset * 3 + now * 0.015 + Math.sin(now * 0.002 + i) * 12) % 2400) + 2400) % 2400 - 400;
        const alpha = 0.4 + 0.3 * Math.sin(now * 0.003 + i);
        if (i % 3 === 0) {
          ctx.fillStyle = `rgba(255, 215, 225, ${alpha.toFixed(2)})`;
          ctx.fillRect(px, py, 2, 2);
        } else {
          ctx.fillStyle = `rgba(255, 245, 180, ${alpha.toFixed(2)})`;
          ctx.fillRect(px, py, 1.5, 1.5);
        }
      }
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
        const margin = this.vistaMargin || 0;
        ctx.drawImage(this.vistaCanvas, -margin, -margin);
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

            // Wall drop shadow onto floor or ground below
            if (y < map.height - 1 && map.getTile(x, y + 1) !== 10 && map.getTile(x, y + 1) !== 15) {
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

      // Pinned directly to the north wall in world space (scales naturally with camera zoom and dpr)
      const lx = 14.6 * TILE;
      const ly = 8.6 * TILE;
      const lw = 4.8 * TILE;
      const lh = 3.2 * TILE;

      const rx = 24.1 * TILE;
      const ry = 8.6 * TILE;
      const rw = 4.8 * TILE;
      const rh = 3.2 * TILE;

      if (camera) {
        const zoom = (camera.zoom && camera.zoom > 0) ? camera.zoom : 1.0;
        const viewX0 = camera.x;
        const viewY0 = camera.y;
        const viewX1 = camera.x + camera.width / zoom;
        const viewY1 = camera.y + camera.height / zoom;
        const boardMinX = Math.min(lx, rx);
        const boardMaxX = Math.max(lx + lw, rx + rw);
        const boardMinY = Math.min(ly, ry);
        const boardMaxY = Math.max(ly + lh, ry + rh);
        if (boardMaxX < viewX0 || boardMinX > viewX1 || boardMaxY < viewY0 || boardMinY > viewY1) {
          return;
        }
      }

      ctx.save();

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
    // Hydrocarbon Forge Character Engine (20x26px Top-Down 2.5D)
    // -------------------------------------------------------------------------
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

    drawHexBadge(ctx, x, y, radius, pal) {
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        const px = x + radius * Math.cos(angle);
        const py = y + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = pal.fill;
      ctx.fill();
      ctx.strokeStyle = '#22252A';
      ctx.lineWidth = 1.0;
      ctx.stroke();

      ctx.fillStyle = pal.highlight || '#FFFFFF';
      ctx.beginPath();
      ctx.arc(x, y, 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawPapersStack(ctx, x, y) {
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#718096';
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(x + i, y + i * 2, 7, 9);
        ctx.strokeRect(x + i, y + i * 2, 7, 9);
      }
    }

    drawCarriedDrink(ctx, x, y, drink) {
      ctx.save();
      ctx.lineWidth = 1.0;
      ctx.strokeStyle = '#22252A';
      const cupColor = (drink && drink.color) || '#F8FAFC';
      ctx.fillStyle = cupColor;
      this.drawRoundedRect(ctx, x, y, 5, 6, 1.2, true, true);
      ctx.beginPath();
      ctx.arc(x + 5, y + 3, 1.5, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.fillStyle = '#78350F';
      ctx.fillRect(x + 0.8, y + 0.8, 3.4, 1.2);
      ctx.restore();
    }

    drawHat(ctx, hatType) {
      ctx.save();
      ctx.strokeStyle = '#22252A';
      ctx.lineWidth = 1.8;

      switch (hatType) {
        case 'cap':
          ctx.fillStyle = '#E53E3E';
          this.drawRoundedRect(ctx, -6.5, -16.5, 13, 7.5, 3.5, true, true);
          ctx.fillStyle = '#B91C1C';
          this.drawRoundedRect(ctx, 2, -12, 8, 3, 1.5, true, true);
          ctx.beginPath();
          ctx.arc(0, -17, 1.2, 0, Math.PI * 2);
          ctx.fill();
          break;

        case 'beanie':
          ctx.fillStyle = '#EA580C';
          this.drawRoundedRect(ctx, -6.5, -17.5, 13, 8.5, 4, true, true);
          ctx.fillStyle = '#C2410C';
          this.drawRoundedRect(ctx, -7.5, -12.5, 15, 3.5, 1.5, true, true);
          ctx.fillStyle = '#FED7AA';
          ctx.beginPath();
          ctx.arc(0, -18.5, 2.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;

        case 'hard-hat':
          ctx.fillStyle = '#FACC15';
          this.drawRoundedRect(ctx, -7, -17.5, 14, 8.5, 4.5, true, true);
          ctx.fillStyle = '#CA8A04';
          this.drawRoundedRect(ctx, -8.5, -12, 17, 3, 1.5, true, true);
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(1, -15.5, 2.5, 2.5);
          break;

        case 'headphones':
          ctx.strokeStyle = '#1E293B';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(0, -8.5, 8.5, Math.PI * 0.88, Math.PI * 2.12);
          ctx.stroke();
          ctx.fillStyle = '#0D9488';
          this.drawRoundedRect(ctx, -9, -12, 3.5, 6.5, 1.8, true, true);
          this.drawRoundedRect(ctx, 5.5, -12, 3.5, 6.5, 1.8, true, true);
          break;

        case 'headset':
          ctx.strokeStyle = '#1E293B';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(0, -8.5, 8.5, Math.PI * 0.88, Math.PI * 2.12);
          ctx.stroke();
          ctx.fillStyle = '#F59E0B';
          this.drawRoundedRect(ctx, -8.5, -11.5, 3.5, 6, 1.5, true, true);
          ctx.strokeStyle = '#1E293B';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(-6.5, -8.5);
          ctx.quadraticCurveTo(0, -5.5, 4.2, -6.5);
          ctx.stroke();
          ctx.fillStyle = '#1E293B';
          ctx.beginPath();
          ctx.arc(4.8, -6.5, 1.3, 0, Math.PI * 2);
          ctx.fill();
          break;

        case 'beret':
          ctx.fillStyle = '#DC2626';
          ctx.beginPath();
          ctx.ellipse(0, -15, 8.5, 3.8, -0.18, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, -18.5);
          ctx.lineTo(0.8, -21);
          ctx.stroke();
          break;

        case 'crown':
          ctx.fillStyle = '#FBBF24';
          ctx.beginPath();
          ctx.moveTo(-6, -14);
          ctx.lineTo(-6, -19);
          ctx.lineTo(-3, -16);
          ctx.lineTo(0, -20);
          ctx.lineTo(3, -16);
          ctx.lineTo(6, -19);
          ctx.lineTo(6, -14);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#EF4444';
          ctx.beginPath();
          ctx.arc(0, -15.5, 1.2, 0, Math.PI * 2);
          ctx.fill();
          break;

        case 'wizard':
          ctx.fillStyle = '#7C3AED';
          ctx.beginPath();
          ctx.moveTo(-8, -14);
          ctx.lineTo(1, -25);
          ctx.lineTo(8, -14);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#FBBF24';
          ctx.beginPath();
          ctx.arc(0, -18, 1.8, 0, Math.PI * 2);
          ctx.fill();
          break;

        case 'halo':
          ctx.fillStyle = 'rgba(254, 240, 138, 0.45)';
          ctx.strokeStyle = '#FACC15';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.ellipse(0, -20, 8, 2.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;

        case 'bow':
          ctx.fillStyle = '#EF4444';
          ctx.beginPath();
          ctx.moveTo(1, -15);
          ctx.lineTo(-4, -18);
          ctx.lineTo(-4, -12);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(1, -15);
          ctx.lineTo(6, -18);
          ctx.lineTo(6, -12);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#B91C1C';
          ctx.beginPath();
          ctx.arc(1, -15, 1.8, 0, Math.PI * 2);
          ctx.fill();
          break;

        case 'antenna':
          ctx.strokeStyle = '#64748B';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(0, -15);
          ctx.lineTo(0, -22);
          ctx.stroke();
          ctx.fillStyle = '#38BDF8';
          ctx.beginPath();
          ctx.arc(0, -23, 2.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;
      }

      ctx.restore();
    }

    renderAvatar(ctx, x, y, options = {}) {
      const colorKey = options.color || 'coral';
      const hatKey = options.hat || 'none';
      const faceKey = options.face || 'plain';
      const frame = options.frame || 0;
      const facing = options.facing !== undefined ? options.facing : 1;
      const isSitting = options.isSitting || false;
      const isMoving = options.isMoving || false;
      const papers = options.papers || false;
      const heldItem = options.heldItem || options.carriedDrink || null;
      const scale = options.scale || 1.0;
      const pal = resolveColor(colorKey);

      const SUIT_BASE = '#3A3D44';
      const SUIT_DARK = '#26282D';
      const SKIN_TONE = '#FCD8B6';
      const HAIR_COLOR = '#2A2321';
      const BELT_LEATHER = '#4A3425';
      const BRASS_HARDWARE = '#D97706';

      ctx.save();
      if (options.alpha !== undefined) ctx.globalAlpha = Math.max(0, Math.min(1, options.alpha));
      ctx.translate(x, y);

      // Ground Drop Shadow
      ctx.fillStyle = 'rgba(15, 20, 28, 0.32)';
      ctx.beginPath();
      ctx.ellipse(0, 13 * scale, 10 * scale, 5 * scale, 0, 0, Math.PI * 2);
      ctx.fill();

      // Turn squash
      const squashX = options.squashX || 1.0;
      const squashY = options.squashY || 1.0;
      ctx.scale(squashX, squashY);

      // Sinusoidal walk bob
      const walkPhase = (frame % 4) / 4;
      const bob = isMoving ? Math.sin(walkPhase * Math.PI * 2) * 1.5 * scale : 0;
      ctx.translate(0, bob);

      ctx.scale(facing, 1);
      ctx.scale(scale, scale);

      // 1. Back Arm (behind body)
      const f = isMoving ? (frame % 4) : 1;
      let backArmOffset = 0;
      let frontArmOffset = 0;
      if (isMoving && !isSitting) {
        if (f === 0) { backArmOffset = -2; frontArmOffset = 2; }
        else if (f === 2) { backArmOffset = 2; frontArmOffset = -2; }
      }
      ctx.strokeStyle = '#22252A';
      ctx.lineWidth = 1.8;
      ctx.fillStyle = SUIT_DARK;
      this.drawRoundedRect(ctx, -7.5 + backArmOffset, -2, 3.5, 7.5, 1.8, true, true);
      ctx.fillStyle = '#26282D';
      this.drawRoundedRect(ctx, -7.5 + backArmOffset, 4.5, 3.5, 2.5, 1.2, true, true);

      // 2. Satchel / Toolbelt accessories (drawn behind front body)
      if (options.isAgentC6 || options.forgeTool) {
        ctx.save();
        ctx.fillStyle = '#94A3B8';
        ctx.strokeStyle = '#22252A';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-6, 3);
        ctx.lineTo(-10, -2);
        ctx.lineTo(-11.5, -1);
        ctx.lineTo(-7.5, 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#CBD5E1';
        ctx.beginPath();
        ctx.arc(-11, -1.5, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#22252A';
        ctx.fillRect(-12.5, -2.5, 2, 2);
        ctx.restore();
      }
      if (options.hasSatchel !== false && !options.isAgentC6) {
        ctx.fillStyle = '#5A3D28';
        this.drawRoundedRect(ctx, -8.5, 2, 4.5, 6, 1.5, true, true);
        ctx.fillStyle = '#784E34';
        this.drawRoundedRect(ctx, -8.5, 2, 4.5, 2.8, 1, true, false);
        ctx.fillStyle = BRASS_HARDWARE;
        ctx.fillRect(-6.5, 4, 1.2, 1.2);
      }

      // 3. Legs & Feet
      if (isSitting) {
        ctx.fillStyle = SUIT_BASE;
        this.drawRoundedRect(ctx, -5, 6, 10, 4.5, 2, true, true);
        ctx.fillStyle = '#22252A';
        this.drawRoundedRect(ctx, -4, 9, 8, 4, 2, true, true);
      } else {
        let leftX = -5.5, leftY = 7, leftH = 6.5;
        let rightX = 1.5, rightY = 7, rightH = 6.5;
        if (isMoving) {
          if (f === 0) { leftX = -7; leftY = 6.5; leftH = 6; rightX = 2.5; rightY = 7.5; rightH = 6.5; }
          else if (f === 2) { leftX = -4; leftY = 7.5; leftH = 6.5; rightX = 0; rightY = 6.5; rightH = 6; }
        }
        // Back Leg
        ctx.fillStyle = SUIT_DARK;
        this.drawRoundedRect(ctx, leftX, leftY, 4.2, leftH, 2, true, true);
        ctx.fillStyle = '#22252A';
        this.drawRoundedRect(ctx, leftX - 0.5, leftY + leftH - 3, 5, 3.5, 1.5, true, true);

        // Front Leg
        ctx.fillStyle = SUIT_BASE;
        this.drawRoundedRect(ctx, rightX, rightY, 4.5, rightH, 2, true, true);
        ctx.fillStyle = pal.fill;
        ctx.fillRect(rightX, rightY + rightH - 3.2, 4.5, 1.2);
        ctx.fillStyle = '#282B30';
        this.drawRoundedRect(ctx, rightX - 0.5, rightY + rightH - 3, 5.5, 3.5, 1.5, true, true);
        ctx.fillStyle = '#1A1D20';
        ctx.fillRect(rightX - 0.5, rightY + rightH - 1, 5.5, 1);
      }

      // 4. Overalls Torso
      ctx.fillStyle = SUIT_BASE;
      this.drawRoundedRect(ctx, -7, -4, 13, 11.5, 3.5, true, true);
      // Dark side contour
      ctx.fillStyle = SUIT_DARK;
      ctx.fillRect(-7, 0, 1.5, 7);

      // Leather Utility Belt
      ctx.fillStyle = BELT_LEATHER;
      this.drawRoundedRect(ctx, -7.5, 5.5, 14, 2.5, 1, true, true);
      ctx.fillStyle = BRASS_HARDWARE;
      ctx.fillRect(1, 5.5, 2.2, 2.5);

      // Hex Chest Badge (Carbon-6 motif)
      this.drawHexBadge(ctx, 2.2, 0.5, 2.6, pal);

      // Pocket Seam
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-4, 3.5);
      ctx.lineTo(0, 3.5);
      ctx.stroke();

      // Collar or Scarf
      if (options.hasScarf || options.isAgentClaude) {
        const scarfCol = options.scarfColor || '#E07A5F';
        ctx.fillStyle = scarfCol;
        ctx.strokeStyle = '#22252A';
        ctx.lineWidth = 1.5;
        this.drawRoundedRect(ctx, -5, -4.5, 10, 3.5, 1.8, true, true);
        this.drawRoundedRect(ctx, -1, -2, 3.2, 7, 1.2, true, true);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.fillRect(-1, 3.5, 3.2, 1);
      } else {
        ctx.fillStyle = pal.fill;
        this.drawRoundedRect(ctx, -3.5, -4.5, 7.5, 2.2, 1, true, true);
      }

      // 5. Head & Hair
      ctx.fillStyle = HAIR_COLOR;
      ctx.strokeStyle = '#22252A';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, -9.5, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Warm face skin oval
      ctx.fillStyle = SKIN_TONE;
      ctx.beginPath();
      ctx.ellipse(1.0, -9.0, 5.2, 4.8, 0, 0, Math.PI * 2);
      ctx.fill();

      // Hair bangs sweep over top
      ctx.fillStyle = HAIR_COLOR;
      ctx.beginPath();
      ctx.moveTo(-6, -11);
      ctx.bezierCurveTo(-4, -15, 3, -15, 5.5, -11.5);
      ctx.quadraticCurveTo(2, -12.5, -1, -12);
      ctx.quadraticCurveTo(-3, -11.5, -6, -11);
      ctx.closePath();
      ctx.fill();

      // Ear
      ctx.fillStyle = SKIN_TONE;
      ctx.beginPath();
      ctx.arc(-4.5, -9, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 6. Eyes & Face Details
      ctx.fillStyle = '#20232A';
      ctx.beginPath();
      ctx.arc(-0.8, -9.5, 1.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(3.2, -9.5, 1.0, 0, Math.PI * 2);
      ctx.fill();

      // Catchlight twinkles
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(-0.6, -10.2, 0.6, 0.6);
      ctx.fillRect(3.4, -10.2, 0.6, 0.6);

      // Micro-smile
      ctx.strokeStyle = '#C97A63';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.arc(1.2, -7.5, 1.2, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();

      // Face Customizations
      const effectiveFace = (faceKey === 'classic' || faceKey === 'plain') ? 'plain' : faceKey;
      if (effectiveFace === 'glasses' || options.isAgentOpenCode) {
        ctx.strokeStyle = '#1E293B';
        ctx.lineWidth = 1.3;
        ctx.strokeRect(-2.2, -11.2, 3.2, 3.4);
        ctx.strokeRect(1.8, -11.2, 3.4, 3.4);
        ctx.beginPath();
        ctx.moveTo(1.0, -9.6);
        ctx.lineTo(1.8, -9.6);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.fillRect(-1.5, -10.6, 1.2, 0.8);
        ctx.fillRect(2.5, -10.6, 1.2, 0.8);
      } else if (effectiveFace === 'blush' || options.isAgentC6) {
        ctx.fillStyle = 'rgba(244, 63, 94, 0.55)';
        ctx.beginPath();
        ctx.ellipse(-1.2, -7.6, 1.4, 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(3.4, -7.6, 1.4, 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (effectiveFace === 'freckles') {
        ctx.fillStyle = '#9A5B32';
        ctx.fillRect(-1.2, -7.8, 0.7, 0.7);
        ctx.fillRect(1.1, -8.2, 0.7, 0.7);
        ctx.fillRect(3.2, -7.8, 0.7, 0.7);
      }

      // Forehead Goggles (C6 or goggles/cyborg face option)
      if (effectiveFace === 'goggles' || effectiveFace === 'cyborg' || options.isAgentC6) {
        ctx.save();
        ctx.strokeStyle = '#451A03';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-6.5, -13);
        ctx.lineTo(5.5, -13);
        ctx.stroke();
        ctx.fillStyle = '#92400E';
        this.drawRoundedRect(ctx, -2.5, -15.5, 3.5, 3.5, 1, true, true);
        this.drawRoundedRect(ctx, 1.8, -15.5, 3.5, 3.5, 1, true, true);
        ctx.fillStyle = '#38BDF8';
        ctx.fillRect(-1.8, -14.8, 2.1, 2.1);
        ctx.fillRect(2.5, -14.8, 2.1, 2.1);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(-1.2, -14.4, 0.8, 0.8);
        ctx.fillRect(3.1, -14.4, 0.8, 0.8);
        ctx.restore();
      }

      // 7. Hats & Headgear
      if (hatKey && hatKey !== 'none') {
        this.drawHat(ctx, hatKey);
      }

      // 8. Front Arm & Carried Items
      if (papers || heldItem) {
        ctx.fillStyle = SUIT_BASE;
        this.drawRoundedRect(ctx, 1.5, -2, 3.8, 5.5, 1.8, true, true);
        this.drawRoundedRect(ctx, 3.5, 1, 5, 3.2, 1.5, true, true);
        ctx.fillStyle = pal.fill;
        ctx.fillRect(3.5, 1, 1.5, 3.2);
        ctx.fillStyle = SKIN_TONE;
        this.drawRoundedRect(ctx, 7.5, 1, 2.5, 2.8, 1, true, true);
        if (papers) this.drawPapersStack(ctx, 7, -1);
        else if (heldItem) this.drawCarriedDrink(ctx, 8, 0, heldItem);
      } else {
        ctx.fillStyle = SUIT_BASE;
        this.drawRoundedRect(ctx, 2.5 + frontArmOffset, -2, 3.6, 7.5, 1.8, true, true);
        ctx.fillStyle = pal.fill;
        ctx.fillRect(2.5 + frontArmOffset, 3.5, 3.6, 1.2);
        ctx.fillStyle = SKIN_TONE;
        this.drawRoundedRect(ctx, 2.5 + frontArmOffset, 4.5, 3.5, 2.5, 1.2, true, true);
      }

      ctx.restore();
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
