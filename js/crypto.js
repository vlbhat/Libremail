import { hexToBytes } from 'https://esm.sh/@noble/hashes@1.3.3/utils';

const HEX_64 = /^[0-9a-f]{64}$/i;
const worker = new Worker(new URL('./crypto-worker.js', import.meta.url), { type: 'module' });

let messageId = 0;
const pendingRequests = new Map();

worker.onmessage = event => {
  const { id, success, data, error } = event.data;
  const request = pendingRequests.get(id);
  if (!request) return;
  pendingRequests.delete(id);
  if (success) request.resolve(data);
  else request.reject(new Error(error));
};

worker.onerror = event => {
  for (const [id, request] of pendingRequests) {
    pendingRequests.delete(id);
    request.reject(new Error(event.message || 'Cryptography worker failed.'));
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

export async function initIdentity(savedHexKey) {
  const candidate = typeof savedHexKey === 'string' && HEX_64.test(savedHexKey.trim())
    ? savedHexKey.trim().toLowerCase()
    : null;
  return await runInWorker('initIdentity', { savedHexKey: candidate });
}

export async function resolveRecipient(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('Enter a 64-character hexadecimal public key or choose a saved contact.');
  }

  const clean = input.trim().toLowerCase();
  if (HEX_64.test(clean)) return clean;

  try {
    const contacts = JSON.parse(localStorage.getItem('libremail_contacts') || '[]');
    const contact = contacts.find(item =>
      item && typeof item.name === 'string' && item.name.trim().toLowerCase() === clean
      && typeof item.pubkey === 'string' && HEX_64.test(item.pubkey.trim())
    );
    if (contact) return contact.pubkey.trim().toLowerCase();
  } catch (error) {
    // Ignore damaged local contact data and report the normal input error.
  }

  throw new Error('Enter a valid 64-character public key or use a saved contact nickname.');
}

export async function encryptEmail(senderSk, recipientPk, payloadObj, replyToId = null) {
  if (!senderSk || typeof recipientPk !== 'string' || !HEX_64.test(recipientPk.trim())) {
    throw new Error('Missing or invalid sender/recipient key material.');
  }
  return await runInWorker('encryptEmail', {
    senderSkHex: bytesToHex(senderSk),
    recipientPk: recipientPk.trim().toLowerCase(),
    payloadObj,
    replyToId
  });
}

export async function decryptEmail(recipientSk, giftWrapEvent) {
  if (!recipientSk || !giftWrapEvent) return null;
  return await runInWorker('decryptEmail', {
    recipientSkHex: bytesToHex(recipientSk),
    giftWrapEvent
  });
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
}
