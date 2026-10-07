import { Client, GatewayIntentBits, Collection, Events, REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { tracker } from '../tracker/index.js';
import { getSetting, setSetting, linkQueries, followerQueries } from '../db/index.js';

import { statsCommand, statsHandler } from './commands/stats.js';
import { historyCommand, historyHandler } from './commands/history.js';
import { topgamesCommand, topgamesHandler } from './commands/topgames.js';
import { linkCommand, linkHandler } from './commands/link.js';
import { setupCommand, setupHandler } from './commands/setup.js';
import { modCommand, modHandler } from './commands/mod.js';
import { bannedwordsCommand, bannedwordsHandler } from './commands/bannedwords.js';

const COMMANDS = [
  { data: statsCommand,       execute: statsHandler },
  { data: historyCommand,     execute: historyHandler },
  { data: topgamesCommand,    execute: topgamesHandler },
  { data: linkCommand,        execute: linkHandler },
  { data: setupCommand,       execute: setupHandler },
  { data: modCommand,         execute: modHandler },
  { data: bannedwordsCommand, execute: bannedwordsHandler },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Resolve a channel: check specific key first, fall back to announce channel
function getChannelId(specificKey) {
  return getSetting(specificKey) || getSetting('channel_announce');
}

function notifEnabled(key, defaultOn = true) {
  const val = getSetting(key);
  return val === null ? defaultOn : val !== 'false';
}

async function fetchChannel(client, key) {
  const id = getChannelId(key);
  if (!id) return null;
  try { return await client.channels.fetch(id); } catch { return null; }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function startDiscord() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
    ],
  });

  client.commands = new Collection();
  for (const cmd of COMMANDS) client.commands.set(cmd.data.name, cmd);

  client.once(Events.ClientReady, async (c) => {
    console.log(`[discord] Logged in as ${c.user.tag}`);
    await registerCommands(client);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) return;
    try {
      await cmd.execute(interaction, { tracker, config, getSetting, setSetting, linkQueries, followerQueries });
    } catch (err) {
      console.error(`[discord] Command error (${interaction.commandName}):`, err);
      const reply = { content: 'Something went wrong running that command.', ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
      else await interaction.reply(reply);
    }
  });

  // ── Stream live ─────────────────────────────────────────────────────────

  tracker.on('streamStart', async (stream) => {
    if (!notifEnabled('notify_stream_live')) return;
    const channel = await fetchChannel(client, 'channel_announce');
    if (!channel) return;
    try {
      const { EmbedBuilder } = await import('discord.js');
      const embed = new EmbedBuilder()
        .setTitle(`🔴 ${config.twitch.channelName} is now LIVE!`)
        .setDescription(`**${stream.title}**`)
        .addFields(
          { name: '🎮 Game', value: stream.gameName || 'Unknown', inline: true },
          { name: '🔗 Watch', value: `[twitch.tv/${config.twitch.channelName}](https://twitch.tv/${config.twitch.channelName})`, inline: true }
        )
        .setColor(0x9146ff)
        .setTimestamp();
      await channel.send({ embeds: [embed] });

      const liveRoleId = getSetting('role_live');
      if (liveRoleId) await assignRoleToAll(client, liveRoleId);
    } catch (err) {
      console.error('[discord] stream announce error:', err.message);
    }
  });

  // ── Stream end ──────────────────────────────────────────────────────────

  tracker.on('streamEnd', async (finalStream) => {
    if (!notifEnabled('notify_stream_end')) return;
    const channel = await fetchChannel(client, 'channel_announce');
    if (!channel) return;
    try {
      const { EmbedBuilder } = await import('discord.js');
      const avg = finalStream.viewer_samples > 0
        ? Math.round(finalStream.viewer_total / finalStream.viewer_samples)
        : 0;
      const embed = new EmbedBuilder()
        .setTitle('📴 Stream ended')
        .addFields(
          { name: '⏱ Duration',     value: tracker.formatDuration(finalStream.duration_seconds), inline: true },
          { name: '👀 Peak Viewers', value: String(finalStream.peak_viewers),                     inline: true },
          { name: '📊 Avg Viewers',  value: String(avg),                                          inline: true },
        )
        .setColor(0x6441a5)
        .setTimestamp();
      await channel.send({ embeds: [embed] });

      const liveRoleId = getSetting('role_live');
      if (liveRoleId) await removeRoleFromAll(client, liveRoleId);
    } catch (err) {
      console.error('[discord] stream end error:', err.message);
    }
  });

  // ── New follower ────────────────────────────────────────────────────────

  tracker.on('follow', async ({ twitchUserId, twitchUsername }) => {
    const followerRoleId = getSetting('role_follower');
    const link = linkQueries().getByTwitchId.get(twitchUserId);

    if (link && followerRoleId) {
      await assignRoleToMember(client, link.discord_user_id, followerRoleId);
    }

    if (!notifEnabled('notify_follows')) return;
    const channel = await fetchChannel(client, 'channel_follows');
    if (!channel) return;
    try {
      await channel.send(`❤️ **${twitchUsername}** just followed on Twitch!`);
    } catch (err) {
      console.error('[discord] follow notify error:', err.message);
    }
  });

  // ── New subscriber ──────────────────────────────────────────────────────

  tracker.on('subscribe', async ({ twitchUserId, twitchUsername, tier, isGift }) => {
    const subRoleId = getSetting('role_subscriber');
    const link = linkQueries().getByTwitchId.get(twitchUserId);

    if (link && subRoleId) {
      await assignRoleToMember(client, link.discord_user_id, subRoleId);
    }

    if (isGift) return; // gift subs are handled by subGift event
    if (!notifEnabled('notify_subs')) return;
    const channel = await fetchChannel(client, 'channel_subs');
    if (!channel) return;
    try {
      const tierName = tier === '3000' ? 'Tier 3' : tier === '2000' ? 'Tier 2' : 'Tier 1';
      await channel.send(`⭐ **${twitchUsername}** just subscribed (${tierName})!`);
    } catch (err) {
      console.error('[discord] sub notify error:', err.message);
    }
  });

  // ── Gift subs ───────────────────────────────────────────────────────────

  tracker.on('subGift', async ({ gifterUsername, amount }) => {
    if (!notifEnabled('notify_giftsubs')) return;
    const channel = await fetchChannel(client, 'channel_subs');
    if (!channel) return;
    try {
      await channel.send(`🎁 **${gifterUsername}** gifted **${amount}** sub${amount > 1 ? 's' : ''}!`);
    } catch (err) {
      console.error('[discord] subgift error:', err.message);
    }
  });

  // ── Bits ────────────────────────────────────────────────────────────────

  tracker.on('cheer', async ({ twitchUsername, bits }) => {
    if (!notifEnabled('notify_bits')) return;
    const minimum = parseInt(getSetting('notify_bits_minimum') ?? '1', 10);
    if (bits < minimum) return;
    const channel = await fetchChannel(client, 'channel_bits');
    if (!channel) return;
    try {
      await channel.send(`💎 **${twitchUsername}** cheered **${bits}** bits!`);
    } catch (err) {
      console.error('[discord] bits error:', err.message);
    }
  });

  // ── Twitch mod actions → mod log ────────────────────────────────────────

  tracker.on('modAction', async ({ action, target, reason, moderator }) => {
    const modLogId = getSetting('channel_modlog');
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
        .setColor(colors[action] ?? 0x9146ff)
        .setTimestamp();
      const channel = await client.channels.fetch(modLogId);
      await channel.send({ embeds: [embed] });
    } catch (err) {
      console.error('[discord] modlog error:', err.message);
    }
  });

  await client.login(config.discord.token);
  return client;
}

// ── Internals ─────────────────────────────────────────────────────────────────

async function registerCommands(client) {
  const rest = new REST().setToken(config.discord.token);
  const body = COMMANDS.map(c => c.data.toJSON());
  try {
    await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
      { body }
    );
    console.log(`[discord] Registered ${body.length} slash commands`);
  } catch (err) {
    console.error('[discord] Failed to register commands:', err.message);
  }
}

async function assignRoleToMember(client, discordUserId, roleId) {
  try {
    const guild = await client.guilds.fetch(config.discord.guildId);
    const member = await guild.members.fetch(discordUserId);
    if (!member.roles.cache.has(roleId)) await member.roles.add(roleId);
  } catch (err) {
    console.error('[discord] role assign error:', err.message);
  }
}

async function assignRoleToAll(client, roleId) {
  // intentionally a no-op — @everyone gets Live role via announcements,
  // not by bulk-assigning to every member (Discord rate limits make this impractical)
}

async function removeRoleFromAll(client, roleId) {
  try {
    const guild = await client.guilds.fetch(config.discord.guildId);
    const members = await guild.members.fetch();
    await Promise.all(
      members.filter(m => m.roles.cache.has(roleId)).map(m => m.roles.remove(roleId).catch(() => {}))
    );
  } catch (err) {
    console.error('[discord] remove live role error:', err.message);
  }
}
