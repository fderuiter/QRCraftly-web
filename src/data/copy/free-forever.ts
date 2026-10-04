import type { ToolCopy } from './types';

/** The how-to steps and FAQs of the free-forever page. */
export const copy: ToolCopy = {
  faqs: [
      {
        "question": "Is there a QR code generator with no ads?",
        "answer": "Yes. QRCraftly is not ad supported and never will be. There are no banner ads, sponsored placements, affiliate links or paid upgrades."
      },
      {
        "question": "Does QRCraftly track me?",
        "answer": "No. There are no analytics, tracking cookies, tracking pixels or third-party scripts, and the site's Content Security Policy blocks connections to any other server. Cloudflare, which hosts the site, sees ordinary request information such as your IP address to deliver pages, but never the content of your QR codes."
      },
      {
        "question": "Is my QR code data sent to a server?",
        "answer": "No. QR codes are generated entirely in your browser. What you type, upload or scan never leaves your device."
      },
      {
        "question": "Do QRCraftly QR codes expire?",
        "answer": "No. QRCraftly makes static QR codes: the content is stored in the code itself, so there is no account, subscription or server that could switch it off. A code you make today keeps working as long as the thing it points to exists."
      },
      {
        "question": "What happens if QRCraftly can't pay for itself?",
        "answer": "It will be shut down before it ever shows an ad. The only way the project would change hands is an outright purchase of the whole project."
      }
    ],
};
