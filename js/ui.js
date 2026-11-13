import { store } from './store.js';

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export const ui = {
  updateInboxBadge() {
    document.getElementById('count-inbox').textContent =
      store.emails.filter(e => e.folder === 'inbox').length;
  },

  setStatus(text) {
    document.getElementById('status-text').textContent = text;
  },

  renderAutocomplete() {
    const datalist = document.getElementById('contact-suggestions');
    datalist.innerHTML = store.contacts.map(c =>
      `<option value="${escapeHtml(c.pubkey)}">${escapeHtml(c.name)} ${c.nip05 ? `(${escapeHtml(c.nip05)})` : ''}</option>`
    ).join('');
  },

  createMailRowHTML(msg, myPublicKey) {
    const label = msg.from === myPublicKey
      ? `To: ${store.formatAddress(msg.to)}`
      : store.formatAddress(msg.from);
    const timeStr = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return `
      <div class="mail-row" data-id="${msg.id}">
        <span class="star ${msg.starred ? 'starred' : ''}" data-star="${msg.id}">★</span>
        <div class="sender">${escapeHtml(label)}</div>
        <div class="snippet"><strong>${escapeHtml(msg.subject)}</strong> — ${escapeHtml(msg.body)}</div>
        <div class="time">${timeStr}</div>
      </div>
    `;
  },

  // Incremental insertion: prepends a single new email without wiping existing DOM rows
  prependEmailRow(msg, myPublicKey) {
    if (store.currentFolder !== msg.folder) return;
    const listEl = document.getElementById('mail-list');
    const emptyState = listEl.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    listEl.insertAdjacentHTML('afterbegin', this.createMailRowHTML(msg, myPublicKey));
  },

  renderMailList(myPublicKey) {
    const query = document.getElementById('search-input').value;
    const listEl = document.getElementById('mail-list');
    const filtered = store.getFilteredEmails(query);

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No messages in ${store.currentFolder}.</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(msg => this.createMailRowHTML(msg, myPublicKey)).join('');
  },

  renderContactsList() {
    const container = document.getElementById('contacts-list');
    if (store.contacts.length === 0) {
      container.innerHTML = `<div class="empty-state">No contacts saved yet. Add a friend's public key or NIP-05 address above!</div>`;
      return;
    }

    container.innerHTML = store.contacts.map((c, index) => `
      <div class="mail-row contact-row">
        <div>
          <strong>${escapeHtml(c.name)}</strong>
          ${c.nip05 ? `<span class="nip05-badge">${escapeHtml(c.nip05)}</span>` : ''}
          <div class="contact-key">${c.pubkey}</div>
        </div>
        <div>
          <button class="action-btn" data-email-to="${c.pubkey}">✉️ Mail</button>
          <button class="action-btn" data-delete-contact="${index}">🗑️ Remove</button>
        </div>
      </div>
    `).join('');
  },

  openReader(msg, myPublicKey, handlers) {
    document.getElementById('mail-list').style.display = 'none';
    const readerEl = document.getElementById('mail-reader');
    readerEl.style.display = 'block';

    const replySubject = msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`;
    const isSaved = store.contacts.some(c => c.pubkey === msg.from);

    readerEl.innerHTML = `
      <div class="reader-header">
        <div class="reader-subject">${escapeHtml(msg.subject)}</div>
        <button class="action-btn" id="back-btn">← Back</button>
      </div>
      <div class="reader-meta">
        <div><strong>From:</strong> ${escapeHtml(store.formatAddress(msg.from))}</div>
        <div>${new Date(msg.time).toLocaleString()}</div>
      </div>
      <div class="reader-body">${escapeHtml(msg.body)}</div>
      <button class="action-btn" id="reply-btn">↩ Reply</button>
      ${!isSaved && msg.from !== myPublicKey ? `<button class="action-btn" id="save-sender-btn">➕ Save Sender</button>` : ''}
      <button class="action-btn" id="trash-btn">🗑️ Delete</button>
    `;

    document.getElementById('back-btn').onclick = handlers.onBack;
    document.getElementById('reply-btn').onclick = () => handlers.onReply(msg.from, replySubject, msg.id);
    document.getElementById('trash-btn').onclick = () => handlers.onDelete(msg.id);
    const saveBtn = document.getElementById('save-sender-btn');
    if (saveBtn) saveBtn.onclick = () => handlers.onSaveSender(msg.from, msg.id);
  },

  switchView(folder, myPublicKey) {
    store.currentFolder = folder;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`nav-${folder}`).classList.add('active');
    document.getElementById('folder-title').textContent = folder.charAt(0).toUpperCase() + folder.slice(1);

    document.getElementById('mail-reader').style.display = 'none';
    document.getElementById('mail-list').style.display = folder === 'contacts' ? 'none' : 'block';
    document.getElementById('contacts-view').style.display = folder === 'contacts' ? 'block' : 'none';

    if (folder === 'contacts') {
      this.renderContactsList();
    } else {
      this.renderMailList(myPublicKey);
    }
  },

  openCompose(to = '', subject = '', replyId = '') {
    document.getElementById('to-input').value = to;
    document.getElementById('sub-input').value = subject;
    document.getElementById('reply-id-input').value = replyId;
    document.getElementById('compose-title').textContent = replyId ? 'Reply Message' : 'New Message';
    document.getElementById('compose-modal').style.display = 'flex';
  },

  closeCompose() {
    document.getElementById('compose-modal').style.display = 'none';
  },
};