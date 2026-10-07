import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { warnQueries } from '../../db/index.js';

export const modCommand = new SlashCommandBuilder()
  .setName('mod')
  .setDescription('Moderation commands')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)

  .addSubcommand(sub =>
    sub.setName('warn')
      .setDescription('Warn a member')
      .addUserOption(o => o.setName('user').setDescription('Member to warn').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false))
  )
  .addSubcommand(sub =>
    sub.setName('warnings')
      .setDescription('View a member\'s warnings')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
  )
  .addSubcommand(sub =>
    sub.setName('clearwarn')
      .setDescription('Clear all warnings for a member')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
  )
  .addSubcommand(sub =>
    sub.setName('mute')
      .setDescription('Timeout a member')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption(o =>
        o.setName('duration')
          .setDescription('Duration (e.g. 10m, 1h, 1d — max 28d)')
          .setRequired(true)
      )
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false))
  )
  .addSubcommand(sub =>
    sub.setName('unmute')
      .setDescription('Remove timeout from a member')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
  )
  .addSubcommand(sub =>
    sub.setName('kick')
      .setDescription('Kick a member')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false))
  )
  .addSubcommand(sub =>
    sub.setName('ban')
      .setDescription('Ban a member')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false))
      .addIntegerOption(o =>
        o.setName('delete_days')
          .setDescription('Days of messages to delete (0–7)')
          .setMinValue(0)
          .setMaxValue(7)
      )
  )
  .addSubcommand(sub =>
    sub.setName('unban')
      .setDescription('Unban a user by ID')
      .addStringOption(o => o.setName('user_id').setDescription('Discord user ID').setRequired(true))
  );

export async function modHandler(interaction, { getSetting, tracker }) {
  const sub = interaction.options.getSubcommand();
  const wq = warnQueries();
  const modLogChannelId = getSetting('modlog_channel_id');

  async function postModLog(action, target, moderator, reason, extra = '') {
    if (!modLogChannelId) return;
    try {
      const ch = await interaction.client.channels.fetch(modLogChannelId);
      const embed = new EmbedBuilder()
        .setTitle(`🔨 ${action}`)
        .addFields(
          { name: 'User', value: `${target.tag ?? target} (${target.id ?? target})`, inline: true },
          { name: 'Moderator', value: `${moderator.tag}`, inline: true },
          { name: 'Reason', value: reason || 'No reason given', inline: false },
        )
        .setColor(actionColor(action))
        .setTimestamp();
      if (extra) embed.addFields({ name: 'Detail', value: extra, inline: false });
      await ch.send({ embeds: [embed] });
    } catch {}
  }

  // ── warn ────────────────────────────────────────────────────────────────
  if (sub === 'warn') {
    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'No reason given';
    wq.addWarning.run({
      guild_id: interaction.guildId,
      user_id: target.id,
      moderator_id: interaction.user.id,
      reason,
    });
    const count = wq.countWarnings.get(interaction.guildId, target.id).count;
    await interaction.reply({ content: `⚠️ ${target} warned. They now have **${count}** warning(s).\nReason: ${reason}`, ephemeral: false });
    await postModLog('Warn', target.user, interaction.user, reason, `Total warnings: ${count}`);

    try {
      await target.send(`⚠️ You have been warned in **${interaction.guild.name}**.\nReason: ${reason}\nWarning count: ${count}`);
    } catch {}
    return;
  }

  // ── warnings ────────────────────────────────────────────────────────────
  if (sub === 'warnings') {
    const target = interaction.options.getMember('user') ?? interaction.options.getUser('user');
    const warnings = wq.getWarnings.all(interaction.guildId, target.id ?? target.user?.id);
    if (warnings.length === 0) {
      await interaction.reply({ content: `${target} has no warnings.`, ephemeral: true });
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle(`⚠️ Warnings for ${target.user?.username ?? target.username}`)
      .setDescription(
        warnings.slice(0, 10).map((w, i) =>
          `**${i + 1}.** ${new Date(w.created_at).toLocaleDateString()} — ${w.reason || 'No reason'}`
        ).join('\n')
      )
      .setColor(0xffa500);
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  // ── clearwarn ───────────────────────────────────────────────────────────
  if (sub === 'clearwarn') {
    const target = interaction.options.getMember('user');
    wq.clearWarnings.run(interaction.guildId, target.id);
    await interaction.reply({ content: `✅ Cleared all warnings for ${target}.`, ephemeral: true });
    await postModLog('Clear Warnings', target.user, interaction.user, 'Manual clear');
    return;
  }

  // ── mute ────────────────────────────────────────────────────────────────
  if (sub === 'mute') {
    const target = interaction.options.getMember('user');
    const durationStr = interaction.options.getString('duration');
    const reason = interaction.options.getString('reason') || 'No reason given';
    const ms = parseDuration(durationStr);
    if (!ms) { await interaction.reply({ content: `Invalid duration. Use e.g. 10m, 1h, 1d (max 28d).`, ephemeral: true }); return; }
    try {
      await target.timeout(ms, reason);
      await interaction.reply({ content: `🔇 ${target} muted for ${durationStr}. Reason: ${reason}` });
      await postModLog('Mute', target.user, interaction.user, reason, durationStr);
      try { await target.send(`🔇 You have been muted in **${interaction.guild.name}** for ${durationStr}.\nReason: ${reason}`); } catch {}
    } catch (e) {
      await interaction.reply({ content: `❌ Could not mute: ${e.message}`, ephemeral: true });
    }
    return;
  }

  // ── unmute ──────────────────────────────────────────────────────────────
  if (sub === 'unmute') {
    const target = interaction.options.getMember('user');
    try {
      await target.timeout(null);
      await interaction.reply({ content: `✅ ${target} unmuted.` });
      await postModLog('Unmute', target.user, interaction.user, '');
    } catch (e) {
      await interaction.reply({ content: `❌ ${e.message}`, ephemeral: true });
    }
    return;
  }

  // ── kick ────────────────────────────────────────────────────────────────
  if (sub === 'kick') {
    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'No reason given';
    try {
      await target.send(`👢 You have been kicked from **${interaction.guild.name}**.\nReason: ${reason}`).catch(() => {});
      await target.kick(reason);
      await interaction.reply({ content: `✅ ${target.user.tag} kicked. Reason: ${reason}` });
      await postModLog('Kick', target.user, interaction.user, reason);
    } catch (e) {
      await interaction.reply({ content: `❌ ${e.message}`, ephemeral: true });
    }
    return;
  }

  // ── ban ─────────────────────────────────────────────────────────────────
  if (sub === 'ban') {
    const target = interaction.options.getMember('user') ?? interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason given';
    const deleteDays = interaction.options.getInteger('delete_days') ?? 0;
    const user = target.user ?? target;
    try {
      await user.send(`🔨 You have been banned from **${interaction.guild.name}**.\nReason: ${reason}`).catch(() => {});
      await interaction.guild.members.ban(user.id, { reason, deleteMessageDays: deleteDays });
      await interaction.reply({ content: `✅ ${user.tag} banned. Reason: ${reason}` });
      await postModLog('Ban', user, interaction.user, reason);
    } catch (e) {
      await interaction.reply({ content: `❌ ${e.message}`, ephemeral: true });
    }
    return;
  }

  // ── unban ───────────────────────────────────────────────────────────────
  if (sub === 'unban') {
    const userId = interaction.options.getString('user_id');
    try {
      await interaction.guild.members.unban(userId);
      await interaction.reply({ content: `✅ User ${userId} unbanned.` });
      await postModLog('Unban', { tag: userId, id: userId }, interaction.user, '');
    } catch (e) {
      await interaction.reply({ content: `❌ ${e.message}`, ephemeral: true });
    }
    return;
  }
}

function parseDuration(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const ms = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  const result = n * ms;
  if (result > 28 * 86_400_000) return null; // Discord max timeout is 28 days
  return result;
}

function actionColor(action) {
  const colors = {
    Warn: 0xffa500,
    Mute: 0xff6600,
    Kick: 0xff3300,
    Ban: 0xff0000,
    Unban: 0x00ff00,
    Unmute: 0x00cc00,
    'Clear Warnings': 0x00aaff,
  };
  return colors[action] ?? 0x9146ff;
}
