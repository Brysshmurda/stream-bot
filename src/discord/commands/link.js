import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getLinkByDiscordId, removeLinks, saveLink } from '../../db/index.js';
import { followerRoleKey } from './setup.js';

export const linkCommand = new SlashCommandBuilder()
  .setName('link')
  .setDescription('Link your Discord account to your Twitch username')
  .addSubcommand(sub =>
    sub.setName('twitch')
      .setDescription('Link your Twitch account')
      .addStringOption(opt =>
        opt.setName('username').setDescription('Your Twitch username').setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('remove')
      .setDescription('Remove your linked Twitch account (admins can remove someone else\'s)')
      .addUserOption(o => o.setName('member').setDescription('Admins only: whose link to remove').setRequired(false))
  )
  .addSubcommand(sub =>
    sub.setName('status').setDescription('Check your link and re-check your follower role')
  );

// Twitch only reports new follows, so ask it directly which linked channels this person already follows,
// and give each one's follower role (or the server-wide one where a channel has none).
async function syncFollowerRole(interaction, instances, twitchUserId, getSetting) {
  const roleFor = (i) => getSetting(followerRoleKey(i.account.id)) ?? getSetting('role_follower');
  const checked = await Promise.all(instances.map(async (i) => ({
    i, follows: Boolean(await i.getFollowAge(twitchUserId).catch(() => null)),
  })));
  const followedInsts = checked.filter(c => c.follows).map(c => c.i);
  const followed = followedInsts.map(i => i.account.twitch_channel);

  const notFollowedWithRole = instances.filter(i => !followedInsts.includes(i) && roleFor(i));
  const hint = notFollowedWithRole.length
    ? `\nFollow ${notFollowedWithRole.map(i => `**${i.account.twitch_channel}**`).join(' or ')} on Twitch to get ${notFollowedWithRole.length > 1 ? 'their' : 'its'} follower role.`
    : '';

  const roleIds = [...new Set(followedInsts.map(roleFor).filter(Boolean))];
  if (!roleIds.length) return { followed, note: hint };

  try {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const missing = roleIds.filter(r => !member.roles.cache.has(r));
    if (missing.length) await member.roles.add(missing);
    const given = missing.length ? `\n🎉 You've been given ${missing.map(r => `<@&${r}>`).join(', ')}!` : '';
    return { followed, note: given + hint };
  } catch (err) {
    console.error('[link] follower role error:', err.message);
    return { followed, note: '\n⚠️ You follow, but I couldn\'t give you the follower role. An admin needs to check my **Manage Roles** permission and that my role is above the follower roles.' + hint };
  }
}

export async function linkHandler(interaction, { instances = [], getSetting }) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'remove') {
    const target = interaction.options.getUser('member');
    if (target && target.id !== interaction.user.id) {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: 'Only admins (Manage Server) can remove someone else\'s link.', ephemeral: true });
        return;
      }
      const removed = removeLinks(target.id);
      await interaction.reply({ content: removed ? `✅ Removed ${target}'s Twitch link.` : `${target} had no Twitch account linked.`, ephemeral: true });
      return;
    }
    const removed = removeLinks(interaction.user.id);
    await interaction.reply({ content: removed ? '✅ Your Twitch account has been unlinked.' : 'You had no Twitch account linked.', ephemeral: true });
    return;
  }

  if (instances.length === 0) {
    await interaction.reply({ content: 'No Twitch channel is connected to this server yet, so there\'s nothing to link to.', ephemeral: true });
    return;
  }

  if (sub === 'status') {
    const existing = getLinkByDiscordId(interaction.user.id);
    if (!existing) {
      await interaction.reply({ content: 'You have no Twitch account linked. Use `/link twitch` to link one.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const { followed, note } = await syncFollowerRole(interaction, instances, existing.twitch_user_id, getSetting);
    const follows = followed.length ? `\nFollowing: ${followed.map(c => `**${c}**`).join(', ')}` : '';
    await interaction.editReply(`✅ Linked to Twitch account: **${existing.twitch_username}**${follows}${note}`);
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const twitchUsername = interaction.options.getString('username').toLowerCase().trim().replace(/^@/, '');

  let twitchUser;
  try {
    twitchUser = await instances[0].apiClient.users.getUserByName(twitchUsername);
  } catch {
    await interaction.editReply(`Could not look up Twitch user "${twitchUsername}". Please check the username.`);
    return;
  }
  if (!twitchUser) {
    await interaction.editReply(`Twitch user **${twitchUsername}** was not found.`);
    return;
  }

  const saved = saveLink(interaction.guildId, {
    discord_user_id: interaction.user.id,
    twitch_user_id: twitchUser.id,
    twitch_username: twitchUser.name,
  });
  if (!saved.ok) {
    await interaction.editReply(`❌ **${twitchUser.displayName}** is already linked to another Discord account (<@${saved.ownerId}>). They need to run \`/link remove\` first — or ask an admin if it isn't really theirs.`);
    return;
  }

  const { note } = await syncFollowerRole(interaction, instances, twitchUser.id, getSetting);
  await interaction.editReply(`✅ Linked Discord account to Twitch **${twitchUser.displayName}**.${note}`);
}
