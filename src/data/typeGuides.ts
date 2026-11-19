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

import { landingPageContent } from './landingPageContent';

/**
 * The background copy of a generator page. It sits below the tool: a short intro, then the
 * rest as optional FAQ answers (#1354), so people who came to make a code never have to read it.
 */
export interface TypeGuide {
  /** One or two sentences, at most 40 words: what the code does when scanned. */
  intro: string;
  /** What a phone does when it scans the code. */
  scanned: string[];
  /** Real situations for this kind of code. */
  useCases: string[];
  /** Printing and sharing advice specific to this kind of code. */
  printing: string[];
  /** Things to check before sharing the code, specific to this type. */
  checks: string[];
  /** Where the typed data goes, in this type's own terms. */
  privacy: string;
}

/** The long-form guides of the landing pages that preset the generator (#1035, #1037). */
const landingGuides: Record<string, TypeGuide> = Object.fromEntries(
  Object.entries(landingPageContent).flatMap(([id, copy]) => (copy.guide ? [[id, copy.guide]] : [])),
);

export const typeGuides: Record<string, TypeGuide> = {
  ...landingGuides,
  index: {
    intro:
      'Turn any web link into a QR code. People point their phone camera at it and tap to open your website or page.',
    scanned: [
      'The phone camera detects the link and shows the web address. Tapping it opens the page in the browser.',
      'The code is static: it holds the link itself, so it opens directly without going through any redirect server.',
    ],
    useCases: [
      'Product packaging, instruction manuals and stickers linking to user guides.',
      'Posters, flyers and business cards sending visitors to a website or portfolio.',
      'Signs, storefront windows and table tents linking to online menus or services.',
    ],
    printing: [
      'Print it at least 2 cm (0.8 in) wide, larger if scanned from a distance.',
      'Keep strong contrast between dark modules and a light background so cameras focus quickly.',
      'Short links keep the pattern simpler and easier to scan at smaller print sizes.',
    ],
    checks: [
      'Include https:// in the address and open the link on a phone before you print.',
      'Check that the page loads quickly on a mobile connection and is mobile friendly.',
      'Make sure the destination link is permanent, because a printed static code cannot be changed.',
    ],
    privacy:
      'The web address is encoded directly into the QR code in your browser. QRCraftly never sees, redirects or logs your destination link.',
  },
  'bulk-csv-qr-code': {
    intro:
      'Turn each row of a spreadsheet into a QR code in one run. Download hundreds of codes in a single ZIP file.',
    scanned: [
      'Each code in the batch scans according to its content type: web links open in the browser, plain text displays on screen, and contact cards prompt phones to save the contact directly to address books without typing.',
      'Every code is independent and static, storing its payload directly without tracking or redirect servers.',
    ],
    useCases: [
      'Asset tags, inventory labels and serial numbers from an equipment spreadsheet.',
      'Event name badges, admission tickets and wristbands from an attendee roster.',
      'Product packaging batches and shelf tags from a catalogue export.',
    ],
    printing: [
      'Choose SVG or EPS for vector printing on commercial presses, PDF for sharp document collation, or high-resolution PNG for label printers.',
      'Vector EPS and PDF exports retain sharp geometry at any print dimension without pixelation or raster blur.',
      'Base your label size on the longest entry in your file, because multi-column contact cards and longer text create denser codes.',
      'Print and scan a few sample labels before running a large batch through a label printer or commercial press.',
    ],
    checks: [
      'Confirm column headers match your intended content or contact card fields (first name, last name, phone, email, organization, title) and file naming column.',
      'Preflight synthesis checks verify contact identity (first name, last name, or organization) and valid email formatting before generation.',
      'Review any flagged empty, invalid, or caution rows shown on screen before downloading the archive.',
      'Upload .csv, .txt, or .xlsx files with 500 rows or fewer; re-save legacy .xls spreadsheets as .xlsx or .csv before uploading.',
    ],
    privacy:
      'All CSV, TXT, and Excel (.xlsx) parsing, QR code rendering, and ZIP packaging happen entirely in your browser. Your spreadsheet data is never uploaded to any server.',
  },
  'wifi-qr-code': {
    intro:
      'Put your network name and password in a QR code. Guests point their camera at it and join your Wi-Fi without typing anything.',
    scanned: [
      'The iPhone Camera app (iOS 11 and later) and Android 10 and later offer to join the network. Older Android phones may need Google Lens or a scanner app. Laptops usually cannot join from a code.',
      'Once joined, the phone remembers the network like any other.',
    ],
    useCases: [
      'A guest card in a vacation rental.',
      'A sign at the counter of a café or waiting room.',
      'A meeting room, so visitors stop asking for the password.',
    ],
    printing: [
      'Print it at least 2 cm (0.8 in) wide, bigger if people scan it from across a counter.',
      'Test it with an iPhone and an Android phone before you print a batch.',
      'If you change the password, the old code stops working. Make a new one.',
    ],
    checks: [
      'Type the network name exactly as the router shows it, capitals and spaces included.',
      'Pick the Encryption mode your router uses: WPA / WPA2 / WPA3 covers almost every router, while WPA3 only (SAE) is only for strict WPA3-only networks because Android phones read it whereas iPhone cameras may not.',
      'Select Hidden Network only if the router does not broadcast its name.',
      'Enterprise (EAP) networks are less widely supported by phone cameras than password networks, so test those codes on the phones your guests use.',
    ],
    privacy:
      'The code is made in your browser, and the password is never sent to QRCraftly. Anyone who scans the code can read the password, so use a guest network if you have one.',
  },
  'vcard-qr-code': {
    intro:
      'Put your contact details in a QR code. One scan offers to save your name, number, email, company and social profiles to the phone’s contacts.',
    scanned: [
      'The iPhone Camera app and most Android camera apps, or Google Lens, show the contact and offer to save it. The person can check the fields first. No internet connection is needed, because the details are in the code itself.',
      'A saved contact is a copy. If your details change, people who already scanned keep the old ones, so a website you keep up to date is worth adding.',
    ],
    useCases: [
      'The back of a business card.',
      'A name badge at a conference.',
      'The last slide of a talk, or a CV.',
    ],
    printing: [
      'Every field makes the code denser. For a small card, keep to a name, a phone number, an email and one link.',
      'On a business card, make the code at least 2 cm (0.8 in) wide and test it on a printed copy.',
    ],
    checks: [
      'Write the phone number with its country code, such as +1 or +44, or import an existing .vcf contact card with Choose a .vcf file.',
      'Scan your own code and open the saved contact to check every field landed in the right place.',
      'vCard 3.0 is the default and reads on most phones. Pick MECard for the smallest code—noting that MECard omits Profile Photo URL, Social Profiles, and State or Province—or vCard 4.0 only if you know the reader supports it.',
    ],
    privacy:
      'Your typed details and any imported .vcf file stay in your browser and are never sent to QRCraftly. Anyone who sees a printed code can read them, so only include what you would hand to a stranger.',
  },
  'email-qr-code': {
    intro:
      'Make a QR code that opens a new email to you, with the subject and message already written. The person only has to press send.',
    scanned: [
      'The phone opens its default mail app with the address, subject and message filled in. Nothing is sent until the person presses send, and the code does not tell you who scanned it.',
    ],
    useCases: [
      'A feedback request on a receipt or table card.',
      'A support address on a product or manual.',
      'A booking request on a poster.',
    ],
    printing: [
      'Keep the subject and message short. Long text makes the code denser and harder to scan.',
      'Use a shared address such as support@ rather than a personal one, because a printed code cannot be changed.',
    ],
    checks: [
      'Read the address back letter by letter. One typo sends every message to someone else.',
      'Use a subject that makes replies easy to sort, such as “Feedback: table 4”.',
      'Scan the printed code and send yourself the email once.',
    ],
    privacy:
      'The address and text are put into the code in your browser and never sent to QRCraftly. Anyone who scans a printed code can see the address.',
  },
  'sms-qr-code': {
    intro:
      'Make a QR code that opens a text message to your number with the words already typed. People scan it, check it and tap send.',
    scanned: [
      'On iPhone and Android, the messaging app opens with your number and message filled in. Nothing is sent until the person taps send, and their normal carrier rates apply.',
    ],
    useCases: [
      'A text-to-join list, with a keyword such as JOIN already typed.',
      'Booking a callback or a quote from a shop or van.',
      'Confirming an appointment at a clinic or salon.',
    ],
    printing: [
      'Say what the code does next to it, such as “Text us to book”.',
      'Keep the message to a few words so the code stays easy to scan.',
    ],
    checks: [
      'Make sure the number can receive texts. Many landlines and some toll-free numbers cannot.',
      'Start the message with the keyword your system expects, because people send it as written.',
      'If you collect sign-ups by text, print any costs or opt-in terms next to the code.',
    ],
    privacy:
      'The number and message are put into the code in your browser. QRCraftly never receives them and never sends a text. Anyone who scans can see the number.',
  },
  'phone-qr-code': {
    intro:
      'Make a QR code that opens the phone’s dialer with your number ready. People scan it instead of reading and typing the digits.',
    scanned: [
      'The phone shows the number and offers to call it. The call only starts when the person confirms.',
    ],
    useCases: [
      'A “call us” code on a van or shop window.',
      'A pet tag, luggage tag or bike.',
      'A support line on a product or manual.',
    ],
    printing: [
      'Print the number in text next to the code for anyone who cannot scan.',
      'Seal or laminate codes that live outdoors so the ink does not fade.',
    ],
    checks: [
      'Start the number with + and the country code, such as +1 or +44, if the code may travel.',
      'Scan the code and read the number on screen before you print.',
      'If the line has opening hours, print them beside the code.',
    ],
    privacy:
      'The number is put into the code in your browser and never sent to QRCraftly. Anyone can read a printed code, so use a number you are happy to share.',
  },
  'event-qr-code': {
    intro:
      'Turn an event into a QR code. Guests scan it to add the title, time and place to their calendar.',
    scanned: [
      'With the default iCalendar format, the iPhone Camera app offers to add the event to Calendar. On Android it depends on the camera app; Google Lens and most scanner apps can add it. The person checks the details before saving.',
      'If you pick Google, Outlook, Office 365 or Yahoo instead, the code is a link that opens that calendar’s “add event” page in the browser.',
    ],
    useCases: [
      'A save-the-date on an invitation.',
      'A class, workshop or club night on a poster.',
      'A shop opening or sale.',
    ],
    printing: [
      'Print the date and place in text too, because people decide whether to scan from what they can read.',
      'Keep the description short so the code stays easy to scan.',
    ],
    checks: [
      'Check that the end date and time come on or after the start; inverted times are blocked so calendars do not reject the event.',
      'Use All-day event for full-day dates, or pick a Timezone if guests may be elsewhere. Repeat and Occurrence Count work on iCalendar (.ics) and Google Calendar and clear when switching to Outlook Web, Office 365, or Yahoo Calendar.',
      'Put the full address in Location so the calendar can show it on a map.',
    ],
    privacy:
      'With iCalendar (.ics), the event stays inside the QR code in your browser and QRCraftly receives nothing. Choosing Google Calendar, Outlook Web, Office 365, or Yahoo Calendar builds a web link carrying the title, times, location, and description, so opening that link shares those details with Google, Microsoft, or Yahoo.',
  },
  'location-qr-code': {
    intro:
      'Make a QR code for a point on the map from a Google Maps link, geo: URI, DMS coordinates, or latitude and longitude. Scanning opens that spot in a maps app.',
    scanned: [
      'The code holds a standard geo: link. Android phones usually open it in the default maps app. On iPhone it depends on the iOS version and the scanner, so test it on the phones you care about.',
      'If it has to work everywhere, put a link to your preferred map service in a URL code instead.',
    ],
    useCases: [
      'A meeting point at a festival or market.',
      'The parking lot or side entrance of a hard-to-find venue.',
      'A trailhead or viewpoint on a sign.',
    ],
    printing: [
      'Write the place name or address beside the code for anyone who cannot scan it.',
      'Five decimal places are accurate to about a meter (3 feet), which is enough for a door.',
    ],
    checks: [
      'Paste a Google Maps link, geo: URI, or DMS string into Google Maps Link or Coordinates, or enter Latitude first with minus signs for south and west.',
      'Drop a pin on the exact entrance or meeting point, not the middle of the building.',
      'Scan the code and compare the pin with where you are before you print it.',
    ],
    privacy:
      'The coordinates are put into the code in your browser and QRCraftly never receives them. Clicking Use Current Location asks your browser for location permission once and keeps the coordinates local on your device.',
  },
  'meeting-qr-code': {
    intro:
      'Turn a Zoom, Microsoft Teams or Google Meet link into a QR code. People in the room scan it to join from their phone.',
    scanned: [
      'The code holds the join link. It opens in the meeting app if it is installed, or in the browser. Passcodes, waiting rooms and registration work exactly as they do when someone clicks the link.',
    ],
    useCases: [
      'A slide in a hybrid meeting or lecture.',
      'A sign on a meeting room door.',
      'A webinar poster.',
    ],
    printing: [
      'On a slide, make the code about a fifth of the slide height so the back row can scan it.',
      'Use a recurring meeting or personal room link for a code that stays up. One-off links expire.',
    ],
    checks: [
      'Paste the full link from the invitation, including https://, not only the meeting ID.',
      'Join once through the code from your own phone.',
      'If the link contains a passcode, anyone who sees the code can join, so keep the waiting room on for private meetings.',
    ],
    privacy:
      'The link is put into the code in your browser and never sent to QRCraftly. Anyone who can see the code can use the link.',
  },
  'payment-qr-code': {
    intro:
      'Make a QR code that asks for a payment: a Bitcoin, Ethereum, Solana or Litecoin request, a SEPA bank transfer, a UPI payment in India, or a PayPal, Venmo or Cash App link.',
    scanned: [
      'A crypto code opens a payment screen in a wallet app that supports that network. A SEPA code fills in a transfer in banking apps that read EPC codes. A UPI code opens the payment screen in a UPI app such as Google Pay, PhonePe, Paytm or BHIM. PayPal, Venmo and Cash App codes are links that open the app or website.',
      'Nothing is paid by scanning. The payer checks the details and approves the payment in their own app.',
    ],
    useCases: [
      'A tip jar or donation sign.',
      'An invoice with the amount filled in.',
      'A market stall or fundraiser.',
    ],
    printing: [
      'Send a small test payment to yourself before you print a batch.',
      'Check printed codes now and then. Someone can stick a different code over yours.',
    ],
    checks: [
      'Pick the network that matches the address. Funds sent on the wrong network can be lost.',
      'For SEPA Credit Transfer (EPC QR), enter both IBAN and Beneficiary Name; for UPI (India), enter both UPI ID and Payee Name.',
      'Compare the first and last characters of the address, IBAN, or UPI ID after pasting, and leave Amount empty for tips and donations.',
    ],
    privacy:
      'The details are put into the code in your browser. QRCraftly never receives them, never processes payments and never touches funds. Never put a private key or recovery phrase in a QR code.',
  },
  'social-qr-code': {
    intro:
      'Make a QR code for Instagram, X, TikTok, LinkedIn, YouTube, Facebook, WhatsApp, or GitHub. Enter your username—or your WhatsApp phone number and greeting—to open directly.',
    scanned: [
      'Profile codes hold your direct web address and open in the app if installed, otherwise in the browser. WhatsApp codes open a wa.me chat with your number and any Pre-filled Message ready to send.',
    ],
    useCases: [
      'A market stall or shop counter.',
      'A business card or flyer.',
      'The last slide of a talk.',
    ],
    printing: [
      'Print your username or WhatsApp number in text beside the code, so people can still reach you if it will not scan.',
      'If you rename your account or change your number, the code still points at the old one. Make a new code.',
    ],
    checks: [
      'Type usernames with or without @; for YouTube you can also paste a channel or video link.',
      'For WhatsApp, enter Phone Number in international digits only (no plus sign, spaces, or leading zeros); Pre-filled Message encodes spaces and punctuation automatically.',
      'Open the code on a phone that is not signed in. A private account shows a login or follow request, not your posts.',
    ],
    privacy:
      'The profile or wa.me link is made in your browser and QRCraftly does not see it. Once someone opens it, the platform’s own rules and tracking apply.',
  },
  'text-qr-code': {
    intro:
      'Turn plain text into a QR code: a note, a serial number or a short message. Scanning shows the text as you typed it.',
    scanned: [
      'The phone shows the text, usually with an option to copy it. Nothing opens or dials. Long text may be cut short in the camera’s pop-up until the person taps it.',
      'If the text is a web address, phone number or email address, use that generator instead so the phone can open it.',
    ],
    useCases: [
      'A serial number or asset label.',
      'A clue in a treasure hunt or classroom game.',
      'A note to move from one device to another.',
    ],
    printing: [
      'More text makes a denser code. Keep it short for anything printed small.',
      'Use a higher error correction level for labels that may get scuffed.',
    ],
    checks: [
      'Scan it once before printing. Line breaks and special characters are kept exactly as typed.',
      'Avoid characters people confuse when reading back, such as the letter O and the digit 0.',
    ],
    privacy:
      'The text is put into the code in your browser and never sent to QRCraftly. Anyone who scans it can read all of it, so leave secrets out.',
  },
};
