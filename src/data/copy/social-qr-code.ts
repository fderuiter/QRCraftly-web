import type { ToolCopy } from './types';
import { NEVER_EXPIRES } from './shared';

/** The how-to steps and FAQs of the social-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Create a Social QR Code',
    description: 'Make a code that opens your social profile or WhatsApp chat.',
    steps: [
      {
        name: 'Pick the platform and enter your handle or number',
        text: 'Choose the network in Platform, then enter your Username / Handle, YouTube channel or video link, or WhatsApp Phone Number (international digits only) and optional Pre-filled Message.',
      },
      { name: 'Style it', text: 'Pick colors, shapes, or a logo if you like.' },
      { name: 'Download it', text: 'Put the code on a card, flyer, or slide.' },
    ],
  },
  faqs: [
    {
      question: 'Which social networks and inputs are supported?',
      answer:
        'Instagram, Twitter / X, TikTok, LinkedIn, YouTube (username, channel ID, video, or playlist link), Facebook, WhatsApp, and GitHub. Selecting WhatsApp shows Phone Number (country code and digits only, with no plus sign, spaces, or leading zeros) and an optional Pre-filled Message whose spaces and punctuation are encoded automatically.',
    },
    {
      question: 'What if I change my username or phone number?',
      answer:
        'The static code still points at the handle or WhatsApp number you entered. Make a new code after renaming your account or changing your number.',
    },
    NEVER_EXPIRES,
  ],
};
