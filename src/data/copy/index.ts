import type { ToolCopy } from './types';
import { NEVER_EXPIRES, staysInBrowser } from './shared';

/** The how-to steps and FAQs of the index page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Create a URL QR Code',
    description: 'Make a code that opens a web page.',
    steps: [
      { name: 'Paste the link', text: 'Paste the address of the page people should open.' },
      { name: 'Style it', text: 'Pick colors, shapes or a logo if you like.' },
      { name: 'Download it', text: 'Save a PNG, JPEG or WebP image for screens, or an SVG, EPS or PDF file for print.' },
    ],
  },
  faqs: [
    {
      question: 'Is QRCraftly really free?',
      answer:
        'Yes. Every generator, style option and download format is free, with no sign-up, no watermark and no limit on how many codes you make. QRCraftly is not ad supported and never will be.',
    },
    NEVER_EXPIRES,
    {
      question: 'What is the difference between a static and a dynamic QR code?',
      answer:
        'A static QR code holds your link or data itself, so no service sits between the code and the page, and there is nothing to switch off. A dynamic QR code holds a short link to a company’s server, which forwards each scan to your page. That lets the company change the destination and count scans, but the code stops working if the service shuts down or you stop paying.',
    },
    {
      question: 'Can I add a logo or change the colors?',
      answer:
        'Yes. You can change the colors, module and corner shapes, add a logo, or tile your own image into the code with Mosaic QR. QRCraftly checks the result with a real scanner as you design, so you can see whether it still scans before you download it.',
    },
    {
      question: 'Which file formats can I download?',
      answer:
        'PNG, JPEG and WebP images for screens, and SVG, EPS and PDF vector files that stay sharp at any print size.',
    },
    staysInBrowser('the link I enter'),
  ],
};
