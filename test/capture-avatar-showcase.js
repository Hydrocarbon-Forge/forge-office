const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const CDP_PORT = 9224;
const htmlPath = path.resolve(__dirname, '../.gemini/antigravity-cli/brain/82f9d6c9-4377-4d22-a624-581fbbc4b84b/scratch/render-avatars.html');

async function capture() {
  const fileUrl = 'file://' + path.resolve(__dirname, 'avatar-showcase.html');
  
  // Create avatar-showcase.html using the real web/render.js
  const renderJs = fs.readFileSync(path.resolve(__dirname, '../web/render.js'), 'utf8');
  
  const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    background: #181A1F;
    color: #F1F5F9;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 24px;
  }
  h1 {
    font-size: 18px;
    margin: 0 0 8px 0;
    color: #E2E8F0;
    letter-spacing: 0.5px;
  }
  p {
    font-size: 12px;
    color: #94A3B8;
    margin: 0 0 20px 0;
  }
  canvas {
    background: #20242B;
    border: 1px solid #333A44;
    border-radius: 8px;
    display: block;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }
</style>
</head>
<body>
  <h1>Hydrocarbon Forge — Avatar Redesign Showcase (Round 6)</h1>
  <p>Replacing Among Us capsule body with cozy forge engineer onesie + Carbon-6 hex badge + agent identities</p>
  <canvas id="showcase" width="880" height="220"></canvas>

  <script>
    ${renderJs}

    window.onload = function() {
      const canvas = document.getElementById('showcase');
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;

      const renderer = new window.Renderer(canvas);

      const items = [
        { label: 'Base (Coral)', opt: { color: 'coral', hat: 'none', face: 'plain' } },
        { label: 'C6 Receptionist', opt: { color: '#E9C46A', hat: 'headset', face: 'blush', isAgentC6: true, forgeTool: true } },
        { label: 'OpenCode', opt: { color: '#00A896', hat: 'headphones', face: 'glasses', isAgentOpenCode: true } },
        { label: 'Claude', opt: { color: '#E07A5F', hat: 'beret', face: 'plain', isAgentClaude: true, hasScarf: true, scarfColor: '#E07A5F' } },
        { label: 'Gemini', opt: { color: '#3D5A80', hat: 'cap', face: 'plain' } },
        { label: 'Beanie + Freckles', opt: { color: 'tangerine', hat: 'beanie', face: 'freckles' } },
        { label: 'Hard-Hat (Mint)', opt: { color: 'mint', hat: 'hard-hat', face: 'plain' } },
        { label: 'Coffee Break', opt: { color: 'ocean', hat: 'none', face: 'plain', heldItem: { type: 'coffee', color: '#D97706' } } }
      ];

      items.forEach((item, idx) => {
        const x = 60 + idx * 108;
        const y = 95;
        // Draw 4x close-up avatar
        renderer.renderAvatar(ctx, x, y, { ...item.opt, scale: 3.5 });

        // Label underneath
        ctx.fillStyle = '#CBD5E1';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(item.label, x, y + 70);
      });
    };
  </script>
</body>
</html>`;

  fs.writeFileSync(path.resolve(__dirname, 'avatar-showcase.html'), htmlContent);

  const chromeProc = spawn('chromium', [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=960,400',
    fileUrl
  ], { stdio: 'ignore' });

  // Connect to CDP
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

    await new Promise(r => setTimeout(r, 600));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const outPath = path.resolve(__dirname, 'screenshots/avatar-redesign-showcase.png');
    fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
    console.log(`Saved avatar showcase to ${outPath} (${shot.data.length} bytes b64)`);
    ws.close();
  } finally {
    try { chromeProc.kill(); } catch {}
    try { fs.unlinkSync(path.resolve(__dirname, 'avatar-showcase.html')); } catch {}
  }
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});
