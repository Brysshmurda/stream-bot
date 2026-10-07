export function createModerationFns(apiClient, broadcasterId) {
  return {
    async banUser(userId, reason = '') {
      await apiClient.moderation.banUser(broadcasterId, broadcasterId, { userId, reason });
    },
    async unbanUser(userId) {
      await apiClient.moderation.unbanUser(broadcasterId, broadcasterId, userId);
    },
    async timeoutUser(userId, durationSeconds, reason = '') {
      await apiClient.moderation.banUser(broadcasterId, broadcasterId, { userId, duration: durationSeconds, reason });
    },
    async deleteMessage(messageId) {
      await apiClient.chat.deleteChatMessages(broadcasterId, broadcasterId, messageId);
    },
    async clearChat() {
      await apiClient.chat.deleteChatMessages(broadcasterId, broadcasterId);
    },
    async updateChatSettings(settings) {
      await apiClient.chat.updateChatSettings(broadcasterId, broadcasterId, settings);
    },
    async getUserByName(username) {
      return apiClient.users.getUserByName(username.toLowerCase().replace(/^@/, ''));
    },
  };
}
