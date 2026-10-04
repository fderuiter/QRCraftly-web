import type { ToolCopy } from './types';
import { NEVER_EXPIRES, staysInBrowser } from './shared';

/** The how-to steps and FAQs of the social-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
      "name": "How to Create a Social QR Code",
      "description": "Generate a QR code that links directly to your social profile.",
      "steps": [
        {
          "name": "Select Platform & Handle",
          "text": "Choose the social platform and enter your username or handle."
        },
        {
          "name": "Customize",
          "text": "Design your QR code with unique styles and colors."
        },
        {
          "name": "Download & Share",
          "text": "Save the QR code and place it on your social graphics or packaging."
        }
      ]
    },
  faqs: [
    {
      question: 'Which social networks are supported?',
      answer:
        'Instagram, X (Twitter) and TikTok. Enter your username and the code links straight to your profile, which opens in the app if it is installed.',
    },
    {
      question: 'What if I change my username?',
      answer:
        'The code links to the username it was made with, so it will point to the old profile. Make a new code after renaming your account.',
    },
    staysInBrowser('my profile name'),
    NEVER_EXPIRES,
  ],
};
