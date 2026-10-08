import { Client, GatewayIntentBits, Collection, Events, REST, Routes, EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { getSetting, setSetting, getScopedSetting, setScopedSetting, guildScope, scopedQueries, findDiscordUserByTwitchId } from '../db/index.js';

import { statsCommand, statsHandler } from './commands/stats.js';
import { historyCommand, historyHandler } from './commands/history.js';
import { topgamesCommand, topgamesHandler } from './commands/topgames.js';
import { linkCommand, linkHandler } from './commands/link.js';
import { setupCommand, setupHandler, followerRoleKey } from './commands/setup.js';
import { modCommand, modHandler } from './commands/mod.js';
import { bannedwordsCommand, bannedwordsHandler } from './commands/bannedwords.js';
import { accountCommand, accountHandler, handleAccountSetupModal } from './commands/account.js';

const COMMANDS = [
  { data: statsCommand,       execute: statsHandler },
  { data: historyCommand,     execute: historyHandler },
  { data: topgamesCommand,    execute: topgamesHandler },
  { data: linkCommand,        execute: linkHandler },
  { data: setupCommand,       execute: setupHandler },
  { data: modCommand,         execute: modHandler },
  { data: bannedwordsCommand, execute: bannedwordsHandler },
  { data: accountCommand,     execute: accountHandler },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchNotifyChannel(client, accountId, guildId, key) {
  const id = getScopedSetting(accountId, guildId, key) || getScopedSetting(accountId, guildId, 'channel_announce');
  if (!id) return null;
  try { return await client.channels.fetch(id); } catch { return null; }
}

function notifEnabled(accountId, guildId, key, defaultOn = true) {
  const val = getScopedSetting(accountId, guildId, key);
  return val === null ? defaultOn : val !== 'false';
}

// ── Tracker listener setup ────────────────────────────────────────────────────

// One Twitch channel can be connected to several Discord servers: each event is handled once per server.
function setupTrackerListeners(client, inst) {
  const { tracker, account } = inst;
  const aid = account.id;
  const setting = (gid, key, fallback = null) => getScopedSetting(aid, gid, key, fallback);

  const perGuild = (label, handler) => async (payload) => {
    await Promise.all([...inst.guilds].map(gid =>
      handler(gid, payload).catch(err => console.error(`[discord] ${label} error (${account.twitch_channel}, guild ${gid}):`, err.message))
    ));
  };

  const notify = async (gid, enabledKey, channelKey, message) => {
    if (enabledKey && !notifEnabled(aid, gid, enabledKey)) return;
    const channel = await fetchNotifyChannel(client, aid, gid, channelKey);
    if (channel) await channel.send(message);
  };

  tracker.on('streamStart', perGuild('stream announce', async (gid, stream) => {
    const embed = new EmbedBuilder()
      .setTitle(`🔴 ${account.twitch_channel} is now LIVE!`)
      .setDescription(`**${stream.title}**`)
      .addFields(
        { name: '🎮 Game', value: stream.gameName || 'Unknown', inline: true },
        { name: '🔗 Watch', value: `[twitch.tv/${account.twitch_channel}](https://twitch.tv/${account.twitch_channel})`, inline: true }
      )
      .setColor(0x9146ff).setTimestamp();
    await notify(gid, 'notify_stream_live', 'channel_announce', { embeds: [embed] });
  }));

  tracker.on('streamStart', perGuild('live role', gid => setLiveRole(client, account, gid, true)));
  tracker.on('streamEnd', perGuild('live role', gid => setLiveRole(client, account, gid, false)));
  tracker.on('offlineAtStartup', perGuild('live role', gid => setLiveRole(client, account, gid, false)));

  tracker.on('streamEnd', perGuild('stream end', async (gid, finalStream) => {
    const avg = finalStream?.viewer_samples > 0 ? Math.round(finalStream.viewer_total / finalStream.viewer_samples) : 0;
    const embed = new EmbedBuilder()
      .setTitle(`📴 ${account.twitch_channel} ended the stream`)
      .addFields(
        { name: '⏱ Duration',     value: tracker.formatDuration(finalStream?.duration_seconds), inline: true },
        { name: '👀 Peak Viewers', value: String(finalStream?.peak_viewers ?? 0),                inline: true },
        { name: '📊 Avg Viewers',  value: String(avg),                                           inline: true },
      )
      .setColor(0x6441a5).setTimestamp();
    await notify(gid, 'notify_stream_end', 'channel_announce', { embeds: [embed] });
  }));

  tracker.on('follow', perGuild('follow', async (gid, { twitchUserId, twitchUsername }) => {
    const roleId = setting(gid, followerRoleKey(aid)) ?? setting(gid, 'role_follower');
    const discordUserId = findDiscordUserByTwitchId(twitchUserId);
    if (discordUserId && roleId) await assignRoleToMember(client, gid, discordUserId, roleId);
    await notify(gid, 'notify_follows', 'channel_follows', `❤️ **${twitchUsername}** just followed **${account.twitch_channel}** on Twitch!`);
  }));

  tracker.on('subscribe', perGuild('sub', async (gid, { twitchUserId, twitchUsername, tier, isGift }) => {
    const roleId = setting(gid, 'role_subscriber');
    const discordUserId = findDiscordUserByTwitchId(twitchUserId);
    if (discordUserId && roleId) await assignRoleToMember(client, gid, discordUserId, roleId);
    if (isGift) return;
    const tierName = tier === '3000' ? 'Tier 3' : tier === '2000' ? 'Tier 2' : 'Tier 1';
    await notify(gid, 'notify_subs', 'channel_subs', `⭐ **${twitchUsername}** just subscribed to **${account.twitch_channel}** (${tierName})!`);
  }));

  tracker.on('subGift', perGuild('sub gift', async (gid, { gifterUsername, amount }) => {
    await notify(gid, 'notify_giftsubs', 'channel_subs', `🎁 **${gifterUsername}** gifted **${amount}** sub${amount > 1 ? 's' : ''} to **${account.twitch_channel}**!`);
  }));

  tracker.on('cheer', perGuild('bits', async (gid, { twitchUsername, bits }) => {
    const minimum = parseInt(setting(gid, 'notify_bits_minimum') ?? '1', 10);
    if (bits < minimum) return;
    await notify(gid, 'notify_bits', 'channel_bits', `💎 **${twitchUsername}** cheered **${bits}** bits for **${account.twitch_channel}**!`);
  }));

  tracker.on('modAction', perGuild('modlog', async (gid, { action, target, reason, moderator }) => {
    const modLogId = setting(gid, 'channel_modlog');
    if (!modLogId) return;
    const colors = { ban: 0xff0000, unban: 0x00ff00, timeout: 0xff6600, warn: 0xffa500, purge: 0xffcc00 };
    const icons  = { ban: '🔨', unban: '✅', timeout: '⏱️', warn: '⚠️', purge: '🧹' };
    const embed = new EmbedBuilder()
      .setTitle(`${icons[action] ?? '🔨'} Twitch ${action.charAt(0).toUpperCase() + action.slice(1)} — ${account.twitch_channel}`)
      .addFields(
        { name: 'User',      value: target,                inline: true },
        { name: 'Moderator', value: moderator,             inline: true },
        { name: 'Reason',    value: reason || 'No reason', inline: false },
      )
      .setColor(colors[action] ?? 0x9146ff).setTimestamp();
    const channel = await client.channels.fetch(modLogId);
    await channel.send({ embeds: [embed] });
  }));
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function startDiscord(accountManager) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
    ],
  });

  client.commands = new Collection();
  for (const cmd of COMMANDS) client.commands.set(cmd.data.name, cmd);

  // Listen for new accounts added after startup
  accountManager.on('accountAdded', (inst) => setupTrackerListeners(client, inst));

  const readyPromise = new Promise(resolve => {
    client.once(Events.ClientReady, async (c) => {
      console.log(`[discord] Logged in as ${c.user.tag}`);
      await registerCommands(client);
      // Attach trackers for any accounts already loaded
      for (const inst of accountManager.getAll()) {
        setupTrackerListeners(client, inst);
      }
      resolve();
    });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    // Handle modal submissions
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'account_setup_modal') {
        await handleAccountSetupModal(interaction, accountManager).catch(err =>
          console.error('[discord] modal error:', err)
        );
      }
      return;
    }

    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused(true);
      if (focused.name !== 'twitch') return interaction.respond([]).catch(() => {});
      const typed = focused.value.toLowerCase();
      const choices = accountManager.getByGuildId(interaction.guildId)
        .map(i => i.account.twitch_channel)
        .filter(name => name.toLowerCase().startsWith(typed))
        .slice(0, 25)
        .map(name => ({ name, value: name }));
      await interaction.respond(choices).catch(() => {});
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) return;

    const instances = accountManager.getByGuildId(interaction.guildId);
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(false);
    // Server-wide settings don't need a Twitch channel picked (or linked at all)
    const serverLevel = interaction.commandName === 'link'
      || (interaction.commandName === 'setup' && (['channels', 'roles', 'notifications'].includes(group) || sub === 'view'));
    const accountOptional = serverLevel || interaction.commandName === 'account';

    if (instances.length === 0 && !accountOptional) {
      const reply = { content: '⚠️ No Twitch account is linked to this server. An administrator must run `/account setup` first.', ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
      else await interaction.reply(reply);
      return;
    }

    const twitchOpt = interaction.options.getString('twitch')?.toLowerCase().trim();
    let inst = null;
    if (twitchOpt) {
      inst = instances.find(i => i.account.twitch_channel.toLowerCase() === twitchOpt);
      if (!inst) {
        const available = instances.map(i => `\`${i.account.twitch_channel}\``).join(', ') || '_none_';
        await interaction.reply({ content: `⚠️ No linked Twitch channel named "${twitchOpt}". Linked here: ${available}`, ephemeral: true });
        return;
      }
    } else if (instances.length === 1) {
      inst = instances[0];
    } else if (instances.length > 1 && !accountOptional) {
      const list = instances.map(i => `• \`${i.account.twitch_channel}\``).join('\n');
      await interaction.reply({ content: `ℹ️ Multiple Twitch channels are linked to this server. Add the \`twitch\` option to pick one:\n${list}`, ephemeral: true });
      return;
    }

    const context = inst ? {
      instances,
      account:          inst.account,
      tracker:          inst.tracker,
      apiClient:        inst.apiClient,
      getCurrentStream: inst.getCurrentStream,
      getFollowAge:     inst.getFollowAge,
      scopedQ:          scopedQueries(inst.account.id),
      getSetting:       (key, fallback = null) => getScopedSetting(inst.account.id, interaction.guildId, key, fallback),
      setSetting:       (key, value)           => setScopedSetting(inst.account.id, interaction.guildId, key, value),
      accountManager,
    } : {
      instances,
      accountManager,
      getSetting: (key, fallback = null) => getSetting(guildScope(interaction.guildId), key, fallback),
      setSetting: (key, value)           => setSetting(guildScope(interaction.guildId), key, value),
    };

    try {
      await cmd.execute(interaction, context);
    } catch (err) {
      console.error(`[discord] Command error (${interaction.commandName}):`, err);
      const reply = { content: 'Something went wrong running that command.', ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
      else await interaction.reply(reply);
    }
  });

  await client.login(config.discord.token);
  await readyPromise;
  return client;
}

// ── Internals ─────────────────────────────────────────────────────────────────

async function registerCommands(client) {
  const rest = new REST().setToken(config.discord.token);
  const body = COMMANDS.map(c => c.data.toJSON());
  try {
    await rest.put(
      Routes.applicationCommands(config.discord.clientId),
      { body }
    );
    console.log(`[discord] Registered ${body.length} global slash commands`);
  } catch (err) {
    console.error('[discord] Failed to register commands:', err.message);
  }
}

async function assignRoleToMember(client, guildId, discordUserId, roleId) {
  if (!guildId) return;
  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(discordUserId);
    if (!member.roles.cache.has(roleId)) await member.roles.add(roleId);
  } catch (err) {
    console.error(`[discord] role assign error (user ${discordUserId}, role ${roleId}):`, err.message);
  }
}

// Picked explicitly via /account streamer, else whoever ran /link twitch for this channel,
// else a member whose Discord name matches the Twitch name.
async function findStreamerMember(guild, account) {
  const explicit = getSetting(account.id, 'streamer_discord_id') ?? findDiscordUserByTwitchId(account.twitch_broadcaster_id);
  if (explicit) return guild.members.fetch(explicit).catch(() => null);
  const name = account.twitch_channel.toLowerCase();
  const found = await guild.members.search({ query: name, limit: 10 }).catch(() => null);
  return found?.find(m => [m.user.username, m.user.globalName, m.nickname].some(n => n?.toLowerCase() === name)) ?? null;
}

async function setLiveRole(client, account, guildId, give) {
  const roleId = getScopedSetting(account.id, guildId, 'role_live');
  if (!roleId) return;
  const guild = await client.guilds.fetch(guildId);
  const member = await findStreamerMember(guild, account);
  if (!member) {
    if (give) console.log(`[discord] live role: no member in guild ${guildId} found for ${account.twitch_channel} (they can run /link twitch)`);
    return;
  }
  if (give && !member.roles.cache.has(roleId)) await member.roles.add(roleId, `${account.twitch_channel} went live`);
  if (!give && member.roles.cache.has(roleId)) await member.roles.remove(roleId, `${account.twitch_channel} stream ended`);
}
