import { EventSubWsListener } from '@twurple/eventsub-ws';

export async function startEventSub({ apiClient, broadcasterId, tracker, getCurrentStream }) {
  const listener = new EventSubWsListener({ apiClient });
  await listener.start();

  await listener.onStreamOnline(broadcasterId, async (event) => {
    await new Promise(r => setTimeout(r, 3000));
    const stream = await getCurrentStream();
    tracker.streamStarted({
      streamId: event.id,
      title: stream?.title ?? 'Untitled Stream',
      gameName: stream?.gameName ?? 'Just Chatting',
      gameId: stream?.gameId ?? null,
      startedAt: event.startDate?.toISOString() ?? new Date().toISOString(),
    });
  });

  await listener.onStreamOffline(broadcasterId, () => {
    if (tracker.isLive) {
      tracker.streamEnded({ streamId: tracker.currentStream.streamId });
    }
  });

  await listener.onChannelUpdate(broadcasterId, (event) => {
    if (!tracker.isLive) return;
    tracker.gameChanged({
      streamId: tracker.currentStream.streamId,
      gameName: event.categoryName ?? 'Unknown',
      gameId: event.categoryId ?? null,
    });
  });

  await listener.onChannelFollow(broadcasterId, broadcasterId, (event) => {
    tracker.newFollower({
      twitchUserId: event.userId,
      twitchUsername: event.userName,
      followedAt: event.followDate?.toISOString() ?? new Date().toISOString(),
    });
  });

  await listener.onChannelSubscription(broadcasterId, (event) => {
    tracker.emit('subscribe', { twitchUserId: event.userId, twitchUsername: event.userName, tier: event.tier, isGift: event.isGift });
  });

  await listener.onChannelSubscriptionGift(broadcasterId, (event) => {
    tracker.emit('subGift', { gifterUsername: event.gifterName ?? 'Anonymous', amount: event.amount, tier: event.tier });
  });

  await listener.onChannelCheer(broadcasterId, (event) => {
    tracker.emit('cheer', { twitchUsername: event.userDisplayName ?? 'Anonymous', bits: event.bits, message: event.message });
  });

  console.log(`[eventsub] Listening for ${broadcasterId}`);
  return listener;
}
