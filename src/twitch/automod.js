import { scopedQueries, getSetting } from '../db/index.js';

const URL_RE = /https?:\/\/\S+|www\.\.\S+|\S+\.(com|net|org|gg|tv|io|co)\b/i;
const CAPS_MIN_LENGTH = 10;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createAutomod(accountId, modFns) {
  const linkPermits = new Map();
  const spamTracker = new Map();

  function permitUser(userId, durationMs = 60_000) {
    linkPermits.set(userId, Date.now() + durationMs);
  }

  function isPermitted(userId) {
    const expiry = linkPermits.get(userId);
    if (!expiry) return false;
    if (Date.now() > expiry) { linkPermits.delete(userId); return false; }
    return true;
  }

  async function checkMessage({ userId, username, message, messageId, isMod, isBroadcaster }) {
    if (isMod || isBroadcaster) return;
    if (getSetting(accountId, 'automod_enabled') === 'false') return;

    const words = scopedQueries(accountId).bannedWords.getAll.all();
    for (const entry of words) {
      if (new RegExp(`\\b${escapeRegex(entry.word)}\\b`, 'i').test(message)) {
        await _applyAction(entry.action, userId, username, messageId, entry.duration, `banned word: ${entry.word}`);
        return;
      }
    }

    if (getSetting(accountId, 'automod_links') !== 'false' && URL_RE.test(message) && !isPermitted(userId)) {
      await _applyAction('delete', userId, username, messageId, 0, 'link blocked');
      return;
    }

    const reasons = [];

    if (getSetting(accountId, 'automod_caps') !== 'false' && message.length >= CAPS_MIN_LENGTH) {
      const threshold = parseInt(getSetting(accountId, 'automod_caps_threshold') ?? '75', 10) / 100;
      const letters = message.replace(/[^a-zA-Z]/g, '');
      const caps = message.replace(/[^A-Z]/g, '');
      if (letters.length > 0 && caps.length / letters.length > threshold) reasons.push('excessive caps');
    }

    if (getSetting(accountId, 'automod_spam') !== 'false') {
      const spamCount  = parseInt(getSetting(accountId, 'automod_spam_count')  ?? '4',  10);
      const spamWindow = parseInt(getSetting(accountId, 'automod_spam_window') ?? '10', 10) * 1000;
      const now = Date.now();
      const entry = spamTracker.get(userId) || { lastMsg: '', count: 0, lastTime: 0 };
      const normalized = message.toLowerCase().trim();
      if (normalized === entry.lastMsg && now - entry.lastTime < spamWindow) { entry.count++; }
      else { entry.count = 1; entry.lastMsg = normalized; }
      entry.lastTime = now;
      spamTracker.set(userId, entry);
      if (entry.count >= spamCount) { reasons.push('spam/repetition'); entry.count = 0; }
    }

    if (reasons.length > 0) await _applyStrike(userId, username, messageId, reasons.join(', '));
  }

  async function _applyAction(action, userId, username, messageId, duration, reason) {
    try {
      if (action === 'delete') await modFns.deleteMessage(messageId);
      else if (action === 'timeout') { await modFns.deleteMessage(messageId).catch(() => {}); await modFns.timeoutUser(userId, duration || 300, reason); }
      else if (action === 'ban') await modFns.banUser(userId, reason);
      console.log(`[automod:${accountId}] ${action} ${username}: ${reason}`);
    } catch (err) {
      console.error(`[automod:${accountId}] action error:`, err.message);
    }
  }

  async function _applyStrike(userId, username, messageId, reason) {
    const sq = scopedQueries(accountId);
    sq.strikes.add.run({ twitch_user_id: userId, twitch_username: username, reason });
    const strikes = sq.strikes.get.get(userId)?.strikes ?? 1;
    try {
      await modFns.deleteMessage(messageId).catch(() => {});
      if (strikes === 1) await modFns.timeoutUser(userId, 60, `Warning (1/3): ${reason}`);
      else if (strikes === 2) await modFns.timeoutUser(userId, 600, `Warning (2/3): ${reason}`);
      else await modFns.banUser(userId, `Auto-banned after 3 strikes: ${reason}`);
      console.log(`[automod:${accountId}] strike ${strikes}/3 for ${username}: ${reason}`);
    } catch (err) {
      console.error(`[automod:${accountId}] strike error:`, err.message);
    }
  }

  return { checkMessage, permitUser, isPermitted };
}
