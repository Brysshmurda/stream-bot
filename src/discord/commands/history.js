import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const historyCommand = new SlashCommandBuilder()
  .setName('history')
  .setDescription('Show recent stream history')
  .addIntegerOption(opt =>
    opt.setName('count')
      .setDescription('Number of streams to show (1–10, default 5)')
      .setMinValue(1)
      .setMaxValue(10)
  );

export async function historyHandler(interaction, { tracker }) {
  await interaction.deferReply();

  const count = interaction.options.getInteger('count') ?? 5;
  const streams = tracker.getRecentStreams(count);

  if (streams.length === 0) {
    await interaction.editReply('No stream history recorded yet.');
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`📋 Last ${streams.length} Stream${streams.length > 1 ? 's' : ''}`)
    .setColor(0x9146ff);

  const lines = streams.map((s, i) => {
    const date = new Date(s.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const dur = tracker.formatDuration(s.duration_seconds);
    const avg = s.viewer_samples > 0 ? Math.round(s.viewer_total / s.viewer_samples) : 0;
    return `**${i + 1}.** ${date} · ${dur} · 📈 ${s.peak_viewers} peak · 📊 ${avg} avg`;
  });

  embed.setDescription(lines.join('\n'));
  await interaction.editReply({ embeds: [embed] });
}
