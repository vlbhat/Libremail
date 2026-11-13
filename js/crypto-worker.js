import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'https://esm.sh/nostr-tools@2.10.4/pure';
import * as nip44 from 'https://esm.sh/nostr-tools@2.10.4/nip44';
import { bytesToHex, hexToBytes } from 'https://esm.sh/@noble/hashes@1.3.3/utils';

const HEX_32 = /^[0-9a-f]{64}$/i;
const MAX_MESSAGE_BYTES = 60 * 1024;

function requireHexKey(value, label) {
  if (typeof value !== 'string' || !HEX_32.test(value)) {
    throw new Error(`${label} must be a 32-byte hexadecimal key.`);
  }
  return hexToBytes(value);
}

function postSuccess(id, data) {
  self.postMessage({ id, success: true, data });
}

self.onmessage = async (event) => {
  const { id, action, payload } = event.data || {};
  if (!Number.isSafeInteger(id) || !payload || typeof payload !== 'object') return;

  try {
    if (action === 'initIdentity') {
      const secretKey = payload.savedHexKey
        ? requireHexKey(payload.savedHexKey, 'Saved secret key')
        : generateSecretKey();
      const hex = bytesToHex(secretKey);
      const publicKey = getPublicKey(secretKey);
      postSuccess(id, { hex, secretKey, publicKey });
      return;
    }

    if (action === 'encryptEmail') {
      const { senderSkHex, recipientPk, payloadObj, replyToId } = payload;
      const senderSk = requireHexKey(senderSkHex, 'Sender secret key');
      if (typeof recipientPk !== 'string' || !HEX_32.test(recipientPk)) {
        throw new Error('Recipient public key must be 32-byte hexadecimal.');
      }
      if (!payloadObj || typeof payloadObj !== 'object' || Array.isArray(payloadObj)) {
        throw new Error('Message content is invalid.');
      }
      if (replyToId != null && !HEX_32.test(replyToId)) {
        throw new Error('Reply reference must be a 32-byte event ID.');
      }

      const content = JSON.stringify(payloadObj);
      if (new TextEncoder().encode(content).byteLength > MAX_MESSAGE_BYTES) {
        throw new Error('Message is too large to encrypt.');
      }

      const recipient = recipientPk.toLowerCase();
      const senderPk = getPublicKey(senderSk);
      const tags = [['p', recipient]];
      if (replyToId) tags.push(['e', replyToId.toLowerCase(), '', 'reply']);

      const rumor = {
        kind: 14,
        pubkey: senderPk,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content,
      };
      const conversationKey = nip44.v2.utils.getConversationKey(senderSk, recipient);
      const seal = finalizeEvent({
        kind: 13,
        created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800),
        tags: [],
        content: nip44.v2.encrypt(JSON.stringify(rumor), conversationKey),
      }, senderSk);

      const ephemeralSk = generateSecretKey();
      const wrapKey = nip44.v2.utils.getConversationKey(ephemeralSk, recipient);
      const giftWrap = finalizeEvent({
        kind: 1059,
        created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800),
        tags: [['p', recipient]],
        content: nip44.v2.encrypt(JSON.stringify(seal), wrapKey),
      }, ephemeralSk);

      postSuccess(id, giftWrap);
      return;
    }

    if (action === 'decryptEmail') {
      const { recipientSkHex, giftWrapEvent } = payload;
      const recipientSk = requireHexKey(recipientSkHex, 'Recipient secret key');
      const recipientPk = getPublicKey(recipientSk);

      if (!giftWrapEvent || giftWrapEvent.kind !== 1059 || !Array.isArray(giftWrapEvent.tags) ||
          !giftWrapEvent.tags.some(tag => tag?.[0] === 'p' && tag[1] === recipientPk) ||
          !verifyEvent(giftWrapEvent)) {
        postSuccess(id, null);
        return;
      }

      const wrapKey = nip44.v2.utils.getConversationKey(recipientSk, giftWrapEvent.pubkey);
      const seal = JSON.parse(nip44.v2.decrypt(giftWrapEvent.content, wrapKey));
      if (!seal || seal.kind !== 13 || !verifyEvent(seal) || !Array.isArray(seal.tags)) {
        postSuccess(id, null);
        return;
      }

      const sealKey = nip44.v2.utils.getConversationKey(recipientSk, seal.pubkey);
      const rumor = JSON.parse(nip44.v2.decrypt(seal.content, sealKey));
      if (!rumor || rumor.kind !== 14 || rumor.pubkey !== seal.pubkey ||
          typeof rumor.content !== 'string' || !Array.isArray(rumor.tags) ||
          !rumor.tags.some(tag => tag?.[0] === 'p' && tag[1] === recipientPk)) {
        postSuccess(id, null);
        return;
      }

      const data = JSON.parse(rumor.content);
      if (!data || typeof data !== 'object' || typeof data.body !== 'string' ||
          (data.subject != null && typeof data.subject !== 'string')) {
        postSuccess(id, null);
        return;
      }

      const replyTag = rumor.tags.find(tag => tag?.[0] === 'e' && HEX_32.test(tag[1] || ''));
      postSuccess(id, {
        id: giftWrapEvent.id,
        from: seal.pubkey,
        subject: data.subject || '(No Subject)',
        body: data.body,
        senderHandle: typeof data.senderHandle === 'string' ? data.senderHandle.slice(0, 256) : null,
        replyTo: replyTag ? replyTag[1] : null,
        time: Number.isFinite(rumor.created_at) ? rumor.created_at * 1000 : Date.now(),
      });
      return;
    }

    throw new Error(`Unsupported crypto action: ${String(action)}`);
  } catch (error) {
    self.postMessage({
      id,
      success: false,
      error: error instanceof Error ? error.message : 'Cryptographic operation failed.',
    });
  }
};
