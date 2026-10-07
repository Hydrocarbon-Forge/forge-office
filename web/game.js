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

      // Saved profile & initial cosmetics
      let savedProfile = 'nathan';
      try {
        const sp = localStorage.getItem('forge_office_profile');
        if (sp && (sp === 'nathan' || sp === 'gavin' || sp === 'guest')) savedProfile = sp;
      } catch {}

      const defaultCosmetics = {
        nathan: { color: 'teal', hat: 'cap', trail: 'sparkle', face: 'big-eyes' },
        gavin: { color: 'tangerine', hat: 'beanie', trail: 'sparkle', face: 'round-glasses' },
        guest: { color: 'coral', hat: 'cap', trail: 'sparkle', face: 'blush' }
      };

      let initialCosmetics = Object.assign({}, defaultCosmetics[savedProfile] || defaultCosmetics.nathan);
      try {
        const savedCustom = localStorage.getItem('forge_office_cosmetics_' + savedProfile);
        if (savedCustom) Object.assign(initialCosmetics, JSON.parse(savedCustom));
      } catch {}

      let initialName = savedProfile === 'nathan' ? 'Nathan' : (savedProfile === 'gavin' ? 'Gavin' : 'Guest');
      try {
        if (savedProfile === 'guest') {
          const gn = localStorage.getItem('forge_office_guest_name');
          if (gn) initialName = gn;
        }
      } catch {}

      // Local player
      this.player = {
        name: initialName,
        profile: savedProfile,
        cosmetics: initialCosmetics,
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

      this.playerPath = null;
      this.clockModalOpen = false;
      this.minimapOpen = true;
      this.sessionStartTime = Date.now();

      // Camera with smooth zoom (0.6x to 1.8x, default 1.25x)
      this.camera = {
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight,
        zoom: 1.25,
        targetZoom: 1.25
      };
      this.zoomAnchorX = window.innerWidth / 2;
      this.zoomAnchorY = window.innerHeight / 2;

      // Voice chat manager
      this.voice = typeof VoiceChatManager !== 'undefined' ? new VoiceChatManager() : null;

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
        claudecode: {},
        antigravity: {},
        allTokens: null,
        projects: [],
        flow: null,
        trading: null,
        presence: null
      };

      // Interactive focus
      this.activeInspection = null; // currently inspected project
      this.nearBox = null;
      this.nearDesk = false;

      // Round 6: Interactive target flags
      this.nearMeetingDoor = false;
      this.nearWhiteboard = false;
      this.nearTypingBoard = false;
      this.nearProjectorDock = false;
      this.nearVendingMachine = false;
      this.nearFridge = false;
      this.nearCoffeeMaker = false;
      this.nearDrinkStation = false;

      // Round 6: Carry and interaction states
      this.player.heldItem = null;
      this.player.heldDrink = null;
      this.player.isSipping = false;
      this.player.sipTimer = 0;
      this.isCoffeeBrewing = false;
      this.coffeeBrewTimer = 0;
      this.isProjectorDocked = false;
      this.screenStream = null;
      this.screenVideo = null;
      this.isScreenShareActive = false;

      // Round 6: Modals open state
      this.settingsModalOpen = false;
      this.whiteboardModalOpen = false;
      this.typingBoardModalOpen = false;
      this.vendingModalOpen = false;
      this.fridgeModalOpen = false;
      this.drinkStationModalOpen = false;
      this.projectorModalOpen = false;

      // Round 6: Live board and presets caches
      this.liveData.whiteboardStrokes = [];
      this.liveData.typingBoardLines = [];
      this.liveData.projectorPresenter = null;
      this.liveData.drinkPresets = [];

      // Notifications
      this.notifications = [];

      // UI state
      this.wardrobeOpen = false;
      this.gameStarted = false;

      // Lights mode (persisted in localStorage): 'office' (default) vs 'fullbright'
      this.lightsMode = 'office';
      try {
        const saved = localStorage.getItem('forge_office_lights_mode');
        if (saved === 'fullbright' || saved === 'office') {
          this.lightsMode = saved;
        } else {
          const oldOff = localStorage.getItem('forge_office_lights_off');
          if (oldOff === 'true') this.lightsMode = 'fullbright';
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

      // 6b. Initialize Voice Chat Manager
      if (this.voice) {
        this.voice.init(
          sfx.ctx,
          this.net,
          this.map,
          () => ({ x: this.player.x, y: this.player.y }),
          (toast) => this.showNotification(toast)
        );
      }

      // 7. Setup Start Screen & UI
      this.setupStartScreen();
      this.setupWardrobeUI();
      this.setupClockModal();
      this.setupMinimap();
      this.setupMobileControls();

      // 7b. Setup Round 6 Modals & Controls
      this.setupSettingsModal();
      this.setupWhiteboardModal();
      this.setupTypingBoardModal();
      this.setupProjectorModal();
      this.setupVendingModal();
      this.setupFridgeModal();
      this.setupDrinkStationModal();
      this.setupCarryHUD();

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

    setTargetZoom(target, anchorX, anchorY) {
      const clamped = Math.max(0.6, Math.min(1.8, target));
      this.camera.targetZoom = clamped;
      if (anchorX !== undefined && anchorY !== undefined) {
        this.zoomAnchorX = anchorX;
        this.zoomAnchorY = anchorY;
      }
    }

    setupInput() {
      window.addEventListener('keydown', (e) => {
        const isInput = e.target && (
          e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          (typeof e.target.closest === 'function' && e.target.closest('input, textarea'))
        );

        if (isInput && e.key !== 'Escape') {
          return;
        }

        if (isInput && e.key === 'Escape') {
          if (typeof e.target.blur === 'function') {
            e.target.blur();
          }
        }

        this.keys[e.key.toLowerCase()] = true;
        this.keys[e.code] = true;

        if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) {
          this.playerPath = null;
        }

        if (e.key === 'c' || e.key === 'C') {
          if (this.gameStarted && !this.activeInspection) {
            this.toggleWardrobe();
          }
        } else if (e.key === 'k' || e.key === 'K') {
          if (this.gameStarted) {
            this.toggleClockModal();
          }
        } else if (e.key === 'b' || e.key === 'B') {
          if (this.gameStarted) {
            this.toggleMinimap();
          }
        } else if (e.key === 'm' || e.key === 'M') {
          const musicMuted = sfx.toggleMusic();
          this.showNotification(musicMuted ? 'Background Music: Off (M)' : 'Background Music: On (M)');
          this.updateMusicButton(musicMuted);
        } else if (e.key === 'v' || e.key === 'V') {
          if (this.gameStarted && this.voice) {
            const isMuted = this.voice.toggleMuteVoice();
            this.showNotification(isMuted ? 'Voice Mic: Muted (V)' : 'Voice Mic: Active (V)');
            this.updateVoiceUI();
          }
        } else if (e.key === '+' || e.key === '=') {
          this.setTargetZoom(this.camera.targetZoom * 1.15, this.camera.width / 2, this.camera.height / 2);
        } else if (e.key === '-' || e.key === '_') {
          this.setTargetZoom(this.camera.targetZoom * 0.87, this.camera.width / 2, this.camera.height / 2);
        } else if (e.key === 'n' || e.key === 'N') {
          this.toggleLightsSetting();
        } else if (e.key === 'q' || e.key === 'Q') {
          if (this.gameStarted) this.sipDrink();
        } else if (e.key === 'e' || e.key === 'E') {
          this.handleInteraction();
        } else if (e.key === 'Escape') {
          if (this.activeInspection) this.closeInspection();
          if (this.wardrobeOpen) this.toggleWardrobe(false);
          if (this.clockModalOpen) this.toggleClockModal(false);
          if (this.settingsModalOpen) this.toggleSettingsModal(false);
          if (this.whiteboardModalOpen) this.toggleWhiteboardModal(false);
          if (this.typingBoardModalOpen) this.toggleTypingBoardModal(false);
          if (this.vendingModalOpen) this.toggleVendingModal(false);
          if (this.fridgeModalOpen) this.toggleFridgeModal(false);
          if (this.drinkStationModalOpen) this.toggleDrinkStationModal(false);
          if (this.projectorModalOpen) this.toggleProjectorModal(false);
        }
      });

      window.addEventListener('keyup', (e) => {
        const isInput = e.target && (
          e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          (typeof e.target.closest === 'function' && e.target.closest('input, textarea'))
        );
        if (isInput) return;
        this.keys[e.key.toLowerCase()] = false;
        this.keys[e.code] = false;
      });

      // Mouse wheel zoom centered on cursor
      this.canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        this.setTargetZoom(this.camera.targetZoom * factor, e.clientX, e.clientY);
      }, { passive: false });

      // Touch pinch zoom
      let touchStartDist = 0;
      let touchStartZoom = 1.0;
      this.canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          touchStartDist = Math.hypot(dx, dy);
          touchStartZoom = this.camera.targetZoom;
        }
      }, { passive: true });

      this.canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && touchStartDist > 0) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const currentDist = Math.hypot(dx, dy);
          const ratio = currentDist / touchStartDist;
          const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          this.setTargetZoom(touchStartZoom * ratio, midX, midY);
        }
      }, { passive: true });

      // Mouse click on interact prompt
      this.canvas.addEventListener('click', (e) => {
        if (this.nearBox && !this.activeInspection) {
          this.inspectProject(this.nearBox.project);
        } else if (this.nearDesk && this.agents && !this.activeInspection) {
          this.agents.interactWithC6(sfx, this.liveData, this.sessionStartTime);
        } else if ((this.nearProjectorDock || this.isProjectorDocked) && !this.activeInspection) {
          const rect = this.canvas.getBoundingClientRect();
          const screenX = e.clientX - rect.left;
          const screenY = e.clientY - rect.top;
          const worldX = (screenX - this.canvas.width / 2) / (this.camera.zoom || 1.0) + this.camera.x;
          const worldY = (screenY - this.canvas.height / 2) / (this.camera.zoom || 1.0) + this.camera.y;
          const distToProjector = Math.hypot(worldX - (38 * 32), worldY - (17 * 32));
          if (distToProjector < 120) {
            this.toggleProjectorModal();
          }
        }
      });
    }

    setupDataPoller() {
      const pollStats = async () => {
        try {
          const [sumRes, healthRes, ocRes, ccRes, agRes, flowRes] = await Promise.all([
            fetch('/api/summary').then((r) => r.json()).catch(() => null),
            fetch('/api/health').then((r) => r.json()).catch(() => null),
            fetch('/api/opencode').then((r) => r.json()).catch(() => null),
            fetch('/api/claudecode').then((r) => r.json()).catch(() => null),
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
          if (ccRes) this.liveData.claudecode = ccRes;
          if (agRes) this.liveData.antigravity = agRes;
          if (flowRes) this.liveData.flow = flowRes;

          // Compute billable total across all sources (matches insights "ALL"):
          // - /api/summary     -> c6: billed_tokens (fallback input_tokens + output_tokens)
          // - /api/opencode    -> sum of models[].billed_tokens
          // - /api/claudecode  -> sum of models[].billed_tokens
          // - /api/antigravity -> sum of models[].billed_tokens
          const sumModelsBilled = (res) => {
            if (!res || !Array.isArray(res.models)) return 0;
            return res.models.reduce((acc, m) => {
              const b = m.billed_tokens !== undefined ? Number(m.billed_tokens) : ((Number(m.input_tokens) || 0) + (Number(m.output_tokens) || 0));
              return acc + (isNaN(b) ? 0 : b);
            }, 0);
          };

          let c6Billed = 0;
          let hasAnySource = false;
          if (sumRes) {
            if (sumRes.billed_tokens !== undefined) {
              c6Billed = Number(sumRes.billed_tokens) || 0;
              hasAnySource = true;
            } else if (sumRes.input_tokens !== undefined || sumRes.output_tokens !== undefined) {
              c6Billed = (Number(sumRes.input_tokens) || 0) + (Number(sumRes.output_tokens) || 0);
              hasAnySource = true;
            }
          }

          if (ocRes && Array.isArray(ocRes.models)) hasAnySource = true;
          if (ccRes && Array.isArray(ccRes.models)) hasAnySource = true;
          if (agRes && Array.isArray(agRes.models)) hasAnySource = true;

          if (hasAnySource) {
            const ocBilled = sumModelsBilled(ocRes);
            const ccBilled = sumModelsBilled(ccRes);
            const agBilled = sumModelsBilled(agRes);
            this.liveData.allTokens = c6Billed + ocBilled + ccBilled + agBilled;
          } else {
            this.liveData.allTokens = null;
          }
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

      const pollPresence = async () => {
        try {
          const resp = await fetch('/api/office/presence');
          if (resp && resp.ok) {
            this.liveData.presence = await resp.json();
            this.updateClockUI();
            this.updatePresenceChips();
          }
        } catch (err) {
          console.warn('API presence poll error:', err);
        }
      };

      // Initial fetch
      pollStats();
      pollProjects();
      pollTrading();
      pollPresence();

      // Recurring pollers: 10s for presence, 15s for summary, 30s for projects, 60s for trading
      setInterval(pollPresence, 10000);
      setInterval(pollStats, 15000);
      setInterval(pollProjects, 30000);
      setInterval(pollTrading, 60000);
    }

    handleInteraction() {
      if (this.activeInspection) {
        this.closeInspection();
        return;
      }
      if (this.nearMeetingDoor) {
        this.toggleMeetingDoor();
        return;
      }
      if (this.nearWhiteboard) {
        this.toggleWhiteboardModal();
        return;
      }
      if (this.nearTypingBoard) {
        this.toggleTypingBoardModal();
        return;
      }
      if (this.nearProjectorDock) {
        this.handleProjectorDock();
        return;
      }
      if (this.nearCoffeeMaker) {
        this.brewCoffee();
        return;
      }
      if (this.nearDrinkStation) {
        this.toggleDrinkStationModal();
        return;
      }
      if (this.nearFridge) {
        this.toggleFridgeModal();
        return;
      }
      if (this.nearVendingMachine) {
        this.toggleVendingModal();
        return;
      }
      if (this.nearBox) {
        this.inspectProject(this.nearBox.project);
        return;
      }
      if (this.nearDesk && this.agents) {
        this.agents.interactWithC6(sfx, this.liveData, this.sessionStartTime);
        return;
      }
    }

    inspectProject(proj) {
      this.activeInspection = proj;
      sfx.playPaperRustle();
      const modal = document.getElementById('projectModal');
      if (!modal) return;

      document.getElementById('projTitle').innerText = proj.name || 'Unnamed Project';
      document.getElementById('projDesc').innerText = proj.description || 'No description provided.';
      document.getElementById('projPath').innerText = proj.path || '';
      document.getElementById('projUpdated').innerText = proj.updated || 'Recent';

      const statusEl = document.getElementById('projStatus');
      if (proj.deployed) {
        statusEl.innerHTML = `<span class="badge deployed">● DEPLOYED</span> ${proj.deployment_url ? `<a href="${proj.deployment_url}" target="_blank" rel="noopener noreferrer">${proj.deployment_url}</a>` : ''}`;
      } else {
        statusEl.innerHTML = `<span class="badge dev">○ IN DEVELOPMENT</span>`;
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
      if (this.minimapOpen && this.gameStarted) {
        this.renderMinimap();
      }

      requestAnimationFrame((t) => this.loop(t));
    }

    update(dt) {
      // 1. Player Physics & Movement
      this.updatePlayer(dt);

      // 1b. Dynamic Project Boxes update
      this.map.updateProjectBoxes(dt);

      // 2. Camera Zoom & Tracking (Smooth Lerp + Zoom-Aware Clamping)
      const oldZoom = this.camera.zoom;
      this.camera.zoom += (this.camera.targetZoom - this.camera.zoom) * 0.15;
      if (Math.abs(this.camera.zoom - this.camera.targetZoom) < 0.001) {
        this.camera.zoom = this.camera.targetZoom;
      }

      const visibleW = this.camera.width / this.camera.zoom;
      const visibleH = this.camera.height / this.camera.zoom;
      const targetCamX = this.player.x - visibleW / 2;
      const targetCamY = this.player.y - visibleH / 2;
      this.camera.x += (targetCamX - this.camera.x) * 0.12;
      this.camera.y += (targetCamY - this.camera.y) * 0.12;

      // Viewport camera clamp at all zoom levels
      const mapW = this.map.width * 32;
      const mapH = this.map.height * 32;
      if (mapW >= visibleW) {
        this.camera.x = Math.max(0, Math.min(this.camera.x, mapW - visibleW));
      } else {
        this.camera.x = (mapW - visibleW) / 2;
      }
      if (mapH >= visibleH) {
        this.camera.y = Math.max(0, Math.min(this.camera.y, mapH - visibleH));
      } else {
        this.camera.y = (mapH - visibleH) / 2;
      }

      // 3. Multiplayer interpolation
      if (this.net) {
        this.net.update(dt);
        const dir = this.player.isMoving ? (this.player.facing >= 0 ? 'right' : 'left') : 'idle';
        this.net.sendMove(this.player.x, this.player.y, dir, this.player.facing, this.player.heldItem || this.player.heldDrink, this.player.isSipping);
      }

      // 3b. Coffee Brewing timer
      if (this.isCoffeeBrewing) {
        this.coffeeBrewTimer -= dt;
        if (Math.random() < 0.35) {
          this.spawnSteamBurst(4 * 32 + 16, 14 * 32);
        }
        if (this.coffeeBrewTimer <= 0) {
          this.isCoffeeBrewing = false;
          this.setHeldItem({
            name: 'Fresh Espresso',
            icon: '☕',
            color: '#451A03',
            drink: true,
            source: 'coffee'
          });
          sfx.playChime();
          this.showNotification('Fresh Espresso brewed! [Press Q to drink]');
        }
      }

      // 3c. Projector auto-undock on walk away
      if (this.isProjectorDocked) {
        const dockDist = Math.hypot(this.player.x - (36.5 * 32), this.player.y - (19 * 32));
        if (dockDist > 85) {
          this.undockProjector('Walked away — projector undocked');
        }
      }

      // 3d. Meeting room private voice chip check
      const inMeeting = this.map.isInsideMeetingRoom(this.player.x, this.player.y);
      const doorClosed = this.map.doors.meeting_room && this.map.doors.meeting_room.manualClose;
      const privChip = document.getElementById('meetingPrivateChip');
      if (privChip) {
        if (inMeeting && doorClosed) {
          privChip.classList.remove('hidden');
        } else {
          privChip.classList.add('hidden');
        }
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

      // 5b. Voice chat update
      if (this.voice) {
        this.voice.update(dt);
        this.updateVoiceUI();
      }

      // 6. Particles update
      this.updateParticles(dt);

      // 7. Check near Archive Box, Desk, and Round 6 interactives
      this.updateNearBox();
      this.updateNearDesk();
      this.updateNearInteractives();

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

      // Normalize diagonal or follow path
      let len = Math.hypot(moveX, moveY);
      if (len > 0.01) {
        this.playerPath = null;
        moveX /= len;
        moveY /= len;
      } else if (this.playerPath && this.playerPath.length > 0) {
        const nextWp = this.playerPath[0];
        const dx = nextWp.x - p.x;
        const dy = nextWp.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 10) {
          this.playerPath.shift();
          if (this.playerPath.length === 0) {
            p.vx = 0;
            p.vy = 0;
            p.isMoving = false;
          }
        } else {
          moveX = dx / dist;
          moveY = dy / dist;
          len = 1.0;
        }
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

      // Sipping consumption animation
      if (p.isSipping) {
        p.sipTimer -= dt;
        if (p.sipTimer <= 0) {
          p.isSipping = false;
          const finishedName = (p.heldItem && p.heldItem.name) || (p.heldDrink && p.heldDrink.name) || 'drink';
          this.setHeldItem(null);
          this.showNotification(`Finished ${finishedName}! Refreshed.`);
          sfx.playDrinkSip();
        }
      }
    }

    updateNearBox() {
      this.nearBox = null;
      let closestDist = 48; // interaction radius

      for (const box of this.map.projectBoxes) {
        if (box.fadingOut) continue;
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

    updateNearInteractives() {
      const px = this.player.x;
      const py = this.player.y;

      // 1. Meeting room door (34, 18)
      this.nearMeetingDoor = Math.hypot(px - (34 * 32 + 16), py - (18 * 32 + 16)) < 48;

      // 2. Whiteboard (around 35.5 * 32, 16.5 * 32)
      this.nearWhiteboard = Math.hypot(px - (35.5 * 32), py - (16.5 * 32)) < 52;

      // 3. Typing board (around 41.1 * 32, 16.5 * 32)
      this.nearTypingBoard = Math.hypot(px - (41.1 * 32), py - (16.5 * 32)) < 52;

      // 4. Projector dock (around 36.5 * 32, 19 * 32)
      this.nearProjectorDock = Math.hypot(px - (36.5 * 32), py - (19 * 32)) < 52;
      const projSettingsBtn = document.getElementById('projectorSettingsBtn');
      if (projSettingsBtn) {
        if (this.nearProjectorDock || this.isProjectorDocked) {
          projSettingsBtn.classList.remove('hidden');
        } else {
          projSettingsBtn.classList.add('hidden');
        }
      }
      this.liveData.localScreenVideo = this.screenVideo;

      // 5. Break room coffee maker (4 * 32 + 16, 14 * 32 + 16)
      this.nearCoffeeMaker = Math.hypot(px - (4 * 32 + 16), py - (14 * 32 + 16)) < 50;

      // 6. Drink station (6 * 32 + 16, 14 * 32 + 16)
      this.nearDrinkStation = Math.hypot(px - (6 * 32 + 16), py - (14 * 32 + 16)) < 50;

      // 7. Break room fridge (2 * 32 + 16, 14 * 32 + 16)
      this.nearFridge = Math.hypot(px - (2 * 32 + 16), py - (14 * 32 + 16)) < 50;

      // 8. Break room vending machine (8 * 32 + 16, 14 * 32 + 16)
      this.nearVendingMachine = Math.hypot(px - (8 * 32 + 16), py - (14 * 32 + 16)) < 50;
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

    spawnSteamBurst(x, y) {
      for (let i = 0; i < 4; i++) {
        this.particles.push({
          x: x + (Math.random() * 8 - 4),
          y: y - 2,
          vx: (Math.random() - 0.5) * 8,
          vy: -15 - Math.random() * 10,
          life: 1.4,
          maxLife: 1.4,
          type: 'steam',
          scale: 1.0 + Math.random() * 0.5,
          alpha: 0.7
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
      // Gentle coffee machine steam wisps
      if (Math.random() < 0.25) {
        this.particles.push({
          x: 3 * 32 + 18 + (Math.random() * 4 - 2),
          y: 14 * 32 - 4,
          vx: (Math.random() - 0.5) * 4,
          vy: -12 - Math.random() * 6,
          life: 2.0,
          maxLife: 2.0,
          type: 'steam',
          scale: 1.0 + Math.random() * 0.6,
          alpha: 0.5
        });
      }

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
      // Apply camera view transform (zoom & world translation)
      ctx.scale(this.camera.zoom, this.camera.zoom);
      ctx.translate(-Math.floor(camera.x), -Math.floor(camera.y));

      // 1. Draw Map & Furniture
      renderer.renderMap(this.map, camera, this.liveData);

      const now = performance.now();
      const walkFrame = Math.floor(now / 120) % 4;

      // 2. Draw Remote Players
      if (this.net) {
        for (const remote of this.net.getRemotePlayersList()) {
          renderer.renderAvatar(ctx, remote.x, remote.y, {
            color: remote.cosmetics.color,
            hat: remote.cosmetics.hat,
            face: remote.cosmetics.face,
            facing: remote.facing,
            isMoving: remote.isMoving,
            heldDrink: remote.heldItem || remote.heldDrink,
            heldItem: remote.heldItem || remote.heldDrink,
            sipping: remote.isSipping,
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
        heldDrink: this.player.heldItem || this.player.heldDrink,
        heldItem: this.player.heldItem || this.player.heldDrink,
        sipping: this.player.isSipping,
        frame: this.player.isMoving ? walkFrame : 0
      });
      renderer.renderNameTag(ctx, this.player.x, this.player.y, this.player.name, '#FFD166');

      // 4. Draw Agents & C6
      if (this.agents) {
        this.agents.render(renderer, ctx);
      }

      // 5. Draw Particles
      this.renderParticles(ctx);

      // 6. Draw Interactive Prompts
      if (this.nearMeetingDoor && !this.activeInspection) {
        const isClosed = this.map.doors.meeting_room && this.map.doors.meeting_room.manualClose;
        this.renderGenericPrompt(ctx, 34 * 32 + 16, 18 * 32 + 16 - 22, isClosed ? '[E] Open Meeting Door' : '[E] Close Meeting Door', 'Press E to toggle');
      } else if (this.nearWhiteboard && !this.activeInspection) {
        this.renderGenericPrompt(ctx, 35.5 * 32, 16.5 * 32 - 20, '[E] Glass Whiteboard', 'Multiplayer drawing');
      } else if (this.nearTypingBoard && !this.activeInspection) {
        this.renderGenericPrompt(ctx, 41.1 * 32, 16.5 * 32 - 20, '[E] Shared Typing Board', 'Multiplayer ledger');
      } else if (this.nearProjectorDock && !this.activeInspection) {
        const isDocked = this.isProjectorDocked;
        this.renderGenericPrompt(
          ctx,
          36.5 * 32,
          19 * 32 - 22,
          isDocked ? '[E] Undock Screen' : '[E] Dock & Share Screen',
          isDocked ? 'Click ⚙ PRESENT for options' : 'Share Chrome screen to room'
        );
      } else if (this.nearCoffeeMaker && !this.activeInspection) {
        this.renderGenericPrompt(ctx, 4 * 32 + 16, 14 * 32 - 16, this.isCoffeeBrewing ? '☕ Brewing Espresso...' : '[E] Brew Fresh Espresso', 'Fresh roast coffee');
      } else if (this.nearDrinkStation && !this.activeInspection) {
        this.renderGenericPrompt(ctx, 6 * 32 + 16, 14 * 32 - 16, '[E] Artisan Drink Station', 'Custom recipes & presets');
      } else if (this.nearFridge && !this.activeInspection) {
        this.renderGenericPrompt(ctx, 2 * 32 + 16, 14 * 32 - 16, '[E] Break Room Fridge', 'Two-way container');
      } else if (this.nearVendingMachine && !this.activeInspection) {
        this.renderGenericPrompt(ctx, 8 * 32 + 16, 14 * 32 - 16, '[E] Vending Machine', 'Chilled canned drinks');
      } else if (this.nearBox && !this.activeInspection) {
        this.renderInteractPrompt(ctx, this.nearBox);
      } else if (this.nearDesk && !this.activeInspection && this.agents && this.agents.c6) {
        this.renderDeskPrompt(ctx, this.agents.c6);
      }

      // 7. Lighting Overlay (Baked lightmap canvas inside world transform)
      if (this.lightsMode === 'office' && this.map.officeLightCanvas) {
        ctx.drawImage(this.map.officeLightCanvas, 0, 0);
      }

      ctx.restore();

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
        } else if (pt.type === 'steam') {
          ctx.fillStyle = `rgba(240, 245, 255, ${(pt.alpha * 0.4).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 3 * pt.scale * (1.3 - pt.alpha * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }
    }

    renderInteractPrompt(ctx, box) {
      const x = box.x;
      const y = box.y - 28;
      const title = `[E] ${box.project.name || 'Project'}`;
      const desc = box.project.description ? (box.project.description.length > 40 ? box.project.description.substring(0, 40) + '...' : box.project.description) : null;

      ctx.save();
      ctx.font = 'bold 10px "Segoe UI Rounded", "Nunito", sans-serif';
      const tw = Math.max(ctx.measureText(title).width, desc ? ctx.measureText(desc).width : 0) + 16;
      const h = desc ? 30 : 18;

      ctx.fillStyle = '#22252A';
      this.renderer.drawRoundedRect(ctx, x - tw / 2, y - 10, tw, h, 5, true, false);

      ctx.fillStyle = '#FFD166';
      ctx.textAlign = 'center';
      ctx.fillText(title, x, y + 2);

      if (desc) {
        ctx.fillStyle = '#A0AEC0';
        ctx.font = '8px "Segoe UI Rounded", sans-serif';
        ctx.fillText(desc, x, y + 14);
      }
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

    renderGenericPrompt(ctx, x, y, title, desc) {
      ctx.save();
      ctx.font = 'bold 10px "Segoe UI Rounded", "Nunito", sans-serif';
      const tw = Math.max(ctx.measureText(title).width, desc ? ctx.measureText(desc).width : 0) + 16;
      const h = desc ? 30 : 18;

      ctx.fillStyle = '#22252A';
      this.renderer.drawRoundedRect(ctx, x - tw / 2, y - 10, tw, h, 5, true, false);

      ctx.fillStyle = '#FFD166';
      ctx.textAlign = 'center';
      ctx.fillText(title, x, y + 2);

      if (desc) {
        ctx.fillStyle = '#A0AEC0';
        ctx.font = '8px "Segoe UI Rounded", sans-serif';
        ctx.fillText(desc, x, y + 14);
      }
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

      const cardNathan = document.getElementById('cardNathan');
      const cardGavin = document.getElementById('cardGavin');
      const cardGuest = document.getElementById('cardGuest');
      const guestNameGroup = document.getElementById('guestNameInputGroup');

      const nathanPreview = document.getElementById('nathanAvatarPreview');
      const gavinPreview = document.getElementById('gavinAvatarPreview');
      const guestPreview = document.getElementById('guestAvatarPreview');

      const defaultCosmetics = {
        nathan: { color: 'teal', hat: 'cap', trail: 'sparkle', face: 'big-eyes' },
        gavin: { color: 'tangerine', hat: 'beanie', trail: 'sparkle', face: 'round-glasses' },
        guest: { color: 'coral', hat: 'cap', trail: 'sparkle', face: 'blush' }
      };

      // Draw card previews
      const drawCardPreview = (canvas, color, hat, face) => {
        if (!canvas) return;
        const pctx = canvas.getContext('2d');
        pctx.clearRect(0, 0, canvas.width, canvas.height);
        this.renderer.renderAvatar(pctx, canvas.width / 2, canvas.height / 2 + 8, {
          color,
          hat,
          face,
          facing: 1,
          scale: 1.15
        });
      };

      drawCardPreview(nathanPreview, 'teal', 'cap', 'big-eyes');
      drawCardPreview(gavinPreview, 'tangerine', 'beanie', 'round-glasses');
      drawCardPreview(guestPreview, 'coral', 'cap', 'blush');

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

      const selectProfile = (profKey) => {
        this.player.profile = profKey;
        const cards = [cardNathan, cardGavin, cardGuest];
        cards.forEach((c) => {
          if (!c) return;
          if (c.dataset.profile === profKey) {
            c.classList.add('selected');
          } else {
            c.classList.remove('selected');
          }
        });

        if (profKey === 'guest') {
          if (guestNameGroup) guestNameGroup.classList.remove('hidden');
          let gName = 'Guest';
          try {
            const savedG = localStorage.getItem('forge_office_guest_name');
            if (savedG) gName = savedG;
          } catch {}
          if (nameInput) nameInput.value = gName;
          this.player.name = gName;
        } else {
          if (guestNameGroup) guestNameGroup.classList.add('hidden');
          this.player.name = profKey === 'nathan' ? 'Nathan' : 'Gavin';
        }

        let targetCosmetics = Object.assign({}, defaultCosmetics[profKey] || defaultCosmetics.nathan);
        try {
          const savedCustom = localStorage.getItem('forge_office_cosmetics_' + profKey);
          if (savedCustom) Object.assign(targetCosmetics, JSON.parse(savedCustom));
        } catch {}
        this.player.cosmetics = targetCosmetics;

        this.populateCosmeticPickers('startPickers', renderPreview);
        renderPreview();
      };

      if (cardNathan) cardNathan.addEventListener('click', () => selectProfile('nathan'));
      if (cardGavin) cardGavin.addEventListener('click', () => selectProfile('gavin'));
      if (cardGuest) cardGuest.addEventListener('click', () => selectProfile('guest'));

      // Initial profile selection
      selectProfile(this.player.profile || 'nathan');

      enterBtn.addEventListener('click', () => {
        if (this.player.profile === 'guest') {
          const nameVal = nameInput ? nameInput.value.trim().substring(0, 16) : '';
          this.player.name = nameVal || 'Guest';
          try {
            localStorage.setItem('forge_office_guest_name', this.player.name);
          } catch {}
        }

        try {
          localStorage.setItem('forge_office_profile', this.player.profile);
          localStorage.setItem('forge_office_cosmetics_' + this.player.profile, JSON.stringify(this.player.cosmetics));
        } catch {}

        // Persist profile to server
        fetch('/api/office/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profile: this.player.profile,
            name: this.player.name,
            cosmetics: this.player.cosmetics
          })
        }).catch(() => {});

        sfx.init();
        startScreen.classList.add('hidden');
        this.gameStarted = true;
        sfx.playChime();
        this.showNotification(`Welcome to Forge Office, ${this.player.name}!`);

        const startMicCheckbox = document.getElementById('startMicCheckbox');
        if (startMicCheckbox && startMicCheckbox.checked && this.voice) {
          this.voice.enableMic();
        }

        if (this.net) {
          if (this.net.connected) {
            this.net.sendJoin();
          } else {
            this.net.connect();
          }
        }
      });

      const startLightsCheckbox = document.getElementById('startLightsCheckbox');
      if (startLightsCheckbox) {
        startLightsCheckbox.checked = this.lightsMode === 'fullbright';
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

      const micBtn = document.getElementById('micBtn');
      if (micBtn) {
        micBtn.addEventListener('click', async () => {
          if (!this.voice) return;
          if (!this.voice.isMicEnabled) {
            const ok = await this.voice.enableMic();
            if (ok) this.showNotification('Voice: Mic Enabled (V to mute)');
          } else {
            const isMuted = this.voice.toggleMuteVoice();
            this.showNotification(isMuted ? 'Voice: Mic Muted (V)' : 'Voice: Mic Active (V)');
          }
          this.updateVoiceUI();
        });
      }

      const monitorBtn = document.getElementById('monitorBtn');
      if (monitorBtn) {
        monitorBtn.addEventListener('click', () => {
          if (!this.voice) return;
          const enabled = this.voice.toggleSelfMonitor();
          this.showNotification(enabled ? 'Self-Monitor: ON (Hear Yourself)' : 'Self-Monitor: OFF');
          this.updateVoiceUI();
        });
      }

      this.updateLightsUI();
      this.updateVoiceUI();
    }

    toggleLightsSetting(force) {
      if (force !== undefined) {
        this.lightsMode = force ? 'fullbright' : 'office';
      } else {
        this.lightsMode = this.lightsMode === 'office' ? 'fullbright' : 'office';
      }
      try {
        localStorage.setItem('forge_office_lights_mode', this.lightsMode);
      } catch {}
      this.showNotification(this.lightsMode === 'office' ? 'Lights: Office Warm (Default)' : 'Lights: Fullbright');
      this.updateLightsUI();
    }

    updateLightsUI() {
      const lightsBtn = document.getElementById('lightsBtn');
      if (lightsBtn) {
        lightsBtn.innerText = this.lightsMode === 'office' ? '💡 LIGHTS: office' : '💡 LIGHTS: fullbright';
      }
      const settingLightsToggle = document.getElementById('settingLightsToggle');
      if (settingLightsToggle) {
        const isOffice = this.lightsMode === 'office';
        settingLightsToggle.innerText = isOffice ? '💡 Office Atmosphere (Warm)' : '☀️ Full Brightness (Darkness Off)';
        if (isOffice) settingLightsToggle.classList.remove('active');
        else settingLightsToggle.classList.add('active');
      }
      const startLightsCheckbox = document.getElementById('startLightsCheckbox');
      if (startLightsCheckbox) {
        startLightsCheckbox.checked = this.lightsMode === 'fullbright';
      }
    }

    updateVoiceUI() {
      const micBtn = document.getElementById('micBtn');
      if (micBtn && this.voice) {
        if (!this.voice.isMicEnabled) {
          micBtn.innerText = '🎤 MIC: OFF (V)';
          micBtn.classList.remove('active');
        } else if (this.voice.isVoiceMuted || this.voice.isGlobalMuted) {
          micBtn.innerText = '🎤 MIC: MUTED (V)';
          micBtn.classList.remove('active');
        } else if (this.voice.isTransmitting) {
          micBtn.innerText = '🎙️ TALKING (V)';
          micBtn.classList.add('active');
        } else {
          micBtn.innerText = '🎤 MIC: ON (V)';
          micBtn.classList.remove('active');
        }
      }

      const monitorBtn = document.getElementById('monitorBtn');
      if (monitorBtn && this.voice) {
        if (this.voice.isSelfMonitorEnabled) {
          monitorBtn.innerText = '🎧 MONITOR: ON';
          monitorBtn.classList.add('active');
        } else {
          monitorBtn.innerText = '🎧 MONITOR: OFF';
          monitorBtn.classList.remove('active');
        }
      }

      const voiceIndicator = document.getElementById('voiceIndicator');
      const speakerNameEl = document.getElementById('voiceSpeakerName');
      if (voiceIndicator && speakerNameEl && this.voice) {
        if (this.voice.activeSpeakers && this.voice.activeSpeakers.length > 0) {
          voiceIndicator.classList.remove('hidden');
          const names = this.voice.activeSpeakers.map(s => s.name).join(', ');
          speakerNameEl.innerText = `Speaking: ${names}`;
        } else {
          voiceIndicator.classList.add('hidden');
        }
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
      faceRow.innerHTML = '<label>Face Expression:</label>';
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
        try {
          localStorage.setItem('forge_office_cosmetics_' + this.player.profile, JSON.stringify(this.player.cosmetics));
        } catch {}
        fetch('/api/office/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profile: this.player.profile,
            name: this.player.name,
            cosmetics: this.player.cosmetics
          })
        }).catch(() => {});
        if (this.net) {
          this.net.sendEquip(this.player.cosmetics);
        }
      };

      this.populateCosmeticPickers('wardrobePickers', renderPreview);

      if (closeBtn) closeBtn.addEventListener('click', () => this.toggleWardrobe(false));
      if (wardrobeBtn) wardrobeBtn.addEventListener('click', () => this.toggleWardrobe());

      const musicBtn = document.getElementById('musicBtn');
      if (musicBtn) {
        musicBtn.addEventListener('click', () => {
          const musicMuted = sfx.toggleMusic();
          this.updateMusicButton(musicMuted);
          this.showNotification(musicMuted ? 'Background Music: Off (M)' : 'Background Music: On (M)');
        });
      }

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

    updateMusicButton(musicMuted) {
      const musicBtn = document.getElementById('musicBtn');
      if (musicBtn) {
        musicBtn.innerText = musicMuted ? '🔇 MUSIC OFF' : '🎵 MUSIC (M)';
      }
    }

    // -------------------------------------------------------------------------
    // UI: Clock Modal (K key) & Presence Stats
    // -------------------------------------------------------------------------
    setupClockModal() {
      const closeBtn = document.getElementById('closeClockBtn');
      if (closeBtn) closeBtn.addEventListener('click', () => this.toggleClockModal(false));

      const clockBtn = document.getElementById('clockBtn');
      if (clockBtn) clockBtn.addEventListener('click', () => this.toggleClockModal());
    }

    toggleClockModal(force) {
      const modal = document.getElementById('clockModal');
      if (!modal) return;
      this.clockModalOpen = force !== undefined ? force : !this.clockModalOpen;
      if (this.clockModalOpen) {
        modal.classList.remove('hidden');
        this.updateClockUI();
        sfx.playUiTick();
      } else {
        modal.classList.add('hidden');
        sfx.playUiTick();
      }
    }

    updateClockUI() {
      const data = this.liveData.presence;
      if (!data) return;

      const onlineMap = new Map((data.online || []).map((p) => [(p.profile || '').toLowerCase(), p.since]));
      const stats = data.stats || {};
      const discord = data.discord || {};
      const now = Date.now();

      const formatOnlineTag = (profKey) => {
        const since = onlineMap.get(profKey);
        if (since) {
          const diffMin = Math.max(0, Math.floor((now - since) / 60000));
          const h = Math.floor(diffMin / 60);
          const m = diffMin % 60;
          const timeText = h > 0 ? `${h}h ${m}m` : `${m}m`;
          return `<span class="status-dot green"></span> <span class="status-text">Clocked in ${timeText}</span>`;
        }
        return `<span class="status-dot gray"></span> <span class="status-text">Away</span>`;
      };

      const formatDiscordTag = (profKey) => {
        const d = discord[profKey];
        if (!d) return 'Discord: Inactive';
        if (d.active) {
          const age = d.age_minutes !== null ? `${d.age_minutes}m ago` : 'just now';
          return `Discord: <span style="color:#ECC94B">Active (${age})</span>`;
        }
        if (d.age_minutes !== null && d.age_minutes !== undefined) {
          return `Discord: Idle (${d.age_minutes}m ago)`;
        }
        return 'Discord: Inactive';
      };

      // Nathan
      const nOfficeStatus = document.getElementById('nathanOfficeStatus');
      if (nOfficeStatus) nOfficeStatus.innerHTML = formatOnlineTag('nathan');

      const nDiscordStatus = document.getElementById('nathanDiscordStatus');
      if (nDiscordStatus) nDiscordStatus.innerHTML = formatDiscordTag('nathan');

      const nStats = stats.nathan || {};
      const nTotal = document.getElementById('nathanTotalH');
      if (nTotal) nTotal.innerText = nStats.total_h !== undefined ? nStats.total_h : '--';
      const nSess = document.getElementById('nathanSessions');
      if (nSess) nSess.innerText = nStats.sessions !== undefined ? nStats.sessions : '--';
      const nLong = document.getElementById('nathanLongestH');
      if (nLong) nLong.innerText = nStats.longest_h !== undefined ? nStats.longest_h : '--';
      const nWith = document.getElementById('nathanTogether');
      if (nWith) nWith.innerText = nStats.sessions_with !== undefined ? nStats.sessions_with : '--';

      // Gavin
      const gOfficeStatus = document.getElementById('gavinOfficeStatus');
      if (gOfficeStatus) gOfficeStatus.innerHTML = formatOnlineTag('gavin');

      const gDiscordStatus = document.getElementById('gavinDiscordStatus');
      if (gDiscordStatus) gDiscordStatus.innerHTML = formatDiscordTag('gavin');

      const gStats = stats.gavin || {};
      const gTotal = document.getElementById('gavinTotalH');
      if (gTotal) gTotal.innerText = gStats.total_h !== undefined ? gStats.total_h : '--';
      const gSess = document.getElementById('gavinSessions');
      if (gSess) gSess.innerText = gStats.sessions !== undefined ? gStats.sessions : '--';
      const gLong = document.getElementById('gavinLongestH');
      if (gLong) gLong.innerText = gStats.longest_h !== undefined ? gStats.longest_h : '--';
      const gWith = document.getElementById('gavinTogether');
      if (gWith) gWith.innerText = gStats.sessions_with !== undefined ? gStats.sessions_with : '--';
    }

    updatePresenceChips() {
      const chip = document.getElementById('presenceChip');
      if (!chip) return;

      const prof = (this.player.profile || 'guest').toLowerCase();
      const pres = this.liveData.presence;
      const discord = pres && pres.discord ? pres.discord : {};

      if (prof === 'nathan' || prof === 'gavin') {
        const d = discord[prof];
        const isDcActive = d && d.active;
        const displayName = prof === 'nathan' ? 'Nathan' : 'Gavin';
        chip.innerHTML = `<span class="status-dot green"></span> <span>${displayName} (You): In Office${isDcActive ? ' • Discord Active' : ''}</span>`;
      } else {
        const name = this.player.name || 'Guest';
        chip.innerHTML = `<span class="status-dot green"></span> <span>${name}: In Office</span>`;
      }
    }

    // -------------------------------------------------------------------------
    // UI: Minimap Panel (B key)
    // -------------------------------------------------------------------------
    setupMinimap() {
      const minimapBtn = document.getElementById('minimapBtn');
      const toggleBtn = document.getElementById('toggleMinimapBtn');
      const canvas = document.getElementById('minimapCanvas');

      if (minimapBtn) minimapBtn.addEventListener('click', () => this.toggleMinimap());
      if (toggleBtn) toggleBtn.addEventListener('click', () => this.toggleMinimap());

      if (canvas) {
        canvas.addEventListener('click', (e) => {
          const rect = canvas.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const clickY = e.clientY - rect.top;
          this.handleMinimapClick(clickX, clickY, canvas.width, canvas.height);
        });

        canvas.addEventListener('mousemove', (e) => {
          const rect = canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          this.handleMinimapHover(mx, my, canvas.width, canvas.height);
        });
      }
    }

    toggleMinimap(force) {
      const panel = document.getElementById('minimapPanel');
      if (!panel) return;
      this.minimapOpen = force !== undefined ? force : !this.minimapOpen;
      if (this.minimapOpen) {
        panel.classList.remove('collapsed');
      } else {
        panel.classList.add('collapsed');
      }
      sfx.playUiTick();
    }

    getMinimapRooms() {
      const archHeight = Math.max(16, this.map.height - 22);
      return [
        { id: 'opencode', name: 'OPENCODE', x: 1, y: 1, w: 12, h: 11, color: '#38A169', doorX: 13 * 32 + 16, doorY: 7 * 32 + 16 },
        { id: 'claude', name: 'CLAUDE', x: 13, y: 1, w: 17, h: 7, color: '#805AD5', doorX: 21 * 32 + 16, doorY: 8 * 32 + 16 },
        { id: 'antigravity', name: 'ANTIGRAV', x: 30, y: 1, w: 12, h: 11, color: '#DD6B20', doorX: 30 * 32 + 16, doorY: 7 * 32 + 16 },
        { id: 'breakroom', name: 'BREAK', x: 1, y: 12, w: 12, h: 10, color: '#D69E2E', doorX: 13 * 32 + 16, doorY: 17 * 32 + 16 },
        { id: 'storage', name: 'STORAGE', x: 30, y: 12, w: 12, h: 10, color: '#319795', doorX: 30 * 32 + 16, doorY: 17 * 32 + 16 },
        { id: 'lobby', name: 'LOBBY', x: 13, y: 8, w: 17, h: 14, color: '#00BBF9', doorX: 21 * 32 + 16, doorY: 16 * 32 + 16 },
        { id: 'c6', name: 'C6 DESK', x: 19, y: 11.5, w: 5, h: 2, color: '#3182CE', doorX: 21 * 32 + 16, doorY: 14 * 32 + 16 },
        { id: 'archives', name: 'ARCHIVES', x: 17, y: 22, w: 10, h: archHeight, color: '#8D6E63', doorX: 21 * 32 + 16, doorY: 22 * 32 + 16 }
      ];
    }

    handleMinimapClick(clickX, clickY, canvasWidth, canvasHeight) {
      const scaleX = canvasWidth / this.map.width;
      const scaleY = canvasHeight / this.map.height;
      const gridX = clickX / scaleX;
      const gridY = clickY / scaleY;

      const rooms = this.getMinimapRooms();
      const sortedRooms = [...rooms].sort((a, b) => (a.id === 'c6' ? -1 : 1));
      let targetRoom = null;
      for (const r of sortedRooms) {
        if (gridX >= r.x && gridX <= r.x + r.w && gridY >= r.y && gridY <= r.y + r.h) {
          targetRoom = r;
          break;
        }
      }

      let destX, destY, destName;
      if (targetRoom) {
        destX = targetRoom.doorX;
        destY = targetRoom.doorY;
        destName = targetRoom.name;
      } else {
        destX = Math.round(gridX * 32);
        destY = Math.round(gridY * 32);
        destName = 'Waypoint';
      }

      const path = this.map.findPath(this.player.x, this.player.y, destX, destY);
      if (path && path.length > 0) {
        this.playerPath = path;
        this.showNotification(`Pathfinding to ${destName}...`);
        sfx.playUiTick();
      } else {
        this.showNotification(`Cannot reach ${destName}`);
      }
    }

    handleMinimapHover(mx, my, canvasWidth, canvasHeight) {
      const canvas = document.getElementById('minimapCanvas');
      if (!canvas) return;
      const scaleX = canvasWidth / this.map.width;
      const scaleY = canvasHeight / this.map.height;

      // Check remote players
      if (this.net) {
        for (const rp of this.net.getRemotePlayersList()) {
          const rmx = (rp.x / 32) * scaleX;
          const rmy = (rp.y / 32) * scaleY;
          if (Math.hypot(mx - rmx, my - rmy) < 6) {
            canvas.title = `Player: ${rp.name || 'Visitor'}`;
            return;
          }
        }
      }

      // Check rooms
      const gridX = mx / scaleX;
      const gridY = my / scaleY;
      const rooms = this.getMinimapRooms();
      for (const r of rooms) {
        if (gridX >= r.x && gridX <= r.x + r.w && gridY >= r.y && gridY <= r.y + r.h) {
          canvas.title = `Room: ${r.name} (Click to Move)`;
          return;
        }
      }
      canvas.title = 'Click to Navigate';
    }

    renderMinimap() {
      const canvas = document.getElementById('minimapCanvas');
      if (!canvas) return;
      const mctx = canvas.getContext('2d');
      const cw = canvas.width;
      const ch = canvas.height;

      mctx.clearRect(0, 0, cw, ch);

      // Background
      mctx.fillStyle = '#11141C';
      mctx.fillRect(0, 0, cw, ch);

      const scaleX = cw / this.map.width;
      const scaleY = ch / this.map.height;

      const rooms = this.getMinimapRooms();

      // Draw rooms
      for (const r of rooms) {
        const rx = r.x * scaleX;
        const ry = r.y * scaleY;
        const rw = r.w * scaleX;
        const rh = r.h * scaleY;

        mctx.fillStyle = r.color;
        mctx.globalAlpha = 0.35;
        this.renderer.drawRoundedRect(mctx, rx, ry, rw, rh, 3, true, false);

        mctx.strokeStyle = r.color;
        mctx.lineWidth = 1;
        mctx.globalAlpha = 0.85;
        this.renderer.drawRoundedRect(mctx, rx, ry, rw, rh, 3, false, true);

        // Room label inside / under
        mctx.fillStyle = '#FFFFFF';
        mctx.globalAlpha = 0.9;
        mctx.font = 'bold 6.5px "Segoe UI Rounded", sans-serif';
        mctx.textAlign = 'center';
        mctx.textBaseline = 'middle';
        if (r.id !== 'c6') {
          mctx.fillText(r.name, rx + rw / 2, ry + rh / 2);
        } else {
          mctx.fillText('C6', rx + rw / 2, ry + rh / 2);
        }
      }
      mctx.globalAlpha = 1.0;

      // Viewport rectangle overlay
      const visibleW = this.camera.width / (this.camera.zoom || 1.0);
      const visibleH = this.camera.height / (this.camera.zoom || 1.0);
      const vx = (this.camera.x / 32) * scaleX;
      const vy = (this.camera.y / 32) * scaleY;
      const vw = (visibleW / 32) * scaleX;
      const vh = (visibleH / 32) * scaleY;

      mctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      mctx.lineWidth = 1.2;
      mctx.strokeRect(vx, vy, vw, vh);
      mctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      mctx.fillRect(vx, vy, vw, vh);

      // Subagents dots (tiny dots: radius 1.5)
      if (this.agents && this.agents.harnessAgents) {
        for (const ag of Object.values(this.agents.harnessAgents)) {
          if (Array.isArray(ag.subagents)) {
            for (const sub of ag.subagents) {
              const sx = (sub.x / 32) * scaleX;
              const sy = (sub.y / 32) * scaleY;
              mctx.fillStyle = sub.color || '#CBD5E0';
              mctx.beginPath();
              mctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
              mctx.fill();
            }
          }
        }
      }

      // Harness agents dots (their color, radius 2.5)
      if (this.agents && this.agents.harnessAgents) {
        for (const ag of Object.values(this.agents.harnessAgents)) {
          const ax = (ag.x / 32) * scaleX;
          const ay = (ag.y / 32) * scaleY;
          mctx.fillStyle = ag.color || '#E2E8F0';
          mctx.beginPath();
          mctx.arc(ax, ay, 2.5, 0, Math.PI * 2);
          mctx.fill();
        }
      }

      // C6 dot
      if (this.agents && this.agents.c6) {
        const c6x = (this.agents.c6.x / 32) * scaleX;
        const c6y = (this.agents.c6.y / 32) * scaleY;
        mctx.fillStyle = '#00BBF9';
        mctx.beginPath();
        mctx.arc(c6x, c6y, 2.5, 0, Math.PI * 2);
        mctx.fill();
      }

      // Other players dots (their color, radius 3)
      if (this.net) {
        for (const rp of this.net.getRemotePlayersList()) {
          const rpx = (rp.x / 32) * scaleX;
          const rpy = (rp.y / 32) * scaleY;
          mctx.fillStyle = (rp.cosmetics && rp.cosmetics.color) || '#FF5E7E';
          mctx.beginPath();
          mctx.arc(rpx, rpy, 3, 0, Math.PI * 2);
          mctx.fill();
          mctx.strokeStyle = '#FFFFFF';
          mctx.lineWidth = 0.8;
          mctx.stroke();
        }
      }

      // Local player dot (white ring, radius 3.5)
      const px = (this.player.x / 32) * scaleX;
      const py = (this.player.y / 32) * scaleY;
      mctx.fillStyle = (this.player.cosmetics && this.player.cosmetics.color) || '#00BBF9';
      mctx.beginPath();
      mctx.arc(px, py, 3.5, 0, Math.PI * 2);
      mctx.fill();
      mctx.strokeStyle = '#FFFFFF';
      mctx.lineWidth = 1.5;
      mctx.stroke();
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

    // -------------------------------------------------------------------------
    // Round 6: Meeting Room Door & Private Voice
    // -------------------------------------------------------------------------
    toggleMeetingDoor() {
      const isClosed = this.map.doors.meeting_room ? this.map.doors.meeting_room.manualClose : false;
      const next = !isClosed;
      if (this.map.doors.meeting_room) {
        this.map.doors.meeting_room.manualClose = next;
        this.map.doors.meeting_room.state = next ? 'closed' : 'open';
      }
      this.liveData.meetingDoorClosed = next;
      if (this.net) {
        this.net.sendMeetingDoor(next);
      }
      sfx.playDoorCreak();
      this.showNotification(next ? 'Meeting door CLOSED (Voice is private 🔇)' : 'Meeting door OPEN');
    }

    setMeetingDoorState(closed, fromRemote) {
      if (this.map.doors.meeting_room) {
        this.map.doors.meeting_room.manualClose = closed;
        this.map.doors.meeting_room.state = closed ? 'closed' : 'open';
      }
      this.liveData.meetingDoorClosed = closed;
      if (fromRemote) {
        sfx.playDoorCreak();
        this.showNotification(closed ? 'Colleague closed meeting room door (Private voice 🔇)' : 'Colleague opened meeting room door');
      }
    }

    // -------------------------------------------------------------------------
    // Round 6: Carry HUD & Drinking
    // -------------------------------------------------------------------------
    setupCarryHUD() {
      const drinkBtn = document.getElementById('drinkActionBtn');
      if (drinkBtn) {
        drinkBtn.addEventListener('click', () => this.sipDrink());
      }
    }

    setHeldItem(item) {
      this.player.heldItem = item;
      this.player.heldDrink = item;
      this.updateCarrySlotUI();
      if (this.net) {
        this.net.sendMove(this.player.x, this.player.y, 'idle', this.player.facing, item, this.player.isSipping, true);
      }
    }

    sipDrink() {
      const item = this.player.heldItem || this.player.heldDrink;
      if (!item || this.player.isSipping) return;
      this.player.isSipping = true;
      this.player.sipTimer = 1.0;
      sfx.playDrinkSip();
      this.showNotification(`Sipping ${item.name}...`);
      if (this.net) {
        this.net.sendMove(this.player.x, this.player.y, 'idle', this.player.facing, item, true, true);
      }
    }

    updateCarrySlotUI() {
      const pill = document.getElementById('carrySlotPill');
      const icon = document.getElementById('carryItemIcon');
      const text = document.getElementById('carryItemText');
      if (!pill) return;
      const item = this.player.heldItem || this.player.heldDrink;
      if (item) {
        pill.classList.remove('hidden');
        if (icon) icon.innerText = item.icon || '🥤';
        if (text) text.innerText = item.name || 'Drink';
      } else {
        pill.classList.add('hidden');
      }
    }

    // -------------------------------------------------------------------------
    // Round 6: Settings Modal (Consolidated Rarely-Used Toggles)
    // -------------------------------------------------------------------------
    setupSettingsModal() {
      const modal = document.getElementById('settingsModal');
      const closeBtn = document.getElementById('closeSettingsBtn');
      const settingsBtn = document.getElementById('settingsBtn');
      const lightsBtn = document.getElementById('settingLightsToggle');
      const monitorBtn = document.getElementById('settingMonitorToggle');
      const musicBtn = document.getElementById('settingMusicToggle');
      const soundBtn = document.getElementById('settingSoundToggle');

      const zoomOverview = document.getElementById('zoomOverviewBtn');
      const zoomDefault = document.getElementById('zoomDefaultBtn');
      const zoomCloseup = document.getElementById('zoomCloseupBtn');

      if (settingsBtn) settingsBtn.addEventListener('click', () => this.toggleSettingsModal());
      if (closeBtn) closeBtn.addEventListener('click', () => this.toggleSettingsModal(false));

      const updateSettingsUI = () => {
        if (lightsBtn) {
          const isOffice = this.lightsMode === 'office';
          lightsBtn.innerText = isOffice ? '💡 Office Atmosphere (Warm)' : '☀️ Full Brightness (No Fog)';
          if (isOffice) lightsBtn.classList.remove('active');
          else lightsBtn.classList.add('active');
        }
        if (monitorBtn && this.voice) {
          monitorBtn.innerText = this.voice.selfMonitor ? '🎧 Self-Monitor: ON' : '🎧 Self-Monitor: OFF';
          if (this.voice.selfMonitor) monitorBtn.classList.add('active');
          else monitorBtn.classList.remove('active');
        }
        if (musicBtn) {
          const isPlaying = !sfx.isMusicMuted;
          musicBtn.innerText = isPlaying ? '🎵 Music: Playing [M]' : '🔇 Music: Muted [M]';
          if (isPlaying) musicBtn.classList.add('active');
          else musicBtn.classList.remove('active');
        }
        if (soundBtn) {
          const isMuted = sfx.isMuted;
          soundBtn.innerText = isMuted ? '🔇 Sound FX: Muted' : '🔊 Sound FX: Enabled';
          if (!isMuted) soundBtn.classList.add('active');
          else soundBtn.classList.remove('active');
        }
      };

      if (lightsBtn) {
        lightsBtn.addEventListener('click', () => {
          this.toggleLightsSetting();
          updateSettingsUI();
        });
      }

      if (monitorBtn) {
        monitorBtn.addEventListener('click', () => {
          if (this.voice) {
            this.voice.selfMonitor = !this.voice.selfMonitor;
            this.showNotification(`Voice self-monitor: ${this.voice.selfMonitor ? 'ON' : 'OFF'}`);
            updateSettingsUI();
          }
        });
      }

      if (musicBtn) {
        musicBtn.addEventListener('click', () => {
          const muted = sfx.toggleMusic();
          this.updateMusicButton(muted);
          this.showNotification(muted ? 'Background Music: Off (M)' : 'Background Music: On (M)');
          updateSettingsUI();
        });
      }

      if (soundBtn) {
        soundBtn.addEventListener('click', () => {
          const muted = sfx.toggleMute();
          this.updateMuteButton(muted);
          this.showNotification(muted ? 'Sound FX: Muted' : 'Sound FX: Enabled');
          updateSettingsUI();
        });
      }

      const zoomBtns = [zoomOverview, zoomDefault, zoomCloseup];
      if (zoomOverview) {
        zoomOverview.addEventListener('click', () => {
          this.setTargetZoom(0.6);
          zoomBtns.forEach((b) => b && b.classList.remove('active'));
          zoomOverview.classList.add('active');
        });
      }
      if (zoomDefault) {
        zoomDefault.addEventListener('click', () => {
          this.setTargetZoom(1.0);
          zoomBtns.forEach((b) => b && b.classList.remove('active'));
          zoomDefault.classList.add('active');
        });
      }
      if (zoomCloseup) {
        zoomCloseup.addEventListener('click', () => {
          this.setTargetZoom(1.4);
          zoomBtns.forEach((b) => b && b.classList.remove('active'));
          zoomCloseup.classList.add('active');
        });
      }

      this.updateSettingsUI = updateSettingsUI;
      updateSettingsUI();
    }

    toggleSettingsModal(force) {
      const modal = document.getElementById('settingsModal');
      if (!modal) return;
      this.settingsModalOpen = force !== undefined ? force : !this.settingsModalOpen;
      if (this.settingsModalOpen) {
        modal.classList.remove('hidden');
        if (this.updateSettingsUI) this.updateSettingsUI();
        sfx.playUiTick();
      } else {
        modal.classList.add('hidden');
        sfx.playUiTick();
      }
    }

    // -------------------------------------------------------------------------
    // Round 6: Whiteboard Modal
    // -------------------------------------------------------------------------
    setupWhiteboardModal() {
      const modal = document.getElementById('whiteboardModal');
      const closeBtn = document.getElementById('closeWhiteboardBtn');
      const canvas = document.getElementById('whiteboardCanvas');
      const clearBtn = document.getElementById('wbClearBtn');
      const eraserBtn = document.getElementById('wbEraserBtn');
      const colorBtns = document.querySelectorAll('.wb-color-btn');

      if (closeBtn) closeBtn.addEventListener('click', () => this.toggleWhiteboardModal(false));

      let activeColor = '#1E293B';
      let isEraser = false;

      colorBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          colorBtns.forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
          activeColor = btn.dataset.color || '#1E293B';
          isEraser = false;
          if (eraserBtn) eraserBtn.classList.remove('active');
          sfx.playUiTick();
        });
      });

      if (eraserBtn) {
        eraserBtn.addEventListener('click', () => {
          isEraser = !isEraser;
          if (isEraser) {
            eraserBtn.classList.add('active');
            colorBtns.forEach((b) => b.classList.remove('selected'));
          } else {
            eraserBtn.classList.remove('active');
          }
          sfx.playUiTick();
        });
      }

      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          this.clearWhiteboard();
          if (this.net) this.net.sendWhiteboardClear();
        });
      }

      if (canvas) {
        let isDrawing = false;
        let currentStroke = null;

        const getCoords = (e) => {
          const rect = canvas.getBoundingClientRect();
          const clientX = e.touches ? e.touches[0].clientX : e.clientX;
          const clientY = e.touches ? e.touches[0].clientY : e.clientY;
          return {
            x: Math.round(((clientX - rect.left) / rect.width) * canvas.width),
            y: Math.round(((clientY - rect.top) / rect.height) * canvas.height)
          };
        };

        const startDraw = (e) => {
          isDrawing = true;
          const pt = getCoords(e);
          currentStroke = {
            color: isEraser ? '#FFFFFF' : activeColor,
            width: isEraser ? 16 : 3,
            points: [pt]
          };
        };

        const moveDraw = (e) => {
          if (!isDrawing || !currentStroke) return;
          const pt = getCoords(e);
          const pts = currentStroke.points;
          const last = pts[pts.length - 1];
          if (Math.hypot(pt.x - last.x, pt.y - last.y) < 3) return;
          pts.push(pt);

          // Draw segment directly on canvas
          const ctx = canvas.getContext('2d');
          ctx.strokeStyle = currentStroke.color;
          ctx.lineWidth = currentStroke.width;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(last.x, last.y);
          ctx.lineTo(pt.x, pt.y);
          ctx.stroke();
        };

        const endDraw = () => {
          if (!isDrawing) return;
          isDrawing = false;
          if (currentStroke && currentStroke.points && currentStroke.points.length >= 1) {
            if (currentStroke.points.length === 1) {
              const ctx = canvas.getContext('2d');
              this.drawWhiteboardStroke(ctx, currentStroke);
            }
            if (!this.liveData.whiteboardStrokes) this.liveData.whiteboardStrokes = [];
            this.liveData.whiteboardStrokes.push(currentStroke);
            if (this.liveData.whiteboardStrokes.length > 500) {
              this.liveData.whiteboardStrokes.shift();
            }
            if (this.net) this.net.sendWhiteboardStroke(currentStroke);
          }
          currentStroke = null;
        };

        canvas.addEventListener('mousedown', startDraw);
        canvas.addEventListener('mousemove', moveDraw);
        canvas.addEventListener('mouseup', endDraw);
        canvas.addEventListener('mouseleave', endDraw);

        canvas.addEventListener('touchstart', (e) => { e.preventDefault(); startDraw(e); }, { passive: false });
        canvas.addEventListener('touchmove', (e) => { e.preventDefault(); moveDraw(e); }, { passive: false });
        canvas.addEventListener('touchend', endDraw);
      }
    }

    drawWhiteboardStroke(ctx, stroke) {
      if (!stroke || !stroke.points || stroke.points.length === 0) return;
      const color = stroke.color || '#1E293B';
      const width = stroke.width || 3;
      if (stroke.points.length === 1) {
        const pt = stroke.points[0];
        const r = Math.max(2.5, width / 2);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
      }
    }

    toggleWhiteboardModal(force) {
      const modal = document.getElementById('whiteboardModal');
      if (!modal) return;
      this.whiteboardModalOpen = force !== undefined ? force : !this.whiteboardModalOpen;
      if (this.whiteboardModalOpen) {
        modal.classList.remove('hidden');
        this.redrawWhiteboardCanvas();
        sfx.playUiTick();
      } else {
        modal.classList.add('hidden');
        sfx.playUiTick();
      }
    }

    setWhiteboardStrokes(strokes) {
      this.liveData.whiteboardStrokes = Array.isArray(strokes) ? strokes : [];
      if (this.whiteboardModalOpen) this.redrawWhiteboardCanvas();
    }

    addWhiteboardStroke(stroke) {
      if (!this.liveData.whiteboardStrokes) this.liveData.whiteboardStrokes = [];
      this.liveData.whiteboardStrokes.push(stroke);
      if (this.liveData.whiteboardStrokes.length > 500) {
        this.liveData.whiteboardStrokes.shift();
      }
      if (this.whiteboardModalOpen) {
        const canvas = document.getElementById('whiteboardCanvas');
        if (canvas && stroke.points && stroke.points.length >= 1) {
          const ctx = canvas.getContext('2d');
          this.drawWhiteboardStroke(ctx, stroke);
        }
      }
    }

    clearWhiteboard() {
      this.liveData.whiteboardStrokes = [];
      const canvas = document.getElementById('whiteboardCanvas');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      sfx.playUiTick();
      this.showNotification('Whiteboard cleared');
    }

    redrawWhiteboardCanvas() {
      const canvas = document.getElementById('whiteboardCanvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const strokes = this.liveData.whiteboardStrokes || [];
      for (const strk of strokes) {
        if (!strk.points || strk.points.length < 1) continue;
        this.drawWhiteboardStroke(ctx, strk);
      }
    }

    // -------------------------------------------------------------------------
    // Round 6: Typing Board Modal
    // -------------------------------------------------------------------------
    setupTypingBoardModal() {
      const modal = document.getElementById('typingBoardModal');
      const closeBtn = document.getElementById('closeTypingBoardBtn');
      const input = document.getElementById('typingBoardInput');
      const sendBtn = document.getElementById('typingBoardSendBtn');
      const clearBtn = document.getElementById('typingBoardClearBtn');

      if (closeBtn) closeBtn.addEventListener('click', () => this.toggleTypingBoardModal(false));

      const sendLine = () => {
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        if (this.net) {
          this.net.sendTypingBoardInput({
            action: 'append',
            text: text,
            author: this.player.name
          });
        }
        sfx.playUiTick();
      };

      if (sendBtn) sendBtn.addEventListener('click', sendLine);
      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            sendLine();
          }
        });
      }

      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          if (this.net) {
            this.net.sendTypingBoardInput({ action: 'clear' });
          }
          sfx.playUiTick();
        });
      }
    }

    toggleTypingBoardModal(force) {
      const modal = document.getElementById('typingBoardModal');
      if (!modal) return;
      this.typingBoardModalOpen = force !== undefined ? force : !this.typingBoardModalOpen;
      if (this.typingBoardModalOpen) {
        modal.classList.remove('hidden');
        this.renderTypingBoardLines();
        const input = document.getElementById('typingBoardInput');
        if (input) setTimeout(() => input.focus(), 50);
        sfx.playUiTick();
      } else {
        modal.classList.add('hidden');
        sfx.playUiTick();
      }
    }

    setTypingBoardLines(lines) {
      this.liveData.typingBoardLines = Array.isArray(lines) ? lines : [];
      if (this.typingBoardModalOpen) {
        this.renderTypingBoardLines();
      }
    }

    renderTypingBoardLines() {
      const ledger = document.getElementById('typingBoardLedger');
      if (!ledger) return;
      ledger.innerHTML = '';
      const lines = this.liveData.typingBoardLines || [];
      if (lines.length === 0) {
        ledger.innerHTML = '<div style="color: #64748B; font-style: italic; padding: 8px;">No ledger entries yet. Type below to append...</div>';
        return;
      }
      for (const item of lines) {
        const lineDiv = document.createElement('div');
        lineDiv.className = 'typing-ledger-line';
        const d = new Date(item.time || Date.now());
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        lineDiv.innerHTML = `<span class="typing-line-time">${timeStr}</span> <span class="typing-line-author">${item.author || 'Anon'}:</span> <span class="typing-line-text">${item.text || ''}</span>`;
        ledger.appendChild(lineDiv);
      }
      ledger.scrollTop = ledger.scrollHeight;
    }

    // -------------------------------------------------------------------------
    // Round 6: Projector Screen Dock Modal
    // -------------------------------------------------------------------------
    setupProjectorModal() {
      const modal = document.getElementById('projectorModal');
      const closeBtn = document.getElementById('closeProjectorBtn');
      const undockBtn = document.getElementById('undockBtn');
      const updateTopicBtn = document.getElementById('updateTopicBtn');
      const topicInput = document.getElementById('presenterTopicInput');
      const chips = document.querySelectorAll('.topic-chip');
      const retryBtn = document.getElementById('projectorShareRetryBtn');
      const projSettingsBtn = document.getElementById('projectorSettingsBtn');

      if (closeBtn) closeBtn.addEventListener('click', () => this.toggleProjectorModal(false));

      if (projSettingsBtn) {
        projSettingsBtn.addEventListener('click', () => this.toggleProjectorModal());
      }

      if (retryBtn) {
        retryBtn.addEventListener('click', () => {
          this.startScreenShare();
        });
      }

      if (undockBtn) {
        undockBtn.addEventListener('click', () => {
          this.undockProjector('Undocked from projector');
        });
      }

      if (updateTopicBtn && topicInput) {
        updateTopicBtn.addEventListener('click', () => {
          const topic = topicInput.value.trim() || 'Architecture Review';
          if (this.net) this.net.sendProjectorAction({ action: 'topic', topic: topic, screenShareActive: this.isScreenShareActive });
          this.showNotification(`Projector presentation updated: "${topic}"`);
          this.toggleProjectorModal(false);
        });
      }

      chips.forEach((c) => {
        c.addEventListener('click', () => {
          if (topicInput) topicInput.value = c.dataset.topic || '';
          if (this.net) this.net.sendProjectorAction({ action: 'topic', topic: c.dataset.topic, screenShareActive: this.isScreenShareActive });
          this.showNotification(`Projector presentation updated: "${c.dataset.topic}"`);
          this.toggleProjectorModal(false);
        });
      });
    }

    handleProjectorDock() {
      if (this.isProjectorDocked) {
        // E key while docked -> UNDOCK directly!
        this.undockProjector('Undocked from projector');
      } else {
        // E key while not docked -> DOCK!
        this.dockProjector();
      }
    }

    async dockProjector() {
      const pres = this.liveData.projectorPresenter;
      if (pres && this.net && pres.id !== this.net.myId) {
        this.showNotification(`Projector is busy (${pres.name} is currently presenting)`);
        sfx.playUiTick();
        return;
      }
      this.isProjectorDocked = true;
      const topicInput = document.getElementById('presenterTopicInput');
      const topic = (topicInput && topicInput.value.trim()) || 'Live Architecture Review';
      if (this.net) {
        this.net.sendProjectorDock({ topic: topic, screenShareActive: false });
      }
      this.showNotification('Docked to projector! Screen shared to meeting room.');
      sfx.playChime();
      await this.startScreenShare();
    }

    async startScreenShare() {
      const videoEl = document.getElementById('projectorVideo');
      const placeholder = document.getElementById('projectorPlaceholder');
      const placeholderText = document.getElementById('projectorPlaceholderText');
      const placeholderSub = document.getElementById('projectorPlaceholderSub');
      const retryBtn = document.getElementById('projectorShareRetryBtn');

      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        console.warn('getDisplayMedia not supported in this environment');
        if (placeholderText) placeholderText.innerText = 'Screen sharing unsupported';
        if (placeholderSub) placeholderSub.innerText = 'navigator.mediaDevices.getDisplayMedia unavailable.';
        if (retryBtn) retryBtn.style.display = 'none';
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 15 }
        });

        this.screenStream = stream;
        this.isScreenShareActive = true;

        if (videoEl) {
          videoEl.srcObject = stream;
          videoEl.style.display = 'block';
          videoEl.play().catch(() => {});
          this.screenVideo = videoEl;
        }
        if (placeholder) {
          placeholder.style.display = 'none';
        }

        if (this.net) {
          const topicInput = document.getElementById('presenterTopicInput');
          const topic = (topicInput && topicInput.value.trim()) || 'Live Architecture Review';
          this.net.sendProjectorAction({ topic: topic, screenShareActive: true });
        }
        this.showNotification('Chrome screen share active!');

        const tracks = stream.getVideoTracks();
        if (tracks.length > 0) {
          tracks[0].addEventListener('ended', () => {
            this.handleScreenShareEnded('External stop — screen share ended');
          });
        }
      } catch (err) {
        console.warn('Screen share cancelled or failed:', err);
        this.isScreenShareActive = false;
        if (videoEl) {
          videoEl.style.display = 'none';
          videoEl.srcObject = null;
        }
        if (placeholder) {
          placeholder.style.display = 'block';
        }
        if (placeholderText) {
          placeholderText.innerText = 'Screen share cancelled';
        }
        if (placeholderSub) {
          placeholderSub.innerText = 'Still docked to projector. Click below to retry.';
        }
        if (retryBtn) {
          retryBtn.style.display = 'inline-block';
        }
        this.showNotification('Screen share cancelled — still docked, showing placeholder');
      }
    }

    handleScreenShareEnded(reason) {
      if (!this.isProjectorDocked) return;
      this.undockProjector(reason || 'Screen share ended');
    }

    undockProjector(reason) {
      if (this.screenStream) {
        try {
          this.screenStream.getTracks().forEach((t) => t.stop());
        } catch {}
        this.screenStream = null;
      }
      this.isScreenShareActive = false;
      this.screenVideo = null;

      const videoEl = document.getElementById('projectorVideo');
      if (videoEl) {
        videoEl.pause();
        videoEl.srcObject = null;
        videoEl.style.display = 'none';
      }
      const placeholder = document.getElementById('projectorPlaceholder');
      if (placeholder) {
        placeholder.style.display = 'block';
      }
      const placeholderText = document.getElementById('projectorPlaceholderText');
      if (placeholderText) {
        placeholderText.innerText = 'No presentation active';
      }
      const placeholderSub = document.getElementById('projectorPlaceholderSub');
      if (placeholderSub) {
        placeholderSub.innerText = 'Click Share Screen to capture your Chrome window or tab.';
      }
      const retryBtn = document.getElementById('projectorShareRetryBtn');
      if (retryBtn) {
        retryBtn.style.display = 'inline-block';
      }

      if (this.isProjectorDocked) {
        this.isProjectorDocked = false;
        if (this.net) this.net.sendProjectorUndock();
      }

      this.toggleProjectorModal(false);

      if (reason) {
        this.showNotification(reason);
      }
      sfx.playUiTick();
    }

    toggleProjectorModal(force) {
      const modal = document.getElementById('projectorModal');
      if (!modal) return;
      this.projectorModalOpen = force !== undefined ? force : !this.projectorModalOpen;
      if (this.projectorModalOpen) {
        modal.classList.remove('hidden');
        sfx.playUiTick();
      } else {
        modal.classList.add('hidden');
        sfx.playUiTick();
      }
    }

    setProjectorPresenter(presenter) {
      this.liveData.projectorPresenter = presenter;
      if (!presenter && this.isProjectorDocked) {
        this.undockProjector();
      }
      const dockStatusLabel = document.getElementById('dockStatusLabel');
      if (dockStatusLabel) {
        if (presenter) {
          dockStatusLabel.innerText = presenter.id === (this.net && this.net.myId) ?
            `You are presenting: "${presenter.action || ''}"` :
            `${presenter.name} is presenting: "${presenter.action || ''}"`;
        } else {
          dockStatusLabel.innerText = 'Projector is available to present';
        }
      }
    }

    handleProjectorBusy(msg) {
      this.undockProjector();
      this.showNotification(msg.reason || (msg.dockedBy ? `Projector is busy (${msg.dockedBy} is presenting)` : 'Projector is currently busy'));
      sfx.playUiTick();
    }

    // -------------------------------------------------------------------------
    // Round 6: Vending Machine Modal
    // -------------------------------------------------------------------------
    setupVendingModal() {
      const modal = document.getElementById('vendingModal');
      const closeBtn = document.getElementById('closeVendingBtn');
      const items = document.querySelectorAll('.vending-item');
      const statusBox = document.getElementById('vendingAnimStatus');

      if (closeBtn) closeBtn.addEventListener('click', () => this.toggleVendingModal(false));

      items.forEach((itemEl) => {
        const btn = itemEl.querySelector('.dispense-btn');
        if (btn) {
          btn.addEventListener('click', () => {
            const drinkName = itemEl.dataset.drink;
            const drinkColor = itemEl.dataset.color;
            const drinkIcon = itemEl.dataset.icon;
            if (statusBox) statusBox.classList.remove('hidden');
            sfx.playCoin();
            setTimeout(() => {
              if (statusBox) statusBox.classList.add('hidden');
              this.setHeldItem({
                name: drinkName,
                color: drinkColor,
                icon: drinkIcon,
                drink: true,
                source: 'vending'
              });
              sfx.playChime();
              this.showNotification(`Dispensed ${drinkName}! [Press Q to drink]`);
              this.toggleVendingModal(false);
            }, 650);
          });
        }
      });
    }

    toggleVendingModal(force) {
      const modal = document.getElementById('vendingModal');
      if (!modal) return;
      this.vendingModalOpen = force !== undefined ? force : !this.vendingModalOpen;
      if (this.vendingModalOpen) {
        modal.classList.remove('hidden');
        sfx.playUiTick();
      } else {
        modal.classList.add('hidden');
        sfx.playUiTick();
      }
    }

    // -------------------------------------------------------------------------
    // Round 6: Fridge Modal (Two-Way Container)
    // -------------------------------------------------------------------------
    setupFridgeModal() {
      const modal = document.getElementById('fridgeModal');
      const closeBtn = document.getElementById('closeFridgeBtn');
      const slots = document.querySelectorAll('.fridge-item-slot');
      const retBtn = document.getElementById('fridgeReturnBtn');

      if (closeBtn) closeBtn.addEventListener('click', () => this.toggleFridgeModal(false));

      slots.forEach((slot) => {
        const takeBtn = slot.querySelector('.fridge-take-btn');
        if (takeBtn) {
          takeBtn.addEventListener('click', () => {
            const name = slot.dataset.drink;
            const color = slot.dataset.color;
            const icon = slot.dataset.icon;
            this.setHeldItem({
              name,
              color,
              icon,
              drink: true,
              source: 'fridge'
            });
            sfx.playChime();
            this.showNotification(`Grabbed chilled ${name} from fridge! [Press Q to drink]`);
            this.toggleFridgeModal(false);
          });
        }
      });

      if (retBtn) {
        retBtn.addEventListener('click', () => {
          const item = this.player.heldItem || this.player.heldDrink;
          if (!item) return;
          const retName = item.name;
          this.setHeldItem(null);
          sfx.playUiTick();
          this.showNotification(`Returned ${retName} to fridge.`);
          this.toggleFridgeModal(false);
        });
      }
    }

    toggleFridgeModal(force) {
      const modal = document.getElementById('fridgeModal');
      if (!modal) return;
      this.fridgeModalOpen = force !== undefined ? force : !this.fridgeModalOpen;
      if (this.fridgeModalOpen) {
        modal.classList.remove('hidden');
        const retBox = document.getElementById('fridgeReturnSection');
        const heldName = document.getElementById('fridgeHeldItemName');
        const item = this.player.heldItem || this.player.heldDrink;
        if (retBox) {
          if (item) {
            retBox.classList.remove('hidden');
            if (heldName) heldName.innerText = item.name;
          } else {
            retBox.classList.add('hidden');
          }
        }
        sfx.playUiTick();
      } else {
        modal.classList.add('hidden');
        sfx.playUiTick();
      }
    }

    // -------------------------------------------------------------------------
    // Round 6: Coffee Maker Action
    // -------------------------------------------------------------------------
    setupCoffeeMaker() {}

    brewCoffee() {
      if (this.isCoffeeBrewing) return;
      this.isCoffeeBrewing = true;
      this.coffeeBrewTimer = 2.0;
      this.showNotification('Brewing fresh espresso... ☕');
      sfx.playCoffeeGurgle();
      this.spawnSteamBurst(4 * 32 + 16, 14 * 32);
    }

    // -------------------------------------------------------------------------
    // Round 6: Artisan Drink Station & Presets
    // -------------------------------------------------------------------------
    setupDrinkStationModal() {
      const modal = document.getElementById('drinkStationModal');
      const closeBtn = document.getElementById('closeDrinkStationBtn');
      const brewBtn = document.getElementById('stationBrewBtn');
      const saveBtn = document.getElementById('savePresetBtn');
      const nameInput = document.getElementById('presetNameInput');
      const baseBtns = document.querySelectorAll('.station-opt-btn');

      if (closeBtn) closeBtn.addEventListener('click', () => this.toggleDrinkStationModal(false));

      let selectedBase = { id: 'coffee', name: 'Coffee', color: '#78350F', icon: '☕' };

      baseBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          baseBtns.forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
          selectedBase = {
            id: btn.dataset.base,
            name: btn.innerText,
            color: btn.dataset.color || '#78350F',
            icon: btn.dataset.icon || '☕'
          };
          sfx.playUiTick();
        });
      });

      const getCheckedAddins = () => {
        const checkboxes = document.querySelectorAll('#drinkAddinOptions input[type="checkbox"]:checked');
        return Array.from(checkboxes).map((cb) => cb.value);
      };

      if (brewBtn) {
        brewBtn.addEventListener('click', () => {
          const indicator = document.getElementById('stationBrewingIndicator');
          if (indicator) indicator.classList.remove('hidden');
          brewBtn.disabled = true;
          sfx.playCoffeeGurgle();

          setTimeout(() => {
            if (indicator) indicator.classList.add('hidden');
            brewBtn.disabled = false;
            const addins = getCheckedAddins();
            const displayName = addins.length ? `${selectedBase.name} + ${addins.join(', ')}` : selectedBase.name;
            this.setHeldItem({
              name: displayName,
              color: selectedBase.color,
              icon: selectedBase.icon,
              drink: true,
              source: 'station'
            });
            sfx.playChime();
            this.showNotification(`Brewed custom ${displayName}! [Press Q to drink]`);
            this.toggleDrinkStationModal(false);
          }, 800);
        });
      }

      if (saveBtn && nameInput) {
        saveBtn.addEventListener('click', async () => {
          const name = nameInput.value.trim();
          if (!name) {
            this.showNotification('Please enter a preset name');
            return;
          }
          if (!this.liveData.drinkPresets) this.liveData.drinkPresets = [];
          if (this.liveData.drinkPresets.length >= 4) {
            this.showNotification('Max 4 presets allowed. Delete one first!');
            return;
          }

          const newPreset = {
            name: name,
            base: selectedBase.id,
            addins: getCheckedAddins()
          };

          this.liveData.drinkPresets.push(newPreset);
          nameInput.value = '';
          await this.saveDrinkPresets(this.liveData.drinkPresets);
          this.renderDrinkPresetsList();
          this.showNotification(`Saved drink preset "${name}"!`);
          sfx.playChime();
        });
      }
    }

    async loadDrinkPresets() {
      try {
        const resp = await fetch(`/api/office/drink-presets?profile=${this.player.profile || 'nathan'}`);
        const data = await resp.json();
        if (data && Array.isArray(data.presets)) {
          this.liveData.drinkPresets = data.presets;
        }
      } catch (err) {
        console.warn('Failed to load drink presets:', err);
      }
      this.renderDrinkPresetsList();
    }

    async saveDrinkPresets(presets) {
      try {
        await fetch('/api/office/drink-presets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profile: this.player.profile || 'nathan',
            presets: presets
          })
        });
      } catch (err) {
        console.warn('Failed to save drink presets:', err);
      }
    }

    renderDrinkPresetsList() {
      const container = document.getElementById('presetsListContainer');
      if (!container) return;
      container.innerHTML = '';
      const presets = this.liveData.drinkPresets || [];

      if (presets.length === 0) {
        container.innerHTML = '<div style="color: #64748B; font-size: 10px; font-style: italic; padding: 4px;">No saved presets yet</div>';
        return;
      }

      presets.forEach((pr, idx) => {
        const item = document.createElement('div');
        item.className = 'preset-item';
        const addinSummary = (pr.addins && pr.addins.length) ? ` (${pr.addins.join(',')})` : '';
        item.innerHTML = `
          <div class="preset-item-name" title="${pr.name}${addinSummary}">${pr.name}</div>
          <div class="preset-item-actions">
            <button class="preset-load-btn" data-idx="${idx}">Load & Brew</button>
            <button class="preset-del-btn" data-idx="${idx}">✕</button>
          </div>
        `;

        item.querySelector('.preset-load-btn').addEventListener('click', () => {
          // Select base
          const baseBtns = document.querySelectorAll('.station-opt-btn');
          baseBtns.forEach((b) => {
            if (b.dataset.base === pr.base) b.classList.add('selected');
            else b.classList.remove('selected');
          });
          // Set addins
          const checkboxes = document.querySelectorAll('#drinkAddinOptions input[type="checkbox"]');
          const set = new Set(pr.addins || []);
          checkboxes.forEach((cb) => { cb.checked = set.has(cb.value); });

          // Fast load & brew
          const baseBtn = document.querySelector(`.station-opt-btn[data-base="${pr.base}"]`);
          const icon = baseBtn ? baseBtn.dataset.icon : '☕';
          const color = baseBtn ? baseBtn.dataset.color : '#78350F';
          this.setHeldItem({
            name: pr.name,
            icon: icon,
            color: color,
            drink: true,
            source: 'station'
          });
          sfx.playChime();
          this.showNotification(`Brewed saved preset "${pr.name}"! [Press Q to drink]`);
          this.toggleDrinkStationModal(false);
        });

        item.querySelector('.preset-del-btn').addEventListener('click', async () => {
          presets.splice(idx, 1);
          await this.saveDrinkPresets(presets);
          this.renderDrinkPresetsList();
          sfx.playUiTick();
        });

        container.appendChild(item);
      });
    }

    toggleDrinkStationModal(force) {
      const modal = document.getElementById('drinkStationModal');
      if (!modal) return;
      this.drinkStationModalOpen = force !== undefined ? force : !this.drinkStationModalOpen;
      if (this.drinkStationModalOpen) {
        modal.classList.remove('hidden');
        this.loadDrinkPresets();
        sfx.playUiTick();
      } else {
        modal.classList.add('hidden');
        sfx.playUiTick();
      }
    }
  }

  global.Game = Game;
})(typeof window !== 'undefined' ? window : global);
