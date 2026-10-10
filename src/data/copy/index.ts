import type { ToolCopy } from './types';
import { NEVER_EXPIRES, staysInBrowser } from './shared';

/** The how-to steps and FAQs of the index page. */
export const copy: ToolCopy = {
  howTo: {
      "name": "How to Create a URL QR Code",
      "description": "Convert any website URL into a scannable QR code instantly.",
      "steps": [
        {
          "name": "Enter URL",
          "text": "Paste your website address (URL) into the input field."
        },
        {
          "name": "Customize Design",
          "text": "Adjust colors, add a logo, or change the pattern style."
        },
        {
          "name": "Download QR Code",
          "text": "Save it as a PNG, JPEG or WebP image, or as an SVG, EPS or PDF file for print."
        }
      ]
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
        'A static QR code contains your link or data directly, so it works forever and nobody can track or disable it. A dynamic QR code contains a short link to a company\'s server, which forwards scans to your destination. That lets you change the destination and count scans, but the code stops working if the service shuts down or you stop paying.',
    },
    {
      question: 'Can I add a logo or change the colours?',
      answer:
        'Yes. You can change the colours, module and corner shapes, add a logo, or tile your own image into the code with Mosaic QR. QRCraftly checks the result with a real scanner as you design, so you can see whether it still scans before you download it.',
    },
    {
      question: 'Which file formats can I download?',
      answer:
        'PNG, JPEG and WebP images for screens, and SVG, EPS and PDF vector files that stay sharp at any print size.',
    },
    staysInBrowser('the link I enter'),
  ],
};
