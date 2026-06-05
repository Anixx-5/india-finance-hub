const https = require('https');
const zlib = require('zlib');

function get(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate',
      }
    };
    const req = https.request(opts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'];
        if (enc === 'gzip') {
          zlib.gunzip(buf, (e, d) => resolve(e ? buf.toString() : d.toString()));
        } else {
          resolve(buf.toString());
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

// Parse Stooq CSV into quote object
function parseStooq(csv, symbol) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return null;
  const parts = lines[1].split(',');
  if (parts.length < 7) return null;
  const [sym, date, time, open, high, low, close, volume] = parts;
  const c = parseFloat(close);
  const o = parseFloat(open);
  const h = parseFloat(high);
  const l = parseFloat(low);
  const vol = parseInt(volume) || 0;
  const prevClose = o; // approximate
  const change = c - prevClose;
  const changePct = (change / prevClose) * 100;
  return {
    symbol,
    regularMarketPrice: c,
    regularMarketOpen: o,
    regularMarketDayHigh: h,
    regularMarketDayLow: l,
    regularMarketChange: parseFloat(change.toFixed(2)),
    regularMarketChangePercent: parseFloat(changePct.toFixed(2)),
    regularMarketVolume: vol,
    regularMarketPreviousClose: prevClose,
    shortName: symbol.replace('.NS','').replace('.BO',''),
    currency: 'INR',
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const { type, symbols, symbol, range, interval } = event.queryStringParameters || {};

  try {
    if (type === 'quote') {
      const symList = symbols.split(',');
      const results = await Promise.allSettled(
        symList.map(async sym => {
          const stooqSym = sym.toLowerCase();
          const url = `https://stooq.com/q/l/?s=${stooqSym}&f=sd2t2ohlcvn&h&e=csv`;
          const csv = await get(url);
          return parseStooq(csv, sym);
        })
      );
      const quotes = results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ quoteResponse: { result: quotes } })
      };
    }

    if (type === 'chart') {
      // Use Stooq historical data
      const rangeMap = { '1d': 5, '5d': 5, '1mo': 30, '3mo': 90, '6mo': 180, '1y': 365, '2y': 730, '5y': 1825, '10y': 3650, 'max': 7300 };
      const days = rangeMap[range] || 365;
      const endDate = new Date();
      const startDate = new Date(endDate - days * 86400000);
      const fmt = d => d.toISOString().slice(0,10).replace(/-/g,'');
      const stooqSym = symbol.toLowerCase();
      const url = `https://stooq.com/q/d/l/?s=${stooqSym}&d1=${fmt(startDate)}&d2=${fmt(endDate)}&i=d`;
      const csv = await get(url);
      const lines = csv.trim().split('\n').slice(1);
      const timestamps = [], opens = [], highs = [], lows = [], closes = [], volumes = [];
      for (const line of lines) {
        const [date, open, high, low, close, vol] = line.split(',');
        if (!date || !close || isNaN(parseFloat(close))) continue;
        const d = new Date(date);
        timestamps.push(Math.floor(d.getTime() / 1000));
        opens.push(parseFloat(open));
        highs.push(parseFloat(high));
        lows.push(parseFloat(low));
        closes.push(parseFloat(close));
        volumes.push(parseInt(vol) || 0);
      }
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          chart: {
            result: [{
              timestamp: timestamps,
              indicators: { quote: [{ open: opens, high: highs, low: lows, close: closes, volume: volumes }] }
            }]
          }
        })
      };
    }

    if (type === 'search') {
      // Simple search from our known symbols list
      const known = [
        { symbol: 'RELIANCE.NS', description: 'Reliance Industries', type: 'EQY' },
        { symbol: 'TCS.NS', description: 'Tata Consultancy Services', type: 'EQY' },
        { symbol: 'INFY.NS', description: 'Infosys', type: 'EQY' },
        { symbol: 'HDFCBANK.NS', description: 'HDFC Bank', type: 'EQY' },
        { symbol: 'ICICIBANK.NS', description: 'ICICI Bank', type: 'EQY' },
        { symbol: 'SBIN.NS', description: 'State Bank of India', type: 'EQY' },
        { symbol: 'WIPRO.NS', description: 'Wipro', type: 'EQY' },
        { symbol: 'BAJFINANCE.NS', description: 'Bajaj Finance', type: 'EQY' },
        { symbol: 'TATAMOTORS.NS', description: 'Tata Motors', type: 'EQY' },
        { symbol: 'ADANIENT.NS', description: 'Adani Enterprises', type: 'EQY' },
        { symbol: 'MARUTI.NS', description: 'Maruti Suzuki', type: 'EQY' },
        { symbol: 'SUNPHARMA.NS', description: 'Sun Pharma', type: 'EQY' },
        { symbol: 'TITAN.NS', description: 'Titan Company', type: 'EQY' },
        { symbol: 'KOTAKBANK.NS', description: 'Kotak Mahindra Bank', type: 'EQY' },
        { symbol: 'LT.NS', description: 'Larsen & Toubro', type: 'EQY' },
        { symbol: 'AXISBANK.NS', description: 'Axis Bank', type: 'EQY' },
        { symbol: 'NIFTYBEES.NS', description: 'Nippon Nifty BeES ETF', type: 'ETF' },
        { symbol: 'GOLDBEES.NS', description: 'Nippon Gold BeES ETF', type: 'ETF' },
        { symbol: 'BANKBEES.NS', description: 'Nippon Bank BeES ETF', type: 'ETF' },
      ];
      const q = (symbol || '').toLowerCase();
      const results = known.filter(s =>
        s.symbol.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
      );
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ quotes: results }) };
    }

    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid type' }) };

  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};






