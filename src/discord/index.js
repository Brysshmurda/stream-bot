import { Client, GatewayIntentBits, Collection, Events, REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { tracker } from '../tracker/index.js';
import { getSetting, setSetting, linkQueries, followerQueries } from '../db/index.js';

// Commands
import { statsCommand, statsHandler } from './commands/stats.js';
import { historyCommand, historyHandler } from './commands/history.js';
import { topgamesCommand, topgamesHandler } from './commands/topgames.js';
import { linkCommand, linkHandler } from './commands/link.js';
import { setupCommand, setupHandler } from './commands/setup.js';
import { modCommand, modHandler } from './commands/mod.js';

const COMMANDS = [
  { data: statsCommand,    execute: statsHandler },
  { data: historyCommand,  execute: historyHandler },
  { data: topgamesCommand, execute: topgamesHandler },
  { data: linkCommand,     execute: linkHandler },
  { data: setupCommand,    execute: setupHandler },
  { data: modCommand,      execute: modHandler },
];

export async function startDiscord() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
    ],
  });

  client.commands = new Collection();
  for (const cmd of COMMANDS) {
    client.commands.set(cmd.data.name, cmd);
  }

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

  // ── Tracker events → Discord ──────────────────────────────────────────

  tracker.on('streamStart', async (stream) => {
    const channelId = config.discord.announceChannelId || getSetting('announce_channel_id');
    if (!channelId) return;
    try {
      const channel = await client.channels.fetch(channelId);
      const { EmbedBuilder } = await import('discord.js');
      const embed = new EmbedBuilder()
        .setTitle(`🔴 ${config.twitch.channelName} is now LIVE!`)
        .setDescription(`**${stream.title}**`)
        .addFields(
          { name: '🎮 Game', value: stream.gameName || 'Unknown', inline: true },
          { name: '🔗 Watch', value: `https://twitch.tv/${config.twitch.channelName}`, inline: true }
        )
        .setColor(0x9146ff)
        .setTimestamp();
      await channel.send({ embeds: [embed] });

      // Give Live role if configured
      const liveRoleId = config.discord.liveRoleId || getSetting('live_role_id');
      if (liveRoleId) await assignRoleToLinkedMembers(client, liveRoleId, 'live');
    } catch (err) {
      console.error('[discord] stream announce error:', err.message);
    }
  });

  tracker.on('streamEnd', async (finalStream) => {
    const channelId = config.discord.announceChannelId || getSetting('announce_channel_id');
    if (!channelId) return;
    try {
      const channel = await client.channels.fetch(channelId);
      const { EmbedBuilder } = await import('discord.js');
      const avg = finalStream.viewer_samples > 0
        ? Math.round(finalStream.viewer_total / finalStream.viewer_samples)
        : 0;
      const embed = new EmbedBuilder()
        .setTitle(`📴 Stream ended`)
        .addFields(
          { name: '⏱ Duration', value: tracker.formatDuration(finalStream.duration_seconds), inline: true },
          { name: '👀 Peak Viewers', value: String(finalStream.peak_viewers), inline: true },
          { name: '📊 Avg Viewers', value: String(avg), inline: true },
        )
        .setColor(0x6441a5)
        .setTimestamp();
      await channel.send({ embeds: [embed] });

      // Remove Live role
      const liveRoleId = config.discord.liveRoleId || getSetting('live_role_id');
      if (liveRoleId) await removeRoleFromAllMembers(client, liveRoleId);
    } catch (err) {
      console.error('[discord] stream end announce error:', err.message);
    }
  });

  tracker.on('follow', async ({ twitchUserId, twitchUsername }) => {
    const followerRoleId = config.discord.followerRoleId || getSetting('follower_role_id');
    const channelId = config.discord.announceChannelId || getSetting('announce_channel_id');
    if (!followerRoleId && !channelId) return;

    try {
      // Check if this Twitch user has a linked Discord account
      const link = linkQueries().getByTwitchId.get(twitchUserId);
      if (link && followerRoleId) {
        await assignRoleToDiscordUser(client, link.discord_user_id, followerRoleId);
      }

      if (channelId) {
        const channel = await client.channels.fetch(channelId);
        await channel.send(`❤️ **${twitchUsername}** just followed on Twitch!`);
      }
    } catch (err) {
      console.error('[discord] follow event error:', err.message);
    }
  });

  tracker.on('subscribe', async ({ twitchUserId, twitchUsername, tier, isGift }) => {
    const subRoleId = config.discord.subscriberRoleId || getSetting('subscriber_role_id');
    const channelId = config.discord.announceChannelId || getSetting('announce_channel_id');

    try {
      const link = linkQueries().getByTwitchId.get(twitchUserId);
      if (link && subRoleId) {
        await assignRoleToDiscordUser(client, link.discord_user_id, subRoleId);
      }
      if (channelId && !isGift) {
        const channel = await client.channels.fetch(channelId);
        const tierName = tier === '3000' ? 'Tier 3' : tier === '2000' ? 'Tier 2' : 'Tier 1';
        await channel.send(`⭐ **${twitchUsername}** just subscribed (${tierName})!`);
      }
    } catch (err) {
      console.error('[discord] sub event error:', err.message);
    }
  });

  tracker.on('subGift', async ({ gifterUsername, amount }) => {
    const channelId = config.discord.announceChannelId || getSetting('announce_channel_id');
    if (!channelId) return;
    try {
      const channel = await client.channels.fetch(channelId);
      await channel.send(`🎁 **${gifterUsername}** gifted **${amount}** sub${amount > 1 ? 's' : ''}!`);
    } catch (err) {
      console.error('[discord] subgift error:', err.message);
    }
  });

  tracker.on('cheer', async ({ twitchUsername, bits }) => {
    const channelId = config.discord.announceChannelId || getSetting('announce_channel_id');
    if (!channelId) return;
    try {
      const channel = await client.channels.fetch(channelId);
      await channel.send(`💎 **${twitchUsername}** cheered **${bits}** bits!`);
    } catch (err) {
      console.error('[discord] cheer error:', err.message);
    }
  });

  // ── Twitch mod actions → Discord mod log ──────────────────────────────

  tracker.on('modAction', async ({ action, target, reason, moderator }) => {
    const modLogId = getSetting('modlog_channel_id');
    if (!modLogId) return;
    try {
      const { EmbedBuilder } = await import('discord.js');
      const colors = { ban: 0xff0000, unban: 0x00ff00, timeout: 0xff6600, warn: 0xffa500, purge: 0xffcc00 };
      const icons = { ban: '🔨', unban: '✅', timeout: '⏱', warn: '⚠️', purge: '🧹' };
      const embed = new EmbedBuilder()
        .setTitle(`${icons[action] ?? '🔨'} Twitch ${action.charAt(0).toUpperCase() + action.slice(1)}`)
        .addFields(
          { name: 'User', value: target, inline: true },
          { name: 'Moderator', value: moderator, inline: true },
          { name: 'Reason', value: reason || 'No reason given', inline: false },
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

// ── Helpers ──────────────────────────────────────────────────────────────────

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

async function assignRoleToDiscordUser(client, discordUserId, roleId) {
  try {
    const guild = await client.guilds.fetch(config.discord.guildId);
    const member = await guild.members.fetch(discordUserId);
    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(roleId);
      console.log(`[discord] Assigned role ${roleId} to ${member.user.username}`);
    }
  } catch (err) {
    console.error(`[discord] role assign error:`, err.message);
  }
}

async function assignRoleToLinkedMembers(client, roleId) {
  // Used for Live role — give to all members with a linked Twitch account
  // (optional: only viewers, but we can't know from Discord side)
}

async function removeRoleFromAllMembers(client, roleId) {
  try {
    const guild = await client.guilds.fetch(config.discord.guildId);
    const members = await guild.members.fetch();
    const promises = members
      .filter(m => m.roles.cache.has(roleId))
      .map(m => m.roles.remove(roleId).catch(() => {}));
    await Promise.all(promises);
  } catch (err) {
    console.error('[discord] remove live role error:', err.message);
  }
}
