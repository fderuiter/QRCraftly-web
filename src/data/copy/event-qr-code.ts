import type { ToolCopy } from './types';
import { NEVER_EXPIRES, staysInBrowser } from './shared';

/** The how-to steps and FAQs of the event-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
      "name": "How to Create an Event QR Code",
      "description": "Generate a QR code that prompts users to add an event to their calendar.",
      "steps": [
        {
          "name": "Enter Event Details",
          "text": "Fill in the event title, start and end date, location, and description."
        },
        {
          "name": "Customize",
          "text": "Choose a style and color for your QR code."
        },
        {
          "name": "Download",
          "text": "Download the image and share or print it."
        }
      ]
    },
  faqs: [
    {
      question: 'What happens when someone scans an event QR code?',
      answer:
        'Their phone offers to add the event to their calendar, with the title, start and end time, location and description filled in.',
    },
    {
      question: 'Which calendar apps are supported?',
      answer:
        'The code contains a standard iCalendar (VEVENT) entry. iPhone adds it to Apple Calendar directly. On Android, support depends on the camera or scanner app; Google Lens and most scanner apps can add it to Google Calendar.',
    },
    staysInBrowser('my event details'),
    NEVER_EXPIRES,
  ],
};
