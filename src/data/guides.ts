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
  | { type: 'note'; title: string; text: string }
  | { type: 'code'; code: string; language?: string; title?: string };

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

/** A link to another guide. */
export interface GuideLink {
  slug: string;
  title: string;
}

/**
 * What a guide page renders, built at prerender time so the page ships only its own article
 * (#1597). Browser code imports only this type.
 */
export interface GuideArticleContent {
  guide: Guide;
  /** The byline. */
  author: string;
  /** Reading time in whole minutes. */
  minutes: number;
  /** The guides to link at the end, in the order the guide lists them. */
  related: GuideLink[];
}

/** One entry of the `/guides` hub. */
export interface GuideSummary extends GuideLink {
  description: string;
  dateModified: string;
  minutes: number;
}

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
            text: 'To see how your code copes, run it through the [QR code checker](/qr-code-checker), which simulates a blurry print, or damage it on purpose in the [QR Arcade](/arcade).',
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
    dateModified: '2026-11-19',
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
              'Export a vector file (SVG, EPS or PDF) for print, switch Color Space to CMYK for commercial four-color presses when exporting EPS or PDF, and test a proof with more than one phone before the full run.',
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
            text: 'The standard asks for a blank border, called the quiet zone, four squares wide on every side. It is how a reader finds where the code starts. Under Advanced Mode in the generator, Quiet Zone Margin (modules) adjusts from 2 to 10 modules (default 4). Keep at least 4 modules for printed material, and reserve 2 or 3 modules for tight screen layouts you have tested yourself. Designers often crop the margin because it looks like wasted space, and then the code scans only sometimes. If your code sits on a colored panel or an image, the margin must be a plain light area, not a busy photo. If you are unsure whether a design leaves enough room, check a photo of it with the [QR code checker](/qr-code-checker).',
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
            text: 'A QR code is a grid of squares, so it stays sharp at any size only as a vector file. Export SVG, EPS or PDF for anything printed, and send the printer that file, not a screenshot. When you choose EPS or PDF in Download options, you can switch Color Space from RGB to CMYK for commercial four-color process printing. Note that PDF and EPS exports always substitute Helvetica for Frame & CTA Badge fonts so print shops never hit missing-font errors, and embed uploaded logos as raster images. See [export formats and phone wallets](/guides/qr-code-export-and-wallet-options) for every download setting. If you must use PNG, export it large (2048 px or 4096 px) and do not let a layout tool smooth or resample the image.',
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
    related: ['qr-code-export-and-wallet-options', 'qr-code-error-correction-explained', 'why-qr-codes-stop-working'],
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
  {
    slug: 'developer-integration-guide',
    title: 'Public developer integration guide: programmatic recipes and worker contracts',
    shortTitle: 'Developer integration guide',
    seoTitle: 'Developer Integration Guide & Architecture Manual | QRCraftly',
    description:
      'Programmatic integration recipes and Web Worker message contracts for embedding QRCraftly QR matrix generation, contrast audits and vector export.',
    lead: 'QRCraftly is engineered as a set of modular client-side packages designed for self-serve integration in custom web applications. This guide provides runnable TypeScript recipes, typed Web Worker message protocols, and architectural boundary guidelines for embedding our core QR and optical transfer modules.',
    datePublished: '2026-11-16',
    dateModified: '2026-11-16',
    sections: [
      {
        id: 'architecture-boundaries',
        heading: 'Architecture and module boundary rules',
        blocks: [
          {
            type: 'p',
            text: 'QRCraftly runs entirely on the client: matrix calculation, contrast audits, SVG generation and optical transfers execute inside the browser with zero server roundtrips. Core capabilities are split into standalone deep modules under `src/packages/`.',
          },
          {
            type: 'ul',
            items: [
              'Entry-point boundary: External application code may only import root entry points (`@/packages/<name>` or `@/packages/<name>/<entry>`), never internal `lib/` files.',
              'No app layers in packages: Deep modules never import React context, hooks or UI components; dependencies and callbacks are injected from the caller.',
              'Shared leaf package: Common utility types, checksums and formatting reside in `@/packages/core`, which imports nothing else in `src/`.',
              'Boundary verification: Automated boundary rules are verified with `pnpm run lint:boundaries`.',
            ],
          },
          {
            type: 'note',
            title: 'Zero-transit privacy model',
            text: 'All QR payloads, contact records, encryption keys and image buffers remain strictly in volatile client memory. Packages never make unsolicited external network calls.',
          },
        ],
      },
      {
        id: 'matrix-generation',
        heading: 'QR matrix generation recipe',
        blocks: [
          {
            type: 'p',
            text: 'The `@/packages/qr-matrix` module owns the single canonical implementation that transforms a configuration into a 2D boolean module matrix. The WebAssembly encoder (`qr-encode.wasm`) is loaded once asynchronously via `loadQrEncoder`, after which matrix generation runs synchronously.',
          },
          {
            type: 'code',
            language: 'typescript',
            title: 'matrix-generation.ts',
            code: `import { loadQrEncoder, buildMatrix, resolveEncodedValue, type MatrixSource } from '@/packages/qr-matrix';
import { QRType, type QRModules } from '@/packages/core/types';

// 1. Load the WebAssembly QR encoder instance once
const encoder = await loadQrEncoder();

// 2. Define the matrix source payload and error correction level
const source: MatrixSource = {
  type: QRType.URL,
  value: 'https://qrcraftly.com',
  errorCorrectionLevel: 'M',
};

// 3. Normalize payload format (e.g. ensuring URL protocols)
const resolvedPayload = resolveEncodedValue(source);
console.log('Encoded payload:', resolvedPayload);

// 4. Build the QR module matrix synchronously
const matrix: QRModules = buildMatrix(source, encoder);
console.log(\`Matrix size: \${matrix.size}x\${matrix.size} modules\`);`,
          },
          {
            type: 'p',
            text: 'To avoid blocking the main UI thread during intensive generation or batch operations, spawn the dedicated background worker using `createMatrixWorker()`.',
          },
          {
            type: 'code',
            language: 'typescript',
            title: 'matrix-worker.ts',
            code: `import { createMatrixWorker } from '@/packages/qr-matrix';
import { QRType, type QRConfig } from '@/packages/core/types';
import { DEFAULT_CONFIG } from '@/packages/core/config';

// Spawn background worker to compute matrix off-thread
const worker = createMatrixWorker();

if (worker) {
  worker.onmessage = (event: MessageEvent) => {
    const { status, matrix, size } = event.data;
    if (status === 'success') {
      console.log(\`Background matrix generated: \${size}x\${size}\`);
    }
  };

  const config: QRConfig = {
    ...DEFAULT_CONFIG,
    type: QRType.URL,
    value: 'https://qrcraftly.com',
    errorCorrectionLevel: 'M',
  } as QRConfig;

  worker.postMessage({ config, sequenceId: 1 });
}`,
          },
        ],
      },
      {
        id: 'scannability-worker',
        heading: 'Off-thread scannability audits and Web Worker protocols',
        blocks: [
          {
            type: 'p',
            text: 'The `@/packages/scannability` package performs real-time scannability checks, contrast validation, and optical decode simulation off the main thread. Callers communicate with the background worker using strictly typed request and response contracts.',
          },
          {
            type: 'table',
            caption: 'Scannability Worker contract properties',
            head: ['Contract Field', 'Type', 'Description'],
            rows: [
              ['imageData', '{ data: Uint8ClampedArray; width?: number; height?: number }', 'Raw pixel buffer from canvas or bitmap extraction'],
              ['imageBitmap', 'ImageBitmap', 'Transferred ImageBitmap handle for zero-copy offscreen decoding'],
              ['buffer', 'ArrayBuffer', 'Transferable buffer returned back to main thread for recycling'],
              ['moduleCount', 'number', 'QR matrix grid dimension including quiet zone modules'],
              ['quietZoneModules', 'number', 'Margin padding modules (minimum 2, default 4)'],
              ['sequenceId', 'number', 'Monotonically increasing request identifier for frame ordering'],
            ],
          },
          {
            type: 'code',
            language: 'typescript',
            title: 'scannability-worker.ts',
            code: `import {
  createScannabilityWorker,
  assertWorkerRequest,
  assertWorkerResponse,
  isWorkerResponse,
  type WorkerRequest,
} from '@/packages/scannability';

// 1. Spawn the dedicated scannability background worker
const worker = createScannabilityWorker();

if (worker) {
  worker.onmessage = (e: MessageEvent<unknown>) => {
    if (isWorkerResponse(e.data)) {
      if ('dropped' in e.data && e.data.dropped) {
        console.warn('Scan frame was superseded by a newer request');
      } else if ('retryWithImageData' in e.data && e.data.retryWithImageData) {
        console.info('Worker requested raw pixel buffer fallback');
      } else if ('success' in e.data) {
        assertWorkerResponse(e.data);
        console.log(\`Verdict: success=\${e.data.success}, physicalReady=\${e.data.physicalReady}\`);
      }
    }
  };

  // 2. Prepare pixel buffer and construct request
  const width = 256;
  const height = 256;
  const pixels = new Uint8ClampedArray(width * height * 4);

  const request: WorkerRequest = {
    imageData: { data: pixels, width, height },
    width,
    height,
    sequenceId: 1,
    configId: 'cfg-sample',
    moduleCount: 29,
    quietZoneModules: 4,
    buffer: pixels.buffer,
  };

  // 3. Verify request conforms to protocol and transfer buffer zero-copy
  assertWorkerRequest(request);
  worker.postMessage(request, [pixels.buffer]);
}`,
          },
        ],
      },
      {
        id: 'vector-export',
        heading: 'Vector SVG export recipe',
        blocks: [
          {
            type: 'p',
            text: 'The `@/packages/qr-export` package provides `generateQRSvg` to produce resolution-independent, self-contained SVG files. Custom logos and mosaic images are automatically resolved and embedded as inline base64 data URLs, eliminating external network dependencies.',
          },
          {
            type: 'code',
            language: 'typescript',
            title: 'vector-export.ts',
            code: `import { generateQRSvg, PayloadRejectedError } from '@/packages/qr-export';
import { QRType, type QRConfig } from '@/packages/core/types';
import { DEFAULT_CONFIG } from '@/packages/core/config';

const config: QRConfig = {
  ...DEFAULT_CONFIG,
  type: QRType.URL,
  value: 'https://qrcraftly.com',
  errorCorrectionLevel: 'H',
} as QRConfig;

try {
  // Generate self-contained SVG XML markup
  const svgContent: string = await generateQRSvg(config, {
    onLogoOmitted: () => console.warn('Logo asset unavailable, continuing export without logo'),
  });

  console.log('SVG markup generated, byte length:', svgContent.length);
} catch (error) {
  if (error instanceof PayloadRejectedError) {
    console.error('Payload rejected due to security policy:', error.violations);
  } else {
    throw error;
  }
}`,
          },
        ],
      },
      {
        id: 'optical-transfer',
        heading: 'Headless air-gapped optical transfer contracts',
        blocks: [
          {
            type: 'p',
            text: 'The `@/packages/optical-transfer` module powers one-way air-gapped optical transmission using animated QR code streams framed with Luby Transform rateless fountain codes (Prism session protocol). External integrators can plan transmission capacity and initialize sessions headlessly.',
          },
          {
            type: 'code',
            language: 'typescript',
            title: 'optical-transfer.ts',
            code: `import {
  createPrismSession,
  estimateTransferFrames,
  TRANSFER_DENSITY_PROFILES,
} from '@/packages/optical-transfer';

// 1. Estimate transmission overhead and symbol parameters
const payloadBytes = new Uint8Array(64 * 1024); // 64 KB payload
const estimate = estimateTransferFrames(payloadBytes.length, 'balanced', 'lt');
console.log(\`Estimated source symbols K=\${estimate.k}, total frames=\${estimate.frames}\`);

// 2. Initialize a sender session
const session = await createPrismSession(payloadBytes, {
  fileName: 'transfer-sample.bin',
  mimeType: 'application/octet-stream',
  maxVersion: TRANSFER_DENSITY_PROFILES.balanced.maxVersion,
  errorCorrectionLevel: TRANSFER_DENSITY_PROFILES.balanced.errorCorrectionLevel,
});

console.log(\`Prism session ready, symbol size: \${session.symbolSize} bytes\`);`,
          },
        ],
      },
      {
        id: 'boundary-verification',
        heading: 'Boundary verification and CI guardrails',
        blocks: [
          {
            type: 'p',
            text: 'All QRCraftly packages adhere to the deep module architecture verified by `scripts/check_boundaries.js`. External integrators adopting these patterns should verify package imports and prevent leaking private library internals.',
          },
          {
            type: 'code',
            language: 'bash',
            title: 'terminal',
            code: `pnpm run lint:boundaries`,
          },
        ],
      },
    ],
    sources: [
      {
        label: 'Denso Wave (the inventor of QR Code), “Standardization”, qrcode.com',
        url: 'https://www.qrcode.com/en/about/standards.html',
        supports: 'QR Code is specified by ISO/IEC 18004, the standard defining symbol geometry and error correction.',
      },
      {
        label: 'QRCraftly Scalability Analysis & Capacity Planning, docs/public/SCALING.md',
        url: 'https://github.com/fderuiter/QRCraftly-web/blob/HEAD/docs/public/SCALING.md',
        supports: 'Client-side Web Worker architecture, watchdog timers, and transferable ArrayBuffer zero-copy pipelines.',
      },
    ],
    related: ['how-to-print-a-qr-code-that-scans', 'qr-code-error-correction-explained', 'static-vs-dynamic-qr-codes'],
  },
  {
    slug: 'qr-code-customization-parameters',
    title: 'QR code customization guide: templates, patterns, colors, frames, logos and mosaic',
    shortTitle: 'QR code customization guide',
    seoTitle: 'QR Code Customization Guide: Styles, Colors & Logos | QRCraftly',
    description:
      'Reference for QR code visual styling: templates, 8 patterns, gradients, 4.5:1 contrast, layouts, borders, CTA frames, logo width caps and Mosaic.',
    lead: 'Every control under Customize Appearance changes how a camera reads your QR code. This reference covers every visual styling setting in the studio, including brand templates, the live Style Gallery, module patterns, locator eye shapes, gradients, 4.5:1 contrast rules, export layouts, borders, CTA frames, center logo cutouts, Mosaic image tiling, and quiet zone margins.',
    datePublished: '2026-11-16',
    dateModified: '2026-11-19',
    sections: [
      {
        id: 'overview',
        heading: 'Visual customization and scannability limits',
        blocks: [
          {
            type: 'p',
            text: 'Every QR code is built on a square module matrix and three corner finder patterns. Styling alters module shapes, colors, surrounding frames, or overlaid images while keeping the encoded binary data intact.',
          },
          {
            type: 'p',
            text: 'To keep styled codes readable across phone cameras and dedicated scanners, follow four core boundaries:',
          },
          {
            type: 'ol',
            items: [
              'Keep at least a 4.5:1 contrast ratio between dark foreground modules (including both gradient stops and custom eye colors) and the background surface.',
              'Keep embedded center logos within the 10% to 30% side-width range (up to 9% of the unpadded matrix area), paired with Error Correction Level H.',
              'Pick crisp module patterns for small prints or long-distance signs, and save decorative patterns for larger, high-contrast prints.',
              'Keep at least a 4-module quiet zone for printed codes, and choose vector or wallet outputs using the [export formats and phone wallets](/guides/qr-code-export-and-wallet-options) reference.',
            ],
          },
        ],
      },
      {
        id: 'templates-and-style-gallery',
        heading: 'Brand templates and the live Style Gallery',
        blocks: [
          {
            type: 'p',
            text: 'The top of Customize Appearance gives you two fast starting points before you tune individual sliders: reusable Templates and the live Style Gallery.',
          },
          {
            type: 'ul',
            items: [
              'Presets and My Templates: The Templates panel includes 8 ready-made presets under Presets and stores up to 50 custom templates under My Templates in your browser’s local storage (key qrcraftly:brand-templates).',
              'Save, Import JSON, and Export JSON: Use “Save as template” to store your current visual settings, “Export JSON” to download a portable template file, and “Import JSON” to load a saved template on another device. Templates save visual style fields only: QR payload content, headline or badge text, and uploaded logo or Mosaic images are stripped so private content is never written to template files.',
              'Live Style Gallery thumbnails: Style Gallery draws 17 live previews directly on your own QR code content across two tabs: 8 module styles under Patterns and 9 palettes under Colors. Hovering a tile with a mouse previews that look on the main canvas without committing it.',
              'Surprise me and Undo / Redo: Clicking “Surprise me” picks a randomized pattern and color combination that satisfies contrast and scan checks. Every gallery pick or slider edit can be stepped back or forward with the “Undo style change” and “Redo style change” buttons.',
            ],
          },
        ],
      },
      {
        id: 'pattern-styles',
        heading: 'The eight module patterns and Eye Shape options',
        blocks: [
          {
            type: 'p',
            text: 'Under Pattern & Colors, QRCraftly offers 8 module pattern styles. Each style reshapes interior data modules while keeping the underlying grid coordinates intact:',
          },
          {
            type: 'table',
            caption: 'QR code pattern styles and scan characteristics',
            head: ['Pattern (Style Gallery name)', 'Visual geometry', 'Recommended use'],
            rows: [
              ['Standard (Standard Industrial)', 'Solid square modules with sharp corners', 'Highest scanner compatibility, small labels, long distances'],
              ['Modern (Modern Soft)', 'Rounded squares with softened corners', 'Business cards, product packaging, clean interfaces'],
              ['Swiss (Swiss Dot)', 'Separated circular dots on a regular grid', 'Editorial layouts, menus, minimalist print'],
              ['Fluid (Fluid Ink)', 'Connected liquid contours across adjacent dark modules', 'Brand campaigns, modern labels, medium-to-large print'],
              ['Circuit (Cyber Circuit)', 'Angular traces and circuit-board interconnects', 'Hardware, developer events, large high-contrast signs'],
              ['Hive (The Hive)', 'Hexagonal honeycomb cells', 'Craft goods, geometric packaging, posters'],
              ['Grunge', 'Distressed edges with irregular texture', 'Posters and merchandise printed at 3.5 cm wide or larger'],
              ['Starburst', 'Faceted four-point star modules', 'Large event flyers and high-contrast promotional displays'],
            ],
          },
          {
            type: 'note',
            title: 'Extra care for Grunge, Circuit, and Starburst',
            text: 'Grunge, Circuit, and Starburst reduce ink fill or add fine edge detail that angled or low-light cameras can misread. When selecting them, use Error Correction Level Q or H, skip subtle gradients, print at least 3.5 cm (1.4 in) wide, and verify a physical proof with the [QR code checker](/qr-code-checker).',
          },
          {
            type: 'p',
            text: 'Below the pattern grid, Eye Shape controls the three corner finder targets. Each finder target has an outer 7x7 Frame and an inner 3x3 Ball, and both Frame and Ball can be set together or independently to five options: Pattern (matches the active module pattern), Square, Rounded, Circle, or Leaf. When Leaf is chosen, each corner eye rotates so its sharp diagonal axis points inward toward the center of the matrix.',
          },
        ],
      },
      {
        id: 'colors-gradients-and-contrast',
        heading: 'Color presets, gradients, transparency and the 4.5:1 rule',
        blocks: [
          {
            type: 'p',
            text: 'Camera decoders convert your code to grayscale luminance to separate dark modules from light spaces. All foreground elements should maintain at least a 4.5:1 contrast ratio against the background, matching the WCAG 2.1 Level AA contrast formula.',
          },
          {
            type: 'ul',
            items: [
              'Color Presets: Choose from 9 curated palettes that synchronize module, background, and finder eye colors in one click.',
              'Transparent Background: Turn on Transparent Background to export background-free PNG, WebP, or SVG artwork for placement over light surfaces in your own layout tool. Make sure the surface behind the placed code stays light and plain across the entire quiet zone.',
              'Fill Mode and Gradient Angle: Switch Foreground Modules between Solid, Linear, and Radial fill modes. Solid uses a single Color; Linear blends Start Color into End Color across a Gradient Angle from 0° to 360° (in 15° steps); Radial blends Start Color at the center toward End Color at the outer edges.',
              'Custom Eye Colors: Eye Frame and Eye Ball each accept an independent hex color so corner targets can carry a brand accent while data modules stay dark.',
              'Fix contrast auto-adjustment: Whenever module colors, gradient stops, or custom eye colors drop below 4.5:1 against the background (or invert light modules onto a dark background), a warning banner appears with a “Fix contrast” button that darkens foreground stops and lightens the background to a scannable ratio automatically.',
            ],
          },
          {
            type: 'note',
            title: 'Avoid inverted colors in public print',
            text: 'Light modules on a dark background fail in several older camera apps and handheld barcode readers. Keep dark modules on a light background for any code printed for the public.',
          },
        ],
      },
      {
        id: 'layout-border-and-frames',
        heading: 'Export Layout, Border and Frame & CTA Badge controls',
        blocks: [
          {
            type: 'p',
            text: 'The Layout & Border accordion groups three outer presentation layers that wrap around the QR code without altering its internal matrix:',
          },
          {
            type: 'table',
            caption: 'Outer layout, border, and CTA badge parameters',
            head: ['Control group', 'Available options and ranges', 'Behavior and scan notes'],
            rows: [
              ['Export Layout', 'Aspect ratios: Square (1:1), Portrait (4:5), Story (9:16). Templates: None, Minimalist, Gradient, Solid Frame, and Wi-Fi Card. QR Scale: 50% to 150% (default 100%).', 'Adds a styled card canvas with optional Headline and Subtext. Wi-Fi Card is available for Wi-Fi codes and resets to Solid Frame if you switch to another QR type. Template Background and Template Text Color each toggle between Inherit and Custom (checked against 4.5:1 text contrast).'],
              ['Border', 'Enable Border switch. Border Style: Solid, Dashed, Dotted, Double. Border Width: 1.0% to 15.0% (default 5.0%). Border Color, Border text (Top Center or Bottom Center) with Border Text Color, plus secondary border logo (Bottom Center or Bottom Right).', 'Drawn outside the quiet zone margin so a dark border never touches or crowds the three corner finder patterns. Secondary border logos accept JPEG, PNG, WebP, or SVG up to 2 MB via Add Logo / Change, and Border Text Color warns below 4.5:1 against Solid borders.'],
              ['Frame & CTA Badge', 'Frame Shape: None, Pill Badge, Banner Bar, Speech Bubble, Full Card. Position: Bottom, Top, Left, Right (4 positions). Badge Icon: None plus 6 icons (QR Scan, Camera, Star, Heart, Info, Phone). Call-to-Action Text with 4 presets (SCAN ME, VISIT US, DOWNLOAD APP, VIEW MENU). Badge Font: 5 options (Sans Serif, Serif, Monospace, Display, Cursive).', 'Pairs a call-to-action label with Frame Background and Text & Icon Color (checked for 4.5:1 contrast). Note that PDF and EPS vector exports always substitute Helvetica for Badge Font so print prepress Rip workflows never fail on missing system fonts.'],
            ],
          },
        ],
      },
      {
        id: 'logos-and-cutout-math',
        heading: 'Center logos, width caps and per-ECC cutout clamping',
        blocks: [
          {
            type: 'p',
            text: 'Placing a mark in the center of a QR code intentionally hides interior modules, relying on Reed-Solomon error correction to reconstruct the covered data. You can start directly on the [QR code with logo](/qr-code-with-logo) page or open the Logo panel in the studio.',
          },
          {
            type: 'ul',
            items: [
              'Preset SVG marks and custom uploads: Pick from 11 built-in generic SVG marks organized across Social, Messaging, Payment, and General categories (Network, Profile, Video, Chat, Send, Card, Bitcoin, Website, Email, Phone, and Location), or upload a JPEG, PNG, WebP, or SVG file up to 2 MB. Uploaded files stay in browser memory and are never sent to a server.',
              'Automatic Level H promotion: Selecting a preset mark or uploading a custom logo automatically sets Error Correction Level to H (High, ~30% recovery) so the code has maximum repair capacity.',
              '10% to 30% side-width cap (9% unpadded area): The Size slider sets logo width from 10% to 30% of the QR matrix side length (default 20%). Because area scales with width squared, a 30% width cap covers 9% of the unpadded matrix area, not 30% of total area.',
              'Backing shape and Padding: Border Style places a Square, Circle, or None backing behind the logo in your chosen Background Color. When Square or Circle is active, Padding adjusts the clear gap around the logo from 0.5 to 4 modules (default 1 module; values below 0.5 clamp to 0.5 so the backing remains visible).',
              'Per-ECC safe cutout clamping: Before drawing, the matrix layout engine clamps the combined cutout width (logo width plus backing padding on both sides) to safe per-level ceilings of the matrix side width: 22% at Level L, 35% at Level M, 42% at Level Q, and 50% at Level H. If logo size plus padding exceeds your current level’s ceiling, both scale down proportionally so finder and timing structures survive.',
            ],
          },
        ],
      },
      {
        id: 'mosaic-image-tiling',
        heading: 'Mosaic image tiling: Halftone versus Tiles',
        blocks: [
          {
            type: 'p',
            text: 'Inside the Logo accordion, the Mosaic section blends a photograph or illustration across the QR matrix in your browser (also available on the [image QR code](/mosaic-qr-code) page). Uploads accept JPEG, PNG, WebP, or SVG up to 2 MB, stay strictly in volatile browser memory, and automatically promote Error Correction Level to H.',
          },
          {
            type: 'ul',
            items: [
              'Halftone (3x3 sub-cells with Mosaic Core): The default Halftone mode splits each interior data module into a 3x3 grid of sub-cells. The center sub-cell—the Mosaic Core—is locked to strict dark-or-light luminance contrast so cameras read the binary bit accurately, while the 8 surrounding sub-cells preserve full-color detail from your picture.',
              'Tiles (1x1 whole-module color): Tiles mode assigns a single luminance-clamped color to each 1x1 data module. It shows less fine picture detail than Halftone, but creates bolder blocks that scan from further away or on smaller prints.',
              'Protected function patterns: In both Mosaic Layout modes, Structural function modules—the three corner finder patterns, their white separators, timing lines, alignment targets, and format/version cells—are never subdivided and always render as whole high-contrast tiles.',
              'Scan Contrast slider: Scan Contrast runs from 0% to 100% (default 50%), tightening the luminance floor and ceiling of dark and light modules from roughly 5:1 core contrast at 0% up to roughly 13:1 at 100%. Raise Scan Contrast first if the scan badge reports “Scans, but fragile”.',
            ],
          },
        ],
      },
      {
        id: 'advanced-mode',
        heading: 'Advanced Mode: Error Correction Level and Quiet Zone Margin',
        blocks: [
          {
            type: 'p',
            text: 'Opening Advanced Mode exposes two low-level symbology parameters that govern matrix density and outer blank space:',
          },
          {
            type: 'ul',
            items: [
              'Error Correction Level: Choose Low (~7%) [L], Medium (~15%) [M], Quartile (~25%) [Q], or High (~30%) [H]. Higher levels restore more covered or scuffed modules at the cost of a denser grid; see [error correction explained](/guides/qr-code-error-correction-explained) for how Reed-Solomon recovery works.',
              'Quiet Zone Margin (modules): Adjusts the blank margin around the QR matrix from 2 to 10 modules (default 4 modules). ISO/IEC 18004 specifies at least 4 modules on all four sides. Lowering the slider to 2 or 3 modules helps fit tight digital cards you test yourself, while 4 or more modules is recommended for all print runs. Phone wallet cards exported from Download options always enforce a fixed 4-module quiet zone.',
            ],
          },
          {
            type: 'p',
            text: 'Once your appearance settings pass the live scan check (“Scans reliably”), read [export formats and phone wallets](/guides/qr-code-export-and-wallet-options) to pick between PNG, SVG, EPS, PDF, JPEG, WebP, CMYK prepress output, and phone wallet cards.',
          },
        ],
      },
    ],
    sources: [
      {
        label: 'ISO/IEC 18004:2015, “Information technology — Automatic identification and data capture techniques — QR Code bar code symbology specification”',
        url: 'https://www.iso.org/standard/62021.html',
        supports: 'Symbology structure, locator finder patterns, quiet zone width of four modules, and Reed-Solomon error correction capacities.',
      },
      {
        label: 'W3C, “Web Content Accessibility Guidelines (WCAG) 2.1 — Guideline 1.4.3 Contrast (Minimum)”',
        url: 'https://www.w3.org/TR/WCAG21/#contrast-minimum',
        supports: 'The 4.5:1 relative luminance contrast ratio threshold enforced on modules, gradient stops, eye colors, and badge text.',
      },
      {
        label: 'Denso Wave, “QR Code Standardization and Finder Pattern Structure”, qrcode.com',
        url: 'https://www.qrcode.com/en/about/standards.html',
        supports: 'Finder pattern 1:1:3:1:1 module geometry and scanning alignment rules.',
      },
      {
        label: 'QRCraftly ADR 0019, “Mosaic QR: Module-Level Image Tiling”, docs/adr/0019-mosaic-qr-module-level-image-tiling.md',
        url: 'https://github.com/fderuiter/QRCraftly-web/blob/HEAD/docs/adr/0019-mosaic-qr-module-level-image-tiling.md',
        supports: '3x3 Halftone Mosaic Core sub-cell geometry, 1x1 Tiles mode, protected function modules, and luminance contrast clamping.',
      },
    ],
    related: ['qr-code-export-and-wallet-options', 'how-to-print-a-qr-code-that-scans', 'qr-code-error-correction-explained'],
  },
  {
    slug: 'qr-code-export-and-wallet-options',
    title: 'QR code export and phone wallet guide: formats, CMYK prepress and wallet cards',
    shortTitle: 'Export formats and phone wallets',
    seoTitle: 'QR Code Export Formats, CMYK Prepress & Wallet Cards | QRCraftly',
    description:
      'Reference for QR code downloads: PNG, SVG, EPS, PDF, JPEG and WebP, 128 to 8192 px sizes, CMYK vector prepress, clipboard copy and phone wallet cards.',
    lead: 'Choosing the right export setting keeps a QR code crisp on screens, commercial printing presses, and phone lock screens. This reference covers all six download formats in QRCraftly, pixel size presets, RGB and CMYK vector prepress rules, clipboard actions, and client-side phone wallet cards and passes.',
    datePublished: '2026-11-19',
    dateModified: '2026-11-19',
    sections: [
      {
        id: 'download-formats',
        heading: 'The six download formats compared',
        blocks: [
          {
            type: 'p',
            text: 'Opening Download options next to the main Download button lets you switch Format across three raster image types and three resolution-independent vector types, all generated locally in your browser:',
          },
          {
            type: 'table',
            caption: 'QRCraftly download formats and characteristics',
            head: ['Format', 'Kind', 'Transparency and color', 'Best suited for'],
            rows: [
              ['PNG', 'Raster', 'RGB with full alpha transparency when Transparent Background is on', 'General web images, slides, documents, and messaging apps'],
              ['SVG', 'Vector', 'RGB vector paths and inline data-URL assets; supports Transparent Background', 'Design software (Figma, Illustrator, Inkscape, Affinity), responsive web pages, and sharp print layouts'],
              ['EPS', 'Vector', 'RGB or CMYK Color Space; solid light backing; logos embedded as raster images', 'Commercial print shops, signage RIP software, packaging, and legacy prepress workflows'],
              ['PDF', 'Vector', 'RGB or CMYK Color Space; self-contained vector page; logos embedded as raster images', 'Direct office or print-shop delivery, proofs, and multi-page print layouts'],
              ['JPEG', 'Raster', 'RGB only, always opaque with no alpha channel', 'Smallest file size for older CMS uploads and email attachments'],
              ['WebP', 'Raster', 'RGB with alpha transparency support and compact compression', 'Modern websites and mobile apps where fast page load matters'],
            ],
          },
          {
            type: 'p',
            text: 'You can set the base download name in the File name field before exporting; QRCraftly appends the matching file extension automatically.',
          },
        ],
      },
      {
        id: 'raster-sizes-and-print-scale',
        heading: 'Raster pixel sizes and 300 dpi print widths',
        blocks: [
          {
            type: 'p',
            text: 'Vector formats (SVG, EPS, and PDF) describe mathematical paths rather than pixels, so they stay sharp at any physical dimension. When you pick a raster format (PNG, JPEG, or WebP), the Size control offers three presets plus a Custom pixel width:',
          },
          {
            type: 'table',
            caption: 'Raster Size presets, custom range, and 300 dpi print equivalents',
            head: ['Size option', 'Width in pixels', 'Printed width at 300 dpi', 'Approximate scan distance'],
            rows: [
              ['Screen', '512 px', '4.3 cm (1.7 in)', 'About 0.4 m, plus crisp display on phones and laptops'],
              ['Print', '2048 px', '17.3 cm (6.8 in)', 'About 1.7 m (flyers, table tents, and handouts)'],
              ['Poster', '4096 px', '34.7 cm (13.7 in)', 'About 3.5 m (posters and shop windows)'],
              ['Custom', '128 to 8192 px', '1.1 cm (0.4 in) up to 69.4 cm (27.3 in)', 'Roughly 10 times the printed width'],
            ],
          },
          {
            type: 'p',
            text: 'Typing a number outside the supported range into Width in pixels clamps automatically to the nearest boundary between 128 and 8192 pixels. To work out the exact physical width for your payload density and viewing distance before printing, use the [QR code size calculator](/qr-code-size-calculator).',
          },
        ],
      },
      {
        id: 'vector-prepress-and-cmyk',
        heading: 'CMYK prepress rules and clipboard actions',
        blocks: [
          {
            type: 'p',
            text: 'When Format is set to EPS or PDF, Download options reveals a Color Space toggle with two modes:',
          },
          {
            type: 'ul',
            items: [
              'RGB: Standard digital color space for screen viewing, office laser printers, and digital workflows.',
              'CMYK: Four-color process output for commercial offset and digital presses, converting module, eye, border, and frame colors directly into cyan, magenta, yellow, and key (black) channels so your print shop does not perform an unexpected RGB conversion.',
              'Helvetica badge substitution and embedded logos: Both EPS and PDF always substitute Helvetica for Frame & CTA Badge text so prepress RIP systems never substitute or drop missing fonts, and both rasterize uploaded center or border logos into embedded images inside the vector document. Keep SVG if you need editable custom font names or raw vector logo paths (also available on the [SVG QR code](/svg-qr-code) page).',
            ],
          },
          {
            type: 'p',
            text: 'Below the File name field, two one-click clipboard buttons let you skip saving a file altogether:',
          },
          {
            type: 'ul',
            items: [
              '“Copy image”: Renders a crisp PNG of your styled code and copies the bitmap straight to your clipboard for pasting into slides, documents, or chat messages.',
              '“Copy as SVG”: Generates self-contained vector SVG XML markup and copies the text to your clipboard for pasting inline into HTML, React components, Figma, or Illustrator.',
            ],
          },
        ],
      },
      {
        id: 'phone-wallet-cards',
        heading: 'Add to phone wallet: 1080x1920 Wallet Cards',
        blocks: [
          {
            type: 'p',
            text: 'Clicking “Add to phone wallet” in Download options opens a client-side dialog that builds a lock-screen-ready Wallet Card PNG on your device with zero server uploads:',
          },
          {
            type: 'ul',
            items: [
              '1080x1920 PNG layout and fixed 4-module quiet zone: The generator renders a 1080 × 1920 px portrait PNG card featuring a plain black-on-white QR code with a fixed 4-module quiet zone below an optional Title (up to 60 characters, prefilled from your Wi-Fi network name, domain, or QR type) and Subtitle (optional) (up to 80 characters). Decorative colors and logos are intentionally omitted on the card so another phone’s camera can read it off a dim or angled screen.',
              'Optical scannability gate: Before enabling “Download PNG” or “Share to phone”, QRCraftly runs an on-device optical decode check against the rendered 1080x1920 canvas. If a very dense payload fails verification, saving is blocked until you shorten the content.',
              'Android and iPhone steps: On Android, open Google Wallet, tap Add to Wallet, choose Photo, and pick the downloaded Wallet Card image to create a pass from the photo. On iPhone, save the image to Photos (or share it via AirDrop) and pin it in Favorites, a dedicated album, or a Photos widget—Apple Wallet only accepts Apple-signed .pkpass bundles, not plain images.',
              'Payment and Bulk CSV refusals: Wallet export refuses Payment QR codes because a payment request accessible from a locked screen poses an unauthorized-charge risk, and refuses Bulk CSV mode because a wallet card holds a single QR code at a time.',
            ],
          },
        ],
      },
      {
        id: 'signed-developer-passes',
        heading: 'Signed Apple Wallet (.pkpass) and Google Wallet passes (Beta)',
        blocks: [
          {
            type: 'p',
            text: 'Apple Wallet and Google Wallet require cryptographic signatures from paid developer accounts to install native passes. Because QRCraftly runs no backend server and never holds shared signing keys or sees your QR content, native pass signing is offered through the collapsed Beta section labeled “Have your own Apple or Google developer keys?” inside the wallet dialog:',
          },
          {
            type: 'ul',
            items: [
              'Apple Wallet pass (.pkpass): Supply your own Apple Pass Type ID certificate (.pem or .cer), the Apple WWDR G4 certificate, and your unencrypted private key (.pem), along with your Pass Type Identifier, Team Identifier, and Organization Name. Your browser assembles and CMS-signs the .pkpass archive locally using Web Crypto and downloads it straight to your device.',
              'Google Wallet pass (JWT save link): Supply your own Google Cloud service-account JSON key file and Google Wallet Issuer ID. Your browser signs the Generic pass JWT locally with RS256 and produces a “Save to Google Wallet” link (wallet.google.com/gp/v/save/...). Because that link carries the encoded payload to Google when opened, only click it if you intend to store the pass with Google.',
              'Volatile key handling: Certificates and private keys stay strictly in volatile browser memory while the dialog is open, are never written to localStorage or IndexedDB, and are discarded as soon as the dialog closes.',
            ],
          },
          {
            type: 'p',
            text: 'For print sizing and proof testing once your file is exported, continue to [how to print a QR code that scans](/guides/how-to-print-a-qr-code-that-scans).',
          },
        ],
      },
    ],
    sources: [
      {
        label: 'QRCraftly ADR 0048, “Wallet Passes Built in the Browser”, docs/adr/0048-wallet-passes-built-in-the-browser.md',
        url: 'https://github.com/fderuiter/QRCraftly-web/blob/HEAD/docs/adr/0048-wallet-passes-built-in-the-browser.md',
        supports: 'Client-side 1080x1920 PNG Wallet Card design, Payment and Bulk CSV refusal rules, and browser-only .pkpass and Google Wallet JWT signing.',
      },
      {
        label: 'W3C, “Scalable Vector Graphics (SVG) 1.1 (Second Edition)”',
        url: 'https://www.w3.org/TR/SVG11/',
        supports: 'Resolution-independent XML vector geometry used by Download SVG and Copy as SVG.',
      },
      {
        label: 'ISO/IEC 18004:2015, “Information technology — Automatic identification and data capture techniques — QR Code bar code symbology specification”',
        url: 'https://www.iso.org/standard/62021.html',
        supports: 'Four-module quiet zone standard enforced on Wallet Cards and recommended for print exports.',
      },
      {
        label: 'Google Wallet Help, “Add items to Google Wallet with a photo”',
        url: 'https://support.google.com/wallet/answer/12060039',
        supports: 'Creating a Google Wallet pass on Android from a saved barcode or QR photo.',
      },
    ],
    related: ['qr-code-customization-parameters', 'how-to-print-a-qr-code-that-scans', 'qr-code-scams-quishing'],
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
    case 'code':
      return `${block.title ?? ''} ${block.code}`;
    default:
      return block.items.join(' ');
  }
}

/**
 * Builds what a guide page renders.
 * @param slug - The guide's slug.
 * @returns The article, or undefined for an unknown slug.
 */
export function getGuideArticle(slug: string): GuideArticleContent | undefined {
  const guide = getGuide(slug);
  if (!guide) return undefined;
  const related = guide.related.flatMap((other) => {
    const found = getGuide(other);
    return found ? [{ slug: found.slug, title: found.title }] : [];
  });
  return { guide, author: GUIDE_AUTHOR, minutes: readingMinutes(guide), related };
}

/**
 * Lists the guides for the `/guides` hub without their bodies.
 * @returns One summary per guide, in hub order.
 */
export function getGuideSummaries(): GuideSummary[] {
  return guides.map((guide) => ({
    slug: guide.slug,
    title: guide.title,
    description: guide.description,
    dateModified: guide.dateModified,
    minutes: readingMinutes(guide),
  }));
}
