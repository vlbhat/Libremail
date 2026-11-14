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
    }
  },

  getSecretKey() {
    return localStorage.getItem('libremail_sk');
  },

  setSecretKey(hex) {
    localStorage.setItem('libremail_sk', hex);
  },

  saveEmails() {
    localStorage.setItem('libremail_emails', JSON.stringify(this.emails));
  },

  saveContacts() {
    localStorage.setItem('libremail_contacts', JSON.stringify(this.contacts));
  },

  setRelayUrl(url) {
    if (url) {
      this.relayUrl = url;
      localStorage.setItem('libremail_relay', url);
    }
  },

  formatAddress(address = '') {
    if (!address) return '';

    if (address.includes('@')) {
      const [localPart, domain] = address.split('@');
      if (localPart && domain) {
        return localPart.length > 12
          ? `${localPart.slice(0, 8)}...@${domain}`
          : address;
      }
    }

    if (address.length <= 16) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  },

  // Fully robust filtered emails method matching all UI calls
  getFilteredEmails(folder = this.currentFolder, searchQuery = '') {
    let activeFolder = this.currentFolder;
    let query = '';

    if (typeof folder === 'string' && ['inbox', 'sent', 'trash', 'starred', 'contacts'].includes(folder)) {
      activeFolder = folder;
      query = typeof searchQuery === 'string' ? searchQuery : '';
    } else {
      query = typeof folder === 'string' ? folder : '';
    }

    this.currentFolder = activeFolder;
    const normalizedQuery = query.toLowerCase().trim();

    return this.emails.filter(msg => {
      // Default folder assignment for older stored messages if missing
      const msgFolder = msg.folder || 'inbox';
      const matchesFolder = activeFolder === 'starred' ? msg.starred : (msgFolder === activeFolder);
      if (!matchesFolder) return false;

      // Search query filtering rule
      if (!normalizedQuery) return true;
      const matchSubject = (msg.subject || '').toLowerCase().includes(normalizedQuery);
      const matchBody = (msg.body || '').toLowerCase().includes(normalizedQuery);
      const matchSender = (msg.senderHandle || msg.from || '').toLowerCase().includes(normalizedQuery);
      return matchSubject || matchBody || matchSender;
    });
  },

  addEmail(msg) {
    const existingIndex = this.emails.findIndex(m => m.id === msg.id);
    if (existingIndex !== -1) {
      return false; 
    }
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
    this.contacts.push(contact);
    this.saveContacts();
  },

  removeContact(index) {
    this.contacts.splice(index, 1);
    this.saveContacts();
  }
};
