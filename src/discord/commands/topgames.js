import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const topgamesCommand = new SlashCommandBuilder()
  .setName('topgames')
  .setDescription('Show the most-played games on stream')
  .addIntegerOption(opt =>
    opt.setName('count')
      .setDescription('Number of games to show (1–15, default 10)')
      .setMinValue(1)
      .setMaxValue(15)
  );

export async function topgamesHandler(interaction, { tracker }) {
  await interaction.deferReply();

  const count = interaction.options.getInteger('count') ?? 10;
  const games = tracker.getTopGames(count);

  if (games.length === 0) {
    await interaction.editReply('No game data recorded yet.');
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('🎮 Most Played Games')
    .setColor(0x9146ff);

  const lines = games.map((g, i) => {
    const hours = (g.total_seconds / 3600).toFixed(1);
    const streams = g.stream_count;
    return `**${i + 1}.** ${g.game_name} — ${hours}h across ${streams} stream${streams > 1 ? 's' : ''}`;
  });

  embed.setDescription(lines.join('\n'));
  await interaction.editReply({ embeds: [embed] });
}
