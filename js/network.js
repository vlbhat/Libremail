import { SimplePool } from 'https://esm.sh/nostr-tools@2.10.4/pool';
import { decryptEmail } from './crypto.js';

const pool = new SimplePool();
const HEX_64 = /^[0-9a-f]{64}$/i;
let activeSub = null;
let subscriptionGeneration = 0;

function normalizeRelay(value) {
  let relay;
  try {
    relay = new URL(String(value ?? '').trim());
  } catch {
    throw new Error('Enter a valid relay URL.');
  }

  const isLocalWs = relay.protocol === 'ws:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(relay.hostname);
  if (relay.protocol !== 'wss:' && !isLocalWs) {
    throw new Error('Use a secure wss:// relay URL (ws:// is allowed only on localhost).');
  }
  if (relay.username || relay.password || relay.hash) {
    throw new Error('Relay URLs cannot contain credentials or fragments.');
  }
  return relay.href.replace(/\/$/, '');
}

export async function publishToRelays(primaryRelay, giftWrapEvent) {
  const relay = normalizeRelay(primaryRelay);
  if (!giftWrapEvent || giftWrapEvent.kind !== 1059 || !HEX_64.test(giftWrapEvent.id || '')) {
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
  if (!(mySecretKey instanceof Uint8Array) || !HEX_64.test(String(myPublicKey || ''))) {
    throw new Error('A valid account identity is required to connect.');
  }

  const generation = ++subscriptionGeneration;
  if (activeSub) activeSub.close();
  activeSub = null;

  const since = Math.floor(Date.now() / 1000) - 3 * 86400;
  try {
    activeSub = pool.subscribeMany([relay], [{ kinds: [1059], '#p': [myPublicKey.toLowerCase()], since }], {
      async onevent(event) {
        try {
          const decrypted = await decryptEmail(mySecretKey, event);
          if (decrypted) onNewEmail?.(decrypted);
        } catch (error) {
          console.warn('An inbox event could not be decrypted.', error);
        }
      },
      oneose() {
        if (generation === subscriptionGeneration) onConnected?.(relay);
      },
      onclose(reason) {
        if (generation === subscriptionGeneration) {
          activeSub = null;
          onError?.(reason || `Connection to ${relay} closed.`);
        }
      },
    });
  } catch (error) {
    if (generation === subscriptionGeneration) activeSub = null;
    onError?.(error.message || 'Could not subscribe to the relay.');
    throw error;
  }
}

export function closeInboxSubscription() {
  subscriptionGeneration += 1;
  if (activeSub) activeSub.close();
  activeSub = null;
}
