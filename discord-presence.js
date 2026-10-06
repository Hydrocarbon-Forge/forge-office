// discord-presence.js — Discord REST API presence poller
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');

const GUILD_ID = '1555057219622408275';
const TARGET_CHANNEL_NAMES = ['c6-home', 'c6-nathan', 'c6-gavin', 'general'];
const NATHAN_DISCORD_ID = '848334458453229659';
const GAVIN_DISCORD_ID = '743939830798352436';
const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

class DiscordPresenceService {
  constructor() {
    this.token = this.resolveBotToken();
    this.channelIds = null;
    this.pollInterval = null;
    this.lastMessageAt = {
      nathan: null,
      gavin: null
    };
  }

  resolveBotToken() {
    if (process.env.DISCORD_BOT_TOKEN) {
      return process.env.DISCORD_BOT_TOKEN.trim();
    }
    const envPath = path.join(os.homedir(), '.hermes', '.env');
    try {
      if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, 'utf8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('#')) continue;
          const match = trimmed.match(/^DISCORD_BOT_TOKEN\s*=\s*(.*)$/);
          if (match) {
            let val = match[1].trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            return val;
          }
        }
      }
    } catch (err) {
      console.warn('[discord-presence] Could not read ~/.hermes/.env:', err.message);
    }
    return null;
  }

  requestJson(pathUrl, retries = 0) {
    return new Promise((resolve, reject) => {
      if (!this.token) {
        return reject(new Error('Missing DISCORD_BOT_TOKEN'));
      }

      const req = https.request(
        {
          hostname: 'discord.com',
          path: pathUrl,
          method: 'GET',
          headers: {
            'Authorization': `Bot ${this.token}`,
            'User-Agent': 'ForgeOffice/1.0.0 (https://hydrocarbonforge.com)'
          }
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', async () => {
            if (res.statusCode === 200) {
              try {
                resolve(JSON.parse(body));
              } catch (e) {
                reject(new Error(`JSON parse error: ${e.message}`));
              }
            } else if (res.statusCode === 429) {
              if (retries >= 4) {
                return reject(new Error(`Discord 429 rate limit reached maximum retries (4)`));
              }
              let retryAfter = 2.0;
              try {
                const parsed = JSON.parse(body);
                if (parsed.retry_after) retryAfter = Number(parsed.retry_after);
              } catch {}
              const waitMs = Math.min(10000, Math.max(500, Math.ceil(retryAfter * 1000)));
              console.warn(`[discord-presence] 429 rate limited, waiting ${waitMs}ms (retry ${retries + 1}/4)`);
              await new Promise((r) => setTimeout(r, waitMs));
              try {
                const result = await this.requestJson(pathUrl, retries + 1);
                resolve(result);
              } catch (err) {
                reject(err);
              }
            } else {
              reject(new Error(`Discord API status ${res.statusCode}: ${body.substring(0, 100)}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.end();
    });
  }

  async resolveChannels() {
    if (this.channelIds) return this.channelIds;
    try {
      const channels = await this.requestJson(`/api/v10/guilds/${GUILD_ID}/channels`);
      const matched = channels.filter(
        (c) => c.type === 0 && TARGET_CHANNEL_NAMES.includes(c.name)
      );
      this.channelIds = matched.map((c) => ({ id: c.id, name: c.name }));
      return this.channelIds;
    } catch (err) {
      console.warn('[discord-presence] Channel resolution error:', err.message);
      return [];
    }
  }

  async pollMessages() {
    if (!this.token) {
      return;
    }

    try {
      const channels = await this.resolveChannels();
      if (!channels || channels.length === 0) return;

      for (const ch of channels) {
        try {
          const messages = await this.requestJson(`/api/v10/channels/${ch.id}/messages?limit=50`);
          if (Array.isArray(messages)) {
            for (const msg of messages) {
              const authorId = msg.author && msg.author.id;
              if (authorId === NATHAN_DISCORD_ID || authorId === GAVIN_DISCORD_ID) {
                const ts = new Date(msg.timestamp).getTime();
                if (authorId === NATHAN_DISCORD_ID) {
                  if (!this.lastMessageAt.nathan || ts > this.lastMessageAt.nathan) {
                    this.lastMessageAt.nathan = ts;
                  }
                } else if (authorId === GAVIN_DISCORD_ID) {
                  if (!this.lastMessageAt.gavin || ts > this.lastMessageAt.gavin) {
                    this.lastMessageAt.gavin = ts;
                  }
                }
              }
            }
          }
        } catch (err) {
          console.warn(`[discord-presence] Error polling messages for channel ${ch.name}:`, err.message);
        }
      }
    } catch (err) {
      console.warn('[discord-presence] Error in pollMessages pass:', err.message);
    }
  }

  getPresence() {
    const now = Date.now();
    const computeFor = (ts) => {
      if (!ts) {
        return {
          active: false,
          last_message_at: null,
          last_message_age_m: null
        };
      }
      const ageMs = Math.max(0, now - ts);
      const ageM = parseFloat((ageMs / 60000).toFixed(1));
      return {
        active: ageMs <= ACTIVE_WINDOW_MS,
        last_message_at: ts,
        last_message_age_m: ageM
      };
    };

    return {
      nathan: computeFor(this.lastMessageAt.nathan),
      gavin: computeFor(this.lastMessageAt.gavin)
    };
  }

  start(intervalMs = 60000) {
    if (!this.token) {
      console.warn('[discord-presence] Bot token not found, running with degraded presence');
      return;
    }

    // Run first pass immediately
    this.pollMessages().catch(() => {});

    // Set recurring timer
    this.pollInterval = setInterval(() => {
      this.pollMessages().catch(() => {});
    }, intervalMs);

    this.pollInterval.unref();
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}

// Singleton instance
const service = new DiscordPresenceService();

// Handle CLI invocation
if (require.main === module) {
  const args = process.argv.slice(2);
  const isOnce = args.includes('--once');

  if (isOnce) {
    (async () => {
      if (!service.token) {
        console.error('ERROR: DISCORD_BOT_TOKEN could not be resolved from ~/.hermes/.env or environment.');
        process.exit(1);
      }

      console.log('Resolving Discord channels...');
      const channels = await service.resolveChannels();
      console.log(`Matched ${channels.length} target channels: ${channels.map((c) => c.name).join(', ')}`);

      console.log('Fetching recent channel messages (dry run)...');
      await service.pollMessages();

      const pres = service.getPresence();
      console.log('\n--- Discord Presence Status (Dry Run) ---');
      console.log(`Nathan:`);
      console.log(`  lastMessageAt age : ${pres.nathan.last_message_age_m !== null ? pres.nathan.last_message_age_m + ' minutes' : 'null'}`);
      console.log(`  active (<= 5min)  : ${pres.nathan.active}`);
      console.log(`Gavin:`);
      console.log(`  lastMessageAt age : ${pres.gavin.last_message_age_m !== null ? pres.gavin.last_message_age_m + ' minutes' : 'null'}`);
      console.log(`  active (<= 5min)  : ${pres.gavin.active}`);
      console.log('-----------------------------------------\n');

      process.exit(0);
    })().catch((err) => {
      console.error('FAIL: Dry run encountered error:', err.message);
      process.exit(1);
    });
  } else {
    service.start();
  }
}

module.exports = {
  DiscordPresenceService,
  discordPresenceService: service
};
