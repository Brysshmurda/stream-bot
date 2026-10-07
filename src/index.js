import { getDb } from './db/index.js';
import { accountManager } from './accounts/manager.js';
import { startDiscord } from './discord/index.js';

async function main() {
  console.log('[boot] Initializing stream bot...');

  getDb();
  console.log('[boot] Database ready');

  const discordClient = await startDiscord(accountManager);
  console.log('[boot] Discord ready');

  accountManager.setDiscordClient(discordClient);
  await accountManager.loadAll();

  console.log('[boot] All systems running');
}

main().catch(err => {
  console.error('[boot] Fatal error:', err);
  process.exit(1);
});
