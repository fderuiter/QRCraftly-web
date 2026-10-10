import type { ToolCopy } from './types';
import { NEVER_EXPIRES } from './shared';

/** The how-to steps and FAQs of the social-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Create a Social QR Code',
    description: 'Make a code that opens your social profile.',
    steps: [
      { name: 'Pick the platform and type your username', text: 'Choose the network, then enter your username.' },
      { name: 'Style it', text: 'Pick colours, shapes or a logo if you like.' },
      { name: 'Download it', text: 'Put the code on a card, flyer or slide.' },
    ],
  },
  faqs: [
    {
      question: 'Which social networks are supported?',
      answer:
        'Instagram, X, TikTok, LinkedIn, YouTube, Facebook, WhatsApp and GitHub. The code opens your profile in the app if it is installed, or in the browser.',
    },
    {
      question: 'What if I change my username?',
      answer:
        'The code still points at the old username. Make a new code after renaming your account.',
    },
    NEVER_EXPIRES,
  ],
};
