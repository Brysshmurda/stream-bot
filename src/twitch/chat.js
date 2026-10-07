import tmi from 'tmi.js';
import { config } from '../config.js';
import { tracker } from '../tracker/index.js';
import { getCurrentStream, getFollowAge } from './api.js';
import { banUser, unbanUser, timeoutUser, clearChat, updateChatSettings, getUserByName } from './moderation.js';
import { checkMessage, permitUser } from './automod.js';
import { strikeQueries, bannedWordQueries, getSetting } from '../db/index.js';

const COOLDOWNS = new Map();
const COOLDOWN_MS = 5000;

function onCooldown(key) {
  const last = COOLDOWNS.get(key) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return true;
  COOLDOWNS.set(key, Date.now());
  return false;
}

function isMod(tags) {
  return tags.mod || tags['user-type'] === 'mod' || tags.badges?.broadcaster === '1';
}

function isBroadcaster(tags) {
  return tags.badges?.broadcaster === '1';
}

function parseSeconds(str, defaultSecs = 300) {
  if (!str) return defaultSecs;
  const n = parseInt(str, 10);
  if (isNaN(n)) return defaultSecs;
  if (str.endsWith('h')) return n * 3600;
  if (str.endsWith('m')) return n * 60;
  return n;
}

export function startChatBot() {
  const username = config.twitch.botUsername || config.twitch.channelName;
  const password = config.twitch.botToken || config.twitch.accessToken;

  const client = new tmi.Client({
    identity: { username, password: `oauth:${password.replace(/^oauth:/, '')}` },
    channels: [config.twitch.channelName],
    connection: { reconnect: true, secure: true },
  });

  client.on('message', async (channel, tags, message, self) => {
    if (self) return;

    const userId = tags['user-id'];
    const displayName = tags['display-name'] || tags.username;
    const messageId = tags.id;
    const mod = isMod(tags);
    const broadcaster = isBroadcaster(tags);

    // ── Auto-mod check (non-mod messages) ──────────────────────────────────
    if (!mod && !broadcaster) {
      await checkMessage({
        userId,
        username: displayName,
        message,
        messageId,
        isMod: mod,
        isBroadcaster: broadcaster,
        tags,
      });
    }

    if (!message.trim().startsWith('!')) return;

    const [rawCmd, ...args] = message.trim().split(/\s+/);
    const cmd = rawCmd.toLowerCase();
    const say = (msg) => client.say(channel, msg);

    // ── Public commands ─────────────────────────────────────────────────────

    switch (cmd) {
      case '!game': {
        if (onCooldown(cmd)) break;
        const stream = await getCurrentStream();
        if (stream) say(`🎮 Currently playing: ${stream.gameName}`);
        else say(`${displayName}, the stream is currently offline.`);
        break;
      }

      case '!uptime': {
        if (onCooldown(cmd)) break;
        const cur = tracker.currentStream;
        if (!cur) { say(`${displayName}, the stream is offline.`); break; }
        const secs = Math.floor((Date.now() - new Date(cur.startedAt)) / 1000);
        say(`⏱ Live for ${tracker.formatDuration(secs)}`);
        break;
      }

      case '!viewers': {
        if (onCooldown(cmd)) break;
        const stream = await getCurrentStream();
        if (stream) say(`👀 Viewers: ${stream.viewers.toLocaleString()}`);
        else say(`Stream is offline.`);
        break;
      }

      case '!followage': {
        if (onCooldown(`followage_${userId}`)) break;
        const date = await getFollowAge(userId);
        if (date) {
          const days = Math.floor((Date.now() - new Date(date)) / 86_400_000);
          const y = Math.floor(days / 365), mo = Math.floor((days % 365) / 30), d = days % 30;
          let age = '';
          if (y) age += `${y}y `;
          if (mo) age += `${mo}mo `;
          age += `${d}d`;
          say(`❤️ ${displayName} has followed for ${age.trim()}`);
        } else {
          say(`${displayName} is not following.`);
        }
        break;
      }

      case '!stats': {
        if (onCooldown(cmd)) break;
        const recent = tracker.getRecentStreams(1);
        if (!recent.length) { say('No stream data yet!'); break; }
        const s = recent[0];
        const avg = s.viewer_samples > 0 ? Math.round(s.viewer_total / s.viewer_samples) : 0;
        say(`📊 Last stream: ${tracker.formatDuration(s.duration_seconds)} | Peak: ${s.peak_viewers} | Avg: ${avg}`);
        break;
      }

      case '!title': {
        if (onCooldown(cmd)) break;
        const stream = await getCurrentStream();
        if (stream) say(`📺 ${stream.title}`);
        else say(`Stream is offline.`);
        break;
      }

      case '!commands': {
        if (onCooldown(cmd)) break;
        const modCmds = mod ? ' | MOD: !ban !unban !timeout !purge !warn !slow !subonly !emoteonly !clear !permit' : '';
        say(`📋 !game !uptime !viewers !followage !stats !title${modCmds}`);
        break;
      }

      // ── Mod-only commands ───────────────────────────────────────────────

      case '!ban': {
        if (!mod) break;
        const target = args[0];
        if (!target) { say(`Usage: !ban <username> [reason]`); break; }
        const reason = args.slice(1).join(' ') || 'No reason given';
        try {
          const user = await getUserByName(target);
          if (!user) { say(`User ${target} not found.`); break; }
          await banUser(user.id, reason);
          say(`✅ ${user.displayName} has been banned. Reason: ${reason}`);
          tracker.emit('modAction', { action: 'ban', target: user.displayName, reason, moderator: displayName });
        } catch (e) { say(`❌ Could not ban ${target}: ${e.message}`); }
        break;
      }

      case '!unban': {
        if (!mod) break;
        const target = args[0];
        if (!target) { say(`Usage: !unban <username>`); break; }
        try {
          const user = await getUserByName(target);
          if (!user) { say(`User ${target} not found.`); break; }
          await unbanUser(user.id);
          say(`✅ ${user.displayName} has been unbanned.`);
          tracker.emit('modAction', { action: 'unban', target: user.displayName, reason: '', moderator: displayName });
        } catch (e) { say(`❌ Could not unban ${target}: ${e.message}`); }
        break;
      }

      case '!timeout': {
        if (!mod) break;
        const target = args[0];
        if (!target) { say(`Usage: !timeout <username> [duration] [reason]`); break; }
        const duration = parseSeconds(args[1], 300);
        const reason = args.slice(2).join(' ') || 'No reason given';
        try {
          const user = await getUserByName(target);
          if (!user) { say(`User ${target} not found.`); break; }
          await timeoutUser(user.id, duration, reason);
          say(`✅ ${user.displayName} timed out for ${tracker.formatDuration(duration)}. Reason: ${reason}`);
          tracker.emit('modAction', { action: 'timeout', target: user.displayName, reason: `${tracker.formatDuration(duration)} - ${reason}`, moderator: displayName });
        } catch (e) { say(`❌ Could not timeout ${target}: ${e.message}`); }
        break;
      }

      case '!purge': {
        if (!mod) break;
        const target = args[0];
        if (!target) { say(`Usage: !purge <username>`); break; }
        try {
          const user = await getUserByName(target);
          if (!user) { say(`User ${target} not found.`); break; }
          await timeoutUser(user.id, 1, 'purged by mod');
          say(`🧹 ${user.displayName} purged.`);
        } catch (e) { say(`❌ ${e.message}`); }
        break;
      }

      case '!warn': {
        if (!mod) break;
        const target = args[0];
        if (!target) { say(`Usage: !warn <username> [reason]`); break; }
        const reason = args.slice(1).join(' ') || 'No reason given';
        try {
          const user = await getUserByName(target);
          if (!user) { say(`User ${target} not found.`); break; }
          strikeQueries().addStrike.run({ twitch_user_id: user.id, twitch_username: user.name, reason });
          const row = strikeQueries().getStrikes.get(user.id);
          say(`⚠️ ${user.displayName} warned (${row.strikes}/3): ${reason}`);
          tracker.emit('modAction', { action: 'warn', target: user.displayName, reason, moderator: displayName });
        } catch (e) { say(`❌ ${e.message}`); }
        break;
      }

      case '!permit': {
        if (!mod) break;
        const target = args[0];
        if (!target) { say(`Usage: !permit <username>`); break; }
        try {
          const user = await getUserByName(target);
          if (!user) { say(`User ${target} not found.`); break; }
          permitUser(user.id, 60_000);
          say(`✅ ${user.displayName} may post a link in the next 60 seconds.`);
        } catch (e) { say(`❌ ${e.message}`); }
        break;
      }

      case '!slow': {
        if (!mod) break;
        const secs = parseInt(args[0], 10) || 30;
        try {
          await updateChatSettings({ slowModeEnabled: true, slowModeDelay: secs });
          say(`🐢 Slow mode enabled (${secs}s)`);
        } catch (e) { say(`❌ ${e.message}`); }
        break;
      }

      case '!slowoff': {
        if (!mod) break;
        try {
          await updateChatSettings({ slowModeEnabled: false });
          say(`⚡ Slow mode disabled.`);
        } catch (e) { say(`❌ ${e.message}`); }
        break;
      }

      case '!subonly': {
        if (!mod) break;
        try {
          await updateChatSettings({ subscriberOnlyModeEnabled: true });
          say(`⭐ Subscriber-only mode ON.`);
        } catch (e) { say(`❌ ${e.message}`); }
        break;
      }

      case '!suboff': {
        if (!mod) break;
        try {
          await updateChatSettings({ subscriberOnlyModeEnabled: false });
          say(`✅ Subscriber-only mode OFF.`);
        } catch (e) { say(`❌ ${e.message}`); }
        break;
      }

      case '!emoteonly': {
        if (!mod) break;
        try {
          await updateChatSettings({ emoteModeEnabled: true });
          say(`😊 Emote-only mode ON.`);
        } catch (e) { say(`❌ ${e.message}`); }
        break;
      }

      case '!emoteoff': {
        if (!mod) break;
        try {
          await updateChatSettings({ emoteModeEnabled: false });
          say(`✅ Emote-only mode OFF.`);
        } catch (e) { say(`❌ ${e.message}`); }
        break;
      }

      case '!clear': {
        if (!mod) break;
        try {
          await clearChat();
          say(`🧹 Chat cleared.`);
        } catch (e) { say(`❌ ${e.message}`); }
        break;
      }

      case '!addword': {
        if (!broadcaster) break;
        const word = args[0]?.toLowerCase();
        const action = ['timeout', 'ban', 'delete'].includes(args[1]) ? args[1] : 'delete';
        const duration = parseInt(args[2], 10) || 300;
        if (!word) { say(`Usage: !addword <word> [delete|timeout|ban] [timeout_seconds]`); break; }
        bannedWordQueries().addWord.run({ word, action, duration, added_by: displayName });
        say(`✅ Added "${word}" to banned words (action: ${action})`);
        break;
      }

      case '!removeword': {
        if (!broadcaster) break;
        const word = args[0]?.toLowerCase();
        if (!word) { say(`Usage: !removeword <word>`); break; }
        bannedWordQueries().removeWord.run(word);
        say(`✅ Removed "${word}" from banned words.`);
        break;
      }
    }
  });

  client.connect().then(() => {
    console.log(`[chat] Connected to #${config.twitch.channelName}`);
  }).catch(err => {
    console.error('[chat] Connection error:', err.message);
  });

  return client;
}
