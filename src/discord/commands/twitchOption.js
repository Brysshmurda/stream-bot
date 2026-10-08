import { SlashCommandSubcommandBuilder, SlashCommandSubcommandGroupBuilder } from 'discord.js';

const addOpt = (b) => b.addStringOption(o =>
  o.setName('twitch').setDescription('Twitch channel (only needed if several are linked to this server)').setRequired(false).setAutocomplete(true)
);

// Slash commands can't mix top-level options with subcommands, so the option goes on every leaf subcommand.
export function withTwitchOption(builder, { skipGroups = [] } = {}) {
  const subs = builder.options.filter(o =>
    o instanceof SlashCommandSubcommandBuilder || o instanceof SlashCommandSubcommandGroupBuilder
  );
  if (subs.length === 0) return addOpt(builder);
  for (const s of subs) {
    if (s instanceof SlashCommandSubcommandGroupBuilder) {
      if (!skipGroups.includes(s.name)) s.options.forEach(addOpt);
    } else addOpt(s);
  }
  return builder;
}
