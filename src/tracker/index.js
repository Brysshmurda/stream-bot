import { EventEmitter } from 'events';
import { scopedQueries } from '../db/index.js';

export class StreamTracker extends EventEmitter {
  constructor(accountId) {
    super();
    this._accountId = accountId;
    this._currentStream = null;
    this._viewerPollInterval = null;
    this._twitchApi = null;
  }

  setTwitchApi(api) {
    this._twitchApi = api;
  }

  get currentStream() { return this._currentStream; }
  get isLive() { return this._currentStream !== null; }

  streamStarted({ streamId, title, gameName, gameId, startedAt }) {
    const sq = scopedQueries(this._accountId);
    sq.streams.upsert.run({ stream_id: streamId, title, started_at: startedAt });
    sq.games.open.run({ stream_id: streamId, game_id: gameId || null, game_name: gameName || 'Just Chatting', started_at: startedAt });
    this._currentStream = { streamId, title, gameName, gameId, startedAt, peakViewers: 0 };
    this._startViewerPoll();
    this.emit('streamStart', this._currentStream);
    console.log(`[tracker:${this._accountId}] Stream started: "${title}"`);
  }

  streamEnded({ streamId }) {
    if (!this._currentStream) return;
    this._stopViewerPoll();
    const sq = scopedQueries(this._accountId);
    const endedAt = new Date().toISOString();
    const row = sq.streams.get.get(streamId);
    if (!row) return;
    const durationSeconds = Math.floor((new Date(endedAt) - new Date(row.started_at)) / 1000);
    sq.games.closeOpen.run({ stream_id: streamId, ended_at: endedAt });
    sq.streams.close.run({ stream_id: streamId, ended_at: endedAt, duration_seconds: durationSeconds, peak_viewers: row.peak_viewers, viewer_total: row.viewer_total, viewer_samples: row.viewer_samples });
    const finalRow = sq.streams.get.get(streamId);
    this.emit('streamEnd', finalRow);
    console.log(`[tracker:${this._accountId}] Stream ended after ${Math.floor(durationSeconds / 60)}m`);
    this._currentStream = null;
  }

  gameChanged({ streamId, gameName, gameId }) {
    if (!this._currentStream) return;
    const sq = scopedQueries(this._accountId);
    const now = new Date().toISOString();
    sq.games.closeOpen.run({ stream_id: streamId, ended_at: now });
    sq.games.open.run({ stream_id: streamId, game_id: gameId || null, game_name: gameName || 'Unknown', started_at: now });
    this._currentStream.gameName = gameName;
    this._currentStream.gameId = gameId;
    this.emit('gameChange', { streamId, gameName, gameId });
    console.log(`[tracker:${this._accountId}] Game changed to: ${gameName}`);
  }

  newFollower({ twitchUserId, twitchUsername, followedAt }) {
    scopedQueries(this._accountId).followers.upsert.run({ twitch_user_id: twitchUserId, twitch_username: twitchUsername, followed_at: followedAt });
    this.emit('follow', { twitchUserId, twitchUsername, followedAt });
    console.log(`[tracker:${this._accountId}] New follower: ${twitchUsername}`);
  }

  recordViewerCount(streamId, count) {
    const sq = scopedQueries(this._accountId);
    sq.streams.addSnapshot.run({ stream_id: streamId, viewer_count: count, recorded_at: new Date().toISOString() });
    sq.streams.updatePeak.run({ stream_id: streamId, viewers: count });
    if (this._currentStream) {
      this._currentStream.peakViewers = Math.max(this._currentStream.peakViewers, count);
      this._currentStream.currentViewers = count;
    }
  }

  _startViewerPoll() {
    this._stopViewerPoll();
    this._viewerPollInterval = setInterval(() => this._pollViewers(), 60_000);
  }

  _stopViewerPoll() {
    if (this._viewerPollInterval) { clearInterval(this._viewerPollInterval); this._viewerPollInterval = null; }
  }

  async _pollViewers() {
    if (!this._currentStream || !this._twitchApi) return;
    try {
      const stream = await this._twitchApi.streams.getStreamByUserId(this._accountId);
      if (stream) this.recordViewerCount(this._currentStream.streamId, stream.viewers);
    } catch (err) {
      console.error(`[tracker:${this._accountId}] viewer poll error:`, err.message);
    }
  }

  getRecentStreams(limit = 10) {
    return scopedQueries(this._accountId).streams.getRecent.all(limit);
  }

  getTopGames(limit = 10) {
    return scopedQueries(this._accountId).games.topGames.all(limit);
  }

  formatDuration(seconds) {
    if (!seconds) return '0m';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
}
