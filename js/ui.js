import { store } from './store.js';

function escapeHtml(text) {
  const value = text == null ? '' : String(text);
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

export const ui = {
  updateInboxBadge() {
    const inboxCount = document.getElementById('count-inbox');
    if (inboxCount) {
      inboxCount.textContent = store.emails.filter(e => e.folder === 'inbox').length;
    }
  },

  setStatus(text) {
    const statusEl = document.getElementById('status-text');
    if (statusEl) statusEl.textContent = text;
  },

  renderAutocomplete() {
    const datalist = document.getElementById('contact-suggestions');
    if (!datalist) return;

    datalist.innerHTML = store.contacts.map(c => {
      const name = c && c.name ? c.name : 'Unknown';
      const nip05 = c && c.nip05 ? `(${escapeHtml(c.nip05)})` : '';
      const pubkey = c && c.pubkey ? c.pubkey : '';
      return `<option value="${escapeHtml(pubkey)}">${escapeHtml(name)} ${nip05}</option>`;
    }).join('');
  },

  createMailRowHTML(msg, myPublicKey) {
    const label = msg.from === myPublicKey
      ? `To: ${store.formatAddress(msg.to)}`
      : store.formatAddress(msg.from);
    const timeStr = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const subject = String(msg.subject || '(No Subject)').trim() || '(No Subject)';
    const body = String(msg.body || '').trim();
    const starLabel = msg.starred ? 'Unstar message' : 'Star message';

    return `
      <div class="mail-row" data-id="${escapeHtml(msg.id)}">
        <button type="button" class="star ${msg.starred ? 'starred' : ''}" data-star="${escapeHtml(msg.id)}" aria-label="${starLabel}" aria-pressed="${Boolean(msg.starred)}" title="${starLabel}">★</button>
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

    const filtered = store.getFilteredEmails(store.currentFolder, query);

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No messages in ${store.currentFolder}.</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(msg => this.createMailRowHTML(msg, myPublicKey)).join('');
  },

  renderContactsList() {
    const container = document.getElementById('contacts-list');
    if (!container) return;

    if (store.contacts.length === 0) {
      container.innerHTML = `<div class="empty-state">No contacts saved yet. Add a friend's public key or NIP-05 address above!</div>`;
      return;
    }

    container.innerHTML = store.contacts.map((c, index) => {
      const name = c && c.name ? c.name : 'Unknown';
      const pubkey = c && c.pubkey ? c.pubkey : '';
      return `
        <div class="mail-row contact-row">
          <div>
            <strong>${escapeHtml(name)}</strong>
            ${c && c.nip05 ? `<span class="nip05-badge">${escapeHtml(c.nip05)}</span>` : ''}
            <div class="contact-key">${escapeHtml(pubkey)}</div>
          </div>
          <div class="contact-actions">
            <button type="button" class="action-btn" data-email-to="${escapeHtml(pubkey)}" title="Compose an email to ${escapeHtml(name)}">✉️ Mail</button>
            <button type="button" class="action-btn" data-delete-contact="${index}" title="Remove ${escapeHtml(name)} from contacts">🗑️ Remove</button>
          </div>
        </div>
      `;
    }).join('');
  },

  openReader(msg, myPublicKey, handlers) {
    const listEl = document.getElementById('mail-list');
    if (listEl) listEl.style.display = 'none';

    const readerEl = document.getElementById('mail-reader');
    if (!readerEl) return;
    readerEl.style.display = 'block';

    const subjectText = String(msg.subject || '(No Subject)');
    const replySubject = subjectText.startsWith('Re:') ? subjectText : `Re: ${subjectText}`;
    const isSaved = store.contacts.some(c => c.pubkey === msg.from);
    const isTrash = msg.folder === 'trash';

    readerEl.innerHTML = `
      <div class="reader-header">
        <div class="reader-subject">${escapeHtml(subjectText)}</div>
        <button type="button" class="action-btn" id="back-btn" title="Return to ${escapeHtml(store.currentFolder)}">← Back to ${escapeHtml(store.currentFolder)}</button>
      </div>
      <div class="reader-meta">
        <div><strong>From:</strong> ${escapeHtml(store.formatAddress(msg.from))}</div>
        <div>${new Date(msg.time).toLocaleString()}</div>
      </div>
      <div class="reader-body">${escapeHtml(String(msg.body || ''))}</div>

      ${isTrash ? `
        <button type="button" class="action-btn" id="restore-btn" title="Move this message back to your inbox">♻️ Restore to Inbox</button>
        <button type="button" class="action-btn danger-btn" id="perm-delete-btn" title="Permanently erase this message">🗑️ Delete Forever</button>
      ` : `
        <button type="button" class="action-btn" id="reply-btn" title="Reply to this sender">↩ Reply</button>
        ${!isSaved && msg.from !== myPublicKey ? `<button type="button" class="action-btn" id="save-sender-btn" title="Save this sender to your contacts">➕ Save Sender</button>` : ''}
        <button type="button" class="action-btn" id="trash-btn" title="Move this message to Trash">🗑️ Move to Trash</button>
      `}
    `;

    const backBtn = document.getElementById('back-btn');
    if (backBtn) backBtn.onclick = handlers.onBack;

    if (isTrash) {
      const restoreBtn = document.getElementById('restore-btn');
      const permDeleteBtn = document.getElementById('perm-delete-btn');
      if (restoreBtn) restoreBtn.onclick = () => handlers.onRestore(msg.id);
      if (permDeleteBtn) permDeleteBtn.onclick = () => handlers.onPermanentDelete(msg.id);
    } else {
      const replyBtn = document.getElementById('reply-btn');
      const trashBtn = document.getElementById('trash-btn');
      if (replyBtn) replyBtn.onclick = () => handlers.onReply(msg.from, replySubject, msg.id);
      if (trashBtn) trashBtn.onclick = () => handlers.onDelete(msg.id);
      const saveBtn = document.getElementById('save-sender-btn');
      if (saveBtn) saveBtn.onclick = () => handlers.onSaveSender(msg.from, msg.id);
    }
  },

  switchView(folder, myPublicKey) {
    const nextFolder = folder || 'inbox';
    store.currentFolder = nextFolder;

    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.folder === nextFolder);
      if (el.dataset.folder === nextFolder) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });

    const navEl = document.getElementById(`nav-${nextFolder}`);
    if (navEl) navEl.classList.add('active');

    const titleEl = document.getElementById('folder-title');
    if (titleEl) titleEl.textContent = nextFolder.charAt(0).toUpperCase() + nextFolder.slice(1);

    const readerEl = document.getElementById('mail-reader');
    if (readerEl) readerEl.style.display = 'none';

    const listEl = document.getElementById('mail-list');
    if (listEl) listEl.style.display = nextFolder === 'contacts' ? 'none' : 'block';

    const contactsView = document.getElementById('contacts-view');
    if (contactsView) contactsView.style.display = nextFolder === 'contacts' ? 'block' : 'none';

    if (nextFolder === 'contacts') this.renderContactsList();
    else this.renderMailList(myPublicKey);
  },

  openCompose(to = '', subject = '', replyId = '') {
    const toInput = document.getElementById('to-input');
    const subInput = document.getElementById('sub-input');
    const replyIdInput = document.getElementById('reply-id-input');
    const composeTitle = document.getElementById('compose-title');
    const composeModal = document.getElementById('compose-modal');

    if (toInput) toInput.value = to;
    if (subInput) subInput.value = subject;
    if (replyIdInput) replyIdInput.value = replyId;
    if (composeTitle) composeTitle.textContent = replyId ? 'Reply Message' : 'New Message';
    if (composeModal) composeModal.style.display = 'flex';
    if (toInput) toInput.focus();
  },

  closeCompose() {
    const composeModal = document.getElementById('compose-modal');
    if (composeModal) composeModal.style.display = 'none';
    const composeButton = document.getElementById('compose-btn');
    if (composeButton) composeButton.focus();
  }
};
