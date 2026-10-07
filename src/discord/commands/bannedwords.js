import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';

export const bannedwordsCommand = new SlashCommandBuilder()
  .setName('bannedwords')
  .setDescription('Manage the Twitch chat banned word list')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addSubcommand(sub =>
    sub.setName('add')
      .setDescription('Add a word to the banned list')
      .addStringOption(o => o.setName('word').setDescription('Word or phrase to ban').setRequired(true))
      .addStringOption(o =>
        o.setName('action').setDescription('What to do when the word is detected (default: delete)').setRequired(false)
          .addChoices({ name: 'Delete message only', value: 'delete' }, { name: 'Timeout user', value: 'timeout' }, { name: 'Permanent ban', value: 'ban' })
      )
      .addIntegerOption(o =>
        o.setName('timeout_seconds').setDescription('Timeout duration in seconds (only used if action is timeout, default: 300)').setMinValue(1).setMaxValue(1209600).setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub.setName('remove')
      .setDescription('Remove a word from the banned list')
      .addStringOption(o => o.setName('word').setDescription('Word to remove').setRequired(true))
  )
  .addSubcommand(sub =>
    sub.setName('list').setDescription('Show all banned words')
  );

export async function bannedwordsHandler(interaction, { scopedQ }) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'add') {
    const word = interaction.options.getString('word').toLowerCase().trim();
    const action = interaction.options.getString('action') ?? 'delete';
    const duration = interaction.options.getInteger('timeout_seconds') ?? 300;
    scopedQ.bannedWords.add.run({ word, action, duration, added_by: interaction.user.username });
    const actionDesc = { delete: 'delete message', timeout: `timeout ${duration}s`, ban: 'permanent ban' };
    await interaction.reply({ content: `✅ Added **"${word}"** to the banned list → action: **${actionDesc[action]}**`, ephemeral: true });
    return;
  }

  if (sub === 'remove') {
    const word = interaction.options.getString('word').toLowerCase().trim();
    const result = scopedQ.bannedWords.remove.run(word);
    if (result.changes === 0) {
      await interaction.reply({ content: `"${word}" was not in the banned list.`, ephemeral: true });
    } else {
      await interaction.reply({ content: `✅ Removed **"${word}"** from the banned list.`, ephemeral: true });
    }
    return;
  }

  if (sub === 'list') {
    const words = scopedQ.bannedWords.getAll.all();
    if (words.length === 0) {
      await interaction.reply({ content: 'No banned words configured yet. Use `/bannedwords add` to add one.', ephemeral: true });
      return;
    }
    const actionIcon = { delete: '🗑️', timeout: '⏱️', ban: '🔨' };
    const lines = words.map(w => `${actionIcon[w.action] ?? '❓'} \`${w.word}\`${w.action === 'timeout' ? ` (${w.duration}s)` : ''}`);
    const embed = new EmbedBuilder()
      .setTitle(`🚫 Banned Words (${words.length})`)
      .setDescription(lines.join('\n'))
      .setColor(0xff0000)
      .setFooter({ text: '🗑️ delete  ⏱️ timeout  🔨 ban' });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}
