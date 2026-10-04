import type { ToolCopy } from './types';

/** The how-to steps and FAQs of the file-transfer page. */
export const copy: ToolCopy = {
  howTo: {
      "name": "How to Transfer Files via Animated QR Codes",
      "description": "Share files sequentially through QR code animations.",
      "steps": [
        {
          "name": "Select File",
          "text": "Select any file or use the high-load simulation button."
        },
        {
          "name": "Set Pacing",
          "text": "Adjust the speed and chunk size to fit your receiving camera."
        },
        {
          "name": "Scan Animation",
          "text": "Scan the animated QR code stream sequentially with the receiver device."
        }
      ]
    },
  faqs: [
    {
      question: 'Is the animated QR stream a problem for people sensitive to flashing light?',
      answer:
        'It can be. The sender shows a high-contrast pattern that changes 8 to 24 times a second, which is faster than the three flashes a second that accessibility guidelines treat as a seizure risk. Before the first transfer of a visit you see a notice. If your device asks for reduced motion, the pace starts at Steady, the slowest, and you confirm once more before the stream starts. Pause, or the Escape key, stops the pattern at once, and the animation stays inside the QR code itself: nothing else on the screen flashes. If flashing light affects you, look away or ask someone else to hold the phone.',
    },
  ],
};
