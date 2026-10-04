import type { ToolCopy } from './types';

/** The how-to steps and FAQs of the qr-code-scanner page. */
export const copy: ToolCopy = {
  howTo: {
      "name": "How to Scan a QR Code Online",
      "description": "Read a QR code with your camera or from an image, without installing an app.",
      "steps": [
        {
          "name": "Start the camera or choose an image",
          "text": "Press Start camera and allow camera access, or switch to Image and choose a photo or screenshot. You can also paste a screenshot or drop an image on the scanner."
        },
        {
          "name": "Point at the code",
          "text": "Hold the QR code inside the square. When it is read, the square locks onto the code and the result opens."
        },
        {
          "name": "Check the result",
          "text": "The scanner shows what the code holds and, for a link, the real web address it opens. Script links are blocked."
        },
        {
          "name": "Copy, open or edit",
          "text": "Copy the content, open the link, share it, or open it in the generator to make your own version."
        }
      ]
    },
  faqs: [
      {
        "question": "Is my image or camera video uploaded?",
        "answer": "No. The camera video and any image you choose, paste or drop are read in your browser on your device. Nothing is sent to a server, and the camera turns off when you leave or a code is found."
      },
      {
        "question": "Do I need to install an app to scan a QR code?",
        "answer": "No. The scanner works in any modern browser on phones and computers. It uses the browser's built-in barcode reader where there is one, and a reader bundled with the page everywhere else."
      },
      {
        "question": "Can I scan a QR code from a screenshot?",
        "answer": "Yes. Choose the screenshot, paste it with Ctrl+V (Cmd+V on a Mac), use Paste image, or drop it on the scanner."
      },
      {
        "question": "How do I know a scanned link is safe?",
        "answer": "Before anything opens, the scanner shows the real address the link goes to, decodes international addresses and warns when letters from different alphabets are mixed to imitate a known site. Links that would run a script are blocked. A link only opens when you press Open link."
      },
      {
        "question": "Why does the browser ask for camera permission?",
        "answer": "The browser asks only after you press Start camera, never when the page loads. If you would rather not allow it, scan from an image instead."
      }
    ],
};
