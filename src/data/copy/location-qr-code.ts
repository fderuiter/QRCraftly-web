import type { ToolCopy } from './types';
import { NEVER_EXPIRES } from './shared';

/** The how-to steps and FAQs of the location-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Create a Location QR Code',
    description: 'Make a code that opens a place in a maps app.',
    steps: [
      {
        name: 'Add the place or coordinates',
        text: 'Paste a Google Maps link, geo: URI, or DMS coordinates into Google Maps Link or Coordinates, click Use Current Location, or type Latitude and Longitude.',
      },
      { name: 'Style it', text: 'Pick colors and shapes if you like, and wait for “Scans reliably”.' },
      { name: 'Download it', text: 'Save the code for an invitation, flyer, or sign.' },
    ],
  },
  faqs: [
    {
      question: 'How do I find or enter the coordinates of a place?',
      answer:
        'Paste a Google Maps link, a geo: URI, or degrees-minutes-seconds (DMS) coordinates into Google Maps Link or Coordinates and the Latitude and Longitude fields fill automatically. You can also click Use Current Location (which asks your browser for permission once and keeps the coordinates local on your device) or copy decimal coordinates from Google Maps or Apple Maps.',
    },
    NEVER_EXPIRES,
  ],
};
