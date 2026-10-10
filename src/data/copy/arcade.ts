import type { ToolCopy } from './types';

/** The how-to steps and FAQs of the arcade page. */
export const copy: ToolCopy = {
  howTo: {
      "name": "How to Stress-Test a QR Code in the QR Arcade",
      "description": "Damage a QR code on purpose and see how much it can lose before scanners fail.",
      "steps": [
        {
          "name": "Bring your design",
          "text": "Select Stress Test in Arcade under the generator preview, or open the Arcade and enter any text or URL."
        },
        {
          "name": "Choose a mode",
          "text": "Use Arcade Blaster to shoot the code apart, or Damage Simulator to strike exact modules and launch barrages."
        },
        {
          "name": "Watch both verdicts",
          "text": "The health bar tracks the Reed-Solomon budget and finder patterns; the live scanner shows whether a real decoder can still read the code."
        },
        {
          "name": "Rebuild and compare",
          "text": "Rebuild or heal the code, change the error correction level, and try again to compare how much damage each level survives."
        }
      ]
    },
  faqs: [
      {
        "question": "Why does the code fail when a corner square is hit, even with budget left?",
        "answer": "Scanners find the grid by its three 7×7 corner squares. Once more than 20% of one is destroyed, the Arcade counts the code as unreadable, however much error correction is left."
      },
      {
        "question": "What is the difference between the health bar and the live scanner?",
        "answer": "The health bar works out from the error correction maths how much more damage the code can take. The live scanner tries to read the damaged picture, so it shows whether a real reader still can."
      },
      {
        "question": "Is my QR content uploaded?",
        "answer": "No. The design is passed from the generator in memory only and every scan runs on your device. Nothing is stored, placed in the URL or sent over the network."
      },
      {
        "question": "What happened to Destroy the QR and the Damage Simulator game?",
        "answer": "Both games are now modes of the QR Arcade. The old /destroy-the-qr and /game addresses redirect to Arcade Blaster and Damage Simulator."
      }
    ],
};
