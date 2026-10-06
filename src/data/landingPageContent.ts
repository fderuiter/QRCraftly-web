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
      {
        question: 'How big should I print an image QR code?',
        answer:
          'Larger than a plain code. As a rule, print at least 3 cm (about 1.2 in) square for close-up reading and bigger for posters or anything read from a distance, because the picture lowers the contrast between modules. Test the printed copy with two phones.',
      },
      {
        question: 'Is my image uploaded anywhere?',
        answer:
          'No. The picture is decoded by your browser, kept in memory while the page is open and never sent to a server. Closing the tab forgets it. See the security page for how this is built.',
      },
    ],
    guide: {
      intro:
        'Make a QR code out of your own picture: a logo, a product shot or a pattern spread across the whole code. There is no AI and no upload, because the image is tiled into the code in your browser. It is free, with no sign-up and no ads.',
      scanned: [
        'A phone sees an ordinary QR code. Each module is still dark or still light, just painted in a colour from your picture, so the camera app opens the link exactly as it would for a plain black and white code.',
        'That is the trick behind a mosaic code. The standard matrix is kept bit for bit, and each module is pushed only as far towards dark or light as a scanner needs. Nothing about the data is changed to draw the picture, which is why the error correction stays available for damage.',
        'Because it is recoloured rather than redrawn, the same method works for any content: a link, Wi-Fi details or a contact card.',
      ],
      useCases: [
        'A brand code for packaging, where the product picture is the code.',
        'A poster or flyer that looks designed instead of stamped.',
        'A gift card, wedding invitation or event ticket with a photo woven in.',
        'A menu or shop-window code that matches the artwork around it.',
        'Business cards and stickers where a plain black square looks out of place.',
      ],
      printing: [
        'Print larger than you would a plain code, at least 3 cm (about 1.2 in), and larger still for anything read from across a room.',
        'Choose a picture with clear light and dark areas. A flat, mid-grey picture gives the code less to work with.',
        'Keep the blank border around the code. The quiet zone is part of what makes it readable.',
        'Print a test copy, scan it with an iPhone and an Android phone, and only then run the full batch.',
        'Use Tiles for codes people scan from a distance, and Halftone when the picture matters more.',
      ],
      checks: [
        'Wait for the scan badge to say “Scans reliably”. “Fragile” means it scans on screen but may not survive print or a bad camera.',
        'If the code is fragile, raise the Mosaic contrast first. That is the quickest fix and costs the least picture detail.',
        'Look at the code from arm’s length. If the picture is hard to make out, the modules are still doing their job, but a simpler image will read better.',
        'Do not shrink the exported file inside a design tool. Scale it up or export a larger size instead.',
      ],
      privacy:
        'The picture is read by your browser, reduced to one colour per module and discarded when you close the tab. It is never uploaded, and it is not stored: saved style templates leave the image out on purpose.',
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
        question: 'Is my logo uploaded?',
        answer:
          'No. The logo is read by your browser and drawn into the code on your device. It is not sent to a server, and saved style templates do not keep uploaded images.',
      },
      {
        question: 'Can I use an SVG or transparent PNG?',
        answer:
          'Yes. A transparent PNG or a square image on a white background looks cleanest. Very detailed logos shrink poorly, so a simple mark works better than a full wordmark.',
      },
    ],
    guide: {
      intro:
        'Put your logo in the middle of a QR code and keep it scannable. High error correction is already set for you, and the generator warns you if the logo gets too big. It is free, with no sign-up and no ads, and your logo never leaves your browser.',
      scanned: [
        'A phone treats the code like any other. The logo sits over the middle of the pattern, and the scanner fills in the hidden modules from the error correction data that every QR code carries.',
        'That repair budget is finite. Level H can restore roughly 30% of the code in ideal conditions, but the same budget also has to cover scuffs, glare and printing flaws, which is why a smaller logo is the safer choice.',
        'The three corner squares and the quiet border are never covered, because scanners use them to find and align the code.',
      ],
      useCases: [
        'A brand code on packaging, receipts and delivery boxes.',
        'A business card or flyer where the code carries your mark.',
        'A restaurant table card or shop window sign.',
        'An event badge or sponsor board.',
        'A product manual or label that points to support pages.',
      ],
      printing: [
        'Print at least 2.5 cm (about 1 in) square when there is a logo, and larger for anything read from a distance.',
        'Use dark modules on a light background. Reversed or low-contrast colours leave less margin for the logo.',
        'Keep the logo simple. Thin lines and tiny text turn to mush at small sizes.',
        'Print a test copy and scan it with an iPhone and an Android phone before ordering a batch.',
      ],
      checks: [
        'Watch the scan badge while you resize the logo. Stop as soon as it leaves “Scans reliably”.',
        'Check that the logo does not touch the corner squares.',
        'Confirm the logo is legible at the size you will print it.',
        'Keep error correction on H. Lowering it with a logo in place is the most common reason a code fails.',
      ],
      privacy:
        'Your link and your logo are processed in your browser only. The logo is held in memory while the page is open, and QRCraftly never uploads or stores it.',
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
        question: 'Does QRCraftly talk to Google to make this code?',
        answer:
          'No. The code simply contains the link you paste in. QRCraftly never calls a Google API, and nothing you type leaves your browser.',
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
        'Turn your Google review link into a QR code that customers scan to leave a review in a couple of taps. Paste the link, style the code and download it. It is free, with no sign-up and no ads, and nothing you enter is sent anywhere.',
      scanned: [
        'The phone’s camera reads the code and offers to open the review link. If the customer is signed in to Google, the review form opens straight away. If not, Google asks them to sign in first.',
        'On some phones the Google Maps app takes over the link and shows the review screen there. Either way, the customer lands on the form you copied from your profile.',
        'Because the code holds only the link, it works for as long as that link does.',
      ],
      useCases: [
        'A counter card or receipt sticker in a shop, café or salon.',
        'A table tent in a restaurant.',
        'A leave-behind card after a service call, clinic visit or repair.',
        'A van door, window sign or business card for tradespeople.',
        'A follow-up email or invoice footer.',
      ],
      printing: [
        'Add a short line beside the code, such as “Tell us how we did”, so people know what it is for.',
        'Print at least 2.5 cm (about 1 in) square and place it where people wait, not where they hurry past.',
        'Put it at eye or counter height. Codes on floors and high shelves are rarely scanned.',
        'Test the printed code with a phone that is not logged in as the business owner.',
      ],
      checks: [
        'Open the link in a private window first. If it does not show the review form, the code will not either.',
        'Make sure it is your review link, not the link to your website or your map listing.',
        'Re-test the code every few months in case Google changes the link format.',
        'Never offer discounts or gifts in return for reviews. Google’s policies forbid it, so check them before you run a campaign.',
      ],
      privacy:
        'The link is placed into the code in your browser. QRCraftly never contacts Google about it and never adds tracking, so it cannot tell who scans the code or how often.',
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
        'Make a menu QR code for tables, windows and takeaway bags that never expires. Link it to a menu you host, download it and print it. It is free, with no sign-up, no monthly fee and no ads, and your link stays in your browser.',
      scanned: [
        'Diners point their phone camera at the code and tap the link that appears. The menu opens in their browser, so there is no app to install.',
        'The code holds your menu’s web address itself. Nothing runs between the scan and your page, which is why the code cannot expire or be switched off by a provider.',
        'The page behind it is yours to keep up. Update the menu there and every printed code follows.',
      ],
      useCases: [
        'Table tents, coasters and menu holders.',
        'A window or door sign for passers-by.',
        'Takeaway bags, boxes and delivery flyers.',
        'A bar, market stall or food truck counter.',
        'A hotel room card for room service or the breakfast menu.',
      ],
      printing: [
        'Print at least 3 cm (about 1.2 in) square on tables, and larger on windows and walls.',
        'Use a matte finish. Glossy table tents reflect lights and make scanning hard.',
        'Laminate or use a wipeable holder, and keep the code clear of stains and curved edges.',
        'Add a short line such as “Scan for today’s menu”, and keep a few printed menus for people without a phone.',
      ],
      checks: [
        'Make sure the menu loads quickly on mobile data, not just on your restaurant Wi-Fi.',
        'Keep the link stable. Do not rename the file or move the page after you print.',
        'Check that prices, allergen notes and opening times are up to date at the address.',
        'Scan the printed code in the dim light of the dining room and not only at your desk.',
      ],
      privacy:
        'Your menu link is placed into the code in your browser and never sent to QRCraftly. There is no tracking, so we cannot see who scans your code, and neither can anyone else through us.',
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
        'Turn your Instagram username into a QR code that opens your profile. Type your handle, style the code and download it for a flyer, a shop window or a business card. It is free, with no sign-up and no ads, and nothing is uploaded.',
      scanned: [
        'The camera app reads the code and offers to open the link. On a phone with Instagram installed, the profile opens in the app. Otherwise it opens in the browser, where the visitor can follow from the web page.',
        'The code carries your profile’s web address and nothing else, so scanning it needs no account on QRCraftly and gives us no information about who scanned.',
        'Visitors who are not logged in to Instagram may be asked to sign in before they can follow you.',
      ],
      useCases: [
        'A market stall, pop-up or shop counter.',
        'Business cards, packaging inserts and product stickers.',
        'A wedding, party or event sign that points guests to a hashtag profile.',
        'Posters and flyers for a band, gallery or club.',
        'A slide at the end of a talk or a creator’s video.',
      ],
      printing: [
        'Print at least 2.5 cm (about 1 in) square, and larger for posters.',
        'Add “@yourname” in text beside the code, so people who cannot scan can still find you.',
        'Use dark modules on a light background. Brand colours are fine if the scan badge stays green.',
        'Test the printed code with a phone that is not logged in as you.',
      ],
      checks: [
        'Check the spelling of your username. One wrong letter sends people to a stranger.',
        'Make sure the account is public, or visitors will see only a request-to-follow screen.',
        'Re-make the code if you rename your account.',
        'Scan the printed copy once, in the place where it will hang.',
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
      {
        question: 'Is the number sent to QRCraftly?',
        answer:
          'No. The number is put into the code in your browser and goes nowhere else. Anyone who scans the code can read it, so only use a number you are happy to share.',
      },
    ],
    guide: {
      intro:
        'Make a QR code that opens a WhatsApp chat with you. Add your number to a wa.me link, style the code and download it for a shop sign or a business card. It is free, with no sign-up and no ads, and your number never leaves your browser.',
      scanned: [
        'The phone camera reads the code and offers to open the link. WhatsApp then starts a chat with your number, with your pre-typed message in the box if you added one.',
        'The person still has to press send, so nobody is messaged by accident.',
        'On a computer, the link opens WhatsApp Web or the desktop app if they are installed.',
      ],
      useCases: [
        'A shop, salon or clinic sign for bookings and questions.',
        'A flyer or classified ad for a rental, a second-hand sale or a service.',
        'A delivery or repair van, where phone numbers are hard to read.',
        'A market stall or event table for quick orders.',
        'Business cards and invoices for freelancers.',
      ],
      printing: [
        'Print at least 2.5 cm (about 1 in) square, and larger for signs.',
        'Write a line beside the code, such as “Chat with us on WhatsApp”.',
        'Keep your number out of the printed text if you want to avoid cold calls, but remember that the code itself contains it.',
        'Test the printed code on a phone that has never chatted with you.',
      ],
      checks: [
        'Type the number in international format, digits only, and test it. A missing country code opens the wrong chat or none at all.',
        'Use a number that you will keep. The code cannot follow you to a new one.',
        'Consider a separate business number. Anyone who scans can see your number.',
        'If you add a message, keep it short and neutral.',
      ],
      privacy:
        'The number is placed into the code in your browser. QRCraftly never sees it, never contacts WhatsApp and adds no tracking, but anyone who scans the code can read the number inside it.',
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
        'Make a QR code that opens a PDF at its web link. QRCraftly does not host files, so put the PDF online first, paste its link and download the code. It is free, with no sign-up and no ads, and the link never leaves your browser.',
      scanned: [
        'The phone camera reads the web link and opens it in the browser, which shows the PDF or offers to download it, depending on the phone and the host.',
        'The code contains only the address, not the file. That keeps the code small and easy to scan, and it means you can replace the PDF later without changing the code.',
        'If the address stops working, the code stops working with it, so keep the file where you control it.',
      ],
      useCases: [
        'A brochure, catalogue or price list on a stand or at a trade show.',
        'A product manual or safety sheet on a label.',
        'A menu, timetable or event programme.',
        'A CV or portfolio on a business card.',
        'A form, worksheet or handout in a classroom or clinic.',
      ],
      printing: [
        'Print at least 2.5 cm (about 1 in) square, and larger for posters.',
        'Name what the code opens, for example “Scan for the full catalogue (PDF)”.',
        'Keep the PDF small, since many people will open it on mobile data.',
        'Put the code on flat, uncluttered paper rather than across a fold.',
      ],
      checks: [
        'Open the link in a private window. If it asks you to sign in, the sharing setting is wrong.',
        'Make sure the PDF is readable on a small screen without pinching.',
        'Use a permanent address. Links that contain a date or a version number are likely to break.',
        'Check the PDF holds nothing you do not want public, because anyone with the code can open it.',
      ],
      privacy:
        'The link is placed into the code in your browser. QRCraftly does not see the link or the file, and it adds no tracking, so we cannot tell who scans the code. Where you host the PDF is up to you, and that host sees the downloads.',
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
