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

/**
 * One block of a guide's body. Text may hold `[label](href)` links and nothing else: guides are
 * plain data, so the page renders them without a Markdown parser and without raw HTML.
 */
export type GuideBlock =
  | { type: 'p'; text: string }
  | { type: 'ul' | 'ol'; items: string[] }
  | { type: 'table'; caption: string; head: string[]; rows: string[][] }
  | { type: 'note'; title: string; text: string };

/** A guide's H2 section; `id` becomes the anchor and the table-of-contents entry. */
export interface GuideSection {
  id: string;
  heading: string;
  blocks: GuideBlock[];
}

/** A source a guide's claims rest on. */
export interface GuideSource {
  /** Publisher and title, so the source can be found even if its address moves. */
  label: string;
  url: string;
  /** What the guide takes from it. */
  supports: string;
}

/** A long-form guide in the `/guides` hub (#1038). */
export interface Guide {
  /** Route segment: the guide lives at `/guides/<slug>`. */
  slug: string;
  /** The page heading (H1). */
  title: string;
  /** Short name for breadcrumbs and the hub. */
  shortTitle: string;
  /** Meta title, ending with the brand. */
  seoTitle: string;
  /** Meta description, 155 characters at most. */
  description: string;
  /** Opening sentences under the heading. */
  lead: string;
  /** First publication, `YYYY-MM-DD`. */
  datePublished: string;
  /** Last substantive edit, `YYYY-MM-DD`. Also the sitemap `lastmod`. */
  dateModified: string;
  sections: GuideSection[];
  sources: GuideSource[];
  /** Slugs of guides to link at the end. */
  related: string[];
}

/** The byline every guide shows: the guides are written by the project, not a named person. */
export const GUIDE_AUTHOR = 'QRCraftly';

export const guides: Guide[] = [
  {
    slug: 'why-qr-codes-stop-working',
    title: 'QR code not scanning or stopped working? Why, and how to fix it',
    shortTitle: 'Why QR codes stop working',
    seoTitle: 'QR Code Not Scanning or Stopped Working? Fixes | QRCraftly',
    description:
      'QR code not scanning? Find out if it was switched off, points at a dead page, is hard to read or meets a phone problem, and how to fix each one.',
    lead: 'A QR code is only a picture of some data, so it cannot expire or switch itself off. When one will not scan or stops working, it is nearly always one of four things. This guide shows you how to tell which in two minutes, and how to make a code that never stops.',
    datePublished: '2026-10-03',
    dateModified: '2026-10-13',
    sections: [
      {
        id: 'short-answer',
        heading: 'The short answer',
        blocks: [
          {
            type: 'p',
            text: 'A QR code holds a few hundred characters of text, usually a web address, drawn as a pattern of squares. Nothing in the pattern can run out. If a code that used to work no longer does, one of these happened:',
          },
          {
            type: 'ol',
            items: [
              'It was a “dynamic” code, and the service that made it switched it off. The code held an address on that service, and the service decides where it leads, or whether it leads anywhere.',
              'The page it points to has moved, been renamed or been deleted, or the domain it lives on has lapsed.',
              'The printed code is hard for a camera to read: too small, too faint, damaged, or crowded by a logo.',
            ],
          },
          {
            type: 'p',
            text: 'The first is the one people find most upsetting, because the code looks fine and the only fix is to pay or to print again. It is also the only one you can rule out before you ever print: make a static code, and there is nothing for anyone to switch off.',
          },
        ],
      },
      {
        id: 'which-one',
        heading: 'Find out which one in two minutes',
        blocks: [
          {
            type: 'ol',
            items: [
              'Scan the code with your phone’s camera, or drop a photo of it on the [QR code scanner](/qr-code-scanner). It shows the real address behind the code before opening anything.',
              'If nothing is read at all, the problem is the print or the camera. Go to [the printing section](#hard-to-read).',
              'If an address appears and it belongs to someone other than you, such as a short link on a QR service’s own domain, you have a dynamic code. Go to [the dynamic code section](#switched-off).',
              'If the address is yours, or is the page you meant, open it. If the browser shows an error or the wrong page, the destination is the problem. Go to [the dead page section](#dead-page).',
            ],
          },
          {
            type: 'p',
            text: 'Have a photo of the code but no phone handy? The [QR code checker](/qr-code-checker) reads a picture of any code, shows what it holds, and tells you whether it would survive a poor print.',
          },
        ],
      },
      {
        id: 'switched-off',
        heading: 'Cause 1: a dynamic code that was switched off',
        blocks: [
          {
            type: 'p',
            text: 'A dynamic code does not contain your address. It contains a short address on the provider’s own domain, and the provider’s server forwards each scan to your real page. That is how a provider can show you scan counts and let you change the destination after printing. It is also why the code depends on them: if the account lapses, the free trial ends or the provider closes, the forwarding stops and the code goes dead or lands on the provider’s own page.',
          },
          {
            type: 'note',
            title: 'What you can and cannot do',
            text: 'Reactivating the account usually restores the same code, because the code itself never changed. If you have no account to reactivate, the printed code cannot be repaired. You have to make a new code and replace the old one. Before you do, check whether you can find the old destination: it is the one thing the old code no longer tells you.',
          },
          {
            type: 'p',
            text: 'The lasting fix is to stop depending on a middleman. A static code holds your address, so it works for as long as that address does. If you still want to change the destination later, point the code at a short address on a domain you own, then change where that address leads. [Static vs dynamic QR codes](/guides/static-vs-dynamic-qr-codes) covers the trade-offs.',
          },
        ],
      },
      {
        id: 'dead-page',
        heading: 'Cause 2: the page it points to is gone',
        blocks: [
          {
            type: 'p',
            text: 'Links break, and a printed code cannot be edited. The usual ways a destination disappears are:',
          },
          {
            type: 'ul',
            items: [
              'A website redesign that changes page addresses without redirecting the old ones.',
              'A PDF, menu or form that was renamed, replaced under a new name, or taken down.',
              'A domain that expired and was not renewed.',
              'A link shortener or file host that closed or changed its terms.',
              'A social profile whose username changed.',
            ],
          },
          {
            type: 'p',
            text: 'If you control the destination, the repair is cheap: put a redirect from the old address to the new one, and every printed code works again. If you do not control it, the code is only as durable as someone else’s page. Point codes at an address you own whenever you can, and keep that address alive. Renew the domain, and add a redirect whenever you move a page.',
          },
        ],
      },
      {
        id: 'hard-to-read',
        heading: 'Cause 3: the print is hard to read',
        blocks: [
          {
            type: 'p',
            text: 'Phones are good at reading QR codes, but they have limits. These are the usual culprits, and what to do about each.',
          },
          {
            type: 'table',
            caption: 'Common reading problems and their fixes',
            head: ['What you see', 'Likely cause', 'Fix'],
            rows: [
              ['Phone cannot find a code at all', 'Printed too small for the distance it is scanned from', 'A common rule of thumb is a code about one tenth as wide as the scanning distance. For close-up use, print at least 2 cm (0.8 in) wide.'],
              ['Reads on a screen, fails on paper', 'Low contrast, faint ink, or a glossy surface that reflects light', 'Use dark modules on a light background, a matte finish, and check the print under the light where it will hang.'],
              ['Works only if you hold it just right', 'No blank border (the quiet zone), or the code is cropped or on a curved surface', 'Leave a blank margin of at least four modules on every side, which is the width the standard specifies, and keep the code flat.'],
              ['Fails after it was folded, scratched or sun-faded', 'Damage beyond what error correction can repair', 'Print on a durable material. Higher error correction tolerates more damage, up to about 30% at level H.'],
              ['Worked until a logo was added', 'The logo covers too much of the code', 'Make the logo smaller, or raise the error correction to H, and test again.'],
              ['The code looks dense and busy', 'Too much data in it, so each square is tiny', 'Encode a shorter address. A short address gives fewer, larger squares that are easier to read.'],
              ['Light squares on a dark background fail on some phones', 'Inverted codes are not supported by every scanner', 'Use dark on light, unless you have tested the inverted version on the phones you care about.'],
            ],
          },
          {
            type: 'p',
            text: 'Error correction is what lets a damaged code still scan. Level L repairs about 7% of the code, M about 15%, Q about 25% and H about 30%, according to the standard’s authors. Higher levels make the code denser, so they trade readability at small sizes for tolerance of damage.',
          },
          {
            type: 'p',
            text: 'To see how your code copes, run it through the [QR code checker](/qr-code-checker), which simulates a blurry print.',
          },
        ],
      },
      {
        id: 'phone-side',
        heading: 'Cause 4: it is the phone, not the code',
        blocks: [
          {
            type: 'ul',
            items: [
              'The camera app has no permission for the camera, or a scanner setting is turned off.',
              'A smudged or cracked lens, or a screen protector over the camera.',
              'Scanning a code shown on another screen: glare, a low brightness setting or a refresh-rate pattern can all spoil it. Raise the brightness or save the image and open it from the gallery.',
              'An old phone or browser that cannot read codes natively. Photo-based scanners such as the one on this site work around that.',
            ],
          },
          {
            type: 'p',
            text: 'If one phone fails and another reads the code instantly, the code is probably borderline. Fix the print rather than trusting the better phone.',
          },
        ],
      },
      {
        id: 'never-stops',
        heading: 'How to make a code that never stops working',
        blocks: [
          {
            type: 'ol',
            items: [
              'Make a static code, so the code holds your address itself and no service sits between the scan and your page.',
              'Point it at an address you control, and keep that address alive. Renew the domain, redirect old paths, and do not rename the page.',
              'Keep the address short. Shorter means larger squares and an easier scan.',
              'Use error correction M or Q for most print, and H when there is a logo or the code may be scuffed.',
              'Use dark modules on a light background, keep the blank border, and print at a size that suits the distance.',
              'Test the printed copy with two different phones, in the place where it will hang, before you print a batch.',
              'Keep the original file, and note what the code points to and when you made it. Check it again once a year.',
            ],
          },
          {
            type: 'p',
            text: 'QRCraftly makes static codes only. There is no account, nothing is stored on a server, and the code contains exactly what you typed, so there is nothing for us to switch off. It also means we cannot offer scan counts or change a destination after printing. [Static vs dynamic QR codes](/guides/static-vs-dynamic-qr-codes) is honest about what that costs. You can [make a code now](/) and check it before you print.',
          },
        ],
      },
    ],
    sources: [
      {
        label: 'Denso Wave (the inventor of QR Code), “Error correction feature”, qrcode.com',
        url: 'https://www.qrcode.com/en/about/error_correction.html',
        supports: 'The four error correction levels and the share of the code each can restore (about 7%, 15%, 25% and 30%).',
      },
      {
        label: 'Denso Wave, “Standardization”, qrcode.com',
        url: 'https://www.qrcode.com/en/about/standards.html',
        supports: 'QR Code is specified by ISO/IEC 18004, the standard that defines the symbol, its error correction and its quiet zone.',
      },
      {
        label: 'ISO/IEC 18004:2015, “Information technology: Automatic identification and data capture techniques: QR Code bar code symbology specification”',
        url: 'https://www.iso.org/standard/62021.html',
        supports: 'The quiet zone of four modules around the symbol.',
      },
    ],
    related: ['static-vs-dynamic-qr-codes', 'how-to-print-a-qr-code-that-scans'],
  },

  {
    slug: 'static-vs-dynamic-qr-codes',
    title: 'Static vs dynamic QR codes: what you give up and what you pay',
    shortTitle: 'Static vs dynamic QR codes',
    seoTitle: 'Static vs Dynamic QR Codes: What You Give Up | QRCraftly',
    description:
      'Static vs dynamic QR codes compared: editing, scan counts, cost, privacy and what happens if the provider disappears, with a way to keep both.',
    lead: 'Dynamic QR codes can be edited and counted, and static ones cannot. The price of that is a subscription, a dependency on one company and a record of every scan. This guide lays out both sides, including the parts that favour dynamic codes, so you can choose.',
    datePublished: '2026-10-03',
    dateModified: '2026-10-03',
    sections: [
      {
        id: 'short-answer',
        heading: 'The short answer',
        blocks: [
          {
            type: 'p',
            text: 'A static code holds your content itself. A dynamic code holds a short address on a provider’s server, which forwards every scan to your page. That one difference produces every other difference between them.',
          },
          {
            type: 'ul',
            items: [
              'Choose static when the destination will not change, when the code must outlive any company, or when the content is not a web address at all, such as Wi-Fi details or a contact card.',
              'Choose dynamic when you need to change the destination after printing, or need scan counts from the code itself, and you accept that you rent it.',
              'In between, you can get most of the editing without the rental: put a static code on an address you own, and change where that address leads.',
            ],
          },
        ],
      },
      {
        id: 'how-they-work',
        heading: 'How each one works',
        blocks: [
          {
            type: 'p',
            text: 'Scanning a static code: the phone reads the pattern, decodes your address and opens it. Nothing else is involved.',
          },
          {
            type: 'p',
            text: 'Scanning a dynamic code: the phone reads the pattern, decodes the provider’s short address and opens it. The provider’s server looks up where that code currently points, notes the scan, and sends the phone on to your page. The pattern never changes, but what sits behind it can.',
          },
          {
            type: 'p',
            text: 'The provider’s server is the whole point of a dynamic code, and it is also the single point of failure. If it is down, switched off or closed, the code leads nowhere.',
          },
        ],
      },
      {
        id: 'comparison',
        heading: 'Side by side',
        blocks: [
          {
            type: 'table',
            caption: 'Static and dynamic QR codes compared',
            head: ['Feature', 'Static', 'Dynamic'],
            rows: [
              ['What the code holds', 'Your content itself', 'A short address on the provider’s server'],
              ['Change the destination after printing', 'No. Print a new code', 'Yes, from the provider’s dashboard'],
              ['Scan counts from the code', 'None', 'Yes, as the provider records them'],
              ['Cost', 'Free to make with no strings', 'Usually a subscription or a trial that ends'],
              ['If the provider closes or you stop paying', 'Nothing happens', 'The code stops working'],
              ['Works for Wi-Fi, contact cards, plain text', 'Yes', 'No, because it can only redirect to a web address'],
              ['Pattern density', 'Denser if the address is long', 'Sparser, because the short address is short'],
              ['Who sees each scan', 'Only the page you point to', 'The provider as well'],
              ['Typical failure', 'The destination page moves', 'The subscription lapses'],
            ],
          },
        ],
      },
      {
        id: 'what-dynamic-gives',
        heading: 'What dynamic codes genuinely give you',
        blocks: [
          {
            type: 'p',
            text: 'They are not a trick, and for some jobs they are the right tool.',
          },
          {
            type: 'ul',
            items: [
              'Editing after printing. A campaign poster that runs for a year can point at this month’s offer, and a mistake in the destination is a setting, not a reprint.',
              'Scan counts without touching the destination. If you cannot add analytics to the page behind the code, the provider’s count is the only count you will get.',
              'A simpler pattern. The short address is short, so the code has fewer, larger squares. That helps for small or low-quality print.',
              'Several destinations from one code, or rules by device, time or place, where the provider offers them.',
            ],
          },
        ],
      },
      {
        id: 'what-dynamic-costs',
        heading: 'What dynamic codes cost',
        blocks: [
          {
            type: 'ul',
            items: [
              'A running fee. The code is yours to print but not yours to keep working. If you stop paying, or a trial ends, the provider can deactivate it, and every printed copy goes dead with it.',
              'Lock-in. The code holds the provider’s address, so you cannot move it to another provider. The only way out is to print new codes.',
              'A third party in every scan. For the counts to exist, each scan has to pass through the provider’s server, which sees at least the time, the device and the network address. Read their privacy terms before you use one for anything sensitive.',
              'A trust cost for your visitors. People are told to check where a code leads before they open it, and the U.S. Federal Trade Commission has warned about links hidden in QR codes. A short address on a service’s domain hides the real destination until after the scan, while an address on your own domain is easier to trust.',
              'Their reliability becomes yours. An outage, a policy change or a closure at the provider is an outage for your printed material.',
            ],
          },
          {
            type: 'note',
            title: 'Before you rent one',
            text: 'Ask what happens to your codes when a subscription ends, whether you can use your own domain for the short address, and whether you can export the destinations. If the short address is on your domain, you can leave. If it is not, you cannot.',
          },
        ],
      },
      {
        id: 'middle-path',
        heading: 'The middle path: your own redirect',
        blocks: [
          {
            type: 'p',
            text: 'You do not need a QR service to be able to change a destination. Make a static code that points at a short address on a domain you own, such as example.com/menu, and set that address to redirect to the real page. To change the destination, change the redirect. Most web hosts and static site platforms support redirect rules, and the code keeps working for as long as you keep the domain.',
          },
          {
            type: 'p',
            text: 'The same idea gives you counts without a vendor in the middle:',
          },
          {
            type: 'ul',
            items: [
              'Add a campaign tag to the destination address, then read the visits in the analytics you already run on that page.',
              'Use a different short address for each placement, such as example.com/poster and example.com/flyer, to tell placements apart.',
              'Count requests to the redirect itself in your host’s logs, if it keeps them.',
            ],
          },
          {
            type: 'p',
            text: 'It takes a little more setup than a dashboard, and the data stays with you.',
          },
        ],
      },
      {
        id: 'decide',
        heading: 'How to decide',
        blocks: [
          {
            type: 'table',
            caption: 'Which kind of code for which job',
            head: ['If your code is for…', 'Use'],
            rows: [
              ['A Wi-Fi network, contact card, plain text or other non-web content', 'Static (dynamic is not possible)'],
              ['A menu, flyer or business card that will be reprinted when it changes', 'Static'],
              ['Packaging, signage or a manual that has to last for years', 'Static, pointing at an address you own'],
              ['A campaign where the destination changes and you cannot add analytics to the page', 'Dynamic, on your own domain if the provider allows it'],
              ['A campaign where you can change the destination yourself', 'Static on your own redirect'],
            ],
          },
        ],
      },
      {
        id: 'qrcraftly',
        heading: 'Where QRCraftly stands',
        blocks: [
          {
            type: 'p',
            text: 'QRCraftly makes static codes only. There are no accounts, no servers that store your codes and no redirects, so a code you make here keeps working as long as the address inside it does, whether or not this site is still around. That is a deliberate decision, and it has a cost: we cannot give you scan counts or editable destinations. If you need those, use the middle path above or a dynamic provider whose terms you have read.',
          },
          {
            type: 'p',
            text: 'Wondering why a code you already have stopped working? [Why your QR code stopped working](/guides/why-qr-codes-stop-working) helps you tell a switched-off dynamic code from a dead page and a hard-to-read print. To make a static code, [start here](/).',
          },
        ],
      },
    ],
    sources: [
      {
        label: 'Denso Wave (the inventor of QR Code), “Types of QR Code” and “QR Code capacity”, qrcode.com',
        url: 'https://www.qrcode.com/en/about/version.html',
        supports: 'A longer encoded address needs a larger version, with more and smaller modules.',
      },
      {
        label: 'Denso Wave, “Standardization”, qrcode.com',
        url: 'https://www.qrcode.com/en/about/standards.html',
        supports: 'QR Code is specified by ISO/IEC 18004; a code holds data, and what a reader does with it is up to the reader.',
      },
      {
        label: 'U.S. Federal Trade Commission, “Scammers hide harmful links in QR codes to steal your information”, consumer.ftc.gov (December 2023)',
        url: 'https://consumer.ftc.gov/consumer-alerts/2023/12/scammers-hide-harmful-links-qr-codes-steal-your-information',
        supports: 'A QR code can lead anywhere, which is why a third-party address in the middle deserves scrutiny.',
      },
    ],
    related: ['why-qr-codes-stop-working', 'qr-code-without-subscription'],
  },
  {
    slug: 'how-to-print-a-qr-code-that-scans',
    title: 'How to print a QR code that scans every time',
    shortTitle: 'Printing a QR code that scans',
    seoTitle: 'How to Print a QR Code: Size, Margin, Contrast | QRCraftly',
    description:
      'The size, quiet zone, contrast and file format that decide whether a printed QR code scans, with a checklist you can run before you send anything to print.',
    lead: 'Most QR codes that fail in the real world fail because of how they were printed, not how they were made. Four things decide it: how big the code is, the empty margin around it, the contrast of the squares, and what the paper or surface does to them. Here is how to get each one right before you print a thousand copies.',
    datePublished: '2026-10-03',
    dateModified: '2026-10-16',
    sections: [
      {
        id: 'short-answer',
        heading: 'The short answer',
        blocks: [
          {
            type: 'ul',
            items: [
              'Keep a blank margin of at least four squares on every side. Cropping it is the most common mistake.',
              'Use dark squares on a light background, with strong contrast. Do not invert the colors.',
              'Print big enough for the distance it will be scanned from, and give a long address more room than a short one.',
              'Export a vector file (SVG or PDF) for print, and test a proof with more than one phone before the full run.',
            ],
          },
        ],
      },
      {
        id: 'size',
        heading: 'How big should it be?',
        blocks: [
          {
            type: 'p',
            text: 'Phones need to see each square as several pixels wide, so the right size depends on how far away the camera is and how many squares the code has. A code with a short address has fewer, larger squares and can be printed smaller. A long address needs more squares, so the same printed width makes each square smaller.',
          },
          {
            type: 'table',
            caption: 'Starting points for printed size',
            head: ['Where it will be scanned', 'Typical distance', 'Start with a code at least'],
            rows: [
              ['Business card, ticket, product label', 'Hand held, 10 to 30 cm', '2 cm wide'],
              ['Menu, flyer, poster at a counter', 'Arm’s length, up to 60 cm', '3 to 4 cm wide'],
              ['Shop window, signage, shelf', '1 to 2 m', '8 to 15 cm wide'],
              ['Billboard, vehicle, banner', 'Several meters', 'Roughly one tenth of the distance'],
            ],
          },
          {
            type: 'p',
            text: 'These are starting points, not guarantees, and a rough rule of thumb is a code about one tenth as wide as the scanning distance. Shorten the address if you need a smaller code: a short, plain address makes a simpler code than a long one with tracking parameters on the end. The [QR code size calculator](/qr-code-size-calculator) measures the code your own content makes and gives the width for any distance, in centimetres and inches.',
          },
        ],
      },
      {
        id: 'quiet-zone',
        heading: 'Leave the margin alone',
        blocks: [
          {
            type: 'p',
            text: 'The standard asks for a blank border, called the quiet zone, four squares wide on every side. It is how a reader finds where the code starts. Designers crop it because it looks like wasted space, and then the code scans only sometimes. If your code sits on a colored panel or an image, the margin must be a plain light area, not a busy photo. If you are unsure whether a design leaves enough room, check a photo of it with the [QR code checker](/qr-code-checker).',
          },
        ],
      },
      {
        id: 'contrast',
        heading: 'Contrast and color',
        blocks: [
          {
            type: 'p',
            text: 'Dark squares on a light background is the arrangement every reader supports. Light squares on a dark background (an inverted code) work in some apps and fail in others, so avoid it for anything public. Color is fine as long as the dark color is much darker than the light one. Yellow on white, pale gray on white and red on black are common ways to lose it. Printing can reduce contrast further, because ink spreads and paper is never as white as a screen.',
          },
          {
            type: 'note',
            title: 'Test the colors before you print',
            text: 'The [QR code checker](/qr-code-checker) reads a picture of your code after simulating a poor print, with blur and noise added, and tells you whether it still scans. Use it on the exact colors you plan to use.',
          },
        ],
      },
      {
        id: 'surface',
        heading: 'Paper, curves and glare',
        blocks: [
          {
            type: 'ul',
            items: [
              'Matte paper scans better than glossy, which throws glare back at the camera.',
              'Curved surfaces such as bottles and mugs distort the squares. Print larger and keep the code on the flattest part.',
              'Embossed, engraved or textured finishes break up the squares. Test a sample of the real material.',
              'Folds, creases and seams through the code damage it. Keep the code clear of them.',
              'Keep the code away from edges that will be trimmed, and allow for the cutter’s tolerance.',
            ],
          },
        ],
      },
      {
        id: 'file',
        heading: 'Export the right file',
        blocks: [
          {
            type: 'p',
            text: 'A QR code is a grid of squares, so it stays sharp at any size only as a vector file. Export SVG or PDF for anything printed, and send the printer that file, not a screenshot. If you must use PNG, export it large and at a size where each square is a whole number of pixels, so the edges stay crisp. Do not let a layout tool smooth or resample the image.',
          },
        ],
      },
      {
        id: 'checklist',
        heading: 'Before you print',
        blocks: [
          {
            type: 'ol',
            items: [
              'Scan the final artwork on screen with two different phones.',
              'Print one proof on the real material at the real size and scan it from the real distance.',
              'Check it in poor light and at a slight angle.',
              'Write the address next to the code as plain text, so a person can type it if the code fails.',
              'Keep the file you printed from. A static code cannot be regenerated differently by accident, but you will want the original.',
            ],
          },
          {
            type: 'p',
            text: 'Still unsure about a design? Drop a photo of the proof on the [QR code checker](/qr-code-checker). If your code carries a logo, read [error correction explained](/guides/qr-code-error-correction-explained) first, because a logo uses up some of the code’s safety margin.',
          },
        ],
      },
    ],
    sources: [
      {
        label: 'Denso Wave (the inventor of QR Code), “Standardization”, qrcode.com',
        url: 'https://www.qrcode.com/en/about/standards.html',
        supports: 'QR Code is specified by ISO/IEC 18004, which also defines the quiet zone.',
      },
      {
        label: 'ISO/IEC 18004:2015, “Information technology — Automatic identification and data capture techniques — QR Code bar code symbology specification”',
        url: 'https://www.iso.org/standard/62021.html',
        supports: 'The specification of the symbol, including its quiet zone and contrast requirements.',
      },
    ],
    related: ['qr-code-error-correction-explained', 'why-qr-codes-stop-working'],
  },
  {
    slug: 'qr-code-error-correction-explained',
    title: 'QR code error correction explained: L, M, Q and H',
    shortTitle: 'Error correction explained',
    seoTitle: 'QR Code Error Correction Levels (L, M, Q, H) | QRCraftly',
    description:
      'What the four QR code error correction levels recover, what each costs in size, and how to choose one when you add a logo or print on a rough surface.',
    lead: 'Every QR code carries spare data so a reader can rebuild what a scratch, a smudge or a logo has covered. You choose how much spare data there is, from level L to level H. This guide explains what each level recovers, what it costs, and how to pick one.',
    datePublished: '2026-10-03',
    dateModified: '2026-10-03',
    sections: [
      {
        id: 'short-answer',
        heading: 'The short answer',
        blocks: [
          {
            type: 'p',
            text: 'There are four levels: L, M, Q and H. Each one adds more spare data, so it can recover from more damage, and each one makes the code bigger for the same content. Use M for most printed codes, H when the code carries a logo or will be scuffed, and L only for short-lived codes on a screen.',
          },
        ],
      },
      {
        id: 'levels',
        heading: 'What each level recovers',
        blocks: [
          {
            type: 'table',
            caption: 'The four error correction levels',
            head: ['Level', 'Can restore up to', 'Good for'],
            rows: [
              ['L (low)', 'About 7% of the code’s data', 'Codes shown on a screen, clean surfaces, the smallest possible code'],
              ['M (medium)', 'About 15%', 'Most printed codes. A sensible default'],
              ['Q (quartile)', 'About 25%', 'Codes that may get dirty or scuffed'],
              ['H (high)', 'About 30%', 'Codes with a logo, rough surfaces, heavy wear'],
            ],
          },
          {
            type: 'p',
            text: 'These percentages describe the share of the code’s data that can be rebuilt, and the share of the printed area that can be lost is not the same thing. Damage to the three large corner squares, or to the thin timing lines between them, can stop a code reading even when the total damage is small, because a reader needs those to find and straighten the code.',
          },
        ],
      },
      {
        id: 'how',
        heading: 'How it works, briefly',
        blocks: [
          {
            type: 'p',
            text: 'The code’s data is split into blocks, and extra blocks of check data are added using a method called Reed–Solomon error correction, which is also used in CDs and satellite links. If some squares are unreadable, the reader uses the check data to work out what they should have been. The more check data, the more it can fix, and the more space the check data takes.',
          },
        ],
      },
      {
        id: 'cost',
        heading: 'What it costs',
        blocks: [
          {
            type: 'p',
            text: 'Spare data takes room. For the same content, a higher level needs a larger grid with more, smaller squares. A larger grid printed at the same width means smaller squares, which are harder to read from a distance. So a higher level is not always safer: past a point it trades damage tolerance for legibility.',
          },
          {
            type: 'note',
            title: 'A practical rule',
            text: 'If your address is long, going up a level can push the code into a much denser grid. Shorten the address first, then pick the level. A short address at level M is usually easier to scan than a long one at level H.',
          },
        ],
      },
      {
        id: 'logos',
        heading: 'Adding a logo',
        blocks: [
          {
            type: 'p',
            text: 'A logo in the middle covers part of the code, and the reader treats that part as damage. That is why codes with logos should use level Q or H, and why the logo should stay small and sit in the center, away from the corner squares. There is no safe percentage that works for every code, because it depends on the content and the grid, so test the result. QRCraftly’s [logo QR code](/qr-code-with-logo) page sets a high level for you and shows a scan badge that warns you when the logo covers too much, and the [QR code checker](/qr-code-checker) tests a finished picture.',
          },
        ],
      },
      {
        id: 'choose',
        heading: 'Choosing a level',
        blocks: [
          {
            type: 'ul',
            items: [
              'Plain code on a clean, flat surface: M.',
              'Code with a logo, or on packaging, outdoor signage or anything handled a lot: H.',
              'Code that will be scanned straight off a screen, where a smaller grid helps: L or M.',
              'Unsure: M, then test a printed proof as described in [printing a QR code that scans](/guides/how-to-print-a-qr-code-that-scans).',
            ],
          },
        ],
      },
    ],
    sources: [
      {
        label: 'Denso Wave (the inventor of QR Code), “Error correction feature”, qrcode.com',
        url: 'https://www.qrcode.com/en/about/error_correction.html',
        supports: 'The four levels and the approximate share of data each can restore (about 7%, 15%, 25% and 30%).',
      },
      {
        label: 'ISO/IEC 18004:2015, “Information technology — Automatic identification and data capture techniques — QR Code bar code symbology specification”',
        url: 'https://www.iso.org/standard/62021.html',
        supports: 'The specification of the symbol, including the error correction levels and Reed–Solomon coding.',
      },
    ],
    related: ['how-to-print-a-qr-code-that-scans', 'why-qr-codes-stop-working'],
  },
  {
    slug: 'qr-code-scams-quishing',
    title: 'QR code scams (quishing): how they work and how to stay safe',
    shortTitle: 'QR code scams (quishing)',
    seoTitle: 'QR Code Scams (Quishing): How to Stay Safe | QRCraftly',
    description:
      'How fake QR codes steal logins and payments, the warning signs to look for before you scan, and what to do if you have already scanned one.',
    lead: 'A QR code hides its destination, which is exactly what scammers rely on. Quishing is phishing done with a QR code: a fake code takes you to a fake page that asks for a password or a payment. This guide covers how it works, how to spot it and what to do.',
    datePublished: '2026-10-03',
    dateModified: '2026-10-03',
    sections: [
      {
        id: 'short-answer',
        heading: 'The short answer',
        blocks: [
          {
            type: 'p',
            text: 'A QR code is not dangerous in itself, because it only holds text, usually a web address. The risk is where it sends you and what you do when you get there. Before you scan a code in public, check that it has not been stuck over another one. After scanning, read the address your phone shows before you open it. Never enter a password or card number on a page you reached from a code you did not expect.',
          },
        ],
      },
      {
        id: 'how',
        heading: 'How quishing works',
        blocks: [
          {
            type: 'ul',
            items: [
              'Sticker overlays: a fake code stuck over a real one on a parking meter, a restaurant table, a poster or a charging station.',
              'Emails and letters: a message that says your account, parcel or payment has a problem and asks you to scan a code to fix it. Because the link is hidden in a picture, some email filters cannot read it.',
              'Fake codes on flyers and posters that promise a prize, a discount or a free download.',
              'Codes that open a payment page or ask you to log in to an account, copying a company’s real login screen.',
            ],
          },
          {
            type: 'p',
            text: 'The pattern is always the same: a reason to hurry, a code instead of a link, and a page that asks for something valuable.',
          },
        ],
      },
      {
        id: 'signs',
        heading: 'Warning signs',
        blocks: [
          {
            type: 'ul',
            items: [
              'The code looks like a sticker placed over something else, or its edges are lifting.',
              'The address your phone shows does not match the business, or is a long string of letters and numbers, or uses a lookalike spelling.',
              'You were not expecting it: an unprompted message with a deadline or a threat.',
              'The page asks for your password, a one-time code, your card details or your bank login straight away.',
              'It asks you to install an app that is not from your phone’s official store.',
            ],
          },
        ],
      },
      {
        id: 'protect',
        heading: 'How to protect yourself',
        blocks: [
          {
            type: 'ol',
            items: [
              'Look at the physical code first. If it is a sticker over another code, do not use it.',
              'Scan, then read the address before you tap it. Your phone camera shows it. The [QR code scanner](/qr-code-scanner) on this site shows you what the code holds and leaves opening any link to you.',
              'Go to the company’s own website or app by typing the address yourself, rather than using a code, for anything involving money or accounts.',
              'Do not log in or pay from a page you reached through an unexpected code.',
              'Turn on two-factor authentication for important accounts, so a stolen password alone is not enough.',
              'If an email asks you to scan a code, contact the sender through a number or address you already know.',
            ],
          },
        ],
      },
      {
        id: 'already',
        heading: 'If you have already scanned one',
        blocks: [
          {
            type: 'p',
            text: 'Scanning alone is usually harmless. What matters is what you did next. If you entered a password, change it on the real site at once, and anywhere else you used it. If you entered card details, call your bank using the number on your card. If you installed something, remove it and run your phone’s security check. You can report the scam to your national consumer protection agency. In the United States, that is the FTC at ReportFraud.ftc.gov.',
          },
        ],
      },
      {
        id: 'makers',
        heading: 'If you make QR codes',
        blocks: [
          {
            type: 'p',
            text: 'You can make your own codes easier to trust. Print the web address in plain text under the code so people can see where it goes. Point the code at a domain you own, so there is no third-party address in the middle. Keep codes in places you control, and check them from time to time for stickers placed over them. A static code made with QRCraftly holds your address itself, so there is no middleman server that could be switched or compromised. [Why a code stops working](/guides/why-qr-codes-stop-working) explains why that matters.',
          },
        ],
      },
    ],
    sources: [
      {
        label: 'U.S. Federal Trade Commission, “Scammers hide harmful links in QR codes to steal your information”, consumer.ftc.gov (December 2023)',
        url: 'https://consumer.ftc.gov/consumer-alerts/2023/12/scammers-hide-harmful-links-qr-codes-steal-your-information',
        supports: 'Fake codes can lead to harmful pages; check the address before opening and be wary of codes in unexpected messages.',
      },
      {
        label: 'FBI Internet Crime Complaint Center, “Cyber Criminals Tampering with QR Codes to Steal Victim Funds”, ic3.gov (January 2022)',
        url: 'https://www.ic3.gov/PSA/2022/PSA220118',
        supports: 'Criminals replace legitimate codes with tampered ones that lead to credential and payment theft.',
      },
    ],
    related: ['static-vs-dynamic-qr-codes', 'why-qr-codes-stop-working'],
  },
  {
    slug: 'qr-code-without-subscription',
    title: 'How to make a QR code without a subscription',
    shortTitle: 'QR codes without a subscription',
    seoTitle: 'QR Code Without a Subscription: What to Check | QRCraftly',
    description:
      'Need a QR code without a subscription? Static codes need no plan and keep working while their link does. Here is how to check a generator first.',
    lead: 'A static QR code needs no subscription. It holds your address directly, so it keeps working for as long as that page does. Subscriptions usually come from dynamic codes, which route every scan through the vendor’s own server.',
    datePublished: '2026-10-16',
    dateModified: '2026-10-16',
    sections: [
      {
        id: 'short-answer',
        heading: 'The short answer',
        blocks: [
          {
            type: 'p',
            text: 'Yes. A static QR code holds your web address, or other content, directly in its pattern. Nobody has to be paid for it to keep working, and no service has to forward each scan. It works for as long as the destination it points to stays up.',
          },
          {
            type: 'p',
            text: 'The subscription problem comes from a different type of code. A dynamic code holds a short address on the generator’s own domain, and the generator forwards each scan to your page. If the plan lapses, that forwarding can stop. So when a generator asks for a monthly fee, the first question is whether the code it makes is static or dynamic.',
          },
        ],
      },
      {
        id: 'why-subscriptions',
        heading: 'Why some generators charge monthly',
        blocks: [
          {
            type: 'p',
            text: 'Dynamic codes cost the generator something to run, and they give you features that static codes cannot. Each scan passes through the generator’s servers, where it can be counted, and the destination can be changed from a dashboard at any time. Those features are the reason a subscription exists, and they are genuinely useful. If you need scan counts, or you need to change the destination after printing, a dynamic code may be the right tool.',
          },
          {
            type: 'ul',
            items: [
              'Scan counts. The generator records each scan, so you can see how many people used the code and when.',
              'A vendor domain. The code points to a short address on the generator’s domain, which is what lets you change where it leads.',
              'An editable destination. You can point the same printed code at a new page from the dashboard, without printing again.',
            ],
          },
          {
            type: 'p',
            text: 'Static codes give up those three things. They cannot tell you how many people scanned them, and once printed, the destination is fixed. If the address changes, the code has to be replaced. A workaround is to point the static code at an address on your own domain, then change where that address leads. Scans are still not counted, but you keep the ability to redirect without a code provider in the middle. [Static vs dynamic QR codes](/guides/static-vs-dynamic-qr-codes) sets out the trade-offs in more detail.',
          },
        ],
      },
      {
        id: 'what-vendors-say',
        heading: 'What some generators say',
        blocks: [
          {
            type: 'table',
            caption: 'What some generators say happens when a trial or plan ends (checked 16 October 2026)',
            head: ['Generator', 'Dynamic codes when the trial or plan ends', 'Static codes'],
            rows: [
              [
                'Uniqode (formerly Beaconstac)',
                '“Once your free trial expires, any dynamic QR Codes you created will become inactive.”',
                '“static QR Codes are permanent, they will continue to work”',
              ],
              [
                'Scanova',
                'Dynamic codes “will stop working once the free trial ends”',
                '“work forever without any ongoing cost”',
              ],
              [
                'qr.io',
                '“Dynamic QR Codes will be paused” when the 7-day trial ends, and reactivated on upgrade',
                '“do not expire and will work forever”',
              ],
              [
                'QR TIGER',
                '“If your plan expires, it will stop working.”',
                '“Our static QR codes do not expire.”',
              ],
              [
                'ME-QR',
                'Codes keep working after a subscription ends, but “ads will be shown again” after a scan',
                '“our QR codes do not have a time limit”, though a code made without an account “will be blocked and removed unless scanned within 365 days”',
              ],
            ],
          },
          {
            type: 'p',
            text: 'These are each company’s own words from its own pages. They change, so read the current page before you rely on it. The links are in the sources below.',
          },
        ],
      },
      {
        id: 'checklist',
        heading: 'Before you sign up: five questions to ask',
        blocks: [
          {
            type: 'ol',
            items: [
              'Is the code static or dynamic? If the generator does not say, assume it is dynamic until you have checked.',
              'Does the code hold my address, or the vendor’s short link? Make a test code and scan it with your phone. If the address shown is on the generator’s domain, it is dynamic.',
              'What happens to the code if I stop paying or the trial ends? Look for the answer in the terms or the FAQ, not only on the sales page.',
              'Do I need an account to download it? If you must sign up before you can get the file, check whether the download is free.',
              'Is there a scan limit? Some plans cap the number of scans or codes, so check the limit before you print a large run.',
            ],
          },
        ],
      },
      {
        id: 'make-one',
        heading: 'How to make one without a subscription',
        blocks: [
          {
            type: 'p',
            text: 'QRCraftly makes static codes only, so the code you make here holds your address and nothing else. There is no account to create, no subscription and no ads. The code is made in your browser, and nothing you type is uploaded.',
          },
          {
            type: 'p',
            text: 'To make one, use the [free QR code generator](/). For a plain address, the [static QR code generator](/static-qr-code-generator) is the direct route. If a print shop needs a vector file, the [SVG download](/svg-qr-code) gives you one that scales without blur. For a restaurant, the [menu QR code](/menu-qr-code) page covers table cards and menu links.',
          },
          {
            type: 'p',
            text: 'Before you print in quantity, scan a printed proof with a phone and run a photo of it through the [QR code checker](/qr-code-checker). The checker shows what the code holds, so you can confirm it points at the address you meant.',
          },
        ],
      },
      {
        id: 'already-stuck',
        heading: 'If you already have a dynamic code that stopped',
        blocks: [
          {
            type: 'p',
            text: 'First check the account. Reactivating the subscription usually brings back the same printed code, because the code itself never changed. If you cannot reactivate, or the provider has closed, the printed code cannot be repaired. Make a new static code that points at your page, and replace the old one wherever it appears.',
          },
          {
            type: 'p',
            text: 'For the full list of reasons a code stops working, read [Why QR codes stop working](/guides/why-qr-codes-stop-working).',
          },
        ],
      },
    ],
    sources: [
      {
        label: 'Uniqode, Pricing and FAQ',
        url: 'https://www.uniqode.com/pricing',
        supports: 'The trial-expiry and static-code wording quoted in the table above.',
      },
      {
        label: 'Scanova, Pricing',
        url: 'https://www.scanova.io/pricing',
        supports: 'The trial-end and static-code wording quoted in the table above.',
      },
      {
        label: 'qr.io, Help: what happens to my QR codes and account when the free trial expires',
        url: 'https://help.qr.io/en/articles/6977506-what-happens-to-my-qr-codes-and-account-when-the-free-trial-expires',
        supports: 'The pause-and-reactivate wording for dynamic codes, and the static-code wording quoted in the table above.',
      },
      {
        label: 'QR TIGER, Homepage',
        url: 'https://www.qrcode-tiger.com/',
        supports: 'The plan-expiry and static-code wording quoted in the table above.',
      },
      {
        label: 'ME-QR, FAQ',
        url: 'https://me-qr.com/faq',
        supports: 'The post-subscription, time-limit and 365-day inactivity wording quoted in the table above.',
      },
    ],
    related: ['static-vs-dynamic-qr-codes', 'why-qr-codes-stop-working', 'how-to-print-a-qr-code-that-scans'],
  },
];

/**
 * Looks up a guide by its route segment.
 * @param slug - The guide's slug.
 * @returns The guide, or undefined.
 */
export function getGuide(slug: string): Guide | undefined {
  return guides.find((guide) => guide.slug === slug);
}

/**
 * Estimates the reading time of a guide at 220 words a minute.
 * @param guide - The guide.
 * @returns Whole minutes, at least 1.
 */
export function readingMinutes(guide: Guide): number {
  const words = [guide.lead, ...guide.sections.flatMap((section) => section.blocks.map(blockText))].join(' ').trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 220));
}

function blockText(block: GuideBlock): string {
  switch (block.type) {
    case 'p':
      return block.text;
    case 'note':
      return `${block.title} ${block.text}`;
    case 'table':
      return [block.caption, ...block.head, ...block.rows.flat()].join(' ');
    default:
      return block.items.join(' ');
  }
}
