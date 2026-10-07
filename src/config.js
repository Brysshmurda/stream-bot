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
    clientId:      required('TWITCH_CLIENT_ID'),
    clientSecret:  required('TWITCH_CLIENT_SECRET'),
    // Seed account — optional if accounts are already stored in DB
    broadcasterId: optional('TWITCH_BROADCASTER_ID'),
    channelName:   optional('TWITCH_CHANNEL_NAME', '').toLowerCase(),
    accessToken:   optional('TWITCH_ACCESS_TOKEN'),
    refreshToken:  optional('TWITCH_REFRESH_TOKEN'),
  },
  discord: {
    token:    required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId:  optional('DISCORD_GUILD_ID'), // initial guild for seed account
  },
  db: {
    path: optional('DB_PATH', './data/streams.db'),
  },
};
