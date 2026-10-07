import { SlashCommandBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';

export const setupCommand = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure the stream bot (admin only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(sub =>
    sub.setName('announce')
      .setDescription('Set the channel for stream announcements')
      .addChannelOption(opt =>
        opt.setName('channel')
          .setDescription('Announcement channel')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('follower-role')
      .setDescription('Set the role given to Twitch followers who link their account')
      .addRoleOption(opt =>
        opt.setName('role').setDescription('Follower role').setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('subscriber-role')
      .setDescription('Set the role given to Twitch subscribers who link their account')
      .addRoleOption(opt =>
        opt.setName('role').setDescription('Subscriber role').setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('live-role')
      .setDescription('Role given to everyone when the stream goes live')
      .addRoleOption(opt =>
        opt.setName('role').setDescription('Live role').setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('show')
      .setDescription('Show current bot configuration')
  );

export async function setupHandler(interaction, { getSetting, setSetting }) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'show') {
    const announceId = getSetting('announce_channel_id');
    const followerRoleId = getSetting('follower_role_id');
    const subscriberRoleId = getSetting('subscriber_role_id');
    const liveRoleId = getSetting('live_role_id');

    const lines = [
      `**Announce channel:** ${announceId ? `<#${announceId}>` : '_not set_'}`,
      `**Follower role:** ${followerRoleId ? `<@&${followerRoleId}>` : '_not set_'}`,
      `**Subscriber role:** ${subscriberRoleId ? `<@&${subscriberRoleId}>` : '_not set_'}`,
      `**Live role:** ${liveRoleId ? `<@&${liveRoleId}>` : '_not set_'}`,
    ];

    await interaction.reply({ content: lines.join('\n'), ephemeral: true });
    return;
  }

  if (sub === 'announce') {
    const channel = interaction.options.getChannel('channel');
    setSetting('announce_channel_id', channel.id);
    await interaction.reply({ content: `✅ Announce channel set to ${channel}`, ephemeral: true });
    return;
  }

  if (sub === 'follower-role') {
    const role = interaction.options.getRole('role');
    setSetting('follower_role_id', role.id);
    await interaction.reply({ content: `✅ Follower role set to ${role}`, ephemeral: true });
    return;
  }

  if (sub === 'subscriber-role') {
    const role = interaction.options.getRole('role');
    setSetting('subscriber_role_id', role.id);
    await interaction.reply({ content: `✅ Subscriber role set to ${role}`, ephemeral: true });
    return;
  }

  if (sub === 'live-role') {
    const role = interaction.options.getRole('role');
    setSetting('live_role_id', role.id);
    await interaction.reply({ content: `✅ Live role set to ${role}`, ephemeral: true });
    return;
  }
}
