// test/bridge-test.js — Automated test for Forge Office WebSocket bridge
const { startServer, server } = require('../server.js');

async function runTest() {
  console.log('--- Starting Bridge Test ---');

  // If server is not already listening, start it on port 8904
  let testServer = server;
  let weStartedServer = false;
  if (!server.listening) {
    try {
      await startServer(8904, '127.0.0.1');
      weStartedServer = true;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') {
        console.error('FAIL: Could not start server:', err);
        process.exit(1);
      }
    }
  }

  const WS_URL = 'ws://127.0.0.1:8904/bridge';

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.error('FAIL: Bridge test timed out after 5000ms');
      cleanup(false);
    }, 5000);

    let wsA, wsB;
    let clientAId = null;
    let clientBId = null;
    let aReceivedWelcome = false;
    let bReceivedWelcome = false;
    let aSawBJoin = false;
    let moveSentTime = null;
    let roundTripTime = null;

    function cleanup(success) {
      clearTimeout(timeout);
      try { if (wsA && wsA.readyState === 1) wsA.close(); } catch {}
      try { if (wsB && wsB.readyState === 1) wsB.close(); } catch {}
      if (weStartedServer && testServer && testServer.listening) {
        testServer.close(() => {
          if (success) {
            console.log('PASS');
            process.exit(0);
          } else {
            console.log('FAIL');
            process.exit(1);
          }
        });
        return;
      }
      if (success) {
        console.log('PASS');
        process.exit(0);
      } else {
        console.log('FAIL');
        process.exit(1);
      }
    }

    try {
      wsA = new WebSocket(WS_URL);
    } catch (err) {
      console.error('FAIL: Could not instantiate WebSocket client A:', err);
      return cleanup(false);
    }

    wsA.onopen = () => {
      // Client A joins
      wsA.send(JSON.stringify({
        type: 'join',
        name: 'Alice',
        cosmetics: { color: 'coral', hat: 'cap', trail: 'sparkle', face: 'classic' },
        x: 100,
        y: 100
      }));
    };

    wsA.onerror = (err) => {
      console.error('FAIL: Client A error:', err);
      cleanup(false);
    };

    wsA.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'welcome') {
        clientAId = msg.you;
        aReceivedWelcome = true;
        // Now connect Client B
        connectClientB();
      } else if (msg.type === 'player-join') {
        if (msg.name === 'Bob') {
          aSawBJoin = true;
          checkStartMoveTest();
        }
      }
    };

    function connectClientB() {
      try {
        wsB = new WebSocket(WS_URL);
      } catch (err) {
        console.error('FAIL: Could not instantiate WebSocket client B:', err);
        return cleanup(false);
      }

      wsB.onerror = (err) => {
        console.error('FAIL: Client B error:', err);
        cleanup(false);
      };

      wsB.onopen = () => {
        wsB.send(JSON.stringify({
          type: 'join',
          name: 'Bob',
          cosmetics: { color: 'ocean', hat: 'beanie', trail: 'none', face: 'glasses' },
          x: 200,
          y: 200
        }));
      };

      wsB.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'welcome') {
          clientBId = msg.you;
          bReceivedWelcome = true;
          // Verify Client B received Alice in players list
          const aliceInList = msg.players && msg.players.some((p) => p.name === 'Alice');
          if (!aliceInList) {
            console.error('FAIL: Alice was not present in Bob welcome player list');
            return cleanup(false);
          }
          checkStartMoveTest();
        } else if (msg.type === 'move') {
          if (msg.id === clientAId && moveSentTime !== null) {
            roundTripTime = performance.now() - moveSentTime;
            console.log(`Received move from Alice in Bob! Round-trip: ${roundTripTime.toFixed(2)}ms`);

            if (roundTripTime >= 500) {
              console.error(`FAIL: Round-trip time ${roundTripTime.toFixed(2)}ms exceeds 500ms threshold`);
              return cleanup(false);
            }

            console.log(`Bridge latency assertion passed: ${roundTripTime.toFixed(2)}ms < 500ms`);
            return cleanup(true);
          }
        }
      };
    }

    let moveTestStarted = false;
    function checkStartMoveTest() {
      if (aReceivedWelcome && bReceivedWelcome && aSawBJoin && !moveTestStarted) {
        moveTestStarted = true;
        moveSentTime = performance.now();
        wsA.send(JSON.stringify({
          type: 'move',
          x: 150,
          y: 250,
          dir: 'right',
          facing: 1
        }));
      }
    }
  });
}

runTest().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
