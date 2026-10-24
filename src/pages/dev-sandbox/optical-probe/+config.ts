// The sandbox folder is never prerendered. The probe is prerendered only when the build turns on
// `VITE_OPTICAL_MODEM` (#1619), so a normal production build ships no page at this path and the
// static host answers 404. robots.txt disallows /dev-sandbox and the sitemap skips it either way.
export default { prerender: process.env.VITE_OPTICAL_MODEM === 'true' };
