const DEFAULT_RELAY = 'wss://relay.primal.net';

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`Could not persist ${key}.`, error);
    return false;
  }
}

export const store = {
  emails: [],
  contacts: [],
  relayUrl: DEFAULT_RELAY,
  currentFolder: 'inbox',

  init() {
    const emails = readJson('libremail_emails', []);
    const contacts = readJson('libremail_contacts', []);
    this.emails = Array.isArray(emails) ? emails.filter(item => item && typeof item === 'object') : [];
    this.contacts = Array.isArray(contacts) ? contacts.filter(item => item && typeof item === 'object') : [];
    try {
      this.relayUrl = localStorage.getItem('libremail_relay') || DEFAULT_RELAY;
    } catch {
      this.relayUrl = DEFAULT_RELAY;
    }
  },

  getSecretKey() {
    try {
      return localStorage.getItem('libremail_sk');
    } catch {
      return null;
    }
  },

  setSecretKey(hex) {
    if (typeof hex !== 'string' || !hex) return false;
    try {
      localStorage.setItem('libremail_sk', hex);
      return true;
    } catch (error) {
      console.error('Could not persist account key.', error);
      return false;
    }
  },

  saveEmails() {
    return save('libremail_emails', this.emails);
  },

  saveContacts() {
    return save('libremail_contacts', this.contacts);
  },

  setRelayUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return false;
    const previous = this.relayUrl;
    this.relayUrl = url.trim();
    try {
      localStorage.setItem('libremail_relay', this.relayUrl);
      return true;
    } catch (error) {
      this.relayUrl = previous;
      console.error('Could not persist relay URL.', error);
      return false;
    }
  },

  formatAddress(address = '') {
    const text = String(address || '').trim();
    if (!text) return '';
    if (text.length <= 16) return text;
    return `${text.slice(0, 6)}...${text.slice(-4)}`;
  },

  getFilteredEmails(folderOrQuery = this.currentFolder, searchQuery = '') {
    let folder = this.currentFolder || 'inbox';
    let query = '';
    const folders = ['inbox', 'sent', 'trash', 'starred'];
    if (typeof folderOrQuery === 'string' && folders.includes(folderOrQuery)) {
      folder = folderOrQuery;
      query = typeof searchQuery === 'string' ? searchQuery : '';
    } else {
      query = typeof folderOrQuery === 'string' ? folderOrQuery : '';
    }

    const normalizedQuery = query.toLowerCase().trim();
    return this.emails.filter(message => {
      const item = message || {};
      const matchesFolder = folder === 'starred'
        ? Boolean(item.starred)
        : (item.folder || 'inbox') === folder;
      if (!matchesFolder) return false;
      if (!normalizedQuery) return true;
      return String(item.subject || '').toLowerCase().includes(normalizedQuery) ||
        String(item.body || '').toLowerCase().includes(normalizedQuery) ||
        String(item.senderHandle || item.from || '').toLowerCase().includes(normalizedQuery);
    });
  },

  addEmail(message) {
    if (!message || typeof message.id !== 'string' || !message.id) return false;
    if (this.emails.some(item => item.id === message.id)) return false;
    this.emails.unshift(message);
    if (!this.saveEmails()) {
      this.emails.shift();
      return false;
    }
    return true;
  },

  moveToTrash(id) {
    const message = this.emails.find(item => item.id === id);
    if (!message || message.folder === 'trash') return false;
    message.previousFolder = message.folder || 'inbox';
    message.folder = 'trash';
    if (!this.saveEmails()) {
      message.folder = message.previousFolder;
      delete message.previousFolder;
      return false;
    }
    return true;
  },

  restoreFromTrash(id) {
    const message = this.emails.find(item => item.id === id);
    if (!message || message.folder !== 'trash') return false;
    const oldFolder = message.folder;
    message.folder = message.previousFolder || 'inbox';
    delete message.previousFolder;
    if (!this.saveEmails()) {
      message.folder = oldFolder;
      return false;
    }
    return true;
  },

  permanentDelete(id) {
    const previous = this.emails;
    this.emails = this.emails.filter(message => message.id !== id);
    if (!this.saveEmails()) {
      this.emails = previous;
      return false;
    }
    return true;
  },

  toggleStar(id) {
    const message = this.emails.find(item => item.id === id);
    if (!message) return null;
    message.starred = !message.starred;
    if (!this.saveEmails()) {
      message.starred = !message.starred;
      return null;
    }
    return message;
  },

  addContact(contact) {
    if (!contact || typeof contact.pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(contact.pubkey)) return false;
    const key = contact.pubkey.toLowerCase();
    if (this.contacts.some(item => String(item.pubkey || '').toLowerCase() === key)) return false;
    const normalized = { ...contact, pubkey: key };
    this.contacts.push(normalized);
    if (!this.saveContacts()) {
      this.contacts.pop();
      return false;
    }
    return true;
  },

  removeContact(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.contacts.length) return false;
    const [removed] = this.contacts.splice(index, 1);
    if (!this.saveContacts()) {
      this.contacts.splice(index, 0, removed);
      return false;
    }
    return true;
  },
};
