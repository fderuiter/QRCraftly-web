/**
 * The one address for questions and security reports. Every page that
 * offers a way to reach QRCraftly reads it from here. Links write the `mailto:` address as a
 * literal, because every dynamic href must pass `isDangerousUrl`.
 */
export const CONTACT_ADDRESS = 'hello@qrcraftly.com';
