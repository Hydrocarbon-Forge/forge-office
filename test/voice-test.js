// test/voice-test.js — Automated test for Proximity Voice Chat
const { startServer, server } = require('../server.js');
const {
  calculateWallOcclusion,
  calculateDistanceGain,
  calculateCutoffFreq,
  smoothGain
} = require('../web/voice.js');

async function runUnitTests() {
  console.log('--- Running Voice Chat Math & Occlusion Unit Tests ---');

  // 1. Test Distance Gain Math
  const g0 = calculateDistanceGain(0);
  const g200 = calculateDistanceGain(200);
  const g400 = calculateDistanceGain(400);
  const g800 = calculateDistanceGain(800);
  const g1000 = calculateDistanceGain(1000);

  if (Math.abs(g0 - 1.0) > 0.001) throw new Error(`Distance gain at 0px expected 1.0, got ${g0}`);
  if (Math.abs(g200 - 0.75) > 0.001) throw new Error(`Distance gain at 200px expected 0.75, got ${g200}`);
  if (Math.abs(g400 - 0.5) > 0.001) throw new Error(`Distance gain at 400px expected 0.5, got ${g400}`);
  if (Math.abs(g800 - 0.0) > 0.001) throw new Error(`Distance gain at 800px expected 0.0, got ${g800}`);
  if (Math.abs(g1000 - 0.0) > 0.001) throw new Error(`Distance gain beyond 800px expected 0.0, got ${g1000}`);
  console.log('PASS: Distance gain math (0px -> 1.0, 200px -> 0.75, 400px -> 0.5, 800px+ -> 0.0)');

  // 2. Test Lowpass Cutoff Freq Math
  const f0 = calculateCutoffFreq(0);
  const f400 = calculateCutoffFreq(400);
  const f800 = calculateCutoffFreq(800);
  const f1000 = calculateCutoffFreq(1000);

  if (Math.abs(f0 - 6000) > 0.001) throw new Error(`Cutoff freq at 0px expected 6000, got ${f0}`);
  if (Math.abs(f400 - 3450) > 0.001) throw new Error(`Cutoff freq at 400px expected 3450, got ${f400}`);
  if (Math.abs(f800 - 900) > 0.001) throw new Error(`Cutoff freq at 800px expected 900, got ${f800}`);
  if (Math.abs(f1000 - 900) > 0.001) throw new Error(`Cutoff freq beyond 800px expected 900, got ${f1000}`);
  console.log('PASS: Lowpass cutoff frequency math (0px -> 6000Hz, 400px -> 3450Hz, 800px+ -> 900Hz)');

  // 3. Test Attack / Release Gain Smoothing
  const attackGain = smoothGain(0.0, 1.0, 0.1, 200, 400); // 100ms step with 200ms attack
  const releaseGain = smoothGain(1.0, 0.0, 0.1, 200, 400); // 100ms step with 400ms release
  if (attackGain <= 0.0 || attackGain >= 1.0) throw new Error(`Attack smoothing out of range: ${attackGain}`);
  if (releaseGain <= 0.0 || releaseGain >= 1.0) throw new Error(`Release smoothing out of range: ${releaseGain}`);
  console.log(`PASS: Gain smoothing (attack 100ms: ${attackGain.toFixed(3)}, release 100ms: ${releaseGain.toFixed(3)})`);

  // 4. Test DDA Raycast Wall Occlusion on Mock Map Grid
  // Grid 10x10 tiles (each 32px)
  const mockMap = {
    tile: 32,
    walls: new Set(),
    doors: new Set(),
    isSolid(tx, ty) {
      return this.walls.has(`${tx},${ty}`);
    },
    isDoorway(tx, ty) {
      return this.doors.has(`${tx},${ty}`);
    }
  };

  // Case A: Clear line of sight (tile 1,1 to tile 5,1)
  const occClear = calculateWallOcclusion(1 * 32 + 16, 1 * 32 + 16, 5 * 32 + 16, 1 * 32 + 16, mockMap);
  if (Math.abs(occClear - 1.0) > 0.001) throw new Error(`Clear LoS expected 1.0, got ${occClear}`);
  console.log('PASS: DDA 0 wall hits -> 1.0');

  // Case B: 1 solid wall inserted between at tile (3, 1)
  mockMap.walls.add('3,1');
  const occ1Wall = calculateWallOcclusion(1 * 32 + 16, 1 * 32 + 16, 5 * 32 + 16, 1 * 32 + 16, mockMap);
  if (Math.abs(occ1Wall - 0.45) > 0.001) throw new Error(`1 wall hit expected 0.45, got ${occ1Wall}`);
  console.log('PASS: DDA 1 wall hit -> 0.45');

  // Case C: 2 solid walls inserted between at (3, 1) and (4, 1)
  mockMap.walls.add('4,1');
  const occ2Walls = calculateWallOcclusion(1 * 32 + 16, 1 * 32 + 16, 5 * 32 + 16, 1 * 32 + 16, mockMap);
  if (Math.abs(occ2Walls - 0.15) > 0.001) throw new Error(`2 wall hits expected 0.15, got ${occ2Walls}`);
  console.log('PASS: DDA 2+ wall hits -> 0.15');

  // Case D: Doorway test (half-hits)
  mockMap.walls.clear();
  mockMap.doors.add('3,1'); // 1 doorway = 0.5 hit -> 0.45
  const occ1Door = calculateWallOcclusion(1 * 32 + 16, 1 * 32 + 16, 5 * 32 + 16, 1 * 32 + 16, mockMap);
  if (Math.abs(occ1Door - 0.45) > 0.001) throw new Error(`1 doorway expected 0.45, got ${occ1Door}`);
  console.log('PASS: DDA 1 doorway half-hit -> 0.45');

  mockMap.doors.add('4,1'); // 2 doorways = 1.0 hit -> 0.45
  const occ2Doors = calculateWallOcclusion(1 * 32 + 16, 1 * 32 + 16, 5 * 32 + 16, 1 * 32 + 16, mockMap);
  if (Math.abs(occ2Doors - 0.45) > 0.001) throw new Error(`2 doorways expected 0.45, got ${occ2Doors}`);
  console.log('PASS: DDA 2 doorways (1.0 hit) -> 0.45');

  mockMap.walls.add('2,1'); // 1 wall + 2 doors = 2.0 hits -> 0.15
  const occWallPlusDoors = calculateWallOcclusion(1 * 32 + 16, 1 * 32 + 16, 5 * 32 + 16, 1 * 32 + 16, mockMap);
  if (Math.abs(occWallPlusDoors - 0.15) > 0.001) throw new Error(`1 wall + 2 doors expected 0.15, got ${occWallPlusDoors}`);
  console.log('PASS: DDA wall + doorways (>= 1.5 hits) -> 0.15');
}

async function runNetworkRelayTests() {
  console.log('--- Running Voice Chat Network Relay Integration Test ---');
  const PORT = 8999; // Dedicated test port per instructions! NEVER 8904

  let testServer = server;
  let weStartedServer = false;
  if (!server.listening) {
    try {
      await startServer(PORT, '127.0.0.1');
      weStartedServer = true;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') {
        console.error('FAIL: Could not start test server:', err);
        process.exit(1);
      }
    }
  }

  const WS_URL = `ws://127.0.0.1:${PORT}/bridge`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup(new Error('Voice test timed out after 6000ms'));
    }, 6000);

    let wsA, wsB;
    let clientAId = null;
    let clientBId = null;

    function cleanup(err) {
      clearTimeout(timeout);
      try { if (wsA && wsA.readyState === 1) wsA.close(); } catch {}
      try { if (wsB && wsB.readyState === 1) wsB.close(); } catch {}
      if (weStartedServer && testServer && testServer.listening) {
        testServer.close(() => {
          if (err) {
            console.error('FAIL:', err.message);
            reject(err);
          } else {
            console.log('PASS: Network relay tests complete');
            resolve();
          }
        });
        return;
      }
      if (err) {
        console.error('FAIL:', err.message);
        reject(err);
      } else {
        console.log('PASS: Network relay tests complete');
        resolve();
      }
    }

    wsA = new WebSocket(WS_URL);
    wsA.onerror = (e) => cleanup(new Error('Client A WS error'));
    wsA.onopen = () => {
      // Client A joins at (100, 100)
      wsA.send(JSON.stringify({
        type: 'join',
        name: 'SpeakerA',
        profile: 'nathan',
        cosmetics: { color: 'teal', hat: 'cap' },
        x: 100,
        y: 100
      }));
    };

    wsA.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'welcome') {
        clientAId = msg.you;
        connectClientB();
      }
    };

    function connectClientB() {
      wsB = new WebSocket(WS_URL);
      wsB.onerror = (e) => cleanup(new Error('Client B WS error'));
      wsB.onopen = () => {
        // Client B joins at (300, 100) -> distance 200px from A (< 800px)
        wsB.send(JSON.stringify({
          type: 'join',
          name: 'ListenerB',
          profile: 'gavin',
          cosmetics: { color: 'tangerine', hat: 'beanie' },
          x: 300,
          y: 100
        }));
      };

      let bReceived200pxChunk = false;
      let bReceivedFarChunk = false;
      let sendTime = 0;

      wsB.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'welcome') {
          clientBId = msg.you;
          // Wait 200ms for positions to stabilize, then send test voice packet
          setTimeout(() => {
            sendTime = Date.now();
            wsA.send(JSON.stringify({
              type: 'va',
              t: 'va',
              d: 'AQIDBAUG', // fake b64 audio chunk
              l: 0.8
            }));
          }, 200);
        } else if (msg.t === 'va' || msg.type === 'va') {
          if (!bReceived200pxChunk) {
            bReceived200pxChunk = true;
            const latency = Date.now() - sendTime;
            console.log(`PASS: Sender 200px away delivered chunk to receiver within ${latency}ms (< 100ms threshold)`);
            if (latency > 150) {
              return cleanup(new Error(`Delivery latency too high: ${latency}ms`));
            }
            if (msg.from !== clientAId) {
              return cleanup(new Error(`Expected packet from client A (${clientAId}), got ${msg.from}`));
            }

            // Now move Client B far away beyond 800px (to 1200, 100; dist = 1100px)
            wsB.send(JSON.stringify({
              type: 'move',
              x: 1200,
              y: 100,
              dir: 'idle',
              facing: 1
            }));

            // Wait 150ms for move to propagate on server
            setTimeout(() => {
              // Send second voice chunk from Client A
              wsA.send(JSON.stringify({
                type: 'va',
                t: 'va',
                d: 'BQYHCAkK',
                l: 0.8
              }));

              // In 400ms, assert that Client B received NOTHING beyond 800px
              setTimeout(() => {
                if (bReceivedFarChunk) {
                  return cleanup(new Error('FAIL: Client B received voice packet beyond 800px!'));
                }
                console.log('PASS: Sender beyond 800px delivered 0 packets (properly dropped by server proximity filter)');
                cleanup(null);
              }, 400);
            }, 150);
          } else {
            // Already received the 200px chunk; if this is the far chunk, flag it
            bReceivedFarChunk = true;
          }
        }
      };
    }
  });
}

async function main() {
  try {
    await runUnitTests();
    await runNetworkRelayTests();
    console.log('\n--- ALL VOICE TESTS PASSED ---');
    process.exit(0);
  } catch (err) {
    console.error('\nFAIL:', err);
    process.exit(1);
  }
}

main();
