import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'https://esm.sh/nostr-tools@2.10.4/pure';
import * as nip44 from 'https://esm.sh/nostr-tools@2.10.4/nip44';
import { bytesToHex, hexToBytes } from 'https://esm.sh/@noble/hashes@1.3.3/utils';

const HEX_64 = /^[0-9a-f]{64}$/i;

self.onmessage = async (e) => {
  const { id, action, payload } = e.data;

  try {
    if (action === 'initIdentity') {
      const savedHexKey = typeof payload?.savedHexKey === 'string' ? payload.savedHexKey.trim().toLowerCase() : '';
      const hex = savedHexKey && HEX_64.test(savedHexKey) ? savedHexKey : bytesToHex(generateSecretKey());
      const secretKey = hexToBytes(hex);
      const publicKey = getPublicKey(secretKey);
      self.postMessage({ id, success: true, data: { hex, secretKey, publicKey } });
      return;
    }

    if (action === 'encryptEmail') {
      const { senderSkHex, recipientPk, payloadObj, replyToId } = payload;
      if (!senderSkHex || !recipientPk || !HEX_64.test(String(recipientPk).trim())) {
        throw new Error('Missing or invalid sender/recipient key material.');
      }
      const senderSk = hexToBytes(senderSkHex);
      const senderPk = getPublicKey(senderSk);
      const normalizedRecipientPk = String(recipientPk).trim().toLowerCase();
      const tags = [['p', normalizedRecipientPk]];
      if (replyToId) tags.push(['e', replyToId, '', 'reply']);

      const rumor = {
        kind: 14,
        pubkey: senderPk,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: JSON.stringify(payloadObj || {}),
      };

      const convKey = nip44.v2.utils.getConversationKey(senderSk, normalizedRecipientPk);
      const seal = finalizeEvent({
        kind: 13,
        created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800),
        tags: [],
        content: nip44.v2.encrypt(JSON.stringify(rumor), convKey),
      }, senderSk);

      const randomSk = generateSecretKey();
      const wrapKey = nip44.v2.utils.getConversationKey(randomSk, normalizedRecipientPk);
      const giftWrap = finalizeEvent({
        kind: 1059,
        created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800),
        tags: [['p', normalizedRecipientPk]],
        content: nip44.v2.encrypt(JSON.stringify(seal), wrapKey),
      }, randomSk);

      if (!verifyEvent(seal) || !verifyEvent(giftWrap)) {
        throw new Error('Message wrapping failed cryptographic validation.');
      }

      self.postMessage({ id, success: true, data: giftWrap });
      return;
    }

    if (action === 'decryptEmail') {
      const { recipientSkHex, giftWrapEvent } = payload;
      if (!giftWrapEvent || !giftWrapEvent.content) {
        self.postMessage({ id, success: true, data: null });
        return;
      }

      const recipientSk = hexToBytes(recipientSkHex);
      const recipientPk = getPublicKey(recipientSk);

      if (!verifyEvent(giftWrapEvent)) {
        self.postMessage({ id, success: true, data: null });
        return;
      }

      const recipientTagMatches = Array.isArray(giftWrapEvent.tags)
        && giftWrapEvent.tags.some(([tag, value]) => tag === 'p' && value && value.toLowerCase() === recipientPk.toLowerCase());
      if (!recipientTagMatches || giftWrapEvent.kind !== 1059) {
        self.postMessage({ id, success: true, data: null });
        return;
      }

      const wrapKey = nip44.v2.utils.getConversationKey(recipientSk, giftWrapEvent.pubkey);
      const seal = JSON.parse(nip44.v2.decrypt(giftWrapEvent.content, wrapKey));
      if (!seal || seal.kind !== 13 || !verifyEvent(seal)) {
        self.postMessage({ id, success: true, data: null });
        return;
      }

      const sealKey = nip44.v2.utils.getConversationKey(recipientSk, seal.pubkey);
      const rumor = JSON.parse(nip44.v2.decrypt(seal.content, sealKey));
      if (!rumor || rumor.kind !== 14 || !Array.isArray(rumor.tags) || !rumor.content) {
        self.postMessage({ id, success: true, data: null });
        return;
      }

      const intendedRecipient = rumor.tags.some(([tag, value]) => tag === 'p' && value && value.toLowerCase() === recipientPk.toLowerCase());
      if (!intendedRecipient) {
        self.postMessage({ id, success: true, data: null });
        return;
      }

      const data = JSON.parse(rumor.content);
      if (!data || typeof data !== 'object') {
        self.postMessage({ id, success: true, data: null });
        return;
      }

      const replyTag = rumor.tags.find(t => t[0] === 'e');
      const decrypted = {
        id: giftWrapEvent.id,
        from: seal.pubkey,
        subject: typeof data.subject === 'string' ? data.subject : '(No Subject)',
        body: typeof data.body === 'string' ? data.body : '',
        senderHandle: typeof data.senderHandle === 'string' ? data.senderHandle : null,
        replyTo: replyTag ? replyTag[1] : null,
        time: Number.isFinite(rumor.created_at) ? rumor.created_at * 1000 : Date.now(),
      };

      self.postMessage({ id, success: true, data: decrypted });
      return;
    }
  } catch (err) {
    self.postMessage({ id, success: false, error: err.message });
  }
};
