import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getTwitchApi } from '../../twitch/api.js';
import { linkQueries, followerQueries } from '../../db/index.js';
import { config } from '../../config.js';

export const linkCommand = new SlashCommandBuilder()
  .setName('link')
  .setDescription('Link your Discord account to your Twitch username')
  .addSubcommand(sub =>
    sub.setName('twitch')
      .setDescription('Link your Twitch account')
      .addStringOption(opt =>
        opt.setName('username')
          .setDescription('Your Twitch username')
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('remove')
      .setDescription('Remove your linked Twitch account')
  )
  .addSubcommand(sub =>
    sub.setName('status')
      .setDescription('Check your current link status')
  );

export async function linkHandler(interaction, { getSetting }) {
  const sub = interaction.options.getSubcommand();
  const lq = linkQueries();

  if (sub === 'remove') {
    lq.removeByDiscordId.run(interaction.user.id);
    await interaction.reply({ content: '✅ Your Twitch account has been unlinked.', ephemeral: true });
    return;
  }

  if (sub === 'status') {
    const existing = lq.getByDiscordId.get(interaction.user.id);
    if (!existing) {
      await interaction.reply({ content: 'You have no Twitch account linked. Use `/link twitch` to link one.', ephemeral: true });
    } else {
      await interaction.reply({
        content: `✅ Linked to Twitch account: **${existing.twitch_username}**`,
        ephemeral: true,
      });
    }
    return;
  }

  // sub === 'twitch'
  await interaction.deferReply({ ephemeral: true });
  const twitchUsername = interaction.options.getString('username').toLowerCase().trim();

  let twitchUser;
  try {
    const api = await getTwitchApi();
    twitchUser = await api.users.getUserByName(twitchUsername);
  } catch (err) {
    await interaction.editReply(`Could not look up Twitch user "${twitchUsername}". Please check the username.`);
    return;
  }

  if (!twitchUser) {
    await interaction.editReply(`Twitch user **${twitchUsername}** was not found.`);
    return;
  }

  lq.upsertLink.run({
    discord_user_id: interaction.user.id,
    twitch_user_id: twitchUser.id,
    twitch_username: twitchUser.name,
  });

  // Check if this user is already a follower — if so, assign role immediately
  const followerRoleId = getSetting('role_follower');
  const follower = followerQueries().getByTwitchId.get(twitchUser.id);

  let roleMsg = '';
  if (follower && followerRoleId) {
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.has(followerRoleId)) {
        await member.roles.add(followerRoleId);
        roleMsg = '\n🎉 You\'ve been given the **Follower** role!';
      }
    } catch {}
  }

  const subRoleId = config.discord.subscriberRoleId || getSetting('subscriber_role_id');
  // (subscriber check would require an API call; skipping for now — handled on sub event)

  await interaction.editReply(`✅ Linked Discord account to Twitch **${twitchUser.displayName}**.${roleMsg}`);
}
