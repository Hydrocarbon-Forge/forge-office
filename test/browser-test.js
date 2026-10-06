// test/browser-test.js — In-browser boot check using headless Chromium and CDP
const http = require('node:http');
const { spawn } = require('node:child_process');
const { startServer, server } = require('../server.js');

const PORT = parseInt(process.env.PORT, 10) || 8999;
const TARGET_URL = `http://127.0.0.1:${PORT}`;
const CDP_PORT = 9223;

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

async function runBrowserTest() {
  console.log(`--- Starting Headless Chromium Boot Check against ${TARGET_URL} ---`);

  let weStartedServer = false;
  if (!server.listening) {
    try {
      await startServer(PORT, '127.0.0.1');
      weStartedServer = true;
      console.log(`Test server started on ${TARGET_URL}`);
    } catch (err) {
      if (err.code !== 'EADDRINUSE') {
        console.error('FAIL: Could not start server:', err);
        process.exit(1);
      }
    }
  }

  const chromeProc = spawn('chromium', [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${CDP_PORT}`,
    '--user-data-dir=/tmp/chrome-test-profile-' + Math.random().toString(36).substring(2),
    TARGET_URL
  ], { stdio: 'ignore' });

  const cleanup = () => {
    try { chromeProc.kill(); } catch {}
    if (weStartedServer && server.listening) {
      try { server.close(); } catch {}
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(1); });

  const cdpReady = await waitHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 10000);
  if (!cdpReady) {
    console.error('FAIL: Could not connect to Chromium CDP endpoint');
    cleanup();
    process.exit(1);
  }

  // Get target page WebSocket URL
  const pages = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${CDP_PORT}/json`, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });

  const page = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
  if (!page) {
    console.error('FAIL: No target page found in Chromium', pages);
    cleanup();
    process.exit(1);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);

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

  // Wait 1.5s for page scripts to load and init
  await new Promise((r) => setTimeout(r, 1500));

  // 1. Verify start screen identity cards
  console.log('Step A: Checking start screen profile cards...');
  const cardCheck = await evalJs(`({
    nathan: !!document.getElementById('cardNathan'),
    gavin: !!document.getElementById('cardGavin'),
    guest: !!document.getElementById('cardGuest'),
    nathanSelected: document.getElementById('cardNathan')?.classList.contains('selected'),
    canvas: !!document.getElementById('officeCanvas'),
    gameExists: !!(window.forgeOfficeGame || window.game)
  })`);
  console.log('Start screen check:', cardCheck);
  if (!cardCheck.nathan || !cardCheck.gavin || !cardCheck.guest) {
    throw new Error('Missing profile cards on start screen');
  }

  // 2. Select Nathan card & Click ENTER OFFICE
  console.log('Step B: Selecting Nathan profile and entering office...');
  await evalJs(`document.getElementById('cardNathan').click();`);
  await evalJs(`document.getElementById('enterOfficeBtn').click();`);
  await new Promise((r) => setTimeout(r, 1200));

  const afterEnter = await evalJs(`(() => {
    const g = window.forgeOfficeGame || window.game;
    return {
      gameStarted: g?.gameStarted,
      playerName: g?.player?.name,
      playerProfile: g?.player?.profile,
      playerColor: g?.player?.cosmetics?.color,
      playerHat: g?.player?.cosmetics?.hat
    };
  })()`);
  console.log('After enter office check:', afterEnter);
  if (!afterEnter.gameStarted || afterEnter.playerProfile !== 'nathan') {
    throw new Error('Game did not start with Nathan profile: ' + JSON.stringify(afterEnter));
  }

  // 3. Check minimap is visible and rendered
  console.log('Step C: Checking minimap panel...');
  const minimapCheck = await evalJs(`(() => {
    const g = window.forgeOfficeGame || window.game;
    return {
      panelExists: !!document.getElementById('minimapPanel'),
      canvasExists: !!document.getElementById('minimapCanvas'),
      canvasW: document.getElementById('minimapCanvas')?.width,
      canvasH: document.getElementById('minimapCanvas')?.height,
      isCollapsed: document.getElementById('minimapPanel')?.classList.contains('collapsed'),
      roomsCount: g?.getMinimapRooms()?.length
    };
  })()`);
  console.log('Minimap check:', minimapCheck);
  if (!minimapCheck.panelExists || minimapCheck.isCollapsed || minimapCheck.roomsCount < 7) {
    throw new Error('Minimap panel not rendered properly: ' + JSON.stringify(minimapCheck));
  }

  // 4. Test Minimap toggle with 'B' key
  console.log('Step D: Testing minimap toggle with B key...');
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB' }));`);
  const collapsedState = await evalJs(`document.getElementById('minimapPanel').classList.contains('collapsed')`);
  console.log('Minimap collapsed after B key:', collapsedState);
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB' }));`);

  // 5. Check CLOCK panel opens with 'K' key
  console.log('Step E: Opening CLOCK panel with K key...');
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK' }));`);
  await new Promise((r) => setTimeout(r, 500));
  const clockCheck = await evalJs(`({
    clockOpen: !document.getElementById('clockModal')?.classList.contains('hidden'),
    nathanBlock: !!document.getElementById('nathanClockBlock'),
    gavinBlock: !!document.getElementById('gavinClockBlock'),
    nathanStatusText: document.getElementById('nathanOfficeStatus')?.innerText,
    gavinStatusText: document.getElementById('gavinOfficeStatus')?.innerText,
    presenceChip: document.getElementById('presenceChip')?.innerText
  })`);
  console.log('Clock panel check:', clockCheck);
  if (!clockCheck.clockOpen || !clockCheck.nathanBlock || !clockCheck.gavinBlock) {
    throw new Error('Clock modal did not open or missing blocks: ' + JSON.stringify(clockCheck));
  }

  // 6. Close CLOCK modal
  await evalJs(`document.getElementById('closeClockBtn').click();`);

  // 7. Test Minimap click-to-move pathfinding
  console.log('Step F: Testing click-to-move on minimap...');
  const moveCheck = await evalJs(`(() => {
    const g = window.forgeOfficeGame || window.game;
    const canvas = document.getElementById('minimapCanvas');
    // Click break room area (approx tile 5, 16 -> canvas coords: 5 * 4 = 20, 16 * 4 = 64)
    g.handleMinimapClick(20, 64, canvas.width, canvas.height);
    return {
      hasPath: Array.isArray(g.playerPath) && g.playerPath.length > 0,
      pathLength: g.playerPath ? g.playerPath.length : 0
    };
  })()`);
  console.log('Minimap click-to-move result:', moveCheck);
  if (!moveCheck.hasPath) {
    throw new Error('Minimap click did not create pathfinding path');
  }

  // 8. Test Zoom Controls (Wheel & +/- Keys)
  console.log('Step G: Testing zoom controls (+/- keys and wheel)...');
  const initialZoom = await evalJs(`(() => {
    const g = window.forgeOfficeGame || window.game;
    return g?.camera?.zoom;
  })()`);
  console.log(`Initial camera zoom: ${initialZoom}`);
  if (Math.abs(initialZoom - 1.25) > 0.05) {
    throw new Error(`Expected initial zoom ~1.25, got ${initialZoom}`);
  }

  // Test zoom in with '+' key
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', code: 'Equal' }));`);
  const zoomIn = await evalJs(`(() => (window.forgeOfficeGame || window.game)?.camera?.targetZoom)()`);
  console.log(`Target zoom after '+' key: ${zoomIn}`);
  if (zoomIn <= initialZoom) {
    throw new Error(`Zoom did not increase after '+' key: ${zoomIn}`);
  }

  // Test zoom out with '-' key
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', code: 'Minus' }));`);
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', code: 'Minus' }));`);
  const zoomOut = await evalJs(`(() => (window.forgeOfficeGame || window.game)?.camera?.targetZoom)()`);
  console.log(`Target zoom after '-' key: ${zoomOut}`);
  if (zoomOut >= zoomIn) {
    throw new Error(`Zoom did not decrease after '-' key: ${zoomOut}`);
  }

  // Reset zoom to 1.25
  await evalJs(`(() => {
    const g = window.forgeOfficeGame || window.game;
    g.camera.zoom = 1.25;
    g.camera.targetZoom = 1.25;
  })()`);
  await new Promise((r) => setTimeout(r, 400));

  // 9. Test Lighting Modes (Office Lights vs Fullbright) & Capture Study Screenshots
  console.log('Step H: Testing lighting modes and capturing screenshots for lighting study...');
  const defaultLightMode = await evalJs(`(() => (window.forgeOfficeGame || window.game)?.lightsMode)()`);
  console.log(`Default lights mode: ${defaultLightMode}`);
  if (defaultLightMode !== 'office') {
    throw new Error(`Default lights mode should be 'office', got ${defaultLightMode}`);
  }

  const fs = require('node:fs');
  const path = require('node:path');
  const screenshotDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  // Capture Screenshot in Office Mode
  await new Promise((r) => setTimeout(r, 600));
  const shotOffice = await send('Page.captureScreenshot', { format: 'png' });
  const officeImgPath = path.join(screenshotDir, 'lighting-study-office.png');
  fs.writeFileSync(officeImgPath, Buffer.from(shotOffice.data, 'base64'));
  console.log(`Saved office lights mode screenshot to ${officeImgPath} (${shotOffice.data.length} bytes b64)`);

  // Toggle to Fullbright with 'N' key
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN' }));`);
  await new Promise((r) => setTimeout(r, 400));
  const toggledMode = await evalJs(`(() => (window.forgeOfficeGame || window.game)?.lightsMode)()`);
  const hudBtnText = await evalJs(`document.getElementById('lightsBtn')?.innerText`);
  console.log(`Lights mode after N toggle: ${toggledMode}, HUD label: ${hudBtnText}`);
  if (toggledMode !== 'fullbright' || !hudBtnText.includes('fullbright')) {
    throw new Error(`Lights mode after N toggle expected 'fullbright', got ${toggledMode} (${hudBtnText})`);
  }

  // Capture Screenshot in Fullbright Mode
  const shotFullbright = await send('Page.captureScreenshot', { format: 'png' });
  const fullbrightImgPath = path.join(screenshotDir, 'lighting-study-fullbright.png');
  fs.writeFileSync(fullbrightImgPath, Buffer.from(shotFullbright.data, 'base64'));
  console.log(`Saved fullbright mode screenshot to ${fullbrightImgPath} (${shotFullbright.data.length} bytes b64)`);

  // Toggle back to Office Mode
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN' }));`);
  await new Promise((r) => setTimeout(r, 300));

  // 10. Test Voice Mic Graceful Failure When Denied
  console.log('Step I: Testing Voice mic enable (graceful handling when mic denied)...');
  await evalJs(`(() => {
    const g = window.forgeOfficeGame || window.game;
    if (g && g.voice) {
      g.voice.enableMic().catch(() => {});
    }
  })()`);
  await new Promise((r) => setTimeout(r, 600));
  const notifs = await evalJs(`(() => (window.forgeOfficeGame || window.game)?.notifications?.map(n => n.text))()`);
  console.log('Recent game notifications:', notifs);

  // 11. Assert zero critical console errors
  console.log(`Console error count: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    console.error('Console errors logged:', consoleErrors);
    throw new Error('Unexpected console errors during browser boot');
  }

  cleanup();
  console.log('\n--- ALL BROWSER BOOT CHECKS PASSED ---');
  process.exit(0);
}

runBrowserTest().catch((err) => {
  console.error('FAIL: Browser test error:', err);
  process.exit(1);
});
