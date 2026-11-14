import { SimplePool } from 'https://esm.sh/nostr-tools@2.10.4/pool';
import { decryptEmail } from './crypto.js';

const pool = new SimplePool();
let activeSub = null;
const VALID_RELAY = /^wss?:\/\//i;
const VALID_PUBKEY = /^[0-9a-f]{64}$/i;

export async function publishToRelays(primaryRelay, giftWrapEvent) {
  if (!primaryRelay || typeof primaryRelay !== 'string' || !VALID_RELAY.test(primaryRelay.trim())) return;
  if (!giftWrapEvent || !giftWrapEvent.id) return;
  const relays = [primaryRelay.trim()];
  const publishCalls = pool.publish(relays, giftWrapEvent);
  await Promise.any(publishCalls);
}

export function subscribeToInbox({ primaryRelay, mySecretKey, myPublicKey, onNewEmail, onConnected }) {
  if (!primaryRelay || typeof primaryRelay !== 'string' || !VALID_RELAY.test(primaryRelay.trim())) return;
  if (!mySecretKey || !myPublicKey || !VALID_PUBKEY.test(String(myPublicKey).trim())) return;
  if (activeSub) activeSub.close();

  const relays = [primaryRelay.trim()];
  const threeDaysAgo = Math.floor(Date.now() / 1000) - (3 * 86400);

  activeSub = pool.subscribeMany(relays, [{ kinds: [1059], '#p': [String(myPublicKey).trim()], since: threeDaysAgo }], {
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
      onConnected?.(primaryRelay.trim());
    },
  });
}
