// Run this standalone to register slash commands: node src/discord/deploy-commands.js
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { statsCommand } from './commands/stats.js';
import { historyCommand } from './commands/history.js';
import { topgamesCommand } from './commands/topgames.js';
import { linkCommand } from './commands/link.js';
import { setupCommand } from './commands/setup.js';
import { modCommand } from './commands/mod.js';
import { bannedwordsCommand } from './commands/bannedwords.js';
import { accountCommand } from './commands/account.js';

const commands = [
  statsCommand,
  historyCommand,
  topgamesCommand,
  linkCommand,
  setupCommand,
  modCommand,
  bannedwordsCommand,
  accountCommand,
].map(c => c.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  console.log(`Registering ${commands.length} slash commands...`);
  await rest.put(
    Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
    { body: commands }
  );
  console.log('Done.');
})();
