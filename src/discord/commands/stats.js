import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getCurrentStream } from '../../twitch/api.js';

export const statsCommand = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Show current stream stats, or last stream if offline');

export async function statsHandler(interaction, { tracker }) {
  await interaction.deferReply();

  if (tracker.isLive) {
    // Live stats
    const cur = tracker.currentStream;
    const stream = await getCurrentStream();
    const uptimeSecs = Math.floor((Date.now() - new Date(cur.startedAt)) / 1000);

    const embed = new EmbedBuilder()
      .setTitle('🔴 Stream is LIVE')
      .setDescription(`**${stream?.title ?? cur.title}**`)
      .addFields(
        { name: '🎮 Game',       value: cur.gameName || 'Unknown',                      inline: true },
        { name: '⏱ Uptime',     value: tracker.formatDuration(uptimeSecs),             inline: true },
        { name: '👀 Viewers',   value: String(stream?.viewers ?? cur.currentViewers ?? 0), inline: true },
        { name: '📈 Peak',      value: String(cur.peakViewers),                         inline: true },
        { name: '🔗 Watch',     value: `[twitch.tv/${process.env.TWITCH_CHANNEL_NAME}](https://twitch.tv/${process.env.TWITCH_CHANNEL_NAME})`, inline: true },
      )
      .setColor(0x00ff00)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Last stream stats
  const recent = tracker.getRecentStreams(1);
  if (recent.length === 0) {
    await interaction.editReply('No stream history recorded yet.');
    return;
  }

  const s = recent[0];
  const avg = s.viewer_samples > 0
    ? Math.round(s.viewer_total / s.viewer_samples)
    : 0;

  const embed = new EmbedBuilder()
    .setTitle('📊 Last Stream Stats')
    .setDescription(s.title ? `**${s.title}**` : 'No title recorded')
    .addFields(
      { name: '📅 Date',        value: new Date(s.started_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }), inline: true },
      { name: '⏱ Duration',    value: tracker.formatDuration(s.duration_seconds),  inline: true },
      { name: '📈 Peak',       value: String(s.peak_viewers),                      inline: true },
      { name: '📊 Avg Viewers', value: String(avg),                                inline: true },
    )
    .setColor(0x9146ff)
    .setFooter({ text: 'Stream ended' })
    .setTimestamp(new Date(s.ended_at ?? s.started_at));

  await interaction.editReply({ embeds: [embed] });
}
