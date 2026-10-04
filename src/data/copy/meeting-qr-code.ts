import type { ToolCopy } from './types';
import { NEVER_EXPIRES, staysInBrowser } from './shared';

/** The how-to steps and FAQs of the meeting-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
      "name": "How to Create a Meeting QR Code",
      "description": "Generate a QR code that directs users to a virtual meeting.",
      "steps": [
        {
          "name": "Paste Meeting Link",
          "text": "Copy and paste your virtual meeting invite URL."
        },
        {
          "name": "Customize",
          "text": "Choose patterns, colors, and add a center logo."
        },
        {
          "name": "Download",
          "text": "Save and distribute the QR code to your meeting attendees."
        }
      ]
    },
  faqs: [
    {
      question: 'Which meeting services does this work with?',
      answer:
        'Any service with a join link, including Zoom, Microsoft Teams and Google Meet. The QR code contains the join link itself, so scanning it opens the meeting in the app or browser.',
    },
    {
      question: 'Will the code still work if I reschedule the meeting?',
      answer:
        'Only if the join link stays the same. Recurring meetings and personal meeting rooms usually keep one link; one-off meetings often get a new link, which needs a new QR code.',
    },
    staysInBrowser('my meeting link'),
    NEVER_EXPIRES,
  ],
};
