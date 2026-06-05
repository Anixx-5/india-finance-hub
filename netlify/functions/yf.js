const https = require('https');
const zlib = require('zlib');

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      ...headers
    };
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: defaultHeaders
    };
    const req = https.request(opts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location, headers).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'];
        const decode = (b) => {
          try { return b.toString('utf8'); } catch { return '{}'; }
        };
        if (enc === 'gzip') {
          zlib.gunzip(buf, (e, d) => e ? resolve(decode(buf)) : resolve(d.toString('utf8')));
        } else if (enc === 'br') {
          zlib.brotliDecompress(buf, (e, d) => e ? resolve(decode(buf)) : resolve(d.toString('utf8')));
        } else if (enc === 'deflate') {
          zlib.inflate(buf, (e, d) => e ? resolve(decode(buf)) : resolve(d.toString('utf8')));
        } else {
          resolve(decode(buf));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const { type, symbols, symbol, range, interval } = event.queryStringParameters || {};

  // Try multiple Yahoo Finance endpoints
  const YF_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Origin': 'https://finance.yahoo.com',
    'Referer': 'https://finance.yahoo.com/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
  };

  let urls = [];
  if (type === 'quote') {
    const fields = 'regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume,marketCap,fiftyTwoWeekHigh,fiftyTwoWeekLow,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,regularMarketPreviousClose,longName,shortName,currency,averageVolume,trailingPE';
    urls = [
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=${fields}`,
      `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=${fields}`,
      `https://query1.finance.yahoo.com/v8/finance/quote?symbols=${symbols}&fields=${fields}`,
    ];
  } else if (type === 'chart') {
    urls = [
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range||'1y'}&interval=${interval||'1wk'}&includePrePost=false`,
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range||'1y'}&interval=${interval||'1wk'}&includePrePost=false`,
    ];
  } else if (type === 'search') {
    urls = [
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=8&newsCount=0`,
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=8&newsCount=0`,
    ];
  }

  for (const url of urls) {
    try {
      const data = await get(url, YF_HEADERS);
      if (data && data.length > 10 && !data.includes('"code":"Too Many Requests"') && !data.includes('"error"')) {
        return { statusCode: 200, headers: CORS, body: data };
      }
    } catch (e) { continue; }
  }

  return { statusCode: 503, headers: CORS, body: JSON.stringify({ error: 'All sources failed' }) };
};
