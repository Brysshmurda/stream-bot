import { EventSubWsListener } from '@twurple/eventsub-ws';
import { config } from '../config.js';
import { tracker } from '../tracker/index.js';
import { getCurrentStream } from './api.js';

export async function startEventSub(authProvider) {
  const listener = new EventSubWsListener({ apiClient: null, authProvider });

  // Re-wire: EventSubWsListener needs the apiClient, not just authProvider.
  // We pass authProvider and it builds its own ApiClient internally.
  await listener.start();

  const broadcasterId = config.twitch.broadcasterId;

  // ── Stream online ──────────────────────────────────────────────────────
  await listener.onStreamOnline(broadcasterId, async (event) => {
    // Fetch full stream info (title, game) since the online event is minimal
    await new Promise(r => setTimeout(r, 3000)); // brief delay for Twitch to populate
    const stream = await getCurrentStream();
    tracker.streamStarted({
      streamId: event.id,
      title: stream?.title ?? 'Untitled Stream',
      gameName: stream?.gameName ?? 'Just Chatting',
      gameId: stream?.gameId ?? null,
      startedAt: event.startDate?.toISOString() ?? new Date().toISOString(),
    });
  });

  // ── Stream offline ─────────────────────────────────────────────────────
  await listener.onStreamOffline(broadcasterId, (event) => {
    if (tracker.isLive) {
      tracker.streamEnded({ streamId: tracker.currentStream.streamId });
    }
  });

  // ── Channel update (title / game change) ──────────────────────────────
  await listener.onChannelUpdate(broadcasterId, (event) => {
    if (!tracker.isLive) return;
    tracker.gameChanged({
      streamId: tracker.currentStream.streamId,
      gameName: event.categoryName ?? 'Unknown',
      gameId: event.categoryId ?? null,
    });
  });

  // ── New follower ───────────────────────────────────────────────────────
  await listener.onChannelFollow(broadcasterId, broadcasterId, (event) => {
    tracker.newFollower({
      twitchUserId: event.userId,
      twitchUsername: event.userName,
      followedAt: event.followDate?.toISOString() ?? new Date().toISOString(),
    });
  });

  // ── New subscriber ─────────────────────────────────────────────────────
  await listener.onChannelSubscription(broadcasterId, (event) => {
    tracker.emit('subscribe', {
      twitchUserId: event.userId,
      twitchUsername: event.userName,
      tier: event.tier,
      isGift: event.isGift,
    });
  });

  // ── Gift subs ──────────────────────────────────────────────────────────
  await listener.onChannelSubscriptionGift(broadcasterId, (event) => {
    tracker.emit('subGift', {
      gifterUsername: event.gifterName ?? 'Anonymous',
      amount: event.amount,
      tier: event.tier,
    });
  });

  // ── Bits ───────────────────────────────────────────────────────────────
  await listener.onChannelCheer(broadcasterId, (event) => {
    tracker.emit('cheer', {
      twitchUsername: event.userDisplayName ?? 'Anonymous',
      bits: event.bits,
      message: event.message,
    });
  });

  console.log('[eventsub] Listening on WebSocket');
  return listener;
}
