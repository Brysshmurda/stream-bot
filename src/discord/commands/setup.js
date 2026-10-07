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
    sub.setName('modlog')
      .setDescription('Set the channel where mod actions are logged')
      .addChannelOption(opt =>
        opt.setName('channel')
          .setDescription('Mod log channel')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('automod')
      .setDescription('Enable or disable the Twitch auto-mod engine')
      .addStringOption(opt =>
        opt.setName('setting')
          .setDescription('Feature to toggle')
          .setRequired(true)
          .addChoices(
            { name: 'Auto-mod (master switch)', value: 'automod_enabled' },
            { name: 'Link filter', value: 'automod_links' },
            { name: 'Caps filter', value: 'automod_caps' },
            { name: 'Spam/repeat filter', value: 'automod_spam' },
          )
      )
      .addStringOption(opt =>
        opt.setName('value')
          .setDescription('on or off')
          .setRequired(true)
          .addChoices({ name: 'On', value: 'true' }, { name: 'Off', value: 'false' })
      )
  )
  .addSubcommand(sub =>
    sub.setName('show')
      .setDescription('Show current bot configuration')
  );

export async function setupHandler(interaction, { getSetting, setSetting }) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'show') {
    const announceId    = getSetting('announce_channel_id');
    const followerRole  = getSetting('follower_role_id');
    const subRole       = getSetting('subscriber_role_id');
    const liveRole      = getSetting('live_role_id');
    const modlogId      = getSetting('modlog_channel_id');
    const automod       = getSetting('automod_enabled') !== 'false' ? 'on' : 'off';
    const links         = getSetting('automod_links') !== 'false' ? 'on' : 'off';
    const caps          = getSetting('automod_caps') !== 'false' ? 'on' : 'off';
    const spam          = getSetting('automod_spam') !== 'false' ? 'on' : 'off';

    const lines = [
      `**Announce channel:** ${announceId ? `<#${announceId}>` : '_not set_'}`,
      `**Mod log channel:** ${modlogId ? `<#${modlogId}>` : '_not set_'}`,
      `**Follower role:** ${followerRole ? `<@&${followerRole}>` : '_not set_'}`,
      `**Subscriber role:** ${subRole ? `<@&${subRole}>` : '_not set_'}`,
      `**Live role:** ${liveRole ? `<@&${liveRole}>` : '_not set_'}`,
      `**Auto-mod:** ${automod} | Links: ${links} | Caps: ${caps} | Spam: ${spam}`,
    ];

    await interaction.reply({ content: lines.join('\n'), ephemeral: true });
    return;
  }

  if (sub === 'modlog') {
    const channel = interaction.options.getChannel('channel');
    setSetting('modlog_channel_id', channel.id);
    await interaction.reply({ content: `✅ Mod log channel set to ${channel}`, ephemeral: true });
    return;
  }

  if (sub === 'automod') {
    const setting = interaction.options.getString('setting');
    const value = interaction.options.getString('value');
    setSetting(setting, value);
    const labels = {
      automod_enabled: 'Auto-mod master switch',
      automod_links: 'Link filter',
      automod_caps: 'Caps filter',
      automod_spam: 'Spam/repeat filter',
    };
    await interaction.reply({ content: `✅ ${labels[setting]} set to **${value === 'true' ? 'ON' : 'OFF'}**`, ephemeral: true });
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
