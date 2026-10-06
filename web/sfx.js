// web/sfx.js — Procedural WebAudio sound effects and background music (no external audio files)
(function (global) {
  let audioCtx = null;
  let masterGain = null;
  let sfxBusGain = null;
  let sfxBusFilter = null;
  let musicBusGain = null;
  let isMuted = false;
  let isMusicMuted = false;

  // Background Music State
  let musicInterval = null;
  let currentChordIdx = 0;
  let vinylSource = null;
  let musicRunning = false;

  const JAZZ_CHORDS = [
    // 1. Dm9: D2 bass; F3, A3, C4, E4
    { bass: 73.42, notes: [174.61, 220.00, 261.63, 329.63], scale: [220.0, 261.63, 329.63, 349.23, 440.0] },
    // 2. G13: G2 bass; F3, B3, E4, A4
    { bass: 98.00, notes: [174.61, 246.94, 329.63, 440.00], scale: [196.0, 246.94, 293.66, 329.63, 440.0] },
    // 3. Cmaj9: C3 bass; E3, G3, B3, D4
    { bass: 130.81, notes: [164.81, 196.00, 246.94, 293.66], scale: [261.63, 293.66, 329.63, 392.0, 493.88] },
    // 4. Am9: A2 bass; G3, C4, E4, B4
    { bass: 110.00, notes: [196.00, 261.63, 329.63, 493.88], scale: [220.0, 261.63, 329.63, 392.0, 493.88] }
  ];

  function initAudio() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioCtx = new AudioContextClass();

      // Master bus
      masterGain = audioCtx.createGain();
      masterGain.gain.value = isMuted ? 0 : 0.9;
      masterGain.gain.setValueAtTime(isMuted ? 0 : 0.9, audioCtx.currentTime);
      masterGain.connect(audioCtx.destination);

      // SFX Bus with gentle lowpass roll-off (warmth, no harsh transients)
      sfxBusFilter = audioCtx.createBiquadFilter();
      sfxBusFilter.type = 'lowpass';
      sfxBusFilter.frequency.setValueAtTime(3400, audioCtx.currentTime);
      sfxBusFilter.Q.setValueAtTime(0.707, audioCtx.currentTime);

      sfxBusGain = audioCtx.createGain();
      sfxBusGain.gain.value = 0.85;
      sfxBusGain.gain.setValueAtTime(0.85, audioCtx.currentTime);
      sfxBusGain.connect(sfxBusFilter);
      sfxBusFilter.connect(masterGain);

      // Music Bus
      musicBusGain = audioCtx.createGain();
      musicBusGain.gain.value = isMusicMuted ? 0 : 0.40;
      musicBusGain.gain.setValueAtTime(isMusicMuted ? 0 : 0.40, audioCtx.currentTime);
      musicBusGain.connect(masterGain);

      // Start procedural music engine
      startMusicEngine();
    }

    if (audioCtx.state === 'suspended') {
      audioCtx.resume().then(() => {
        if (!musicRunning) startMusicEngine();
      }).catch(() => {});
    }
  }

  function setMuted(muted) {
    isMuted = Boolean(muted);
    if (masterGain && audioCtx) {
      masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
      const target = isMuted ? 0 : 0.9;
      masterGain.gain.value = target;
      masterGain.gain.setValueAtTime(target, audioCtx.currentTime);
    }
    return isMuted;
  }

  function toggleMute() {
    return setMuted(!isMuted);
  }

  function isAudioMuted() {
    return isMuted;
  }

  function setMusicMuted(muted) {
    isMusicMuted = Boolean(muted);
    if (musicBusGain && audioCtx) {
      musicBusGain.gain.cancelScheduledValues(audioCtx.currentTime);
      const target = isMusicMuted ? 0 : 0.40;
      musicBusGain.gain.value = target;
      musicBusGain.gain.setValueAtTime(target, audioCtx.currentTime);
    }
    return isMusicMuted;
  }

  function toggleMusic() {
    return setMusicMuted(!isMusicMuted);
  }

  function isMusicMutedState() {
    return isMusicMuted;
  }

  // -------------------------------------------------------------------------
  // Procedural Background Music ("Jazz-Café" Vibe) Engine
  // -------------------------------------------------------------------------
  function startMusicEngine() {
    if (!audioCtx || musicRunning) return;
    musicRunning = true;
    startVinylAir();
    triggerNextChord();
    musicInterval = setInterval(() => {
      triggerNextChord();
    }, 6000);
  }

  function startVinylAir() {
    if (!audioCtx || vinylSource) return;
    try {
      const bufSize = audioCtx.sampleRate * 2;
      const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + white * 0.05;
        b1 = 0.985 * b1 + white * 0.08;
        b2 = 0.950 * b2 + white * 0.15;
        data[i] = (b0 + b1 + b2) * 0.25;
      }
      vinylSource = audioCtx.createBufferSource();
      vinylSource.buffer = buf;
      vinylSource.loop = true;

      const bp = audioCtx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1150, audioCtx.currentTime);
      bp.Q.setValueAtTime(0.85, audioCtx.currentTime);

      const vGain = audioCtx.createGain();
      vGain.gain.setValueAtTime(0.007, audioCtx.currentTime);

      vinylSource.connect(bp);
      bp.connect(vGain);
      vGain.connect(musicBusGain);
      vinylSource.start();
    } catch {}
  }

  function playRhodesNote(freq, time, vel = 0.035) {
    if (!audioCtx || isMusicMuted) return;
    try {
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const filter = audioCtx.createBiquadFilter();
      const gain = audioCtx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(freq, time);

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq * 2, time);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1500, time);
      filter.frequency.exponentialRampToValueAtTime(700, time + 1.0);
      filter.Q.setValueAtTime(1.1, time);

      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(vel, time + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 1.5);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(musicBusGain);

      osc1.start(time);
      osc2.start(time);
      osc1.stop(time + 1.6);
      osc2.stop(time + 0.35);
    } catch {}
  }

  function triggerNextChord() {
    if (!audioCtx || !musicBusGain) return;
    const chord = JAZZ_CHORDS[currentChordIdx];
    currentChordIdx = (currentChordIdx + 1) % JAZZ_CHORDS.length;
    const t = audioCtx.currentTime;
    const chordDur = 6.0;

    // 1. Warm Pad Voices
    [chord.bass, ...chord.notes].forEach((freq) => {
      try {
        const o1 = audioCtx.createOscillator();
        const o2 = audioCtx.createOscillator();
        const filter = audioCtx.createBiquadFilter();
        const g = audioCtx.createGain();

        o1.type = 'sine';
        o1.frequency.setValueAtTime(freq, t);
        o2.type = 'triangle';
        o2.frequency.setValueAtTime(freq * 1.002, t);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(580, t);
        filter.Q.setValueAtTime(0.707, t);

        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.022, t + 1.2);
        g.gain.setValueAtTime(0.020, t + chordDur - 1.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t + chordDur + 0.4);

        o1.connect(filter);
        o2.connect(filter);
        filter.connect(g);
        g.connect(musicBusGain);

        o1.start(t);
        o2.start(t);
        o1.stop(t + chordDur + 0.5);
        o2.stop(t + chordDur + 0.5);
      } catch {}
    });

    // 2. Comping Rhodes notes
    playRhodesNote(chord.notes[1], t + 1.4, 0.024);
    playRhodesNote(chord.notes[3], t + 1.42, 0.022);
    playRhodesNote(chord.notes[0], t + 3.2, 0.020);

    // 3. Optional melodic pentatonic lick (55% chance)
    if (Math.random() < 0.55) {
      const lickTime = t + 4.4;
      const n1 = chord.scale[Math.floor(Math.random() * chord.scale.length)];
      const n2 = chord.scale[Math.floor(Math.random() * chord.scale.length)];
      playRhodesNote(n1, lickTime, 0.026);
      playRhodesNote(n2, lickTime + 0.45, 0.022);
    }
  }

  // -------------------------------------------------------------------------
  // Sound Effects (WebAudio Procedural Synthesis)
  // -------------------------------------------------------------------------

  // 1. Footstep: Sub body drop + carpet scuff
  let lastFootstepTime = 0;
  function playFootstep(sprint = false) {
    if (!audioCtx || isMuted || !sfxBusGain) return;
    const now = performance.now();
    const interval = sprint ? 200 : 320;
    if (now - lastFootstepTime < interval) return;
    lastFootstepTime = now;

    try {
      const t = audioCtx.currentTime;

      // Sub thud
      const osc = audioCtx.createOscillator();
      const oscGain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(sprint ? 135 : 110, t);
      osc.frequency.exponentialRampToValueAtTime(sprint ? 52 : 42, t + 0.045);
      oscGain.gain.setValueAtTime(sprint ? 0.075 : 0.055, t);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.048);
      osc.connect(oscGain);
      oscGain.connect(sfxBusGain);
      osc.start(t);
      osc.stop(t + 0.05);

      // Carpet scuff noise
      const bufSize = Math.floor(audioCtx.sampleRate * 0.04);
      const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const noise = audioCtx.createBufferSource();
      noise.buffer = buf;
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(sprint ? 860 : 620, t);
      filter.Q.setValueAtTime(sprint ? 1.4 : 1.2, t);
      const noiseGain = audioCtx.createGain();
      noiseGain.gain.setValueAtTime(sprint ? 0.052 : 0.038, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(sfxBusGain);
      noise.start(t);
      noise.stop(t + 0.042);
    } catch {}
  }

  // 2. Door creak: Latch tap + hollow wood creak
  function playDoorCreak() {
    if (!audioCtx || isMuted || !sfxBusGain) return;
    try {
      const t = audioCtx.currentTime;

      // Latch tap
      const latch = audioCtx.createOscillator();
      const latchGain = audioCtx.createGain();
      latch.type = 'triangle';
      latch.frequency.setValueAtTime(310, t);
      latch.frequency.exponentialRampToValueAtTime(160, t + 0.014);
      latchGain.gain.setValueAtTime(0.025, t);
      latchGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.015);
      latch.connect(latchGain);
      latchGain.connect(sfxBusGain);
      latch.start(t);
      latch.stop(t + 0.018);

      // Hollow wood creak
      const osc = audioCtx.createOscillator();
      const filter = audioCtx.createBiquadFilter();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(105, t + 0.015);
      osc.frequency.linearRampToValueAtTime(168, t + 0.18);
      osc.frequency.linearRampToValueAtTime(125, t + 0.32);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(420, t + 0.015);
      filter.Q.setValueAtTime(3.6, t + 0.015);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.038, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(sfxBusGain);
      osc.start(t + 0.015);
      osc.stop(t + 0.35);
    } catch {}
  }

  // 3. Bubble pop: Gentle tactile water drop
  function playBubblePop() {
    if (!audioCtx || isMuted || !sfxBusGain) return;
    try {
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const filter = audioCtx.createBiquadFilter();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(280, t);
      osc.frequency.exponentialRampToValueAtTime(680, t + 0.018);
      osc.frequency.linearRampToValueAtTime(540, t + 0.045);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1800, t);

      gain.gain.setValueAtTime(0.055, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(sfxBusGain);

      osc.start(t);
      osc.stop(t + 0.05);
    } catch {}
  }

  // 4. Character blip: Warm vocal typewriter syllable
  let lastBlipTime = 0;
  function playCharBlip() {
    if (!audioCtx || isMuted || !sfxBusGain) return;
    const now = performance.now();
    if (now - lastBlipTime < 22) return;
    lastBlipTime = now;

    try {
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const filter = audioCtx.createBiquadFilter();
      const gain = audioCtx.createGain();

      osc.type = 'triangle';
      const freq = 310 + Math.random() * 70;
      osc.frequency.setValueAtTime(freq, t);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(650, t);

      gain.gain.setValueAtTime(0.016, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.020);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(sfxBusGain);

      osc.start(t);
      osc.stop(t + 0.022);
    } catch {}
  }

  // 5. Chime: Fender Rhodes Cmaj9 chord (C5, E5, G5, D6)
  function playChime() {
    if (!audioCtx || isMuted || !sfxBusGain) return;
    try {
      const t = audioCtx.currentTime;
      const notes = [
        { freq: 523.25, offset: 0.00, gain: 0.040, decay: 0.45 },
        { freq: 659.25, offset: 0.05, gain: 0.040, decay: 0.48 },
        { freq: 783.99, offset: 0.10, gain: 0.045, decay: 0.55 },
        { freq: 1174.66, offset: 0.15, gain: 0.038, decay: 0.68 }
      ];
      notes.forEach((n) => {
        const osc = audioCtx.createOscillator();
        const filter = audioCtx.createBiquadFilter();
        const gain = audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(n.freq, t + n.offset);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1900, t + n.offset);

        gain.gain.setValueAtTime(0.0001, t + n.offset);
        gain.gain.linearRampToValueAtTime(n.gain, t + n.offset + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + n.offset + n.decay);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(sfxBusGain);

        osc.start(t + n.offset);
        osc.stop(t + n.offset + n.decay + 0.02);
      });
    } catch {}
  }

  // 6. Ding: Front desk reception service bell (physical modes)
  function playDing() {
    if (!audioCtx || isMuted || !sfxBusGain) return;
    try {
      const t = audioCtx.currentTime;
      const modes = [
        { freq: 1046.5, gain: 0.070, decay: 0.85 },
        { freq: 1568.0, gain: 0.030, decay: 0.60 },
        { freq: 2093.0, gain: 0.014, decay: 0.32 },
        { freq: 2793.8, gain: 0.005, decay: 0.08 }
      ];
      modes.forEach((m) => {
        const osc = audioCtx.createOscillator();
        const filter = audioCtx.createBiquadFilter();
        const gain = audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(m.freq, t);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2500, t);

        gain.gain.setValueAtTime(m.gain, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + m.decay);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(sfxBusGain);

        osc.start(t);
        osc.stop(t + m.decay + 0.02);
      });
    } catch {}
  }

  // 7. Keyboard clack (lubed mechanical switch thock - soft, low-gain, warm)
  let lastClackTime = 0;
  function playMonitorClack() {
    if (!audioCtx || isMuted || !sfxBusGain) return;
    const now = performance.now();
    if (now - lastClackTime < 60) return;
    lastClackTime = now;

    try {
      const t = audioCtx.currentTime;

      // Layer 1: Resonant thock
      const osc = audioCtx.createOscillator();
      const oscGain = audioCtx.createGain();
      const oscFilter = audioCtx.createBiquadFilter();
      osc.type = 'triangle';
      const baseFreq = 380 + (Math.random() * 70 - 35);
      osc.frequency.setValueAtTime(baseFreq, t);
      osc.frequency.exponentialRampToValueAtTime(220, t + 0.016);
      oscFilter.type = 'lowpass';
      oscFilter.frequency.setValueAtTime(1050, t);
      oscGain.gain.setValueAtTime(0.022, t);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
      osc.connect(oscFilter);
      oscFilter.connect(oscGain);
      oscGain.connect(sfxBusGain);
      osc.start(t);
      osc.stop(t + 0.020);

      // Layer 2: Filtered switch snap
      const bufSize = Math.floor(audioCtx.sampleRate * 0.015);
      const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const noise = audioCtx.createBufferSource();
      noise.buffer = buf;
      const bp = audioCtx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(750 + (Math.random() * 80 - 40), t);
      bp.Q.setValueAtTime(2.4, t);
      const nGain = audioCtx.createGain();
      nGain.gain.setValueAtTime(0.018, t);
      nGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.014);
      noise.connect(bp);
      bp.connect(nGain);
      nGain.connect(sfxBusGain);
      noise.start(t);
      noise.stop(t + 0.016);
    } catch {}
  }

  // 8. Paper / documents rustle: Dual-burst bandpass noise
  function playPaperRustle() {
    if (!audioCtx || isMuted || !sfxBusGain) return;
    try {
      const t = audioCtx.currentTime;
      [0, 0.038].forEach((delay, idx) => {
        const dur = idx === 0 ? 0.065 : 0.085;
        const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.setValueAtTime(idx === 0 ? 1.3 : 1.1, t + delay);
        filter.frequency.setValueAtTime(idx === 0 ? 1700 : 1300, t + delay);
        filter.frequency.exponentialRampToValueAtTime(idx === 0 ? 1200 : 880, t + delay + dur);

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.setValueAtTime(0.0001, t + delay);
        gain.gain.linearRampToValueAtTime(idx === 0 ? 0.035 : 0.040, t + delay + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);

        src.connect(filter);
        filter.connect(gain);
        gain.connect(sfxBusGain);
        src.start(t + delay);
        src.stop(t + delay + dur + 0.01);
      });
    } catch {}
  }

  // 9. Coffee machine gurgle: Steam wash + percolator bubbles
  function playCoffeeGurgle() {
    if (!audioCtx || isMuted || !sfxBusGain) return;
    try {
      const t = audioCtx.currentTime;

      // Steam wash
      const sBuf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * 0.75), audioCtx.sampleRate);
      const sd = sBuf.getChannelData(0);
      for (let i = 0; i < sd.length; i++) sd[i] = Math.random() * 2 - 1;
      const steam = audioCtx.createBufferSource();
      steam.buffer = sBuf;
      const bp = audioCtx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1400, t);
      bp.Q.setValueAtTime(1.4, t);
      const steamGain = audioCtx.createGain();
      steamGain.gain.setValueAtTime(0.0001, t);
      steamGain.gain.linearRampToValueAtTime(0.012, t + 0.12);
      steamGain.gain.setValueAtTime(0.012, t + 0.45);
      steamGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
      steam.connect(bp);
      bp.connect(steamGain);
      steamGain.connect(sfxBusGain);
      steam.start(t);
      steam.stop(t + 0.76);

      // Cascade of percolator bubbles
      for (let i = 0; i < 6; i++) {
        const dt = t + i * 0.10 + (Math.random() * 0.03 - 0.015);
        const bOsc = audioCtx.createOscillator();
        const bGain = audioCtx.createGain();
        bOsc.type = 'sine';
        const startF = 190 + Math.random() * 90;
        bOsc.frequency.setValueAtTime(startF, dt);
        bOsc.frequency.exponentialRampToValueAtTime(startF + 170, dt + 0.035);
        bGain.gain.setValueAtTime(0.032, dt);
        bGain.gain.exponentialRampToValueAtTime(0.0001, dt + 0.042);
        bOsc.connect(bGain);
        bGain.connect(sfxBusGain);
        bOsc.start(dt);
        bOsc.stop(dt + 0.048);
      }
    } catch {}
  }

  // 10. New box jingle: Warm 4-note jazz fanfare (G4, C5, E5, A5)
  function playNewBoxJingle() {
    if (!audioCtx || isMuted || !sfxBusGain) return;
    try {
      const t = audioCtx.currentTime;
      const notes = [
        { freq: 392.00, offset: 0.00, decay: 0.28, gain: 0.048 },
        { freq: 523.25, offset: 0.09, decay: 0.28, gain: 0.048 },
        { freq: 659.25, offset: 0.18, decay: 0.32, gain: 0.052 },
        { freq: 880.00, offset: 0.28, decay: 0.78, gain: 0.050 }
      ];
      notes.forEach((n) => {
        const osc = audioCtx.createOscillator();
        const filter = audioCtx.createBiquadFilter();
        const gain = audioCtx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(n.freq, t + n.offset);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1400, t + n.offset);

        gain.gain.setValueAtTime(0.0001, t + n.offset);
        gain.gain.linearRampToValueAtTime(n.gain, t + n.offset + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + n.offset + n.decay);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(sfxBusGain);

        osc.start(t + n.offset);
        osc.stop(t + n.offset + n.decay + 0.02);
      });
    } catch {}
  }

  // 11. UI tick / Clock tick: Wooden mantel tick
  function playUiTick() {
    if (!audioCtx || isMuted || !sfxBusGain) return;
    try {
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const filter = audioCtx.createBiquadFilter();
      const gain = audioCtx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(430, t);
      osc.frequency.exponentialRampToValueAtTime(290, t + 0.012);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1100, t);

      gain.gain.setValueAtTime(0.025, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(sfxBusGain);

      osc.start(t);
      osc.stop(t + 0.020);
    } catch {}
  }

  global.sfx = {
    get ctx() {
      if (!audioCtx) initAudio();
      return audioCtx;
    },
    get masterGain() {
      return masterGain;
    },
    get musicGain() {
      return musicBusGain;
    },
    get sfxGain() {
      return sfxBusGain;
    },
    init: initAudio,
    setMuted,
    toggleMute,
    isMuted: isAudioMuted,
    setMusicMuted,
    toggleMusic,
    isMusicMuted: isMusicMutedState,
    playFootstep,
    playDoorCreak,
    playBubblePop,
    playCharBlip,
    playChime,
    playDing,
    playMonitorClack,
    playPaperRustle,
    playCoffeeGurgle,
    playNewBoxJingle,
    playUiTick
  };
})(typeof window !== 'undefined' ? window : global);
