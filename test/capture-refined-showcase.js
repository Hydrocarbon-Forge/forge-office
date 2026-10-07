const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CDP_PORT = 9226;

async function capture() {
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
    letter-spacing: 0.5px;
  }
  p {
    font-size: 13px;
    color: #94A3B8;
    margin: 0 0 20px 0;
  }
  canvas {
    background: #181E26;
    border: 1px solid #2B3542;
    border-radius: 10px;
    display: block;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
  }
</style>
</head>
<body>
  <h1>Hydrocarbon Forge — De-Rabbit Avatar Redesign (Pill Robot Head + Visor)</h1>
  <p>Rounded-square robot head with inset darker visor faceplate and simple clean face (small pill eyes + gentle smile, no animal ears, no tail, no tummy patch).</p>
  <canvas id="showcase" width="960" height="420"></canvas>

  <script>
    ${renderJs}

    window.onload = function() {
      const canvas = document.getElementById('showcase');
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;

      const renderer = new window.Renderer(canvas);

      // Section A: Agent Identities
      ctx.fillStyle = '#38BDF8';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('SPECIAL AGENT IDENTITIES', 36, 32);

      const agents = [
        { label: 'C6 Receptionist', opt: { color: '#E9C46A', hat: 'headset', face: 'visor-glow', isAgentC6: true, forgeTool: true } },
        { label: 'OpenCode', opt: { color: '#00A896', hat: 'headphones', face: 'round-glasses', isAgentOpenCode: true } },
        { label: 'Claude', opt: { color: '#E07A5F', hat: 'beret', face: 'happy', isAgentClaude: true, hasScarf: true, scarfColor: '#E07A5F' } },
        { label: 'Gemini', opt: { color: '#3D5A80', hat: 'cap', face: 'sparkle', isAgentGemini: true } }
      ];

      agents.forEach((ag, idx) => {
        const x = 110 + idx * 235;
        const y = 92;
        renderer.renderAvatar(ctx, x, y, { ...ag.opt, scale: 3.3 });
        ctx.fillStyle = '#CBD5E1';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(ag.label, x, y + 66);
      });

      // Horizontal Divider
      ctx.strokeStyle = '#2B3542';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(30, 195);
      ctx.lineTo(930, 195);
      ctx.stroke();

      // Section B: Visor Face Customizations
      ctx.fillStyle = '#38BDF8';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('VISOR FACE CUSTOMIZATIONS (cosmetics.faces)', 36, 225);

      const variants = [
        { label: 'happy (Default)', opt: { color: 'teal', hat: 'cap', face: 'happy' } },
        { label: 'blush', opt: { color: 'coral', hat: 'none', face: 'blush' } },
        { label: 'sparkle', opt: { color: 'lemon', hat: 'crown', face: 'sparkle' } },
        { label: 'round-glasses', opt: { color: 'tangerine', hat: 'beanie', face: 'round-glasses' } },
        { label: 'antenna', opt: { color: 'ocean', hat: 'none', face: 'antenna' } },
        { label: 'visor-glow', opt: { color: 'cloud', hat: 'hard-hat', face: 'visor-glow' } },
        { label: 'none (Clean)', opt: { color: 'mint', hat: 'none', face: 'none' } }
      ];

      variants.forEach((v, idx) => {
        const x = 75 + idx * 135;
        const y = 290;
        renderer.renderAvatar(ctx, x, y, { ...v.opt, scale: 3.0 });
        ctx.fillStyle = '#CBD5E1';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(v.label, x, y + 64);
      });
    };
  </script>
</body>
</html>`;

  const htmlPath = path.resolve(__dirname, 'refined-showcase.html');
  fs.writeFileSync(htmlPath, htmlContent);

  const chromeProc = spawn('chromium', [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1200,900',
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

    await new Promise(r => setTimeout(r, 800));

    // Capture screenshot of showcase canvas
    const evalRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('#showcase');
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
      const refinedPath = path.resolve(__dirname, 'screenshots/avatar-refined-showcase.png');
      const redesignPath = path.resolve(__dirname, 'screenshots/avatar-redesign-showcase.png');
      const imgBuffer = Buffer.from(elShot.data, 'base64');
      fs.writeFileSync(refinedPath, imgBuffer);
      fs.writeFileSync(redesignPath, imgBuffer);
      console.log(`Saved ${refinedPath} (${imgBuffer.length} bytes)`);
      console.log(`Saved ${redesignPath} (${imgBuffer.length} bytes)`);
    }

    ws.close();
  } finally {
    try { chromeProc.kill(); } catch {}
    try { fs.unlinkSync(htmlPath); } catch {}
  }
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});
