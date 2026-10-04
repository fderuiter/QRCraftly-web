import type { ToolCopy } from './types';
import { NEVER_EXPIRES, staysInBrowser } from './shared';

/** The how-to steps and FAQs of the location-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
      "name": "How to Create a Location QR Code",
      "description": "Generate a QR code that opens a location in maps.",
      "steps": [
        {
          "name": "Enter Coordinates",
          "text": "Input the latitude and longitude of the location."
        },
        {
          "name": "Customize",
          "text": "Adjust colors, patterns, and style to fit your design."
        },
        {
          "name": "Download",
          "text": "Save the QR code and use it on invites or signage."
        }
      ]
    },
  faqs: [
    {
      question: 'What happens when someone scans a location QR code?',
      answer:
        'Their phone opens the location in a maps app such as Google Maps or Apple Maps, ready for directions.',
    },
    {
      question: 'How do I find the coordinates of a place?',
      answer:
        'In Google Maps, press and hold (or right-click) the spot, and the coordinates appear at the top. In Apple Maps, drop a pin and swipe up to see them. Copy them into the latitude and longitude fields.',
    },
    staysInBrowser('the location I enter'),
    NEVER_EXPIRES,
  ],
};
