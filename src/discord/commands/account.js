import { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { accountQueries } from '../../db/index.js';

export const accountCommand = new SlashCommandBuilder()
  .setName('account')
  .setDescription('Manage Twitch account linking for this Discord server')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

  .addSubcommand(sub =>
    sub.setName('setup')
      .setDescription('Link a Twitch account to this Discord server (opens a form)')
  )
  .addSubcommand(sub =>
    sub.setName('status')
      .setDescription('Show the currently linked Twitch account')
  )
  .addSubcommand(sub =>
    sub.setName('remove')
      .setDescription('Unlink this Discord server from its Twitch account')
  );

export async function accountHandler(interaction, { account, accountManager }) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'setup') {
    const modal = new ModalBuilder()
      .setCustomId('account_setup_modal')
      .setTitle('Link Twitch Account');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('channel_name').setLabel('Twitch Channel Name').setStyle(TextInputStyle.Short).setPlaceholder('yourchannelname').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('broadcaster_id').setLabel('Twitch Broadcaster ID').setStyle(TextInputStyle.Short).setPlaceholder('123456789').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('access_token').setLabel('Twitch Access Token').setStyle(TextInputStyle.Short).setPlaceholder('xxxxxxxxxxxxxx').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('refresh_token').setLabel('Twitch Refresh Token').setStyle(TextInputStyle.Short).setPlaceholder('xxxxxxxxxxxxxx').setRequired(true)
      ),
    );

    await interaction.showModal(modal);
    return;
  }

  if (sub === 'status') {
    if (!account) {
      await interaction.reply({ content: 'No Twitch account is linked to this server. Use `/account setup` to link one.', ephemeral: true });
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle('🔗 Linked Twitch Account')
      .addFields(
        { name: 'Channel', value: `twitch.tv/${account.twitch_channel}`, inline: true },
        { name: 'Broadcaster ID', value: account.twitch_broadcaster_id, inline: true },
        { name: 'Linked at', value: new Date(account.created_at).toLocaleDateString(), inline: true },
      )
      .setColor(0x9146ff);
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === 'remove') {
    if (!account) {
      await interaction.reply({ content: 'No Twitch account is linked to this server.', ephemeral: true });
      return;
    }
    accountQueries().setGuildId.run(null, account.id);
    accountManager.disableAccount(account.id);
    await interaction.reply({ content: `✅ Unlinked **${account.twitch_channel}** from this Discord server. The Twitch tracking will continue but notifications won't post here.`, ephemeral: true });
    return;
  }
}

export async function handleAccountSetupModal(interaction, accountManager) {
  await interaction.deferReply({ ephemeral: true });

  const channelName = interaction.fields.getTextInputValue('channel_name').toLowerCase().trim();
  const broadcasterId = interaction.fields.getTextInputValue('broadcaster_id').trim();
  const accessToken = interaction.fields.getTextInputValue('access_token').trim();
  const refreshToken = interaction.fields.getTextInputValue('refresh_token').trim();

  if (!/^\d+$/.test(broadcasterId)) {
    await interaction.editReply('❌ Broadcaster ID must be numeric. Find it at https://www.streamweasels.com/tools/convert-twitch-username-to-user-id/');
    return;
  }

  try {
    const inst = await accountManager.addAccount({
      id: broadcasterId,
      twitch_channel: channelName,
      twitch_broadcaster_id: broadcasterId,
      discord_guild_id: interaction.guildId,
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    await interaction.editReply(`✅ Successfully linked **${channelName}** to this server! Stream tracking and notifications are now active.\n\nUse \`/setup\` to configure notification channels and roles.`);
  } catch (err) {
    console.error('[account setup] error:', err.message);
    await interaction.editReply(`❌ Failed to connect account: ${err.message}\n\nDouble-check your credentials and ensure your tokens have the required Twitch scopes.`);
  }
}
