import { EventEmitter } from 'events';
import { accountQueries } from '../db/index.js';
import { config } from '../config.js';
import { StreamTracker } from '../tracker/index.js';
import { createTwitchApi } from '../twitch/api.js';
import { createModerationFns } from '../twitch/moderation.js';
import { createAutomod } from '../twitch/automod.js';
import { startEventSub } from '../twitch/eventsub.js';
import { startChatBot } from '../twitch/chat.js';

// Exactly one running instance (one chat connection, one EventSub listener) per Twitch channel,
// no matter how many Discord servers it's connected to — otherwise chat commands get answered twice.
class AccountManager extends EventEmitter {
  constructor() {
    super();
    this._instances = new Map(); // accountId → instance
    this._starting = new Map();  // accountId → Promise<instance>, so concurrent starts share one
    this._discordClient = null;
  }

  setDiscordClient(client) {
    this._discordClient = client;
  }

  async loadAll() {
    for (const account of accountQueries().getAll.all()) {
      await this._ensureStarted(account).catch(err =>
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
      access_token: config.twitch.accessToken,
      refresh_token: config.twitch.refreshToken,
    });
    if (config.discord.guildId) aq.addGuild.run(config.twitch.broadcasterId, config.discord.guildId);
    const account = aq.getById.get(config.twitch.broadcasterId);
    console.log(`[accounts] Seeded from env: ${account.twitch_channel}`);
    await this._ensureStarted(account);
  }

  _ensureStarted(account) {
    const running = this._instances.get(account.id);
    if (running) return Promise.resolve(running);
    if (!this._starting.has(account.id)) {
      const p = this._startAccount(account).finally(() => this._starting.delete(account.id));
      this._starting.set(account.id, p);
    }
    return this._starting.get(account.id);
  }

  async _startAccount(account) {
    const { apiClient, authProvider, getCurrentStream, getFollowAge } = await createTwitchApi(account);
    const tracker = new StreamTracker(account.id);
    tracker.setTwitchApi(apiClient);

    const modFns = createModerationFns(apiClient, account.twitch_broadcaster_id);
    const automod = createAutomod(account.id, modFns);

    const eventSub = await startEventSub({ apiClient, broadcasterId: account.twitch_broadcaster_id, tracker, getCurrentStream });
    const chat = startChatBot({ accountId: account.id, channelName: account.twitch_channel, accessToken: account.access_token, tracker, apiClient, getCurrentStream, getFollowAge, automod, modFns });

    const guilds = new Set(accountQueries().guildsFor.all(account.id).map(r => r.guild_id));
    const inst = { account, guilds, tracker, apiClient, authProvider, modFns, automod, getCurrentStream, getFollowAge, eventSub, chat };
    this._instances.set(account.id, inst);

    if (this._discordClient) this.emit('accountAdded', inst);

    const live = await getCurrentStream().catch(() => null);
    if (live) {
      tracker.streamStarted({
        streamId: live.id,
        title: live.title,
        gameName: live.gameName,
        gameId: live.gameId,
        startedAt: live.startDate?.toISOString() ?? new Date().toISOString(),
      });
    } else {
      // Clears a live role left behind if the stream ended while the bot was down
      tracker.emit('offlineAtStartup');
    }

    console.log(`[accounts] Started: ${account.twitch_channel} (${guilds.size} server${guilds.size === 1 ? '' : 's'})`);
    return inst;
  }

  async _stop(inst) {
    this._instances.delete(inst.account.id);
    inst.tracker.removeAllListeners();
    await Promise.allSettled([inst.chat?.disconnect(), inst.eventSub?.stop()]);
    console.log(`[accounts] Stopped: ${inst.account.twitch_channel}`);
  }

  // Connects a Twitch channel to a Discord server, starting it only if it isn't already running.
  async addAccount(accountData, guildId) {
    const aq = accountQueries();
    aq.upsert.run(accountData);
    if (guildId) aq.addGuild.run(accountData.id, guildId);
    const account = aq.getById.get(accountData.id);
    const running = this._instances.get(account.id);
    if (running) {
      Object.assign(running.account, account);
      if (guildId) running.guilds.add(guildId);
      return running;
    }
    return this._ensureStarted(account);
  }

  // Disconnects a channel from one server; shuts it down entirely once no server uses it.
  async removeFromGuild(accountId, guildId) {
    const aq = accountQueries();
    aq.removeGuild.run(accountId, guildId);
    const inst = this._instances.get(accountId);
    inst?.guilds.delete(guildId);
    if (aq.guildsFor.all(accountId).length > 0) return { stillConnected: true };
    aq.disable.run(accountId);
    if (inst) await this._stop(inst);
    return { stillConnected: false };
  }

  getByGuildId(guildId) {
    return [...this._instances.values()].filter(i => i.guilds.has(guildId));
  }

  getById(accountId) {
    return this._instances.get(accountId);
  }

  getAll() {
    return [...this._instances.values()];
  }
}

export const accountManager = new AccountManager();
