import { bannedWordQueries, strikeQueries, getSetting } from '../db/index.js';
import { timeoutUser, banUser, deleteMessage } from './moderation.js';

// In-memory link permit list: userId → expiry timestamp
const linkPermits = new Map();

// In-memory per-user spam tracking: userId → { lastMsg, count, lastTime }
const spamTracker = new Map();

export function permitUser(userId, durationMs = 60_000) {
  linkPermits.set(userId, Date.now() + durationMs);
}

export function isPermitted(userId) {
  const expiry = linkPermits.get(userId);
  if (!expiry) return false;
  if (Date.now() > expiry) { linkPermits.delete(userId); return false; }
  return true;
}

const URL_RE = /https?:\/\/\S+|www\.\.\S+|\S+\.(com|net|org|gg|tv|io|co)\b/i;
const CAPS_MIN_LENGTH = 10;

export async function checkMessage({ userId, username, message, messageId, isMod, isBroadcaster, tags }) {
  if (isMod || isBroadcaster) return; // never automod mods or broadcaster

  const automodEnabled = getSetting('automod_enabled') !== 'false';
  if (!automodEnabled) return;

  const reasons = [];

  // ── Banned words ─────────────────────────────────────────────────────────
  const words = bannedWordQueries().getAllWords.all();
  for (const entry of words) {
    const re = new RegExp(`\\b${escapeRegex(entry.word)}\\b`, 'i');
    if (re.test(message)) {
      await applyAction(entry.action, userId, username, messageId, entry.duration, `banned word: ${entry.word}`);
      return;
    }
  }

  // ── Link filter ───────────────────────────────────────────────────────────
  const linkFilter = getSetting('automod_links') !== 'false';
  if (linkFilter && URL_RE.test(message) && !isPermitted(userId)) {
    await applyAction('delete', userId, username, messageId, 0, 'link blocked');
    return;
  }

  // ── Caps filter ───────────────────────────────────────────────────────────
  const capsFilter = getSetting('automod_caps') !== 'false';
  if (capsFilter && message.length >= CAPS_MIN_LENGTH) {
    const letters = message.replace(/[^a-zA-Z]/g, '');
    const caps = message.replace(/[^A-Z]/g, '');
    if (letters.length > 0 && caps.length / letters.length > 0.75) {
      reasons.push('excessive caps');
    }
  }

  // ── Repetition / spam filter ──────────────────────────────────────────────
  const spamFilter = getSetting('automod_spam') !== 'false';
  if (spamFilter) {
    const now = Date.now();
    const entry = spamTracker.get(userId) || { lastMsg: '', count: 0, lastTime: 0 };
    const normalized = message.toLowerCase().trim();

    if (normalized === entry.lastMsg && now - entry.lastTime < 10_000) {
      entry.count++;
    } else {
      entry.count = 1;
      entry.lastMsg = normalized;
    }
    entry.lastTime = now;
    spamTracker.set(userId, entry);

    if (entry.count >= 4) {
      reasons.push('spam/repetition');
      entry.count = 0;
    }
  }

  if (reasons.length > 0) {
    await applyStrike(userId, username, messageId, reasons.join(', '));
  }
}

async function applyAction(action, userId, username, messageId, duration, reason) {
  try {
    if (action === 'delete') {
      await deleteMessage(messageId);
    } else if (action === 'timeout') {
      await deleteMessage(messageId).catch(() => {});
      await timeoutUser(userId, duration || 300, reason);
    } else if (action === 'ban') {
      await banUser(userId, reason);
    }
    console.log(`[automod] ${action} ${username}: ${reason}`);
  } catch (err) {
    console.error(`[automod] action error:`, err.message);
  }
}

async function applyStrike(userId, username, messageId, reason) {
  const sq = strikeQueries();
  sq.addStrike.run({ twitch_user_id: userId, twitch_username: username, reason });
  const row = sq.getStrikes.get(userId);
  const strikes = row?.strikes ?? 1;

  try {
    await deleteMessage(messageId).catch(() => {});
    if (strikes === 1) {
      await timeoutUser(userId, 60, `Warning (1/3): ${reason}`);
    } else if (strikes === 2) {
      await timeoutUser(userId, 600, `Warning (2/3): ${reason}`);
    } else {
      await banUser(userId, `Auto-banned after 3 strikes: ${reason}`);
    }
    console.log(`[automod] strike ${strikes}/3 for ${username}: ${reason}`);
  } catch (err) {
    console.error(`[automod] strike error:`, err.message);
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
