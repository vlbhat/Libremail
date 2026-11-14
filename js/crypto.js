import { hexToBytes } from 'https://esm.sh/@noble/hashes@1.3.3/utils';

const HEX_64 = /^[0-9a-f]{64}$/i;
const NIP05_LOCAL = /^[a-z0-9._-]+$/i;
const NIP05_DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
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

worker.onerror = (event) => {
  for (const [id, req] of pendingRequests) {
    pendingRequests.delete(id);
    req.reject(new Error(event.message || 'Cryptography worker failed.'));
  }
};

function runInWorker(action, payload) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pendingRequests.set(id, { resolve, reject });
    try {
      worker.postMessage({ id, action, payload });
    } catch (error) {
      pendingRequests.delete(id);
      reject(error);
    }
  });
}

const nip05Cache = new Map();

export function isValidHex64(value) {
  return typeof value === 'string' && HEX_64.test(value.trim());
}

function parseNip05Address(input) {
  if (typeof input !== 'string') throw new Error('Enter a NIP-05 address like name@example.com.');
  const value = input.trim().toLowerCase();
  const separator = value.lastIndexOf('@');
  if (separator <= 0 || separator === value.length - 1 || value.indexOf('@') !== separator) {
    throw new Error('Enter a valid NIP-05 address like name@example.com.');
  }

  const name = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  if (!NIP05_LOCAL.test(name) || !NIP05_DOMAIN.test(domain)) {
    throw new Error('Enter a valid NIP-05 address like name@example.com.');
  }
  return { value, name, domain };
}

export async function resolveNip05Address(input) {
  const { value, name, domain } = parseNip05Address(input);
  if (nip05Cache.has(value)) return nip05Cache.get(value);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/nostr+json, application/json' },
    });
    if (!response.ok) throw new Error(`NIP-05 lookup failed (HTTP ${response.status}).`);

    const data = await response.json();
    const pubkey = data?.names?.[name];
    if (typeof pubkey !== 'string' || !HEX_64.test(pubkey)) {
      throw new Error(`The domain does not publish a valid NIP-05 key for ${name}.`);
    }

    const normalized = pubkey.toLowerCase();
    nip05Cache.set(value, normalized);
    return normalized;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('NIP-05 lookup timed out. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
  if (!clean) throw new Error('Recipient address is required.');
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
  } catch (error) {
    // Ignore damaged local contact data and continue with network resolution.
  }

  if (clean.includes('@')) return await resolveNip05Address(clean);
  throw new Error(`Could not resolve "${input}". Enter a public key, a NIP-05 address, or save it as a contact.`);
}

export async function encryptEmail(senderSk, recipientPk, payloadObj, replyToId = null) {
  if (!senderSk || !recipientPk || !HEX_64.test(String(recipientPk).trim())) {
    throw new Error('Missing or invalid sender/recipient key material.');
  }
  const senderSkHex = bytesToHex(senderSk);
  return await runInWorker('encryptEmail', {
    senderSkHex,
    recipientPk: String(recipientPk).trim().toLowerCase(),
    payloadObj,
    replyToId,
  });
}

export async function decryptEmail(recipientSk, giftWrapEvent) {
  if (!recipientSk || !giftWrapEvent) return null;
  const recipientSkHex = bytesToHex(recipientSk);
  return await runInWorker('decryptEmail', { recipientSkHex, giftWrapEvent });
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
