import { initIdentity, encryptEmail, resolveRecipient } from './crypto.js';
import { store } from './store.js';
import { publishToRelays, subscribeToInbox } from './network.js';
import { ui } from './ui.js';

store.init();
const identity = await initIdentity(store.getSecretKey());
store.setSecretKey(identity.hex);

document.getElementById('custom-relay').value = store.relayUrl;

// Header: Display saved human-readable handle or fallback to truncated public key
const addressSpan = document.getElementById('my-address-short');
const updateHeaderDisplay = () => {
  const currentHandle = localStorage.getItem('libremail_handle') || '';
  addressSpan.textContent = currentHandle || `${identity.publicKey.slice(0, 10)}...${identity.publicKey.slice(-6)}`;
};
updateHeaderDisplay();

// Tapping the profile pill instantly copies your full public key to the clipboard
document.getElementById('copy-address-btn').onclick = async () => {
  try {
    await navigator.clipboard.writeText(identity.publicKey);
    ui.setStatus('Public key copied to clipboard ✓');
    alert(`Public key successfully copied to clipboard:\n\n${identity.publicKey}`);
  } catch (err) {
    prompt('Copy your public key below:', identity.publicKey);
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

// Mail List Interactions (Incremental Star Toggle + Reader + Trash Handlers)
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
    const myHandle = localStorage.getItem('libremail_handle') || `${identity.publicKey.slice(0, 6)}...@...${identity.publicKey.slice(-4)}`;

    const giftWrap = await encryptEmail(identity.secretKey, recipientPk, { 
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
      if (decrypted.senderHandle) {
        localStorage.setItem(`handle_${decrypted.from}`, decrypted.senderHandle);
      }

      const inboxMsg = { ...decrypted, folder: 'inbox', to: identity.publicKey, starred: false };
      if (store.addEmail(inboxMsg)) {
        ui.updateInboxBadge();
        // Instantly re-render active folder view to show the incoming email live
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

// Expose modules globally for easy F12 console debugging
window.store = store;
window.ui = ui;
window.identity = identity;
