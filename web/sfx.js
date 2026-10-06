// web/sfx.js — Procedural WebAudio sound effects (no external audio files)
(function (global) {
  let audioCtx = null;
  let masterGain = null;
  let ambientGain = null;
  let ambientSource = null;
  let isMuted = false;

  function initAudio() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    audioCtx = new AudioContextClass();
    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(isMuted ? 0 : 0.35, audioCtx.currentTime);
    masterGain.connect(audioCtx.destination);

    startAmbientHum();
  }

  function setMuted(muted) {
    isMuted = muted;
    if (masterGain && audioCtx) {
      masterGain.gain.setValueAtTime(isMuted ? 0 : 0.35, audioCtx.currentTime);
    }
    return isMuted;
  }

  function toggleMute() {
    return setMuted(!isMuted);
  }

  function isAudioMuted() {
    return isMuted;
  }

  // 1. Footstep: filtered noise click
  let lastFootstepTime = 0;
  function playFootstep(sprint = false) {
    if (!audioCtx || isMuted) return;
    const now = performance.now();
    const interval = sprint ? 200 : 320;
    if (now - lastFootstepTime < interval) return;
    lastFootstepTime = now;

    try {
      const t = audioCtx.currentTime;
      const bufferSize = audioCtx.sampleRate * 0.04;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      }

      const noise = audioCtx.createBufferSource();
      noise.buffer = buffer;

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(sprint ? 950 : 800, t);
      filter.Q.setValueAtTime(3.0, t);

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);

      noise.start(t);
      noise.stop(t + 0.04);
    } catch {}
  }

  // 2. Door creak: sawtooth glide
  function playDoorCreak() {
    if (!audioCtx || isMuted) return;
    try {
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const filter = audioCtx.createBiquadFilter();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.linearRampToValueAtTime(380, t + 0.22);
      osc.frequency.linearRampToValueAtTime(180, t + 0.35);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(600, t);

      gain.gain.setValueAtTime(0.06, t);
      gain.gain.linearRampToValueAtTime(0.09, t + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);

      osc.start(t);
      osc.stop(t + 0.4);
    } catch {}
  }

  // 3. Bubble pop: fast frequency sweep
  function playBubblePop() {
    if (!audioCtx || isMuted) return;
    try {
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(350, t);
      osc.frequency.exponentialRampToValueAtTime(900, t + 0.06);

      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(t);
      osc.stop(t + 0.08);
    } catch {}
  }

  // 4. Character blip for typewriter
  let lastBlipTime = 0;
  function playCharBlip() {
    if (!audioCtx || isMuted) return;
    const now = performance.now();
    if (now - lastBlipTime < 20) return;
    lastBlipTime = now;

    try {
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'triangle';
      const freq = 900 + Math.random() * 200;
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.04, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(t);
      osc.stop(t + 0.03);
    } catch {}
  }

  // 5. Chime: sparkling equip chord
  function playChime() {
    if (!audioCtx || isMuted) return;
    try {
      const t = audioCtx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t + idx * 0.06);

        gain.gain.setValueAtTime(0, t);
        gain.gain.setValueAtTime(0.12, t + idx * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.06 + 0.45);

        osc.connect(gain);
        gain.connect(masterGain);

        osc.start(t + idx * 0.06);
        osc.stop(t + idx * 0.06 + 0.5);
      });
    } catch {}
  }

  // 6. Ding: front desk reception service bell
  function playDing() {
    if (!audioCtx || isMuted) return;
    try {
      const t = audioCtx.currentTime;
      [1760, 3520].forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);

        gain.gain.setValueAtTime(idx === 0 ? 0.16 : 0.06, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);

        osc.connect(gain);
        gain.connect(masterGain);

        osc.start(t);
        osc.stop(t + 0.75);
      });
    } catch {}
  }

  // 7. Ambient office hum (low-pass filtered noise + 60Hz hum)
  function startAmbientHum() {
    if (!audioCtx || ambientSource) return;
    try {
      const bufferSize = audioCtx.sampleRate * 2;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      ambientSource = audioCtx.createBufferSource();
      ambientSource.buffer = buffer;
      ambientSource.loop = true;

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(160, audioCtx.currentTime);

      ambientGain = audioCtx.createGain();
      ambientGain.gain.setValueAtTime(0.03, audioCtx.currentTime);

      ambientSource.connect(filter);
      filter.connect(ambientGain);
      ambientGain.connect(masterGain);

      ambientSource.start();
    } catch {}
  }

  // 8. Monitor clack (mechanical keyboard switch click)
  let lastClackTime = 0;
  function playMonitorClack() {
    if (!audioCtx || isMuted) return;
    const now = performance.now();
    if (now - lastClackTime < 70) return;
    lastClackTime = now;

    try {
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(1400 + Math.random() * 600, t);
      osc.frequency.exponentialRampToValueAtTime(300, t + 0.03);

      gain.gain.setValueAtTime(0.04, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(t);
      osc.stop(t + 0.04);
    } catch {}
  }

  // 9. Coffee machine gurgle
  function playCoffeeGurgle() {
    if (!audioCtx || isMuted) return;
    try {
      const t = audioCtx.currentTime;
      for (let i = 0; i < 4; i++) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'sine';
        const startFreq = 220 + Math.random() * 120;
        osc.frequency.setValueAtTime(startFreq, t + i * 0.07);
        osc.frequency.exponentialRampToValueAtTime(startFreq + 180, t + i * 0.07 + 0.06);

        gain.gain.setValueAtTime(0.06, t + i * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.065);

        osc.connect(gain);
        gain.connect(masterGain);

        osc.start(t + i * 0.07);
        osc.stop(t + i * 0.07 + 0.08);
      }
    } catch {}
  }

  // 10. New box jingle (3-note ascending fanfare: C5, E5, G5)
  function playNewBoxJingle() {
    if (!audioCtx || isMuted) return;
    try {
      const t = audioCtx.currentTime;
      const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t + idx * 0.12);

        gain.gain.setValueAtTime(0, t);
        gain.gain.setValueAtTime(0.18, t + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.12 + (idx === 2 ? 0.6 : 0.3));

        osc.connect(gain);
        gain.connect(masterGain);

        osc.start(t + idx * 0.12);
        osc.stop(t + idx * 0.12 + 0.7);
      });
    } catch {}
  }

  // 11. UI tick
  function playUiTick() {
    if (!audioCtx || isMuted) return;
    try {
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, t);

      gain.gain.setValueAtTime(0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.02);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(t);
      osc.stop(t + 0.025);
    } catch {}
  }

  global.sfx = {
    init: initAudio,
    setMuted,
    toggleMute,
    isMuted: isAudioMuted,
    playFootstep,
    playDoorCreak,
    playBubblePop,
    playCharBlip,
    playChime,
    playDing,
    playMonitorClack,
    playCoffeeGurgle,
    playNewBoxJingle,
    playUiTick
  };
})(typeof window !== 'undefined' ? window : global);
