import express from "express";
import puppeteer from "puppeteer";

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

const STORES = [
	{
		name: "Walmart",
		url: "https://www.walmart.com/search?q=",
		sel: 'a[href*="/ip/"]',
	},
	{
		name: "Target",
		url: "https://www.target.com/s?searchTerm=",
		sel: 'a[href*="/p/"], a[href*="/A-"]',
	},
	{
		name: "Best Buy",
		url: "https://www.bestbuy.com/site/searchpage.jsp?st=",
		sel: '.sku-title a, a[href*="/site/"]',
	},
	{
		name: "Home Depot",
		url: "https://www.homedepot.com/s/",
		sel: 'a[href*="/p/"]',
	},
];

function clean(t) {
	return t
		.replace(/[()]/g, " ")
		.replace(/[|].*$/, "")
		.replace(/[,/-]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.split(/\s+/)
		.slice(0, 4)
		.join(" ");
}

app.post("/compare", async (req, res) => {
	const { title, domain } = req.body;
	if (!title) return res.status(400).json({ error: "title required" });
	const q = clean(title);
	let b;
	const results = [];
	try {
		b = await puppeteer.launch({
			headless: "new",
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		});
		for (const s of STORES) {
			if (
				domain &&
				s.name.toLowerCase().includes(domain.replace("www.", "").split(".")[0])
			)
				continue;
			try {
				const p = await b.newPage();
				await p.setUserAgent(
					"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0",
				);
				const u = s.url + encodeURIComponent(q);
				await p.goto(u, { waitUntil: "domcontentloaded", timeout: 15000 });
				await new Promise((r) => setTimeout(r, 3000));
				// Try to find first product link
				const d = await p.evaluate((sel) => {
					const el = document.querySelector(sel);
					return el
						? {
								link: el.href || el.parentElement?.href,
								text: el.textContent?.trim(),
							}
						: null;
				}, s.sel);
				if (d)
					results.push({
						store: s.name,
						title: d.text?.substring(0, 100) || title,
						url: d.link || u,
					});
				await p.close();
			} catch (e) {}
		}
		res.json({ success: true, products: results });
	} catch (e) {
		res.status(500).json({ error: e.message });
	} finally {
		if (b) await b.close();
	}
});

app.get("/", (_req, res) => res.json({ status: "ok" }));
app.listen(PORT, () => console.log("Backend on port " + PORT));
