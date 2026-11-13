import { generateSecretKey, getPublicKey, finalizeEvent } from 'https://esm.sh/nostr-tools@2.10.4/pure';
import * as nip44 from 'https://esm.sh/nostr-tools@2.10.4/nip44';
import { bytesToHex, hexToBytes } from 'https://esm.sh/@noble/hashes@1.3.3/utils';

self.onmessage = async (e) => {
  const { id, action, payload } = e.data;

  try {
    if (action === 'initIdentity') {
      const hex = payload.savedHexKey || bytesToHex(generateSecretKey());
      const secretKey = hexToBytes(hex);
      const publicKey = getPublicKey(secretKey);
      self.postMessage({ id, success: true, data: { hex, secretKey, publicKey } });
    }
    
    else if (action === 'encryptEmail') {
      const { senderSkHex, recipientPk, payloadObj, replyToId } = payload;
      const senderSk = hexToBytes(senderSkHex);
      const senderPk = getPublicKey(senderSk);
      
      const tags = [['p', recipientPk]];
      if (replyToId) tags.push(['e', replyToId, '', 'reply']);

      const rumor = {
        kind: 14,
        pubkey: senderPk,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: JSON.stringify(payloadObj),
      };

      const convKey = nip44.v2.utils.getConversationKey(senderSk, recipientPk);
      const seal = finalizeEvent({
        kind: 13,
        created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800),
        tags: [],
        content: nip44.v2.encrypt(JSON.stringify(rumor), convKey),
      }, senderSk);

      const randomSk = generateSecretKey();
      const wrapKey = nip44.v2.utils.getConversationKey(randomSk, recipientPk);
      const giftWrap = finalizeEvent({
        kind: 1059,
        created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800),
        tags: [['p', recipientPk]],
        content: nip44.v2.encrypt(JSON.stringify(seal), wrapKey),
      }, randomSk);

      self.postMessage({ id, success: true, data: giftWrap });
    }
  } catch (err) {
    self.postMessage({ id, success: false, error: err.message });
  }
};
