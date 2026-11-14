export const store = {
  emails: [],
  contacts: [],
  relayUrl: 'wss://relay.primal.net',
  currentFolder: 'inbox',

  init() {
    try {
      this.emails = JSON.parse(localStorage.getItem('libremail_emails') || '[]');
      this.contacts = JSON.parse(localStorage.getItem('libremail_contacts') || '[]');
      this.relayUrl = localStorage.getItem('libremail_relay') || 'wss://relay.primal.net';
    } catch (e) {
      this.emails = [];
      this.contacts = [];
      this.relayUrl = 'wss://relay.primal.net';
    }
  },

  getSecretKey() {
    return localStorage.getItem('libremail_sk');
  },

  setSecretKey(hex) {
    if (hex) localStorage.setItem('libremail_sk', hex);
  },

  saveEmails() {
    localStorage.setItem('libremail_emails', JSON.stringify(this.emails));
  },

  saveContacts() {
    localStorage.setItem('libremail_contacts', JSON.stringify(this.contacts));
  },

  setRelayUrl(url) {
    const nextUrl = (url || '').trim();
    if (nextUrl) {
      this.relayUrl = nextUrl;
      localStorage.setItem('libremail_relay', nextUrl);
    }
  },

  formatAddress(address = '') {
    if (!address) return '';
    const text = String(address).trim();
    if (!text) return '';

    if (text.includes('@')) {
      const [localPart, domain] = text.split('@');
      if (localPart && domain) {
        return localPart.length > 12
          ? `${localPart.slice(0, 8)}...@${domain}`
          : text;
      }
    }

    if (text.length <= 16) return text;
    return `${text.slice(0, 6)}...${text.slice(-4)}`;
  },

  getFilteredEmails(folder = this.currentFolder, searchQuery = '') {
    let activeFolder = this.currentFolder || 'inbox';
    let query = '';

    if (typeof folder === 'string' && ['inbox', 'sent', 'trash', 'starred', 'contacts'].includes(folder)) {
      activeFolder = folder;
      query = typeof searchQuery === 'string' ? searchQuery : '';
    } else {
      query = typeof folder === 'string' ? folder : String(searchQuery || '');
    }

    this.currentFolder = activeFolder;
    const normalizedQuery = query.toLowerCase().trim();

    return this.emails.filter(msg => {
      const msgFolder = msg.folder || 'inbox';
      const matchesFolder = activeFolder === 'starred' ? msg.starred : (msgFolder === activeFolder);
      if (!matchesFolder) return false;

      if (!normalizedQuery) return true;

      const subject = String(msg.subject || '').toLowerCase();
      const body = String(msg.body || '').toLowerCase();
      const sender = String(msg.senderHandle || msg.from || '').toLowerCase();

      return subject.includes(normalizedQuery)
        || body.includes(normalizedQuery)
        || sender.includes(normalizedQuery);
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
    const exists = this.contacts.some(c => c.pubkey === contact.pubkey);
    if (exists) return false;
    this.contacts.push(contact);
    this.saveContacts();
    return true;
  },

  removeContact(index) {
    if (Number.isInteger(index) && index >= 0 && index < this.contacts.length) {
      this.contacts.splice(index, 1);
      this.saveContacts();
    }
  }
};
