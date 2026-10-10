import type { ToolCopy } from './types';
import { NEVER_EXPIRES } from './shared';

/** The how-to steps and FAQs of the vcard-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Create a vCard QR Code',
    description: 'Make a contact card people can save with one scan.',
    steps: [
      { name: 'Enter your details', text: 'Fill in the fields you want to share. Fewer fields make a smaller code.' },
      { name: 'Style it', text: 'Add your colours or logo if you like.' },
      { name: 'Download it', text: 'Save the code for your business card, badge or slides.' },
    ],
  },
  faqs: [
    {
      question: 'Does a vCard QR code work on iPhone and Android?',
      answer:
        'Yes. The default is vCard 3.0, which the built-in camera apps on iPhone and Android can read and save. You can also pick vCard 4.0, vCard 2.1 or the more compact MECARD format.',
    },
    {
      question: 'Why is my vCard QR code so dense?',
      answer:
        'Every field is stored inside the code, so a long address or many fields make it bigger and harder to scan. Leave out what you do not need, and print business-card codes at least 2 cm (0.8 in) wide.',
    },
    NEVER_EXPIRES,
  ],
};
