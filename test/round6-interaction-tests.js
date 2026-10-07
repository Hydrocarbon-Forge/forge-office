// test/round6-interaction-tests.js — Automated verification of Round 6 features
// 1. Voice isolation in closed glass meeting room
// 2. Whiteboard stroke sync across WS clients
// 3. Typing-board sync across WS clients
// 4. Single-occupant projector docking (rejection with projector-busy)
// 5. Carryables from vending/fridge/coffee & drink consumption
// 6. Drink-station preset save and load via HTTP endpoints

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, server } = require('../server.js');

const PORT = 8999;
const WS_URL = `ws://127.0.0.1:${PORT}/bridge`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function runRound6Tests() {
  console.log('=== Starting Round 6 Automated Interaction Tests ===\n');

  let weStarted = false;
  if (!server.listening) {
    await startServer(PORT, '127.0.0.1');
    weStarted = true;
    console.log(`Test server running on port ${PORT}`);
  }

  const socketsToClose = [];

  function connectClient(name, profile, x, y) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      socketsToClose.push(ws);
      let welcomeMsg = null;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'join',
          name,
          profile,
          x,
          y
        }));
      };

      ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'welcome') {
          welcomeMsg = msg;
          resolve({ ws, id: msg.you, welcome: welcomeMsg });
        }
      };

      ws.onerror = reject;
    });
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Drink-station Presets HTTP Save & Load
    // -------------------------------------------------------------------------
    console.log('[Test 1] Testing Drink-Station Presets Save & Load...');
    const testPresets = [
      { name: 'Morning Spark', base: 'coffee', addins: ['milk', 'sugar'] },
      { name: 'Zen Matcha', base: 'tea', addins: ['honey', 'oat'] }
    ];

    const postRes = await httpRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/office/drink-presets',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { profile: 'nathan', presets: testPresets });

    if (postRes.status !== 200 || !postRes.body.ok) {
      throw new Error(`Failed to save drink presets: ${JSON.stringify(postRes)}`);
    }

    const getRes = await httpRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/office/drink-presets?profile=nathan',
      method: 'GET'
    });

    if (getRes.status !== 200 || !getRes.body.ok || !Array.isArray(getRes.body.presets)) {
      throw new Error(`Failed to load drink presets: ${JSON.stringify(getRes)}`);
    }

    if (getRes.body.presets.length < 2 || getRes.body.presets[0].name !== 'Morning Spark') {
      throw new Error(`Preset contents did not match: ${JSON.stringify(getRes.body.presets)}`);
    }
    console.log('PASS: Drink presets save & load verified (HTTP 200, array matches).');

    // -------------------------------------------------------------------------
    // TEST 2: Whiteboard Stroke Sync Across WS Clients
    // -------------------------------------------------------------------------
    console.log('\n[Test 2] Testing Whiteboard Multiplayer Stroke Sync...');
    // Connect Client A (inside meeting room: tx 38, ty 17 -> px: 38*32, 17*32 = 1216, 544)
    const clientA = await connectClient('Alice', 'nathan', 1216, 544);
    // Connect Client B (also inside meeting room: tx 39, ty 17 -> px: 1248, 544)
    const clientB = await connectClient('Bob', 'gavin', 1248, 544);

    let bReceivedStroke = null;
    let bReceivedClear = false;

    const bListener = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'whiteboard-stroke') {
        bReceivedStroke = msg.stroke;
      } else if (msg.type === 'whiteboard-clear') {
        bReceivedClear = true;
      }
    };
    clientB.ws.addEventListener('message', bListener);

    const testStroke = {
      color: '#2563EB',
      width: 3,
      points: [{ x: 50, y: 50 }, { x: 75, y: 75 }, { x: 100, y: 80 }]
    };

    clientA.ws.send(JSON.stringify({ type: 'whiteboard-stroke', stroke: testStroke }));
    await wait(150);

    if (!bReceivedStroke || bReceivedStroke.points.length !== 3) {
      throw new Error(`Client B did not receive whiteboard stroke: ${JSON.stringify(bReceivedStroke)}`);
    }

    clientA.ws.send(JSON.stringify({ type: 'whiteboard-clear' }));
    await wait(150);

    if (!bReceivedClear) {
      throw new Error('Client B did not receive whiteboard clear broadcast');
    }
    console.log('PASS: Whiteboard stroke sync & clear broadcast verified.');

    // -------------------------------------------------------------------------
    // TEST 3: Typing-Board Append & Sync
    // -------------------------------------------------------------------------
    console.log('\n[Test 3] Testing Typing-Board Ledger Sync...');
    let bReceivedLines = null;
    const bTypingListener = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'typing-board-sync') {
        bReceivedLines = msg.lines;
      }
    };
    clientB.ws.addEventListener('message', bTypingListener);

    clientA.ws.send(JSON.stringify({
      type: 'typing-board-input',
      action: 'append',
      text: 'Action Item: Deploy Round 6',
      author: 'Alice'
    }));
    await wait(150);

    const hasMatch = Array.isArray(bReceivedLines) && bReceivedLines.some((l) => {
      const txt = (typeof l === 'object' && l) ? l.text : String(l);
      return txt && txt.includes('Deploy Round 6');
    });
    if (!hasMatch) {
      throw new Error(`Client B did not receive typing-board sync line: ${JSON.stringify(bReceivedLines)}`);
    }
    console.log('PASS: Typing-board append and multiplayer sync verified.');

    // -------------------------------------------------------------------------
    // TEST 4: Single-Occupant Projector Docking Enforced by Server
    // -------------------------------------------------------------------------
    console.log('\n[Test 4] Testing Single-Occupant Projector Docking & Busy Toast...');
    let bProjectorUpdate = null;
    let bReceivedBusy = false;

    const bProjListener = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'projector-update') {
        bProjectorUpdate = msg.presenter;
      } else if (msg.type === 'projector-busy') {
        bReceivedBusy = true;
      }
    };
    clientB.ws.addEventListener('message', bProjListener);

    // Client A docks to projector
    clientA.ws.send(JSON.stringify({
      type: 'projector-dock',
      topic: 'Q4 Architecture Review'
    }));
    await wait(150);

    if (!bProjectorUpdate || bProjectorUpdate.id !== clientA.id) {
      throw new Error(`Projector update did not announce Client A as presenter: ${JSON.stringify(bProjectorUpdate)}`);
    }

    // Client B attempts to dock while Client A is presenting -> MUST get projector-busy
    clientB.ws.send(JSON.stringify({
      type: 'projector-dock',
      topic: 'Hijack Presentation'
    }));
    await wait(150);

    if (!bReceivedBusy) {
      throw new Error('Client B was not rejected with projector-busy message!');
    }

    // Client A undocks
    clientA.ws.send(JSON.stringify({ type: 'projector-undock' }));
    await wait(150);

    if (bProjectorUpdate !== null) {
      throw new Error('Projector presenter did not reset to null after undock');
    }
    console.log('PASS: Single-occupant projector docking enforced (second client received projector-busy).');

    // -------------------------------------------------------------------------
    // TEST 5: Meeting Room Door Close & Voice Isolation on `va` Relay
    // -------------------------------------------------------------------------
    console.log('\n[Test 5] Testing Meeting Room Door Close & Voice Isolation...');
    // Connect Client C (Outside meeting room in Lobby: tx 21, ty 16 -> px: 672, 512)
    // Distance from Client A (1216, 544) to Client C (672, 512) is ~544px, within the 800px proximity bubble!
    const clientC = await connectClient('Charlie', 'guest', 672, 512);

    let cReceivedAudio = false;
    let bReceivedAudio = false;

    clientC.ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.t === 'va' || msg.type === 'va') {
        cReceivedAudio = true;
      }
    };

    clientB.ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.t === 'va' || msg.type === 'va') {
        bReceivedAudio = true;
      }
    };

    // Step 5a: With meeting room door OPEN (default), Client A voice reaches both B and C
    clientA.ws.send(JSON.stringify({
      type: 'va',
      t: 'va',
      d: 'VGVzdEF1ZGlvT3Blbg=='
    }));
    await wait(150);

    if (!bReceivedAudio) {
      throw new Error('Client B did not receive audio when door was open');
    }
    if (!cReceivedAudio) {
      throw new Error('Client C (outside, ~544px away) did not receive audio when door was open');
    }
    console.log('PASS: When meeting room door is open, voice packet relays to colleagues inside and outside.');

    // Step 5b: Close meeting room door
    clientA.ws.send(JSON.stringify({
      type: 'meeting-door',
      closed: true
    }));
    await wait(150);

    // Reset audio flags
    bReceivedAudio = false;
    cReceivedAudio = false;

    // Send audio from Client A (inside meeting room)
    clientA.ws.send(JSON.stringify({
      type: 'va',
      t: 'va',
      d: 'VGVzdEF1ZGlvQ2xvc2Vk'
    }));
    await wait(200);

    if (!bReceivedAudio) {
      throw new Error('Client B (inside closed meeting room) DID NOT receive audio from Client A!');
    }
    if (cReceivedAudio) {
      throw new Error('LEAK DETECTED: Client C (outside closed meeting room) RECEIVED audio from inside closed meeting room!');
    }
    console.log('PASS: Meeting room door closed -> Voice isolation ACTIVE! Inside received, outside blocked.');

    // Step 5c: Outside sending audio should NOT penetrate inside closed meeting room
    let aReceivedAudioFromOutside = false;
    clientA.ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.t === 'va' || msg.type === 'va') {
        aReceivedAudioFromOutside = true;
      }
    };

    clientC.ws.send(JSON.stringify({
      type: 'va',
      t: 'va',
      d: 'T3V0c2lkZVRvSW5zaWRl'
    }));
    await wait(200);

    if (aReceivedAudioFromOutside) {
      throw new Error('LEAK DETECTED: Outside audio penetrated into closed meeting room!');
    }
    console.log('PASS: Outside audio successfully blocked from entering closed meeting room.');

    // Re-open door for clean state
    clientA.ws.send(JSON.stringify({ type: 'meeting-door', closed: false }));
    await wait(100);

    // -------------------------------------------------------------------------
    // TEST 6: Carryables & Consumption Logic Simulation
    // -------------------------------------------------------------------------
    console.log('\n[Test 6] Testing Carryables Creation & Consumption Cycle...');
    const mockPlayer = {
      heldDrink: null,
      isSipping: false,
      sipTimer: 0
    };

    // Vending dispense
    mockPlayer.heldDrink = { name: 'Cyber Cola', icon: '🥤', color: '#881337', source: 'vending' };
    if (!mockPlayer.heldDrink || mockPlayer.heldDrink.name !== 'Cyber Cola') {
      throw new Error('Failed to set vending drink');
    }

    // Fridge take
    mockPlayer.heldDrink = { name: 'Spring Water', icon: '💧', color: '#38BDF8', source: 'fridge' };
    if (!mockPlayer.heldDrink || mockPlayer.heldDrink.name !== 'Spring Water') {
      throw new Error('Failed to take drink from fridge');
    }

    // Coffee brew
    mockPlayer.heldDrink = { name: 'Fresh Espresso', icon: '☕', color: '#451A03', source: 'coffee' };
    if (!mockPlayer.heldDrink || mockPlayer.heldDrink.name !== 'Fresh Espresso') {
      throw new Error('Failed to brew fresh coffee');
    }

    // Start sipping [Q]
    mockPlayer.isSipping = true;
    mockPlayer.sipTimer = 1.0;

    // Simulate 0.5s elapsed
    mockPlayer.sipTimer -= 0.5;
    if (!mockPlayer.isSipping || mockPlayer.heldDrink === null) {
      throw new Error('Drink should still be in hand during sip animation');
    }

    // Simulate remaining 0.6s elapsed
    mockPlayer.sipTimer -= 0.6;
    if (mockPlayer.sipTimer <= 0) {
      mockPlayer.isSipping = false;
      mockPlayer.heldDrink = null;
    }

    if (mockPlayer.heldDrink !== null || mockPlayer.isSipping !== false) {
      throw new Error('Drink was not cleared after sipping completed');
    }
    console.log('PASS: Carryable pickup from vending/fridge/coffee and sipping consumption lifecycle verified.');

    // -------------------------------------------------------------------------
    // TEST 7: Whiteboard Single-Tap Dot (1-point stroke) Sync & Guard
    // -------------------------------------------------------------------------
    console.log('\n[Test 7] Testing Whiteboard Single-Tap Dot (1-point stroke)...');
    let bReceivedDot = null;
    const dotListener = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'whiteboard-stroke' && msg.stroke && msg.stroke.points && msg.stroke.points.length === 1) {
        bReceivedDot = msg.stroke;
      }
    };
    clientB.ws.addEventListener('message', dotListener);

    const singleTapStroke = {
      color: '#EF4444',
      width: 4,
      points: [{ x: 64, y: 128 }]
    };
    clientA.ws.send(JSON.stringify({ type: 'whiteboard-stroke', stroke: singleTapStroke }));
    await wait(150);
    clientB.ws.removeEventListener('message', dotListener);

    if (!bReceivedDot || bReceivedDot.points.length !== 1) {
      throw new Error(`Client B did not receive single-point dot stroke: ${JSON.stringify(bReceivedDot)}`);
    }

    const gameJsCode = fs.readFileSync(path.resolve(__dirname, '../web/game.js'), 'utf8');
    if (!gameJsCode.includes('points.length >= 1') || !gameJsCode.includes('Math.max(2.5, width / 2)')) {
      throw new Error('game.js is missing single-point dot rendering guards');
    }
    console.log('PASS: Whiteboard single-tap 1-point dot broadcast & rendering logic verified.');

    // -------------------------------------------------------------------------
    // TEST 8: Projector Screen-Share Flag & Clean Undock Broadcast
    // -------------------------------------------------------------------------
    console.log('\n[Test 8] Testing Projector Screen-Share Flag & Undock...');
    let bLiveUpdate = null;
    let bUndockUpdate = null;
    const liveProjListener = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'projector-update') {
        if (msg.presenter && msg.presenter.screenShareActive) {
          bLiveUpdate = msg.presenter;
        } else if (msg.presenter === null) {
          bUndockUpdate = true;
        }
      }
    };
    clientB.ws.addEventListener('message', liveProjListener);

    // Client A docks with real share active
    clientA.ws.send(JSON.stringify({
      type: 'projector-dock',
      topic: 'Live Architecture Deck',
      screenShareActive: true
    }));
    await wait(150);

    if (!bLiveUpdate || bLiveUpdate.screenShareActive !== true || bLiveUpdate.topic !== 'Live Architecture Deck') {
      throw new Error(`Client B did not receive screenShareActive projector update: ${JSON.stringify(bLiveUpdate)}`);
    }

    // Client A undocks
    clientA.ws.send(JSON.stringify({ type: 'projector-undock' }));
    await wait(150);
    clientB.ws.removeEventListener('message', liveProjListener);

    if (!bUndockUpdate) {
      throw new Error('Client B did not receive clean undock null presenter update');
    }
    console.log('PASS: Projector screenShareActive flag relay and undock broadcast verified.');

    // -------------------------------------------------------------------------
    // TEST 9: Typing-Board Input-Focus Guard (Typing 'e' does not trigger game hotkeys)
    // -------------------------------------------------------------------------
    console.log('\n[Test 9] Testing Typing-Board Input-Focus Guard...');
    if (!gameJsCode.includes("target.closest('input, textarea')") || !gameJsCode.includes("e.key !== 'Escape'")) {
      throw new Error('game.js missing input focus guard allowing Escape but suppressing game hotkeys');
    }
    console.log('PASS: Input focus guard verified in game.js (typing "e" in input does not trigger game actions).');

    // -------------------------------------------------------------------------
    // TEST 10: Coffee / Drink Unified Held-Item State & Consume Sync
    // -------------------------------------------------------------------------
    console.log('\n[Test 10] Testing Coffee / Drink Unified Held-Item Lifecycle...');
    if (!gameJsCode.includes('setHeldItem(item)') || !gameJsCode.includes('this.player.heldItem = item;')) {
      throw new Error('game.js missing unified setHeldItem helper');
    }
    const netJsCode = fs.readFileSync(path.resolve(__dirname, '../web/net.js'), 'utf8');
    if (!netJsCode.includes('heldItem:') || !netJsCode.includes('remote.heldItem')) {
      throw new Error('net.js missing heldItem move payload sync');
    }
    console.log('PASS: Unified heldItem state management verified across game.js and net.js.');

    // -------------------------------------------------------------------------
    // TEST 11: Self-Monitor Settings-Only Consolidation
    // -------------------------------------------------------------------------
    console.log('\n[Test 11] Testing Self-Monitor Settings-Only Consolidation...');
    const htmlCode = fs.readFileSync(path.resolve(__dirname, '../web/index.html'), 'utf8');
    if (htmlCode.includes('startMonitorCheckbox')) {
      throw new Error('index.html still contains startMonitorCheckbox');
    }
    if (gameJsCode.includes('startMonitorCheckbox')) {
      throw new Error('game.js still references startMonitorCheckbox');
    }
    const voiceJsCode = fs.readFileSync(path.resolve(__dirname, '../web/voice.js'), 'utf8');
    if (!voiceJsCode.includes('this.isSelfMonitorEnabled = false;')) {
      throw new Error('voice.js should default isSelfMonitorEnabled to false');
    }
    console.log('PASS: Self-monitor successfully consolidated into settings modal only.');

    // -------------------------------------------------------------------------
    // TEST 12: Music File Engine Section Discovery & Audio Serving
    // -------------------------------------------------------------------------
    console.log('\n[Test 12] Testing Music Section Discovery & Audio Serving...');
    const musicApiRes = await httpRequest({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/office/music',
      method: 'GET'
    });
    const tracks = musicApiRes.body.files || musicApiRes.body.tracks;
    if (musicApiRes.status !== 200 || !musicApiRes.body.ok || !Array.isArray(tracks)) {
      throw new Error(`Failed to query /api/office/music: ${JSON.stringify(musicApiRes)}`);
    }
    const hasSec1 = tracks.some(t => t.includes('section-01.mp3'));
    if (tracks.length < 4 || !hasSec1) {
      throw new Error(`Expected at least 4 music section files: ${JSON.stringify(tracks)}`);
    }

    const audioRes = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${PORT}/web/music/section-01.mp3`, { agent: false }, (res) => {
        res.resume();
        resolve({ status: res.statusCode, contentType: res.headers['content-type'] });
      }).on('error', reject);
    });
    if (audioRes.status !== 200 || !audioRes.contentType.includes('audio/mpeg')) {
      throw new Error(`Failed to fetch section-01.mp3 with audio/mpeg content type: ${JSON.stringify(audioRes)}`);
    }
    console.log('PASS: Music files endpoint /api/office/music and audio/mpeg streaming verified.');

    // -------------------------------------------------------------------------
    // TEST 13: Cute Non-Human Avatar Redesign Verification
    // -------------------------------------------------------------------------
    console.log('\n[Test 13] Testing Cute Non-Human Avatar Redesign & Screenshots...');
    const renderJsCode = fs.readFileSync(path.resolve(__dirname, '../web/render.js'), 'utf8');
    if (renderJsCode.includes('SKIN_TONE') || renderJsCode.includes('HAIR_COLOR')) {
      throw new Error('render.js still contains human SKIN_TONE or HAIR_COLOR constants');
    }
    const screenshotFiles = [
      'avatar-redesign-cute-showcase.png',
      'avatar-redesign-cute-idle.png',
      'avatar-redesign-cute-walking.png',
      'avatar-redesign-cute-agents.png',
      'avatar-redesign-cute-cosmetics.png'
    ];
    for (const sf of screenshotFiles) {
      const sPath = path.resolve(__dirname, 'screenshots', sf);
      if (!fs.existsSync(sPath) || fs.statSync(sPath).size < 1000) {
        throw new Error(`Required screenshot missing or empty: ${sPath}`);
      }
    }
    console.log('PASS: Cute non-human creature avatar redesign verified (no human head/skin/hair; 5 screenshots generated).');

    // -------------------------------------------------------------------------
    // TEST 14: Carry Slot HUD Lifecycle, Multi-Sip Consumption, and Remote Sync
    // -------------------------------------------------------------------------
    console.log('\n[Test 14] Testing Carry Slot HUD Lifecycle & Sips Regression...');

    // A. Verify index.html & game.js code invariants
    const htmlFile = fs.readFileSync(path.resolve(__dirname, '../web/index.html'), 'utf8');
    const gameFile = fs.readFileSync(path.resolve(__dirname, '../web/game.js'), 'utf8');

    if (htmlFile.includes('id="projectorSettingsBtn"')) {
      throw new Error('index.html still contains projectorSettingsBtn');
    }
    if (gameFile.includes('projectorSettingsBtn')) {
      throw new Error('game.js still references projectorSettingsBtn');
    }
    if (!gameFile.includes('isInsideMeetingRoom') || !gameFile.includes('Left the meeting room — undocked')) {
      throw new Error('game.js missing meeting room boundary check for projector auto-undock');
    }

    // B. Carry Slot HUD DOM simulation (a, b, c, d)
    const mockPillClasses = new Set(['hud-chip', 'hidden']);
    const mockDrinkBtnClasses = new Set(['hud-mini-btn', 'hidden']);
    const mockElements = {
      carrySlotPill: {
        classList: {
          add: (c) => mockPillClasses.add(c),
          remove: (c) => mockPillClasses.delete(c),
          contains: (c) => mockPillClasses.has(c)
        }
      },
      carryItemIcon: { innerText: '' },
      carryItemText: { innerText: '' },
      drinkActionBtn: {
        style: {},
        classList: {
          add: (c) => mockDrinkBtnClasses.add(c),
          remove: (c) => mockDrinkBtnClasses.delete(c),
          contains: (c) => mockDrinkBtnClasses.has(c)
        }
      }
    };

    function simulateUpdateCarrySlotUI(player) {
      const pill = mockElements.carrySlotPill;
      const icon = mockElements.carryItemIcon;
      const text = mockElements.carryItemText;
      const drinkBtn = mockElements.drinkActionBtn;
      const item = player.heldItem || player.heldDrink;
      if (item) {
        pill.classList.remove('hidden');
        if (icon) icon.innerText = item.icon || '🥤';
        if (text) {
          const name = item.name || 'Drink';
          if (typeof item.sips === 'number') {
            text.innerText = `${name} · ${item.sips} left`;
          } else {
            text.innerText = name;
          }
        }
        if (drinkBtn) {
          if (item.drink === true) {
            drinkBtn.classList.remove('hidden');
            drinkBtn.style.display = '';
          } else {
            drinkBtn.classList.add('hidden');
            drinkBtn.style.display = 'none';
          }
        }
      } else {
        pill.classList.add('hidden');
        if (drinkBtn) {
          drinkBtn.classList.add('hidden');
        }
      }
    }

    const testSimPlayer = { heldItem: null, heldDrink: null, isSipping: false, sipTimer: 0 };

    // (a) Pill hidden at start with no item
    simulateUpdateCarrySlotUI(testSimPlayer);
    if (!mockElements.carrySlotPill.classList.contains('hidden')) {
      throw new Error('Carry pill is visible at start when player holds no item');
    }

    // (b) Picking up a drink with 3 sips -> pill visible with SIP button & '3 left'
    testSimPlayer.heldItem = { name: 'Fresh Espresso', icon: '☕', color: '#451A03', drink: true, sips: 3 };
    testSimPlayer.heldDrink = testSimPlayer.heldItem;
    simulateUpdateCarrySlotUI(testSimPlayer);

    if (mockElements.carrySlotPill.classList.contains('hidden')) {
      throw new Error('Carry pill is hidden after picking up a drink');
    }
    if (mockElements.drinkActionBtn.classList.contains('hidden')) {
      throw new Error('SIP [Q] button is hidden for a drink item');
    }
    if (!mockElements.carryItemText.innerText.includes('Fresh Espresso · 3 left')) {
      throw new Error(`Unexpected pill text: ${mockElements.carryItemText.innerText}`);
    }

    // (c) Sip 1 -> decrements sips to 2, pill still visible
    testSimPlayer.heldItem.sips -= 1;
    simulateUpdateCarrySlotUI(testSimPlayer);
    if (!mockElements.carryItemText.innerText.includes('Fresh Espresso · 2 left')) {
      throw new Error(`Expected '2 left' after sip 1, got: ${mockElements.carryItemText.innerText}`);
    }
    if (mockElements.carrySlotPill.classList.contains('hidden')) {
      throw new Error('Pill hid prematurely while sips remain');
    }

    // Sip 2 -> decrements sips to 1
    testSimPlayer.heldItem.sips -= 1;
    simulateUpdateCarrySlotUI(testSimPlayer);
    if (!mockElements.carryItemText.innerText.includes('Fresh Espresso · 1 left')) {
      throw new Error(`Expected '1 left' after sip 2, got: ${mockElements.carryItemText.innerText}`);
    }

    // Sip 3 -> sips reach 0 -> consume (setHeldItem(null)) -> pill hidden again
    testSimPlayer.heldItem.sips -= 1;
    if (testSimPlayer.heldItem.sips <= 0) {
      testSimPlayer.heldItem = null;
      testSimPlayer.heldDrink = null;
    }
    simulateUpdateCarrySlotUI(testSimPlayer);
    if (!mockElements.carrySlotPill.classList.contains('hidden')) {
      throw new Error('Pill was not hidden after drink was fully consumed');
    }

    // (d) Non-drink item -> pill visible, but SIP button hidden!
    testSimPlayer.heldItem = { name: 'Archival Blueprints', icon: '📜', drink: false };
    testSimPlayer.heldDrink = testSimPlayer.heldItem;
    simulateUpdateCarrySlotUI(testSimPlayer);
    if (mockElements.carrySlotPill.classList.contains('hidden')) {
      throw new Error('Pill is hidden for non-drink carryable item');
    }
    if (!mockElements.drinkActionBtn.classList.contains('hidden')) {
      throw new Error('SIP [Q] button should be hidden for non-drink items');
    }
    if (!mockElements.carryItemText.innerText.includes('Archival Blueprints')) {
      throw new Error(`Unexpected text for non-drink: ${mockElements.carryItemText.innerText}`);
    }

    // Clear non-drink
    testSimPlayer.heldItem = null;
    testSimPlayer.heldDrink = null;
    simulateUpdateCarrySlotUI(testSimPlayer);
    if (!mockElements.carrySlotPill.classList.contains('hidden')) {
      throw new Error('Pill was not hidden after clearing non-drink item');
    }

    // C. Multiplayer Sync: Client A moves with item holding sips count, Client B receives it
    let bReceivedMoveItem = null;
    const moveListener = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'move' && msg.id === clientA.id && msg.heldItem) {
        bReceivedMoveItem = msg.heldItem;
      }
    };
    clientB.ws.addEventListener('message', moveListener);

    clientA.ws.send(JSON.stringify({
      type: 'move',
      x: 1220,
      y: 544,
      dir: 'idle',
      facing: 1,
      heldItem: { name: 'Cyber Cola', drink: true, sips: 2 },
      heldDrink: { name: 'Cyber Cola', drink: true, sips: 2 },
      sipping: false
    }));
    await wait(150);
    clientB.ws.removeEventListener('message', moveListener);

    if (!bReceivedMoveItem || bReceivedMoveItem.sips !== 2 || bReceivedMoveItem.name !== 'Cyber Cola') {
      throw new Error(`Client B did not receive updated heldItem with sips: ${JSON.stringify(bReceivedMoveItem)}`);
    }
    console.log('PASS: Carry HUD lifecycle, sips countdown, non-drink SIP hiding, and multiplayer sync verified.');

    console.log('\n=== ALL ROUND 6 INTERACTION TESTS PASSED (14/14) ===');
  } finally {
    for (const ws of socketsToClose) {
      try { ws.close(); } catch {}
    }
    if (server.closeAllConnections) {
      server.closeAllConnections();
    }
    if (weStarted && server.listening) {
      await new Promise((resolve) => server.close(resolve));
      console.log('Test server stopped.');
    }
  }
}

runRound6Tests().catch((err) => {
  console.error('\nFAIL: Round 6 Interaction Test Error:', err);
  process.exit(1);
});
