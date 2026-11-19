import type { ToolCopy } from './types';

/** The how-to steps and FAQs of the vcard-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Create a vCard QR Code',
    description: 'Make a contact card people can save with one scan.',
    steps: [
      {
        name: 'Import a .vcf file or enter your details',
        text: 'Click Choose a .vcf file (or drop a .vcf card) to fill the form locally on your device, or type the fields you want to share.',
      },
      {
        name: 'Pick the Contact Format and style it',
        text: 'Keep vCard 3.0 for full contact details, or choose MECard for a smaller code, then add colors or a logo.',
      },
      { name: 'Download it', text: 'Save the code for your business card, badge, or slides.' },
    ],
  },
  faqs: [
    {
      question: 'Does a vCard QR code work on iPhone and Android, and what does MECard leave out?',
      answer:
        'Yes. The default vCard 3.0 works in the built-in camera apps on iPhone and Android, and you can also pick vCard 4.0, vCard 2.1, or compact MECard. Choosing MECard makes a smaller code by omitting Profile Photo URL, Social Profiles, and State or Province.',
    },
    {
      question: 'Can I import an existing .vcf file, and why is my vCard QR code dense?',
      answer:
        'Yes—use Choose a .vcf file or drop a .vcf contact file onto the form to fill your details locally without uploading anything. Every field is stored inside the static code, so leave out what you do not need and print business-card codes at least 2 cm (0.8 in) wide.',
    },
    {
      question: 'Will this QR code ever expire or stop working?',
      answer:
        'No. QRCraftly makes static QR codes: the information is stored in the pattern itself, not behind a redirect link on our servers. There is no trial, no subscription and nothing we could switch off, so the code keeps working for as long as the information in it is still correct.',
    },
  ],
};
