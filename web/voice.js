// web/voice.js — Proximity Voice Chat (Capture, DDA Wall Occlusion, Distance Attenuation, Lowpass Filter, Playback)
(function (global) {
  const CHUNK_SIZE = 960; // 960 samples @ 48kHz = 20ms
  const SAMPLE_RATE = 48000;
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

      // Mic state
      this.micStream = null;
      this.micSource = null;
      this.scriptProcessor = null;
      this.isMicEnabled = false;
      this.isVoiceMuted = false; // V key: mic off, keep receiving
      this.isGlobalMuted = false; // M key: both voice and sfx

      // Gating & AGC state
      this.consecutiveVoiceChunks = 0;
      this.gateOpen = false;
      this.gateCloseTimer = 0;
      this.lastTxTime = 0;
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
    }

    async enableMic() {
      if (this.isMicEnabled) return true;

      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('getUserMedia not supported');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
            sampleRate: SAMPLE_RATE
          }
        });

        this.micStream = stream;
        this.setupCapturePipeline(stream);
        this.isMicEnabled = true;
        this.isVoiceMuted = false;
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
      if (this.micSource) {
        try {
          this.micSource.disconnect();
        } catch {}
        this.micSource = null;
      }
      this.isMicEnabled = false;
      this.isTransmitting = false;
    }

    toggleMuteVoice() {
      this.isVoiceMuted = !this.isVoiceMuted;
      if (this.isVoiceMuted) {
        this.isTransmitting = false;
      }
      return this.isVoiceMuted;
    }

    setGlobalMute(muted) {
      this.isGlobalMuted = Boolean(muted);
    }

    setupCapturePipeline(stream) {
      if (!this.audioCtx) return;
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      this.micSource = this.audioCtx.createMediaStreamSource(stream);
      // Fallback script processor for cross-browser mono chunking
      const bufferSize = 1024;
      this.scriptProcessor = this.audioCtx.createScriptProcessor(bufferSize, 1, 1);

      let sampleAccumulator = [];

      this.scriptProcessor.onaudioprocess = (e) => {
        if (!this.isMicEnabled || this.isVoiceMuted || this.isGlobalMuted) {
          this.isTransmitting = false;
          return;
        }

        const input = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < input.length; i++) {
          sampleAccumulator.push(input[i]);
          if (sampleAccumulator.length >= CHUNK_SIZE) {
            const chunk = sampleAccumulator.splice(0, CHUNK_SIZE);
            this.processAndSendChunk(chunk);
          }
        }
      };

      this.micSource.connect(this.scriptProcessor);
      // Connect to a mute sink to prevent feedback
      const gain = this.audioCtx.createGain();
      gain.gain.value = 0;
      this.scriptProcessor.connect(gain);
      gain.connect(this.audioCtx.destination);
    }

    processAndSendChunk(samples) {
      const now = performance.now();
      // Throttle to max 1 chunk per ~20ms
      if (now - this.lastTxTime < 18) return;

      // 1. RMS Calculation
      let sumSq = 0;
      let peak = 0;
      for (let i = 0; i < samples.length; i++) {
        const val = samples[i];
        sumSq += val * val;
        const abs = Math.abs(val);
        if (abs > peak) peak = abs;
      }
      const rms = Math.sqrt(sumSq / samples.length);

      // Gate: only transmit when > 0.06 RMS over 3 consecutive chunks
      if (rms > 0.06) {
        this.consecutiveVoiceChunks++;
        if (this.consecutiveVoiceChunks >= 3) {
          this.gateOpen = true;
          this.gateCloseTimer = 0.35; // 350ms release hangover
        }
      } else {
        this.consecutiveVoiceChunks = 0;
        if (this.gateOpen) {
          this.gateCloseTimer -= 0.02;
          if (this.gateCloseTimer <= 0) {
            this.gateOpen = false;
          }
        }
      }

      if (!this.gateOpen) {
        this.isTransmitting = false;
        return;
      }

      this.isTransmitting = true;
      this.lastTxTime = now;

      // AGC-ish normalization to ~0.8 peak
      let scale = 1.0;
      if (peak > 0.01) {
        scale = Math.min(3.5, 0.8 / peak);
      }

      // Convert float [-1.0, 1.0] to PCM16
      const pcm16 = new Int16Array(CHUNK_SIZE);
      for (let i = 0; i < CHUNK_SIZE; i++) {
        const clamped = Math.max(-1.0, Math.min(1.0, samples[i] * scale));
        pcm16[i] = Math.round(clamped * 32767);
      }

      const b64 = int16ToB64(pcm16);
      const level = Math.min(1.0, peak * scale);

      // Send via WS
      if (this.net && typeof this.net.sendVoiceChunk === 'function') {
        this.net.sendVoiceChunk(b64, level);
      }
    }

    handleVoicePacket(pkt) {
      // Received { t: 'va', from, name, d, l, x, y }
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
        source.enqueueChunk(pcm16);
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

      return {
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
        enqueueChunk(pcm16) {
          if (!ctx) return;
          const floatSamples = new Float32Array(pcm16.length);
          for (let i = 0; i < pcm16.length; i++) {
            floatSamples[i] = pcm16[i] / 32767.0;
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

      function scheduleNext() {
        if (!isPlaying || !ctx) return;
        if (ringBuffer.length === 0) {
          isPlaying = false;
          return;
        }

        const chunk = ringBuffer.shift();
        const buffer = ctx.createBuffer(1, chunk.length, SAMPLE_RATE);
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
      }
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
