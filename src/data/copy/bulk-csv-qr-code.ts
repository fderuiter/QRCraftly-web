import type { ToolCopy } from './types';

/** The how-to steps and FAQs of the bulk-csv-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Make Bulk QR Codes from a CSV File',
    description: 'Turn each row of a spreadsheet into its own QR code and download them all in one ZIP file.',
    steps: [
      {
        name: 'Choose a CSV file',
        text: 'Choose or drop a .csv or .txt file. Download the sample template if you want a file to start from.',
      },
      {
        name: 'Pick the columns',
        text: 'Choose the column with each code’s content, the column that names each file, and whether the content is links or plain text.',
      },
      {
        name: 'Download the ZIP',
        text: 'Choose PNG or SVG and generate the batch. Empty or unsafe rows are left out, and the page lists them.',
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
      answer: 'PNG at the width you choose, or SVG. Each batch downloads as one ZIP file.',
    },
    {
      question: 'How many rows can one batch have?',
      answer: 'Up to 500. Split a longer file into several batches.',
    },
  ],
};
