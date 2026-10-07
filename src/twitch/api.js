import { RefreshingAuthProvider } from '@twurple/auth';
import { ApiClient } from '@twurple/api';
import { config } from '../config.js';
import { accountQueries } from '../db/index.js';

export async function createTwitchApi(account) {
  const tokenData = {
    accessToken: account.access_token,
    refreshToken: account.refresh_token,
    expiresIn: 0,
    obtainmentTimestamp: 0,
  };

  const authProvider = new RefreshingAuthProvider({
    clientId: config.twitch.clientId,
    clientSecret: config.twitch.clientSecret,
  });

  authProvider.onRefresh((_userId, newToken) => {
    accountQueries().updateTokens.run(newToken.accessToken, newToken.refreshToken, account.id);
    console.log(`[twitch-api] Token refreshed for ${account.twitch_channel}`);
  });

  await authProvider.addUserForToken(tokenData, ['chat']);

  const apiClient = new ApiClient({ authProvider });
  const broadcasterId = account.twitch_broadcaster_id;

  async function getCurrentStream() {
    return apiClient.streams.getStreamByUserId(broadcasterId);
  }

  async function getFollowAge(userId) {
    try {
      const follow = await apiClient.channels.getChannelFollowers(broadcasterId, userId);
      return follow?.data?.[0]?.followDate ?? null;
    } catch {
      return null;
    }
  }

  return { apiClient, authProvider, getCurrentStream, getFollowAge };
}
