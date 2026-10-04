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
 * Static reference data for link analysis. Everything here is bundled: the analysis never
 * makes a network request (#1156).
 */

/** A well-known brand and the registrable domains it really owns. */
export interface Brand {
  /** The brand as it appears in a domain label, lower case ASCII (at least four letters). */
  label: string;
  /** Registrable domains the brand owns. A match on one of these is never flagged. */
  domains: readonly string[];
}

const brand = (label: string, ...extra: string[]): Brand => ({ label, domains: [`${label}.com`, ...extra] });

/** About a hundred brands that phishing pages imitate most. */
export const BRANDS: readonly Brand[] = [
  brand('paypal', 'paypal.me', 'paypal.de', 'paypal.co.uk', 'paypalobjects.com'),
  brand('google', 'google.de', 'google.co.uk', 'google.co.jp', 'google.fr', 'googleapis.com', 'googleusercontent.com', 'goo.gl', 'google-analytics.com'),
  brand('gmail', 'googlemail.com'),
  brand('youtube', 'youtu.be'),
  brand('facebook', 'fb.com', 'fb.me', 'facebook.net'),
  brand('instagram', 'instagr.am'),
  brand('whatsapp', 'whatsapp.net', 'wa.me'),
  brand('messenger'),
  brand('twitter', 't.co'),
  brand('linkedin', 'lnkd.in'),
  brand('snapchat'),
  brand('tiktok', 'tiktokv.com'),
  brand('pinterest', 'pin.it'),
  brand('reddit', 'redd.it', 'redditstatic.com'),
  brand('discord', 'discord.gg', 'discordapp.com'),
  brand('telegram', 't.me', 'telegram.org'),
  brand('signal', 'signal.org'),
  brand('microsoft', 'microsoftonline.com', 'live.com', 'office.com', 'office365.com', 'msn.com', 'bing.com', 'azure.com', 'windows.com', 'outlook.com', 'sharepoint.com'),
  brand('outlook', 'outlook.office.com', 'live.com'),
  brand('office365', 'office.com'),
  brand('onedrive', 'live.com', 'sharepoint.com'),
  brand('skype', 'skype.com'),
  brand('apple', 'icloud.com', 'apple.co', 'cdn-apple.com'),
  brand('icloud', 'apple.com'),
  brand('itunes', 'apple.com'),
  brand('amazon', 'amazon.co.uk', 'amazon.de', 'amazon.ca', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.co.jp', 'amazon.in', 'amazon.com.au', 'amazon.com.br', 'amazon.com.mx', 'amzn.to', 'amzn.com', 'amazonaws.com', 'cloudfront.net'),
  brand('netflix', 'nflxvideo.net'),
  brand('spotify', 'scdn.co'),
  brand('hulu'),
  brand('disneyplus', 'disney.com'),
  brand('steampowered', 'steamcommunity.com'),
  brand('steamcommunity', 'steampowered.com'),
  brand('roblox'),
  brand('fortnite', 'epicgames.com'),
  brand('epicgames'),
  brand('playstation', 'sony.com'),
  brand('xbox', 'microsoft.com'),
  brand('nintendo'),
  brand('twitch', 'twitch.tv'),
  brand('dropbox', 'dropboxusercontent.com'),
  brand('github', 'github.io', 'githubusercontent.com', 'github.dev'),
  brand('gitlab', 'gitlab.io'),
  brand('bitbucket', 'bitbucket.org'),
  brand('cloudflare', 'workers.dev', 'pages.dev'),
  brand('adobe'),
  brand('zoom', 'zoom.us'),
  brand('slack', 'slack-edge.com'),
  brand('docusign', 'docusign.net'),
  brand('salesforce', 'force.com'),
  brand('shopify', 'myshopify.com'),
  brand('stripe', 'stripe.network'),
  brand('square', 'squareup.com', 'square.site'),
  brand('venmo'),
  brand('cashapp', 'cash.app'),
  brand('zelle', 'zellepay.com'),
  brand('coinbase'),
  brand('binance', 'binance.us'),
  brand('kraken'),
  brand('metamask', 'metamask.io'),
  brand('blockchain'),
  brand('ledger'),
  brand('trezor', 'trezor.io'),
  brand('wellsfargo'),
  brand('chase', 'jpmorganchase.com'),
  brand('bankofamerica', 'bofa.com'),
  brand('citibank', 'citi.com'),
  brand('capitalone'),
  brand('americanexpress', 'americanexpress.com', 'amex.com'),
  brand('discover'),
  brand('usbank'),
  brand('barclays', 'barclays.co.uk'),
  brand('hsbc', 'hsbc.co.uk'),
  brand('santander', 'santander.co.uk'),
  brand('lloydsbank', 'lloydsbank.co.uk'),
  brand('natwest', 'natwest.com'),
  brand('revolut'),
  brand('wise', 'wise.com'),
  brand('visa'),
  brand('mastercard'),
  brand('fedex'),
  brand('usps'),
  brand('royalmail', 'royalmail.com'),
  brand('dhl', 'dhl.de'),
  brand('ebay', 'ebay.co.uk', 'ebay.de', 'ebay.ca', 'ebay.com.au'),
  brand('etsy'),
  brand('walmart', 'walmart.ca'),
  brand('target'),
  brand('costco'),
  brand('aliexpress', 'alibaba.com'),
  brand('alibaba', 'alibaba.com'),
  brand('verizon'),
  brand('comcast', 'xfinity.com'),
  brand('xfinity', 'comcast.com'),
  brand('spectrum'),
  brand('vodafone', 'vodafone.co.uk'),
  brand('turbotax', 'intuit.com'),
  brand('quickbooks', 'intuit.com'),
  brand('intuit'),
  brand('airbnb'),
  brand('booking'),
  brand('uber'),
  brand('lyft'),
  brand('doordash'),
  brand('grubhub'),
  brand('yahoo', 'yahoo.co.jp', 'yimg.com'),
  brand('protonmail', 'proton.me'),
  brand('okta', 'okta-emea.com'),
  brand('wordpress', 'wp.com'),
  brand('godaddy'),
  brand('namecheap'),
];

/** Link shorteners and redirectors: the address says nothing about where it leads. */
export const SHORTENERS: ReadonlySet<string> = new Set([
  'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly',
  'shorturl.at', 'tiny.cc', 'rb.gy', 'lnkd.in', 'fb.me', 'amzn.to', 'youtu.be', 'v.gd', 'clck.ru', 'bl.ink',
  'soo.gd', 's.id', 't.ly', 'urlz.fr', 'qr.ae', 'adf.ly', 'bc.vc', 'shorte.st', 'trib.al', 'dlvr.it',
  'po.st', 'mcaf.ee', 'tr.im', 'x.co', 'snip.ly', 'short.io', 'bitly.is', 'lc.chat', 'vzturl.com', 'qrco.de',
  'hyperurl.co', 'ouo.io', 'smarturl.it', 'linktr.ee', 'l.ead.me', 'surl.li', 'kutt.it', 'chilp.it', 'shorturl.com',
  'tinyurl.is', 'url.ie', 'zpr.io', 'mz.cm',
]);

/** Suffixes of more than one label, and hosting suffixes where each customer owns a subdomain. */
export const MULTI_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'org.nz', 'net.nz', 'govt.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'co.kr', 'or.kr', 'co.in', 'net.in', 'org.in', 'ac.in', 'gov.in',
  'com.br', 'net.br', 'org.br', 'com.ar', 'com.mx', 'com.co', 'com.pe', 'com.ve',
  'com.cn', 'net.cn', 'org.cn', 'com.hk', 'com.tw', 'com.sg', 'com.my', 'com.ph', 'com.vn',
  'com.tr', 'com.ua', 'com.pl', 'co.za', 'co.il', 'co.id', 'co.th', 'com.eg', 'com.ng', 'com.sa',
  'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'vercel.app', 'netlify.app', 'herokuapp.com',
  'blogspot.com', 'web.app', 'firebaseapp.com', 'azurewebsites.net', 'cloudfront.net', 'appspot.com',
  'glitch.me', 'repl.co', 'onrender.com', 'fly.dev', 'wixsite.com', 'weebly.com', 'wordpress.com',
  'myshopify.com', 'square.site', 'carrd.co', 'notion.site', 'framer.website', 'webflow.io', 'ngrok.io',
  'trycloudflare.com', 'amazonaws.com', 'cloudapp.azure.com', 'storage.googleapis.com',
]);

/** Visually confusable characters mapped to the Latin letter they imitate (UTS #39 subset). */
export const CONFUSABLES: Readonly<Record<string, string>> = {
  // Cyrillic
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i', 'ј': 'j', 'ѕ': 's',
  'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'һ': 'h', 'к': 'k', 'м': 'm', 'н': 'h', 'т': 't', 'в': 'b', 'ӏ': 'l',
  'ɡ': 'g', 'ѵ': 'v', 'ӓ': 'a', 'ё': 'e', 'ї': 'i',
  // Greek
  'α': 'a', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x',
  'ϲ': 'c', 'ϳ': 'j', 'β': 'b', 'η': 'n', 'μ': 'u', 'ω': 'w',
  // Armenian
  'օ': 'o', 'ո': 'n', 'ս': 'u', 'ց': 'g', 'հ': 'h', 'ա': 'a', 'ք': 'p', 'գ': 'q', 'լ': 'l',
  // Latin lookalikes
  'ı': 'i', 'ɩ': 'i', 'ł': 'l', 'ƅ': 'b', 'ǝ': 'e', 'ɑ': 'a', 'ɢ': 'g', 'ⅼ': 'l', 'ｏ': 'o',
};
