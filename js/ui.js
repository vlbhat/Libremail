import { store } from './store.js';

function escapeHtml(text) {
  const value = String(text ?? '');
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

export const ui = {
  updateInboxBadge() {
    const countEl = document.getElementById('count-inbox');
    if (!countEl) return;
    countEl.textContent = store.emails.filter(e => e.folder === 'inbox').length;
  },

  setStatus(text) {
    const statusEl = document.getElementById('status-text');
    if (statusEl) statusEl.textContent = String(text ?? '');
  },

  renderAutocomplete() {
    const datalist = document.getElementById('contact-suggestions');
    if (!datalist) return;

    datalist.innerHTML = (Array.isArray(store.contacts) ? store.contacts : []).map(c =>
      `<option value="${escapeHtml(c.pubkey || '')}">${escapeHtml(c.name || 'Unknown')} ${c.nip05 ? `(${escapeHtml(c.nip05)})` : ''}</option>`
    ).join('');
  },

  createMailRowHTML(msg, myPublicKey) {
    const item = msg || {};
    const subject = String(item.subject || '(No Subject)');
    const body = String(item.body || '');
    const label = item.from === myPublicKey
      ? `To: ${store.formatAddress(item.to)}`
      : store.formatAddress(item.from);

    const timeStr = new Date(item.time || Date.now()).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });

    return `
      <div class="mail-row" data-id="${item.id}">
        <span class="star ${item.starred ? 'starred' : ''}" data-star="${item.id}">★</span>
        <div class="sender">${escapeHtml(label)}</div>
        <div class="snippet"><strong>${escapeHtml(subject)}</strong> — ${escapeHtml(body)}</div>
        <div class="time">${timeStr}</div>
      </div>
    `;
  },

  prependEmailRow(msg, myPublicKey) {
    if (store.currentFolder !== msg.folder) return;

    const listEl = document.getElementById('mail-list');
    if (!listEl) return;

    const emptyState = listEl.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    listEl.insertAdjacentHTML('afterbegin', this.createMailRowHTML(msg, myPublicKey));
  },

  renderMailList(myPublicKey) {
    const query = document.getElementById('search-input')?.value || '';
    const listEl = document.getElementById('mail-list');
    if (!listEl) return;

    const filtered = store.getFilteredEmails(query, store.currentFolder);

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No messages in ${store.currentFolder}.</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(msg => this.createMailRowHTML(msg, myPublicKey)).join('');
  },

  renderContactsList() {
    const container = document.getElementById('contacts-list');
    if (!container) return;

    if (!store.contacts.length) {
      container.innerHTML = `<div class="empty-state">No contacts saved yet. Add a friend's public key or NIP-05 address above!</div>`;
      return;
    }

    container.innerHTML = (Array.isArray(store.contacts) ? store.contacts : []).map((c, index) => `
      <div class="mail-row contact-row">
        <div>
          <strong>${escapeHtml(c.name || 'Unknown')}</strong>
          ${c.nip05 ? `<span class="nip05-badge">${escapeHtml(c.nip05)}</span>` : ''}
          <div class="contact-key">${escapeHtml(c.pubkey || '')}</div>
        </div>
        <div>
          <button class="action-btn" data-email-to="${escapeHtml(c.pubkey || '')}">✉️ Mail</button>
          <button class="action-btn" data-delete-contact="${index}">🗑️ Remove</button>
        </div>
      </div>
    `).join('');
  },

  openReader(msg, myPublicKey, handlers = {}) {
    if (!msg) return;

    const listEl = document.getElementById('mail-list');
    if (listEl) listEl.style.display = 'none';

    const readerEl = document.getElementById('mail-reader');
    if (!readerEl) return;

    readerEl.style.display = 'block';

    const subject = String(msg.subject || '(No Subject)');
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    const isSaved = store.contacts.some(c => c.pubkey === msg.from);
    const isTrash = msg.folder === 'trash';

    readerEl.innerHTML = `
      <div class="reader-header">
        <div class="reader-subject">${escapeHtml(subject)}</div>
        <button class="action-btn" id="back-btn">← Back</button>
      </div>
      <div class="reader-meta">
        <div><strong>From:</strong> ${escapeHtml(store.formatAddress(msg.from))}</div>
        <div>${new Date(msg.time || Date.now()).toLocaleString()}</div>
      </div>
      <div class="reader-body">${escapeHtml(String(msg.body || ''))}</div>

      ${isTrash ? `
        <button class="action-btn" id="restore-btn">♻️ Restore to Inbox</button>
        <button class="action-btn" id="perm-delete-btn" style="color: #d93025;">🗑️ Delete Forever</button>
      ` : `
        <button class="action-btn" id="reply-btn">↩ Reply</button>
        ${!isSaved && msg.from !== myPublicKey ? `<button class="action-btn" id="save-sender-btn">➕ Save Sender</button>` : ''}
        <button class="action-btn" id="trash-btn">🗑️ Delete</button>
      `}
    `;

    const backBtn = document.getElementById('back-btn');
    if (backBtn) backBtn.onclick = handlers.onBack;

    if (isTrash) {
      const restoreBtn = document.getElementById('restore-btn');
      const permDeleteBtn = document.getElementById('perm-delete-btn');
      if (restoreBtn) restoreBtn.onclick = () => handlers.onRestore?.(msg.id);
      if (permDeleteBtn) permDeleteBtn.onclick = () => handlers.onPermanentDelete?.(msg.id);
    } else {
      const replyBtn = document.getElementById('reply-btn');
      const trashBtn = document.getElementById('trash-btn');
      if (replyBtn) replyBtn.onclick = () => handlers.onReply?.(msg.from, replySubject, msg.id);
      if (trashBtn) trashBtn.onclick = () => handlers.onDelete?.(msg.id);

      const saveBtn = document.getElementById('save-sender-btn');
      if (saveBtn) saveBtn.onclick = () => handlers.onSaveSender?.(msg.from, msg.id);
    }
  },

  switchView(folder, myPublicKey) {
    store.currentFolder = folder;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    const activeNav = document.getElementById(`nav-${folder}`);
    if (activeNav) activeNav.classList.add('active');

    const folderTitle = document.getElementById('folder-title');
    if (folderTitle) {
      folderTitle.textContent = folder.charAt(0).toUpperCase() + folder.slice(1);
    }

    const reader = document.getElementById('mail-reader');
    const list = document.getElementById('mail-list');
    const contactsView = document.getElementById('contacts-view');

    if (reader) reader.style.display = 'none';
    if (list) list.style.display = folder === 'contacts' ? 'none' : 'block';
    if (contactsView) contactsView.style.display = folder === 'contacts' ? 'block' : 'none';

    if (folder === 'contacts') {
      this.renderContactsList();
    } else {
      this.renderMailList(myPublicKey);
    }
  },

  openCompose(to = '', subject = '', replyId = '') {
    const toInput = document.getElementById('to-input');
    const subjectInput = document.getElementById('sub-input');
    const replyInput = document.getElementById('reply-id-input');
    const composeTitle = document.getElementById('compose-title');
    const composeModal = document.getElementById('compose-modal');

    if (toInput) toInput.value = to;
    if (subjectInput) subjectInput.value = subject;
    if (replyInput) replyInput.value = replyId;
    if (composeTitle) composeTitle.textContent = replyId ? 'Reply Message' : 'New Message';
    if (composeModal) composeModal.style.display = 'flex';
  },

  closeCompose() {
    const composeModal = document.getElementById('compose-modal');
    if (composeModal) composeModal.style.display = 'none';
  },
};
