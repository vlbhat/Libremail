import { SimplePool } from 'https://esm.sh/nostr-tools@2.10.4/pool';
import { decryptEmail } from './crypto.js';

const pool = new SimplePool();
let activeSub = null;

export async function publishToRelays(primaryRelay, giftWrapEvent) {
  if (!primaryRelay) {
    throw new Error('Relay URL is required.');
  }

  const relays = [primaryRelay];
  const publishPromises = pool.publish(relays, giftWrapEvent);
  await Promise.any(publishPromises);
}

export function subscribeToInbox({ primaryRelay, mySecretKey, myPublicKey, onNewEmail, onConnected }) {
  if (!primaryRelay || !myPublicKey) {
    throw new Error('Primary relay and public key are required.');
  }

  if (activeSub) activeSub.close();

  const relays = [primaryRelay];
  const threeDaysAgo = Math.floor(Date.now() / 1000) - (3 * 86400);

  activeSub = pool.subscribeMany(relays, [{ kinds: [1059], '#p': [myPublicKey], since: threeDaysAgo }], {
    async onevent(giftWrapEvent) {
      try {
        const decrypted = await decryptEmail(mySecretKey, giftWrapEvent);
        if (decrypted) {
          onNewEmail?.(decrypted);
        }
      } catch (err) {
        console.error('Decryption failed:', err);
      }
    },
    oneose() {
      onConnected?.(primaryRelay);
    },
  });
}
