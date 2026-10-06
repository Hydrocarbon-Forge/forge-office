// web/agents.js — C6 receptionist, Harness Agents (OpenCode, Claude, Antigravity), Subagents, and Deterministic Office Brain
(function (global) {
  function createPrng(seed) {
    let s = seed >>> 0;
    return function () {
      let t = (s += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class AgentManager {
    constructor(officeData, seed = 12345) {
      this.officeData = officeData;
      this.seed = seed;
      this.prng = createPrng(seed);

      // C6 state
      this.c6 = {
        name: 'C6',
        color: '#E9C46A',
        hat: 'headset',
        face: 'blush',
        x: 21 * 32 + 16,
        y: 11 * 32 + 16, // behind front desk
        deskX: 21 * 32 + 16,
        deskY: 12 * 32 + 16,
        isSitting: true,
        isWaving: false,
        waveTimer: 0,
        dialogueIndex: 0,
        currentBubble: null,
        bubbleTimer: 0,
        typewriterProgress: 0,
        playerInRange: false,
        lastInteractionTime: 0
      };

      // Harness Agents
      this.harnessAgents = {
        'opencode': {
          id: 'opencode',
          name: 'OpenCode',
          color: '#00A896',
          hat: 'headphones',
          face: 'classic',
          office: 'opencode',
          homeX: 6 * 32 + 16,
          homeY: 7 * 32 + 16,
          deskX: 6 * 32 + 16,
          deskY: 6 * 32,
          x: 6 * 32 + 16,
          y: 7 * 32 + 16,
          facing: 1,
          state: 'idle', // idle, working, moving, on_coffee, fetching
          stateTimer: 6,
          path: null,
          pathIndex: 0,
          speed: 1.6,
          papers: false,
          bubbleText: null,
          bubbleProgress: 0,
          subagents: []
        },
        'claude-code': {
          id: 'claude-code',
          name: 'Claude',
          color: '#E07A5F',
          hat: 'beret',
          face: 'classic',
          office: 'claude-code',
          homeX: 21 * 32 + 16,
          homeY: 4 * 32 + 16,
          deskX: 21 * 32 + 16,
          deskY: 3 * 32,
          x: 21 * 32 + 16,
          y: 4 * 32 + 16,
          facing: 1,
          state: 'idle',
          stateTimer: 8,
          path: null,
          pathIndex: 0,
          speed: 1.6,
          papers: false,
          bubbleText: null,
          bubbleProgress: 0,
          subagents: []
        },
        'antigravity': {
          id: 'antigravity',
          name: 'Antigravity',
          color: '#3D5A80',
          hat: 'antenna',
          face: 'classic',
          office: 'antigravity',
          homeX: 37 * 32 + 16,
          homeY: 7 * 32 + 16,
          deskX: 37 * 32 + 16,
          deskY: 6 * 32,
          x: 37 * 32 + 16,
          y: 7 * 32 + 16,
          facing: -1,
          state: 'working',
          stateTimer: 5,
          path: null,
          pathIndex: 0,
          speed: 1.6,
          papers: false,
          bubbleText: null,
          bubbleProgress: 0,
          subagents: []
        }
      };

      this.initSubagents();
    }

    setSeed(seed) {
      this.seed = seed;
      this.prng = createPrng(seed);
    }

    initSubagents() {
      // Subagents for each harness start empty, driven strictly by live flow data
      for (const [id, agent] of Object.entries(this.harnessAgents)) {
        agent.subagents = [];
      }
    }

    update(dt, map, players, sfx, liveData) {
      this.updateC6(dt, players, sfx);
      this.updateHarnessAgents(dt, map, players, sfx, liveData);
      this.updateSubagents(dt, liveData);
    }

    // -------------------------------------------------------------------------
    // C6 Front Desk Receptionist
    // -------------------------------------------------------------------------
    updateC6(dt, players, sfx) {
      const c6 = this.c6;

      // Check distance to players
      let nearestDist = Infinity;
      let playerInLobby = false;

      for (const p of players) {
        const dx = p.x - c6.x;
        const dy = p.y - c6.y;
        const dist = Math.hypot(dx, dy);
        if (dist < nearestDist) nearestDist = dist;

        // Player entered lobby zone: x (14..29), y (9..21)
        const pTileX = p.x / 32;
        const pTileY = p.y / 32;
        if (pTileX >= 14 && pTileX <= 29 && pTileY >= 9 && pTileY <= 21) {
          playerInLobby = true;
        }
      }

      // Wave reaction when player is in lobby
      if (playerInLobby && !c6.isWaving && c6.waveTimer <= 0) {
        c6.isWaving = true;
        c6.waveTimer = 2.5;
      }
      if (c6.waveTimer > 0) {
        c6.waveTimer -= dt;
        if (c6.waveTimer <= 0) c6.isWaving = false;
      }

      // Approach desk trigger (< 75px)
      const inRange = nearestDist < 75;
      if (inRange && !c6.playerInRange) {
        // Player just approached! Stand up + trigger typewriter bubble + ding SFX
        c6.isSitting = false;
        c6.playerInRange = true;
        this.triggerC6Dialogue(sfx);
      } else if (!inRange && c6.playerInRange) {
        // Player walked away: sit back down and reset bubble after short grace
        c6.playerInRange = false;
        c6.isSitting = true;
      }

      // Typewriter progress for C6
      if (c6.currentBubble) {
        if (c6.typewriterProgress < 1.0) {
          const totalChars = c6.currentBubble.length;
          const oldCharCount = Math.floor(totalChars * c6.typewriterProgress);
          // ~25ms per char -> 40 chars/sec
          c6.typewriterProgress = Math.min(1.0, c6.typewriterProgress + dt * (40 / Math.max(1, totalChars)));
          const newCharCount = Math.floor(totalChars * c6.typewriterProgress);

          if (newCharCount > oldCharCount && sfx) {
            sfx.playCharBlip();
          }
        } else {
          // Bubble display countdown
          c6.bubbleTimer -= dt;
          if (c6.bubbleTimer <= 0 && !c6.playerInRange) {
            c6.currentBubble = null;
          }
        }
      }
    }

    interactWithC6(sfx) {
      const c6 = this.c6;
      c6.isSitting = false;
      c6.playerInRange = true;
      this.triggerC6Dialogue(sfx);
    }

    triggerC6Dialogue(sfx) {
      const c6 = this.c6;
      const lines = (this.officeData && this.officeData.c6 && this.officeData.c6.dialogue) || [
        'Hi! Welcome to the Hydrocarbon Forge office.',
        'The main board is looking good today!',
        'The archives keep growing — check the new box down the hall.'
      ];

      c6.currentBubble = lines[c6.dialogueIndex % lines.length];
      c6.dialogueIndex++;
      c6.typewriterProgress = 0;
      c6.bubbleTimer = 6.0;

      if (sfx) {
        sfx.playDing();
      }
    }

    // -------------------------------------------------------------------------
    // Harness Agents & State Machine
    // -------------------------------------------------------------------------
    updateHarnessAgents(dt, map, players, sfx, liveData) {
      const phrases = (this.officeData && this.officeData.agentSpeech) || [
        'hm', 'compiling', 'coffee?', 'LGTM', 'syncing'
      ];

      for (const [id, agent] of Object.entries(this.harnessAgents)) {
        agent.stateTimer -= dt;

        // Typewriter bubble updates
        if (agent.bubbleText) {
          if (agent.bubbleProgress < 1.0) {
            const totalChars = agent.bubbleText.length;
            const oldChar = Math.floor(totalChars * agent.bubbleProgress);
            agent.bubbleProgress = Math.min(1.0, agent.bubbleProgress + dt * (30 / Math.max(1, totalChars)));
            const newChar = Math.floor(totalChars * agent.bubbleProgress);
            if (newChar > oldChar && sfx) {
              sfx.playCharBlip();
            }
          } else {
            if (agent.stateTimer <= 0) {
              agent.bubbleText = null;
            }
          }
        }

        // State Machine
        if (agent.state === 'idle' || agent.state === 'working') {
          // Fast typing monitor clacks
          if (agent.state === 'working' && Math.random() < 0.15 && sfx) {
            sfx.playMonitorClack();
          }

          if (agent.stateTimer <= 0) {
            // Decide next state deterministically
            const roll = this.prng();
            if (roll < 0.35) {
              // Switch between idle and working
              agent.state = agent.state === 'idle' ? 'working' : 'idle';
              agent.stateTimer = 4 + this.prng() * 6;
            } else if (roll < 0.65) {
              // Walk to Break Room for coffee
              const path = map.findPath(agent.x, agent.y, map.waypoints['coffee_machine'].x, map.waypoints['coffee_machine'].y);
              if (path && path.length > 1) {
                agent.path = path;
                agent.pathIndex = 0;
                agent.state = 'moving';
                agent.subState = 'go_coffee';
              }
            } else {
              // Walk to Archives to fetch papers
              const targetX = map.waypoints['archives_top'].x + (this.prng() * 40 - 20);
              const targetY = map.waypoints['archives_top'].y + 32 * Math.floor(this.prng() * 4);
              const path = map.findPath(agent.x, agent.y, targetX, targetY);
              if (path && path.length > 1) {
                agent.path = path;
                agent.pathIndex = 0;
                agent.state = 'moving';
                agent.subState = 'fetch_papers';
              }
            }

            // Chance to emit tiny speech bubble
            if (this.prng() < 0.4 && !agent.bubbleText) {
              agent.bubbleText = phrases[Math.floor(this.prng() * phrases.length)];
              agent.bubbleProgress = 0;
            }
          }
        } else if (agent.state === 'moving') {
          // Follow A* path
          if (agent.path && agent.pathIndex < agent.path.length) {
            const target = agent.path[agent.pathIndex];
            const dx = target.x - agent.x;
            const dy = target.y - agent.y;
            const dist = Math.hypot(dx, dy);

            if (dist < 4) {
              agent.pathIndex++;
            } else {
              const moveDist = Math.min(dist, agent.speed);
              agent.x += (dx / dist) * moveDist;
              agent.y += (dy / dist) * moveDist;
              agent.facing = dx >= 0 ? 1 : -1;

              // Soft repulsion from players
              for (const p of players) {
                const pdx = agent.x - p.x;
                const pdy = agent.y - p.y;
                const pdist = Math.hypot(pdx, pdy);
                if (pdist < 26 && pdist > 0.1) {
                  agent.x += (pdx / pdist) * 1.5;
                  agent.y += (pdy / pdist) * 1.5;
                }
              }
            }
          } else {
            // Reached destination
            if (agent.subState === 'go_coffee') {
              agent.state = 'on_coffee';
              agent.stateTimer = 5 + this.prng() * 4;
              if (sfx) sfx.playCoffeeGurgle();
            } else if (agent.subState === 'fetch_papers') {
              agent.papers = true;
              // Walk back home with papers
              const homePath = map.findPath(agent.x, agent.y, agent.homeX, agent.homeY);
              if (homePath) {
                agent.path = homePath;
                agent.pathIndex = 0;
                agent.state = 'moving';
                agent.subState = 'return_home';
              } else {
                agent.state = 'working';
                agent.papers = false;
              }
            } else if (agent.subState === 'return_home') {
              agent.state = 'working';
              agent.papers = false;
              agent.stateTimer = 8 + this.prng() * 5;
            }
          }
        } else if (agent.state === 'on_coffee') {
          if (agent.stateTimer <= 0) {
            // Finished coffee, walk back to office desk
            const homePath = map.findPath(agent.x, agent.y, agent.homeX, agent.homeY);
            if (homePath) {
              agent.path = homePath;
              agent.pathIndex = 0;
              agent.state = 'moving';
              agent.subState = 'return_home';
            } else {
              agent.state = 'idle';
            }
          }
        }
      }
    }

    // -------------------------------------------------------------------------
    // Subagents within harness offices (reconciled from live /api/flow)
    // -------------------------------------------------------------------------
    reconcileSubagents(liveData) {
      const HARNESS_MAP = {
        'harness-opencode': 'opencode',
        'harness-claude': 'claude-code',
        'harness-antigravity': 'antigravity'
      };

      const flowHarnesses = (liveData && liveData.flow && Array.isArray(liveData.flow.harnesses))
        ? liveData.flow.harnesses
        : [];

      // Determine target count for each harness office
      const targetCounts = {
        'opencode': 0,
        'claude-code': 0,
        'antigravity': 0
      };

      for (const h of flowHarnesses) {
        const officeKey = HARNESS_MAP[h.id];
        if (!officeKey) continue; // C6 or others ignored
        if (h.running) {
          const sessions = Number(h.active_sessions) || 0;
          const subtasks = Number(h.subtasks) || 0;
          targetCounts[officeKey] = Math.min(3, Math.max(0, sessions + subtasks));
        } else {
          targetCounts[officeKey] = 0;
        }
      }

      for (const [officeKey, agent] of Object.entries(this.harnessAgents)) {
        const target = targetCounts[officeKey] || 0;
        const activeSubagents = agent.subagents.filter((s) => !s.despawning);

        // Spawn new subagents if below target (pop-in animation)
        if (activeSubagents.length < target) {
          const countToAdd = target - activeSubagents.length;
          for (let i = 0; i < countToAdd; i++) {
            const subNum = agent.subagents.length + 1;
            agent.subagents.push({
              id: `${officeKey}_sub_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              name: `sub-${subNum}`,
              color: agent.color,
              hat: 'none',
              face: 'classic',
              x: agent.homeX + (this.prng() * 30 - 15),
              y: agent.homeY + (this.prng() * 20 - 10),
              targetX: agent.homeX + (this.prng() * 40 - 20),
              targetY: agent.homeY + (this.prng() * 40 - 20),
              stateTimer: 2 + this.prng() * 3,
              scale: 0.05,
              targetScale: 0.55,
              alpha: 0.0,
              targetAlpha: 1.0,
              despawning: false,
              isMoving: false,
              facing: 1
            });
          }
        } else if (activeSubagents.length > target) {
          // Despawn excess subagents (fade / shrink / walk out)
          const countToRemove = activeSubagents.length - target;
          let removed = 0;
          for (let i = agent.subagents.length - 1; i >= 0 && removed < countToRemove; i--) {
            const sub = agent.subagents[i];
            if (!sub.despawning) {
              sub.despawning = true;
              sub.targetAlpha = 0.0;
              sub.targetScale = 0.0;
              removed++;
            }
          }
        }
      }
    }

    updateSubagents(dt, liveData) {
      this.reconcileSubagents(liveData);

      for (const [id, agent] of Object.entries(this.harnessAgents)) {
        for (let i = agent.subagents.length - 1; i >= 0; i--) {
          const sub = agent.subagents[i];

          // Pop-in / fade-out animations
          if (!sub.despawning) {
            sub.scale += (sub.targetScale - sub.scale) * Math.min(1, dt * 8);
            sub.alpha += (sub.targetAlpha - sub.alpha) * Math.min(1, dt * 8);
          } else {
            sub.scale = Math.max(0, sub.scale - dt * 2.0);
            sub.alpha = Math.max(0, sub.alpha - dt * 2.5);
            if (sub.alpha <= 0.01 || sub.scale <= 0.01) {
              agent.subagents.splice(i, 1);
              continue;
            }
          }

          sub.stateTimer -= dt;
          if (sub.stateTimer <= 0) {
            // Pick a new small errand waypoint in the office
            sub.targetX = agent.homeX + (this.prng() * 50 - 25);
            sub.targetY = agent.homeY + (this.prng() * 40 - 20);
            sub.stateTimer = 2 + this.prng() * 3;
          }

          const dx = sub.targetX - sub.x;
          const dy = sub.targetY - sub.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 2) {
            sub.x += (dx / dist) * 1.2;
            sub.y += (dy / dist) * 1.2;
            sub.facing = dx >= 0 ? 1 : -1;
            sub.isMoving = true;
          } else {
            sub.isMoving = false;
          }
        }
      }
    }

    // -------------------------------------------------------------------------
    // Render all agents
    // -------------------------------------------------------------------------
    render(renderer, ctx) {
      const now = performance.now();
      const walkFrame = Math.floor(now / 180) % 2;

      // 1. C6 Receptionist
      const c6 = this.c6;
      renderer.renderAvatar(ctx, c6.x, c6.y, {
        color: c6.color,
        hat: c6.hat,
        face: c6.face,
        isSitting: c6.isSitting,
        facing: 1,
        frame: 0
      });
      renderer.renderNameTag(ctx, c6.x, c6.y, 'C6 (Reception)', '#F6E05E');

      if (c6.currentBubble) {
        renderer.renderSpeechBubble(ctx, c6.x, c6.y, c6.currentBubble, c6.typewriterProgress);
      }

      // 2. Harness Agents
      for (const [id, agent] of Object.entries(this.harnessAgents)) {
        const isMoving = agent.state === 'moving';
        renderer.renderAvatar(ctx, agent.x, agent.y, {
          color: agent.color,
          hat: agent.hat,
          face: agent.face,
          facing: agent.facing,
          isMoving,
          isSitting: !isMoving,
          papers: agent.papers,
          frame: isMoving ? walkFrame : 0
        });

        renderer.renderNameTag(ctx, agent.x, agent.y, agent.name, '#81E6D9');

        if (agent.bubbleText) {
          renderer.renderSpeechBubble(ctx, agent.x, agent.y, agent.bubbleText, agent.bubbleProgress);
        }

        // Subagents
        for (const sub of agent.subagents) {
          renderer.renderAvatar(ctx, sub.x, sub.y, {
            color: sub.color,
            hat: sub.hat,
            face: sub.face,
            facing: sub.facing || 1,
            isMoving: sub.isMoving,
            scale: sub.scale,
            alpha: sub.alpha,
            frame: sub.isMoving ? walkFrame : 0
          });

          renderer.renderNameTag(ctx, sub.x, sub.y - 4, sub.name, '#E2E8F0', sub.alpha);
        }
      }
    }
  }

  global.AgentManager = AgentManager;
})(typeof window !== 'undefined' ? window : global);
