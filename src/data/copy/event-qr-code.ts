import type { ToolCopy } from './types';
import { NEVER_EXPIRES } from './shared';

/** The how-to steps and FAQs of the event-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Create an Event QR Code',
    description: 'Make a code that adds your event to a calendar.',
    steps: [
      {
        name: 'Pick the calendar format',
        text: 'Choose iCalendar (.ics) in Target Calendar to store the event inside the code, or Google Calendar, Outlook Web, Office 365, or Yahoo Calendar for a web link.',
      },
      {
        name: 'Enter dates, repeat, and place',
        text: 'Fill in Event Title, toggle All-day event if needed, set start and end times in chronological order, and optionally choose Repeat on iCalendar (.ics) or Google Calendar.',
      },
      { name: 'Download it', text: 'Save the code and print it on your invitation or poster.' },
    ],
  },
  faqs: [
    {
      question: 'Which calendar apps and repeat options are supported?',
      answer:
        'The default iCalendar (.ics) format adds to Apple Calendar from the iPhone camera and works on Android through Google Lens or scanner apps, while Google Calendar, Outlook Web, Office 365, and Yahoo Calendar open each service’s add-event page in the browser. Repeat schedules (Daily, Weekly, Monthly, Yearly, with an optional Occurrence Count) are supported on iCalendar (.ics) and Google Calendar; switching Target Calendar to Outlook Web, Office 365, or Yahoo Calendar clears repeat settings.',
    },
    {
      question: 'How do All-day event, Timezone, and start or end times work?',
      answer:
        'Turn on All-day event to pick calendar dates without clock times or a time zone. For timed events, the end date and time cannot be earlier than the start, and Timezone fixes the event to an IANA zone or UTC instead of floating local clock time.',
    },
    NEVER_EXPIRES,
  ],
};
