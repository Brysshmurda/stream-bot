import 'dotenv/config';

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key, fallback = null) {
  return process.env[key] || fallback;
}

export const config = {
  twitch: {
    clientId: required('TWITCH_CLIENT_ID'),
    clientSecret: required('TWITCH_CLIENT_SECRET'),
    accessToken: required('TWITCH_ACCESS_TOKEN'),
    refreshToken: required('TWITCH_REFRESH_TOKEN'),
    broadcasterId: required('TWITCH_BROADCASTER_ID'),
    channelName: required('TWITCH_CHANNEL_NAME').toLowerCase(),
    botUsername: optional('TWITCH_BOT_USERNAME'),
    botToken: optional('TWITCH_BOT_TOKEN'),
  },
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId: required('DISCORD_GUILD_ID'),
    announceChannelId: optional('DISCORD_ANNOUNCE_CHANNEL_ID'),
    followerRoleId: optional('DISCORD_FOLLOWER_ROLE_ID'),
    subscriberRoleId: optional('DISCORD_SUBSCRIBER_ROLE_ID'),
    liveRoleId: optional('DISCORD_LIVE_ROLE_ID'),
  },
  db: {
    path: optional('DB_PATH', './data/streams.db'),
  },
};
