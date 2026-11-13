import { SimplePool } from 'https://esm.sh/nostr-tools@2.10.4/pool';
import { decryptEmail } from './crypto.js';

const pool = new SimplePool();
let activeSub = null;

// Broadcasts an encrypted email event to your primary relay
export async function publishToRelays(primaryRelay, giftWrapEvent) {
  const relays = [primaryRelay];
  await Promise.any(pool.publish(relays, giftWrapEvent));
}

// Listens in real time for new encrypted emails addressed to myPublicKey
export function subscribeToInbox({ primaryRelay, mySecretKey, myPublicKey, onNewEmail, onConnected }) {
  if (activeSub) activeSub.close();

  const relays = [primaryRelay];
  const threeDaysAgo = Math.floor(Date.now() / 1000) - (3 * 86400);

  activeSub = pool.subscribeMany(relays, [{ kinds: [1059], '#p': [myPublicKey], since: threeDaysAgo }], {
    async onevent(giftWrapEvent) {
      try {
        // Await asynchronous decryption via Web Worker
        const decrypted = await decryptEmail(mySecretKey, giftWrapEvent);
        if (decrypted) onNewEmail(decrypted);
      } catch {
        // Ignore non-matching or malformed events
      }
    },
    oneose() {
      onConnected(primaryRelay);
    },
  });
}
