import { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { accountQueries, setSetting } from '../../db/index.js';
import { startDeviceAuth, waitForDeviceToken, validateToken } from '../../twitch/deviceAuth.js';

export const accountCommand = new SlashCommandBuilder()
  .setName('account')
  .setDescription('Manage Twitch account linking for this Discord server')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

  .addSubcommand(sub =>
    sub.setName('setup')
      .setDescription('Get a sign-in link that connects a Twitch channel to this server')
  )
  .addSubcommand(sub =>
    sub.setName('manual')
      .setDescription('Link a Twitch account by pasting tokens (advanced)')
  )
  .addSubcommand(sub =>
    sub.setName('status')
      .setDescription('Show all Twitch accounts linked to this server')
  )
  .addSubcommand(sub =>
    sub.setName('streamer')
      .setDescription('Say which Discord member owns a Twitch channel (only needed if the live role misses them)')
      .addUserOption(o => o.setName('member').setDescription('The streamer\'s Discord account').setRequired(true))
      .addStringOption(o => o.setName('twitch').setDescription('Twitch channel (only needed if several are linked)').setRequired(false).setAutocomplete(true))
  )
  .addSubcommand(sub =>
    sub.setName('remove')
      .setDescription('Unlink a Twitch account from this Discord server')
      .addStringOption(o => o.setName('twitch').setDescription('Twitch channel to unlink (only needed if several are linked)').setRequired(false).setAutocomplete(true))
  );

export async function accountHandler(interaction, { account, instances = [], accountManager }) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'setup') {
    await startLinkFlow(interaction, accountManager);
    return;
  }

  if (sub === 'manual') {
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
    if (instances.length === 0) {
      await interaction.reply({ content: 'No Twitch account is linked to this server. Use `/account setup` to link one.', ephemeral: true });
      return;
    }
    const lines = instances.map(({ account: a, tracker }) =>
      `${tracker.isLive ? '🔴' : '⚫'} **[${a.twitch_channel}](https://twitch.tv/${a.twitch_channel})** — ID \`${a.twitch_broadcaster_id}\`, linked ${new Date(a.created_at).toLocaleDateString()}`
    );
    const embed = new EmbedBuilder()
      .setTitle(`🔗 Linked Twitch Account${instances.length > 1 ? 's' : ''} (${instances.length})`)
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Use /account setup to link another channel' })
      .setColor(0x9146ff);
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === 'streamer') {
    if (!account) {
      const msg = instances.length > 1
        ? `Pick which channel with the \`twitch\` option: ${instances.map(i => `\`${i.account.twitch_channel}\``).join(', ')}`
        : 'No Twitch account is linked to this server yet. Use `/account setup` first.';
      await interaction.reply({ content: msg, ephemeral: true });
      return;
    }
    const member = interaction.options.getUser('member');
    setSetting(account.id, 'streamer_discord_id', member.id);
    await interaction.reply({ content: `✅ ${member} is the streamer for **${account.twitch_channel}** — they'll get the live role when that channel goes live.`, ephemeral: true });
    return;
  }

  if (sub === 'remove') {
    if (!account) {
      const msg = instances.length > 1
        ? `Several Twitch accounts are linked here. Pick one with the \`twitch\` option: ${instances.map(i => `\`${i.account.twitch_channel}\``).join(', ')}`
        : 'No Twitch account is linked to this server.';
      await interaction.reply({ content: msg, ephemeral: true });
      return;
    }
    accountQueries().setGuildId.run(null, account.id);
    accountManager.disableAccount(account.id);
    await interaction.reply({ content: `✅ Unlinked **${account.twitch_channel}** from this Discord server. The Twitch tracking will continue but notifications won't post here.`, ephemeral: true });
    return;
  }
}

async function startLinkFlow(interaction, accountManager) {
  await interaction.deferReply({ ephemeral: true });

  let device;
  try {
    device = await startDeviceAuth();
  } catch (err) {
    console.error('[account setup] device auth error:', err.message);
    await interaction.editReply(`❌ Couldn't start Twitch sign-in: ${err.message}\nYou can still use \`/account manual\`.`);
    return;
  }

  const minutes = Math.floor(device.expires_in / 60);
  const button = new ButtonBuilder().setLabel('Connect Twitch').setStyle(ButtonStyle.Link).setURL(device.verification_uri);
  await interaction.editReply({
    content: [
      '**Send this link to the streamer you want to add** (or click it yourself to add your own channel):',
      device.verification_uri,
      '',
      `They just open it, log in to Twitch and click **Authorize**. If Twitch asks for a code, it's **${device.user_code}**.`,
      `⏳ The link works for ${minutes} minutes. Only share it with that streamer — whoever uses it gets linked to this server.`,
    ].join('\n'),
    components: [new ActionRowBuilder().addComponents(button)],
  });

  // Runs after the reply so the command doesn't block while waiting for the streamer.
  (async () => {
    try {
      const token = await waitForDeviceToken(device);
      const user = await validateToken(token.access_token);
      await accountManager.addAccount({
        id: user.user_id,
        twitch_channel: user.login.toLowerCase(),
        twitch_broadcaster_id: user.user_id,
        discord_guild_id: interaction.guildId,
        access_token: token.access_token,
        refresh_token: token.refresh_token,
      });
      console.log(`[account setup] Linked ${user.login} to guild ${interaction.guildId}`);
      const count = accountManager.getByGuildId(interaction.guildId).length;
      const tip = count > 1 ? ` Commands can target it with \`twitch:${user.login}\`.` : '';
      await interaction.editReply({ content: `✅ **${user.login}** is connected! Go-live alerts and Twitch chat commands are now active.${tip}`, components: [] }).catch(() => {});
      await interaction.channel?.send(`🎉 Twitch channel **${user.login}** is now connected to this server!`).catch(() => {});
    } catch (err) {
      console.error('[account setup] link failed:', err.message);
      await interaction.editReply({ content: `❌ Linking didn't finish: ${err.message}. Run \`/account setup\` to get a fresh link.`, components: [] }).catch(() => {});
    }
  })();
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

    const count = accountManager.getByGuildId(interaction.guildId).length;
    const multiNote = count > 1 ? `\n\nThis server now has **${count}** Twitch channels linked — add \`twitch:${channelName}\` to commands to target this one.` : '';
    await interaction.editReply(`✅ Successfully linked **${channelName}** to this server! Stream tracking and notifications are now active.\n\nUse \`/setup\` to configure notification channels and roles.${multiNote}`);
  } catch (err) {
    console.error('[account setup] error:', err.message);
    await interaction.editReply(`❌ Failed to connect account: ${err.message}\n\nDouble-check your credentials and ensure your tokens have the required Twitch scopes.`);
  }
}
