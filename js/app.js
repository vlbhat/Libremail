import { initIdentity, encryptEmail, resolveRecipient } from './crypto.js';
import { store } from './store.js';
import { publishToRelays, subscribeToInbox } from './network.js';
import { ui } from './ui.js';

const VALID_RELAY = /^wss?:\/\//i;

function isValidRelayUrl(value) {
  return typeof value === 'string' && VALID_RELAY.test(value.trim());
}

function makeKeyboardButton(element, label) {
  if (!element) return;
  element.setAttribute('role', 'button');
  element.setAttribute('tabindex', '0');
  element.setAttribute('aria-label', label);
  element.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      element.click();
    }
  });
}

async function copyPublicKey() {
  try {
    await navigator.clipboard.writeText(identity.publicKey);
    ui.setStatus('Public key copied to clipboard.');
  } catch (error) {
    window.prompt('Copy your public key:', identity.publicKey);
  }
}

store.init();
const identity = await initIdentity(store.getSecretKey());
store.setSecretKey(identity.hex);

document.getElementById('custom-relay').value = store.relayUrl;

const addressSpan = document.getElementById('my-address-short');
if (addressSpan) {
  addressSpan.textContent = `${identity.publicKey.slice(0, 10)}...${identity.publicKey.slice(-6)}`;
  addressSpan.title = identity.publicKey;
}

const copyAddressButton = document.getElementById('copy-address-btn');
makeKeyboardButton(copyAddressButton, 'Copy your public key');
if (copyAddressButton) copyAddressButton.onclick = copyPublicKey;
makeKeyboardButton(document.getElementById('close-compose-btn'), 'Close compose window');

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
  const folder = item.dataset.folder;
  makeKeyboardButton(item, `Open ${folder} folder`);
  item.onclick = () => ui.switchView(folder, identity.publicKey);
});

document.getElementById('add-contact-btn').onclick = async () => {
  const name = document.getElementById('contact-name').value.trim();
  const rawAddress = document.getElementById('contact-address').value.trim();
  if (!name || !rawAddress) return alert('Enter both a nickname and a public key.');

  try {
    const pubkey = await resolveRecipient(rawAddress);
    const added = store.addContact({ name, pubkey, nip05: '' });
    if (!added) throw new Error('A contact with this public key is already saved.');
    document.getElementById('contact-name').value = '';
    document.getElementById('contact-address').value = '';
    ui.renderAutocomplete();
    ui.renderContactsList();
    ui.setStatus('Contact saved.');
  } catch (error) {
    ui.setStatus('Could not add contact');
    alert(`Could not add contact: ${error.message}`);
  }
};

document.getElementById('contacts-list').onclick = event => {
  const emailButton = event.target.closest('[data-email-to]');
  if (emailButton) return ui.openCompose(emailButton.dataset.emailTo);
  const deleteButton = event.target.closest('[data-delete-contact]');
  if (deleteButton) {
    store.removeContact(Number(deleteButton.dataset.deleteContact));
    ui.renderAutocomplete();
    ui.renderContactsList();
  }
};

document.getElementById('mail-list').onclick = event => {
  const starButton = event.target.closest('[data-star]');
  if (starButton) {
    event.stopPropagation();
    const updated = store.toggleStar(starButton.dataset.star);
    if (updated) {
      starButton.classList.toggle('starred', updated.starred);
      starButton.setAttribute('aria-pressed', String(updated.starred));
      starButton.setAttribute('aria-label', updated.starred ? 'Unstar message' : 'Star message');
    }
    return;
  }

  const row = event.target.closest('.mail-row');
  if (!row) return;
  const msg = store.emails.find(message => message.id === row.dataset.id);
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
      const nickname = window.prompt('Enter a nickname for this sender:');
      if (!nickname?.trim()) return;
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

  if (!rawTo || !body.trim()) return alert('Recipient public key and message body are required.');

  ui.setStatus('Validating recipient public key and encrypting...');
  try {
    const recipientPk = await resolveRecipient(rawTo);
    const giftWrap = await encryptEmail(identity.secretKey, recipientPk, { subject, body }, replyId);
    if (!isValidRelayUrl(store.relayUrl)) throw new Error('A valid relay URL is required before sending.');

    await publishToRelays(store.relayUrl, giftWrap);
    const sentMsg = {
      id: giftWrap.id,
      folder: 'sent',
      from: identity.publicKey,
      to: recipientPk,
      subject,
      body,
      time: Date.now(),
      starred: false
    };
    store.addEmail(sentMsg);
    ui.prependEmailRow(sentMsg, identity.publicKey);
    document.getElementById('body-input').value = '';
    ui.closeCompose();
    ui.setStatus('Message sent.');
  } catch (error) {
    ui.setStatus('Send failed');
    alert(`Failed to send: ${error.message}`);
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
