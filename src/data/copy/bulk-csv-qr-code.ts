import type { ToolCopy } from './types';

/** The how-to steps and FAQs of the bulk-csv-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
      "name": "How to Generate Bulk QR Codes from a CSV File",
      "description": "Upload a CSV file, map payload and filename columns, and download generated QR codes as a ZIP package.",
      "steps": [
        {
          "name": "Upload File",
          "text": "Choose or drop your .csv or .txt file into the bulk CSV upload area."
        },
        {
          "name": "Map Columns",
          "text": "Select which CSV column contains the QR payload and which column specifies output filenames."
        },
        {
          "name": "Export ZIP Archive",
          "text": "Select PNG or SVG export format and click Generate ZIP Package to download your batch."
        }
      ]
    },
  faqs: [
      {
        "question": "Is my CSV file uploaded to a server?",
        "answer": "No. Your CSV file is parsed and processed entirely inside your browser using client-side JavaScript. What you upload never leaves your device."
      },
      {
        "question": "What formats are supported for batch QR code export?",
        "answer": "You can export your batch QR codes in PNG raster or SVG vector format packaged inside a single downloadable ZIP archive."
      }
    ],
};
