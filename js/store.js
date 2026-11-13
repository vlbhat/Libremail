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

  // Added missing getFilteredEmails method required by ui.js
  getFilteredEmails(folder, searchQuery = '') {
    this.currentFolder = folder;
    const query = searchQuery.toLowerCase().trim();

    return this.emails.filter(msg => {
      // Folder matching rule
      const matchesFolder = folder === 'starred' ? msg.starred : (msg.folder === folder);
      if (!matchesFolder) return false;

      // Search query filtering rule
      if (!query) return true;
      const matchSubject = (msg.subject || '').toLowerCase().includes(query);
      const matchBody = (msg.body || '').toLowerCase().includes(query);
      const matchSender = (msg.senderHandle || msg.from || '').toLowerCase().includes(query);
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
