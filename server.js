// server.js — Forge Office static file server, /api proxy, and hand-rolled WebSocket bridge
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const PORT = parseInt(process.env.PORT, 10) || 8904;
const HOST = '0.0.0.0';
const CONSOLE_API_HOST = '127.0.0.1';
const CONSOLE_API_PORT = 8903;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg'
};

// Seed for deterministic office agent behavior (day-based + fixed offset)
const AGENTS_SEED = Math.floor(Date.now() / (1000 * 60 * 60 * 24)) * 10007 + 4242;

// Presence, clock stats, and discord service
const { ClockManager } = require('./clock-manager.js');
const { discordPresenceService } = require('./discord-presence.js');

const clockManager = new ClockManager();
discordPresenceService.start();

// ---------------------------------------------------------------------------
// Static file & API Proxy HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname || '/';

  // 1. Office Presence endpoint
  if (pathname === '/api/office/presence') {
    const discordPres = discordPresenceService.getPresence();
    const presenceData = clockManager.getPresenceAndStats(discordPres);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(presenceData));
    return;
  }

  // Office Profile endpoints
  if (pathname === '/api/office/profile') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const saved = clockManager.upsertProfile(parsed);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, profile: saved }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(clockManager.profilesData));
      return;
    }
  }

  // Drink presets endpoints
  if (pathname === '/api/office/drink-presets') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const saved = clockManager.saveDrinkPresets(parsed.profile, parsed.presets);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, presets: saved }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    } else {
      const prof = (parsedUrl.searchParams.get('profile') || 'nathan').toLowerCase();
      const presets = (clockManager.profilesData[prof] && clockManager.profilesData[prof].drinkPresets) || [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, presets }));
      return;
    }
  }

  // Music tracks listing endpoint
  if (pathname === '/api/office/music') {
    const musicDir = path.join(__dirname, 'web', 'music');
    try {
      if (fs.existsSync(musicDir)) {
        const files = fs.readdirSync(musicDir)
          .filter((f) => f.toLowerCase().endsWith('.mp3'))
          .sort()
          .map((f) => `/music/${f}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, tracks: files, files }));
        return;
      }
    } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, tracks: [], files: [] }));
    return;
  }

  // 2. Proxy /api/* -> http://127.0.0.1:8903/api/*
  if (pathname.startsWith('/api/')) {
    const proxyReq = http.request(
      {
        host: CONSOLE_API_HOST,
        port: CONSOLE_API_PORT,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: `${CONSOLE_API_HOST}:${CONSOLE_API_PORT}`
        }
      },
      (proxyRes) => {
        if (!res.headersSent) {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        }
      }
    );

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Console API offline', detail: err.message }));
      }
    });

    req.pipe(proxyReq);
    return;
  }

  // 2. Static files
  let safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  if (safePath === '/' || safePath === '') {
    safePath = '/index.html';
  }

  let filePath = path.join(__dirname, 'web', safePath);

  // If request asks for data/*, look in data folder
  if (safePath.startsWith('/data/') || safePath.startsWith('data/')) {
    filePath = path.join(__dirname, safePath);
  }

  // Fallback check: if not in web, check root
  if (!fs.existsSync(filePath)) {
    const rootPath = path.join(__dirname, safePath);
    if (fs.existsSync(rootPath) && fs.statSync(rootPath).isFile()) {
      filePath = rootPath;
    }
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache'
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

// ---------------------------------------------------------------------------
// Hand-rolled WebSocket Implementation (RFC 6455)
// ---------------------------------------------------------------------------
const clients = new Map(); // id -> ClientState

// Meeting room & interactive station state (synced over WS)
let meetingDoorClosed = false;
let whiteboardStrokes = []; // Array of { points: [{x, y}], color: string, width: number }
let typingBoardLines = [
  'Hydrocarbon Forge Agenda',
  '1. Architecture review',
  '2. Sprint deliverables',
  '3. Open discussion'
];
let projectorDockedPlayer = null; // { id, name, room, action, time }

function isInMeetingRoom(x, y) {
  const tx = Math.floor(x / 32);
  const ty = Math.floor(y / 32);
  return tx >= 34 && tx <= 42 && ty >= 15 && ty <= 22;
}

function makeFrame(payloadStr, opcode = 0x01) {
  const payloadBuf = Buffer.from(payloadStr, 'utf8');
  const len = payloadBuf.length;
  let header;

  if (len <= 125) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | (opcode & 0x0f); // FIN + opcode
    header[1] = len; // unmasked
  } else if (len <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payloadBuf]);
}

function makeCloseFrame(code = 1000) {
  const buf = Buffer.alloc(4);
  buf[0] = 0x88; // FIN + Close
  buf[1] = 2; // length 2
  buf.writeUInt16BE(code, 2);
  return buf;
}

function makePongFrame(payloadBuf = Buffer.alloc(0)) {
  const len = Math.min(payloadBuf.length, 125);
  const header = Buffer.alloc(2);
  header[0] = 0x8a; // FIN + Pong
  header[1] = len;
  return Buffer.concat([header, payloadBuf.subarray(0, len)]);
}

function broadcast(msgObj, excludeId = null) {
  const frame = makeFrame(JSON.stringify(msgObj));
  for (const [id, client] of clients) {
    if (id !== excludeId && !client.socket.destroyed) {
      try {
        client.socket.write(frame);
      } catch {
        // ignore socket write errors; cleanup happens in socket close
      }
    }
  }
}

function sendTo(socket, msgObj) {
  if (!socket.destroyed) {
    try {
      socket.write(makeFrame(JSON.stringify(msgObj)));
    } catch {
      // ignore
    }
  }
}

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname !== '/bridge') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const secKey = req.headers['sec-websocket-key'];
  if (!secKey) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  const acceptKey = crypto
    .createHash('sha1')
    .update(secKey + GUID)
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '\r\n'
  ];

  socket.write(headers.join('\r\n'));

  const clientId = 'p_' + Math.random().toString(36).substring(2, 9);
  const client = {
    id: clientId,
    socket,
    name: 'Visitor',
    cosmetics: { color: 'coral', hat: 'none', trail: 'none', face: 'classic' },
    x: 21 * 32,
    y: 17 * 32,
    dir: 'idle',
    facing: 1,
    lastSeen: Date.now(),
    joined: false,
    profile: 'guest'
  };

  clients.set(clientId, client);

  let rxBuffer = head && head.length > 0 ? head : Buffer.alloc(0);

  socket.on('data', (chunk) => {
    client.lastSeen = Date.now();
    rxBuffer = Buffer.concat([rxBuffer, chunk]);

    while (rxBuffer.length >= 2) {
      const b0 = rxBuffer[0];
      const b1 = rxBuffer[1];

      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;

      let offset = 2;
      if (payloadLen === 126) {
        if (rxBuffer.length < 4) break;
        payloadLen = rxBuffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (rxBuffer.length < 10) break;
        payloadLen = Number(rxBuffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskKeyLen = masked ? 4 : 0;
      if (rxBuffer.length < offset + maskKeyLen + payloadLen) {
        // Incomplete frame, wait for more data
        break;
      }

      let maskKey = null;
      if (masked) {
        maskKey = rxBuffer.subarray(offset, offset + 4);
        offset += 4;
      }

      const payload = rxBuffer.subarray(offset, offset + payloadLen);
      const unmasked = Buffer.alloc(payloadLen);

      if (masked && maskKey) {
        for (let i = 0; i < payloadLen; i++) {
          unmasked[i] = payload[i] ^ maskKey[i % 4];
        }
      } else {
        payload.copy(unmasked);
      }

      rxBuffer = rxBuffer.subarray(offset + payloadLen);

      // Handle Opcode
      if (opcode === 0x08) {
        // Close frame
        try {
          socket.write(makeCloseFrame());
        } catch {}
        socket.destroy();
        return;
      } else if (opcode === 0x09) {
        // Ping -> Pong
        try {
          socket.write(makePongFrame(unmasked));
        } catch {}
      } else if (opcode === 0x0a) {
        // Pong
        client.lastSeen = Date.now();
      } else if (opcode === 0x01) {
        // Text message
        try {
          const text = unmasked.toString('utf8');
          const msg = JSON.parse(text);
          handleClientMessage(client, msg);
        } catch (err) {
          // Bad JSON or parse error, ignore
        }
      }
    }
  });

  const cleanup = () => {
    if (clients.has(clientId)) {
      clients.delete(clientId);
      if (projectorDockedPlayer && projectorDockedPlayer.id === clientId) {
        projectorDockedPlayer = null;
        broadcast({ type: 'projector-update', presenter: null });
      }
      if (client.joined) {
        if (client.profile && client.profile !== 'guest') {
          clockManager.clockOut(client.profile, clientId);
        }
        broadcast({ type: 'player-leave', id: clientId }, clientId);
      }
    }
  };

  socket.on('end', cleanup);
  socket.on('close', cleanup);
  socket.on('error', () => {
    socket.destroy();
    cleanup();
  });
});

function handleClientMessage(client, msg) {
  if (!msg || typeof msg !== 'object') return;
  const now = Date.now();
  client.lastSeen = now;

  const msgType = msg.t || msg.type;
  switch (msgType) {
    case 'join': {
      if (typeof msg.name === 'string' && msg.name.trim()) {
        client.name = msg.name.trim().substring(0, 16);
      }
      if (typeof msg.profile === 'string' && msg.profile.trim()) {
        client.profile = msg.profile.trim().toLowerCase();
      } else {
        const lowerName = (client.name || '').toLowerCase();
        if (lowerName === 'nathan' || lowerName === 'gavin') {
          client.profile = lowerName;
        } else {
          client.profile = 'guest';
        }
      }
      if (msg.cosmetics && typeof msg.cosmetics === 'object') {
        client.cosmetics = {
          color: String(msg.cosmetics.color || 'coral'),
          hat: String(msg.cosmetics.hat || 'none'),
          trail: String(msg.cosmetics.trail || 'none'),
          face: String(msg.cosmetics.face || 'classic')
        };
      }
      if (typeof msg.x === 'number') client.x = msg.x;
      if (typeof msg.y === 'number') client.y = msg.y;
      client.joined = true;

      // Clock in & upsert profile
      if (client.profile && client.profile !== 'guest') {
        clockManager.clockIn(client.profile, client.id, now);
        clockManager.upsertProfile({
          profile: client.profile,
          name: client.name,
          cosmetics: client.cosmetics
        });
      }

      // Prepare list of other players
      const otherPlayers = [];
      for (const [id, c] of clients) {
        if (id !== client.id && c.joined) {
          otherPlayers.push({
            id: c.id,
            name: c.name,
            profile: c.profile,
            cosmetics: c.cosmetics,
            x: c.x,
            y: c.y,
            dir: c.dir,
            facing: c.facing,
            heldItem: c.heldItem || c.heldDrink || null,
            heldDrink: c.heldDrink || c.heldItem || null,
            sipping: Boolean(c.sipping)
          });
        }
      }

      // Welcome response
      sendTo(client.socket, {
        type: 'welcome',
        you: client.id,
        players: otherPlayers,
        agentsSeed: AGENTS_SEED,
        meetingDoorClosed: meetingDoorClosed,
        whiteboardStrokes: whiteboardStrokes,
        typingBoardLines: typingBoardLines,
        projectorPresenter: projectorDockedPlayer
      });

      // Notify others
      broadcast(
        {
          type: 'player-join',
          id: client.id,
          name: client.name,
          profile: client.profile,
          cosmetics: client.cosmetics,
          x: client.x,
          y: client.y,
          dir: client.dir,
          facing: client.facing
        },
        client.id
      );
      break;
    }

    case 'move': {
      if (typeof msg.x === 'number') client.x = msg.x;
      if (typeof msg.y === 'number') client.y = msg.y;
      if (typeof msg.dir === 'string') client.dir = msg.dir;
      if (typeof msg.facing === 'number') client.facing = msg.facing;
      if (msg.heldItem !== undefined) {
        client.heldItem = msg.heldItem;
        client.heldDrink = msg.heldItem;
      } else if (msg.heldDrink !== undefined) {
        client.heldDrink = msg.heldDrink;
        client.heldItem = msg.heldDrink;
      }
      if (typeof msg.sipping === 'boolean') client.sipping = msg.sipping;

      // Relay move to other players
      broadcast(
        {
          type: 'move',
          id: client.id,
          x: client.x,
          y: client.y,
          dir: client.dir,
          facing: client.facing,
          heldItem: client.heldItem,
          heldDrink: client.heldDrink,
          sipping: client.sipping
        },
        client.id
      );
      break;
    }

    case 'equip': {
      if (msg.cosmetics && typeof msg.cosmetics === 'object') {
        client.cosmetics = {
          color: String(msg.cosmetics.color || client.cosmetics.color),
          hat: String(msg.cosmetics.hat || client.cosmetics.hat),
          trail: String(msg.cosmetics.trail || client.cosmetics.trail),
          face: String(msg.cosmetics.face || client.cosmetics.face)
        };
        if (client.profile && client.profile !== 'guest') {
          clockManager.upsertProfile({
            profile: client.profile,
            name: client.name,
            cosmetics: client.cosmetics
          });
        }
        broadcast(
          {
            type: 'equip',
            id: client.id,
            cosmetics: client.cosmetics
          },
          client.id
        );
      }
      break;
    }

    case 'name': {
      if (typeof msg.name === 'string' && msg.name.trim()) {
        client.name = msg.name.trim().substring(0, 16);
        broadcast(
          {
            type: 'name',
            id: client.id,
            name: client.name
          },
          client.id
        );
      }
      break;
    }

    case 'ping': {
      sendTo(client.socket, { type: 'pong' });
      break;
    }

    case 'meeting-door': {
      meetingDoorClosed = !!msg.closed;
      broadcast({ type: 'meeting-door', closed: meetingDoorClosed });
      break;
    }

    case 'whiteboard-stroke': {
      if (msg.stroke && Array.isArray(msg.stroke.points)) {
        const stroke = {
          points: msg.stroke.points.slice(0, 250).map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
          color: String(msg.stroke.color || '#1E293B'),
          width: Math.min(24, Math.max(1, Number(msg.stroke.width) || 3))
        };
        whiteboardStrokes.push(stroke);
        if (whiteboardStrokes.length > 500) {
          whiteboardStrokes.splice(0, whiteboardStrokes.length - 500);
        }
        broadcast({ type: 'whiteboard-stroke', stroke }, client.id);
      }
      break;
    }

    case 'whiteboard-clear': {
      whiteboardStrokes = [];
      broadcast({ type: 'whiteboard-clear' });
      break;
    }

    case 'typing-board-input': {
      if (Array.isArray(msg.lines)) {
        typingBoardLines = msg.lines.slice(0, 16);
      } else if (msg.text || (msg.action === 'append' && msg.text)) {
        const item = {
          text: String(msg.text).slice(0, 80),
          author: msg.author || client.name || 'Colleague',
          time: Date.now()
        };
        typingBoardLines.push(item);
        if (typingBoardLines.length > 20) typingBoardLines.shift();
      } else if (msg.op === 'append' && typeof msg.char === 'string') {
        const lIdx = Math.max(0, Math.min(typingBoardLines.length - 1, Number(msg.line) || 0));
        if (typeof typingBoardLines[lIdx] === 'string') {
          if (typingBoardLines[lIdx].length < 36) {
            typingBoardLines[lIdx] += msg.char;
          }
        } else if (typingBoardLines[lIdx] && typeof typingBoardLines[lIdx].text === 'string') {
          typingBoardLines[lIdx].text += msg.char;
        } else {
          typingBoardLines.push({ text: msg.char, author: client.name, time: Date.now() });
        }
      } else if (msg.op === 'delete' || msg.action === 'delete') {
        if (typingBoardLines.length > 0) {
          typingBoardLines.pop();
        }
      } else if (msg.action === 'clear' || msg.op === 'clear') {
        typingBoardLines = [];
      }
      broadcast({ type: 'typing-board-sync', lines: typingBoardLines });
      break;
    }

    case 'projector-dock': {
      if (projectorDockedPlayer && projectorDockedPlayer.id !== client.id) {
        sendTo(client.socket, {
          type: 'projector-busy',
          dockedBy: projectorDockedPlayer.name || 'Another player'
        });
      } else {
        const topic = typeof msg.action === 'string' ? msg.action.slice(0, 40) : (typeof msg.topic === 'string' ? msg.topic.slice(0, 40) : 'Live Architecture Review');
        projectorDockedPlayer = {
          id: client.id,
          name: client.name || 'Presenter',
          room: 'Meeting Room',
          action: topic,
          topic: topic,
          screenShareActive: Boolean(msg.screenShareActive),
          time: Date.now()
        };
        broadcast({ type: 'projector-update', presenter: projectorDockedPlayer });
      }
      break;
    }

    case 'projector-undock': {
      if (projectorDockedPlayer && projectorDockedPlayer.id === client.id) {
        projectorDockedPlayer = null;
        broadcast({ type: 'projector-update', presenter: null });
      }
      break;
    }

    case 'projector-action': {
      if (projectorDockedPlayer && projectorDockedPlayer.id === client.id) {
        if (typeof msg.action === 'string') {
          projectorDockedPlayer.action = msg.action.slice(0, 40);
          projectorDockedPlayer.topic = projectorDockedPlayer.action;
        }
        if (typeof msg.topic === 'string') {
          projectorDockedPlayer.topic = msg.topic.slice(0, 40);
          projectorDockedPlayer.action = projectorDockedPlayer.topic;
        }
        if (msg.screenShareActive !== undefined) {
          projectorDockedPlayer.screenShareActive = Boolean(msg.screenShareActive);
        }
        broadcast({ type: 'projector-update', presenter: projectorDockedPlayer });
      }
      break;
    }

    case 'va': {
      // Proximity voice audio packet: { t: 'va', d: b64chunk, l: level, sr: sampleRate }
      if (typeof msg.d !== 'string') break;
      const level = typeof msg.l === 'number' ? msg.l : 0.5;
      const senderX = client.x;
      const senderY = client.y;
      const sr = typeof msg.sr === 'number' ? msg.sr : undefined;

      const senderInMeeting = isInMeetingRoom(senderX, senderY);

      // Forward to every other joined client whose player is within 800px (no echo back to sender)
      for (const [otherId, otherClient] of clients) {
        if (otherId !== client.id && otherClient.joined && !otherClient.socket.destroyed) {
          const receiverInMeeting = isInMeetingRoom(otherClient.x, otherClient.y);
          if (meetingDoorClosed && (senderInMeeting !== receiverInMeeting)) {
            // Closed meeting room isolates voice: inside only hears inside, outside only hears outside
            continue;
          }
          const dist = Math.hypot(otherClient.x - senderX, otherClient.y - senderY);
          if (dist <= 800) {
            sendTo(otherClient.socket, {
              t: 'va',
              from: client.id,
              name: client.name,
              d: msg.d,
              l: level,
              sr: sr,
              x: senderX,
              y: senderY
            });
          }
        }
      }
      break;
    }
  }
}

// Heartbeat checker: check every 5s, drop inactive > 12s
const HEARTBEAT_INTERVAL = setInterval(() => {
  const now = Date.now();
  for (const [id, client] of clients) {
    if (now - client.lastSeen > 12000) {
      try {
        client.socket.write(makeCloseFrame(1000));
      } catch {}
      client.socket.destroy();
      clients.delete(id);
      if (client.joined) {
        if (projectorDockedPlayer && projectorDockedPlayer.id === id) {
          projectorDockedPlayer = null;
          broadcast({ type: 'projector-update', presenter: null });
        }
        if (client.profile && client.profile !== 'guest') {
          clockManager.clockOut(client.profile, id, now);
        }
        broadcast({ type: 'player-leave', id });
      }
    } else {
      // Send a lightweight ping frame to keep socket active
      if (!client.socket.destroyed) {
        try {
          const pingBuf = Buffer.alloc(2);
          pingBuf[0] = 0x89; // FIN + Ping
          pingBuf[1] = 0;
          client.socket.write(pingBuf);
        } catch {}
      }
    }
  }
}, 5000);

HEARTBEAT_INTERVAL.unref();

function startServer(port = PORT, host = HOST) {
  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      console.log(`Forge Office running on http://${host}:${port}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = { server, startServer, PORT, HOST, clockManager, discordPresenceService };
