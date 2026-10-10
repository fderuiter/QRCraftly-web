/*
    QRCraftly
    Copyright (C) 2026 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import type { TypeGuide } from './typeGuides';

/** The long copy of one landing page: a preset generator (#1035, #1037) or the checker (#1036). */
export interface LandingCopy {
  howTo: { name: string; description: string; steps: { name: string; text: string }[] };
  faqs: { question: string; answer: string }[];
  /** Long-form sections; the checker has its own page and leaves this out. */
  guide?: TypeGuide;
}

export const landingPageContent: Record<string, LandingCopy> = {
  'mosaic-qr-code': {
    howTo: {
      name: 'How to Make an Image QR Code',
      description: 'Put a picture into a QR code in four steps, all in your browser.',
      steps: [
        { name: 'Enter your link', text: 'Type or paste the address the code should open. Any QR content works, because the picture only recolours the modules.' },
        { name: 'Add your image', text: 'In the Logo section below the code, open Mosaic and choose a picture. It is read on this device and never sent anywhere.' },
        { name: 'Pick halftone or tiles, then the contrast', text: 'Halftone shows more of the picture. Tiles is bolder. Raise the contrast if the scan badge says the code is fragile.' },
        { name: 'Check the scan badge and download', text: 'Wait for “Scans reliably”, download the code, and test it with a phone before you print it.' },
      ],
    },
    faqs: [
      {
        question: 'Is this an AI QR code?',
        answer:
          'No. There is no AI model and no image generation. The picture you choose is shrunk to one colour per module and each module is recoloured towards its dark or light value, so the result is your own image, made with plain arithmetic in your browser.',
      },
      {
        question: 'Will an image QR code still scan?',
        answer:
          'Usually yes, and the generator checks it for you. The code underneath is a standard QR code and no module is flipped to draw the picture, so scanners read it like any other. Busy or very dark pictures are the risky ones: raise the contrast, switch to Tiles, or pick a simpler image if the scan badge warns you.',
      },
      {
        question: 'What error correction level does it use?',
        answer:
          'Adding a mosaic image sets error correction to H, the highest level, which leaves the most room for print damage and for a small logo. You can change it under Advanced, but lowering it makes the code less forgiving.',
      },
    ],
    guide: {
      intro:
        'Make a QR code out of your own picture, such as a logo or a product photo. There is no AI and no upload: your image is blended into the code in your browser.',
      scanned: [
        'A phone sees an ordinary QR code. Every module is still dark or light, just painted in a colour from your picture, so the camera reads it like a black and white code.',
        'The data is not changed to draw the picture, so error correction is still there to cover scuffs and glare. It works with any content: a link, Wi-Fi details or a contact card.',
      ],
      useCases: [
        'Packaging where the product photo is the code.',
        'A poster, flyer or invitation that looks designed rather than stamped.',
        'A shop window or menu code that matches the artwork around it.',
      ],
      printing: [
        'Print bigger than a plain code: at least 3 cm (1.2 in), more for anything read from across a room.',
        'Pictures with clear light and dark areas work best. Flat, mid-grey pictures give the code less to work with.',
        'Use Tiles for codes scanned from a distance and Halftone when the picture matters more.',
      ],
      checks: [
        'Wait for the scan badge to say “Scans reliably”. “Fragile” means it may fail in print or on a poor camera.',
        'If it is fragile, raise the Mosaic contrast first.',
        'Do not shrink the downloaded file in a design tool; download a larger size instead.',
        'Print a test copy and scan it with an iPhone and an Android phone before printing a batch.',
      ],
      privacy:
        'Your picture is read by your browser, reduced to one colour per module and forgotten when you close the tab. It is never uploaded, and saved style templates leave it out.',
    },
  },
  'qr-code-with-logo': {
    howTo: {
      name: 'How to Add a Logo to a QR Code',
      description: 'Put your logo in the middle of a QR code and check that it still scans.',
      steps: [
        { name: 'Enter your link', text: 'Type or paste the address the code should open.' },
        { name: 'Upload your logo', text: 'In the Logo section, choose your logo image. A square image with a transparent or white background works best.' },
        { name: 'Size the logo', text: 'Keep it small enough that the scan badge stays on “Scans reliably”. The generator warns you when it is too large.' },
        { name: 'Download and test', text: 'Download the code and scan it with a phone, ideally from a printed copy, before you share it.' },
      ],
    },
    faqs: [
      {
        question: 'Does a logo stop a QR code from scanning?',
        answer:
          'Not if it is small and the error correction is high. A logo hides part of the code and the scanner rebuilds the missing part from the error correction data, so a code with a logo needs level H. This page sets it for you, and the scan badge warns you when the logo covers too much.',
      },
      {
        question: 'How big can the logo be?',
        answer:
          'Smaller than you expect. Keep it to a modest square in the centre and never cover the three corner squares. The scan badge tells you when you have gone too far, and a printed test is the final answer.',
      },
      {
        question: 'Can I use an SVG or transparent PNG?',
        answer:
          'Yes. A transparent PNG or a square image on a white background looks cleanest. Very detailed logos shrink poorly, so a simple mark works better than a full wordmark.',
      },
    ],
    guide: {
      intro:
        'Put your logo in the middle of a QR code and keep it scannable. This page turns on high error correction for you, and the scan badge warns you if the logo gets too big.',
      scanned: [
        'A phone treats it like any other code. The logo covers part of the pattern, and the scanner rebuilds the hidden part from the error correction data every QR code carries.',
        'That repair budget is limited. Level H can recover up to about 30% of the code, and the same budget has to cover scuffs and glare, so a smaller logo is safer.',
      ],
      useCases: [
        'Packaging, receipts and delivery boxes.',
        'Business cards and flyers.',
        'Table cards, shop windows and event badges.',
      ],
      printing: [
        'Print at least 2.5 cm (1 in) wide, more for anything read from a distance.',
        'Simple logos survive small sizes better than detailed ones or tiny text.',
        'Keep dark modules on a light background; low contrast leaves less room for the logo.',
      ],
      checks: [
        'Watch the scan badge while you resize the logo, and stop when it leaves “Scans reliably”.',
        'Keep the logo off the three corner squares.',
        'Leave error correction on H. Lowering it with a logo in place is the most common reason a code fails.',
        'Scan a printed test copy with an iPhone and an Android phone.',
      ],
      privacy:
        'Your link and logo are processed in your browser. The logo stays in memory while the page is open, and QRCraftly never uploads or stores it. Saved style templates leave it out.',
    },
  },
  'google-review-qr-code': {
    howTo: {
      name: 'How to Make a Google Review QR Code',
      description: 'Get your review link from Google, then turn it into a QR code.',
      steps: [
        { name: 'Find your review link', text: 'Sign in to your Google Business Profile and look for the option to share your review form, often labelled “Ask for reviews” or “Get more reviews”. Google changes the wording from time to time. Copy the link it gives you.' },
        { name: 'Paste it above', text: 'Paste the link into the generator. QRCraftly makes a plain link code and makes no call to Google.' },
        { name: 'Add your colours or logo', text: 'Match the code to your shop, then check that the scan badge says “Scans reliably”.' },
        { name: 'Print it and test it', text: 'Download the code, scan it with a phone that is not signed in as the owner, and check that the review form opens.' },
      ],
    },
    faqs: [
      {
        question: 'Where do I find my Google review link?',
        answer:
          'In your Google Business Profile, open the option to share your review form (the name changes, but it is usually “Ask for reviews” or “Get more reviews”) and copy the link. You can also search for your business on Google Maps and use the share option on its listing, but the review link from your profile opens the form directly.',
      },
      {
        question: 'Will the code expire?',
        answer:
          'The code never expires, because it is a static code that contains the link itself. It will stop working only if Google changes or removes the link behind it, so re-test it from time to time.',
      },
      {
        question: 'Can I track how many people scan it?',
        answer:
          'Not with QRCraftly. Static codes carry no tracking and we do not add any. The number of reviews you receive in your Google Business Profile is the real measure.',
      },
    ],
    guide: {
      intro:
        'Turn your Google review link into a QR code. Customers scan it and land on the form to leave you a review.',
      scanned: [
        'The phone opens the review link. Customers who are signed in to Google see the review form straight away; others are asked to sign in first. On some phones the Google Maps app opens it instead.',
        'The code holds only the link, so it works for as long as Google keeps that link working.',
      ],
      useCases: [
        'A counter card or receipt sticker.',
        'A table tent in a restaurant.',
        'A card left behind after a repair or appointment.',
      ],
      printing: [
        'Add a short line beside the code, such as “Tell us how we did”.',
        'Put it where people wait, at eye or counter height.',
      ],
      checks: [
        'Open the link in a private browser window first. If the review form does not appear, the code will not show it either.',
        'Make sure it is the review link, not your website or map listing.',
        'Re-test the code every few months in case Google changes its links.',
        'Do not offer rewards for reviews. Google’s policies forbid it.',
      ],
      privacy:
        'The link is put into the code in your browser. QRCraftly never contacts Google and adds no tracking, so it cannot tell who scans your code.',
    },
  },
  'menu-qr-code': {
    howTo: {
      name: 'How to Make a Menu QR Code',
      description: 'Link a menu you already host to a QR code for tables, windows and takeaway bags.',
      steps: [
        { name: 'Put your menu online', text: 'Use a page on your own website, or a PDF you host somewhere with a stable link. QRCraftly does not host files.' },
        { name: 'Paste the link above', text: 'Paste the menu address into the generator.' },
        { name: 'Style and check it', text: 'Match your brand colours, add your logo and wait for “Scans reliably”.' },
        { name: 'Print, then test at a table', text: 'Print a copy, scan it at the table with a real phone, and check that the menu loads on mobile data.' },
      ],
    },
    faqs: [
      {
        question: 'Will my menu QR code expire?',
        answer:
          'No. The code holds your link directly, with no middleman, so there is no trial to end and no fee to keep it alive. The code stops working only if the page behind it is taken down, so keep that address in your hands.',
      },
      {
        question: 'Can I change the menu without reprinting the code?',
        answer:
          'Yes, if you keep the link the same. Replace the file or edit the page at that address, and every printed code shows the new menu. If the link itself changes, you will need a new code.',
      },
      {
        question: 'Do you host my menu?',
        answer:
          'No. QRCraftly makes static codes and has no servers for your files. Host the menu on your own website or any file host that gives you a permanent link.',
      },
      {
        question: 'Should the menu be a PDF or a web page?',
        answer:
          'A mobile-friendly web page is easier to read on a phone. A PDF works, but keep it small and legible without zooming. Whichever you use, test it on mobile data.',
      },
    ],
    guide: {
      intro:
        'Make a QR code for a menu you already host online. Put it on tables, windows and takeaway bags. It has no monthly fee and does not expire.',
      scanned: [
        'Diners scan the code and the menu opens in their browser. There is no app to install.',
        'The code holds your menu’s address and nothing sits in between, so no provider can switch it off. Update the menu at that address and every printed code shows the new version.',
      ],
      useCases: [
        'Table tents and coasters.',
        'A window or door sign.',
        'Takeaway bags and delivery flyers.',
      ],
      printing: [
        'Print at least 3 cm (1.2 in) wide on tables, bigger on windows and walls.',
        'Use a matte finish. Glossy table tents reflect lights and make scanning hard.',
        'Keep a few paper menus for people without a phone.',
      ],
      checks: [
        'Check the menu loads quickly on mobile data, not only on your Wi-Fi.',
        'Keep the address the same. Do not rename the file or move the page after you print.',
        'Scan the printed code in the dining room’s actual light.',
      ],
      privacy:
        'Your menu link is put into the code in your browser and never sent to QRCraftly. There is no tracking, so we cannot see who scans your code.',
    },
  },
  'instagram-qr-code': {
    howTo: {
      name: 'How to Make an Instagram QR Code',
      description: 'Turn your Instagram username into a code that opens your profile.',
      steps: [
        { name: 'Type your username', text: 'Enter your handle without the link. The Instagram option is already selected.' },
        { name: 'Style the code', text: 'Add your colours or logo and wait for “Scans reliably”.' },
        { name: 'Download it', text: 'Save the code as a PNG for screens or an SVG for print.' },
        { name: 'Test it', text: 'Scan the code with a phone and check that it opens the right profile.' },
      ],
    },
    faqs: [
      {
        question: 'Does the code open the Instagram app?',
        answer:
          'Usually. It contains a normal Instagram web address, and phones with the app installed hand that address to the app. Without the app, it opens in the browser.',
      },
      {
        question: 'Do I need to log in to QRCraftly?',
        answer: 'No. There is no account. Type your username, download the code and you are done.',
      },
      {
        question: 'What if I change my username?',
        answer:
          'The code holds your old profile address, so it stops working. Make a new code and replace the old prints.',
      },
      {
        question: 'Is Instagram’s own QR code better?',
        answer:
          'Instagram’s built-in nametag works inside the app. A QRCraftly code is a plain link you can style, print at any size and use anywhere, and it contains no tracking.',
      },
    ],
    guide: {
      intro:
        'Make a QR code that opens your Instagram profile. Type your username, style the code and download it for a flyer, shop window or business card.',
      scanned: [
        'The phone opens your profile in the Instagram app if it is installed, otherwise in the browser. People who are not signed in may be asked to log in before they can follow you.',
      ],
      useCases: [
        'A market stall or shop counter.',
        'Business cards, packaging and stickers.',
        'Posters for a band, gallery or event.',
      ],
      printing: [
        'Print at least 2.5 cm (1 in) wide, bigger for posters.',
        'Print “@yourname” beside the code for people who cannot scan.',
      ],
      checks: [
        'Check the spelling of your username. One wrong letter sends people to a stranger.',
        'If the account is private, visitors only see a follow request screen.',
        'Make a new code if you rename the account.',
      ],
      privacy:
        'Your username is turned into a link in your browser. QRCraftly does not contact Instagram, does not log what you type and adds no tracking to the code.',
    },
  },
  'whatsapp-qr-code': {
    howTo: {
      name: 'How to Make a WhatsApp QR Code',
      description: 'Turn your WhatsApp number into a tap-to-chat code.',
      steps: [
        { name: 'Add your number to the link', text: 'The box above starts with https://wa.me/. Add your number after it in international format, digits only: no plus sign, no spaces, no leading zeros. For example, https://wa.me/15551234567.' },
        { name: 'Add a first message (optional)', text: 'To pre-fill a message, add ?text= and your message after the number, with spaces written as %20.' },
        { name: 'Style the code', text: 'Add your colours or logo and wait for “Scans reliably”.' },
        { name: 'Download and test', text: 'Scan the code with a phone and check that it opens a chat with the right number.' },
      ],
    },
    faqs: [
      {
        question: 'What format should the number be in?',
        answer:
          'International format with digits only: the country code followed by the number, with no plus sign, brackets, dashes, spaces or leading zeros. For a US number, 1 followed by the ten digits.',
      },
      {
        question: 'Can I add a message that is already typed?',
        answer:
          'Yes. Add ?text= after the number and then your message, with spaces written as %20. The visitor still has to press send.',
      },
      {
        question: 'Does the code work if the person has no WhatsApp?',
        answer:
          'The link opens a WhatsApp web page that offers to install the app or continue in the browser. Anyone without WhatsApp cannot chat with you through it.',
      },
    ],
    guide: {
      intro:
        'Make a QR code that opens a WhatsApp chat with you. Add your number to the wa.me link, style the code and download it.',
      scanned: [
        'WhatsApp opens a chat with your number, with your message already typed if you added one. Nothing is sent until the person presses send.',
        'On a computer, the link opens WhatsApp Web or the desktop app.',
      ],
      useCases: [
        'A shop or salon sign for bookings and questions.',
        'A flyer or listing for something you are selling.',
        'Business cards and invoices.',
      ],
      printing: [
        'Print at least 2.5 cm (1 in) wide, bigger for signs.',
        'Add a line such as “Chat with us on WhatsApp”.',
      ],
      checks: [
        'Use the international format, digits only, and test it. A missing country code opens the wrong chat or none.',
        'Use a number you will keep; the code cannot follow you to a new one.',
        'Anyone who scans can see your number, so consider a separate business number.',
      ],
      privacy:
        'The number is put into the code in your browser. QRCraftly never sees it, never contacts WhatsApp and adds no tracking. Anyone who scans the code can read the number.',
    },
  },
  'pdf-qr-code': {
    howTo: {
      name: 'How to Make a PDF QR Code',
      description: 'Host your PDF, then turn its link into a QR code.',
      steps: [
        { name: 'Put the PDF online', text: 'Upload it to your own website or to a file host that gives you a public, permanent link. QRCraftly does not host files, so you need a place for it first.' },
        { name: 'Copy the link and paste it above', text: 'Use the public link. If the host offers “anyone with the link can view”, choose that.' },
        { name: 'Style and check the code', text: 'Add your colours or logo and wait for “Scans reliably”.' },
        { name: 'Test it on a phone', text: 'Scan the code from a phone that is not signed in to your file host and check that the PDF opens.' },
      ],
    },
    faqs: [
      {
        question: 'Does QRCraftly host my PDF?',
        answer:
          'No. QRCraftly has no servers that store files. The code holds a web link to a PDF you host yourself, for example on your website or in a file-sharing service.',
      },
      {
        question: 'What if I replace the PDF later?',
        answer:
          'If you replace the file at the same web address, every printed code shows the new version. If the address changes, you will need a new code, so use a link you control.',
      },
      {
        question: 'Why does my code open a login page?',
        answer:
          'Your file host’s sharing setting is probably private. Change it to “anyone with the link can view” and test the link in a private window.',
      },
      {
        question: 'Can I put the PDF itself inside the QR code?',
        answer:
          'No. A QR code holds a few kilobytes at most, far less than any real PDF. To move a small file between devices without the internet, try the file transfer tool.',
      },
    ],
    guide: {
      intro:
        'Make a QR code that opens a PDF from its web link. QRCraftly does not host files, so put the PDF online first, then paste its link.',
      scanned: [
        'The phone opens the link in its browser, which shows the PDF or offers to download it.',
        'The code holds only the address, not the file. Replace the PDF at the same address and the code shows the new version; move it and the code breaks.',
      ],
      useCases: [
        'A brochure or price list at a trade show.',
        'A manual or safety sheet on a product label.',
        'A handout in a classroom or clinic.',
      ],
      printing: [
        'Say what the code opens, such as “Scan for the full catalogue (PDF)”.',
        'Keep the PDF small, because many people will open it on mobile data.',
      ],
      checks: [
        'Open the link in a private browser window. If it asks you to sign in, fix the sharing setting.',
        'Use a permanent address. Links with a date or version number in them tend to break.',
        'Anyone with the code can open the PDF, so check it holds nothing private.',
      ],
      privacy:
        'The link is put into the code in your browser. QRCraftly never sees the link or the file and adds no tracking. Your file host does see the downloads.',
    },
  },
  'qr-code-checker': {
    howTo: {
      name: 'How to Check a QR Code',
      description: 'Test any QR code image in three steps.',
      steps: [
        { name: 'Add a picture of the code', text: 'Choose an image, drop one on the box or paste a screenshot with Ctrl+V. A clear, straight picture gives the fairest result.' },
        { name: 'Read the result', text: 'The checker shows what the code holds and whether it was read.' },
        { name: 'Look at the health report', text: 'The report lists the screen scan, the link safety check and the print simulation, with advice if the code is fragile.' },
      ],
    },
    faqs: [
      {
        question: 'Is my QR code image uploaded?',
        answer:
          'No. The image is read by your browser and discarded when you leave the page. The checker contains no server component and makes no network request with your picture.',
      },
      {
        question: 'What does “scans, but fragile” mean?',
        answer:
          'The code was read from the picture, but not after the print simulation, which redraws it the way a phone sees it on paper, with ink spread, a slightly soft focus and sensor noise. Bolder modules, stronger contrast or higher error correction usually fix it before you print.',
      },
      {
        question: 'Can it check a code that someone else made?',
        answer:
          'Yes. The checker works from the picture alone, so it does not matter which generator made the code. It cannot know the code’s error correction level or intended size, so it judges only what the picture shows.',
      },
      {
        question: 'Does a pass guarantee every phone will scan it?',
        answer:
          'No. It is a strong sign, not a promise. Always scan a printed copy with a couple of real phones before you print a batch.',
      },
    ],
  },
};
