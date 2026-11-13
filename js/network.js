import { SimplePool } from 'https://esm.sh/nostr-tools@2.10.4/pool';
import { decryptEmail } from './crypto.js';

const pool = new SimplePool();
let activeSub = null;
let activeRelay = null;

function normalizeRelay(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch (error) {
    throw new Error('Enter a valid relay URL.');
  }

  const localDevelopment = parsed.protocol === 'ws:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'wss:' && !localDevelopment) {
    throw new Error('Relays must use secure wss:// URLs (ws:// is allowed only on localhost).');
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error('Relay URLs cannot include credentials or fragments.');
  }
  return parsed.href.replace(/\/$/, '');
}

export async function publishToRelays(primaryRelay, giftWrapEvent) {
  const relay = normalizeRelay(primaryRelay);
  if (!giftWrapEvent || giftWrapEvent.kind !== 1059) {
    throw new Error('Cannot publish an invalid gift-wrap event.');
  }

  const results = await Promise.allSettled(pool.publish([relay], giftWrapEvent));
  if (!results.some(result => result.status === 'fulfilled')) {
    const reason = results.find(result => result.status === 'rejected')?.reason;
    throw new Error(reason?.message || `Could not publish to ${relay}.`);
  }
}

export function subscribeToInbox({ primaryRelay, mySecretKey, myPublicKey, onNewEmail, onConnected, onError }) {
  const relay = normalizeRelay(primaryRelay);
  if (!(mySecretKey instanceof Uint8Array) || !/^[0-9a-f]{64}$/i.test(myPublicKey || '')) {
    throw new Error('A valid account identity is required to connect.');
  }

  if (activeSub) {
    activeSub.close();
    activeSub = null;
  }
  activeRelay = relay;

  const since = Math.floor(Date.now() / 1000) - (3 * 86400);
  try {
    activeSub = pool.subscribeMany([relay], [{ kinds: [1059], '#p': [myPublicKey], since }], {
      async onevent(giftWrapEvent) {
        try {
          const decrypted = await decryptEmail(mySecretKey, giftWrapEvent);
          if (decrypted) onNewEmail?.(decrypted);
        } catch (error) {
          console.warn('An inbox event could not be decrypted.', error);
        }
      },
      oneose() {
        onConnected?.(relay);
      },
      onclose(reason) {
        if (activeRelay === relay) onError?.(reason || `Connection to ${relay} closed.`);
      },
    });
  } catch (error) {
    activeSub = null;
    onError?.(error.message || 'Could not subscribe to the relay.');
    throw error;
  }
}

export function closeInboxSubscription() {
  activeRelay = null;
  if (activeSub) activeSub.close();
  activeSub = null;
}
