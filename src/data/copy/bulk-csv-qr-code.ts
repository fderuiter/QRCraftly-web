import type { ToolCopy } from './types';

/** The how-to steps and FAQs of the bulk-csv-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Make Bulk QR Codes from a CSV or Excel File',
    description: 'Turn each row of a spreadsheet into its own QR code and download them all in one ZIP file.',
    steps: [
      {
        name: 'Choose a CSV, TXT, or Excel file',
        text: 'Choose or drop a .csv, .txt, or .xlsx file (save legacy .xls workbooks as .xlsx or .csv first), or download the sample template.',
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
      question: 'Which spreadsheet files work, and is my file uploaded to a server?',
      answer:
        'Upload .csv, .txt, or Excel .xlsx files with a header row; legacy .xls files are rejected, so save them as .xlsx or .csv first. Your browser parses the file and builds the ZIP locally—nothing is sent to a server.',
    },
    {
      question: 'Which formats can I download?',
      answer:
        'Choose PNG images at widths from 500px to 3000px, scalable SVG vectors, EPS print graphics for professional workflows, or PDF documents. Each batch downloads as one ZIP file.',
    },
    {
      question: 'How does Contact Card column mapping work?',
      answer:
        'When you select Contact Card, recognized headers for first name, last name, phone, email, organization, and job title match automatically, or you can map columns manually. Every contact requires at least a first name, last name, or organization to synthesize a valid card.',
    },
    {
      question: 'How many rows can one batch have?',
      answer: 'Up to 500. Split a longer file into several batches.',
    },
  ],
};
