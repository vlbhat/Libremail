import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'https://esm.sh/nostr-tools@2.10.4/pure';
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

    else if (action === 'decryptEmail') {
      const { recipientSkHex, giftWrapEvent } = payload;
      const recipientSk = hexToBytes(recipientSkHex);

      if (!verifyEvent(giftWrapEvent)) {
        return self.postMessage({ id, success: true, data: null });
      }

      const wrapKey = nip44.v2.utils.getConversationKey(recipientSk, giftWrapEvent.pubkey);
      const seal = JSON.parse(nip44.v2.decrypt(giftWrapEvent.content, wrapKey));
      if (!verifyEvent(seal)) {
        return self.postMessage({ id, success: true, data: null });
      }

      const sealKey = nip44.v2.utils.getConversationKey(recipientSk, seal.pubkey);
      const rumor = JSON.parse(nip44.v2.decrypt(seal.content, sealKey));
      const data = JSON.parse(rumor.content);
      const replyTag = rumor.tags.find(t => t[0] === 'e');

      const decrypted = {
        id: giftWrapEvent.id,
        from: seal.pubkey,
        subject: data.subject,
        body: data.body,
        senderHandle: data.senderHandle || null,
        replyTo: replyTag ? replyTag[1] : null,
        time: rumor.created_at * 1000,
      };

      self.postMessage({ id, success: true, data: decrypted });
    }
  } catch (err) {
    self.postMessage({ id, success: false, error: err.message });
  }
};
