import type { ToolCopy } from './types';
import { NEVER_EXPIRES } from './shared';

/** The how-to steps and FAQs of the location-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Create a Location QR Code',
    description: 'Make a code that opens a place in a maps app.',
    steps: [
      { name: 'Enter the coordinates', text: 'Type the latitude and longitude of the spot.' },
      { name: 'Style it', text: 'Pick colours and shapes if you like.' },
      { name: 'Download it', text: 'Save the code for an invitation or sign.' },
    ],
  },
  faqs: [
    {
      question: 'How do I find the coordinates of a place?',
      answer:
        'In Google Maps, press and hold (or right-click) the spot and the coordinates appear. In Apple Maps, drop a pin and swipe up to see them. Copy them into the latitude and longitude fields.',
    },
    NEVER_EXPIRES,
  ],
};
