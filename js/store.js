export const store = {
  emails: [],
  contacts: [],
  relayUrl: 'wss://relay.primal.net',
  currentFolder: 'inbox',

  init() {
    try {
      const savedEmails = JSON.parse(localStorage.getItem('libremail_emails') || '[]');
      const savedContacts = JSON.parse(localStorage.getItem('libremail_contacts') || '[]');
      const savedRelay = localStorage.getItem('libremail_relay');

      this.emails = Array.isArray(savedEmails) ? savedEmails : [];
      this.contacts = Array.isArray(savedContacts) ? savedContacts : [];
      this.relayUrl = savedRelay || 'wss://relay.primal.net';
    } catch (e) {
      this.emails = [];
      this.contacts = [];
      this.relayUrl = 'wss://relay.primal.net';
    }
  },

  getSecretKey() {
    try {
      return localStorage.getItem('libremail_sk');
    } catch (e) {
      return null;
    }
  },

  setSecretKey(hex) {
    if (!hex || typeof hex !== 'string') return;
    try {
      localStorage.setItem('libremail_sk', hex);
    } catch (e) {
      console.warn('Could not save secret key:', e);
    }
  },

  saveEmails() {
    try {
      localStorage.setItem('libremail_emails', JSON.stringify(this.emails));
    } catch (e) {
      console.warn('Could not save emails:', e);
    }
  },

  saveContacts() {
    try {
      localStorage.setItem('libremail_contacts', JSON.stringify(this.contacts));
    } catch (e) {
      console.warn('Could not save contacts:', e);
    }
  },

  setRelayUrl(url) {
    if (!url || typeof url !== 'string') return;
    this.relayUrl = url;
    try {
      localStorage.setItem('libremail_relay', url);
    } catch (e) {
      console.warn('Could not save relay URL:', e);
    }
  },

  formatAddress(pubkey, maxLength = 14) {
    if (!pubkey) return 'Unknown';
    const key = String(pubkey);
    if (key.length <= maxLength) return key;
    return `${key.slice(0, maxLength)}...${key.slice(-6)}`;
  },

  getFilteredEmails(searchQuery = '', folder = this.currentFolder) {
    const activeFolder = folder || this.currentFolder || 'inbox';
    const query = String(searchQuery || '').toLowerCase().trim();

    return this.emails.filter(msg => {
      const item = msg || {};
      const msgFolder = item.folder || 'inbox';
      const matchesFolder = activeFolder === 'starred'
        ? Boolean(item.starred)
        : msgFolder === activeFolder;

      if (!matchesFolder) return false;
      if (!query) return true;

      const subject = String(item.subject || '').toLowerCase();
      const body = String(item.body || '').toLowerCase();
      const sender = String(item.senderHandle || item.from || '').toLowerCase();

      return subject.includes(query) || body.includes(query) || sender.includes(query);
    });
  },

  addEmail(msg) {
    if (!msg || !msg.id) return false;

    const existingIndex = this.emails.findIndex(m => m.id === msg.id);
    if (existingIndex !== -1) return false;

    this.emails.unshift(msg);
    this.saveEmails();
    return true;
  },

  moveToTrash(id) {
    const msg = this.emails.find(m => m.id === id);
    if (msg) {
      msg.folder = 'trash';
      this.saveEmails();
    }
  },

  restoreFromTrash(id) {
    const msg = this.emails.find(m => m.id === id);
    if (msg) {
      msg.folder = 'inbox';
      this.saveEmails();
    }
  },

  permanentDelete(id) {
    this.emails = this.emails.filter(m => m.id !== id);
    this.saveEmails();
  },

  toggleStar(id) {
    const msg = this.emails.find(m => m.id === id);
    if (msg) {
      msg.starred = !msg.starred;
      this.saveEmails();
      return msg;
    }
    return null;
  },

  addContact(contact) {
    if (!contact || !contact.pubkey) return false;
    this.contacts.push(contact);
    this.saveContacts();
    return true;
  },

  removeContact(index) {
    if (index < 0 || index >= this.contacts.length) return false;
    this.contacts.splice(index, 1);
    this.saveContacts();
    return true;
  }
};
