import express from 'express';
import puppeteer from 'puppeteer';

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

const STORES = [
  { name: 'Walmart', search: (q) => `https://www.walmart.com/search?q=${encodeURIComponent(q)}`, domain: 'walmart.com' },
  { name: 'Target', search: (q) => `https://www.target.com/s?searchTerm=${encodeURIComponent(q)}`, domain: 'target.com' },
  { name: 'Best Buy', search: (q) => `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(q)}`, domain: 'bestbuy.com' },
  { name: 'Home Depot', search: (q) => `https://www.homedepot.com/s/${encodeURIComponent(q)}`, domain: 'homedepot.com' },
  { name: "Lowe's", search: (q) => `https://www.lowes.com/search?searchTerm=${encodeURIComponent(q)}`, domain: 'lowes.com' },
  { name: 'Costco', search: (q) => `https://www.costco.com/CatalogSearch?keyword=${encodeURIComponent(q)}`, domain: 'costco.com' },
  { name: 'Newegg', search: (q) => `https://www.newegg.com/p/pl?d=${encodeURIComponent(q)}`, domain: 'newegg.com' },
];

function cleanTitle(title) {
  return title.replace(/[()]/g,' ').replace(/[|].*$/,'').replace(/[,/-]/g,' ').replace(/\s+/g,' ').trim().split(/\s+/).slice(0,4).join(' ');
}

async function scrapeProductPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
    return await page.evaluate(() => {
      const host = window.location.hostname;
      const schemas = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of schemas) {
        try {
          const d = JSON.parse(s.textContent);
          const p = d['@graph']?.find(i => i['@type'] === 'Product') || d;
          if (p['@type'] !== 'Product' && p['@type'] !== 'ProductGroup') continue;
          let o = p.offers;
          if (!o && p.hasVariant) { const v = Array.isArray(p.hasVariant) ? p.hasVariant[0] : p.hasVariant; if (v) { o = v.offers; if (v.name && !p.name) p.name = v.name; } }
          const price = o?.price ? parseFloat(o.price) : null;
          if (!price || price < 1 || price > 50000) continue;
          return { title: p.name, price: '$' + o.price, rating: p.aggregateRating?.ratingValue || null, reviews: p.aggregateRating?.reviewCount || null, url: window.location.href };
        } catch(e) {}
      }
      if (host.includes('amazon')) {
        const t = document.getElementById('productTitle')?.textContent?.trim();
        const pw = document.querySelector('.a-price-whole');
        if (!t || !pw) return null;
        let raw = pw.textContent.trim().replace(/[^\d,]/g,'');
        const pf = document.querySelector('.a-price-fraction');
        if (pf) raw += '.' + pf.textContent.trim().replace(/[^\d]/g,'');
        return { title: t.substring(0, 200), price: '$' + raw, rating: parseFloat(document.getElementById('acrPopover')?.title?.match(/(\d+\.?\d*)/)?.[1]) || null, reviews: parseInt((document.getElementById('acrCustomerReviewText')?.textContent?.match(/[\d,]+/)?.[0] || '').replace(/,/g,'')) || null, url: window.location.href };
      }
      const priceEl = document.querySelector('[itemprop="price"], .price, [data-testid="price"]');
      if (priceEl) { const raw = priceEl.textContent.trim().replace(/[^\d.]/g,''); if (raw && parseFloat(raw) > 0) return { title: document.querySelector('h1')?.textContent?.trim() || document.title, price: '$' + raw, rating: null, reviews: null, url: window.location.href }; }
      return null;
    });
  } catch(e) { return null; }
}

async function findFirstProductLink(page, searchUrl) {
  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 3000));
    return await page.evaluate(() => {
      const host = window.location.hostname;
      if (host.includes('amazon')) { const el = document.querySelector('[data-component-type="s-search-result"] h2 a'); return el?.href || null; }
      if (host.includes('walmart')) { const el = document.querySelector('a[href*="/ip/"]'); return el?.href || null; }
      if (host.includes('target')) { const el = document.querySelector('a[href*="/p/"], a[href*="/A-"]'); return el?.href || null; }
      if (host.includes('bestbuy')) { const el = document.querySelector('.sku-title a, a[href*="/site/"]'); return el?.href || null; }
      if (host.includes('homedepot')) { const el = document.querySelector('a[href*="/p/"]'); return el?.href || null; }
      const links = document.querySelectorAll('a[href*="/p/"], a[href*="/ip/"], a[href*="/product/"], a[href*="/dp/"]');
      for (const l of links) { if (l.textContent.trim().length > 10 && l.href.startsWith('http')) return l.href; }
      return null;
    });
  } catch(e) { return null; }
}

app.post('/compare', async (req, res) => {
  const { title, domain } = req.body;
  if (!title) return res.status(400).json({ error: 'Product title required' });
  const query = cleanTitle(title);
  console.log(`Comparing: "${query}"`);

  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const results = [];
    for (const store of STORES) {
      if (domain && store.domain.includes(domain.replace('www.',''))) continue;
      if (results.length >= 5) break;
      try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        const link = await findFirstProductLink(page, store.search(query));
        if (link) {
          const data = await scrapeProductPage(page, link);
          if (data) { results.push({ store: store.name, ...data }); console.log(`  OK ${store.name}: ${data.price}`); }
        }
        await page.close();
      } catch(e) { console.log(`  FAIL ${store.name}: ${e.message}`); }
    }
    console.log(`Done: ${results.length} products`);
    res.json({ success: true, products: results });
  } catch(e) { res.status(500).json({ error: e.message }); }
  finally { if (browser) await browser.close(); }
});

app.get('/', (_req, res) => res.json({ status: 'ok' }));
app.listen(PORT, () => console.log(`Backend on port ${PORT}`));
