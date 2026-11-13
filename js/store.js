const KEYS = {
  SECRET_KEY: 'libremail_sk',
  MESSAGES: 'libremail_msgs',
  RELAY_URL: 'libremail_relay',
  CONTACTS: 'libremail_contacts',
};

let saveTimer = null;

export const store = {
  emails: JSON.parse(localStorage.getItem(KEYS.MESSAGES) || '[]'),
  contacts: JSON.parse(localStorage.getItem(KEYS.CONTACTS) || '[]'),
  relayUrl: localStorage.getItem(KEYS.RELAY_URL) || 'wss://relay.primal.net',
  currentFolder: 'inbox',
  seenIds: new Set(),

  init() {
    this.emails.forEach(e => this.seenIds.add(e.id));
  },

  getSecretKey() {
    return localStorage.getItem(KEYS.SECRET_KEY);
  },

  setSecretKey(hex) {
    localStorage.setItem(KEYS.SECRET_KEY, hex);
  },

  setRelayUrl(url) {
    this.relayUrl = url;
    localStorage.setItem(KEYS.RELAY_URL, url);
  },

  addEmail(email) {
    if (this.seenIds.has(email.id)) return false;
    this.seenIds.add(email.id);
    this.emails.unshift(email);
    this.scheduleSave();
    return true;
  },

  toggleStar(id) {
    const msg = this.emails.find(m => m.id === id);
    if (!msg) return null;
    msg.starred = !msg.starred;
    this.scheduleSave();
    return msg;
  },

  moveToTrash(id) {
    const msg = this.emails.find(m => m.id === id);
    if (!msg) return;
    msg.folder = 'trash';
    this.scheduleSave();
  },

  addContact(contact) {
    this.contacts.push(contact);
    this.scheduleSave();
  },

  removeContact(index) {
    this.contacts.splice(index, 1);
    this.scheduleSave();
  },

  getFilteredEmails(searchQuery = '') {
    const q = searchQuery.toLowerCase();
    return this.emails.filter(msg => {
      const inFolder = this.currentFolder === 'starred'
        ? (msg.starred && msg.folder !== 'trash')
        : msg.folder === this.currentFolder;

      if (!inFolder) return false;
      if (!q) return true;

      const label = this.formatAddress(msg.from).toLowerCase();
      return (
        msg.subject.toLowerCase().includes(q) ||
        msg.body.toLowerCase().includes(q) ||
        label.includes(q)
      );
    });
  },

  formatAddress(pubkey) {
    // 1. Check if it's saved in your Contacts list
    const found = this.contacts.find(c => c.pubkey === pubkey);
    if (found) return found.nip05 || found.name;

    // 2. Check if a human-readable handle was received or saved for this pubkey
    const storedHandle = localStorage.getItem(`handle_${pubkey}`);
    if (storedHandle) return storedHandle;

    // 3. Fallback: Masked secure view instead of raw exposed hex keys
    return `${pubkey.slice(0, 6)}...@...${pubkey.slice(-4)}`;
  },

  scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      localStorage.setItem(KEYS.MESSAGES, JSON.stringify(this.emails));
      localStorage.setItem(KEYS.CONTACTS, JSON.stringify(this.contacts));
    }, 200);
  },
};
