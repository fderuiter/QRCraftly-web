import type { ToolCopy } from './types';

/** The how-to steps and FAQs of the file-transfer page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Send a File with Animated QR Codes',
    description: 'Send a file from one screen to another device’s camera, with no network between them.',
    steps: [
      {
        name: 'Choose a file',
        text: 'Choose or drop the file, or a folder, you want to send.',
      },
      {
        name: 'Open the receiver',
        text: 'On the other device, open the receive page and point its camera at the animated code.',
      },
      {
        name: 'Set the speed',
        text: 'Start slow, and raise the transfer speed if the receiver keeps up.',
      },
    ],
  },
  faqs: [
    {
      question: 'Is the animated QR stream a problem for people sensitive to flashing light?',
      answer:
        'It can be. The sender shows a high-contrast pattern that changes 8 to 24 times a second, which is faster than the three flashes a second that accessibility guidelines treat as a seizure risk. Before the first transfer of a visit you see a notice. If your device asks for reduced motion, the pace starts at Steady, the slowest, and you confirm once more before the stream starts. Pause, or the Escape key, stops the pattern at once, and the animation stays inside the QR code itself: nothing else on the screen flashes. If flashing light affects you, look away or ask someone else to hold the phone.',
    },
  ],
};
