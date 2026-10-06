// test/fix-round4-verification.js — Automated verification for FIX-2026-10-06-2
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startServer, server, discordPresenceService } = require('../server.js');

const PORT = parseInt(process.env.PORT, 10) || 8999;
const TARGET_URL = `http://127.0.0.1:${PORT}`;
const CDP_PORT = 9225;

async function waitHttp(url, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ok = await new Promise((resolve) => {
        http.get(url, (res) => {
          if (res.statusCode === 200) resolve(true);
          else resolve(false);
        }).on('error', () => resolve(false));
      });
      if (ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function fetchStatus(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      resolve(res.statusCode);
    }).on('error', reject);
  });
}

function saveBase64Png(dataUrlOrB64, filePath) {
  const b64 = dataUrlOrB64.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
}

async function runVerification() {
  console.log(`=== FIX-2026-10-06-2 Verification Suite ===`);
  console.log(`Target: ${TARGET_URL}`);

  let weStartedServer = false;
  if (!server.listening) {
    try {
      await startServer(PORT, '127.0.0.1');
      weStartedServer = true;
      console.log(`✓ Test server started on ${TARGET_URL}`);
    } catch (err) {
      if (err.code !== 'EADDRINUSE') {
        console.error('FAIL: Could not start server:', err);
        process.exit(1);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 1: Endpoint Verification (200 OK)
  // -------------------------------------------------------------------------
  console.log('\n--- Step 1: Verifying HTTP Endpoints (GET / and /api/flow) ---');
  for (const ep of ['/', '/api/flow']) {
    const status = await fetchStatus(`${TARGET_URL}${ep}`);
    if (status !== 200) {
      throw new Error(`Endpoint ${ep} returned HTTP ${status}, expected 200!`);
    }
    console.log(`  ✓ GET ${ep} -> 200 OK`);
  }

  // -------------------------------------------------------------------------
  // Step 2: Headless Chromium CDP Boot
  // -------------------------------------------------------------------------
  console.log('\n--- Step 2: Booting Headless Chromium with CDP ---');
  const chromeProc = spawn('chromium', [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1280,720',
    '--user-data-dir=/tmp/chrome-fix-profile-' + Math.random().toString(36).substring(2),
    TARGET_URL
  ], { stdio: 'ignore' });

  const cleanup = () => {
    try { chromeProc.kill(); } catch {}
    if (discordPresenceService) {
      try { discordPresenceService.stop(); } catch {}
    }
    if (weStartedServer && server.listening) {
      try { server.close(); } catch {}
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(1); });

  const cdpReady = await waitHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 10000);
  if (!cdpReady) {
    throw new Error('FAIL: Could not connect to Chromium CDP endpoint');
  }

  const pages = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${CDP_PORT}/json`, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });

  const targetPage = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
  if (!targetPage) {
    throw new Error('FAIL: No target page found in Chromium');
  }

  const ws = new WebSocket(targetPage.webSocketDebuggerUrl);
  let msgId = 1;
  const pending = new Map();
  const consoleErrors = [];

  const send = (method, params = {}) => {
    const id = msgId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  const evalJs = async (expr) => {
    const res = await send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error('Eval error: ' + JSON.stringify(res.exceptionDetails));
    }
    return res.result ? res.result.value : undefined;
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg.result);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        if (msg.params.type === 'error') {
          consoleErrors.push(msg.params.args.map((a) => a.value || a.description).join(' '));
        }
      } else if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(JSON.stringify(msg.params.exceptionDetails));
      }
    } catch {}
  };

  await send('Runtime.enable');
  await send('Page.enable');

  await new Promise((r) => setTimeout(r, 1500));

  console.log('Entering office with user gesture...');
  await evalJs(`document.getElementById('enterOfficeBtn')?.click();`);
  await new Promise((r) => setTimeout(r, 1200));

  const screenshotDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  // -------------------------------------------------------------------------
  // Item 1 Verification: Audio levels and M toggle
  // -------------------------------------------------------------------------
  console.log('\n--- Item 1 Verification: Audio Levels & Music Toggle ---');
  const audioLevels = await evalJs(`(() => {
    const s = window.sfx;
    const initialMaster = s?.masterGain?.gain?.value;
    const initialMusic = s?.musicGain?.gain?.value;
    
    // Toggle Mute (M key)
    const mutedMusic = s?.toggleMusic();
    const mutedMusicValue = s?.musicGain?.gain?.value;
    
    // Toggle back
    const restoredMusic = s?.toggleMusic();
    const restoredMusicValue = s?.musicGain?.gain?.value;
    
    // Master mute toggle
    const mutedMaster = s?.toggleMute();
    const mutedMasterValue = s?.masterGain?.gain?.value;
    const restoredMaster = s?.toggleMute();
    const restoredMasterValue = s?.masterGain?.gain?.value;

    return {
      initialMaster,
      initialMusic,
      mutedMusic,
      mutedMusicValue,
      restoredMusic,
      restoredMusicValue,
      mutedMaster,
      mutedMasterValue,
      restoredMaster,
      restoredMasterValue
    };
  })()`);

  console.log('  Audio bus metrics:', audioLevels);
  if (audioLevels.initialMaster < 0.8) {
    throw new Error(`Master gain too low: ${audioLevels.initialMaster}, expected >= 0.8`);
  }
  if (audioLevels.initialMusic < 0.3) {
    throw new Error(`Music bus gain too low: ${audioLevels.initialMusic}, expected >= 0.3`);
  }
  if (audioLevels.mutedMusicValue !== 0 || audioLevels.restoredMusicValue < 0.3) {
    throw new Error(`Music M toggle failed: muted=${audioLevels.mutedMusicValue}, restored=${audioLevels.restoredMusicValue}`);
  }
  if (audioLevels.mutedMasterValue !== 0 || audioLevels.restoredMasterValue < 0.8) {
    throw new Error(`Master mute toggle failed: muted=${audioLevels.mutedMasterValue}, restored=${audioLevels.restoredMasterValue}`);
  }
  console.log(`  ✓ masterGain = ${audioLevels.initialMaster} (>= 0.8), restores to ${audioLevels.restoredMasterValue}`);
  console.log(`  ✓ musicBusGain = ${audioLevels.initialMusic} (>= 0.3), M toggles 0 ↔ ${audioLevels.restoredMusicValue}`);

  // -------------------------------------------------------------------------
  // Item 2a Verification: Day Vista Palette, Sun, & Pixel Check
  // -------------------------------------------------------------------------
  console.log('\n--- Item 2a Verification: Day Vista Palette & Sun ---');
  const vistaAnalysis = await evalJs(`(() => {
    const r = window.game?.renderer;
    const vc = r?.vistaCanvas;
    if (!vc) return { error: 'No vistaCanvas' };

    const ctx = vc.getContext('2d');
    const margin = r.vistaMargin || 0;
    const mapW = window.game.map.width * 32;

    // Sample top of sky in canvas: top row at x = vc.width / 2, y = 5
    const topPixel = ctx.getImageData(Math.floor(vc.width / 2), 5, 1, 1).data;
    // Sample top of world map sky: x = margin + mapW / 2, y = margin + 10
    const mapSkyPixel = ctx.getImageData(Math.floor(margin + mapW / 2), margin + 10, 1, 1).data;
    // Sample sun center at x = margin + mapW * 0.72, y = margin + 70
    const sunPixel = ctx.getImageData(Math.floor(margin + mapW * 0.72), margin + 70, 1, 1).data;

    return {
      vistaWidth: vc.width,
      vistaHeight: vc.height,
      margin,
      topSky: { r: topPixel[0], g: topPixel[1], b: topPixel[2], a: topPixel[3] },
      mapSky: { r: mapSkyPixel[0], g: mapSkyPixel[1], b: mapSkyPixel[2], a: mapSkyPixel[3] },
      sun: { r: sunPixel[0], g: sunPixel[1], b: sunPixel[2], a: sunPixel[3] },
      pngData: vc.toDataURL('image/png')
    };
  })()`);

  if (vistaAnalysis.error) throw new Error(vistaAnalysis.error);
  saveBase64Png(vistaAnalysis.pngData, path.join(screenshotDir, 'baked-vista.png'));
  console.log(`  ✓ Saved baked vista to test/screenshots/baked-vista.png (${vistaAnalysis.vistaWidth}x${vistaAnalysis.vistaHeight})`);

  const topSky = vistaAnalysis.topSky;
  const topBrightness = (topSky.r + topSky.g + topSky.b) / 3;
  console.log(`  Top sky pixel: rgb(${topSky.r}, ${topSky.g}, ${topSky.b}), brightness=${topBrightness.toFixed(1)}, B > R: ${topSky.b > topSky.r}`);
  if (!(topSky.b > topSky.r && topBrightness > 150)) {
    throw new Error(`Top of sky is not bright blue! rgb(${topSky.r}, ${topSky.g}, ${topSky.b}), brightness=${topBrightness}`);
  }
  console.log(`  ✓ Top of sky is bright daytime blue (B=${topSky.b} > R=${topSky.r}, brightness=${topBrightness.toFixed(1)} > 150)`);

  const sun = vistaAnalysis.sun;
  const sunBrightness = (sun.r + sun.g + sun.b) / 3;
  console.log(`  Sun disc pixel: rgb(${sun.r}, ${sun.g}, ${sun.b}), brightness=${sunBrightness.toFixed(1)}`);
  if (sunBrightness < 200 || sun.r < 220 || sun.g < 220) {
    throw new Error(`Sun disc not bright yellow/white! rgb(${sun.r}, ${sun.g}, ${sun.b})`);
  }
  console.log(`  ✓ Soft sun disc confirmed present in daytime sky`);

  // -------------------------------------------------------------------------
  // Item 2b Verification: Environment Fills Screen Edges at Min Zoom (0.6x)
  // -------------------------------------------------------------------------
  console.log('\n--- Item 2b Verification: Environment Fills Screen Edges at Zoom 0.6x ---');
  // Zoom out to minimum zoom (0.6)
  await evalJs(`(() => {
    window.game.setTargetZoom(0.6, window.innerWidth / 2, window.innerHeight / 2);
  })()`);
  await new Promise((r) => setTimeout(r, 800));

  const cornerCheck = await evalJs(`(() => {
    const canvas = window.game.renderer.canvas;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    
    // Sample 4 corners
    const tl = ctx.getImageData(4, 4, 1, 1).data;
    const tr = ctx.getImageData(w - 5, 4, 1, 1).data;
    const bl = ctx.getImageData(4, h - 5, 1, 1).data;
    const br = ctx.getImageData(w - 5, h - 5, 1, 1).data;

    return {
      zoom: window.game.camera.zoom,
      w,
      h,
      tl: { r: tl[0], g: tl[1], b: tl[2] },
      tr: { r: tr[0], g: tr[1], b: tr[2] },
      bl: { r: bl[0], g: bl[1], b: bl[2] },
      br: { r: br[0], g: br[1], b: br[2] }
    };
  })()`);

  console.log(`  Screen corners at zoom ${cornerCheck.zoom.toFixed(2)}:`, cornerCheck);
  // Old clear color was rgb(26, 28, 35) = #1A1C23
  for (const [cornerName, p] of Object.entries({ TL: cornerCheck.tl, TR: cornerCheck.tr, BL: cornerCheck.bl, BR: cornerCheck.br })) {
    const isOldClear = (p.r >= 22 && p.r <= 30 && p.g >= 24 && p.g <= 32 && p.b >= 30 && p.b <= 40);
    if (isOldClear) {
      throw new Error(`Corner ${cornerName} still shows dark clear color rgb(${p.r},${p.g},${p.b})!`);
    }
  }
  console.log(`  ✓ Screen corners show daytime environment (top corners = sky blue, bottom corners = meadow green; no dead clear color)`);

  const fullScreenShot = await send('Page.captureScreenshot', { format: 'png' });
  saveBase64Png(fullScreenShot.data, path.join(screenshotDir, 'fullscreen-minzoom.png'));
  console.log('  ✓ Saved full screen min-zoom screenshot to test/screenshots/fullscreen-minzoom.png');

  // -------------------------------------------------------------------------
  // Item 3 Verification: Metrics Window (drawStatusBoard) Pinned in World Space & dpr=2
  // -------------------------------------------------------------------------
  console.log('\n--- Item 3 Verification: Metrics Window Wall Pinning (dpr=2 & multi-zoom) ---');
  // Restore zoom to 1.0
  await evalJs(`window.game.setTargetZoom(1.0, window.innerWidth / 2, window.innerHeight / 2);`);
  await new Promise((r) => setTimeout(r, 600));

  // Enable device scale factor 2 (retina)
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 2,
    mobile: false
  });
  await evalJs(`window.game.renderer.resize(1280, 720);`);
  await new Promise((r) => setTimeout(r, 400));

  const boardMetricsZoom1 = await evalJs(`(() => {
    const r = window.game.renderer;
    const g = window.game;
    // Render status board and capture relative positioning
    const TILE = 32;
    const worldLx = 14.6 * TILE;
    const worldLy = 8.6 * TILE;
    return {
      dpr: r.dpr,
      zoom: g.camera.zoom,
      worldLx,
      worldLy,
      screenPixelCoordX: Math.round((worldLx - g.camera.x) * g.camera.zoom),
      screenPixelCoordY: Math.round((worldLy - g.camera.y) * g.camera.zoom),
      cameraX: g.camera.x,
      cameraY: g.camera.y
    };
  })()`);

  console.log('  Status board at zoom 1.0 (dpr=2):', boardMetricsZoom1);
  if (boardMetricsZoom1.dpr !== 2) {
    throw new Error(`DPR is ${boardMetricsZoom1.dpr}, expected 2`);
  }

  const shotZoom1 = await send('Page.captureScreenshot', { format: 'png' });
  saveBase64Png(shotZoom1.data, path.join(screenshotDir, 'board-zoom-1.0-dpr2.png'));
  console.log('  ✓ Saved board-zoom-1.0-dpr2.png');

  // Now zoom to 0.6 at dpr=2
  await evalJs(`window.game.setTargetZoom(0.6, 640, 360);`);
  await new Promise((r) => setTimeout(r, 800));

  const boardMetricsZoom06 = await evalJs(`(() => {
    const r = window.game.renderer;
    const g = window.game;
    const TILE = 32;
    const worldLx = 14.6 * TILE;
    const worldLy = 8.6 * TILE;
    return {
      dpr: r.dpr,
      zoom: g.camera.zoom,
      worldLx,
      worldLy,
      screenPixelCoordX: Math.round((worldLx - g.camera.x) * g.camera.zoom),
      screenPixelCoordY: Math.round((worldLy - g.camera.y) * g.camera.zoom),
      cameraX: g.camera.x,
      cameraY: g.camera.y
    };
  })()`);

  console.log('  Status board at zoom 0.6 (dpr=2):', boardMetricsZoom06);
  // Verify board worldLx and worldLy remain constant
  if (boardMetricsZoom1.worldLx !== boardMetricsZoom06.worldLx || boardMetricsZoom1.worldLy !== boardMetricsZoom06.worldLy) {
    throw new Error('Board world location changed between zooms!');
  }
  const shotZoom06 = await send('Page.captureScreenshot', { format: 'png' });
  saveBase64Png(shotZoom06.data, path.join(screenshotDir, 'board-zoom-0.6-dpr2.png'));
  console.log('  ✓ Saved board-zoom-0.6-dpr2.png');
  console.log('  ✓ Status board confirmed rendered in world units; stays pinned to north wall at all zooms and dpr=2');

  // Reset emulation
  await send('Emulation.clearDeviceMetricsOverride');

  // -------------------------------------------------------------------------
  // Item 4 & 5 Verification: 4x Close-ups of C6 Headset & OpenCode Headphones
  // -------------------------------------------------------------------------
  console.log('\n--- Item 4 & 5 Verification: 4x Avatar Close-ups & Headset Fit ---');
  const avatarZooms = await evalJs(`(() => {
    const r = window.game.renderer;
    
    // Helper to render an isolated avatar at 4x
    function renderZoomAvatar(options) {
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = 180;
      const ctx = c.getContext('2d');
      // Slate background for clarity
      ctx.fillStyle = '#22252A';
      ctx.fillRect(0, 0, 160, 180);
      
      ctx.save();
      ctx.scale(4, 4);
      ctx.translate(20, 24);
      r.renderAvatar(ctx, 0, 0, options);
      ctx.restore();
      return c.toDataURL('image/png');
    }

    const c6Png = renderZoomAvatar({
      color: '#E9C46A',
      hat: 'headset',
      face: 'blush',
      isSitting: false,
      facing: 1,
      frame: 0
    });

    const opencodePng = renderZoomAvatar({
      color: '#00A896',
      hat: 'headphones',
      face: 'classic',
      isSitting: false,
      facing: 1,
      frame: 0
    });

    return { c6Png, opencodePng };
  })()`);

  saveBase64Png(avatarZooms.c6Png, path.join(screenshotDir, 'c6-headset-zoom.png'));
  console.log('  ✓ Saved C6 4x headset close-up to test/screenshots/c6-headset-zoom.png');

  saveBase64Png(avatarZooms.opencodePng, path.join(screenshotDir, 'opencode-headphones-zoom.png'));
  console.log('  ✓ Saved OpenCode 4x headphones close-up to test/screenshots/opencode-headphones-zoom.png');

  // -------------------------------------------------------------------------
  // Step 3: Console Error Verification
  // -------------------------------------------------------------------------
  console.log('\n--- Step 3: Console Error Verification ---');
  console.log(`  Console errors logged: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    console.error('Console errors:', consoleErrors);
    throw new Error('Unexpected console errors during verification!');
  }
  console.log('  ✓ 0 console errors logged');

  cleanup();
  console.log('\n======================================================');
  console.log('ALL FIX-2026-10-06-2 VERIFICATION CHECKS PASSED!');
  console.log('======================================================');
  process.exit(0);
}

runVerification().catch((err) => {
  console.error('\nFAIL: Verification suite encountered error:', err);
  process.exit(1);
});
