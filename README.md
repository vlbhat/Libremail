# LibreMail

A small browser-based messaging prototype built on Nostr relays. Messages are composed in the browser, wrapped as Nostr gift-wrap events, and published to a relay. The application stores its identity, contacts, and local mailbox in the browser.

> **Prototype warning:** This repository is experimental. Do not use it for sensitive or production communications. The current implementation stores the private key and decrypted mailbox in `localStorage` without encryption, and has not had an independent security or protocol audit.

## Features

- Generate and persist a Nostr keypair in the browser.
- Send encrypted messages to a 64-character hexadecimal public key or a locally saved contact nickname.
- Subscribe to a configured relay for incoming gift-wrap events.
- Keep local inbox, sent mail, contacts, stars, and trash in browser storage.
- Search and manage messages in the browser UI.

## Run locally

The app uses JavaScript modules and a module Web Worker. Serve the repository over HTTP(S); opening `index.html` directly with a `file://` URL may prevent modules or the worker from loading.

For example, with Python installed:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

The app loads `nostr-tools` and `@noble/hashes` from `esm.sh`, so a network connection is required. The default relay is configured in `js/store.js`; you can enter another WebSocket relay in the UI.

## Addressing

- **Public key:** Enter a 64-character hexadecimal Nostr public key.
- **Saved contact:** Enter the contact nickname saved in this browser, or choose its public key from the recipient suggestions.
- **NIP-05:** NIP-05 resolution is not currently enabled in the public-key-only UI. `well-known/nostr.json` is a deployment example containing a placeholder, not a valid identity record; replace it with a real public-key mapping before serving that path from a domain.

A nickname is only a local alias. It is not a globally routable email address, and contacts do not sync between browsers.

## Project layout

```text
.
├── index.html              # App shell
├── css/
│   ├── styles.css          # Layout and visual styling
│   └── controls.css        # Buttons, focus, and control states
├── js/
│   ├── app.js              # UI events and application orchestration
│   ├── crypto.js           # Crypto worker bridge and recipient resolution
│   ├── crypto-worker.js    # Nostr signing, wrapping, and decryption
│   ├── network.js          # Relay publish and inbox subscription
│   ├── store.js            # Browser-persisted messages and contacts
│   └── ui.js               # Rendering and interaction views
└── well-known/
    └── nostr.json          # Example NIP-05 response (placeholder only)
```

## Known limitations and audit notes

These are known risks found during a source review; they are not claims of a complete audit.

1. **Private-key exposure:** `libremail_sk` is stored unencrypted in `localStorage`. Any script executing in the app origin can read it. Do not use a key that protects valuable funds or identity.
2. **Decrypted mailbox exposure:** Messages and contacts are stored in plaintext in `localStorage`. Anyone with access to the browser profile or same-origin script access can read them.
3. **Remote dependency trust:** Crypto code is imported at runtime from a CDN without a lockfile, integrity pin, or local vendoring. A changed or compromised upstream response can affect the app.
4. **No automated test/build pipeline:** There is no package manifest or test suite in the current repository. Validate changes manually and add tests before relying on behavior.
5. **No offline/history guarantee:** The subscription requests only the latest three days of gift-wrap events. Older messages not already stored locally may not be recovered.
6. **Relay validation is basic:** A `ws://` or `wss://` prefix check does not fully validate a URL or guarantee that the relay is reachable or trustworthy.
7. **Protocol interoperability is unverified:** The code uses Nostr kinds 14, 13, and 1059 with NIP-44 encryption, but there is no interoperability test suite confirming compatibility with independent NIP-17 clients. Treat the protocol label as unverified until tested.
8. **Placeholder NIP-05 record:** `well-known/nostr.json` contains `YOUR_64_CHARACTER_PUBLIC_KEY_HERE`; it must not be presented as a working identity document.
9. **Persistence failures are not consistently surfaced:** Browser storage can be unavailable or full; many storage writes currently have no user-facing recovery path.
10. **Accessibility remains partial:** Some navigation items are clickable `div` elements rather than native buttons/links; keyboard and screen-reader behavior should be tested.

## Pre-release checklist

- [ ] Replace or remove the placeholder `well-known/nostr.json` mapping.
- [ ] Review the Nostr/NIP-17 message flow against the current specifications and test against independent clients.
- [ ] Move private-key custody out of unencrypted `localStorage` or clearly require a disposable key.
- [ ] Encrypt local mailbox data or document the local-device exposure prominently in the UI.
- [ ] Pin and audit runtime dependencies; consider vendoring critical crypto dependencies.
- [ ] Add automated tests for recipient resolution, send/decrypt round trips, filtering, trash, and relay errors.
- [ ] Test responsive layout, keyboard navigation, screen readers, and storage-denied/full browser scenarios.
- [ ] Deploy only over HTTPS and configure cache headers intentionally.

## Contributing

Use the `experiments` branch for exploratory changes. Keep changes small, document behavior and limitations, and verify them before merging to `main`. Never commit secret keys or real private identity data.
