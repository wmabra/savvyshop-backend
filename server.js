// SavvyShop Backend — search stores, scrape product pages, return live data

import express from 'express';
import { chromium } from 'playwright';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Store search URL templates
const STORES = [
  { name: 'Walmart', search: (q) => `https://www.walmart.com/search?q=${encodeURIComponent(q)}`, domain: 'walmart.com' },
  { name: 'Target', search: (q) => `https://www.target.com/s?searchTerm=${encodeURIComponent(q)}`, domain: 'target.com' },
  { name: 'Best Buy', search: (q) => `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(q)}`, domain: 'bestbuy.com' },
  { name: 'Home Depot', search: (q) => `https://www.homedepot.com/s/${encodeURIComponent(q)}`, domain: 'homedepot.com' },
  { name: "Lowe's", search: (q) => `https://www.lowes.com/search?searchTerm=${encodeURIComponent(q)}`, domain: 'lowes.com' },
  { name: 'Costco', search: (q) => `https://www.costco.com/CatalogSearch?keyword=${encodeURIComponent(q)}`, domain: 'costco.com' },
  { name: 'Newegg', search: (q) => `https://www.newegg.com/p/pl?d=${encodeURIComponent(q)}`, domain: 'newegg.com' },
  { name: 'eBay', search: (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`, domain: 'ebay.com' },
];

// Clean title to a searchable short query (brand + model only)
function cleanTitle(title) {
  return title
    .replace(/[()]/g, ' ')
    .replace(/[|].*$/, '')
    .replace(/[,/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(' ');
}

// Extract product info from a store product page using Playwright
async function scrapeProductPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000); // Let dynamic content load

    return await page.evaluate(() => {
      const host = window.location.hostname;

      // Schema.org
      const schemas = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of schemas) {
        try {
          const d = JSON.parse(s.textContent);
          const p = d['@graph']?.find(i => i['@type'] === 'Product') || d;
          if (p['@type'] !== 'Product' && p['@type'] !== 'ProductGroup') continue;
          let o = p.offers;
          if (!o && p.hasVariant) {
            const v = Array.isArray(p.hasVariant) ? p.hasVariant[0] : p.hasVariant;
            if (v) { o = v.offers; if (v.name && !p.name) p.name = v.name; }
          }
          const price = o?.price ? parseFloat(o.price) : null;
          if (!price || price < 1 || price > 50000) continue;
          return {
            title: p.name,
            price: '$' + o.price,
            rating: p.aggregateRating?.ratingValue || null,
            reviews: p.aggregateRating?.reviewCount || null,
            url: window.location.href,
          };
        } catch(e) {}
      }

      // Amazon fallback
      if (host.includes('amazon')) {
        const t = document.getElementById('productTitle')?.textContent?.trim();
        const pw = document.querySelector('.a-price-whole');
        if (!t || !pw) return null;
        let raw = pw.textContent.trim().replace(/[^\d,]/g, '');
        const pf = document.querySelector('.a-price-fraction');
        if (pf) raw += '.' + pf.textContent.trim().replace(/[^\d]/g, '');
        return {
          title: t.substring(0, 200),
          price: '$' + raw,
          rating: parseFloat(document.getElementById('acrPopover')?.title?.match(/(\d+\.?\d*)/)?.[1]) || null,
          reviews: parseInt((document.getElementById('acrCustomerReviewText')?.textContent?.match(/[\d,]+/)?.[0] || '').replace(/,/g, '')) || null,
          url: window.location.href,
        };
      }

      // Generic fallback — find price
      const priceEl = document.querySelector('[itemprop="price"], .price, [data-testid="price"], [data-testid="price-wrap"]');
      if (priceEl) {
        const raw = priceEl.textContent.trim().replace(/[^\d.]/g, '');
        if (raw && parseFloat(raw) > 0) {
          return {
            title: document.querySelector('h1')?.textContent?.trim() || document.title,
            price: '$' + raw,
            rating: null,
            reviews: null,
            url: window.location.href,
          };
        }
      }

      return null;
    });
  } catch(e) {
    return null;
  }
}

// Find first product link on a store search page
async function findFirstProductLink(page, searchUrl) {
  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    return await page.evaluate(() => {
      const host = window.location.hostname;

      if (host.includes('amazon')) {
        const el = document.querySelector('[data-component-type="s-search-result"] h2 a');
        return el ? el.href : null;
      }
      if (host.includes('walmart')) {
        const el = document.querySelector('a[href*="/ip/"]');
        return el ? el.href : null;
      }
      if (host.includes('target')) {
        const el = document.querySelector('a[href*="/p/"], a[href*="/A-"]');
        return el ? el.href : null;
      }
      if (host.includes('bestbuy')) {
        const el = document.querySelector('.sku-title a, a[href*="/site/"]');
        return el ? el.href : null;
      }
      if (host.includes('homedepot')) {
        const el = document.querySelector('a[href*="/p/"]');
        return el ? el.href : null;
      }
      if (host.includes('lowes')) {
        const el = document.querySelector('a[href*="/pd/"], a[href*="/product/"]');
        return el ? el.href : null;
      }
      // Universal fallback
      const links = document.querySelectorAll('a[href*="/p/"], a[href*="/ip/"], a[href*="/product/"], a[href*="/dp/"]');
      for (const l of links) {
        if (l.textContent.trim().length > 10 && l.href.startsWith('http')) return l.href;
      }
      return null;
    });
  } catch(e) {
    return null;
  }
}

// Main comparison endpoint
app.post('/compare', async (req, res) => {
  const { title, domain } = req.body;
  if (!title) return res.status(400).json({ error: 'Product title required' });

  const query = cleanTitle(title);
  console.log(`Comparing: "${query}" (skip: ${domain})`);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const results = [];

    for (const store of STORES) {
      if (domain && store.domain.includes(domain.replace('www.', ''))) {
        console.log(`  Skip ${store.name} (same as original)`);
        continue;
      }
      if (results.length >= 5) break;

      try {
        const page = await browser.newPage();
        await page.setExtraHTTPHeaders({
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        // Step 1: Search the store
        const searchUrl = store.search(query);
        const productLink = await findFirstProductLink(page, searchUrl);

        if (productLink) {
          // Step 2: Go to product page and scrape
          const data = await scrapeProductPage(page, productLink);
          if (data) {
            results.push({ store: store.name, ...data });
            console.log(`  ✓ ${store.name}: ${data.price} — ${(data.title || '').substring(0, 40)}`);
          }
        }
        await page.close();
      } catch(e) {
        console.log(`  ✗ ${store.name}: ${e.message}`);
      }
    }

    console.log(`Done: ${results.length} products found`);
    res.json({ success: true, products: results });
  } catch(e) {
    console.error('Fatal:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    if (browser) await browser.close();
  }
});

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', service: 'SavvyShop Backend' }));

app.listen(PORT, () => console.log(`SavvyShop backend on port ${PORT}`));
