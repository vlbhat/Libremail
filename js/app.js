import { initIdentity, encryptEmail, resolveRecipient } from './crypto.js';
import { store } from './store.js';
import { publishToRelays, subscribeToInbox } from './network.js';
import { ui } from './ui.js';

const VALID_RELAY = /^wss?:\/\//i;

function isValidRelayUrl(value) {
  return typeof value === 'string' && VALID_RELAY.test(value.trim());
}

store.init();
const identity = await initIdentity(store.getSecretKey());
store.setSecretKey(identity.hex);

document.getElementById('custom-relay').value = store.relayUrl;

const addressSpan = document.getElementById('my-address-short');
const updateHeaderDisplay = () => {
  const currentHandle = localStorage.getItem('libremail_handle') || '';
  addressSpan.textContent = currentHandle || `${identity.publicKey.slice(0, 10)}...${identity.publicKey.slice(-6)}`;
};
updateHeaderDisplay();

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
  const relayUrl = document.getElementById('custom-relay').value.trim();
  if (!isValidRelayUrl(relayUrl)) {
    ui.setStatus('Invalid relay URL');
    alert('Please enter a valid relay URL starting with ws:// or wss://');
    return;
  }
  store.setRelayUrl(relayUrl);
  connectNetwork();
};

document.getElementById('compose-btn').onclick = () => ui.openCompose();
document.getElementById('close-compose-btn').onclick = () => ui.closeCompose();
document.getElementById('search-input').oninput = () => ui.renderMailList(identity.publicKey);

document.querySelectorAll('.nav-item').forEach(item => {
  item.onclick = () => ui.switchView(item.dataset.folder, identity.publicKey);
});

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
    }
  });
};

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

    if (!isValidRelayUrl(store.relayUrl)) {
      throw new Error('A valid relay URL is required before sending.');
    }

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
      starred: false
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

function connectNetwork() {
  const relayUrl = store.relayUrl;
  if (!isValidRelayUrl(relayUrl)) {
    ui.setStatus('Invalid relay URL');
    return;
  }

  ui.setStatus(`Connecting to ${relayUrl}...`);
  subscribeToInbox({
    primaryRelay: relayUrl,
    mySecretKey: identity.secretKey,
    myPublicKey: identity.publicKey,
    onNewEmail(decrypted) {
      if (decrypted.senderHandle) {
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
    }
  });
}

ui.updateInboxBadge();
ui.renderAutocomplete();
ui.switchView('inbox', identity.publicKey);
connectNetwork();

window.store = store;
window.ui = ui;
window.identity = identity;
