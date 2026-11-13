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

  addEmail(msg) {
    // Check if email with this ID already exists
    const existingIndex = this.emails.findIndex(m => m.id === msg.id);
    if (existingIndex !== -1) {
      // If it already exists, do not overwrite user folder actions (like Trash)
      return false; 
    }
    
    // New incoming/sent email
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
