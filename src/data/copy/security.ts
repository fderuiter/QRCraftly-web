import type { ToolCopy } from './types';

/** The how-to steps and FAQs of the security page. */
export const copy: ToolCopy = {
  howTo: {
      "name": "How to Verify Security and Privacy Settings",
      "description": "Review security transparency guidelines and report vulnerabilities.",
      "steps": [
        {
          "name": "Review Privacy Architecture",
          "text": "Inspect our zero-transit privacy framework and local browser execution model."
        },
        {
          "name": "Audit Open Source Code",
          "text": "Verify security implementations directly in our open-source codebase."
        },
        {
          "name": "Submit Vulnerability Reports",
          "text": "Report security findings through our secure disclosure portal."
        }
      ]
    },
  faqs: [
      {
        "question": "Does QRCraftly store my QR code data on a server?",
        "answer": "No. Standard static QR codes are generated entirely client-side inside your browser without transmitting sensitive payload data to external servers."
      },
      {
        "question": "Is QRCraftly compliant with HIPAA and GDPR?",
        "answer": "Yes. Because data processing occurs locally on the client device without centralized data retention, QRCraftly aligns with strict GDPR and HIPAA privacy standards."
      }
    ],
};
