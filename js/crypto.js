import { hexToBytes } from 'https://esm.sh/@noble/hashes@1.3.3/utils';

const HEX_64 = /^[0-9a-f]{64}$/i;

const worker = new Worker(new URL('./crypto-worker.js', import.meta.url), { type: 'module' });

let messageId = 0;
const pendingRequests = new Map();

worker.onmessage = (e) => {
  const { id, success, data, error } = e.data;
  const req = pendingRequests.get(id);
  if (req) {
    pendingRequests.delete(id);
    if (success) req.resolve(data);
    else req.reject(new Error(error));
  }
};

function runInWorker(action, payload) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pendingRequests.set(id, { resolve, reject });
    worker.postMessage({ id, action, payload });
  });
}

const nip05Cache = new Map();

export function isValidHex64(value) {
  return typeof value === 'string' && HEX_64.test(value.trim());
}

export async function initIdentity(savedHexKey) {
  const candidate = typeof savedHexKey === 'string' && HEX_64.test(savedHexKey.trim())
    ? savedHexKey.trim().toLowerCase()
    : null;
  return await runInWorker('initIdentity', { savedHexKey: candidate });
}

export async function resolveRecipient(input) {
  if (typeof input !== 'string') {
    throw new Error('Recipient address must be a string.');
  }

  const clean = input.trim().toLowerCase();
  if (!clean) {
    throw new Error('Recipient address is required.');
  }

  if (HEX_64.test(clean)) return clean;

  const localKey = localStorage.getItem(`nip05_${clean}`);
  if (localKey && HEX_64.test(localKey.trim())) return localKey.trim().toLowerCase();

  try {
    const contacts = JSON.parse(localStorage.getItem('libremail_contacts') || '[]');
    const matchedContact = contacts.find(c =>
      (c && typeof c.name === 'string' && c.name.toLowerCase() === clean) ||
      (c && typeof c.nip05 === 'string' && c.nip05.toLowerCase() === clean)
    );
    if (matchedContact?.pubkey && HEX_64.test(matchedContact.pubkey.trim())) {
      return matchedContact.pubkey.trim().toLowerCase();
    }
  } catch (e) {}

  if (clean.includes('@')) {
    if (nip05Cache.has(clean)) return nip05Cache.get(clean);

    const [name, domain] = clean.split('@');
    if (name && domain && /^[a-z0-9.-]+\.[a-z]{2,63}$/i.test(domain)) {
      try {
        const res = await fetch(`https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`);
        if (res.ok) {
          const data = await res.json();
          const pubkey = data.names?.[name];
          if (pubkey && HEX_64.test(pubkey.trim())) {
            const normalized = pubkey.trim().toLowerCase();
            nip05Cache.set(clean, normalized);
            return normalized;
          }
        }
      } catch (err) {}
    }
  }

  throw new Error(`Could not resolve "${input}". Please add this user to your Contacts with their public key first.`);
}

export async function encryptEmail(senderSk, recipientPk, payloadObj, replyToId = null) {
  if (!senderSk || !recipientPk || !HEX_64.test(String(recipientPk).trim())) {
    throw new Error('Missing or invalid sender/recipient key material.');
  }
  const senderSkHex = bytesToHex(senderSk);
  return await runInWorker('encryptEmail', { senderSkHex, recipientPk: String(recipientPk).trim().toLowerCase(), payloadObj, replyToId });
}

export async function decryptEmail(recipientSk, giftWrapEvent) {
  if (!recipientSk || !giftWrapEvent) {
    return null;
  }
  const recipientSkHex = bytesToHex(recipientSk);
  return await runInWorker('decryptEmail', { recipientSkHex, giftWrapEvent });
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
