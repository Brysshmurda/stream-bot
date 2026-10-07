import { EventEmitter } from 'events';
import { accountQueries, scopedQueries, getSetting, setSetting } from '../db/index.js';
import { config } from '../config.js';
import { StreamTracker } from '../tracker/index.js';
import { createTwitchApi } from '../twitch/api.js';
import { createModerationFns } from '../twitch/moderation.js';
import { createAutomod } from '../twitch/automod.js';
import { startEventSub } from '../twitch/eventsub.js';
import { startChatBot } from '../twitch/chat.js';

class AccountManager extends EventEmitter {
  constructor() {
    super();
    this._instances = new Map(); // accountId → instance object
    this._discordClient = null;
  }

  setDiscordClient(client) {
    this._discordClient = client;
  }

  async loadAll() {
    const accounts = accountQueries().getAll.all();
    for (const account of accounts) {
      await this._startAccount(account).catch(err =>
        console.error(`[accounts] Failed to start ${account.twitch_channel}:`, err.message)
      );
    }
    if (this._instances.size === 0 && config.twitch.broadcasterId) {
      await this._seedFromEnv();
    }
  }

  async _seedFromEnv() {
    const aq = accountQueries();
    aq.upsert.run({
      id: config.twitch.broadcasterId,
      twitch_channel: config.twitch.channelName,
      twitch_broadcaster_id: config.twitch.broadcasterId,
      discord_guild_id: config.discord.guildId || null,
      access_token: config.twitch.accessToken,
      refresh_token: config.twitch.refreshToken,
    });
    const account = aq.getById.get(config.twitch.broadcasterId);
    console.log(`[accounts] Seeded from env: ${account.twitch_channel}`);
    await this._startAccount(account);
  }

  async _startAccount(account) {
    const { apiClient, authProvider, getCurrentStream, getFollowAge } = await createTwitchApi(account);
    const tracker = new StreamTracker(account.id);
    tracker.setTwitchApi(apiClient);

    const modFns = createModerationFns(apiClient, account.twitch_broadcaster_id);
    const automod = createAutomod(account.id, modFns);

    await startEventSub({ authProvider, broadcasterId: account.twitch_broadcaster_id, tracker, getCurrentStream });

    startChatBot({ accountId: account.id, channelName: account.twitch_channel, accessToken: account.access_token, tracker, apiClient, getCurrentStream, getFollowAge, automod, modFns });

    const inst = { account, tracker, apiClient, authProvider, modFns, automod, getCurrentStream, getFollowAge };
    this._instances.set(account.id, inst);

    if (this._discordClient) {
      this.emit('accountAdded', inst);
    }

    const live = await getCurrentStream().catch(() => null);
    if (live) {
      tracker.streamStarted({
        streamId: live.id,
        title: live.title,
        gameName: live.gameName,
        gameId: live.gameId,
        startedAt: live.startDate?.toISOString() ?? new Date().toISOString(),
      });
    }

    console.log(`[accounts] Started: ${account.twitch_channel}`);
    return inst;
  }

  async addAccount(accountData) {
    const aq = accountQueries();
    aq.upsert.run(accountData);
    const account = aq.getById.get(accountData.id);
    return this._startAccount(account);
  }

  disableAccount(accountId) {
    this._instances.delete(accountId);
    accountQueries().disable.run(accountId);
  }

  getByGuildId(guildId) {
    return [...this._instances.values()].find(i => i.account.discord_guild_id === guildId);
  }

  getById(accountId) {
    return this._instances.get(accountId);
  }

  getAll() {
    return [...this._instances.values()];
  }
}

export const accountManager = new AccountManager();
