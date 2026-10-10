import type { ToolCopy } from './types';

/** The how-to steps and FAQs of the security page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to check these claims yourself',
    description: 'You do not have to take our word for any of this.',
    steps: [
      {
        name: 'Watch the network',
        text: 'Open your browser’s developer tools, choose Network, and make a QR code. No request carries what you typed.',
      },
      {
        name: 'Read the code',
        text: 'The source is on GitHub under the AGPL. The build fails if the code gains an unreviewed network request or a browser storage key that is not on the allowlist.',
      },
      {
        name: 'Report a problem',
        text: 'Send security problems privately through GitHub security advisories, so they can be fixed before they are public.',
      },
    ],
  },
  faqs: [
    {
      question: 'Is what I put in a QR code sent to a server?',
      answer: 'No. Your browser makes the code. Cloudflare, which hosts the site, sees each request for a page or file (IP address, browser, page address and time), but what you type, upload or scan is never part of a request.',
    },
    {
      question: 'Can I use QRCraftly with health or personal data?',
      answer: 'QRCraftly never receives what you put in a code, so it holds none of it. That does not make any tool HIPAA or GDPR compliant on its own: those rules cover how your organization handles data, and no software is certified for them. Remember that anyone who scans a code can read it, and that a web calendar link sends the event details to Google, Microsoft or Yahoo when it is opened. The privacy and compliance notes above have the details.',
    },
  ],
};
