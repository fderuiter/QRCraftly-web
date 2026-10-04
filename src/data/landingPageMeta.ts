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

/** The metadata of one landing page: what the registry, the share image and the schema need. */
export interface LandingMeta {
  name: string;
  seoTitle: string;
  heading: string;
  /** Meta description, 155 characters at most. */
  description: string;
  imageAlt: string;
  features: string[];
}

/**
 * Metadata of the landing pages (#1035, #1036, #1037). The long copy lives in
 * `landingPageContent.ts`, so pages that only need titles and descriptions (every page, for its
 * `<title>`) do not download it.
 */
export const landingPageMeta: Record<string, LandingMeta> = {
  'mosaic-qr-code': {
    name: 'Image QR Code Generator',
    seoTitle: 'Image QR Code Generator: Your Picture, No AI, Never Uploaded | QRCraftly',
    heading: 'Image QR Code Generator (Mosaic)',
    description:
      'Turn your own picture into a QR code that still scans. No AI and no upload: your image is tiled into the code in your browser. Free, no sign-up, no ads.',
    imageAlt: 'A QR code whose modules are tiled from a sunset picture, made with the QRCraftly image QR code generator',
    features: [
      'Your own picture is tiled into the QR code, not an AI rendering of it',
      'Halftone keeps more image detail, and Tiles is bolder and scans from further away',
      'Every module keeps its dark or light value, so error correction is left for damage',
      'The image is processed on your device and is never uploaded',
      'Download as PNG, JPEG, WebP or SVG',
    ],
  },
  'qr-code-with-logo': {
    name: 'QR Code with Logo Generator',
    seoTitle: 'Free QR Code with Logo Generator: No Sign-up, Never Expires | QRCraftly',
    heading: 'Free QR Code Generator with Logo',
    description:
      'Add your logo to a QR code and keep it scannable. High error correction is set for you and the scan badge warns you if the logo is too big. Free, no ads.',
    imageAlt: 'A QR code with a logo in the centre, made with the QRCraftly QR code with logo generator',
    features: [
      'High error correction (H) is already set, which leaves room for a logo',
      'The Logo section opens for you, below the code',
      'A warning appears when the logo covers too much of the code',
      'Custom colours and shapes, with a contrast check',
      'Download as PNG, JPEG, WebP or SVG',
    ],
  },
  'google-review-qr-code': {
    name: 'Google Review QR Code Generator',
    seoTitle: 'Free Google Review QR Code Generator: No Sign-up | QRCraftly',
    heading: 'Free Google Review QR Code Generator',
    description:
      'Make a QR code that opens your Google review form. Paste your review link, download the code. Free, no sign-up, no ads, and no tracking added to your link.',
    imageAlt: 'A QR code that opens a Google review page, made with the QRCraftly Google review QR code generator',
    features: [
      'Opens your own review link, so customers can leave a review in a tap',
      'Instructions below for finding your review link',
      'A plain link code: no account, no tracking added and no expiry',
      'Colours and a logo to match your business',
      'Download as PNG, JPEG, WebP or SVG',
    ],
  },
  'menu-qr-code': {
    name: 'Menu QR Code Generator',
    seoTitle: 'Free Menu QR Code Generator: Never Expires, No Sign-up | QRCraftly',
    heading: 'Free Menu QR Code Generator',
    description:
      'Make a restaurant menu QR code that never expires. Link it to your menu page or PDF, download it and print it. Free, no sign-up, no ads, no monthly fee.',
    imageAlt: 'A QR code for a restaurant menu, made with the QRCraftly menu QR code generator',
    features: [
      'A static code that never expires and never asks for a subscription',
      'Link it to a menu page or a PDF you host yourself',
      'Update the menu without reprinting, by changing the page behind the link',
      'Custom colours and a logo for your restaurant',
      'Download as PNG, JPEG, WebP or SVG for print',
    ],
  },
  'instagram-qr-code': {
    name: 'Instagram QR Code Generator',
    seoTitle: 'Free Instagram QR Code Generator: Link to Your Profile | QRCraftly',
    heading: 'Free Instagram QR Code Generator',
    description:
      'Make a QR code that opens your Instagram profile. Type your username, style the code and download it. Free, no sign-up, no ads, and it never expires.',
    imageAlt: 'A QR code that opens an Instagram profile, made with the QRCraftly Instagram QR code generator',
    features: [
      'Type your username and the profile link is built for you',
      'The link opens in the Instagram app when it is installed',
      'A static code that never expires',
      'Colours and a logo to match your brand',
      'Download as PNG, JPEG, WebP or SVG',
    ],
  },
  'whatsapp-qr-code': {
    name: 'WhatsApp QR Code Generator',
    seoTitle: 'Free WhatsApp QR Code Generator: Chat Link, No Sign-up | QRCraftly',
    heading: 'Free WhatsApp QR Code Generator',
    description:
      'Make a QR code that opens a WhatsApp chat with you. Add your number to a wa.me link and download the code. Free, no sign-up, no ads, never expires.',
    imageAlt: 'A QR code that opens a WhatsApp chat, made with the QRCraftly WhatsApp QR code generator',
    features: [
      'Builds on a standard wa.me chat link',
      'Optionally add a ready-typed first message',
      'A static code that never expires',
      'Colours and a logo to match your business',
      'Download as PNG, JPEG, WebP or SVG',
    ],
  },
  'pdf-qr-code': {
    name: 'PDF QR Code Generator',
    seoTitle: 'Free PDF QR Code Generator: Link to a Hosted PDF | QRCraftly',
    heading: 'Free PDF QR Code Generator',
    description:
      'Make a QR code that opens a PDF at its web link. We do not host files: put the PDF online, paste the link and download the code. Free, no sign-up, no ads.',
    imageAlt: 'A QR code that opens a PDF document link, made with the QRCraftly PDF QR code generator',
    features: [
      'Links to a PDF you already host, such as a brochure, menu, manual or flyer',
      'Honest about hosting: QRCraftly never stores your file',
      'A static code that never expires',
      'Colours and a logo to match your document',
      'Download as PNG, JPEG, WebP or SVG',
    ],
  },
  'qr-code-checker': {
    name: 'QR Code Checker',
    seoTitle: 'QR Code Checker: Test If Your QR Code Scans, Nothing Uploaded | QRCraftly',
    heading: 'QR Code Checker',
    description:
      'Check any QR code from an image: see what it holds and whether it scans, even after print blur. Nothing is uploaded and there is no sign-up.',
    imageAlt: 'The QRCraftly QR code checker showing what a QR code holds and whether it scans',
    features: [
      'Upload, drop or paste a picture of any QR code, even one made elsewhere',
      'Shows what the code holds, with the real address of a link',
      'Screen scan, link safety and print simulation checks',
      'Plain-language advice when a code is fragile',
      'Runs entirely in your browser, with nothing uploaded',
    ],
  },
};
