import { RefreshingAuthProvider } from '@twurple/auth';
import { ApiClient } from '@twurple/api';
import { config } from '../config.js';
import { setSetting, getSetting } from '../db/index.js';

let authProvider = null;
let apiClient = null;

export async function getTwitchApi() {
  if (apiClient) return apiClient;

  const storedToken = getSetting('twitch_token');
  const tokenData = storedToken
    ? JSON.parse(storedToken)
    : {
        accessToken: config.twitch.accessToken,
        refreshToken: config.twitch.refreshToken,
        expiresIn: 0,
        obtainmentTimestamp: 0,
      };

  authProvider = new RefreshingAuthProvider({
    clientId: config.twitch.clientId,
    clientSecret: config.twitch.clientSecret,
  });

  authProvider.onRefresh((userId, newToken) => {
    setSetting('twitch_token', JSON.stringify(newToken));
    console.log('[twitch-api] Token refreshed and saved');
  });

  await authProvider.addUserForToken(tokenData, ['chat']);

  apiClient = new ApiClient({ authProvider });
  return apiClient;
}

export async function getAuthProvider() {
  await getTwitchApi();
  return authProvider;
}

export async function getBroadcasterInfo() {
  const api = await getTwitchApi();
  return api.users.getUserById(config.twitch.broadcasterId);
}

export async function getCurrentStream() {
  const api = await getTwitchApi();
  return api.streams.getStreamByUserId(config.twitch.broadcasterId);
}

export async function getFollowAge(userId) {
  const api = await getTwitchApi();
  try {
    const follow = await api.channels.getChannelFollowers(
      config.twitch.broadcasterId,
      userId
    );
    if (follow?.data?.length > 0) {
      return follow.data[0].followDate;
    }
    return null;
  } catch {
    return null;
  }
}
