// Cloudflare Worker — proxy CORS minimal pour Reco Invest.
// Usage : https://<ton-worker>.workers.dev/?url=<url encodée en URI>
const ALLOWED_HOSTS = [
  'www.lerevenu.com',
  'query1.finance.yahoo.com',
  'fc.yahoo.com',
  'www.zonebourse.com',
  'www.tradingview.com',
  'stockanalysis.com',
  'news.google.com',
];

export default {
  async fetch(request) {
    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');
    if (!target) return new Response('Missing "url" query param', { status: 400 });

    let targetUrl;
    try { targetUrl = new URL(target); } catch (e) {
      return new Response('Invalid url', { status: 400 });
    }
    if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
      return new Response('Host not allowed', { status: 403 });
    }

    try {
      const upstream = await fetch(targetUrl.toString(), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RecoInvestProxy/1.0)' },
        redirect: 'follow',
      });
      const body = await upstream.arrayBuffer();
      return new Response(body, {
        status: upstream.status,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': upstream.headers.get('content-type') || 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    } catch (e) {
      return new Response('Upstream fetch failed: ' + e.message, { status: 502 });
    }
  },
};
