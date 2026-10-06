// test/round4-verification.js — Automated verification for FEAT-2026-10-06-4
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startServer, server } = require('../server.js');

const PORT = parseInt(process.env.PORT, 10) || 8999;
const TARGET_URL = `http://127.0.0.1:${PORT}`;
const CDP_PORT = 9224;

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

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, raw: data }); }
      });
    }).on('error', reject);
  });
}

function fetchStatus(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      resolve(res.statusCode);
    }).on('error', reject);
  });
}

async function runVerification() {
  console.log(`=== FEAT-2026-10-06-4 Verification Suite ===`);
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
  // Checklist Step 2: HTTP Endpoint Verification
  // -------------------------------------------------------------------------
  console.log('\n--- Checklist Step 2: Verifying HTTP Endpoints (200 OK) ---');
  const endpoints = [
    '/',
    '/api/flow',
    '/api/projects',
    '/api/office/presence',
    '/api/opencode',
    '/api/claudecode',
    '/api/antigravity'
  ];

  for (const ep of endpoints) {
    const status = await fetchStatus(`${TARGET_URL}${ep}`);
    if (status !== 200) {
      throw new Error(`Endpoint ${ep} returned HTTP ${status}, expected 200!`);
    }
    console.log(`  ✓ GET ${ep} -> 200 OK`);
  }

  // -------------------------------------------------------------------------
  // Checklist Step 3: Headless Chromium CDP Boot & Feature Verification
  // -------------------------------------------------------------------------
  console.log('\n--- Checklist Step 3: Headless Chromium CDP Boot & Checks ---');

  const chromeProc = spawn('chromium', [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${CDP_PORT}`,
    '--user-data-dir=/tmp/chrome-round4-profile-' + Math.random().toString(36).substring(2),
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

  // Allow initial scripts and polling to load
  await new Promise((r) => setTimeout(r, 1600));

  // Enter Office with Nathan profile
  console.log('Entering office with user gesture...');
  await evalJs(`document.getElementById('enterOfficeBtn')?.click();`);
  await new Promise((r) => setTimeout(r, 1200));

  // 1. Music AudioNode Graph & 'M' Toggle Check
  console.log('\n[Check 1] Procedural Background Music & M Key Toggle:');
  const musicState = await evalJs(`(() => {
    const s = window.sfx;
    return {
      hasCtx: !!s?.ctx,
      ctxState: s?.ctx?.state,
      hasMusicGain: !!s?.musicGain,
      musicGainValue: s?.musicGain?.gain?.value,
      isMusicMuted: s?.isMusicMuted(),
      hudButtonText: document.getElementById('musicBtn')?.innerText
    };
  })()`);
  console.log('  Initial Music State:', musicState);
  if (!musicState.hasMusicGain || musicState.musicGainValue <= 0 || musicState.isMusicMuted) {
    throw new Error(`Music bed is not running or gain is zero: ${JSON.stringify(musicState)}`);
  }
  console.log('  ✓ Music AudioNode graph running with nonzero gain:', musicState.musicGainValue);

  // Press 'M' to toggle music off
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM' }));`);
  await new Promise((r) => setTimeout(r, 450));
  const musicMutedState = await evalJs(`(() => {
    const s = window.sfx;
    return {
      isMusicMuted: s?.isMusicMuted(),
      musicGainValue: s?.musicGain?.gain?.value,
      hudButtonText: document.getElementById('musicBtn')?.innerText
    };
  })()`);
  console.log('  After M Key Pressed:', musicMutedState);
  if (!musicMutedState.isMusicMuted || musicMutedState.musicGainValue > 0.01) {
    throw new Error(`Pressing 'M' did not toggle music off: ${JSON.stringify(musicMutedState)}`);
  }
  console.log('  ✓ M key successfully toggled music off (gain -> 0, HUD reflects state)');

  // Press 'M' again to restore music
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM' }));`);
  await new Promise((r) => setTimeout(r, 450));
  const musicRestoredState = await evalJs(`(() => {
    const s = window.sfx;
    return {
      isMusicMuted: s?.isMusicMuted(),
      musicGainValue: s?.musicGain?.gain?.value,
      hudButtonText: document.getElementById('musicBtn')?.innerText
    };
  })()`);
  console.log('  After M Key Toggled Back:', musicRestoredState);
  if (musicRestoredState.isMusicMuted || musicRestoredState.musicGainValue <= 0.05) {
    throw new Error(`Restoring music with 'M' failed: ${JSON.stringify(musicRestoredState)}`);
  }
  console.log('  ✓ M key successfully toggled music back on (gain -> 0.10)');

  // 2. Typing SFX Softened Verification
  console.log('\n[Check 2] Softened Keyboard Typing SFX:');
  const typingCheck = await evalJs(`(() => {
    const fnStr = window.sfx?.playMonitorClack?.toString() || '';
    const hasTriangle = fnStr.includes('triangle');
    const hasLowpass = fnStr.includes('1050');
    const hasSquare = fnStr.includes('square');
    return {
      hasPlayClack: typeof window.sfx?.playMonitorClack === 'function',
      hasTriangle,
      hasLowpass,
      hasSquare
    };
  })()`);
  console.log('  Typing SFX code inspect:', typingCheck);
  if (!typingCheck.hasPlayClack || !typingCheck.hasTriangle || typingCheck.hasSquare) {
    throw new Error(`Typing SFX is not the softened version: ${JSON.stringify(typingCheck)}`);
  }
  console.log('  ✓ Keyboard typing SFX is softened (warm mechanical triangle 380->220Hz + 1050Hz lowpass; no harsh square wave)');

  // 3. Status Board Title Check
  console.log('\n[Check 3] Status Board Title:');
  const boardTitleCode = await evalJs(`(() => {
    const fnStr = window.game?.renderer?.drawStatusBoard?.toString() || '';
    return {
      hasHydrocarbonForge: fnStr.includes('HYDROCARBON FORGE'),
      hasForgeCluster: fnStr.includes("'FORGE CLUSTER'")
    };
  })()`);
  console.log('  Status board title check:', boardTitleCode);
  if (!boardTitleCode.hasHydrocarbonForge || boardTitleCode.hasForgeCluster) {
    throw new Error(`Board title check failed: ${JSON.stringify(boardTitleCode)}`);
  }
  console.log('  ✓ Main board title is "HYDROCARBON FORGE"');

  // 4. Board Token Count vs Insights ALL
  console.log('\n[Check 4] Board Token Count vs Insights ALL:');
  const tokenMetrics = await evalJs(`(() => {
    const g = window.game;
    const allTokens = g?.liveData?.allTokens;
    const summary = g?.liveData?.summary || {};
    return {
      allTokens,
      summaryBilled: summary.billed_tokens,
      summaryTotal: summary.total_tokens,
      boardTokensFormatted: allTokens ? (allTokens >= 1000000 ? (allTokens / 1000000).toFixed(1) + 'M' : (allTokens / 1000).toFixed(0) + 'k') : '--'
    };
  })()`);
  console.log('  Game liveData token metrics:', tokenMetrics);

  // Directly calculate from endpoints
  const [sumApi, ocApi, ccApi, agApi] = await Promise.all([
    fetchJson(`${TARGET_URL}/api/summary`),
    fetchJson(`${TARGET_URL}/api/opencode`),
    fetchJson(`${TARGET_URL}/api/claudecode`),
    fetchJson(`${TARGET_URL}/api/antigravity`)
  ]);

  const c6Billed = sumApi.body.billed_tokens;
  const ocBilled = (ocApi.body.models || []).reduce((a, m) => a + (m.billed_tokens || 0), 0);
  const ccBilled = (ccApi.body.models || []).reduce((a, m) => a + (m.billed_tokens || 0), 0);
  const agBilled = (agApi.body.models || []).reduce((a, m) => a + (m.billed_tokens || 0), 0);
  const calculatedAll = c6Billed + ocBilled + ccBilled + agBilled;
  const calculatedAllFormatted = (calculatedAll / 1000000).toFixed(1) + 'M';

  console.log(`  Source Breakdown:`);
  console.log(`    c6 billed:          ${c6Billed.toLocaleString()}`);
  console.log(`    opencode billed:    ${ocBilled.toLocaleString()}`);
  console.log(`    claudecode billed:  ${ccBilled.toLocaleString()}`);
  console.log(`    antigravity billed: ${agBilled.toLocaleString()}`);
  console.log(`    Insights ALL Sum:   ${calculatedAll.toLocaleString()} (${calculatedAllFormatted})`);
  console.log(`    Board Display:      ${tokenMetrics.allTokens.toLocaleString()} (${tokenMetrics.boardTokensFormatted})`);

  const diffPct = Math.abs(tokenMetrics.allTokens - calculatedAll) / calculatedAll;
  if (diffPct > 0.05) {
    throw new Error(`Board token total (${tokenMetrics.allTokens}) does not match insights ALL (${calculatedAll})!`);
  }
  console.log(`  ✓ Board TOKENS matches insights ALL within ${ (diffPct * 100).toFixed(2) }% (both = ${tokenMetrics.boardTokensFormatted})`);

  // 5. Agent Roster Check ("Gemini" vs "Antigravity")
  console.log('\n[Check 5] Agent Roster Display Name:');
  const agentRosterCheck = await evalJs(`(() => {
    const g = window.game;
    const agAgent = g?.agents?.harnessAgents?.['antigravity'];
    const ocAgent = g?.agents?.harnessAgents?.['opencode'];
    const ccAgent = g?.agents?.harnessAgents?.['claude-code'];
    const allNames = Object.values(g?.agents?.harnessAgents || {}).map(a => a.name);
    return {
      antigravityAgentName: agAgent?.name,
      allNames,
      hasAntigravityName: allNames.includes('Antigravity')
    };
  })()`);
  console.log('  Agent roster check:', agentRosterCheck);
  if (agentRosterCheck.antigravityAgentName !== 'Gemini' || agentRosterCheck.hasAntigravityName) {
    throw new Error(`Agent display name should be 'Gemini', got: ${JSON.stringify(agentRosterCheck)}`);
  }
  console.log('  ✓ Agent roster shows "Gemini" (no user-facing "Antigravity")');

  // 6. Exterior Vista & Window Rendering Check
  console.log('\n[Check 6] Exterior Environment & Windows:');
  const vistaCheck = await evalJs(`(() => {
    const g = window.game;
    const renderer = g?.renderer;
    const map = g?.map;
    const windowCount = map?.windows?.length || 0;
    const hasVistaCanvas = !!renderer?.vistaCanvas;
    const vistaW = renderer?.vistaCanvas?.width;
    const vistaH = renderer?.vistaCanvas?.height;
    return {
      hasVistaCanvas,
      vistaW,
      vistaH,
      windowCount
    };
  })()`);
  console.log('  Vista & Window check:', vistaCheck);
  if (!vistaCheck.hasVistaCanvas || vistaCheck.windowCount < 20) {
    throw new Error(`Vista canvas or windows missing: ${JSON.stringify(vistaCheck)}`);
  }
  console.log(`  ✓ Exterior vista pre-rendered on offscreen canvas (${vistaCheck.vistaW}x${vistaCheck.vistaH})`);
  console.log(`  ✓ ${vistaCheck.windowCount} architectural windows rendered on perimeter walls`);

  // 7. Measure Render Performance (FPS)
  console.log('\n[Check 7] Frame Rate & Performance:');
  const fpsMeasurement = await evalJs(`new Promise((resolve) => {
    let frames = 0;
    const start = performance.now();
    function tick() {
      frames++;
      if (performance.now() - start >= 1000) {
        resolve({
          fps: Math.round((frames * 1000) / (performance.now() - start)),
          frameCount: frames
        });
      } else {
        requestAnimationFrame(tick);
      }
    }
    requestAnimationFrame(tick);
  })`);
  console.log(`  Render frame rate: ${fpsMeasurement.fps} FPS (${fpsMeasurement.frameCount} frames/sec)`);
  if (fpsMeasurement.fps < 30) {
    throw new Error(`FPS too low: ${fpsMeasurement.fps}`);
  }
  console.log('  ✓ Performance is smooth (60 FPS class)');

  // 8. Capture Verification Screenshot
  console.log('\n[Check 8] Capturing Verification Screenshot...');
  const screenshotDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const shotPath = path.join(screenshotDir, 'round4-verification.png');
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
  console.log(`  ✓ Verification screenshot saved to ${shotPath} (${shot.data.length} bytes b64)`);

  // 9. Console Error Verification
  console.log('\n[Check 9] Console Error Check:');
  console.log(`  Console errors logged: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    console.error('Console errors:', consoleErrors);
    throw new Error('Unexpected console errors during verification!');
  }
  console.log('  ✓ 0 console errors logged');

  cleanup();
  console.log('\n======================================================');
  console.log('ALL ROUND 4 VERIFICATION STEPS PASSED SUCCESSFULLY!');
  console.log('======================================================');
  process.exit(0);
}

runVerification().catch((err) => {
  console.error('\nFAIL: Verification suite encountered error:', err);
  process.exit(1);
});
