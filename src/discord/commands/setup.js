import { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
import { withTwitchOption } from './twitchOption.js';

const ON_OFF = [{ name: 'On', value: 'true' }, { name: 'Off', value: 'false' }];

function channelOpt(opt) {
  return opt.addChannelTypes(ChannelType.GuildText);
}

export const setupCommand = withTwitchOption(new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure the stream bot')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

  // ── /setup view ──────────────────────────────────────────────────────────
  .addSubcommand(sub =>
    sub.setName('view')
      .setDescription('Show all current bot settings')
  )

  // ── /setup reset ─────────────────────────────────────────────────────────
  .addSubcommand(sub =>
    sub.setName('reset')
      .setDescription('Reset ALL bot settings to defaults (does not affect stream history)')
  )

  // ── /setup channels ──────────────────────────────────────────────────────
  .addSubcommandGroup(group =>
    group.setName('channels')
      .setDescription('Set which channels receive each type of notification')
      .addSubcommand(sub =>
        sub.setName('announce')
          .setDescription('Main channel for stream live/offline announcements (used as fallback for others)')
          .addChannelOption(o => channelOpt(o.setName('channel').setDescription('Channel (leave blank to clear)').setRequired(false)))
      )
      .addSubcommand(sub =>
        sub.setName('follows')
          .setDescription('Channel for new follower notifications (defaults to announce channel)')
          .addChannelOption(o => channelOpt(o.setName('channel').setDescription('Channel (leave blank to use announce channel)').setRequired(false)))
      )
      .addSubcommand(sub =>
        sub.setName('subs')
          .setDescription('Channel for new subscriber notifications (defaults to announce channel)')
          .addChannelOption(o => channelOpt(o.setName('channel').setDescription('Channel (leave blank to use announce channel)').setRequired(false)))
      )
      .addSubcommand(sub =>
        sub.setName('bits')
          .setDescription('Channel for bits/cheer notifications (defaults to announce channel)')
          .addChannelOption(o => channelOpt(o.setName('channel').setDescription('Channel (leave blank to use announce channel)').setRequired(false)))
      )
      .addSubcommand(sub =>
        sub.setName('modlog')
          .setDescription('Channel where all mod actions are logged (Twitch + Discord)')
          .addChannelOption(o => channelOpt(o.setName('channel').setDescription('Channel (leave blank to clear)').setRequired(false)))
      )
  )

  // ── /setup roles ─────────────────────────────────────────────────────────
  .addSubcommandGroup(group =>
    group.setName('roles')
      .setDescription('Set which roles are assigned automatically')
      .addSubcommand(sub =>
        sub.setName('follower')
          .setDescription('Role given when a Twitch follower links their Discord account')
          .addRoleOption(o => o.setName('role').setDescription('Role (leave blank to clear)').setRequired(false))
      )
      .addSubcommand(sub =>
        sub.setName('subscriber')
          .setDescription('Role given when a Twitch subscriber links their Discord account')
          .addRoleOption(o => o.setName('role').setDescription('Role (leave blank to clear)').setRequired(false))
      )
      .addSubcommand(sub =>
        sub.setName('live')
          .setDescription('Role given to the streamer while they are live, removed when the stream ends')
          .addRoleOption(o => o.setName('role').setDescription('Role (leave blank to clear)').setRequired(false))
          .addUserOption(o => o.setName('streamer').setDescription('The Discord member who owns this Twitch channel').setRequired(false))
      )
  )

  // ── /setup notifications ──────────────────────────────────────────────────
  .addSubcommandGroup(group =>
    group.setName('notifications')
      .setDescription('Toggle which events trigger Discord notifications')
      .addSubcommand(sub =>
        sub.setName('all')
          .setDescription('Turn every notification on/off and optionally pick a channel for each type')
          .addStringOption(o => o.setName('value').setDescription('On or off').setRequired(true).addChoices(...ON_OFF))
          .addChannelOption(o => channelOpt(o.setName('live').setDescription('Channel for live/offline posts (also the fallback for the others)').setRequired(false)))
          .addChannelOption(o => channelOpt(o.setName('follows').setDescription('Channel for new followers').setRequired(false)))
          .addChannelOption(o => channelOpt(o.setName('subs').setDescription('Channel for subs and gift subs').setRequired(false)))
          .addChannelOption(o => channelOpt(o.setName('bits').setDescription('Channel for bits/cheers').setRequired(false)))
          .addChannelOption(o => channelOpt(o.setName('modlog').setDescription('Channel for mod action logs').setRequired(false)))
      )
      .addSubcommand(sub =>
        sub.setName('stream-live')
          .setDescription('Announce when the stream goes live')
          .addStringOption(o => o.setName('value').setDescription('On or off').setRequired(true).addChoices(...ON_OFF))
      )
      .addSubcommand(sub =>
        sub.setName('stream-end')
          .setDescription('Post a summary when the stream ends')
          .addStringOption(o => o.setName('value').setDescription('On or off').setRequired(true).addChoices(...ON_OFF))
      )
      .addSubcommand(sub =>
        sub.setName('follows')
          .setDescription('Announce new Twitch followers')
          .addStringOption(o => o.setName('value').setDescription('On or off').setRequired(true).addChoices(...ON_OFF))
      )
      .addSubcommand(sub =>
        sub.setName('subs')
          .setDescription('Announce new Twitch subscribers')
          .addStringOption(o => o.setName('value').setDescription('On or off').setRequired(true).addChoices(...ON_OFF))
      )
      .addSubcommand(sub =>
        sub.setName('giftsubs')
          .setDescription('Announce gift sub bombs')
          .addStringOption(o => o.setName('value').setDescription('On or off').setRequired(true).addChoices(...ON_OFF))
      )
      .addSubcommand(sub =>
        sub.setName('bits')
          .setDescription('Announce Twitch bits/cheers')
          .addStringOption(o => o.setName('value').setDescription('On or off').setRequired(true).addChoices(...ON_OFF))
      )
      .addSubcommand(sub =>
        sub.setName('bits-minimum')
          .setDescription('Minimum bits required to trigger a notification (default: 1)')
          .addIntegerOption(o => o.setName('amount').setDescription('Minimum bits').setMinValue(1).setMaxValue(100000).setRequired(true))
      )
  )

  // ── /setup automod ────────────────────────────────────────────────────────
  .addSubcommandGroup(group =>
    group.setName('automod')
      .setDescription('Configure the Twitch chat auto-mod engine')
      .addSubcommand(sub =>
        sub.setName('master')
          .setDescription('Enable or disable the entire auto-mod system')
          .addStringOption(o => o.setName('value').setDescription('On or off').setRequired(true).addChoices(...ON_OFF))
      )
      .addSubcommand(sub =>
        sub.setName('links')
          .setDescription('Block links in chat (use !permit to allow individuals)')
          .addStringOption(o => o.setName('value').setDescription('On or off').setRequired(true).addChoices(...ON_OFF))
      )
      .addSubcommand(sub =>
        sub.setName('caps')
          .setDescription('Flag messages with excessive capital letters')
          .addStringOption(o => o.setName('value').setDescription('On or off').setRequired(true).addChoices(...ON_OFF))
      )
      .addSubcommand(sub =>
        sub.setName('caps-threshold')
          .setDescription('Percentage of caps that triggers the filter (default: 75%)')
          .addIntegerOption(o => o.setName('percent').setDescription('Percentage (50–95)').setMinValue(50).setMaxValue(95).setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('spam')
          .setDescription('Flag repeated identical messages')
          .addStringOption(o => o.setName('value').setDescription('On or off').setRequired(true).addChoices(...ON_OFF))
      )
      .addSubcommand(sub =>
        sub.setName('spam-count')
          .setDescription('How many identical messages within the window triggers the filter (default: 4)')
          .addIntegerOption(o => o.setName('count').setDescription('Message count (2–10)').setMinValue(2).setMaxValue(10).setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('spam-window')
          .setDescription('Time window in seconds for spam detection (default: 10s)')
          .addIntegerOption(o => o.setName('seconds').setDescription('Seconds (5–60)').setMinValue(5).setMaxValue(60).setRequired(true))
      )
  ));

// ── Handler ───────────────────────────────────────────────────────────────────

export async function setupHandler(interaction, { getSetting, setSetting, scopedQ }) {
  const sub = interaction.options.getSubcommand();
  const group = interaction.options.getSubcommandGroup(false);

  if (sub === 'view') {
    await handleView(interaction, getSetting);
    return;
  }

  if (sub === 'reset') {
    const keys = [
      'channel_announce','channel_follows','channel_subs','channel_bits','channel_modlog',
      'role_follower','role_subscriber','role_live','streamer_discord_id',
      'notify_stream_live','notify_stream_end','notify_follows','notify_subs',
      'notify_giftsubs','notify_bits','notify_bits_minimum',
      'automod_enabled','automod_links','automod_caps','automod_caps_threshold',
      'automod_spam','automod_spam_count','automod_spam_window',
    ];
    for (const k of keys) setSetting(k, null);
    await interaction.reply({ content: '✅ All settings have been reset to defaults.', ephemeral: true });
    return;
  }

  if (group === 'channels') {
    const keyMap = { announce: 'channel_announce', follows: 'channel_follows', subs: 'channel_subs', bits: 'channel_bits', modlog: 'channel_modlog' };
    const channel = interaction.options.getChannel('channel');
    setSetting(keyMap[sub], channel?.id ?? null);
    let msg = channel ? `✅ **${sub}** channel set to ${channel}` : `✅ **${sub}** channel cleared (will use announce channel as fallback)`;
    const missing = channel ? missingPerms(channel) : [];
    if (missing.length) msg += `\n⚠️ I can't post there yet — give me **${missing.join(', ')}** in ${channel}.`;
    await interaction.reply({ content: msg, ephemeral: true });
    return;
  }

  if (group === 'notifications' && sub === 'all') {
    await handleNotificationsAll(interaction, getSetting, setSetting);
    return;
  }

  if (group === 'roles') {
    const keyMap = { follower: 'role_follower', subscriber: 'role_subscriber', live: 'role_live' };
    const role = interaction.options.getRole('role');
    const streamer = sub === 'live' ? interaction.options.getUser('streamer') : null;
    if (role || !streamer) setSetting(keyMap[sub], role?.id ?? null);
    let msg = role ? `✅ **${sub}** role set to ${role}` : streamer ? `✅ Streamer set to ${streamer}` : `✅ **${sub}** role cleared`;

    if (sub === 'live') {
      if (streamer) setSetting('streamer_discord_id', streamer.id);
      const streamerId = getSetting('streamer_discord_id');
      if (getSetting('role_live')) {
        msg += streamerId
          ? `\n🎙️ <@${streamerId}> gets it when they go live and loses it when the stream ends.`
          : '\n⚠️ No streamer picked yet. Re-run with the `streamer` option, or have them run `/link twitch` with their own channel name.';
      }
    }

    const me = interaction.guild.members.me;
    if (role && me) {
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) msg += '\n⚠️ I need the **Manage Roles** permission to give out this role.';
      else if (role.position >= me.roles.highest.position) msg += `\n⚠️ My role must be **above** ${role} in Server Settings → Roles, or Discord won't let me assign it.`;
    }
    await interaction.reply({ content: msg, ephemeral: true });
    return;
  }

  if (group === 'notifications') {
    const keyMap = {
      'stream-live': 'notify_stream_live',
      'stream-end': 'notify_stream_end',
      'follows': 'notify_follows',
      'subs': 'notify_subs',
      'giftsubs': 'notify_giftsubs',
      'bits': 'notify_bits',
      'bits-minimum': 'notify_bits_minimum',
    };
    if (sub === 'bits-minimum') {
      const amount = interaction.options.getInteger('amount');
      setSetting('notify_bits_minimum', String(amount));
      await interaction.reply({ content: `✅ Bits minimum set to **${amount}**`, ephemeral: true });
    } else {
      const value = interaction.options.getString('value');
      setSetting(keyMap[sub], value);
      await interaction.reply({ content: `✅ **${sub}** notifications turned **${value === 'true' ? 'ON' : 'OFF'}**`, ephemeral: true });
    }
    return;
  }

  if (group === 'automod') {
    const boolKeys = { master: 'automod_enabled', links: 'automod_links', caps: 'automod_caps', spam: 'automod_spam' };
    const numKeys = { 'caps-threshold': { key: 'automod_caps_threshold', opt: 'percent' }, 'spam-count': { key: 'automod_spam_count', opt: 'count' }, 'spam-window': { key: 'automod_spam_window', opt: 'seconds' } };

    if (boolKeys[sub]) {
      const value = interaction.options.getString('value');
      setSetting(boolKeys[sub], value);
      await interaction.reply({ content: `✅ Auto-mod **${sub}** turned **${value === 'true' ? 'ON' : 'OFF'}**`, ephemeral: true });
    } else if (numKeys[sub]) {
      const { key, opt } = numKeys[sub];
      const value = interaction.options.getInteger(opt);
      setSetting(key, String(value));
      await interaction.reply({ content: `✅ Auto-mod **${sub}** set to **${value}**`, ephemeral: true });
    }
    return;
  }
}

// ── /setup notifications all ──────────────────────────────────────────────────

const NOTIFY_KEYS = ['notify_stream_live', 'notify_stream_end', 'notify_follows', 'notify_subs', 'notify_giftsubs', 'notify_bits'];

const ROUTES = [
  { opt: 'live',    key: 'channel_announce', label: '🔴 Live / offline' },
  { opt: 'follows', key: 'channel_follows',  label: '❤️ Follows' },
  { opt: 'subs',    key: 'channel_subs',     label: '⭐ Subs & gift subs' },
  { opt: 'bits',    key: 'channel_bits',     label: '💎 Bits' },
  { opt: 'modlog',  key: 'channel_modlog',   label: '🔨 Mod log' },
];

function missingPerms(channel) {
  const me = channel.guild?.members?.me;
  if (!me || typeof channel.permissionsFor !== 'function') return [];
  const perms = channel.permissionsFor(me);
  return [['ViewChannel', 'View Channel'], ['SendMessages', 'Send Messages'], ['EmbedLinks', 'Embed Links']]
    .filter(([flag]) => !perms?.has(PermissionFlagsBits[flag]))
    .map(([, name]) => name);
}

async function handleNotificationsAll(interaction, getSetting, setSetting) {
  const value = interaction.options.getString('value');
  for (const k of NOTIFY_KEYS) setSetting(k, value);

  for (const { opt, key } of ROUTES) {
    const ch = interaction.options.getChannel(opt);
    if (ch) setSetting(key, ch.id);
  }

  const announceId = getSetting('channel_announce');
  const warnings = [];
  const lines = [];
  for (const { opt, key, label } of ROUTES) {
    const ownId = getSetting(key);
    const id = ownId ?? (key === 'channel_modlog' ? null : announceId);
    if (!id) { lines.push(`${label} → _nowhere_`); continue; }
    lines.push(`${label} → <#${id}>${ownId || key === 'channel_announce' ? '' : ' _(live channel)_'}`);
    const ch = interaction.options.getChannel(opt) ?? interaction.guild.channels.cache.get(id);
    const missing = ch ? missingPerms(ch) : [];
    if (missing.length && !warnings.some(w => w.includes(`<#${id}>`))) {
      warnings.push(`⚠️ I need **${missing.join(', ')}** in <#${id}>`);
    }
  }
  if (value === 'true' && !announceId) warnings.unshift('⚠️ No live channel set, so live/follow/sub/bits posts have nowhere to go. Re-run with the `live` option.');

  const embed = new EmbedBuilder()
    .setTitle(`🔔 All notifications turned ${value === 'true' ? 'ON' : 'OFF'}`)
    .setDescription([...lines, ...(warnings.length ? ['', ...warnings] : [])].join('\n'))
    .setColor(value === 'true' ? 0x00c853 : 0x9e9e9e)
    .setFooter({ text: 'Fine-tune with /setup notifications <type> or /setup channels <type>' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ── /setup view ───────────────────────────────────────────────────────────────

async function handleView(interaction, getSetting) {
  await interaction.deferReply({ ephemeral: true });

  const g = (key, fallback = '_not set_') => getSetting(key) ?? fallback;
  const ch = (key) => { const id = getSetting(key); return id ? `<#${id}>` : '_not set_'; };
  const role = (key) => { const id = getSetting(key); return id ? `<@&${id}>` : '_not set_'; };
  const bool = (key, def = true) => (getSetting(key) ?? String(def)) !== 'false' ? '✅ On' : '❌ Off';

  const announceId = getSetting('channel_announce');

  const embed = new EmbedBuilder()
    .setTitle('⚙️ Bot Settings')
    .setColor(0x9146ff)
    .addFields(
      {
        name: '📢 Channels',
        value: [
          `**Announce:** ${ch('channel_announce')}`,
          `**Follows:** ${getSetting('channel_follows') ? `<#${getSetting('channel_follows')}>` : `_uses announce_`}`,
          `**Subs:** ${getSetting('channel_subs') ? `<#${getSetting('channel_subs')}>` : `_uses announce_`}`,
          `**Bits:** ${getSetting('channel_bits') ? `<#${getSetting('channel_bits')}>` : `_uses announce_`}`,
          `**Mod log:** ${ch('channel_modlog')}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '🎭 Roles',
        value: [
          `**Follower:** ${role('role_follower')}`,
          `**Subscriber:** ${role('role_subscriber')}`,
          `**Live:** ${role('role_live')}${getSetting('streamer_discord_id') ? ` → given to <@${getSetting('streamer_discord_id')}>` : ''}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '🔔 Notifications',
        value: [
          `**Stream live:** ${bool('notify_stream_live')}`,
          `**Stream end:** ${bool('notify_stream_end')}`,
          `**Follows:** ${bool('notify_follows')}`,
          `**Subs:** ${bool('notify_subs')}`,
          `**Gift subs:** ${bool('notify_giftsubs')}`,
          `**Bits:** ${bool('notify_bits')} (min: ${g('notify_bits_minimum', '1')} bits)`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '🛡️ Auto-Mod',
        value: [
          `**Master switch:** ${bool('automod_enabled')}`,
          `**Link filter:** ${bool('automod_links')}`,
          `**Caps filter:** ${bool('automod_caps')} (threshold: ${g('automod_caps_threshold', '75')}%)`,
          `**Spam filter:** ${bool('automod_spam')} (${g('automod_spam_count', '4')} repeats in ${g('automod_spam_window', '10')}s)`,
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'Use /setup <group> <setting> to change anything' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
