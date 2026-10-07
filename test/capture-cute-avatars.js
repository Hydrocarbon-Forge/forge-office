const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CDP_PORT = 9225;

async function run() {
  const renderJs = fs.readFileSync(path.resolve(__dirname, '../web/render.js'), 'utf8');

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    background: #0F1318;
    color: #F1F5F9;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 24px;
  }
  h1 {
    font-size: 20px;
    margin: 0 0 6px 0;
    color: #F8FAFC;
  }
  p {
    font-size: 13px;
    color: #94A3B8;
    margin: 0 0 16px 0;
  }
  .card {
    background: #181E26;
    border: 1px solid #2B3542;
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 24px;
    display: inline-block;
  }
  .card h2 {
    font-size: 14px;
    margin: 0 0 10px 0;
    color: #38BDF8;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  canvas {
    background: #11161D;
    border: 1px solid #222933;
    border-radius: 8px;
    display: block;
  }
</style>
</head>
<body>
  <h1>Hydrocarbon Forge — Cute Non-Human Creature Avatars</h1>
  <p>Non-human marshmallow-critter creature redesign with lively animations, hex Carbon-6 brand badge, and full cosmetics support.</p>

  <div class="card">
    <h2>1. Default Cute Creature (Idle)</h2>
    <canvas id="idleCanvas" width="320" height="160"></canvas>
  </div>

  <div class="card">
    <h2>2. Lively Walk Cycle (Shuffle + Sinusoidal Bob)</h2>
    <canvas id="walkCanvas" width="560" height="160"></canvas>
  </div>

  <br>

  <div class="card">
    <h2>3. Special Agent Identities (C6, OpenCode, Claude, Gemini)</h2>
    <canvas id="agentsCanvas" width="680" height="160"></canvas>
  </div>

  <br>

  <div class="card">
    <h2>4. Cute Face & Hat Variations</h2>
    <canvas id="cosmeticsCanvas" width="880" height="160"></canvas>
  </div>

  <br>

  <div class="card">
    <h2>5. Interactive States (Sitting, Sipping, Coffee, Papers)</h2>
    <canvas id="statesCanvas" width="680" height="160"></canvas>
  </div>

  <script>
    ${renderJs}

    window.onload = function() {
      // 1. Idle
      {
        const canvas = document.getElementById('idleCanvas');
        const ctx = canvas.getContext('2d');
        const r = new window.Renderer(canvas);
        r.renderAvatar(ctx, 80, 80, { color: 'coral', hat: 'none', face: 'plain', scale: 3.5 });
        ctx.fillStyle = '#94A3B8'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('Default Critter (Front)', 80, 140);

        r.renderAvatar(ctx, 220, 80, { color: 'coral', hat: 'none', face: 'plain', facing: -1, scale: 3.5 });
        ctx.fillText('Default Critter (Flipped)', 220, 140);
      }

      // 2. Walk cycle
      {
        const canvas = document.getElementById('walkCanvas');
        const ctx = canvas.getContext('2d');
        const r = new window.Renderer(canvas);
        [0, 1, 2, 3].forEach((f, idx) => {
          const x = 70 + idx * 140;
          r.renderAvatar(ctx, x, 75, { color: 'teal', isMoving: true, frame: f, scale: 3.2 });
          ctx.fillStyle = '#94A3B8'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('Frame ' + f + (f % 2 === 0 ? ' (Step)' : ' (Pass)'), x, 138);
        });
      }

      // 3. Agents
      {
        const canvas = document.getElementById('agentsCanvas');
        const ctx = canvas.getContext('2d');
        const r = new window.Renderer(canvas);
        const agents = [
          { name: 'C6 Receptionist', opt: { color: '#E9C46A', hat: 'headset', face: 'visor-glow', isAgentC6: true, forgeTool: true } },
          { name: 'OpenCode', opt: { color: '#00A896', hat: 'headphones', face: 'round-glasses', isAgentOpenCode: true } },
          { name: 'Claude', opt: { color: '#E07A5F', hat: 'beret', face: 'happy', isAgentClaude: true, hasScarf: true, scarfColor: '#E07A5F' } },
          { name: 'Gemini', opt: { color: '#3D5A80', hat: 'cap', face: 'sparkle', isAgentGemini: true } }
        ];
        agents.forEach((ag, idx) => {
          const x = 85 + idx * 170;
          r.renderAvatar(ctx, x, 75, { ...ag.opt, scale: 3.2 });
          ctx.fillStyle = '#CBD5E1'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(ag.name, x, 138);
        });
      }

      // 4. Cosmetics
      {
        const canvas = document.getElementById('cosmeticsCanvas');
        const ctx = canvas.getContext('2d');
        const r = new window.Renderer(canvas);
        const items = [
          { label: 'Happy (Mint)', opt: { color: 'mint', face: 'happy', hat: 'none' } },
          { label: 'Blush (Ruby)', opt: { color: 'ruby', face: 'blush', hat: 'none' } },
          { label: 'Antenna (Ocean)', opt: { color: 'ocean', face: 'antenna', hat: 'none' } },
          { label: 'Glasses + Beanie', opt: { color: 'tangerine', face: 'round-glasses', hat: 'beanie' } },
          { label: 'Sparkle + Crown', opt: { color: 'lemon', face: 'sparkle', hat: 'crown' } },
          { label: 'Visor Glow + Hard-Hat', opt: { color: 'cloud', face: 'visor-glow', hat: 'hard-hat' } }
        ];
        items.forEach((item, idx) => {
          const x = 75 + idx * 145;
          r.renderAvatar(ctx, x, 75, { ...item.opt, scale: 3.0 });
          ctx.fillStyle = '#CBD5E1'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(item.label, x, 138);
        });
      }

      // 5. Interactive States
      {
        const canvas = document.getElementById('statesCanvas');
        const ctx = canvas.getContext('2d');
        const r = new window.Renderer(canvas);
        const states = [
          { label: 'Sitting Plump', opt: { color: 'lavender', isSitting: true } },
          { label: 'Holding Coffee', opt: { color: 'sand', heldItem: { name: 'Latte', color: '#D97706' } } },
          { label: 'Sipping Drink', opt: { color: 'coral', heldItem: { name: 'Tea', color: '#059669' }, sipping: true } },
          { label: 'Carrying Papers', opt: { color: 'teal', papers: true } }
        ];
        states.forEach((st, idx) => {
          const x = 85 + idx * 170;
          r.renderAvatar(ctx, x, 75, { ...st.opt, scale: 3.2 });
          ctx.fillStyle = '#CBD5E1'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(st.label, x, 138);
        });
      }

      window.__RENDER_DONE__ = true;
    };
  </script>
</body>
</html>`;

  const htmlPath = path.resolve(__dirname, 'cute-avatars.html');
  fs.writeFileSync(htmlPath, htmlContent);

  const chromeProc = spawn('chromium', [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1000,1200',
    'file://' + htmlPath
  ], { stdio: 'ignore' });

  // Connect CDP
  const waitCdp = async () => {
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
        const list = await res.json();
        const page = list.find(p => p.type === 'page' && p.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('CDP timeout');
  };

  try {
    const wsUrl = await waitCdp();
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    let msgId = 1;
    const pending = new Map();
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
          const { resolve } = pending.get(msg.id);
          pending.delete(msg.id);
          resolve(msg.result);
        }
      } catch {}
    };

    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

    await new Promise(r => setTimeout(r, 700));

    // Evaluate screenshot of entire page
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const showcasePath = path.resolve(__dirname, 'screenshots/avatar-redesign-cute-showcase.png');
    fs.writeFileSync(showcasePath, Buffer.from(shot.data, 'base64'));
    console.log(`Saved cute avatar showcase to ${showcasePath}`);

    // Helper to capture specific canvas
    async function captureElement(selector, filename) {
      const evalRes = await send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.querySelector('${selector}');
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        })()`,
        returnByValue: true
      });
      if (evalRes && evalRes.result && evalRes.result.value) {
        const clip = evalRes.result.value;
        const elShot = await send('Page.captureScreenshot', {
          format: 'png',
          clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 }
        });
        const outPath = path.resolve(__dirname, `screenshots/${filename}`);
        fs.writeFileSync(outPath, Buffer.from(elShot.data, 'base64'));
        console.log(`Saved screenshot: ${outPath}`);
      }
    }

    await captureElement('#idleCanvas', 'avatar-redesign-cute-idle.png');
    await captureElement('#walkCanvas', 'avatar-redesign-cute-walking.png');
    await captureElement('#agentsCanvas', 'avatar-redesign-cute-agents.png');
    await captureElement('#cosmeticsCanvas', 'avatar-redesign-cute-cosmetics.png');

    ws.close();
  } finally {
    try { chromeProc.kill(); } catch {}
    try { fs.unlinkSync(htmlPath); } catch {}
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
