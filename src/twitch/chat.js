import tmi from 'tmi.js';
import { config } from '../config.js';
import { tracker } from '../tracker/index.js';
import { getCurrentStream, getFollowAge } from './api.js';

const COMMAND_COOLDOWNS = new Map();
const COOLDOWN_MS = 5000;

function onCooldown(command) {
  const last = COMMAND_COOLDOWNS.get(command) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return true;
  COMMAND_COOLDOWNS.set(command, Date.now());
  return false;
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
    const text = message.trim();
    if (!text.startsWith('!')) return;

    const [rawCmd, ...args] = text.split(/\s+/);
    const cmd = rawCmd.toLowerCase();

    if (onCooldown(cmd)) return;

    const say = (msg) => client.say(channel, msg);
    const username = tags['display-name'] || tags.username;

    switch (cmd) {
      case '!game': {
        const stream = await getCurrentStream();
        if (stream) say(`🎮 Currently playing: ${stream.gameName}`);
        else say(`${username}, the stream is currently offline.`);
        break;
      }

      case '!uptime': {
        const cur = tracker.currentStream;
        if (!cur) { say(`${username}, the stream is currently offline.`); break; }
        const secs = Math.floor((Date.now() - new Date(cur.startedAt)) / 1000);
        say(`⏱ Stream has been live for ${tracker.formatDuration(secs)}`);
        break;
      }

      case '!viewers': {
        const stream = await getCurrentStream();
        if (stream) say(`👀 Current viewers: ${stream.viewers.toLocaleString()}`);
        else say(`${username}, the stream is currently offline.`);
        break;
      }

      case '!followage': {
        const target = args[0] || username;
        try {
          const date = await getFollowAge(tags['user-id']);
          if (date) {
            const days = Math.floor((Date.now() - new Date(date)) / 86_400_000);
            const years = Math.floor(days / 365);
            const months = Math.floor((days % 365) / 30);
            const remaining = days % 30;
            let age = '';
            if (years > 0) age += `${years}y `;
            if (months > 0) age += `${months}mo `;
            age += `${remaining}d`;
            say(`❤️ ${target} has been following for ${age.trim()}`);
          } else {
            say(`${target} is not following the channel.`);
          }
        } catch {
          say(`Could not check follow age for ${target}.`);
        }
        break;
      }

      case '!stats': {
        const recent = tracker.getRecentStreams(1);
        if (recent.length === 0) { say('No stream data recorded yet!'); break; }
        const s = recent[0];
        const avg = s.viewer_samples > 0
          ? Math.round(s.viewer_total / s.viewer_samples)
          : 0;
        say(`📊 Last stream: ${tracker.formatDuration(s.duration_seconds)} | Peak: ${s.peak_viewers} | Avg: ${avg} viewers`);
        break;
      }

      case '!title': {
        const stream = await getCurrentStream();
        if (stream) say(`📺 Stream title: ${stream.title}`);
        else say(`${username}, the stream is currently offline.`);
        break;
      }

      case '!commands': {
        say(`📋 Commands: !game !uptime !viewers !followage !stats !title !commands`);
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
