import { config } from '../config.js';

export const TWITCH_SCOPES = [
  'channel:read:subscriptions',
  'moderator:read:followers',
  'moderator:manage:banned_users',
  'moderator:manage:chat_messages',
  'moderator:manage:chat_settings',
  'bits:read',
  'channel:read:redemptions',
  'chat:read',
  'chat:edit',
];

async function post(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

// Twitch Device Code Grant: the streamer opens a link, logs in and clicks Authorize — no tokens to copy.
export async function startDeviceAuth() {
  const { ok, body } = await post('https://id.twitch.tv/oauth2/device', {
    client_id: config.twitch.clientId,
    scopes: TWITCH_SCOPES.join(' '),
  });
  if (!ok) throw new Error(body.message || 'Twitch refused the device code request');
  return body; // { device_code, user_code, verification_uri, expires_in, interval }
}

export async function waitForDeviceToken({ device_code, interval = 5, expires_in = 1800 }) {
  const deadline = Date.now() + expires_in * 1000;
  let waitSecs = interval;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, waitSecs * 1000));
    const { ok, body } = await post('https://id.twitch.tv/oauth2/token', {
      client_id: config.twitch.clientId,
      client_secret: config.twitch.clientSecret,
      device_code,
      scopes: TWITCH_SCOPES.join(' '),
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (ok) return body; // { access_token, refresh_token, expires_in, scope }
    if (body.message === 'authorization_pending') continue;
    if (body.message === 'slow_down') { waitSecs += 5; continue; }
    throw new Error(body.message || 'Twitch authorization failed');
  }
  throw new Error('The link expired before it was used');
}

export async function validateToken(accessToken) {
  const res = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!res.ok) throw new Error('Twitch rejected the new token');
  return res.json(); // { login, user_id, scopes, expires_in }
}
