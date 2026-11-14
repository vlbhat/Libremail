# LibreMail

LibreMail is an experimental, browser-based messaging prototype that uses Nostr relays to send and receive encrypted messages. It provides a familiar inbox-style interface while using Nostr public keys for addressing.

> **Status: experimental.** LibreMail has not undergone an independent security review or a complete interoperability test against other Nostr clients. Do not use it for sensitive communications or with a private key that protects valuable assets.

## What it does

- Creates or loads a Nostr identity in the browser.
- Sends encrypted messages to a recipient's 64-character hexadecimal public key or a locally saved contact nickname.
- Publishes wrapped message events to a configurable Nostr relay.
- Subscribes to a relay for incoming wrapped messages.
- Stores messages, contacts, and settings in the browser for the current site origin.
- Provides inbox, sent, starred, trash, contacts, search, reply, and restore views.

LibreMail is a prototype, not a conventional email service: it does not provide SMTP/IMAP, email accounts, or globally shared address books. A saved nickname is a local alias that only exists in that browser profile.

## Try the hosted app

The project lists this hosted deployment: <https://libremail.vercel.app/>. Availability and behavior depend on that deployment and the configured relay.

## Run locally

The app uses JavaScript modules and a module Web Worker. Serve the repository over HTTP or HTTPS; opening `index.html` directly with a `file://` URL may prevent modules and the worker from loading.

With Python 3 installed, run this from the repository root:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000> in a modern browser.

The app currently loads `nostr-tools` and `@noble/hashes` from `esm.sh`, so an internet connection is required. There is no package-install or build step in this prototype. The default relay is `wss://relay.primal.net`; you can enter a different WebSocket relay in the app.

## Addressing and contacts

Use one of these recipient forms:

1. **Public key:** the recipient's 64-character hexadecimal Nostr public key.
2. **Saved contact nickname:** a nickname and public key saved in this browser. The compose suggestions contain the contact's public key.

NIP-05 lookup is not enabled in the current public-key-only recipient resolver. The `well-known/nostr.json` file is a placeholder/example, not a working address mapping. Do not publish it as a valid identity record without replacing the placeholder with a real public key and serving it from the relevant domain with suitable cross-origin access.

## Project structure

```text
.
├── index.html              # App shell and controls
├── css/
│   ├── styles.css          # Layout and visual styling
│   └── controls.css        # Control, hover, and focus styling
├── js/
│   ├── app.js              # Application startup and UI event handlers
│   ├── crypto.js           # Crypto worker bridge and recipient resolution
│   ├── crypto-worker.js    # Key operations, signing, encryption, and decryption
│   ├── network.js          # Relay publishing and inbox subscription
│   ├── store.js            # Browser-persisted messages, contacts, and settings
│   └── ui.js               # Mail, contact, and reader rendering
└── well-known/
    └── nostr.json          # Placeholder NIP-05 example; not enabled by default
```

## Data and security notes

Please read these limitations before using the app:

- **Private key storage:** the secret key is stored in browser `localStorage` under `libremail_sk` in plaintext. Same-origin JavaScript, browser extensions with access, or someone with access to the browser profile may be able to read it. Do not use a valuable or reused key.
- **Local mailbox storage:** decrypted messages, contacts, and settings are stored in plaintext in `localStorage`. Clearing site data removes this local mailbox; browser storage is not a backup or synchronized account.
- **Relay metadata:** message contents are intended to be encrypted before publication, but relays can observe public event metadata such as event timing and routing tags. A relay may also refuse, delay, or delete events.
- **Runtime dependencies:** cryptographic libraries are loaded from a third-party CDN at runtime. The current repository does not pin or vendor those fetched module contents.
- **Transport and hosting:** use HTTPS in deployment. Do not expose private keys in logs, screenshots, issue reports, or committed files.
- **Protocol compatibility:** the code constructs Nostr kinds 14, 13, and 1059 and uses NIP-44. Compatibility with independent implementations and the current NIP-17 specification has not been established by an automated interoperability suite. Treat protocol compliance as unverified.
- **History retrieval:** the inbox subscription requests only the most recent three days from the selected relay. Messages not in local storage and older than that window may not appear.
- **NIP-05 placeholder:** `well-known/nostr.json` contains a dummy key and is not a usable identity record.

This README is a project guide, not a security guarantee or a complete audit.

## Manual smoke-test checklist

There is currently no automated test suite. Before relying on changes, manually check:

- [ ] App loads when served over HTTP(S), and the crypto worker initializes.
- [ ] A new identity is generated once and remains the same after reload.
- [ ] The public key copy control copies the full key.
- [ ] A valid key can be added as a contact and used as a recipient; invalid keys are rejected.
- [ ] Sending reports relay failures and does not claim success if publication fails.
- [ ] A recipient can decrypt a test message sent to their key.
- [ ] Incoming messages are deduplicated and appear in the inbox.
- [ ] Search, folder switching, starring, reply, trash, restore, and permanent delete work.
- [ ] The app gives a clear error if browser storage is unavailable or full.
- [ ] Keyboard and screen-reader access works for navigation, mail actions, and the compose dialog.

## Contributing

Use the `experiments` branch for exploratory work. Keep changes focused, document any behavior or security trade-offs, and run the smoke-test checklist before proposing a merge to `main`. Never commit secret keys, real user messages, or other private data.

## License

No license file is currently included. Unless a license is added, assume that normal copyright restrictions apply; ask the repository owner before redistributing or reusing the code.
