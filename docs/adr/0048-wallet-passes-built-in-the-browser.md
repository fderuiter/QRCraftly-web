---
status: accepted
---

# Wallet Passes Built in the Browser

## Context

People want to keep a QR code in their phone's wallet app (#1408). Every major wallet only accepts a pass signed by a registered issuer:

- **Apple Wallet** needs a `.pkpass` file whose `manifest.json` is signed with a Pass Type ID certificate (Apple Developer Program) and Apple's WWDR intermediate. Unsigned passes are rejected.
- **Google Wallet** needs a JWT signed by an issuer's service account. A new issuer stays in demo mode until Google grants publishing access. The Google Wallet app can also make a private pass from a photo of a barcode or QR code.
- **Samsung Wallet** needs an onboarded partner, an approved card template and a signed, encrypted token that expires after 30 seconds.

A signing key cannot ship in the page, because anyone could extract it and sign passes as QRCraftly. A QRCraftly signing service would break [ADR 0012](./0012-cloudflare-workers-static-assets-and-multi-environment.md), [ADR 0022](./0022-no-dynamic-qr-codes-client-side-only.md) and the pledge ("nothing leaves your browser"). Even a service that signs only file hashes, and so never sees the content, would sign anything for anyone under QRCraftly's name.

Wallets also draw their own plain code from the payload, so a design's colours, patterns and logo never reach the wallet.

## Decision

- **Wallet card.** The generator's Download options offer "Add to phone wallet". It makes a 1080 × 1920 PNG on the device with a plain black-on-white code (whole-pixel modules, a four-module quiet zone, no styling or logo) under an optional title and subtitle. The dialog gives honest steps per phone: Google Wallet's photo import on Android, and saving to Photos on iPhone, where Apple Wallet has no photo import. The card passes the same scan check as other exports before it is saved or shared. Because the code is plain, the design's scan-risk gate does not apply to it; empty, refused and dangerous content is still blocked.
- **Signed passes only with the user's own keys.** `.pkpass` files and Google Wallet save links are built and signed in the tab with keys the user loads (#1410, #1411, #1412). Keys stay in memory and never touch storage, so the [storage allowlist](./0001-client-side-storage-allowlist.md) is unchanged. They live in a closed developer section below the card image, so people without developer keys never meet a key upload.
- **No QRCraftly signing service**, neither full-content nor hash-only. Changing this would need a new ADR and a change to the pledge.
- **Generic passes only.** No boarding-pass or event-ticket styles, so a pass made here cannot pose as an airline's or a venue's, and no `webServiceURL` or pass updates, so passes stay static.
- **No wallet card or pass for payment codes**, because a wallet can show a pass on the lock screen. Bulk batches are made one code at a time.

## Consequences

- Everyone can get a code into Google Wallet with nothing sent by QRCraftly. Google stores the pass it makes in the user's Google account, and the dialog says so.
- iPhone users cannot get a one-tap Apple Wallet pass unless they have their own Pass Type ID certificate.
- Phone behaviour (Google's photo import on our card, Safari opening a `.pkpass` from the page, Android pass apps) is checked by hand on real devices (#1413).
