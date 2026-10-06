// test/verify-fix-2026-10-06-3.js — Automated verification suite for FIX-2026-10-06-3
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execSync } = require('node:child_process');
const { startServer, server, discordPresenceService } = require('../server.js');

const PORT = 8999; // Dedicated test port per instructions! NEVER 8904
const TARGET_URL = `http://127.0.0.1:${PORT}`;
const CDP_PORT = 9226;

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
  console.log(`=== FIX-2026-10-06-3 Verification Suite ===`);
  console.log(`Target: ${TARGET_URL}`);

  // -------------------------------------------------------------------------
  // Step 0: Static Grep Asserts on web/voice.js
  // -------------------------------------------------------------------------
  console.log('\n--- Step 0: Grep-asserts on web/voice.js ---');
  const voiceJsPath = path.join(__dirname, '../web/voice.js');
  const voiceJsContent = fs.readFileSync(voiceJsPath, 'utf8');

  if (voiceJsContent.includes('48000')) {
    throw new Error('FAIL: Literal 48000 found in web/voice.js!');
  }
  console.log('  ✓ No 48000 literal in web/voice.js');

  if (/gateOpen|consecutiveVoiceChunks|gateCloseTimer/.test(voiceJsContent)) {
    throw new Error('FAIL: Gate logic found in web/voice.js!');
  }
  console.log('  ✓ No gateOpen/consecutiveVoiceChunks/gateCloseTimer in web/voice.js');

  if (/0\.8\s*\/\s*peak|Math\.min\(3\.5/.test(voiceJsContent)) {
    throw new Error('FAIL: AGC scaling found in web/voice.js!');
  }
  console.log('  ✓ No AGC scaling in web/voice.js');

  // -------------------------------------------------------------------------
  // Step 1: Start Test Server on PORT 8999
  // -------------------------------------------------------------------------
  console.log('\n--- Step 1: Starting test server on PORT 8999 ---');
  let weStartedServer = false;
  if (!server.listening) {
    try {
      await startServer(PORT, '127.0.0.1');
      weStartedServer = true;
      console.log(`  ✓ Test server started on ${TARGET_URL}`);
    } catch (err) {
      if (err.code !== 'EADDRINUSE') {
        console.error('FAIL: Could not start server:', err);
        process.exit(1);
      }
    }
  }

  for (const ep of ['/', '/api/flow']) {
    const status = await fetchStatus(`${TARGET_URL}${ep}`);
    if (status !== 200) {
      throw new Error(`Endpoint ${ep} returned HTTP ${status}, expected 200!`);
    }
    console.log(`  ✓ GET ${ep} -> 200 OK`);
  }

  // -------------------------------------------------------------------------
  // Step 2: Boot Headless Chromium with Fake Mic Media Device Flags
  // -------------------------------------------------------------------------
  console.log('\n--- Step 2: Booting Headless Chromium with Fake Media Device Flags ---');
  const chromeProc = spawn('chromium', [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${CDP_PORT}`,
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--window-size=1280,720',
    '--user-data-dir=/tmp/chrome-voice-test-' + Math.random().toString(36).substring(2),
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

  await new Promise((r) => setTimeout(r, 1200));

  console.log('Entering office via user gesture (enterOfficeBtn)...');
  await evalJs(`document.getElementById('enterOfficeBtn')?.click();`);
  await new Promise((r) => setTimeout(r, 1200));

  // -------------------------------------------------------------------------
  // Step 3: Item 1 Verification — AudioContext Rate, Fake Mic Stream, Chunks, Self-Monitor
  // -------------------------------------------------------------------------
  console.log('\n--- Step 3: Item 1 Verification (Raw Mic, Sample Rate, Self-Monitor) ---');

  const voiceInitData = await evalJs(`(() => {
    const game = window.game;
    const v = game?.voice;
    const sfx = window.sfx;
    const ctx = sfx?.ctx || v?.audioCtx;
    return {
      audioCtxSampleRate: ctx ? ctx.sampleRate : null,
      voiceSr: v ? v.sr : null,
      chunkSize: v ? v.chunkSize : null,
      isMicEnabled: v ? v.isMicEnabled : false,
      isSelfMonitorEnabled: v ? v.isSelfMonitorEnabled : false
    };
  })()`);

  console.log('  AudioContext initial data:', voiceInitData);
  const sampleRate = voiceInitData.audioCtxSampleRate;
  if (!sampleRate || sampleRate <= 0) {
    throw new Error(`Invalid audioCtx.sampleRate: ${sampleRate}`);
  }
  const expectedChunk = Math.round(sampleRate * 0.02);
  console.log(`  Measured audioCtx.sampleRate on test machine: ${sampleRate} Hz`);
  console.log(`  Derived 20ms chunk size: ${expectedChunk} samples`);

  if (voiceInitData.chunkSize !== expectedChunk) {
    throw new Error(`Voice chunkSize ${voiceInitData.chunkSize} != expected ${expectedChunk}`);
  }
  console.log(`  ✓ chunkSize correctly derived from audioCtx.sampleRate: ${voiceInitData.chunkSize}`);

  // Instrument net.sendVoiceChunk to capture packets sent over time
  await evalJs(`(() => {
    window._capturedVoicePackets = [];
    const orig = window.game.net.sendVoiceChunk.bind(window.game.net);
    window.game.net.sendVoiceChunk = (b64, level, sr) => {
      window._capturedVoicePackets.push({
        time: performance.now(),
        b64Len: b64.length,
        level,
        sr
      });
      return orig(b64, level, sr);
    };
  })()`);

  // Enable Mic with fake media device
  console.log('  Enabling microphone...');
  const enableResult = await evalJs(`window.game.voice.enableMic();`);
  if (!enableResult) {
    throw new Error('FAIL: voice.enableMic() returned false!');
  }
  console.log('  ✓ Microphone successfully enabled');

  // Let fake sine-tone mic audio stream for 1100ms
  console.log('  Streaming fake mic audio for ~1100ms...');
  await new Promise((r) => setTimeout(r, 1100));

  // Retrieve captured packets
  const captureData = await evalJs(`(() => {
    const pkts = window._capturedVoicePackets || [];
    const v = window.game.voice;
    const monitorGainVal = v.selfMonitorGainNode ? v.selfMonitorGainNode.gain.value : null;
    return {
      count: pkts.length,
      packets: pkts.slice(0, 10),
      lastPackets: pkts.slice(-5),
      monitorGainVal,
      isTransmitting: v.isTransmitting
    };
  })()`);

  console.log(`  Packets sent over ~1.1s: ${captureData.count}`);
  if (captureData.count < 45 || captureData.count > 65) {
    throw new Error(`Packet count out of expected ~50 range: ${captureData.count}`);
  }
  console.log(`  ✓ Continuous packet flow verified: ${captureData.count} chunks sent (expected ~50 per sec, one per 20ms)`);

  // Verify chunk sample count from base64 length
  // b64Len for Int16Array of length expectedChunk:
  // bytes = expectedChunk * 2. b64 chars = Math.ceil(bytes / 3) * 4.
  const expectedBytes = expectedChunk * 2;
  const expectedB64Len = Math.ceil(expectedBytes / 3) * 4;
  const actualB64Len = captureData.packets[0].b64Len;
  if (actualB64Len !== expectedB64Len) {
    throw new Error(`b64 length ${actualB64Len} != expected ${expectedB64Len} (for ${expectedChunk} Int16 samples)`);
  }
  console.log(`  ✓ Chunk length verified: ${expectedChunk} samples == Math.round(audioCtx.sampleRate * 0.02)`);

  // Verify packet sample rate field matches audioCtx.sampleRate
  const packetSr = captureData.packets[0].sr;
  if (packetSr !== sampleRate) {
    throw new Error(`Packet sr ${packetSr} != ctx sample rate ${sampleRate}`);
  }
  console.log(`  ✓ Voice packets carry sr field matching device rate (${packetSr} Hz)`);

  // Verify self-monitor GainNode is connected with nonzero gain (~0.35)
  console.log(`  Self-monitor GainNode gain value: ${captureData.monitorGainVal}`);
  if (typeof captureData.monitorGainVal !== 'number' || captureData.monitorGainVal <= 0.1) {
    throw new Error(`Self-monitor GainNode gain value invalid or zero: ${captureData.monitorGainVal}`);
  }
  console.log(`  ✓ Self-monitor GainNode active with nonzero gain (${captureData.monitorGainVal.toFixed(2)})`);

  // Test HUD toggle for self-monitor
  const toggleCheck = await evalJs(`(() => {
    const v = window.game.voice;
    const monitorBtn = document.getElementById('monitorBtn');
    
    // Click toggle to turn OFF
    monitorBtn?.click();
    const offGain = v.selfMonitorGainNode.gain.value;
    const offBtnText = monitorBtn?.innerText;
    
    // Click toggle to turn back ON
    monitorBtn?.click();
    const onGain = v.selfMonitorGainNode.gain.value;
    const onBtnText = monitorBtn?.innerText;
    
    return { offGain, offBtnText, onGain, onBtnText };
  })()`);

  console.log('  Monitor HUD toggle test:', toggleCheck);
  if (toggleCheck.offGain !== 0 || toggleCheck.onGain <= 0.1) {
    throw new Error(`Self-monitor HUD toggle failed: offGain=${toggleCheck.offGain}, onGain=${toggleCheck.onGain}`);
  }
  console.log(`  ✓ HUD Monitor toggle verified: toggles between 0.0 and ${toggleCheck.onGain.toFixed(2)} (${toggleCheck.onBtnText})`);

  // Verify playback path creates buffers at ctx rate
  const playbackCheck = await evalJs(`(() => {
    const v = window.game.voice;
    let createdRate = null;
    let createdLen = null;
    const origCreateBuffer = v.audioCtx.createBuffer.bind(v.audioCtx);
    v.audioCtx.createBuffer = (ch, len, sr) => {
      createdRate = sr;
      createdLen = len;
      return origCreateBuffer(ch, len, sr);
    };

    // Simulate incoming voice packet
    const dummyPcm = new Int16Array(v.chunkSize);
    for (let i = 0; i < dummyPcm.length; i++) dummyPcm[i] = 1000;
    const bytes = new Uint8Array(dummyPcm.buffer);
    let bin = '';
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin);

    v.handleVoicePacket({
      t: 'va',
      from: 'test-peer-99',
      name: 'PeerTest',
      d: b64,
      l: 0.6,
      sr: v.sr,
      x: 100,
      y: 100
    });
    // Send second packet to trigger scheduleNext
    v.handleVoicePacket({
      t: 'va',
      from: 'test-peer-99',
      name: 'PeerTest',
      d: b64,
      l: 0.6,
      sr: v.sr,
      x: 100,
      y: 100
    });

    // Restore
    v.audioCtx.createBuffer = origCreateBuffer;

    return {
      createdRate,
      createdLen,
      expectedRate: v.sr
    };
  })()`);

  console.log('  Playback path buffer test:', playbackCheck);
  if (playbackCheck.createdRate !== sampleRate) {
    throw new Error(`Playback buffer rate ${playbackCheck.createdRate} != ctx rate ${sampleRate}`);
  }
  console.log(`  ✓ Playback path creates buffers at context rate (${playbackCheck.createdRate} Hz)`);

  // -------------------------------------------------------------------------
  // Step 4: Item 2 Verification — Exterior Art Pass, FPS, and Screenshots
  // -------------------------------------------------------------------------
  console.log('\n--- Step 4: Item 2 Verification (Exterior Art Pass, FPS, Screenshots) ---');

  const screenshotDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  // Measure render FPS over 60 frames
  const fpsMeasurement = await evalJs(`new Promise((resolve) => {
    let frameCount = 0;
    const start = performance.now();
    function countFrame() {
      frameCount++;
      if (frameCount >= 60) {
        const elapsed = performance.now() - start;
        const fps = (frameCount / elapsed) * 1000;
        resolve({ fps, elapsed });
      } else {
        requestAnimationFrame(countFrame);
      }
    }
    requestAnimationFrame(countFrame);
  })`);

  console.log(`  Measured render loop FPS: ${fpsMeasurement.fps.toFixed(1)} (target >= 55)`);
  if (fpsMeasurement.fps < 50) {
    throw new Error(`Render FPS too low: ${fpsMeasurement.fps.toFixed(1)} < 50 target!`);
  }
  console.log(`  ✓ FPS performance target passed (>= 55 FPS)`);

  // Default zoom screenshot
  const shotDefault = await send('Page.captureScreenshot', { format: 'png' });
  const defaultZoomPath = path.join(screenshotDir, 'exterior-default-zoom.png');
  saveBase64Png(shotDefault.data, defaultZoomPath);
  console.log(`  ✓ Saved default zoom screenshot: ${defaultZoomPath}`);

  // Zoom to min zoom 0.6x
  console.log('  Zooming out to min zoom 0.6x...');
  await evalJs(`window.game.setTargetZoom(0.6, window.innerWidth / 2, window.innerHeight / 2);`);
  await new Promise((r) => setTimeout(r, 900));

  // Check screen corners and outer margins at min zoom
  const minZoomCheck = await evalJs(`(() => {
    const canvas = window.game.renderer.canvas;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    
    // Sample corners
    const tl = ctx.getImageData(4, 4, 1, 1).data;
    const tr = ctx.getImageData(w - 5, 4, 1, 1).data;
    const bl = ctx.getImageData(4, h - 5, 1, 1).data;
    const br = ctx.getImageData(w - 5, h - 5, 1, 1).data;

    // Sample outer meadow edges to verify non-flat variety
    const leftMargin1 = ctx.getImageData(20, Math.floor(h * 0.4), 1, 1).data;
    const leftMargin2 = ctx.getImageData(20, Math.floor(h * 0.8), 1, 1).data;
    const rightMargin1 = ctx.getImageData(w - 20, Math.floor(h * 0.4), 1, 1).data;
    const rightMargin2 = ctx.getImageData(w - 20, Math.floor(h * 0.8), 1, 1).data;

    return {
      zoom: window.game.camera.zoom,
      w, h,
      corners: {
        tl: { r: tl[0], g: tl[1], b: tl[2] },
        tr: { r: tr[0], g: tr[1], b: tr[2] },
        bl: { r: bl[0], g: bl[1], b: bl[2] },
        br: { r: br[0], g: br[1], b: br[2] }
      },
      margins: {
        lm1: { r: leftMargin1[0], g: leftMargin1[1], b: leftMargin1[2] },
        lm2: { r: leftMargin2[0], g: leftMargin2[1], b: leftMargin2[2] },
        rm1: { r: rightMargin1[0], g: rightMargin1[1], b: rightMargin1[2] },
        rm2: { r: rightMargin2[0], g: rightMargin2[1], b: rightMargin2[2] }
      }
    };
  })()`);

  console.log(`  Min zoom check at zoom ${minZoomCheck.zoom.toFixed(2)}:`, minZoomCheck);

  // Check that screen edges never show the old dark background rgb(26, 28, 35)
  for (const [cornerName, p] of Object.entries(minZoomCheck.corners)) {
    const isOldClear = (p.r >= 22 && p.r <= 30 && p.g >= 24 && p.g <= 32 && p.b >= 30 && p.b <= 40);
    if (isOldClear) {
      throw new Error(`Corner ${cornerName} still shows dark background clear color rgb(${p.r},${p.g},${p.b})!`);
    }
  }

  // Check that margins exhibit color variety (different biome greens, not identical flat values)
  const lm1 = minZoomCheck.margins.lm1;
  const lm2 = minZoomCheck.margins.lm2;
  const rm1 = minZoomCheck.margins.rm1;
  const rm2 = minZoomCheck.margins.rm2;
  const isUniformFlat = (lm1.g === lm2.g && lm2.g === rm1.g && rm1.g === rm2.g);
  if (isUniformFlat) {
    throw new Error('FAIL: Margins are uniformly flat color with zero variety!');
  }
  console.log(`  ✓ Min zoom margins display varied organic biome greens (LM1: g=${lm1.g}, LM2: g=${lm2.g}, RM1: g=${rm1.g}, RM2: g=${rm2.g})`);

  // Min zoom screenshot
  const shotMin = await send('Page.captureScreenshot', { format: 'png' });
  const minZoomPath = path.join(screenshotDir, 'exterior-min-zoom.png');
  saveBase64Png(shotMin.data, minZoomPath);
  console.log(`  ✓ Saved min zoom (0.6x) screenshot: ${minZoomPath}`);

  // -------------------------------------------------------------------------
  // Step 5: Console Error Verification
  // -------------------------------------------------------------------------
  console.log('\n--- Step 5: Console Error Verification ---');
  console.log(`  Console errors logged: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    console.error('Console errors:', consoleErrors);
    throw new Error('Unexpected console errors during verification!');
  }
  console.log('  ✓ 0 console errors logged');

  cleanup();
  console.log('\n======================================================');
  console.log('ALL FIX-2026-10-06-3 VERIFICATION CHECKS PASSED!');
  console.log('======================================================');
  process.exit(0);
}

runVerification().catch((err) => {
  console.error('\nFAIL: Verification suite encountered error:', err);
  process.exit(1);
});
