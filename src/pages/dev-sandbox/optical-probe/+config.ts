// The sandbox folder is not prerendered; the probe is, so a deployed build can serve it. It still
// stays out of the sitemap and robots.txt because its path starts with /dev-sandbox.
export default { prerender: true };
