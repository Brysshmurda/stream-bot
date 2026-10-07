import { EventEmitter } from 'events';
import { getDb, streamQueries, gameQueries, followerQueries, getSetting } from '../db/index.js';

// Central stream state + event bus
export class StreamTracker extends EventEmitter {
  constructor() {
    super();
    this._currentStream = null;
    this._viewerPollInterval = null;
    this._twitchApi = null; // set after init
  }

  setTwitchApi(api) {
    this._twitchApi = api;
  }

  get currentStream() {
    return this._currentStream;
  }

  get isLive() {
    return this._currentStream !== null;
  }

  // ── Called by EventSub ──────────────────────────────────────────────────

  streamStarted({ streamId, title, gameName, gameId, startedAt }) {
    const db = getDb();
    const sq = streamQueries(db);
    const gq = gameQueries(db);

    sq.upsertStream.run({
      stream_id: streamId,
      title,
      started_at: startedAt,
    });

    gq.openSegment.run({
      stream_id: streamId,
      game_id: gameId || null,
      game_name: gameName || 'Just Chatting',
      started_at: startedAt,
    });

    this._currentStream = { streamId, title, gameName, gameId, startedAt, peakViewers: 0 };
    this._startViewerPoll();
    this.emit('streamStart', this._currentStream);
    console.log(`[tracker] Stream started: "${title}" playing ${gameName}`);
  }

  streamEnded({ streamId }) {
    if (!this._currentStream) return;
    this._stopViewerPoll();

    const db = getDb();
    const sq = streamQueries(db);
    const gq = gameQueries(db);

    const endedAt = new Date().toISOString();
    const row = sq.getStream.get(streamId);
    if (!row) return;

    const durationSeconds = Math.floor(
      (new Date(endedAt) - new Date(row.started_at)) / 1000
    );

    gq.closeOpenSegments.run({ stream_id: streamId, ended_at: endedAt });
    sq.closeStream.run({
      stream_id: streamId,
      ended_at: endedAt,
      duration_seconds: durationSeconds,
      peak_viewers: row.peak_viewers,
      viewer_total: row.viewer_total,
      viewer_samples: row.viewer_samples,
    });

    const finalRow = sq.getStream.get(streamId);
    this.emit('streamEnd', finalRow);
    console.log(`[tracker] Stream ended after ${Math.floor(durationSeconds / 60)}m`);
    this._currentStream = null;
  }

  gameChanged({ streamId, gameName, gameId }) {
    if (!this._currentStream) return;
    const db = getDb();
    const gq = gameQueries(db);
    const now = new Date().toISOString();

    gq.closeOpenSegments.run({ stream_id: streamId, ended_at: now });
    gq.openSegment.run({
      stream_id: streamId,
      game_id: gameId || null,
      game_name: gameName || 'Unknown',
      started_at: now,
    });

    this._currentStream.gameName = gameName;
    this._currentStream.gameId = gameId;
    this.emit('gameChange', { streamId, gameName, gameId });
    console.log(`[tracker] Game changed to: ${gameName}`);
  }

  newFollower({ twitchUserId, twitchUsername, followedAt }) {
    const fq = followerQueries();
    fq.upsertFollower.run({
      twitch_user_id: twitchUserId,
      twitch_username: twitchUsername,
      followed_at: followedAt,
    });
    this.emit('follow', { twitchUserId, twitchUsername, followedAt });
    console.log(`[tracker] New follower: ${twitchUsername}`);
  }

  recordViewerCount(streamId, count) {
    const db = getDb();
    const sq = streamQueries(db);

    sq.addViewerSnapshot.run({
      stream_id: streamId,
      viewer_count: count,
      recorded_at: new Date().toISOString(),
    });
    sq.updateStreamPeak.run({ stream_id: streamId, viewers: count });

    if (this._currentStream) {
      this._currentStream.peakViewers = Math.max(this._currentStream.peakViewers, count);
      this._currentStream.currentViewers = count;
    }
  }

  // ── Viewer polling ──────────────────────────────────────────────────────

  _startViewerPoll() {
    this._stopViewerPoll();
    this._viewerPollInterval = setInterval(() => this._pollViewers(), 60_000);
  }

  _stopViewerPoll() {
    if (this._viewerPollInterval) {
      clearInterval(this._viewerPollInterval);
      this._viewerPollInterval = null;
    }
  }

  async _pollViewers() {
    if (!this._currentStream || !this._twitchApi) return;
    try {
      const { broadcasterId } = await import('../config.js').then(m => ({ broadcasterId: m.config.twitch.broadcasterId }));
      const stream = await this._twitchApi.streams.getStreamByUserId(broadcasterId);
      if (stream) {
        this.recordViewerCount(this._currentStream.streamId, stream.viewers);
      }
    } catch (err) {
      console.error('[tracker] viewer poll error:', err.message);
    }
  }

  // ── Queries used by Discord commands ────────────────────────────────────

  getRecentStreams(limit = 10) {
    return streamQueries().getRecentStreams.all(limit);
  }

  getTopGames(limit = 10) {
    return gameQueries().topGames.all(limit);
  }

  formatDuration(seconds) {
    if (!seconds) return '0m';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
}

export const tracker = new StreamTracker();
