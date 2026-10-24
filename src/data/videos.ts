/*
    QRCraftly
    Copyright (C) 2026 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

/**
 * The short videos on `/videos`. Each file is a screen recording of the live site, served from
 * `public/media/` on our own domain: no video host and no embed, so playing one sends nothing to
 * another site. Keep each file small (about 1 to 2 MB): git keeps every version forever, and
 * `videos.test.ts` fails when a file passes MAX_VIDEO_FILE_MB or is not listed here.
 */
/** Largest video file allowed in public/media/, in MB. Past about 50 MB in total, move them to R2. */
export const MAX_VIDEO_FILE_MB = 5;

export interface SiteVideo {
  /** Stable id, also the file name under /media/. */
  id: string;
  title: string;
  /** One or two sentences: what the video shows. */
  description: string;
  /** Pixel size of the file, for the player's aspect ratio. */
  width: number;
  height: number;
  /** Length in whole seconds. */
  seconds: number;
  /** ISO date the video was published on the site. */
  uploadDate: string;
  /** The page the video demonstrates. */
  related: { label: string; href: string };
  /** The words shown on screen, in order, so the video can be followed without watching it. */
  transcript: readonly string[];
}

export const SITE_VIDEOS: readonly SiteVideo[] = [
  {
    id: 'qrcraftly-trailer',
    title: 'QRCraftly in 49 seconds',
    description: 'What QRCraftly does: style a code, try to break it in the QR Arcade, check a code before you trust it, and make one with the internet off.',
    width: 1280,
    height: 720,
    seconds: 49,
    uploadDate: '2026-10-24',
    related: { label: 'Make a QR code', href: '/' },
    transcript: [
      'You’ve made a QR code before. Maybe it wanted you to sign up. Maybe it had a free trial. Maybe it stopped working.',
      'Meet QRCraftly: free QR codes, made in your browser.',
      'Make it yours. Then try to break it. Check a code before you trust it. Works offline. Put a picture in it.',
      'No ads. No tracking. No sign-up. Static codes that never expire.',
      '“If keeping QRCraftly running ever comes down to ads or nothing, it will be nothing.” Fred de Ruiter, who built QRCraftly.',
      'You just haven’t heard of it yet. qrcraftly.com',
    ],
  },
  {
    id: 'will-it-scan-arcade',
    title: 'Can a QR code survive this?',
    description: 'A code is blasted with plasma, lasers and rockets in the QR Arcade while a live scanner reports whether it still reads.',
    width: 720,
    height: 1280,
    seconds: 16,
    uploadDate: '2026-10-24',
    related: { label: 'Open the QR Arcade', href: '/arcade' },
    transcript: [
      'Can a QR code survive this?',
      'Lasers? Still scans.',
      'Rockets? Still scans.',
      'How much more can it take?',
      'Gone. The live scanner gives up.',
    ],
  },
  {
    id: 'styled-qr-codes',
    title: 'Eight styles, one QR code',
    description: 'One code moves through the pattern styles and color presets, and the live check confirms it scans before download.',
    width: 720,
    height: 1280,
    seconds: 17,
    uploadDate: '2026-10-24',
    related: { label: 'Style a QR code', href: '/' },
    transcript: [
      'Your QR code doesn’t have to look like this.',
      '8 styles. Any colors. Free.',
      'Modern Soft, Swiss Dot, Fluid Ink, Cyber Circuit, The Hive, Starburst, Grunge.',
      'And it checks the code scans before you download.',
    ],
  },
  {
    id: 'check-before-you-scan',
    title: 'Check a QR code before you scan it',
    description: 'A photo of a fake parking sticker goes into the QR Code Checker, which shows the real address before anything opens.',
    width: 720,
    height: 1280,
    seconds: 13,
    uploadDate: '2026-10-24',
    related: { label: 'Check a QR code', href: '/qr-code-checker' },
    transcript: [
      'This QR code wants your card number. (An example made for this video. The address is fake.)',
      'Drop a photo of it into a QR checker first.',
      'Says PayPal. Isn’t PayPal. Checked on your device. The picture is never uploaded.',
    ],
  },
  {
    id: 'offline-wifi-qr-code',
    title: 'A Wi-Fi QR code with the internet off',
    description: 'With the browser offline, a guest Wi-Fi code is typed in and drawn anyway, because everything runs on the device.',
    width: 720,
    height: 1280,
    seconds: 11,
    uploadDate: '2026-10-24',
    related: { label: 'Make a Wi-Fi QR code', href: '/wifi-qr-code' },
    transcript: [
      'My internet is off.',
      'Still making a Wi-Fi QR code.',
      'It all runs in your browser. What you type never goes to a server.',
    ],
  },
  {
    id: 'picture-inside-a-qr-code',
    title: 'A picture inside a QR code',
    description: 'A picture is tiled into a QR code in the browser, with no AI and no upload, and the live check flags how sturdy the design is.',
    width: 720,
    height: 1280,
    seconds: 11,
    uploadDate: '2026-10-24',
    related: { label: 'Make an image QR code', href: '/mosaic-qr-code' },
    transcript: [
      'Put a picture inside a QR code.',
      'Any picture. No AI. No upload.',
      'Still a QR code. And it tells you if a design is fragile before you print.',
    ],
  },
  {
    id: 'no-free-trial',
    title: 'A QR code with no free trial',
    description: 'Static QR codes made in the browser: what you encode is stored in the code itself, so there is no trial to run out.',
    width: 720,
    height: 720,
    seconds: 15,
    uploadDate: '2026-10-24',
    related: { label: 'Make a QR code', href: '/' },
    transcript: [
      'Your QR code shouldn’t have a free trial.',
      'Free. Static. Never expires.',
      'No sign-up. No ads. No tracking. Made in your browser. What you type stays on your device.',
      'Free QR codes that never expire.',
    ],
  },
  {
    id: 'print-preview',
    title: 'See it before you print',
    description: 'One code is previewed on a poster, a card, a table tent, a sticker and a screen, with how far away a phone can scan it.',
    width: 720,
    height: 1280,
    seconds: 12,
    uploadDate: '2026-10-24',
    related: { label: 'Make a QR code', href: '/' },
    transcript: [
      'Before you print 500 flyers…',
      'see it on a poster.',
      'A card. A table tent.',
      'A sticker. A screen.',
      'Then print it with confidence. It shows how far away a phone can scan it.',
    ],
  },
  {
    id: 'real-world-test',
    title: 'Will your QR code survive real life?',
    description: 'The real-world test runs a styled code through distance, glare, dim light and tilt. This one fails in dim light.',
    width: 720,
    height: 1280,
    seconds: 11,
    uploadDate: '2026-10-24',
    related: { label: 'Make a QR code', href: '/' },
    transcript: [
      'Will your QR code survive real life?',
      'Distance. Glare. Dim light. Tilt.',
      'This one fails in dim light. Better to find out before you print 500.',
    ],
  },
  {
    id: 'qr-code-size',
    title: 'How big should a QR code be?',
    description: 'The size calculator turns a scanning distance into a printed size: about 43.6 cm wide at 5 m for this link.',
    width: 720,
    height: 1280,
    seconds: 12,
    uploadDate: '2026-10-24',
    related: { label: 'Open the size calculator', href: '/qr-code-size-calculator' },
    transcript: [
      'How big should a QR code be?',
      'Depends how far away people stand.',
      '5 m away? 43.6 cm wide for this one. In centimeters and inches.',
    ],
  },
  {
    id: 'bulk-qr-codes',
    title: '500 QR codes from one spreadsheet',
    description: 'A 40-row spreadsheet becomes one QR code per row, downloaded together as a ZIP, all in the browser. Shown sped up.',
    width: 720,
    height: 1280,
    seconds: 14,
    uploadDate: '2026-10-24',
    related: { label: 'Make bulk QR codes', href: '/bulk-csv-qr-code' },
    transcript: [
      'Need a QR code for every table?',
      'Drop in a spreadsheet. CSV, TXT or Excel.',
      'One code per row. Up to 500. (Sped up.)',
      'All in one ZIP. Free.',
    ],
  },
  {
    id: 'file-transfer-beta',
    title: 'A file sent as QR codes (beta)',
    description: 'A small file is shown as a stream of QR codes for another phone’s camera to read, with no network between the two devices. Shown slowed down.',
    width: 720,
    height: 1280,
    seconds: 12,
    uploadDate: '2026-10-24',
    related: { label: 'Try file transfer (beta)', href: '/file-transfer' },
    transcript: [
      'This is a file.',
      'Point another phone’s camera at it…',
      '…and the file comes across in QR codes. No Wi-Fi between them. No upload. (Slowed down.)',
      'Send a file as QR codes. Free. Beta.',
    ],
  },
  {
    id: 'call-to-action-frames',
    title: 'Words under the QR code',
    description: 'A Google review code gets a call to action: “Scan to leave a review” in a pill, a speech bubble and a banner.',
    width: 720,
    height: 1280,
    seconds: 12,
    uploadDate: '2026-10-24',
    related: { label: 'Make a review QR code', href: '/google-review-qr-code' },
    transcript: [
      'A QR code with no words…',
      '…gets ignored. Add one line.',
      '“Scan to leave a review.”',
      'Pill, bubble or banner. Free.',
    ],
  },
  {
    id: 'twelve-qr-code-types',
    title: 'What a QR code can hold',
    description: 'A tour of the 12 kinds of QR code: Wi-Fi, contact, event, text message, email, map pin, meeting, payment, phone, socials, plain text and link.',
    width: 720,
    height: 1280,
    seconds: 15,
    uploadDate: '2026-10-24',
    related: { label: 'Make a QR code', href: '/' },
    transcript: [
      'A QR code isn’t just a link.',
      'Join Wi-Fi. Save a contact. Add an event. Send a text. Start an email. Drop a map pin.',
      'Join a meeting. Get paid. Call a number. Open your socials. Show plain text. Open a link.',
      '12 kinds of QR code. All free. No sign-up.',
    ],
  },
  {
    id: 'scan-a-screenshot',
    title: 'Scan a QR code from a screenshot',
    description: 'A screenshot of a Wi-Fi QR code from a chat goes into the scanner, which reads it on the device and keeps the password hidden until you tap.',
    width: 720,
    height: 1280,
    seconds: 12,
    uploadDate: '2026-10-24',
    related: { label: 'Open the QR scanner', href: '/qr-code-scanner' },
    transcript: [
      'POV: they texted you a QR code.',
      'You can’t scan your own screen.',
      'Drop the screenshot in.',
      'Party Wi-Fi. Password hidden till you tap. Read on your device. Nothing uploaded.',
    ],
  },
  {
    id: 'svg-stays-sharp',
    title: 'PNG vs SVG, zoomed in 40×',
    description: 'The same code downloaded as PNG and as SVG, zoomed in 40 times: the PNG goes soft and the SVG stays sharp.',
    width: 720,
    height: 1280,
    seconds: 10,
    uploadDate: '2026-10-24',
    related: { label: 'Download an SVG QR code', href: '/svg-qr-code' },
    transcript: [
      'Printing a giant banner?',
      'Zoom in 40×.',
      'PNG goes soft. SVG stays sharp. Same code, downloaded both ways.',
      'Download SVG, EPS or PDF for print. Free.',
    ],
  },
  {
    id: 'surprise-me',
    title: 'Surprise me',
    description: 'The Style Gallery’s Surprise me button picks look after look, and the scannability badge flags when one is fragile.',
    width: 720,
    height: 1280,
    seconds: 13,
    uploadDate: '2026-10-24',
    related: { label: 'Style a QR code', href: '/' },
    transcript: [
      'Can’t pick a style?',
      'Hit Surprise me.',
      'Again. Again.',
      'It even says when a style is fragile. The badge at the top checks every one.',
    ],
  },
  {
    id: 'error-correction',
    title: 'Why a scratched QR code still scans',
    description: 'The four error correction levels, from Low (about 7% can be lost) to High (about 30%).',
    width: 720,
    height: 1280,
    seconds: 10,
    uploadDate: '2026-10-24',
    related: { label: 'Make a QR code', href: '/' },
    transcript: [
      'Why does a scratched QR code still scan?',
      'Error correction.',
      'Low: about 7% can be lost.',
      'Medium: about 15%.',
      'Quartile: about 25%.',
      'High: about 30%. More protection, denser code.',
    ],
  },
];

/**
 * The public address of a video file or its poster.
 * @param video - The video.
 * @param kind - The movie, its still poster or its caption file.
 * @returns A root-relative path under /media/.
 */
export function videoSrc(video: SiteVideo, kind: 'mp4' | 'jpg' | 'vtt'): string {
  return `/media/${video.id}.${kind}`;
}
