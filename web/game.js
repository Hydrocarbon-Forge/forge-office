// web/game.js — Main game loop, player physics, interaction system, particles, camera, and UI modals
(function (global) {
  class Game {
    constructor() {
      this.canvas = document.getElementById('officeCanvas');
      this.renderer = new Renderer(this.canvas);
      this.map = new OfficeMap();
      this.officeData = null;
      this.agents = null;
      this.net = null;

      // Local player
      this.player = {
        name: 'Agent',
        cosmetics: {
          color: 'coral',
          hat: 'cap',
          trail: 'sparkle',
          face: 'classic'
        },
        x: 21 * 32 + 16,
        y: 17 * 32 + 16,
        vx: 0,
        vy: 0,
        facing: 1,
        isMoving: false,
        isSprinting: false,
        walkTimer: 0,
        footFrame: 0
      };

      // Camera
      this.camera = {
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight,
        zoom: 1.0
      };

      // Particles
      this.particles = [];

      // Input
      this.keys = {};
      this.touchJoystick = { active: false, startX: 0, startY: 0, curX: 0, curY: 0, dx: 0, dy: 0 };
      this.touchSprint = false;

      // Live data cache
      this.liveData = {
        online: true,
        summary: {},
        opencode: {},
        antigravity: {},
        projects: [],
        flow: null,
        trading: null
      };

      // Interactive focus
      this.activeInspection = null; // currently inspected project
      this.nearBox = null;
      this.nearDesk = false;

      // Notifications
      this.notifications = [];

      // UI state
      this.wardrobeOpen = false;
      this.gameStarted = false;

      // Lights setting (persisted in localStorage): true = full bright / darkness off
      this.lightsOffSetting = false;
      try {
        const saved = localStorage.getItem('forge_office_lights_off');
        if (saved !== null) {
          this.lightsOffSetting = saved === 'true';
        }
      } catch {}
    }

    async init() {
      // 1. Fetch office data
      try {
        const resp = await fetch('/data/office.json');
        this.officeData = await resp.json();
      } catch (err) {
        console.warn('Failed to load office.json, using defaults:', err);
      }

      // 2. Initialize Agents Manager
      this.agents = new AgentManager(this.officeData);

      // 3. Setup window resizing
      this.handleResize();
      window.addEventListener('resize', () => this.handleResize());

      // 4. Setup Input Listeners
      this.setupInput();

      // 5. Setup Live Data Poller
      this.setupDataPoller();

      // 6. Connect Network Bridge
      this.net = new NetworkBridge(this);

      // 7. Setup Start Screen & UI
      this.setupStartScreen();
      this.setupWardrobeUI();
      this.setupMobileControls();

      // 8. Start Game Loop
      this.lastTime = performance.now();
      requestAnimationFrame((t) => this.loop(t));
    }

    handleResize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.camera.width = w;
      this.camera.height = h;
      this.renderer.resize(w, h);
    }

    setupInput() {
      window.addEventListener('keydown', (e) => {
        this.keys[e.key.toLowerCase()] = true;
        this.keys[e.code] = true;

        if (e.key === 'c' || e.key === 'C') {
          if (this.gameStarted && !this.activeInspection) {
            this.toggleWardrobe();
          }
        } else if (e.key === 'm' || e.key === 'M') {
          const muted = sfx.toggleMute();
          this.showNotification(muted ? 'Sound Muted (M)' : 'Sound Unmuted (M)');
          this.updateMuteButton(muted);
        } else if (e.key === 'n' || e.key === 'N') {
          this.toggleLightsSetting();
        } else if (e.key === 'e' || e.key === 'E') {
          this.handleInteraction();
        } else if (e.key === 'Escape') {
          if (this.activeInspection) this.closeInspection();
          if (this.wardrobeOpen) this.toggleWardrobe(false);
        }
      });

      window.addEventListener('keyup', (e) => {
        this.keys[e.key.toLowerCase()] = false;
        this.keys[e.code] = false;
      });

      // Mouse click on interact prompt
      this.canvas.addEventListener('click', (e) => {
        if (this.nearBox && !this.activeInspection) {
          this.inspectProject(this.nearBox.project);
        } else if (this.nearDesk && this.agents && !this.activeInspection) {
          this.agents.interactWithC6(sfx);
        }
      });
    }

    setupDataPoller() {
      const pollStats = async () => {
        try {
          const [sumRes, healthRes, ocRes, agRes, flowRes] = await Promise.all([
            fetch('/api/summary').then((r) => r.json()).catch(() => null),
            fetch('/api/health').then((r) => r.json()).catch(() => null),
            fetch('/api/opencode').then((r) => r.json()).catch(() => null),
            fetch('/api/antigravity').then((r) => r.json()).catch(() => null),
            fetch('/api/flow').then((r) => r.json()).catch(() => null)
          ]);

          if (healthRes) {
            this.liveData.online = healthRes.ok !== false;
          }
          if (sumRes && sumRes.sessions !== undefined) {
            this.liveData.summary = sumRes;
          }
          if (ocRes) this.liveData.opencode = ocRes;
          if (agRes) this.liveData.antigravity = agRes;
          if (flowRes) this.liveData.flow = flowRes;
        } catch (err) {
          console.warn('API stats poll error:', err);
        }
      };

      const pollProjects = async () => {
        try {
          const projRes = await fetch('/api/projects').then((r) => r.json()).catch(() => null);
          if (Array.isArray(projRes)) {
            const prevCount = this.liveData.projects.length;
            this.liveData.projects = projRes;
            const expanded = this.map.populateProjects(projRes);

            if (prevCount > 0 && projRes.length > prevCount) {
              const newest = projRes[projRes.length - 1];
              sfx.playNewBoxJingle();
              this.showNotification(`New Project Archived: ${newest.name}!`);
            }
          }
        } catch (err) {
          console.warn('API projects poll error:', err);
        }
      };

      const pollTrading = async () => {
        try {
          const resp = await fetch('/data/trading.json');
          if (resp && resp.ok) {
            this.liveData.trading = await resp.json();
          }
        } catch (err) {
          console.warn('API trading poll error:', err);
        }
      };

      // Initial fetch
      pollStats();
      pollProjects();
      pollTrading();

      // Recurring pollers: 15s for summary, 30s for projects, 60s for trading
      setInterval(pollStats, 15000);
      setInterval(pollProjects, 30000);
      setInterval(pollTrading, 60000);
    }

    handleInteraction() {
      if (this.activeInspection) {
        this.closeInspection();
        return;
      }
      if (this.nearBox) {
        this.inspectProject(this.nearBox.project);
        return;
      }
      if (this.nearDesk && this.agents) {
        this.agents.interactWithC6(sfx);
        return;
      }
    }

    inspectProject(proj) {
      this.activeInspection = proj;
      const modal = document.getElementById('projectModal');
      if (!modal) return;

      document.getElementById('projTitle').innerText = proj.name || 'Unnamed Project';
      document.getElementById('projDesc').innerText = proj.description || 'No description provided.';
      document.getElementById('projPath').innerText = proj.path || '';
      document.getElementById('projUpdated').innerText = proj.updated || 'Recent';

      const statusEl = document.getElementById('projStatus');
      if (proj.deployed) {
        statusEl.innerHTML = `<span class="badge deployed">DEPLOYED</span> ${proj.deployment_url ? `<a href="${proj.deployment_url}" target="_blank">${proj.deployment_url}</a>` : ''}`;
      } else {
        statusEl.innerHTML = `<span class="badge dev">IN DEVELOPMENT</span>`;
      }

      const tagsEl = document.getElementById('projTags');
      tagsEl.innerHTML = '';
      if (Array.isArray(proj.tags)) {
        proj.tags.forEach((tag) => {
          const span = document.createElement('span');
          span.className = 'tag-pill';
          span.innerText = tag;
          tagsEl.appendChild(span);
        });
      }

      modal.classList.remove('hidden');
      sfx.playUiTick();
    }

    closeInspection() {
      this.activeInspection = null;
      const modal = document.getElementById('projectModal');
      if (modal) modal.classList.add('hidden');
      sfx.playUiTick();
    }

    showNotification(text) {
      this.notifications.push({ text, timer: 3.5 });
    }

    // -------------------------------------------------------------------------
    // Main Game Loop
    // -------------------------------------------------------------------------
    loop(currentTime) {
      if (document.hidden) {
        this.lastTime = currentTime;
        requestAnimationFrame((t) => this.loop(t));
        return;
      }

      const dt = Math.min((currentTime - this.lastTime) / 1000, 0.1);
      this.lastTime = currentTime;

      this.update(dt);
      this.render();

      requestAnimationFrame((t) => this.loop(t));
    }

    update(dt) {
      // 1. Player Physics & Movement
      this.updatePlayer(dt);

      // 2. Camera Tracking
      const targetCamX = this.player.x - this.camera.width / 2;
      const targetCamY = this.player.y - this.camera.height / 2;
      this.camera.x += (targetCamX - this.camera.x) * 0.12;
      this.camera.y += (targetCamY - this.camera.y) * 0.12;

      // 3. Multiplayer interpolation
      if (this.net) {
        this.net.update(dt);
        const dir = this.player.isMoving ? (this.player.facing >= 0 ? 'right' : 'left') : 'idle';
        this.net.sendMove(this.player.x, this.player.y, dir, this.player.facing);
      }

      // 4. Doors update
      const allEntities = [this.player, ...this.net.getRemotePlayersList()];
      if (this.agents) {
        allEntities.push(this.agents.c6, ...Object.values(this.agents.harnessAgents));
      }
      this.map.updateDoors(allEntities, sfx);

      // 5. Agents update
      if (this.agents) {
        this.agents.update(dt, this.map, [this.player, ...this.net.getRemotePlayersList()], sfx, this.liveData);
      }

      // 6. Particles update
      this.updateParticles(dt);

      // 7. Check near Archive Box or Desk
      this.updateNearBox();
      this.updateNearDesk();

      // 8. Notifications countdown
      for (let i = this.notifications.length - 1; i >= 0; i--) {
        this.notifications[i].timer -= dt;
        if (this.notifications[i].timer <= 0) {
          this.notifications.splice(i, 1);
        }
      }
    }

    updatePlayer(dt) {
      const p = this.player;

      // Read Inputs (Keyboard + Virtual Joystick)
      let moveX = 0;
      let moveY = 0;

      if (this.keys['w'] || this.keys['arrowup']) moveY -= 1;
      if (this.keys['s'] || this.keys['arrowdown']) moveY += 1;
      if (this.keys['a'] || this.keys['arrowleft']) moveX -= 1;
      if (this.keys['d'] || this.keys['arrowright']) moveX += 1;

      if (this.touchJoystick.active) {
        moveX += this.touchJoystick.dx;
        moveY += this.touchJoystick.dy;
      }

      // Normalize diagonal
      const len = Math.hypot(moveX, moveY);
      if (len > 0.01) {
        moveX /= len;
        moveY /= len;
      }

      const isSprint = this.keys['shift'] || this.touchSprint;
      p.isSprinting = isSprint;
      const maxSpeed = isSprint ? 250 : 160; // px/sec

      // Acceleration and Friction
      const accel = isSprint ? 1800 : 1400;
      const friction = 1200;

      if (len > 0.01) {
        p.vx += moveX * accel * dt;
        p.vy += moveY * accel * dt;
        // Clamp speed
        const currentSpeed = Math.hypot(p.vx, p.vy);
        if (currentSpeed > maxSpeed) {
          p.vx = (p.vx / currentSpeed) * maxSpeed;
          p.vy = (p.vy / currentSpeed) * maxSpeed;
        }
        p.facing = moveX >= 0 ? 1 : -1;
        p.isMoving = true;
      } else {
        // Friction decay
        const currentSpeed = Math.hypot(p.vx, p.vy);
        if (currentSpeed > 0) {
          const drop = friction * dt;
          const newSpeed = Math.max(0, currentSpeed - drop);
          if (newSpeed === 0) {
            p.vx = 0;
            p.vy = 0;
            p.isMoving = false;
          } else {
            p.vx = (p.vx / currentSpeed) * newSpeed;
            p.vy = (p.vy / currentSpeed) * newSpeed;
          }
        }
      }

      // Collision vs map solid cells
      const nextX = p.x + p.vx * dt;
      const nextY = p.y + p.vy * dt;
      const radius = 10;

      if (!this.map.checkCircleCollision(nextX, p.y, radius)) {
        p.x = nextX;
      } else {
        p.vx = 0;
      }

      if (!this.map.checkCircleCollision(p.x, nextY, radius)) {
        p.y = nextY;
      } else {
        p.vy = 0;
      }

      // Footstep & Walk cycle animation
      if (p.isMoving) {
        p.walkTimer += dt * (isSprint ? 8 : 5.5);
        p.footFrame = Math.floor(p.walkTimer) % 2;
        sfx.playFootstep(isSprint);

        // Spawn movement trail
        if (p.cosmetics.trail && p.cosmetics.trail !== 'none') {
          this.spawnTrailParticle(p.x, p.y + 10, p.cosmetics.trail);
        }
      }
    }

    updateNearBox() {
      this.nearBox = null;
      let closestDist = 48; // interaction radius

      for (const box of this.map.projectBoxes) {
        const dist = Math.hypot(this.player.x - box.x, this.player.y - box.y);
        if (dist < closestDist) {
          closestDist = dist;
          this.nearBox = box;
        }
      }
    }

    updateNearDesk() {
      this.nearDesk = false;
      if (this.agents && this.agents.c6) {
        const c6 = this.agents.c6;
        const deskX = c6.deskX !== undefined ? c6.deskX : c6.x;
        const deskY = c6.deskY !== undefined ? c6.deskY : c6.y;
        const dist = Math.hypot(this.player.x - deskX, this.player.y - deskY);
        if (dist < 75) {
          this.nearDesk = true;
        }
      }
    }

    spawnTrailParticle(x, y, type) {
      if (Math.random() < 0.3) {
        this.particles.push({
          type: type,
          x: x + (Math.random() * 10 - 5),
          y: y + (Math.random() * 4 - 2),
          vx: (Math.random() - 0.5) * 15,
          vy: -20 - Math.random() * 15,
          alpha: 1.0,
          scale: 1.0,
          life: 0.6,
          maxLife: 0.6
        });
      }
    }

    spawnSparkleBurst(x, y) {
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        const spd = 40 + Math.random() * 60;
        this.particles.push({
          type: 'sparkle',
          x,
          y,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd,
          alpha: 1.0,
          scale: 1.2,
          life: 0.7,
          maxLife: 0.7
        });
      }
    }

    updateParticles(dt) {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const pt = this.particles[i];
        pt.life -= dt;
        if (pt.life <= 0) {
          this.particles.splice(i, 1);
          continue;
        }
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.alpha = pt.life / pt.maxLife;
      }
    }

    // -------------------------------------------------------------------------
    // Render Frame
    // -------------------------------------------------------------------------
    render() {
      const renderer = this.renderer;
      const ctx = renderer.ctx;
      const camera = this.camera;

      renderer.clear();

      ctx.save();
      // Apply camera view transform
      ctx.translate(-Math.floor(camera.x), -Math.floor(camera.y));

      // 1. Draw Map & Furniture
      renderer.renderMap(this.map, camera, this.liveData);

      // 2. Draw Remote Players
      if (this.net) {
        for (const remote of this.net.getRemotePlayersList()) {
          const walkFrame = Math.floor(performance.now() / 180) % 2;
          renderer.renderAvatar(ctx, remote.x, remote.y, {
            color: remote.cosmetics.color,
            hat: remote.cosmetics.hat,
            face: remote.cosmetics.face,
            facing: remote.facing,
            isMoving: remote.isMoving,
            frame: remote.isMoving ? walkFrame : 0
          });
          renderer.renderNameTag(ctx, remote.x, remote.y, remote.name, '#FFFFFF');
        }
      }

      // 3. Draw Local Player
      renderer.renderAvatar(ctx, this.player.x, this.player.y, {
        color: this.player.cosmetics.color,
        hat: this.player.cosmetics.hat,
        face: this.player.cosmetics.face,
        facing: this.player.facing,
        isMoving: this.player.isMoving,
        frame: this.player.footFrame
      });
      renderer.renderNameTag(ctx, this.player.x, this.player.y, this.player.name, '#FFD166');

      // 4. Draw Agents & C6
      if (this.agents) {
        this.agents.render(renderer, ctx);
      }

      // 5. Draw Particles
      this.renderParticles(ctx);

      // 6. Draw Interactive Prompt for Archive Box or Front Desk
      if (this.nearBox && !this.activeInspection) {
        this.renderInteractPrompt(ctx, this.nearBox);
      } else if (this.nearDesk && !this.activeInspection && this.agents && this.agents.c6) {
        this.renderDeskPrompt(ctx, this.agents.c6);
      }

      ctx.restore();

      // 7. Lighting Overlay (Baked offscreen multiply canvas)
      const lightOverlay = this.map.renderLightOverlay(
        camera.x,
        camera.y,
        camera.width,
        camera.height,
        [this.player, ...this.net.getRemotePlayersList()],
        this.liveData.online,
        this.lightsOffSetting
      );
      if (lightOverlay) {
        ctx.drawImage(lightOverlay, 0, 0);
      }

      // 8. Draw Screen Notifications
      this.renderNotifications(ctx);
    }

    renderParticles(ctx) {
      for (const pt of this.particles) {
        ctx.save();
        ctx.globalAlpha = pt.alpha;

        if (pt.type === 'sparkle') {
          ctx.fillStyle = '#FFD700';
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2.5 * pt.scale, 0, Math.PI * 2);
          ctx.fill();
        } else if (pt.type === 'star') {
          ctx.fillStyle = '#FF94AB';
          ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
        } else if (pt.type === 'bubble') {
          ctx.strokeStyle = 'rgba(100, 200, 255, 0.7)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.restore();
      }
    }

    renderInteractPrompt(ctx, box) {
      const x = box.x;
      const y = box.y - 24;
      const text = `[E] Inspect ${box.project.name || 'Project'}`;

      ctx.save();
      ctx.font = 'bold 10px "Segoe UI Rounded", "Nunito", sans-serif';
      const tw = ctx.measureText(text).width + 12;

      ctx.fillStyle = '#22252A';
      this.renderer.drawRoundedRect(ctx, x - tw / 2, y - 10, tw, 18, 5, true, false);

      ctx.fillStyle = '#FFD166';
      ctx.textAlign = 'center';
      ctx.fillText(text, x, y + 3);
      ctx.restore();
    }

    renderDeskPrompt(ctx, c6) {
      const x = c6.deskX !== undefined ? c6.deskX : c6.x;
      const y = (c6.deskY !== undefined ? c6.deskY : c6.y) - 26;
      const text = '[E] Talk to C6';

      ctx.save();
      ctx.font = 'bold 10px "Segoe UI Rounded", "Nunito", sans-serif';
      const tw = ctx.measureText(text).width + 12;

      ctx.fillStyle = '#22252A';
      this.renderer.drawRoundedRect(ctx, x - tw / 2, y - 10, tw, 18, 5, true, false);

      ctx.fillStyle = '#FFD166';
      ctx.textAlign = 'center';
      ctx.fillText(text, x, y + 3);
      ctx.restore();
    }

    renderNotifications(ctx) {
      if (this.notifications.length === 0) return;
      ctx.save();
      ctx.font = 'bold 13px "Segoe UI Rounded", "Nunito", sans-serif';
      let yOffset = 70;

      for (const notif of this.notifications) {
        const text = notif.text;
        const tw = ctx.measureText(text).width + 24;
        const x = (this.camera.width - tw) / 2;

        ctx.fillStyle = 'rgba(23, 25, 35, 0.88)';
        ctx.strokeStyle = '#38B2AC';
        ctx.lineWidth = 2;
        this.renderer.drawRoundedRect(ctx, x, yOffset, tw, 28, 6, true, true);

        ctx.fillStyle = '#E6FFFA';
        ctx.textAlign = 'center';
        ctx.fillText(text, x + tw / 2, yOffset + 18);

        yOffset += 36;
      }
      ctx.restore();
    }

    // -------------------------------------------------------------------------
    // UI: Start Screen & Join Setup
    // -------------------------------------------------------------------------
    setupStartScreen() {
      const enterBtn = document.getElementById('enterOfficeBtn');
      const nameInput = document.getElementById('playerNameInput');
      const startScreen = document.getElementById('startScreen');
      const previewCanvas = document.getElementById('startAvatarPreview');

      const renderPreview = () => {
        if (!previewCanvas) return;
        const pctx = previewCanvas.getContext('2d');
        pctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        this.renderer.renderAvatar(pctx, 40, 50, {
          color: this.player.cosmetics.color,
          hat: this.player.cosmetics.hat,
          face: this.player.cosmetics.face,
          facing: 1,
          scale: 1.4
        });
      };

      // Populate Start Screen Pickers
      this.populateCosmeticPickers('startPickers', renderPreview);
      renderPreview();

      enterBtn.addEventListener('click', () => {
        const nameVal = nameInput.value.trim().substring(0, 16);
        if (nameVal) this.player.name = nameVal;
        sfx.init();
        startScreen.classList.add('hidden');
        this.gameStarted = true;
        sfx.playChime();
        this.showNotification(`Welcome to Forge Office, ${this.player.name}!`);

        if (this.net && this.net.connected) {
          this.net.sendName(this.player.name);
          this.net.sendEquip(this.player.cosmetics);
        }
      });

      const startLightsCheckbox = document.getElementById('startLightsCheckbox');
      if (startLightsCheckbox) {
        startLightsCheckbox.checked = this.lightsOffSetting;
        startLightsCheckbox.addEventListener('change', () => {
          this.toggleLightsSetting(startLightsCheckbox.checked);
        });
      }

      const lightsBtn = document.getElementById('lightsBtn');
      if (lightsBtn) {
        lightsBtn.addEventListener('click', () => {
          this.toggleLightsSetting();
        });
      }
      this.updateLightsUI();
    }

    toggleLightsSetting(force) {
      this.lightsOffSetting = force !== undefined ? force : !this.lightsOffSetting;
      try {
        localStorage.setItem('forge_office_lights_off', String(this.lightsOffSetting));
      } catch {}
      this.showNotification(this.lightsOffSetting ? 'Lights: Full Brightness (Darkness Off)' : 'Lights: Natural Time-of-Day');
      this.updateLightsUI();
    }

    updateLightsUI() {
      const lightsBtn = document.getElementById('lightsBtn');
      if (lightsBtn) {
        lightsBtn.innerText = this.lightsOffSetting ? '💡 LIGHTS: ON' : '🌙 LIGHTS: AUTO';
      }
      const startLightsCheckbox = document.getElementById('startLightsCheckbox');
      if (startLightsCheckbox) {
        startLightsCheckbox.checked = this.lightsOffSetting;
      }
    }

    populateCosmeticPickers(containerId, onChangeCallback) {
      const container = document.getElementById(containerId);
      if (!container || !this.officeData) return;

      container.innerHTML = '';

      // Colors
      const colorRow = document.createElement('div');
      colorRow.className = 'picker-row';
      colorRow.innerHTML = '<label>Color:</label>';
      const colorList = document.createElement('div');
      colorList.className = 'picker-options';

      this.officeData.cosmetics.colors.forEach((c) => {
        const btn = document.createElement('button');
        btn.className = `swatch ${this.player.cosmetics.color === c.id ? 'active' : ''}`;
        btn.style.backgroundColor = c.hex;
        btn.title = c.name;
        btn.addEventListener('click', () => {
          this.player.cosmetics.color = c.id;
          colorList.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
          btn.classList.add('active');
          if (onChangeCallback) onChangeCallback();
        });
        colorList.appendChild(btn);
      });
      colorRow.appendChild(colorList);
      container.appendChild(colorRow);

      // Hats
      const hatRow = document.createElement('div');
      hatRow.className = 'picker-row';
      hatRow.innerHTML = '<label>Hat:</label>';
      const hatList = document.createElement('div');
      hatList.className = 'picker-options text-options';

      this.officeData.cosmetics.hats.forEach((h) => {
        const btn = document.createElement('button');
        btn.className = `opt-btn ${this.player.cosmetics.hat === h.id ? 'active' : ''}`;
        btn.innerText = h.name;
        btn.addEventListener('click', () => {
          this.player.cosmetics.hat = h.id;
          hatList.querySelectorAll('.opt-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          if (onChangeCallback) onChangeCallback();
        });
        hatList.appendChild(btn);
      });
      hatRow.appendChild(hatList);
      container.appendChild(hatRow);

      // Faces
      const faceRow = document.createElement('div');
      faceRow.className = 'picker-row';
      faceRow.innerHTML = '<label>Visor Face:</label>';
      const faceList = document.createElement('div');
      faceList.className = 'picker-options text-options';

      this.officeData.cosmetics.faces.forEach((f) => {
        const btn = document.createElement('button');
        btn.className = `opt-btn ${this.player.cosmetics.face === f.id ? 'active' : ''}`;
        btn.innerText = f.name;
        btn.addEventListener('click', () => {
          this.player.cosmetics.face = f.id;
          faceList.querySelectorAll('.opt-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          if (onChangeCallback) onChangeCallback();
        });
        faceList.appendChild(btn);
      });
      faceRow.appendChild(faceList);
      container.appendChild(faceRow);

      // Trails
      const trailRow = document.createElement('div');
      trailRow.className = 'picker-row';
      trailRow.innerHTML = '<label>Trail Effect:</label>';
      const trailList = document.createElement('div');
      trailList.className = 'picker-options text-options';

      this.officeData.cosmetics.trails.forEach((tr) => {
        const btn = document.createElement('button');
        btn.className = `opt-btn ${this.player.cosmetics.trail === tr.id ? 'active' : ''}`;
        btn.innerText = tr.name;
        btn.addEventListener('click', () => {
          this.player.cosmetics.trail = tr.id;
          trailList.querySelectorAll('.opt-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          if (onChangeCallback) onChangeCallback();
        });
        trailList.appendChild(btn);
      });
      trailRow.appendChild(trailList);
      container.appendChild(trailRow);
    }

    // -------------------------------------------------------------------------
    // UI: Wardrobe Modal (C key)
    // -------------------------------------------------------------------------
    setupWardrobeUI() {
      const wardrobeModal = document.getElementById('wardrobeModal');
      const closeBtn = document.getElementById('closeWardrobeBtn');
      const wardrobeBtn = document.getElementById('wardrobeBtn');
      const previewCanvas = document.getElementById('wardrobeAvatarPreview');

      const renderPreview = () => {
        if (!previewCanvas) return;
        const pctx = previewCanvas.getContext('2d');
        pctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        this.renderer.renderAvatar(pctx, 40, 50, {
          color: this.player.cosmetics.color,
          hat: this.player.cosmetics.hat,
          face: this.player.cosmetics.face,
          facing: 1,
          scale: 1.4
        });
        sfx.playChime();
        this.spawnSparkleBurst(this.player.x, this.player.y);
        if (this.net) {
          this.net.sendEquip(this.player.cosmetics);
        }
      };

      this.populateCosmeticPickers('wardrobePickers', renderPreview);

      if (closeBtn) closeBtn.addEventListener('click', () => this.toggleWardrobe(false));
      if (wardrobeBtn) wardrobeBtn.addEventListener('click', () => this.toggleWardrobe());

      const muteBtn = document.getElementById('muteBtn');
      if (muteBtn) {
        muteBtn.addEventListener('click', () => {
          const muted = sfx.toggleMute();
          this.updateMuteButton(muted);
        });
      }
    }

    toggleWardrobe(force) {
      const modal = document.getElementById('wardrobeModal');
      if (!modal) return;
      this.wardrobeOpen = force !== undefined ? force : !this.wardrobeOpen;
      if (this.wardrobeOpen) {
        modal.classList.remove('hidden');
        sfx.playUiTick();
      } else {
        modal.classList.add('hidden');
        sfx.playUiTick();
      }
    }

    updateMuteButton(muted) {
      const muteBtn = document.getElementById('muteBtn');
      if (muteBtn) {
        muteBtn.innerText = muted ? '🔇 MUTED' : '🔊 SOUND';
      }
    }

    // -------------------------------------------------------------------------
    // Mobile Virtual Touch Joystick & Buttons
    // -------------------------------------------------------------------------
    setupMobileControls() {
      const joyZone = document.getElementById('touchJoystickZone');
      const joyKnob = document.getElementById('touchJoystickKnob');
      const sprintBtn = document.getElementById('touchSprintBtn');
      const actionBtn = document.getElementById('touchActionBtn');

      if (!joyZone || !joyKnob) return;

      const onTouchStart = (e) => {
        const touch = e.touches[0];
        const rect = joyZone.getBoundingClientRect();
        this.touchJoystick.active = true;
        this.touchJoystick.startX = rect.left + rect.width / 2;
        this.touchJoystick.startY = rect.top + rect.height / 2;
        onTouchMove(e);
      };

      const onTouchMove = (e) => {
        if (!this.touchJoystick.active) return;
        const touch = e.touches[0];
        const dx = touch.clientX - this.touchJoystick.startX;
        const dy = touch.clientY - this.touchJoystick.startY;
        const dist = Math.hypot(dx, dy);
        const maxRadius = 35;

        if (dist > 0) {
          const clampedDist = Math.min(dist, maxRadius);
          this.touchJoystick.dx = (dx / dist) * (clampedDist / maxRadius);
          this.touchJoystick.dy = (dy / dist) * (clampedDist / maxRadius);

          joyKnob.style.transform = `translate(${this.touchJoystick.dx * maxRadius}px, ${this.touchJoystick.dy * maxRadius}px)`;
        }
      };

      const onTouchEnd = () => {
        this.touchJoystick.active = false;
        this.touchJoystick.dx = 0;
        this.touchJoystick.dy = 0;
        joyKnob.style.transform = `translate(0px, 0px)`;
      };

      joyZone.addEventListener('touchstart', onTouchStart, { passive: true });
      joyZone.addEventListener('touchmove', onTouchMove, { passive: true });
      joyZone.addEventListener('touchend', onTouchEnd, { passive: true });
      joyZone.addEventListener('touchcancel', onTouchEnd, { passive: true });

      if (sprintBtn) {
        sprintBtn.addEventListener('touchstart', () => { this.touchSprint = true; }, { passive: true });
        sprintBtn.addEventListener('touchend', () => { this.touchSprint = false; }, { passive: true });
      }

      if (actionBtn) {
        actionBtn.addEventListener('touchstart', () => { this.handleInteraction(); }, { passive: true });
      }
    }
  }

  global.Game = Game;
})(typeof window !== 'undefined' ? window : global);
