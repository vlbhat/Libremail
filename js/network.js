import { SimplePool } from 'https://esm.sh/nostr-tools@2.10.4/pool';
import { decryptEmail } from './crypto.js';

const pool = new SimplePool();
const BACKUP_RELAY = 'wss://nostr.mom';
let activeSub = null;

export async function publishToRelays(primaryRelay, giftWrapEvent) {
  const relays = [...new Set([primaryRelay, BACKUP_RELAY])];
  await Promise.any(pool.publish(relays, giftWrapEvent));
}

export function subscribeToInbox({ primaryRelay, mySecretKey, myPublicKey, onNewEmail, onConnected }) {
  if (activeSub) activeSub.close();

  const relays = [...new Set([primaryRelay, BACKUP_RELAY])];
  const threeDaysAgo = Math.floor(Date.now() / 1000) - (3 * 86400);

  activeSub = pool.subscribeMany(relays, [{ kinds: [1059], '#p': [myPublicKey], since: threeDaysAgo }], {
    onevent(giftWrapEvent) {
      try {
        const decrypted = decryptEmail(mySecretKey, giftWrapEvent);
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