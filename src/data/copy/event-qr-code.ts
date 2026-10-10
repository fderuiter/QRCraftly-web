import type { ToolCopy } from './types';
import { NEVER_EXPIRES } from './shared';

/** The how-to steps and FAQs of the event-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Create an Event QR Code',
    description: 'Make a code that adds your event to a calendar.',
    steps: [
      { name: 'Enter the event', text: 'Fill in the title, start and end time, place and a short description.' },
      { name: 'Pick the calendar format', text: 'iCalendar works with most phones. Google, Outlook, Office 365 and Yahoo make a link instead.' },
      { name: 'Download it', text: 'Save the code and print it on your invitation or poster.' },
    ],
  },
  faqs: [
    {
      question: 'Which calendar apps are supported?',
      answer:
        'The default iCalendar (VEVENT) format adds to Apple Calendar from the iPhone camera. On Android it depends on the camera or scanner app; Google Lens and most scanner apps can add it to Google Calendar. The Google, Outlook, Office 365 and Yahoo options open that service’s add-event page in the browser.',
    },
    {
      question: 'What does the time zone setting do?',
      answer:
        'It fixes the event to that zone, so a guest in another zone sees it at their local time. Floating time shows the same clock time wherever the code is scanned, which suits local events.',
    },
    NEVER_EXPIRES,
  ],
};
