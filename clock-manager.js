// clock-manager.js — Profile persistence, presence, and clock-in/out tracking
const fs = require('node:fs');
const path = require('node:path');

class ClockManager {
  constructor(clockFile = null, profilesFile = null) {
    this.clockFile = clockFile || process.env.CLOCK_FILE || path.join(__dirname, 'data', 'clock.json');
    this.profilesFile = profilesFile || process.env.PROFILES_FILE || path.join(__dirname, 'data', 'profiles.json');
    this.activeSockets = {}; // profileKey -> Set(clientId)
    this.sessionHadPeer = {}; // profileKey -> boolean

    this.ensureDirs();
    this.clockData = this.loadClockData();
    this.profilesData = this.loadProfilesData();
  }

  ensureDirs() {
    const clockDir = path.dirname(this.clockFile);
    if (!fs.existsSync(clockDir)) {
      fs.mkdirSync(clockDir, { recursive: true });
    }
    const profDir = path.dirname(this.profilesFile);
    if (!fs.existsSync(profDir)) {
      fs.mkdirSync(profDir, { recursive: true });
    }
  }

  loadClockData() {
    try {
      if (fs.existsSync(this.clockFile)) {
        const raw = fs.readFileSync(this.clockFile, 'utf8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.warn('[clock-manager] Could not read clock.json, using defaults:', err.message);
    }
    return {
      nathan: {
        clocked_in_since: null,
        total_ms: 0,
        sessions: 0,
        longest_ms: 0,
        sessions_with: 0
      },
      gavin: {
        clocked_in_since: null,
        total_ms: 0,
        sessions: 0,
        longest_ms: 0,
        sessions_with: 0
      }
    };
  }

  saveClockData() {
    try {
      const tmpPath = `${this.clockFile}.${Date.now()}.${Math.random().toString(36).substring(2, 6)}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.clockData, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.clockFile);
    } catch (err) {
      console.error('[clock-manager] Failed to save clock.json atomically:', err);
    }
  }

  loadProfilesData() {
    try {
      if (fs.existsSync(this.profilesFile)) {
        const raw = fs.readFileSync(this.profilesFile, 'utf8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.warn('[clock-manager] Could not read profiles.json, using defaults:', err.message);
    }
    return {};
  }

  saveProfilesData() {
    try {
      const tmpPath = `${this.profilesFile}.${Date.now()}.${Math.random().toString(36).substring(2, 6)}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.profilesData, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.profilesFile);
    } catch (err) {
      console.error('[clock-manager] Failed to save profiles.json atomically:', err);
    }
  }

  upsertProfile(data) {
    if (!data || typeof data !== 'object') return;
    const key = (data.profile || data.name || 'guest').toLowerCase();
    this.profilesData[key] = {
      profile: key,
      name: data.name || (key.charAt(0).toUpperCase() + key.slice(1)),
      color: data.color || (data.cosmetics && data.cosmetics.color) || 'coral',
      hat: data.hat || (data.cosmetics && data.cosmetics.hat) || 'none',
      visor: data.visor || (data.cosmetics && (data.cosmetics.visor || data.cosmetics.face)) || 'classic',
      face: data.face || (data.cosmetics && data.cosmetics.face) || 'classic',
      trail: data.trail || (data.cosmetics && data.cosmetics.trail) || 'none',
      lastSeen: Date.now()
    };
    this.saveProfilesData();
    return this.profilesData[key];
  }

  clockIn(profileKey, clientId, now = Date.now()) {
    if (!profileKey) return;
    const prof = profileKey.toLowerCase();

    if (!this.clockData[prof]) {
      this.clockData[prof] = {
        clocked_in_since: null,
        total_ms: 0,
        sessions: 0,
        longest_ms: 0,
        sessions_with: 0
      };
    }

    if (!this.activeSockets[prof]) {
      this.activeSockets[prof] = new Set();
    }

    const wasOnline = this.activeSockets[prof].size > 0;
    this.activeSockets[prof].add(clientId);

    if (!wasOnline) {
      // First connection -> Clock in transition
      this.clockData[prof].clocked_in_since = now;
      this.clockData[prof].sessions = (this.clockData[prof].sessions || 0) + 1;

      // Check if any other profile is online
      let otherProfileOnline = false;
      for (const [otherProf, set] of Object.entries(this.activeSockets)) {
        if (otherProf !== prof && set.size > 0) {
          otherProfileOnline = true;
          if (!this.sessionHadPeer[otherProf]) {
            if (!this.clockData[otherProf]) {
              this.clockData[otherProf] = { clocked_in_since: null, total_ms: 0, sessions: 0, longest_ms: 0, sessions_with: 0 };
            }
            this.clockData[otherProf].sessions_with = (this.clockData[otherProf].sessions_with || 0) + 1;
            this.sessionHadPeer[otherProf] = true;
          }
        }
      }

      if (otherProfileOnline) {
        this.clockData[prof].sessions_with = (this.clockData[prof].sessions_with || 0) + 1;
        this.sessionHadPeer[prof] = true;
      } else {
        this.sessionHadPeer[prof] = false;
      }

      this.saveClockData();
    }
  }

  clockOut(profileKey, clientId, now = Date.now()) {
    if (!profileKey) return;
    const prof = profileKey.toLowerCase();

    if (!this.activeSockets[prof]) return;
    this.activeSockets[prof].delete(clientId);

    if (this.activeSockets[prof].size === 0) {
      // Last connection left -> Clock out transition
      if (this.clockData[prof] && this.clockData[prof].clocked_in_since) {
        const duration = Math.max(0, now - this.clockData[prof].clocked_in_since);
        this.clockData[prof].total_ms = (this.clockData[prof].total_ms || 0) + duration;
        this.clockData[prof].longest_ms = Math.max(this.clockData[prof].longest_ms || 0, duration);
        this.clockData[prof].clocked_in_since = null;
      }
      this.sessionHadPeer[prof] = false;
      this.saveClockData();
    }
  }

  getPresenceAndStats(discordPresence = null) {
    const online = [];
    for (const [prof, set] of Object.entries(this.activeSockets)) {
      if (set.size > 0 && this.clockData[prof] && this.clockData[prof].clocked_in_since) {
        online.push({
          profile: prof,
          since: this.clockData[prof].clocked_in_since
        });
      }
    }

    const formatStats = (entry) => {
      if (!entry) {
        return {
          total_h: '0.0h',
          total_ms: 0,
          sessions: 0,
          longest_h: '0.0h',
          longest_ms: 0,
          sessions_with: 0
        };
      }
      const toH = (ms) => (ms / (1000 * 60 * 60)).toFixed(1) + 'h';
      return {
        total_h: toH(entry.total_ms || 0),
        total_ms: entry.total_ms || 0,
        sessions: entry.sessions || 0,
        longest_h: toH(entry.longest_ms || 0),
        longest_ms: entry.longest_ms || 0,
        sessions_with: entry.sessions_with || 0
      };
    };

    const stats = {};
    // Ensure at least nathan and gavin are present
    const profiles = new Set(['nathan', 'gavin', ...Object.keys(this.clockData)]);
    for (const p of profiles) {
      stats[p] = formatStats(this.clockData[p]);
    }

    return {
      online,
      stats,
      discord: discordPresence || {}
    };
  }
}

module.exports = { ClockManager };
