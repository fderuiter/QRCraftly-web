import type { ToolCopy } from './types';

/** The how-to steps and FAQs of the bulk-csv-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Make Bulk QR Codes from a CSV File',
    description: 'Turn each row of a spreadsheet into its own QR code and download them all in one ZIP file.',
    steps: [
      {
        name: 'Choose a CSV file',
        text: 'Select Links, Plain text, or Contact Card, download the matching starter template if needed, and upload your spreadsheet.',
      },
      {
        name: 'Pick the columns',
        text: 'Select single columns for links or text, or choose Contact Card for multi-column mapping. Recognized headers match automatically.',
      },
      {
        name: 'Download the ZIP',
        text: 'Choose PNG, SVG, EPS, or PDF and generate the batch. Empty or unsafe rows are excluded and listed.',
      },
    ],
  },
  faqs: [
    {
      question: 'Is my CSV file uploaded to a server?',
      answer: 'No. Your browser reads the file and builds the ZIP itself. Nothing is sent to a server.',
    },
    {
      question: 'Which formats can I download?',
      answer:
        'Choose PNG images at widths from 500px to 3000px, scalable SVG vectors, EPS print graphics for professional workflows, or PDF documents. Each batch downloads as one ZIP file.',
    },
    {
      question: 'How does Contact Card column mapping work?',
      answer:
        'When you select Contact Card, recognized headers for first name, last name, phone, email, organization, and job title—plus website, street, city, postal code, and country—match automatically, or you can map columns manually. Every contact requires at least a first name, last name, or organization to synthesize a valid card.',
    },
    {
      question: 'How many rows can one batch have?',
      answer: 'Up to 500. Split a longer file into several batches.',
    },
  ],
};
