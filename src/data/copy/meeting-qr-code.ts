import type { ToolCopy } from './types';
import { NEVER_EXPIRES } from './shared';

/** The how-to steps and FAQs of the meeting-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Create a Meeting QR Code',
    description: 'Make a code that opens your online meeting.',
    steps: [
      { name: 'Paste the meeting link', text: 'Copy the join link from your invitation.' },
      { name: 'Style it', text: 'Pick colours, shapes or a logo if you like.' },
      { name: 'Download it', text: 'Put the code on a slide, door sign or poster.' },
    ],
  },
  faqs: [
    {
      question: 'Which meeting services does this work with?',
      answer:
        'Any service with a join link, including Zoom, Microsoft Teams and Google Meet. The code holds the link itself.',
    },
    {
      question: 'Will the code still work if I reschedule the meeting?',
      answer:
        'Only if the join link stays the same. Recurring meetings and personal rooms usually keep one link; one-off meetings often get a new one, which needs a new code.',
    },
    NEVER_EXPIRES,
  ],
};
