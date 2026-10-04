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

import { describe, expect, it } from 'vitest';
import { analyseLink } from '../index';

const codes = (url: string) => analyseLink(url).map((finding) => finding.code);
const cautions = (url: string) => analyseLink(url).filter((finding) => finding.severity === 'caution');
const cyrillicA = String.fromCharCode(0x0430);
const greekO = String.fromCharCode(0x03bf);

describe('analyseLink', () => {
  it.each([
    ['http://example.com/login', ['http']],
    ['https://user:pass@example.com/', ['userinfo']],
    ['https://paypal.com@evil.example/', ['userinfo']],
    ['https://192.168.0.1/admin', ['ip-host']],
    ['https://3232235777/', ['ip-host']],
    ['https://0xC0.0xA8.1.1/', ['ip-host']],
    ['https://[2001:db8::1]/', ['ip-host']],
    ['https://example.com:8443/', ['port']],
    ['https://bit.ly/3abcde', ['shortener']],
    ['https://tinyurl.com/y1', ['shortener']],
    ['https://paypa1.com/signin', ['lookalike']],
    ['https://g00gle.com/', ['lookalike']],
    ['https://rnicrosoft.com/', ['lookalike']],
    ['https://paypal.com.account-verify.example/', ['brand-in-subdomain']],
    ['https://login.microsoft.evil.example/', ['brand-in-subdomain']],
    ['https://a.b.c.d.example.com/', ['deep-subdomain']],
    ['https://example.com/amazon/login', ['brand-in-path']],
  ])('%s -> %j', (url, expected) => {
    expect(codes(url)).toEqual(expected);
  });

  it('flags a lookalike built from other alphabets', () => {
    expect(codes(`https://p${cyrillicA}ypal.com/`)).toContain('mixed-scripts');
    expect(codes(`https://g${greekO}${greekO}gle.com/`)).toContain('mixed-scripts');
    // A whole-script Cyrillic imitation mixes no scripts, but is still caught as a lookalike.
    const allCyrillic = String.fromCharCode(0x0440, 0x0430, 0x0443, 0x0440, 0x0430, 0x04cf);
    const found = codes(`https://${allCyrillic}.com/`);
    expect(found).toContain('lookalike');
    expect(found).not.toContain('mixed-scripts');
  });

  it('does not flag the real sites of a brand', () => {
    for (const url of ['https://paypal.com/', 'https://www.paypal.me/x', 'https://mail.google.com/', 'https://amazon.co.uk/', 'https://login.microsoftonline.com/']) {
      expect(analyseLink(url)).toEqual([]);
    }
  });

  it('puts cautions before notes', () => {
    const findings = analyseLink('https://paypa1.com:8443/');
    expect(findings.map((finding) => finding.severity)).toEqual(['caution', 'info']);
  });

  it('accepts an address without a scheme and ignores what is not a web address', () => {
    expect(codes('paypa1.com')).toEqual(['lookalike']);
    expect(codes('localhost:3000')).toEqual(['port']);
    for (const value of ['', 'mailto:a@b.example', 'tel:+15551234', 'javascript:alert(1)', 'two words', 'not a url at all']) {
      expect(analyseLink(value)).toEqual([]);
    }
  });

  it('never calls an address safe', () => {
    const wording = [...analyseLink('http://user@192.168.0.1:81/'), ...analyseLink('https://paypa1.com')].map((f) => f.message).join(' ');
    expect(wording.toLowerCase()).not.toContain('safe');
  });
});

describe('false positives on ordinary addresses', () => {
  const sites = [
    'www.example.com', 'en.wikipedia.org', 'www.nytimes.com', 'www.bbc.co.uk', 'github.com', 'stackoverflow.com', 'news.ycombinator.com',
    'www.reddit.com', 'www.youtube.com', 'mail.google.com', 'docs.google.com', 'maps.google.com', 'www.amazon.com', 'www.amazon.co.uk',
    'www.apple.com', 'support.apple.com', 'www.microsoft.com', 'learn.microsoft.com', 'azure.microsoft.com', 'www.linkedin.com',
    'www.facebook.com', 'www.instagram.com', 'twitter.com', 'www.netflix.com', 'open.spotify.com', 'www.paypal.com', 'www.ebay.com',
    'www.etsy.com', 'www.walmart.com', 'www.target.com', 'www.costco.com', 'www.nasa.gov', 'www.cdc.gov', 'www.irs.gov', 'www.usps.com',
    'www.fedex.com', 'www.ups.com', 'www.dhl.com', 'www.nih.gov', 'www.mit.edu', 'www.stanford.edu', 'www.ox.ac.uk', 'www.gov.uk',
    'www.canada.ca', 'www.abc.net.au', 'www.asahi.com', 'www.lemonde.fr', 'www.spiegel.de', 'www.elpais.com', 'www.repubblica.it',
    'developer.mozilla.org', 'docs.python.org', 'nodejs.org', 'react.dev', 'vuejs.org', 'tailwindcss.com', 'www.npmjs.com', 'pnpm.io',
    'cloudflare.com', 'developers.cloudflare.com', 'workers.cloudflare.com', 'vercel.com', 'www.netlify.com', 'stripe.com', 'docs.stripe.com',
    'shopify.com', 'www.zoom.us', 'slack.com', 'www.dropbox.com', 'drive.google.com', 'www.adobe.com', 'helpx.adobe.com', 'www.salesforce.com',
    'www.airbnb.com', 'www.booking.com', 'www.uber.com', 'www.doordash.com', 'www.chase.com', 'www.wellsfargo.com', 'www.bankofamerica.com',
    'www.capitalone.com', 'www.americanexpress.com', 'www.visa.com', 'www.mastercard.com', 'www.coinbase.com', 'www.binance.com',
    'www.twitch.tv', 'store.steampowered.com', 'www.epicgames.com', 'www.roblox.com', 'www.nintendo.com', 'www.playstation.com',
    'www.xbox.com', 'www.yahoo.com', 'proton.me', 'www.wordpress.com', 'www.godaddy.com', 'www.namecheap.com', 'fpderuiter.github.io',
    'qrcraftly.com', 'www.verizon.com', 'www.xfinity.com', 'www.vodafone.co.uk', 'www.barclays.co.uk', 'www.hsbc.co.uk', 'www.natwest.com',
    'www.revolut.com', 'wise.com',
  ];
  const paths = ['/', '/search?q=qr+code&page=2#results'];
  const corpus = sites.flatMap((site) => paths.map((path) => `https://${site}${path}`));

  it('has two hundred addresses', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(200);
  });

  it.each(corpus)('raises no caution for %s', (url) => {
    expect(cautions(url)).toEqual([]);
  });
});
