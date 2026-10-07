import { Client, GatewayIntentBits, Collection, Events, REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { getSetting, setSetting, scopedQueries } from '../db/index.js';

import { statsCommand, statsHandler } from './commands/stats.js';
import { historyCommand, historyHandler } from './commands/history.js';
import { topgamesCommand, topgamesHandler } from './commands/topgames.js';
import { linkCommand, linkHandler } from './commands/link.js';
import { setupCommand, setupHandler } from './commands/setup.js';
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

function getChannelId(accountId, specificKey) {
  return getSetting(accountId, specificKey) || getSetting(accountId, 'channel_announce');
}

function notifEnabled(accountId, key, defaultOn = true) {
  const val = getSetting(accountId, key);
  return val === null ? defaultOn : val !== 'false';
}

async function fetchChannel(client, accountId, key) {
  const id = getChannelId(accountId, key);
  if (!id) return null;
  try { return await client.channels.fetch(id); } catch { return null; }
}

// ── Tracker listener setup ────────────────────────────────────────────────────

function setupTrackerListeners(client, inst) {
  const { tracker, account } = inst;
  const aid = account.id;

  tracker.on('streamStart', async (stream) => {
    if (!notifEnabled(aid, 'notify_stream_live')) return;
    const channel = await fetchChannel(client, aid, 'channel_announce');
    if (!channel) return;
    try {
      const { EmbedBuilder } = await import('discord.js');
      const embed = new EmbedBuilder()
        .setTitle(`🔴 ${account.twitch_channel} is now LIVE!`)
        .setDescription(`**${stream.title}**`)
        .addFields(
          { name: '🎮 Game', value: stream.gameName || 'Unknown', inline: true },
          { name: '🔗 Watch', value: `[twitch.tv/${account.twitch_channel}](https://twitch.tv/${account.twitch_channel})`, inline: true }
        )
        .setColor(0x9146ff).setTimestamp();
      await channel.send({ embeds: [embed] });

      const liveRoleId = getSetting(aid, 'role_live');
      if (liveRoleId) await removeRoleFromAll(client, liveRoleId);
    } catch (err) { console.error('[discord] stream announce error:', err.message); }
  });

  tracker.on('streamEnd', async (finalStream) => {
    if (!notifEnabled(aid, 'notify_stream_end')) return;
    const channel = await fetchChannel(client, aid, 'channel_announce');
    if (!channel) return;
    try {
      const { EmbedBuilder } = await import('discord.js');
      const avg = finalStream?.viewer_samples > 0 ? Math.round(finalStream.viewer_total / finalStream.viewer_samples) : 0;
      const embed = new EmbedBuilder()
        .setTitle('📴 Stream ended')
        .addFields(
          { name: '⏱ Duration',     value: tracker.formatDuration(finalStream?.duration_seconds), inline: true },
          { name: '👀 Peak Viewers', value: String(finalStream?.peak_viewers ?? 0),                inline: true },
          { name: '📊 Avg Viewers',  value: String(avg),                                           inline: true },
        )
        .setColor(0x6441a5).setTimestamp();
      await channel.send({ embeds: [embed] });

      const liveRoleId = getSetting(aid, 'role_live');
      if (liveRoleId) await removeRoleFromAll(client, liveRoleId);
    } catch (err) { console.error('[discord] stream end error:', err.message); }
  });

  tracker.on('follow', async ({ twitchUserId, twitchUsername }) => {
    const followerRoleId = getSetting(aid, 'role_follower');
    const link = scopedQueries(aid).links.getByTwitchId.get(twitchUserId);
    if (link && followerRoleId) await assignRoleToMember(client, link.discord_user_id, followerRoleId);

    if (!notifEnabled(aid, 'notify_follows')) return;
    const channel = await fetchChannel(client, aid, 'channel_follows');
    if (!channel) return;
    try { await channel.send(`❤️ **${twitchUsername}** just followed on Twitch!`); }
    catch (err) { console.error('[discord] follow notify error:', err.message); }
  });

  tracker.on('subscribe', async ({ twitchUserId, twitchUsername, tier, isGift }) => {
    const subRoleId = getSetting(aid, 'role_subscriber');
    const link = scopedQueries(aid).links.getByTwitchId.get(twitchUserId);
    if (link && subRoleId) await assignRoleToMember(client, link.discord_user_id, subRoleId);

    if (isGift) return;
    if (!notifEnabled(aid, 'notify_subs')) return;
    const channel = await fetchChannel(client, aid, 'channel_subs');
    if (!channel) return;
    try {
      const tierName = tier === '3000' ? 'Tier 3' : tier === '2000' ? 'Tier 2' : 'Tier 1';
      await channel.send(`⭐ **${twitchUsername}** just subscribed (${tierName})!`);
    } catch (err) { console.error('[discord] sub notify error:', err.message); }
  });

  tracker.on('subGift', async ({ gifterUsername, amount }) => {
    if (!notifEnabled(aid, 'notify_giftsubs')) return;
    const channel = await fetchChannel(client, aid, 'channel_subs');
    if (!channel) return;
    try { await channel.send(`🎁 **${gifterUsername}** gifted **${amount}** sub${amount > 1 ? 's' : ''}!`); }
    catch (err) { console.error('[discord] subgift error:', err.message); }
  });

  tracker.on('cheer', async ({ twitchUsername, bits }) => {
    if (!notifEnabled(aid, 'notify_bits')) return;
    const minimum = parseInt(getSetting(aid, 'notify_bits_minimum') ?? '1', 10);
    if (bits < minimum) return;
    const channel = await fetchChannel(client, aid, 'channel_bits');
    if (!channel) return;
    try { await channel.send(`💎 **${twitchUsername}** cheered **${bits}** bits!`); }
    catch (err) { console.error('[discord] bits error:', err.message); }
  });

  tracker.on('modAction', async ({ action, target, reason, moderator }) => {
    const modLogId = getSetting(aid, 'channel_modlog');
    if (!modLogId) return;
    try {
      const { EmbedBuilder } = await import('discord.js');
      const colors = { ban: 0xff0000, unban: 0x00ff00, timeout: 0xff6600, warn: 0xffa500, purge: 0xffcc00 };
      const icons  = { ban: '🔨', unban: '✅', timeout: '⏱️', warn: '⚠️', purge: '🧹' };
      const embed = new EmbedBuilder()
        .setTitle(`${icons[action] ?? '🔨'} Twitch ${action.charAt(0).toUpperCase() + action.slice(1)}`)
        .addFields(
          { name: 'User',      value: target,                inline: true },
          { name: 'Moderator', value: moderator,             inline: true },
          { name: 'Reason',    value: reason || 'No reason', inline: false },
        )
        .setColor(colors[action] ?? 0x9146ff).setTimestamp();
      const channel = await client.channels.fetch(modLogId);
      await channel.send({ embeds: [embed] });
    } catch (err) { console.error('[discord] modlog error:', err.message); }
  });
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

    if (instances.length === 0 && interaction.commandName !== 'account') {
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
    } else if (instances.length > 1 && interaction.commandName !== 'account') {
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
      getSetting:       (key, fallback = null) => getSetting(inst.account.id, key, fallback),
      setSetting:       (key, value)           => setSetting(inst.account.id, key, value),
      accountManager,
    } : { instances, accountManager };

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

async function assignRoleToMember(client, discordUserId, roleId) {
  try {
    const guilds = client.guilds.cache;
    for (const guild of guilds.values()) {
      try {
        const member = await guild.members.fetch(discordUserId).catch(() => null);
        if (member && !member.roles.cache.has(roleId)) await member.roles.add(roleId);
      } catch {}
    }
  } catch (err) {
    console.error('[discord] role assign error:', err.message);
  }
}

async function removeRoleFromAll(client, roleId) {
  try {
    for (const guild of client.guilds.cache.values()) {
      const members = await guild.members.fetch().catch(() => null);
      if (!members) continue;
      await Promise.all(members.filter(m => m.roles.cache.has(roleId)).map(m => m.roles.remove(roleId).catch(() => {})));
    }
  } catch (err) {
    console.error('[discord] remove live role error:', err.message);
  }
}
