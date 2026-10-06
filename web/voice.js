// web/voice.js — Proximity Voice Chat (Capture, DDA Wall Occlusion, Distance Attenuation, Lowpass Filter, Playback)
(function (global) {
  const MAX_DISTANCE = 800; // 800px max hearing distance

  // Math helper: DDA raycast on tile grid from (x0, y0) to (x1, y1)
  // Counts solid walls as 1 hit, doorways as 0.5 hit.
  // Returns occlusion factor: 0 hits -> 1.0, 1 hit -> 0.45, 2+ hits -> 0.15
  function calculateWallOcclusion(x0, y0, x1, y1, map) {
    if (!map) return 1.0;

    const TILE = map.tile || 32;
    const startTx = Math.floor(x0 / TILE);
    const startTy = Math.floor(y0 / TILE);
    const endTx = Math.floor(x1 / TILE);
    const endTy = Math.floor(y1 / TILE);

    if (startTx === endTx && startTy === endTy) {
      return 1.0; // Same tile
    }

    const dx = x1 - x0;
    const dy = y1 - y0;

    const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
    const stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);

    const tDeltaX = dx === 0 ? Infinity : Math.abs(TILE / dx);
    const tDeltaY = dy === 0 ? Infinity : Math.abs(TILE / dy);

    let tMaxX = 0;
    if (stepX > 0) {
      tMaxX = ((startTx + 1) * TILE - x0) / dx;
    } else if (stepX < 0) {
      tMaxX = (startTx * TILE - x0) / dx;
    } else {
      tMaxX = Infinity;
    }

    let tMaxY = 0;
    if (stepY > 0) {
      tMaxY = ((startTy + 1) * TILE - y0) / dy;
    } else if (stepY < 0) {
      tMaxY = (startTy * TILE - y0) / dy;
    } else {
      tMaxY = Infinity;
    }

    let currTx = startTx;
    let currTy = startTy;
    let hits = 0;
    let steps = 0;
    const maxSteps = Math.abs(endTx - startTx) + Math.abs(endTy - startTy) + 2;

    while ((currTx !== endTx || currTy !== endTy) && steps++ < maxSteps) {
      if (tMaxX < tMaxY) {
        currTx += stepX;
        tMaxX += tDeltaX;
      } else {
        currTy += stepY;
        tMaxY += tDeltaY;
      }

      // If reached target tile, break before evaluating obstacle
      if (currTx === endTx && currTy === endTy) {
        break;
      }

      // Check tile type
      const isDoor = map.isDoorway ? map.isDoorway(currTx, currTy) : (map.doors && map.doors.some(d => d.tileX === currTx && d.tileY === currTy));
      const isSolid = map.isSolid ? map.isSolid(currTx, currTy) : false;

      if (isDoor) {
        // Doorway counts as 0.5 hit (doors open for audio in this game)
        hits += 0.5;
      } else if (isSolid) {
        // Solid wall counts as 1.0 hit
        hits += 1.0;
      }
    }

    // 0 wall hits -> 1.0, 1 -> 0.45, 2+ -> 0.15
    if (hits === 0) return 1.0;
    if (hits <= 1.0) return 0.45;
    return 0.15;
  }

  // Distance gain math: clamp(1 - d/800, 0, 1)
  function calculateDistanceGain(dist) {
    return Math.max(0, Math.min(1, 1 - dist / MAX_DISTANCE));
  }

  // Lowpass filter cutoff: lerp(6000, 900, d/800)
  function calculateCutoffFreq(dist) {
    const ratio = Math.max(0, Math.min(1, dist / MAX_DISTANCE));
    return 6000 + (900 - 6000) * ratio;
  }

  // Asymmetric gain smoothing: 200ms attack / 400ms release
  function smoothGain(current, target, dt, attackMs = 200, releaseMs = 400) {
    const tau = (target > current ? attackMs : releaseMs) / 1000;
    if (tau <= 0) return target;
    const alpha = 1 - Math.exp(-dt / tau);
    return current + (target - current) * alpha;
  }

  // Base64 to Int16Array
  function b64ToInt16(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Int16Array(bytes.buffer);
  }

  // Int16Array to Base64
  function int16ToB64(int16Array) {
    const bytes = new Uint8Array(int16Array.buffer, int16Array.byteOffset, int16Array.byteLength);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // ---------------------------------------------------------------------------
  // VoiceChatManager
  // ---------------------------------------------------------------------------
  class VoiceChatManager {
    constructor() {
      this.audioCtx = null;
      this.net = null;
      this.map = null;
      this.getPlayerPos = null;

      // Dynamic sample rate & chunk size (20ms derived from AudioContext)
      this.sr = (typeof AudioContext !== 'undefined' && AudioContext.prototype && AudioContext.sampleRate) || 44100;
      this.chunkSize = Math.round(this.sr * 0.02);
      this.sampleAccumulator = [];

      // Mic state
      this.micStream = null;
      this.micSource = null;
      this.scriptProcessor = null;
      this.selfMonitorGainNode = null;
      this.isSelfMonitorEnabled = true; // Default: ON per spec
      this.hasShownMonitorToast = false;
      this.isMicEnabled = false;
      this.isVoiceMuted = false; // V key: mic off, keep receiving
      this.isGlobalMuted = false; // M key: both voice and sfx
      this.isTransmitting = false;

      // Active voice playback sources: Map<string, SourcePlayer>
      this.sources = new Map();

      // Occlusion poll timer
      this.occlusionTimer = 0;

      // HUD indicators
      this.activeSpeakers = []; // { id, name, level }
      this.onToast = null;
    }

    init(audioCtx, net, map, getPlayerPos, onToast) {
      this.audioCtx = audioCtx;
      this.net = net;
      this.map = map;
      this.getPlayerPos = getPlayerPos;
      this.onToast = onToast;
      if (this.audioCtx && this.audioCtx.sampleRate) {
        this.sr = this.audioCtx.sampleRate;
        this.chunkSize = Math.round(this.sr * 0.02);
      }
    }

    async enableMic() {
      if (this.isMicEnabled) return true;

      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('getUserMedia not supported');
        }

        if (this.audioCtx && this.audioCtx.sampleRate) {
          this.sr = this.audioCtx.sampleRate;
          this.chunkSize = Math.round(this.sr * 0.02);
        }

        // Raw mic with NO browser audio processing per specification
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });

        this.micStream = stream;
        this.setupCapturePipeline(stream);
        this.isMicEnabled = true;
        this.isVoiceMuted = false;

        // One-time self-monitor guidance toast on mic enable
        if (this.isSelfMonitorEnabled && !this.hasShownMonitorToast) {
          this.hasShownMonitorToast = true;
          if (this.onToast) {
            this.onToast("Heard yourself? Lower the music (M) if there's feedback.");
          }
        }

        return true;
      } catch (err) {
        console.warn('Voice mic access denied or failed:', err);
        if (this.onToast) {
          this.onToast('Mic unavailable — you can still hear others');
        }
        this.isMicEnabled = false;
        return false;
      }
    }

    disableMic() {
      if (this.micStream) {
        try {
          this.micStream.getTracks().forEach(t => t.stop());
        } catch {}
        this.micStream = null;
      }
      if (this.scriptProcessor) {
        try {
          this.scriptProcessor.disconnect();
        } catch {}
        this.scriptProcessor = null;
      }
      if (this.selfMonitorGainNode) {
        try {
          this.selfMonitorGainNode.disconnect();
        } catch {}
        this.selfMonitorGainNode = null;
      }
      if (this.micSource) {
        try {
          this.micSource.disconnect();
        } catch {}
        this.micSource = null;
      }
      this.sampleAccumulator = [];
      this.isMicEnabled = false;
      this.isTransmitting = false;
    }

    toggleSelfMonitor() {
      this.isSelfMonitorEnabled = !this.isSelfMonitorEnabled;
      this.updateSelfMonitorGain();
      if (this.isSelfMonitorEnabled && !this.hasShownMonitorToast) {
        this.hasShownMonitorToast = true;
        if (this.onToast) {
          this.onToast("Heard yourself? Lower the music (M) if there's feedback.");
        }
      }
      return this.isSelfMonitorEnabled;
    }

    setSelfMonitor(enabled) {
      this.isSelfMonitorEnabled = Boolean(enabled);
      this.updateSelfMonitorGain();
      if (this.isSelfMonitorEnabled && !this.hasShownMonitorToast) {
        this.hasShownMonitorToast = true;
        if (this.onToast) {
          this.onToast("Heard yourself? Lower the music (M) if there's feedback.");
        }
      }
      return this.isSelfMonitorEnabled;
    }

    updateSelfMonitorGain() {
      if (!this.selfMonitorGainNode || !this.audioCtx) return;
      const target = (this.isSelfMonitorEnabled && !this.isVoiceMuted && !this.isGlobalMuted) ? 0.35 : 0.0;
      this.selfMonitorGainNode.gain.value = target;
      try {
        this.selfMonitorGainNode.gain.setValueAtTime(target, this.audioCtx.currentTime);
      } catch {}
    }

    toggleMuteVoice() {
      this.isVoiceMuted = !this.isVoiceMuted;
      if (this.isVoiceMuted) {
        this.isTransmitting = false;
      }
      this.updateSelfMonitorGain();
      return this.isVoiceMuted;
    }

    setGlobalMute(muted) {
      this.isGlobalMuted = Boolean(muted);
      this.updateSelfMonitorGain();
    }

    setupCapturePipeline(stream) {
      if (!this.audioCtx) return;
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      this.sr = this.audioCtx.sampleRate;
      this.chunkSize = Math.round(this.sr * 0.02);

      this.micSource = this.audioCtx.createMediaStreamSource(stream);

      // Local self-monitor: raw mic -> GainNode (~0.35) -> ctx.destination
      this.selfMonitorGainNode = this.audioCtx.createGain();
      const initialMonitorGain = (this.isSelfMonitorEnabled && !this.isVoiceMuted && !this.isGlobalMuted) ? 0.35 : 0.0;
      this.selfMonitorGainNode.gain.value = initialMonitorGain;
      try {
        this.selfMonitorGainNode.gain.setValueAtTime(initialMonitorGain, this.audioCtx.currentTime);
      } catch {}
      this.micSource.connect(this.selfMonitorGainNode);
      this.selfMonitorGainNode.connect(this.audioCtx.destination);

      // Web Audio ScriptProcessor requires power-of-two buffer size (256..16384).
      // We use 512 for low latency (~10-11ms per callback) and exact 20ms chunk framing.
      const bufferSize = 512;
      this.scriptProcessor = this.audioCtx.createScriptProcessor(bufferSize, 1, 1);
      this.sampleAccumulator = [];

      this.scriptProcessor.onaudioprocess = (e) => {
        if (!this.isMicEnabled || this.isVoiceMuted || this.isGlobalMuted) {
          this.isTransmitting = false;
          return;
        }

        const input = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < input.length; i++) {
          this.sampleAccumulator.push(input[i]);
        }

        // Dispatch continuous 20ms chunks without gating or throttle
        while (this.sampleAccumulator.length >= this.chunkSize) {
          const chunk = this.sampleAccumulator.splice(0, this.chunkSize);
          this.processAndSendChunk(chunk);
        }
      };

      this.micSource.connect(this.scriptProcessor);

      // Keep script processor alive with silent gain sink to destination
      const silentGain = this.audioCtx.createGain();
      silentGain.gain.value = 0;
      this.scriptProcessor.connect(silentGain);
      silentGain.connect(this.audioCtx.destination);
    }

    processAndSendChunk(samples) {
      this.isTransmitting = true;

      // Raw peak of chunk for HUD level indicator only (never for gating)
      let peak = 0;
      const len = samples.length;
      for (let i = 0; i < len; i++) {
        const abs = Math.abs(samples[i]);
        if (abs > peak) peak = abs;
      }

      // Convert float [-1.0, 1.0] to PCM16 with only a clamp to ±1.0
      // Raw capture: no gain, no AGC normalization, no RMS gate threshold
      const pcm16 = new Int16Array(len);
      for (let i = 0; i < len; i++) {
        const clamped = Math.max(-1.0, Math.min(1.0, samples[i]));
        pcm16[i] = Math.round(clamped * 32767);
      }

      const b64 = int16ToB64(pcm16);
      const level = Math.min(1.0, peak);

      // Send unconditionally via network bridge
      if (this.net && typeof this.net.sendVoiceChunk === 'function') {
        this.net.sendVoiceChunk(b64, level, this.sr);
      }
    }

    handleVoicePacket(pkt) {
      // Received { t: 'va', from, name, d, l, sr, x, y }
      if (!pkt || !pkt.from || !pkt.d) return;

      const id = pkt.from;
      let source = this.sources.get(id);

      if (!source) {
        source = this.createSourcePlayer(id, pkt.name || 'Player');
        this.sources.set(id, source);
      }

      source.name = pkt.name || source.name;
      source.x = typeof pkt.x === 'number' ? pkt.x : source.x;
      source.y = typeof pkt.y === 'number' ? pkt.y : source.y;
      source.level = typeof pkt.l === 'number' ? pkt.l : 0.5;
      source.lastSeen = performance.now();

      // Decode PCM16
      try {
        const pcm16 = b64ToInt16(pkt.d);
        source.enqueueChunk(pcm16, pkt.sr);
      } catch (err) {
        console.warn('Voice decode error:', err);
      }
    }

    createSourcePlayer(id, name) {
      const ctx = this.audioCtx;
      const gainNode = ctx ? ctx.createGain() : null;
      const biquad = ctx ? ctx.createBiquadFilter() : null;

      if (biquad) {
        biquad.type = 'lowpass';
        biquad.frequency.value = 6000;
        biquad.Q.value = 0.7;
      }
      if (gainNode) {
        gainNode.gain.value = 0;
      }

      if (biquad && gainNode && ctx) {
        biquad.connect(gainNode);
        gainNode.connect(ctx.destination);
      }

      const ringBuffer = []; // queue of Float32Array chunks (~150ms buffer)
      let isPlaying = false;
      let nextPlayTime = 0;

      const player = {
        id,
        name,
        x: 0,
        y: 0,
        level: 0,
        lastSeen: performance.now(),
        gainNode,
        biquad,
        currentGain: 0,
        targetGain: 0,
        occlusionFactor: 1.0,
        enqueueChunk: (pcm16, packetSr) => {
          if (!ctx) return;
          const currentSr = this.sr || ctx.sampleRate;
          let floatSamples;

          // Cross-sample-rate resampling: if sender and receiver sample rates differ,
          // linearly resample so chunk timing stays exactly 20ms at receiver context rate
          if (packetSr && Math.abs(packetSr - currentSr) > 1) {
            const targetLen = Math.round(pcm16.length * (currentSr / packetSr));
            floatSamples = new Float32Array(targetLen);
            const ratio = (pcm16.length - 1) / Math.max(1, targetLen - 1);
            for (let i = 0; i < targetLen; i++) {
              const srcIdx = i * ratio;
              const i0 = Math.floor(srcIdx);
              const i1 = Math.min(pcm16.length - 1, i0 + 1);
              const frac = srcIdx - i0;
              const s0 = pcm16[i0] / 32767.0;
              const s1 = pcm16[i1] / 32767.0;
              floatSamples[i] = s0 + frac * (s1 - s0);
            }
          } else {
            floatSamples = new Float32Array(pcm16.length);
            for (let i = 0; i < pcm16.length; i++) {
              floatSamples[i] = pcm16[i] / 32767.0;
            }
          }

          ringBuffer.push(floatSamples);
          // Limit ring buffer to ~200ms
          while (ringBuffer.length > 10) {
            ringBuffer.shift();
          }

          if (!isPlaying && ringBuffer.length >= 2) {
            isPlaying = true;
            nextPlayTime = ctx.currentTime + 0.05; // 50ms initial jitter delay
            scheduleNext();
          }
        },
        destroy() {
          isPlaying = false;
          ringBuffer.length = 0;
          if (gainNode) {
            try { gainNode.disconnect(); } catch {}
          }
          if (biquad) {
            try { biquad.disconnect(); } catch {}
          }
        }
      };

      const scheduleNext = () => {
        if (!isPlaying || !ctx) return;
        if (ringBuffer.length === 0) {
          isPlaying = false;
          return;
        }

        const chunk = ringBuffer.shift();
        const currentSr = this.sr || ctx.sampleRate;
        const buffer = ctx.createBuffer(1, chunk.length, currentSr);
        buffer.copyToChannel(chunk, 0);

        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(biquad);

        const startTime = Math.max(ctx.currentTime, nextPlayTime);
        node.start(startTime);
        nextPlayTime = startTime + buffer.duration;

        node.onended = () => {
          if (ringBuffer.length > 0) {
            scheduleNext();
          } else {
            isPlaying = false;
          }
        };
      };

      return player;
    }

    update(dt) {
      const now = performance.now();
      const myPos = this.getPlayerPos ? this.getPlayerPos() : { x: 0, y: 0 };

      this.occlusionTimer += dt;
      const doOcclusionCheck = this.occlusionTimer >= 0.10; // every 100ms
      if (doOcclusionCheck) {
        this.occlusionTimer = 0;
      }

      this.activeSpeakers = [];

      // Update active sources
      for (const [id, source] of this.sources.entries()) {
        const silenceTime = (now - source.lastSeen) / 1000;
        if (silenceTime > 1.5) {
          // Drop source after 1.5s silence
          source.destroy();
          this.sources.delete(id);
          continue;
        }

        const dist = Math.hypot(myPos.x - source.x, myPos.y - source.y);
        const distGain = calculateDistanceGain(dist);
        const cutoff = calculateCutoffFreq(dist);

        // Update occlusion factor every 100ms
        if (doOcclusionCheck) {
          source.occlusionFactor = calculateWallOcclusion(myPos.x, myPos.y, source.x, source.y, this.map);
        }

        // Target gain
        let targetGain = distGain * source.occlusionFactor;
        if (this.isGlobalMuted) {
          targetGain = 0;
        }

        // Smooth gain with 200ms attack / 400ms release
        source.currentGain = smoothGain(source.currentGain, targetGain, dt, 200, 400);

        if (source.gainNode) {
          source.gainNode.gain.setValueAtTime(source.currentGain, this.audioCtx ? this.audioCtx.currentTime : 0);
        }
        if (source.biquad) {
          source.biquad.frequency.setValueAtTime(cutoff, this.audioCtx ? this.audioCtx.currentTime : 0);
        }

        if (source.level > 0.05 && silenceTime < 0.4) {
          this.activeSpeakers.push({
            id: source.id,
            name: source.name,
            level: source.level * source.currentGain
          });
        }
      }
    }
  }

  // Exports for browser & Node test suite
  global.VoiceChatManager = VoiceChatManager;
  global.calculateWallOcclusion = calculateWallOcclusion;
  global.calculateDistanceGain = calculateDistanceGain;
  global.calculateCutoffFreq = calculateCutoffFreq;
  global.smoothGain = smoothGain;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      VoiceChatManager,
      calculateWallOcclusion,
      calculateDistanceGain,
      calculateCutoffFreq,
      smoothGain
    };
  }
})(typeof window !== 'undefined' ? window : global);
