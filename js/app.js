import { initIdentity, encryptEmail, resolveRecipient } from './crypto.js';
import { store } from './store.js';
import { publishToRelays, subscribeToInbox } from './network.js';
import { ui } from './ui.js';

store.init();
const identity = initIdentity(store.getSecretKey());
store.setSecretKey(identity.hex);

document.getElementById('custom-relay').value = store.relayUrl;

// Header: Display saved human-readable handle or fallback to truncated public key
const addressSpan = document.getElementById('my-address-short');
const updateHeaderDisplay = () => {
  const currentHandle = localStorage.getItem('libremail_handle') || '';
  addressSpan.textContent = currentHandle || `${identity.publicKey.slice(0, 10)}...${identity.publicKey.slice(-6)}`;
};
updateHeaderDisplay();

// Clicking the top-right pill lets you set or update your human-readable handle
document.getElementById('copy-address-btn').onclick = () => {
  const existingHandle = localStorage.getItem('libremail_handle') || '';
  const newHandle = prompt(
    'Enter your human-readable email handle (e.g. alice@vercel.app):\n\n(Leave blank and click OK to reset back to your public key)',
    existingHandle
  );

  if (newHandle !== null) {
    const trimmed = newHandle.trim();
    if (trimmed === '') {
      localStorage.removeItem('libremail_handle');
    } else {
      localStorage.setItem('libremail_handle', trimmed);
    }
    updateHeaderDisplay();
  } else {
    navigator.clipboard.writeText(identity.publicKey);
    alert(`Raw public key copied to clipboard:\n\n${identity.publicKey}`);
  }
};

document.getElementById('save-relay-btn').onclick = () => {
  store.setRelayUrl(document.getElementById('custom-relay').value.trim());
  connectNetwork();
};

document.getElementById('compose-btn').onclick = () => ui.openCompose();
document.getElementById('close-compose-btn').onclick = () => ui.closeCompose();
document.getElementById('search-input').oninput = () => ui.renderMailList(identity.publicKey);

document.querySelectorAll('.nav-item').forEach(item => {
  item.onclick = () => ui.switchView(item.dataset.folder, identity.publicKey);
});

// Contacts Management
document.getElementById('add-contact-btn').onclick = async () => {
  const name = document.getElementById('contact-name').value.trim();
  const rawAddress = document.getElementById('contact-address').value.trim();
  if (!name || !rawAddress) return alert('Enter both a nickname and an address.');

  try {
    ui.setStatus('Verifying address...');
    const pubkey = await resolveRecipient(rawAddress);
    const nip05 = rawAddress.includes('@') ? rawAddress.toLowerCase() : '';

    store.addContact({ name, pubkey, nip05 });
    document.getElementById('contact-name').value = '';
    document.getElementById('contact-address').value = '';
    ui.renderAutocomplete();
    ui.renderContactsList();
    ui.setStatus('Contact saved ✓');
  } catch (err) {
    ui.setStatus('Address lookup failed');
    alert(`Could not add contact: ${err.message}`);
  }
};

document.getElementById('contacts-list').onclick = (e) => {
  if (e.target.dataset.emailTo) return ui.openCompose(e.target.dataset.emailTo);
  if (e.target.dataset.deleteContact !== undefined) {
    store.removeContact(Number(e.target.dataset.deleteContact));
    ui.renderAutocomplete();
    ui.renderContactsList();
  }
};

// Mail List Interactions (Incremental Star Toggle + Reader)
document.getElementById('mail-list').onclick = (e) => {
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
    onSaveSender: (pubkey, msgId) => {
      const nickname = prompt('Enter a nickname for this sender:');
      if (!nickname) return;
      store.addContact({ name: nickname.trim(), pubkey, nip05: '' });
      ui.renderAutocomplete();
      ui.switchView(store.currentFolder, identity.publicKey);
    },
  });
};

// Send Encrypted Email
document.getElementById('send-btn').onclick = async () => {
  const rawTo = document.getElementById('to-input').value.trim();
  const subject = document.getElementById('sub-input').value || '(No Subject)';
  const body = document.getElementById('body-input').value;
  const replyId = document.getElementById('reply-id-input').value || null;

  if (!rawTo || !body) return alert('Recipient address and message body are required.');

  ui.setStatus('Resolving recipient & encrypting...');
  try {
    const recipientPk = await resolveRecipient(rawTo);
    
    // Grab your current human-readable handle to send along securely
    const myHandle = localStorage.getItem('libremail_handle') || `${identity.publicKey.slice(0, 6)}...@...${identity.publicKey.slice(-4)}`;

    const giftWrap = encryptEmail(identity.secretKey, recipientPk, { 
      subject, 
      body, 
      senderHandle: myHandle 
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
    document.getElementById('body-input').value = '';
    ui.closeCompose();
    ui.setStatus('Message sent ✓');
  } catch (err) {
    ui.setStatus('Send failed');
    alert(`Failed to send: ${err.message}`);
  }
};

// Network Subscription
function connectNetwork() {
  ui.setStatus(`Connecting to ${store.relayUrl}...`);
  subscribeToInbox({
    primaryRelay: store.relayUrl,
    mySecretKey: identity.secretKey,
    myPublicKey: identity.publicKey,
    onNewEmail(decrypted) {
      // If the incoming message contains a senderHandle, save it locally for this pubkey
      if (decrypted.senderHandle) {
        localStorage.setItem(`handle_${decrypted.from}`, decrypted.senderHandle);
      }

      const inboxMsg = { ...decrypted, folder: 'inbox', to: identity.publicKey, starred: false };
      if (store.addEmail(inboxMsg)) {
        ui.updateInboxBadge();
        ui.prependEmailRow(inboxMsg, identity.publicKey);
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
