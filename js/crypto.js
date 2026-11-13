import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'https://esm.sh/nostr-tools@2.10.4/pure';
import * as nip44 from 'https://esm.sh/nostr-tools@2.10.4/nip44';
import { bytesToHex, hexToBytes } from 'https://esm.sh/@noble/hashes@1.3.3/utils';

const nip05Cache = new Map();

export function initIdentity(savedHexKey) {
  const hex = savedHexKey || bytesToHex(generateSecretKey());
  const secretKey = hexToBytes(hex);
  const publicKey = getPublicKey(secretKey);
  return { hex, secretKey, publicKey };
}

export async function resolveRecipient(input) {
  const clean = input.trim().toLowerCase();

  if (/^[0-9a-f]{64}$/.test(clean)) return clean;

  if (clean.includes('@')) {
    if (nip05Cache.has(clean)) return nip05Cache.get(clean);

    const [name, domain] = clean.split('@');
    if (!name || !domain) throw new Error('Invalid email address format.');

    try {
      const res = await fetch(`https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`);
      if (res.ok) {
        const data = await res.json();
        const pubkey = data.names?.[name];
        if (pubkey) {
          nip05Cache.set(clean, pubkey);
          return pubkey;
        }
      }
    } catch {
      // Domain fetch failed; fall back to local storage map below
    }

    // Local fallback for test handles or custom domains without a nostr.json file
    const localKey = localStorage.getItem(`nip05_${clean}`);
    if (localKey) {
      nip05Cache.set(clean, localKey);
      return localKey;
    }

    throw new Error(`Could not resolve NIP-05 address: ${clean}`);
  }

  throw new Error('Enter a valid 64-character public key or user@domain.com address.');
}

export function encryptEmail(senderSk, recipientPk, payloadObj, replyToId = null) {
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
    created_at: randomPastTimestamp(),
    tags: [],
    content: nip44.v2.encrypt(JSON.stringify(rumor), convKey),
  }, senderSk);

  const randomSk = generateSecretKey();
  const wrapKey = nip44.v2.utils.getConversationKey(randomSk, recipientPk);
  return finalizeEvent({
    kind: 1059,
    created_at: randomPastTimestamp(),
    tags: [['p', recipientPk]],
    content: nip44.v2.encrypt(JSON.stringify(seal), wrapKey),
  }, randomSk);
}

export function decryptEmail(recipientSk, giftWrapEvent) {
  if (!verifyEvent(giftWrapEvent)) return null;

  const wrapKey = nip44.v2.utils.getConversationKey(recipientSk, giftWrapEvent.pubkey);
  const seal = JSON.parse(nip44.v2.decrypt(giftWrapEvent.content, wrapKey));
  if (!verifyEvent(seal)) return null;

  const sealKey = nip44.v2.utils.getConversationKey(recipientSk, seal.pubkey);
  const rumor = JSON.parse(nip44.v2.decrypt(seal.content, sealKey));
  const data = JSON.parse(rumor.content);
  const replyTag = rumor.tags.find(t => t[0] === 'e');

  return {
    id: giftWrapEvent.id,
    from: seal.pubkey,
    subject: data.subject,
    body: data.body,
    senderHandle: data.senderHandle || null,
    replyTo: replyTag ? replyTag[1] : null,
    time: rumor.created_at * 1000,
  };
}

function randomPastTimestamp() {
  return Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800);
}
