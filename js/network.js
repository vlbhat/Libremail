import { SimplePool } from 'https://esm.sh/nostr-tools@2.10.4/pool';
import { decryptEmail } from './crypto.js';

const pool = new SimplePool();
let activeSub = null;

export async function publishToRelays(primaryRelay, giftWrapEvent) {
  if (!primaryRelay || !giftWrapEvent) return;
  const relays = [primaryRelay];
  const publishCalls = pool.publish(relays, giftWrapEvent);
  await Promise.any(publishCalls);
}

export function subscribeToInbox({ primaryRelay, mySecretKey, myPublicKey, onNewEmail, onConnected }) {
  if (!primaryRelay || !mySecretKey || !myPublicKey) return;
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
        console.error('❌ Critical error during decryption in worker:', err);
      }
    },
    oneose() {
      onConnected?.(primaryRelay);
    },
  });
}
