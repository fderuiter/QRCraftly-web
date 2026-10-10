/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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
 * The QRCraftly Pledge: the project's promise of no ads, no tracking, client-side
 * processing and free use. The /free-forever page, the About page and the site footers all
 * read from here so the wording never drifts. docs/PLEDGE.md and README.md carry the
 * same text for the repository.
 */

/** One-line summary used in site footers. */
export const PLEDGE_TAGLINE = 'No ads. No tracking. Free forever.';

/** The headline promise. */
export const PLEDGE_HEADLINE = 'QRCraftly is not ad supported, and it never will be.';

/** One promise in the pledge. */
export interface PledgePromise {
  title: string;
  text: string;
}

export const PLEDGE_PROMISES: readonly PledgePromise[] = [
  {
    title: 'No ads',
    text: 'No banner ads, no sponsored placements, no affiliate links and no paid upgrades. Not now and not later.',
  },
  {
    title: 'No tracking',
    text: 'No analytics, no tracking cookies, no tracking pixels, no fingerprinting and no third-party scripts. I do not know who you are and I do not want to.',
  },
  {
    title: 'Entirely in your browser',
    text: 'Your QR codes are made on your device. What you type, upload or scan is never sent to a server. Once the page has loaded, the generator keeps working offline.',
  },
  {
    title: 'Completely free',
    text: 'Every feature, for everyone, with no account, no sign-up and no paid tier.',
  },
];

/** What happens if the pledge ever can't be kept. */
export const PLEDGE_COMMITMENT =
  'If keeping QRCraftly running ever comes down to ads or nothing, it will be nothing: I will shut the project down before a single ad goes on it. The only way QRCraftly would ever change hands is if someone buys the whole project outright.';

/** Why the project exists. */
export const PLEDGE_WHY =
  'This is the point of the project. A QR code generator should not need to know what you are encoding, and it should not be paid for by watching you. Keeping everything in your browser also makes QRCraftly fast and available anywhere, even without a connection.';

export const PLEDGE_SIGNATURE = 'Fred de Ruiter, creator of QRCraftly';

/** The one-line positioning statement, used as the page lead. */
export const PLEDGE_LEAD = 'Free QR codes that never expire. No sign-up, no ads, nothing leaves your browser.';

/** Why QRCraftly codes never expire. */
export const PLEDGE_NEVER_EXPIRE =
  'Many QR code sites put your code behind a redirect on their own server and switch it off when a free trial ends. QRCraftly makes static codes: what you encode is stored in the code itself, so there is no account, subscription or server that could ever deactivate it.';

/**
 * Link text for a vendor's own support article on trial codes being deactivated. The URL is a
 * literal in the page (hrefs must be literals or pass isDangerousUrl).
 */
export const TRIAL_EXPIRY_LINK_LABEL = 'what happens to QR codes when a QR Code Generator trial expires';

/** How the project stays free without ads. */
export const PLEDGE_AFFORDABLE =
  'QRCraftly is a set of static files. There are no accounts, no database of your codes and no servers doing the work, because your browser does it. That keeps hosting costs close to zero, and I cover them myself.';

/** Exactly what is collected, and by whom. Must stay true to the code and hosting setup. */
export const PLEDGE_COLLECTED: readonly string[] = [
  'Cloudflare, which hosts the site, handles each request for a page or file. Like any web host it sees your IP address, browser user agent, the page address and the time, uses them to deliver the site and block attacks, and shows us only aggregate totals such as request counts.',
  'If Cloudflare\u2019s bot protection is switched on, it may set a short-lived security cookie. It is not used for tracking.',
  'Your light or dark theme choice is saved in your own browser so the site remembers it. It never leaves your device.',
  'Brand templates you choose to save are kept in your own browser too. They hold only style settings such as colours, patterns and borders, never your content or uploaded images, and never leave your device.',
];

/** Exactly what is never collected. */
export const PLEDGE_NOT_COLLECTED: readonly string[] = [
  'Anything you type, upload or scan, and the QR codes you make. They stay in your browser tab and are gone when you close or refresh it.',
  'Analytics, tracking cookies, tracking pixels, fingerprints or third-party scripts of any kind.',
  'Diagnostics, crash reports or usage statistics. QRCraftly reports nothing back.',
  'Accounts, emails or payment details. There is nothing to sign up for.',
];

/** How anyone can check the claims above. */
export const PLEDGE_VERIFY =
  'The code is open source under the AGPL. The site\u2019s Content Security Policy tells your browser to refuse connections to any server other than QRCraftly itself, and the build fails if the code makes a network request that has not been reviewed and allowlisted.';
