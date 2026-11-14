import { initIdentity, encryptEmail, resolveRecipient, resolveNip05Address } from './crypto.js';
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

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    ui.setStatus(`${label} copied to clipboard.`);
  } catch (error) {
    window.prompt(`Copy ${label.toLowerCase()}:`, text);
  }
}

store.init();
const identity = await initIdentity(store.getSecretKey());
store.setSecretKey(identity.hex);

document.getElementById('custom-relay').value = store.relayUrl;

const addressSpan = document.getElementById('my-address-short');
const myEmailInput = document.getElementById('my-email-input');
const myEmailAddress = document.getElementById('my-email-address');
const myEmailStatus = document.getElementById('my-email-status');

function renderMyAddress() {
  const email = localStorage.getItem('libremail_handle') || '';
  if (myEmailInput) myEmailInput.value = email;
  if (myEmailAddress) {
    myEmailAddress.textContent = email || 'No verified email address set';
  }
  if (myEmailStatus) {
    myEmailStatus.textContent = email
      ? 'Verified against its domain’s NIP-05 record.'
      : 'You can share either address. A NIP-05 address requires a domain you control to publish its public-key mapping.';
  }
  if (addressSpan) {
    addressSpan.textContent = email || `${identity.publicKey.slice(0, 10)}...${identity.publicKey.slice(-6)}`;
    addressSpan.title = email ? `NIP-05 address: ${email}` : 'No NIP-05 address set; public key shown.';
  }
}
renderMyAddress();

makeKeyboardButton(document.getElementById('copy-address-btn'), 'Copy your public key');
makeKeyboardButton(document.getElementById('close-compose-btn'), 'Close compose window');

document.getElementById('copy-address-btn').onclick = () => copyText(identity.publicKey, 'Public key');

document.getElementById('copy-email-btn').onclick = () => {
  const email = localStorage.getItem('libremail_handle');
  if (!email) {
    ui.setStatus('Verify and save a NIP-05 address first.');
    return;
  }
  return copyText(email, 'NIP-05 address');
};

document.getElementById('save-my-email-btn').onclick = async () => {
  const address = myEmailInput?.value.trim().toLowerCase() || '';
  if (!address) {
    ui.setStatus('Enter a NIP-05 address first.');
    return;
  }

  if (myEmailStatus) myEmailStatus.textContent = 'Checking the domain’s NIP-05 record…';
  ui.setStatus('Verifying your NIP-05 address…');
  try {
    const resolvedKey = await resolveNip05Address(address);
    if (resolvedKey !== identity.publicKey.toLowerCase()) {
      throw new Error('That NIP-05 address resolves to a different public key.');
    }
    localStorage.setItem('libremail_handle', address);
    renderMyAddress();
    ui.setStatus('Verified NIP-05 address saved ✓');
  } catch (error) {
    if (myEmailStatus) myEmailStatus.textContent = error.message;
    ui.setStatus('Could not verify NIP-05 address');
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
  const folder = item.dataset.folder;
  makeKeyboardButton(item, `Open ${folder} folder`);
  item.onclick = () => ui.switchView(folder, identity.publicKey);
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
  const emailButton = e.target.closest('[data-email-to]');
  if (emailButton) return ui.openCompose(emailButton.dataset.emailTo);
  const deleteButton = e.target.closest('[data-delete-contact]');
  if (deleteButton) {
    store.removeContact(Number(deleteButton.dataset.deleteContact));
    ui.renderAutocomplete();
    ui.renderContactsList();
  }
};

document.getElementById('mail-list').onclick = (e) => {
  const starButton = e.target.closest('[data-star]');
  if (starButton) {
    e.stopPropagation();
    const updated = store.toggleStar(starButton.dataset.star);
    if (updated) {
      starButton.classList.toggle('starred', updated.starred);
      starButton.setAttribute('aria-pressed', String(updated.starred));
      starButton.setAttribute('aria-label', updated.starred ? 'Unstar message' : 'Star message');
    }
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
    }
  });
};

document.getElementById('send-btn').onclick = async () => {
  const rawTo = document.getElementById('to-input').value.trim();
  const subject = document.getElementById('sub-input').value || '(No Subject)';
  const body = document.getElementById('body-input').value;
  const replyId = document.getElementById('reply-id-input').value || null;

  if (!rawTo || !body.trim()) return alert('Recipient address and message body are required.');

  ui.setStatus('Resolving recipient & encrypting...');
  try {
    const recipientPk = await resolveRecipient(rawTo);
    const myHandle = localStorage.getItem('libremail_handle') || identity.publicKey;

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
