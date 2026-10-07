import { config } from './config.js';
import { getDb } from './db/index.js';
import { tracker } from './tracker/index.js';
import { getTwitchApi, getAuthProvider, getCurrentStream } from './twitch/api.js';
import { startEventSub } from './twitch/eventsub.js';
import { startChatBot } from './twitch/chat.js';
import { startDiscord } from './discord/index.js';

async function main() {
  console.log('[boot] Initializing stream bot...');

  // Database
  getDb();
  console.log('[boot] Database ready');

  // Twitch API
  const api = await getTwitchApi();
  tracker.setTwitchApi(api);
  console.log('[boot] Twitch API ready');

  // Check if we're already live at startup
  const liveStream = await getCurrentStream().catch(() => null);
  if (liveStream) {
    console.log(`[boot] Stream is already live: "${liveStream.title}"`);
    tracker.streamStarted({
      streamId: liveStream.id,
      title: liveStream.title,
      gameName: liveStream.gameName,
      gameId: liveStream.gameId,
      startedAt: liveStream.startDate?.toISOString() ?? new Date().toISOString(),
    });
  }

  // EventSub WebSocket
  const authProvider = await getAuthProvider();
  await startEventSub(authProvider);

  // Twitch chat bot
  startChatBot();

  // Discord bot
  await startDiscord();

  console.log('[boot] All systems running');
}

main().catch(err => {
  console.error('[boot] Fatal error:', err);
  process.exit(1);
});
