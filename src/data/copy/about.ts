import type { ToolCopy } from './types';

/** The how-to steps and FAQs of the about page. */
export const copy: ToolCopy = {
  faqs: [
    {
      question: 'Is QRCraftly free?',
      answer: 'Yes. Every feature on the site is free for everyone, with no account and no paid tier.',
    },
    {
      question: 'Does QRCraftly show ads?',
      answer: 'No, and it never will. If keeping the site running ever came down to ads or nothing, the project would shut down instead. The QRCraftly Pledge at /free-forever says so in full.',
    },
    {
      question: 'Does QRCraftly track users?',
      answer: 'No. There are no analytics, tracking cookies, tracking pixels or third-party scripts. Our host, Cloudflare, sees each request for a page or file (IP address, browser, page address and time) so it can serve the site and block attacks, but what you put in a QR code is never part of a request.',
    },
    {
      question: 'Where does what I type go?',
      answer: 'Nowhere. Your browser makes the code on your device, and what you type, upload or scan is not sent to a server. QRCraftly has no diagnostics or crash reporting either.',
    },
    {
      question: 'Is QRCraftly open source?',
      answer: 'Not any more. The code published up to October 2026 was released under the GNU AGPL v3.0; later versions are not public. You do not need the code to check the privacy promises: the security page shows how to check them in your own browser.',
    },
  ],
};
