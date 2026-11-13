import { bytesToHex } from 'https://esm.sh/@noble/hashes@1.3.3/utils';

const REQUEST_TIMEOUT_MS = 30000;
const worker = new Worker(new URL('./crypto-worker.js', import.meta.url), { type: 'module' });
let messageId = 0;
const pendingRequests = new Map();

function rejectPending(error) {
  for (const [id, request] of pendingRequests) {
    clearTimeout(request.timeout);
    request.reject(error);
    pendingRequests.delete(id);
  }
}

worker.onmessage = ({ data }) => {
  const { id, success, result, data: responseData, error } = data || {};
  const request = pendingRequests.get(id);
  if (!request) return;

  pendingRequests.delete(id);
  clearTimeout(request.timeout);
  if (success) request.resolve(responseData ?? result);
  else request.reject(new Error(error || 'Crypto worker operation failed.'));
};

worker.onerror = (event) => {
  event.preventDefault();
  rejectPending(new Error('Crypto worker failed to load or execute. Reload the page and check network access.'));
};

worker.onmessageerror = () => {
  rejectPending(new Error('Could not read the crypto worker response.'));
};

function runInWorker(action, payload) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('Crypto operation timed out.'));
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timeout });
    try {
      worker.postMessage({ id, action, payload });
    } catch (error) {
      pendingRequests.delete(id);
      clearTimeout(timeout);
      reject(error);
    }
  });
}

const nip05Cache = new Map();
const HEX_32 = /^[0-9a-f]{64}$/i;

export async function initIdentity(savedHexKey) {
  return runInWorker('initIdentity', { savedHexKey });
}

export async function resolveRecipient(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('Recipient address is required.');

  const clean = raw.toLowerCase();
  if (HEX_32.test(clean)) return clean;

  try {
    const localKey = localStorage.getItem(`nip05_${clean}`);
    if (localKey && HEX_32.test(localKey)) return localKey.toLowerCase();
  } catch (error) {
    // Continue with the contact list and live NIP-05 lookup.
  }

  try {
    const contacts = JSON.parse(localStorage.getItem('libremail_contacts') || '[]');
    const match = Array.isArray(contacts) ? contacts.find(contact => contact && (
      (typeof contact.name === 'string' && contact.name.toLowerCase() === clean) ||
      (typeof contact.nip05 === 'string' && contact.nip05.toLowerCase() === clean)
    )) : null;
    if (match?.pubkey && HEX_32.test(match.pubkey)) return match.pubkey.toLowerCase();
  } catch (error) {
    // Ignore damaged local contact data; live resolution may still work.
  }

  const separator = clean.lastIndexOf('@');
  if (separator > 0) {
    const name = clean.slice(0, separator);
    const domain = clean.slice(separator + 1);
    if (!domain || domain.includes('@') || !/^[a-z0-9.-]+$/.test(domain)) {
      throw new Error('Enter a valid NIP-05 address (name@domain).');
    }

    if (nip05Cache.has(clean)) return nip05Cache.get(clean);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const endpoint = new URL(`https://${domain}/.well-known/nostr.json`);
      endpoint.searchParams.set('name', name);
      const response = await fetch(endpoint, { signal: controller.signal, mode: 'cors' });
      if (response.ok) {
        const data = await response.json();
        const pubkey = data?.names?.[name];
        if (typeof pubkey === 'string' && HEX_32.test(pubkey)) {
          const normalized = pubkey.toLowerCase();
          nip05Cache.set(clean, normalized);
          return normalized;
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('NIP-05 lookup timed out.');
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Could not resolve "${raw}". Check the address or add a contact with a valid public key.`);
}

export async function encryptEmail(senderSk, recipientPk, payloadObj, replyToId = null) {
  if (!(senderSk instanceof Uint8Array)) throw new Error('Sender key is not available.');
  return runInWorker('encryptEmail', {
    senderSkHex: bytesToHex(senderSk),
    recipientPk,
    payloadObj,
    replyToId,
  });
}

export async function decryptEmail(recipientSk, giftWrapEvent) {
  if (!(recipientSk instanceof Uint8Array)) throw new Error('Recipient key is not available.');
  return runInWorker('decryptEmail', {
    recipientSkHex: bytesToHex(recipientSk),
    giftWrapEvent,
  });
}
