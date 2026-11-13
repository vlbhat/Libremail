import { initIdentity, encryptEmail, resolveRecipient } from './crypto.js';
import { store } from './store.js';
import { publishToRelays, subscribeToInbox } from './network.js';
import { ui } from './ui.js';

function isValidHexKey(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value.trim());
}

store.init();

let identity;
try {
  const savedKey = store.getSecretKey();
  const candidateKey = isValidHexKey(savedKey) ? savedKey : null;
  identity = await initIdentity(candidateKey);
  if (identity && identity.hex) {
    store.setSecretKey(identity.hex);
  }
} catch (err) {
  console.warn('Could not initialize saved identity; generating new one.', err);
  identity = await initIdentity();
  store.setSecretKey(identity.hex);
}

const relayInput = document.getElementById('custom-relay');
if (relayInput) relayInput.value = store.relayUrl;

const addressSpan = document.getElementById('my-address-short');
const updateHeaderDisplay = () => {
  if (!addressSpan) return;
  const currentHandle = localStorage.getItem('libremail_handle') || '';
  addressSpan.textContent = currentHandle || `${identity.publicKey.slice(0, 10)}...${identity.publicKey.slice(-6)}`;
};
updateHeaderDisplay();

document.getElementById('copy-address-btn')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(identity.publicKey);
    ui.setStatus('Public key copied to clipboard ✓');
    alert(`Public key successfully copied to clipboard:\n\n${identity.publicKey}`);
  } catch (err) {
    prompt('Copy your public key below:', identity.publicKey);
  }
});

document.getElementById('save-relay-btn')?.addEventListener('click', () => {
  const relayValue = document.getElementById('custom-relay')?.value.trim();
  if (relayValue) {
    store.setRelayUrl(relayValue);
    connectNetwork();
  }
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
  const rawAddress = addressInput?.value.trim();

  if (!name || !rawAddress) {
    return alert('Enter both a nickname and an address.');
  }

  try {
    ui.setStatus('Verifying address...');
    const pubkey = await resolveRecipient(rawAddress);
    const nip05 = rawAddress.includes('@') ? rawAddress.toLowerCase() : '';

    store.addContact({ name, pubkey, nip05 });
    if (nameInput) nameInput.value = '';
    if (addressInput) addressInput.value = '';

    ui.renderAutocomplete();
    ui.renderContactsList();
    ui.setStatus('Contact saved ✓');
  } catch (err) {
    ui.setStatus('Address lookup failed');
    alert(`Could not add contact: ${err.message}`);
  }
});

document.getElementById('contacts-list')?.addEventListener('click', (e) => {
  const emailTo = e.target.dataset.emailTo;
  if (emailTo) return ui.openCompose(emailTo);

  if (e.target.dataset.deleteContact !== undefined) {
    store.removeContact(Number(e.target.dataset.deleteContact));
    ui.renderAutocomplete();
    ui.renderContactsList();
  }
});

document.getElementById('mail-list')?.addEventListener('click', (e) => {
  const starId = e.target.dataset.star;
  if (starId) {
    e.stopPropagation();
    const updated = store.toggleStar(starId);
    if (updated) e.target.classList.toggle('starred', updated.starred);
    return;
  }

  const row = e.target.closest('.mail-row');
  if (!row) return;

  const msg = store.emails.find(m => m.id === row.dataset.id);
  if (!msg) return;

  ui.openReader(msg, identity.publicKey, {
    onBack: () => ui.switchView(store.currentFolder, identity.publicKey),
    onReply: (to, sub, id) => ui.openCompose(to, sub, id),
    onDelete: (id) => {
      store.moveToTrash(id);
      ui.switchView(store.currentFolder, identity.publicKey);
    },
    onRestore: (id) => {
      store.restoreFromTrash(id);
      ui.updateInboxBadge();
      ui.switchView('trash', identity.publicKey);
    },
    onPermanentDelete: (id) => {
      if (confirm('Permanently delete this message?')) {
        store.permanentDelete(id);
        ui.switchView('trash', identity.publicKey);
      }
    },
    onSaveSender: (pubkey) => {
      const nickname = prompt('Enter a nickname for this sender:');
      if (!nickname) return;
      store.addContact({ name: nickname.trim(), pubkey, nip05: '' });
      ui.renderAutocomplete();
      ui.switchView(store.currentFolder, identity.publicKey);
    },
  });
});

document.getElementById('send-btn')?.addEventListener('click', async () => {
  const toInput = document.getElementById('to-input');
  const subInput = document.getElementById('sub-input');
  const bodyInput = document.getElementById('body-input');
  const replyInput = document.getElementById('reply-id-input');

  const rawTo = toInput?.value.trim();
  const subject = subInput?.value || '(No Subject)';
  const body = bodyInput?.value || '';
  const replyId = replyInput?.value || null;

  if (!rawTo || !body) return alert('Recipient address and message body are required.');

  ui.setStatus('Resolving recipient & encrypting...');

  try {
    const recipientPk = await resolveRecipient(rawTo);
    const myHandle = localStorage.getItem('libremail_handle') || `${identity.publicKey.slice(0, 6)}...@...${identity.publicKey.slice(-4)}`;

    const giftWrap = await encryptEmail(identity.secretKey, recipientPk, {
      subject,
      body,
      senderHandle: myHandle,
    }, replyId);

    await publishToRelays(store.relayUrl, giftWrap);

    const sentMsg = {
      id: giftWrap.id,
      folder: 'sent',
      from: identity.publicKey,
      to: recipientPk,
      subject,
      body,
      senderHandle: myHandle,
      time: Date.now(),
      starred: false,
    };

    store.addEmail(sentMsg);
    ui.prependEmailRow(sentMsg, identity.publicKey);
    if (bodyInput) bodyInput.value = '';
    ui.closeCompose();
    ui.setStatus('Message sent ✓');
  } catch (err) {
    ui.setStatus('Send failed');
    alert(`Failed to send: ${err.message}`);
  }
});

function connectNetwork() {
  ui.setStatus(`Connecting to ${store.relayUrl}...`);
  subscribeToInbox({
    primaryRelay: store.relayUrl,
    mySecretKey: identity.secretKey,
    myPublicKey: identity.publicKey,
    onNewEmail(decrypted) {
      if (decrypted?.senderHandle) {
        localStorage.setItem(`handle_${decrypted.from}`, decrypted.senderHandle);
      }

      const inboxMsg = { ...decrypted, folder: 'inbox', to: identity.publicKey, starred: false };
      if (store.addEmail(inboxMsg)) {
        ui.updateInboxBadge();
        ui.switchView(store.currentFolder, identity.publicKey);
      }
    },
    onConnected(relay) {
      ui.setStatus(`Connected to ${relay}`);
    },
  });
}

ui.updateInboxBadge();
ui.renderAutocomplete();
ui.switchView('inbox', identity.publicKey);
connectNetwork();

window.store = store;
window.ui = ui;
window.identity = identity;
