import { verifyEvent } from 'https://esm.sh/nostr-tools@2.10.4/pure';
import * as nip44 from 'https://esm.sh/nostr-tools@2.10.4/nip44';
import { hexToBytes } from 'https://esm.sh/@noble/hashes@1.3.3/utils';

// Initialize the Web Worker
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

export async function initIdentity(savedHexKey) {
  const result = await runInWorker('initIdentity', { savedHexKey });
  return result;
}

export async function resolveRecipient(input) {
  const clean = input.trim().toLowerCase();

  if (/^[0-9a-f]{64}$/.test(clean)) return clean;

  const localKey = localStorage.getItem(`nip05_${clean}`);
  if (localKey) return localKey;

  try {
    const contacts = JSON.parse(localStorage.getItem('libremail_contacts') || '[]');
    const matchedContact = contacts.find(c => 
      c.name.toLowerCase() === clean || 
      (c.nip05 && c.nip05.toLowerCase() === clean)
    );
    if (matchedContact) return matchedContact.pubkey;
  } catch (e) {
    // Ignore parse errors
  }

  if (clean.includes('@')) {
    if (nip05Cache.has(clean)) return nip05Cache.get(clean);

    const [name, domain] = clean.split('@');
    if (name && domain) {
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
      } catch (err) {
        // Silently bypass network/CORS blocks
      }
    }
  }

  let fallbackPubkey = localStorage.getItem('libremail_fallback_pubkey');
  if (!fallbackPubkey) {
    const tempId = await initIdentity();
    fallbackPubkey = tempId.publicKey;
    localStorage.setItem('libremail_fallback_pubkey', fallbackPubkey);
  }
  
  nip05Cache.set(clean, fallbackPubkey);
  return fallbackPubkey;
}

export async function encryptEmail(senderSk, recipientPk, payloadObj, replyToId = null) {
  // senderSk passed as Uint8Array needs conversion to hex for worker transmission
  const senderSkHex = bytesToHex(senderSk);
  return await runInWorker('encryptEmail', { senderSkHex, recipientPk, payloadObj, replyToId });
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

// Helper for bytesToHex since worker handles serialization
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
