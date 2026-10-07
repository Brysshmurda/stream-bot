import { getTwitchApi } from './api.js';
import { config } from '../config.js';

const bid = () => config.twitch.broadcasterId;

export async function banUser(userId, reason = '') {
  const api = await getTwitchApi();
  await api.moderation.banUser(bid(), bid(), { userId, reason });
}

export async function unbanUser(userId) {
  const api = await getTwitchApi();
  await api.moderation.unbanUser(bid(), bid(), userId);
}

export async function timeoutUser(userId, durationSeconds, reason = '') {
  const api = await getTwitchApi();
  await api.moderation.banUser(bid(), bid(), { userId, duration: durationSeconds, reason });
}

export async function deleteMessage(messageId) {
  const api = await getTwitchApi();
  await api.chat.deleteChatMessages(bid(), bid(), messageId);
}

export async function clearChat() {
  const api = await getTwitchApi();
  await api.chat.deleteChatMessages(bid(), bid());
}

export async function updateChatSettings(settings) {
  const api = await getTwitchApi();
  await api.chat.updateChatSettings(bid(), bid(), settings);
}

export async function getUserByName(username) {
  const api = await getTwitchApi();
  return api.users.getUserByName(username.toLowerCase().replace(/^@/, ''));
}
