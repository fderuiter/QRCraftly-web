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
  'wifi-qr-code': {
    intro:
      'Put your network name and password in a QR code. Guests point their camera at it and join your Wi-Fi without typing anything.',
    scanned: [
      'The iPhone Camera app (iOS 11 and later) and Android 10 and later offer to join the network. Older Android phones may need Google Lens or a scanner app. Laptops usually cannot join from a code.',
      'Once joined, the phone remembers the network like any other.',
    ],
    useCases: [
      'A guest card in a holiday rental.',
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
      'Pick the security type your router uses. WPA/WPA2/WPA3 covers almost every home and office router.',
      'Tick Hidden Network only if the router does not broadcast its name.',
      'Enterprise (EAP) networks are less widely supported by phone cameras than password networks, so test those codes on the phones your guests use.',
    ],
    privacy:
      'The code is made in your browser, and the password is never sent to QRCraftly. Anyone who scans the code can read the password, so use a guest network if you have one.',
  },
  'vcard-qr-code': {
    intro:
      'Put your contact details in a QR code. One scan offers to save your name, number, email and company to the phone’s contacts.',
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
      'Write the phone number with its country code, such as +44, so it works for people abroad.',
      'Scan your own code and open the saved contact to check every field landed in the right place.',
      'vCard 3.0 is the default and reads on most phones. Pick MECARD for the smallest code, or 4.0 only if you know the reader supports it.',
    ],
    privacy:
      'Your details are written into the code in your browser and never sent to QRCraftly. Anyone who sees a printed code can read them, so only include what you would hand to a stranger.',
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
      'Make a QR code that opens the phone’s dialler with your number ready. People scan it instead of reading and typing the digits.',
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
      'Check the start and end times against your invitation. Swapped am and pm is the usual mistake.',
      'Pick a time zone if guests may be elsewhere. Floating time shows the same clock time wherever the code is scanned.',
      'Put the full address in the location field so the calendar can show it on a map.',
    ],
    privacy:
      'The event details are put into the code in your browser. QRCraftly receives nothing and keeps no guest list. Anyone who scans can read the details.',
  },
  'location-qr-code': {
    intro:
      'Make a QR code for a point on the map from its latitude and longitude. Scanning it opens that spot in a maps app.',
    scanned: [
      'The code holds a standard geo: link. Android phones usually open it in the default maps app. On iPhone it depends on the iOS version and the scanner, so test it on the phones you care about.',
      'If it has to work everywhere, put a link to your preferred map service in a URL code instead.',
    ],
    useCases: [
      'A meeting point at a festival or market.',
      'The car park or side entrance of a hard-to-find venue.',
      'A trailhead or viewpoint on a sign.',
    ],
    printing: [
      'Write the place name or address beside the code for anyone who cannot scan it.',
      'Five decimal places are accurate to about a metre, which is enough for a door.',
    ],
    checks: [
      'Latitude comes first. South and west are negative, so do not drop the minus sign.',
      'Drop a pin on the exact entrance or meeting point, not the middle of the building.',
      'Scan the code and compare the pin with where you are before you print it.',
    ],
    privacy:
      'The coordinates are put into the code in your browser. QRCraftly never receives them and never asks for your device’s location.',
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
      'Make a QR code that asks for a payment: a Bitcoin, Ethereum, Solana or Litecoin request, a SEPA bank transfer, or a PayPal, Venmo or Cash App link.',
    scanned: [
      'A crypto code opens a payment screen in a wallet app that supports that network. A SEPA code fills in a transfer in banking apps that read EPC codes. PayPal, Venmo and Cash App codes are links that open the app or website.',
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
      'Compare the first and last characters of the address with your wallet after you paste it.',
      'Leave the amount empty for tips and donations. Some wallets ignore it anyway, so print the amount in text when it matters.',
    ],
    privacy:
      'The details are put into the code in your browser. QRCraftly never receives them, never processes payments and never touches funds. Never put a private key or recovery phrase in a QR code.',
  },
  'social-qr-code': {
    intro:
      'Make a QR code that opens your profile. Pick Instagram, X, TikTok, LinkedIn, YouTube, Facebook, WhatsApp or GitHub, then type your username.',
    scanned: [
      'The code holds the normal web address of your profile. It opens in the app if it is installed, otherwise in the browser. Some platforms ask people to sign in before they can follow you.',
    ],
    useCases: [
      'A market stall or shop counter.',
      'A business card or flyer.',
      'The last slide of a talk.',
    ],
    printing: [
      'Print your username in text beside the code, so people can still find you if it will not scan.',
      'If you rename your account, the code still points at the old name. Make a new one.',
    ],
    checks: [
      'Type the username with or without the @. The generator builds the profile address.',
      'Check the platform before you download. The same name can belong to someone else elsewhere.',
      'Open the code on a phone that is not signed in. A private account shows a login or follow request, not your posts.',
    ],
    privacy:
      'The profile link is made in your browser and QRCraftly does not see it. Once someone opens it, the platform’s own rules and tracking apply.',
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
