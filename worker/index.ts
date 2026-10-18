/**
 * Optional Cloudflare Worker. Deploy separately; GitHub Pages cannot host a Worker.
 * Configure VITE_PRODUCT_API_BASE with this Worker's URL.
 * Production traffic needs additional rate limiting/monitoring.
 */
const allowOrigins = new Set([
  'https://emirozyilmaz.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);

export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get('Origin') ?? '';
    const cors = allowOrigins.has(origin) ? origin : 'https://emirozyilmaz.github.io';
    const headers = {
      'Access-Control-Allow-Origin': cors,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers });
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/product\/(\d{8,14})$/);
    if (!match) return new Response('Not found', { status: 404, headers });
    const code = match[1];
    const upstream = `https://world.openfoodfacts.org/api/v3/product/${code}?fields=code,product_name,brands,quantity,image_front_small_url,ingredients_text,ingredients_text_tr,ingredients_text_en,nutriments,nutriscore_grade,nova_group,allergens_tags,additives_tags`;
    try {
      const result = await fetch(upstream, {
        headers: { 'User-Agent': 'GidaPusulasi/0.1 (https://github.com/emirozyilmaz/gida-pusulasi)' },
        cf: { cacheEverything: true, cacheTtl: 43200 }
      } as RequestInit);
      return new Response(result.body, {
        status: result.status,
        headers: {
          ...headers,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=3600'
        }
      });
    } catch {
      return new Response(JSON.stringify({ error: 'upstream_unavailable' }), {
        status: 502,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
  }
};
