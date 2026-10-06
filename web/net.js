// web/net.js — Multiplayer client networking & remote player interpolation
(function (global) {
  class NetworkBridge {
    constructor(game) {
      this.game = game;
      this.ws = null;
      this.connected = false;
      this.myId = null;
      this.remotePlayers = new Map(); // id -> RemotePlayerState
      this.lastMoveSendTime = 0;
      this.moveSendInterval = 66; // 15Hz throttle (~66ms)
      this.pendingLocalCosmetics = null;
      this.reconnectTimer = null;
      this.connect();
    }

    connect() {
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${location.host}/bridge`;

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (err) {
        console.warn('WebSocket connection error:', err);
        this.scheduleReconnect();
        return;
      }

      this.ws.onopen = () => {
        this.connected = true;
        if (this.game.gameStarted) {
          this.sendJoin();
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (err) {
          console.warn('Failed to parse WS message:', err);
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.connected = false;
        try { this.ws.close(); } catch {}
      };
    }

    scheduleReconnect() {
      if (this.reconnectTimer) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 3000);
    }

    send(msgObj) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msgObj));
      }
    }

    sendMove(x, y, dir, facing) {
      const now = performance.now();
      if (now - this.lastMoveSendTime < this.moveSendInterval) return;
      this.lastMoveSendTime = now;

      this.send({
        type: 'move',
        x: Math.round(x),
        y: Math.round(y),
        dir: dir,
        facing: facing
      });
    }

    sendEquip(cosmetics) {
      this.send({
        type: 'equip',
        cosmetics: cosmetics
      });
    }

    sendJoin() {
      const player = this.game.player;
      this.send({
        type: 'join',
        profile: player.profile || 'nathan',
        name: player.name || 'Nathan',
        cosmetics: player.cosmetics,
        x: player.x,
        y: player.y
      });
    }

    sendName(name) {
      this.send({
        type: 'name',
        name: name
      });
    }

    sendVoiceChunk(b64, level) {
      this.send({
        type: 'va',
        t: 'va',
        d: b64,
        l: level
      });
    }

    handleMessage(msg) {
      if ((msg.t === 'va' || msg.type === 'va') && this.game.voice) {
        this.game.voice.handleVoicePacket(msg);
        return;
      }

      switch (msg.type) {
        case 'welcome': {
          this.myId = msg.you;
          if (msg.agentsSeed && this.game.agents) {
            this.game.agents.setSeed(msg.agentsSeed);
          }
          if (Array.isArray(msg.players)) {
            for (const p of msg.players) {
              this.addRemotePlayer(p);
            }
          }
          break;
        }

        case 'player-join': {
          if (msg.id !== this.myId) {
            this.addRemotePlayer(msg);
          }
          break;
        }

        case 'player-leave': {
          this.remotePlayers.delete(msg.id);
          break;
        }

        case 'move': {
          const remote = this.remotePlayers.get(msg.id);
          if (remote) {
            remote.targetX = msg.x;
            remote.targetY = msg.y;
            remote.dir = msg.dir;
            remote.facing = msg.facing !== undefined ? msg.facing : remote.facing;
            remote.isMoving = msg.dir !== 'idle';
          }
          break;
        }

        case 'equip': {
          const remote = this.remotePlayers.get(msg.id);
          if (remote && msg.cosmetics) {
            remote.cosmetics = Object.assign(remote.cosmetics, msg.cosmetics);
          }
          break;
        }

        case 'name': {
          const remote = this.remotePlayers.get(msg.id);
          if (remote && msg.name) {
            remote.name = msg.name;
          }
          break;
        }
      }
    }

    addRemotePlayer(data) {
      this.remotePlayers.set(data.id, {
        id: data.id,
        name: data.name || 'Visitor',
        cosmetics: data.cosmetics || { color: 'coral', hat: 'none', trail: 'none', face: 'classic' },
        x: data.x || 32 * 32,
        y: data.y || 25 * 32,
        targetX: data.x || 32 * 32,
        targetY: data.y || 25 * 32,
        facing: data.facing || 1,
        dir: data.dir || 'idle',
        isMoving: false
      });
    }

    update(dt) {
      // Interpolate remote players (120ms lerp smoothing)
      const lerpSpeed = Math.min(1.0, dt * 10);
      for (const remote of this.remotePlayers.values()) {
        const dx = remote.targetX - remote.x;
        const dy = remote.targetY - remote.y;
        remote.x += dx * lerpSpeed;
        remote.y += dy * lerpSpeed;

        if (Math.hypot(dx, dy) > 2) {
          remote.isMoving = true;
        } else {
          remote.isMoving = false;
        }
      }
    }

    getRemotePlayersList() {
      return Array.from(this.remotePlayers.values());
    }
  }

  global.NetworkBridge = NetworkBridge;
})(typeof window !== 'undefined' ? window : global);
