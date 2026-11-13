import { initIdentity, encryptEmail, resolveRecipient } from './crypto.js';
import { store } from './store.js';
import { publishToRelays, subscribeToInbox } from './network.js';
import { ui } from './ui.js';

const HEX_32 = /^[0-9a-f]{64}$/i;
const MAX_BODY_CHARS = 20000;

function isValidHexKey(value) {
  return typeof value === 'string' && HEX_32.test(value.trim());
}

function readLocalStorage(key, fallback = '') {
  try {
    return localStorage.getItem(key) || fallback;
  } catch (error) {
    return fallback;
  }
}

store.init();

let identity;
try {
  const savedKey = store.getSecretKey();
  identity = await initIdentity(isValidHexKey(savedKey) ? savedKey : null);
  store.setSecretKey(identity.hex);
} catch (error) {
  console.error('Could not initialize the saved account key.', error);
  ui.setStatus('Could not load account identity. Check browser storage and reload.');
  throw error;
}

const relayInput = document.getElementById('custom-relay');
if (relayInput) relayInput.value = store.relayUrl;

const addressSpan = document.getElementById('my-address-short');
if (addressSpan) {
  addressSpan.textContent = readLocalStorage('libremail_handle') ||
    `${identity.publicKey.slice(0, 10)}...${identity.publicKey.slice(-6)}`;
}

document.getElementById('copy-address-btn')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(identity.publicKey);
    ui.setStatus('Public key copied to clipboard.');
  } catch (error) {
    prompt('Copy your public key:', identity.publicKey);
  }
});

document.getElementById('save-relay-btn')?.addEventListener('click', () => {
  const value = document.getElementById('custom-relay')?.value.trim();
  if (!value) return ui.setStatus('Enter a relay URL first.');
  store.setRelayUrl(value);
  connectNetwork();
});

document.getElementById('compose-btn')?.addEventListener('click', () => ui.openCompose());
document.getElementById('close-compose-btn')?.addEventListener('click', () => ui.closeCompose());
document.getElementById('search-input')?.addEventListener('input', () => ui.renderMailList(identity.publicKey));

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => ui.switchView(item.dataset.folder, identity.publicKey));
});

document.getElementById('add-contact-btn')?.addEventListener('click', async () => {
  const nameInput = document.getElementById('contact-name');
  const addressInput = document.getElementById('contact-address');
  const name = nameInput?.value.trim();
  const address = addressInput?.value.trim();
  if (!name || !address) return alert('Enter both a nickname and an address.');

  try {
    ui.setStatus('Verifying address...');
    const pubkey = await resolveRecipient(address);
    const nip05 = address.includes('@') ? address.toLowerCase() : '';
    if (!store.addContact({ name, pubkey, nip05 })) throw new Error('Contact could not be saved.');
    nameInput.value = '';
    addressInput.value = '';
    ui.renderAutocomplete();
    ui.renderContactsList();
    ui.setStatus('Contact saved.');
  } catch (error) {
    ui.setStatus('Address lookup failed.');
    alert(`Could not add contact: ${error.message}`);
  }
});

document.getElementById('contacts-list')?.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.emailTo) return ui.openCompose(button.dataset.emailTo);
  if (button.dataset.deleteContact !== undefined) {
    store.removeContact(Number(button.dataset.deleteContact));
    ui.renderAutocomplete();
    ui.renderContactsList();
  }
});

document.getElementById('mail-list')?.addEventListener('click', event => {
  const target = event.target;
  const star = target.closest('[data-star]');
  if (star) {
    event.stopPropagation();
    const updated = store.toggleStar(star.dataset.star);
    if (updated) star.classList.toggle('starred', updated.starred);
    return;
  }

  const row = target.closest('.mail-row');
  if (!row) return;
  const msg = store.emails.find(item => item.id === row.dataset.id);
  if (!msg) return;

  ui.openReader(msg, identity.publicKey, {
    onBack: () => ui.switchView(store.currentFolder, identity.publicKey),
    onReply: (to, subject, id) => ui.openCompose(to, subject, id),
    onDelete: id => {
      store.moveToTrash(id);
      ui.updateInboxBadge();
      ui.switchView(store.currentFolder, identity.publicKey);
    },
    onRestore: id => {
      store.restoreFromTrash(id);
      ui.updateInboxBadge();
      ui.switchView('trash', identity.publicKey);
    },
    onPermanentDelete: id => {
      if (confirm('Permanently delete this message?')) {
        store.permanentDelete(id);
        ui.switchView('trash', identity.publicKey);
      }
    },
    onSaveSender: pubkey => {
      const nickname = prompt('Enter a nickname for this sender:')?.trim();
      if (!nickname) return;
      store.addContact({ name: nickname, pubkey, nip05: '' });
      ui.renderAutocomplete();
      ui.switchView(store.currentFolder, identity.publicKey);
    },
  });
});

document.getElementById('send-btn')?.addEventListener('click', async event => {
  const sendButton = event.currentTarget;
  const to = document.getElementById('to-input')?.value.trim();
  const subject = document.getElementById('sub-input')?.value.trim() || '(No Subject)';
  const bodyInput = document.getElementById('body-input');
  const body = bodyInput?.value || '';
  const replyId = document.getElementById('reply-id-input')?.value || null;

  if (!to || !body.trim()) return alert('Recipient address and message body are required.');
  if (body.length > MAX_BODY_CHARS) return alert(`Message must be under ${MAX_BODY_CHARS} characters.`);
  if (sendButton.disabled) return;

  sendButton.disabled = true;
  ui.setStatus('Resolving recipient and encrypting...');
  try {
    const recipientPk = await resolveRecipient(to);
    const senderHandle = readLocalStorage('libremail_handle') || `${identity.publicKey.slice(0, 6)}...@...${identity.publicKey.slice(-4)}`;
    const giftWrap = await encryptEmail(identity.secretKey, recipientPk, { subject, body, senderHandle }, replyId);
    await publishToRelays(store.relayUrl, giftWrap);

    const sentMessage = {
      id: giftWrap.id,
      folder: 'sent',
      from: identity.publicKey,
      to: recipientPk,
      subject,
      body,
      senderHandle,
      time: Date.now(),
      starred: false,
    };
    store.addEmail(sentMessage);
    ui.updateInboxBadge();
    ui.switchView(store.currentFolder, identity.publicKey);
    bodyInput.value = '';
    ui.closeCompose();
    ui.setStatus('Message sent.');
  } catch (error) {
    ui.setStatus('Send failed.');
    alert(`Failed to send: ${error.message}`);
  } finally {
    sendButton.disabled = false;
  }
});

let reconnectTimer = null;
let reconnectDelay = 1000;
function connectNetwork() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ui.setStatus(`Connecting to ${store.relayUrl}...`);
  try {
    subscribeToInbox({
      primaryRelay: store.relayUrl,
      mySecretKey: identity.secretKey,
      myPublicKey: identity.publicKey,
      onNewEmail(decrypted) {
        if (!decrypted?.id) return;
        try {
          if (decrypted.senderHandle) localStorage.setItem(`handle_${decrypted.from}`, decrypted.senderHandle);
        } catch (error) {
          console.warn('Could not cache sender handle.', error);
        }
        const inboxMessage = { ...decrypted, folder: 'inbox', to: identity.publicKey, starred: false };
        if (store.addEmail(inboxMessage)) {
          ui.updateInboxBadge();
          if (store.currentFolder === 'inbox') ui.switchView('inbox', identity.publicKey);
        }
      },
      onConnected(relay) {
        reconnectDelay = 1000;
        ui.setStatus(`Connected to ${relay}`);
      },
      onError(message) {
        ui.setStatus(`Relay disconnected: ${message}`);
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 60000);
          connectNetwork();
        }, reconnectDelay);
      },
    });
  } catch (error) {
    ui.setStatus(`Relay connection failed: ${error.message}`);
  }
}

ui.updateInboxBadge();
ui.renderAutocomplete();
ui.switchView('inbox', identity.publicKey);
connectNetwork();

window.addEventListener('beforeunload', () => {
  if (reconnectTimer) clearTimeout(reconnectTimer);
});
