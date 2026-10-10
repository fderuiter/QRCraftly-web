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

// Generic marks only: no third-party brand logos or lookalikes (#1368). People who want
// a brand's own logo upload it themselves.
export const PRESET_LOGOS: PresetLogo[] = [
  // --- Social ---
  {
    id: 'network',
    label: 'Network',
    category: 'social',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#7C3AED"/>
        <path d="M8.6 10.9l6.8-3.6M8.6 13.1l6.8 3.6" fill="none" stroke="#ffffff" stroke-width="1.6"/>
        <circle cx="7.5" cy="12" r="2.2" fill="#ffffff"/>
        <circle cx="16.5" cy="6.8" r="2.2" fill="#ffffff"/>
        <circle cx="16.5" cy="17.2" r="2.2" fill="#ffffff"/>
      </svg>
    `),
  },
  {
    id: 'profile',
    label: 'Profile',
    category: 'social',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#0F766E"/>
        <circle cx="12" cy="9.5" r="3.2" fill="#ffffff"/>
        <path d="M6 18.5c.8-3 3.2-4.6 6-4.6s5.2 1.6 6 4.6z" fill="#ffffff"/>
      </svg>
    `),
  },
  {
    id: 'video',
    label: 'Video',
    category: 'social',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#475569"/>
        <path d="M9.5 8v8l7-4z" fill="#ffffff"/>
      </svg>
    `),
  },

  // --- Messaging ---
  {
    id: 'chat',
    label: 'Chat',
    category: 'messaging',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#D97706"/>
        <path d="M6 7.5A1.5 1.5 0 017.5 6h9A1.5 1.5 0 0118 7.5v6a1.5 1.5 0 01-1.5 1.5H11l-3.5 3v-3h0A1.5 1.5 0 016 13.5z" fill="#ffffff"/>
      </svg>
    `),
  },
  {
    id: 'send',
    label: 'Send',
    category: 'messaging',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#4F46E5"/>
        <path d="M5.5 11.5l13-5.5-4 12.5-3-4.5z" fill="#ffffff"/>
        <path d="M11.5 14l7-8" fill="none" stroke="#4F46E5" stroke-width="1.2"/>
      </svg>
    `),
  },

  // --- Payment ---
  {
    id: 'card',
    label: 'Card',
    category: 'payment',
    dataUrl: makeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <rect width="24" height="24" rx="6" fill="#1E3A8A"/>
        <rect x="5" y="7" width="14" height="10" rx="1.8" fill="none" stroke="#ffffff" stroke-width="1.5"/>
        <path d="M5 10h14" stroke="#ffffff" stroke-width="1.8"/>
        <path d="M7.5 14.2h3" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round"/>
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
