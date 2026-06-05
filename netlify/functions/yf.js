const https = require('https');
const http = require('http');
const url_module = require('url');
const zlib = require('zlib');

function fetchUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    const parsedUrl = url_module.parse(targetUrl);
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.path,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
      }
    };

    const req = lib.request(options, (res) => {
      // Handle redirects
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const encoding = res.headers['content-encoding'];
        
        if (encoding === 'gzip') {
          zlib.gunzip(buffer, (err, decoded) => {
            if (err) resolve(buffer.toString());
            else resolve(decoded.toString());
          });
        } else if (encoding === 'deflate') {
          zlib.inflate(buffer, (err, decoded) => {
            if (err) resolve(buffer.toString());
            else resolve(decoded.toString());
          });
        } else {
          resolve(buffer.toString());
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const { type, symbols, symbol, range, interval } = event.queryStringParameters || {};

  let targetUrl;
  if (type === 'quote') {
    targetUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume,marketCap,fiftyTwoWeekHigh,fiftyTwoWeekLow,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,regularMarketPreviousClose,longName,shortName,currency,averageVolume,trailingPE`;
  } else if (type === 'chart') {
    targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range||'1y'}&interval=${interval||'1wk'}&includePrePost=false`;
  } else if (type === 'search') {
    targetUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=8&newsCount=0`;
  } else {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid type' }) };
  }

  try {
    const data = await fetchUrl(targetUrl);
    return { statusCode: 200, headers: corsHeaders, body: data };
  } catch (e) {
    // Try backup URL
    try {
      const backupUrl = targetUrl.replace('query1.finance.yahoo.com', 'query2.finance.yahoo.com');
      const data = await fetchUrl(backupUrl);
      return { statusCode: 200, headers: corsHeaders, body: data };
    } catch (e2) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: e2.message }) };
    }
  }
};
