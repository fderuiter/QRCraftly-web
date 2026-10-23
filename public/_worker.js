export default {
  /**
   * Cloudflare Worker fetch handler.
   * Dynamically appends `X-Robots-Tag: noindex` to HTTP responses for non-canonical hosts
   * (preview environments and workers.dev domains) to protect search engine indexing authority.
   *
   * @param {Request} request
   * @param {{ ASSETS?: { fetch: (req: Request) => Promise<Response> } }} env
   * @param {object} [ctx]
   * @returns {Promise<Response>}
   */
  async fetch(request, env, _ctx) {
    const response = env?.ASSETS ? await env.ASSETS.fetch(request) : await fetch(request);
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();

    if (hostname !== 'qrcraftly.com') {
      const newHeaders = new Headers(response.headers);
      newHeaders.set('X-Robots-Tag', 'noindex');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }

    return response;
  },
};
