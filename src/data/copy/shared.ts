/**
 * Frequently asked questions for each generator page.
 *
 * Each page's copy lives in its own module in this folder, so a page downloads only its own text.
 * The answers are rendered as text in the prerendered HTML (see `SidebarContent`) and as
 * FAQPage structured data (see `schemaGenerator`), so every statement here must stay true
 * to what the generator encodes and to the privacy pledge in `src/data/pledge.ts`.
 */

/** One question and its answer. */
export interface Faq {
  question: string;
  answer: string;
}

/** Shared answer: a static QR code has no server behind it, so it cannot be switched off. */
export const NEVER_EXPIRES: Faq = {
  question: 'Will this QR code ever expire or stop working?',
  answer:
    'No. QRCraftly makes static QR codes: the information is stored in the pattern itself, not behind a redirect link on our servers. There is no trial, no subscription and nothing we could switch off, so the code keeps working for as long as the information in it is still correct.',
};

/**
 * Shared answer about where the typed data goes.
 * @param what - What the user types in, e.g. "your Wi-Fi password".
 * @returns The FAQ entry.
 */
export const staysInBrowser = (what: string): Faq => ({
  question: `Is ${what} sent to QRCraftly?`,
  answer: `No. The QR code is generated in your browser, and ${what} is never uploaded, stored or logged by us. QRCraftly has no accounts, no ads and no analytics.`,
});
