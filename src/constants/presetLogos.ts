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

export interface PresetLogo {
  id: string;
  label: string;
  category: 'social' | 'messaging' | 'payment' | 'general';
  dataUrl: string;
}

export const PRESET_LOGO_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'social', label: 'Social' },
  { id: 'messaging', label: 'Messaging' },
  { id: 'payment', label: 'Payment' },
  { id: 'general', label: 'General' },
] as const;

export type PresetCategory = typeof PRESET_LOGO_CATEGORIES[number]['id'];

function makeSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
}

export const PRESET_LOGOS: PresetLogo[] = [
  // --- Social ---
  {
    id: 'instagram',
    label: 'Instagram',
    category: 'social',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <defs>
          <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#fdf497"/>
            <stop offset="5%" stop-color="#fdf497"/>
            <stop offset="45%" stop-color="#fd5949"/>
            <stop offset="60%" stop-color="#d6249f"/>
            <stop offset="100%" stop-color="#285AEB"/>
          </linearGradient>
        </defs>
        <rect width="24" height="24" rx="6" fill="url(#ig-grad)"/>
        <rect x="5" y="5" width="14" height="14" rx="4" fill="none" stroke="#ffffff" stroke-width="1.8"/>
        <circle cx="12" cy="12" r="3.2" fill="none" stroke="#ffffff" stroke-width="1.8"/>
        <circle cx="15.8" cy="8.2" r="0.9" fill="#ffffff"/>
      </svg>
    `),
  },
  {
    id: 'twitter-x',
    label: 'Twitter / X',
    category: 'social',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#000000"/>
        <path d="M14.25 10.15L19.2 4.5h-1.17l-4.3 4.93L10.3 4.5H6.33l5.19 7.42-5.19 5.92h1.17l4.54-5.2 3.63 5.2h3.97l-5.39-7.69zm-1.6 1.83l-.52-.74-4.17-5.96h1.8l3.35 4.79.52.74 4.38 6.26h-1.8l-3.56-5.09z" fill="#ffffff"/>
      </svg>
    `),
  },
  {
    id: 'facebook',
    label: 'Facebook',
    category: 'social',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#1877F2"/>
        <path d="M14 13.5l.5-3H11.5V8.5c0-.83.23-1.5 1.5-1.5h1.5V4.3C14.2 4.2 13.3 4 12.3 4 9.8 4 8 5.6 8 8.4v2.1H5.5v3H8V20h3.5v-6.5H14z" fill="#ffffff"/>
      </svg>
    `),
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    category: 'social',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#0A66C2"/>
        <path d="M6.5 8.5h3V18h-3V8.5zM8 5a1.75 1.75 0 100 3.5A1.75 1.75 0 008 5zm6.5 3.5c-1.8 0-2.5 1-2.9 1.6V8.5h-2.8V18h2.9v-4.7c0-1.2.2-2.4 1.7-2.4 1.5 0 1.5 1.4 1.5 2.5V18h2.9v-5.2c0-2.6-.6-4.3-3.3-4.3z" fill="#ffffff"/>
      </svg>
    `),
  },
  {
    id: 'youtube',
    label: 'YouTube',
    category: 'social',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#FF0000"/>
        <path d="M10 8.5v7l6-3.5-6-3.5z" fill="#ffffff"/>
      </svg>
    `),
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    category: 'social',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#010101"/>
        <path d="M16.6 8.2c-.9-.6-1.5-1.5-1.7-2.5h-2.4v10.3c0 1.5-1.2 2.7-2.7 2.7S7.1 17.5 7.1 16s1.2-2.7 2.7-2.7c.3 0 .6.1.9.2V11c-.3 0-.6-.1-.9-.1-2.8 0-5.1 2.3-5.1 5.1s2.3 5.1 5.1 5.1 5.1-2.3 5.1-5.1V9.7c1.1.8 2.5 1.2 3.9 1.2V8.5c-.8 0-1.6-.1-2.2-.3z" fill="#ffffff"/>
      </svg>
    `),
  },
  {
    id: 'github',
    label: 'GitHub',
    category: 'social',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#181717"/>
        <path d="M12 4a8 8 0 00-2.5 15.6c.4.1.5-.2.5-.4v-1.4c-2.2.5-2.7-1.1-2.7-1.1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.2-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8.6-.2 1.3-.3 2-.3s1.4.1 2 .3c1.5-1 2.2-.8 2.2-.8.5 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.2 0 3.1-1.9 3.8-3.7 4 .3.3.6.8.6 1.6v2.4c0 .2.1.5.6.4A8 8 0 0012 4z" fill="#ffffff"/>
      </svg>
    `),
  },

  // --- Messaging ---
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    category: 'messaging',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#25D366"/>
        <path d="M12 4.5A7.5 7.5 0 005.5 16l-.8 2.9 3-0.8A7.5 7.5 0 1012 4.5zm0 13.7c-1.1 0-2.1-.3-3-.8l-.2-.1-2.2.6.6-2.1-.1-.2A6.2 6.2 0 1112 18.2zm3.4-4.6c-.2-.1-1.1-.6-1.3-.6s-.3.1-.4.3-.5.6-.6.8-.2.2-.4.1a5.2 5.2 0 01-1.5-.9 5.8 5.8 0 01-1.1-1.3c-.1-.2 0-.3.1-.4l.3-.3c.1-.1.2-.2.2-.3s0-.2 0-.3-.4-1.1-.6-1.5c-.2-.4-.3-.3-.4-.3h-.4c-.1 0-.4.1-.6.3a2.6 2.6 0 00-.8 1.9c0 1.1.8 2.2 1 2.3.1.2 1.6 2.5 4 3.5.6.2 1 .4 1.4.5.6.2 1.1.2 1.6.1.5-.1 1.1-.5 1.3-1s.2-.9.1-1c-.1-.1-.2-.2-.4-.3z" fill="#ffffff"/>
      </svg>
    `),
  },
  {
    id: 'telegram',
    label: 'Telegram',
    category: 'messaging',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#229ED9"/>
        <path d="M17.8 6.2L4.7 11.3c-.9.4-.9.9-.1 1.1l3.4 1.1 1.2 3.7c.1.4.3.4.6.2l1.7-1.6 3.5 2.6c.6.4 1.1.2 1.3-.5l2.3-10.7c.2-.9-.3-1.3-1-.9zM9.4 13.9l6.5-4.1c.3-.2.6-.1.4.1l-5.3 4.8-.2 2.3-.9-2.1-.5-.2z" fill="#ffffff"/>
      </svg>
    `),
  },
  {
    id: 'messenger',
    label: 'Messenger',
    category: 'messaging',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <defs>
          <linearGradient id="msg-grad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#0069FF"/>
            <stop offset="50%" stop-color="#A033FF"/>
            <stop offset="100%" stop-color="#FF5280"/>
          </linearGradient>
        </defs>
        <rect width="24" height="24" rx="6" fill="url(#msg-grad)"/>
        <path d="M12 4.5C7.9 4.5 4.5 7.6 4.5 11.4c0 2.2 1.1 4.1 2.8 5.3v2.8l2.6-1.4c.7.2 1.4.3 2.1.3 4.1 0 7.5-3.1 7.5-6.9S16.1 4.5 12 4.5zm1.2 9.3l-2.1-2.2-4.1 2.2 4.5-4.8 2.1 2.2 4.1-2.2-4.5 4.8z" fill="#ffffff"/>
      </svg>
    `),
  },
  {
    id: 'discord',
    label: 'Discord',
    category: 'messaging',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#5865F2"/>
        <path d="M16.7 7.5a11.3 11.3 0 00-2.8-.9c-.1.2-.3.5-.4.7-1.1-.2-2.1-.2-3.1 0-.1-.2-.3-.5-.4-.7a11.3 11.3 0 00-2.8.9C5.5 10 5 12.5 5.3 15a11.4 11.4 0 003.5 1.8c.3-.4.5-.8.7-1.3-.4-.2-.8-.4-1.1-.6.1-.1.2-.1.3-.2 2.2 1 4.6 1 6.8 0 .1.1.2.1.3.2-.3.2-.7.4-1.1.6.2.5.5.9.7 1.3a11.4 11.4 0 003.5-1.8c.4-2.9-.3-5.3-1.9-7.5zM9.8 13.7c-.7 0-1.3-.6-1.3-1.4s.6-1.4 1.3-1.4 1.3.6 1.3 1.4-.6 1.4-1.3 1.4zm4.4 0c-.7 0-1.3-.6-1.3-1.4s.6-1.4 1.3-1.4 1.3.6 1.3 1.4-.6 1.4-1.3 1.4z" fill="#ffffff"/>
      </svg>
    `),
  },

  // --- Payment ---
  {
    id: 'paypal',
    label: 'PayPal',
    category: 'payment',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#003087"/>
        <path d="M8.2 18.5l.8-5.3h2.3c2.3 0 3.8-1.1 4.2-3.3.3-1.8-.4-3.1-2.4-3.1H8.5c-.3 0-.5.2-.6.5L6 18.2c0 .2.2.3.4.3h1.8z" fill="#0079C1"/>
        <path d="M9.5 14.8l.6-3.8h2.3c1.6 0 2.7-.8 3-2.3.2-1.3-.2-2.2-1.7-2.2H9.2c-.3 0-.5.2-.6.5L7.2 16.5c0 .2.2.3.4.3h1.3c.3 0 .5-.2.6-.5z" fill="#00457C"/>
      </svg>
    `),
  },
  {
    id: 'bitcoin',
    label: 'Bitcoin',
    category: 'payment',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#F7931A"/>
        <path d="M15.2 11.2c.4-.5.6-1.2.4-2-.3-1.2-1.4-1.7-2.8-1.7V6h-1.2v1.4h-1V6H9.4v1.5H7.5v1.2h1.2c.3 0 .4.1.4.3v6c0 .2-.1.3-.4.3H7.5v1.2h1.9V19h1.2v-1.4h1v1.4h1.2v-1.4c1.8 0 3.2-.6 3.4-2.2.2-1.1-.3-2-1-2.2zM10.8 8.7h2c.7 0 1.3.3 1.1 1s-.7 1-1.4 1h-1.7V8.7zm2.4 6.6h-2.4v-2.2h2.4c.8 0 1.5.4 1.3 1.1-.2.8-.8 1.1-1.3 1.1z" fill="#ffffff"/>
      </svg>
    `),
  },

  // --- General ---
  {
    id: 'website',
    label: 'Website',
    category: 'general',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#2563EB"/>
        <circle cx="12" cy="12" r="7" fill="none" stroke="#ffffff" stroke-width="1.5"/>
        <path d="M5 12h14M12 5a12 12 0 010 14a12 12 0 010-14z" fill="none" stroke="#ffffff" stroke-width="1.5"/>
      </svg>
    `),
  },
  {
    id: 'email',
    label: 'Email',
    category: 'general',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#EA4335"/>
        <rect x="5" y="7" width="14" height="10" rx="2" fill="none" stroke="#ffffff" stroke-width="1.6"/>
        <path d="M5.5 8l6.5 5 6.5-5" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `),
  },
  {
    id: 'phone',
    label: 'Phone',
    category: 'general',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#16A34A"/>
        <path d="M8.5 6.5h2l1 3-1.2 1.2a10.5 10.5 0 004 4l1.2-1.2 3 1v2a1.5 1.5 0 01-1.5 1.5C10.8 20 4 13.2 4 6.5A1.5 1.5 0 015.5 5h2z" fill="#ffffff"/>
      </svg>
    `),
  },
  {
    id: 'location',
    label: 'Location',
    category: 'general',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#E11D48"/>
        <path d="M12 5a4.5 4.5 0 00-4.5 4.5c0 3.4 4.5 9.5 4.5 9.5s4.5-6.1 4.5-9.5A4.5 4.5 0 0012 5zm0 6a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" fill="#ffffff"/>
      </svg>
    `),
  },
];
