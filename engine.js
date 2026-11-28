(async () => {
  const DB = "https://signalsaham-9826a-default-rtdb.asia-southeast1.firebasedatabase.app";
  const IA = "ia_live_" + "23UjBBj4A-L4YF1Iihbln-AJ";
  const GR = "gsk_" + "WTfreY9SawK1JkdHWJm4WGdyb3FYfx49Jck1WFb0DGLjT26KwLbq";

  const BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function getWIB() {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  }

  function formatWaktuLogWIB(dateObj = new Date()) {
    const tgl = dateObj.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short" });
    const jam = dateObj.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });
    return `${tgl}, ${jam} WIB`;
  }

  function formatJamWIB(dateObj = new Date()) {
    return dateObj.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }) + " WIB";
  }

  async function fbWrite(path, method, data) {
    const res = await fetch(`${DB}/${path}.json`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Firebase ${method} ${path} gagal (HTTP ${res.status}): ${errText}`);
    }
    return res.json().catch(() => null);
  }

  // Pencatat Error & Warning ke Firebase (Terbaca langsung di Admin Monitor)
  async function logSystemError(level, modul, pesan, detail = "") {
    try {
      await fbWrite("bpjs_errors", "POST", {
        level: String(level || "ERROR").toUpperCase(),
        modul: String(modul || "SYSTEM").toUpperCase(),
        pesan: String(pesan || "Terjadi kendala pada sistem."),
        detail: String(detail || "").slice(0, 400),
        waktu_wib: formatWaktuLogWIB(),
        timestamp: Date.now()
      });

      const allErr = await fetch(`${DB}/bpjs_errors.json?shallow=true`).then(r => r.json()).catch(() => null);
      if (allErr && typeof allErr === "object") {
        const keys = Object.keys(allErr).sort();
        if (keys.length > 40) {
          const toDelete = keys.slice(0, keys.length - 40);
          await Promise.all(
            toDelete.map(k => fetch(`${DB}/bpjs_errors/${k}.json`, { method: "DELETE" }).catch(() => null))
          );
        }
      }
    } catch (e) {
      console.warn("Gagal menulis log error ke Firebase:", e.message);
    }
  }

  try {
    function getTglBursa(mundur = 0) {
      const wib = getWIB();
      const hari = wib.getDay();
      if (hari === 6) wib.setDate(wib.getDate() - 1);
      else if (hari === 0) wib.setDate(wib.getDate() - 2);
      else if (wib.getHours() < 18) wib.setDate(wib.getDate() - (hari === 1 ? 3 : 1));
      if (mundur > 0) {
        wib.setDate(wib.getDate() - mundur);
        while (wib.getDay() === 0 || wib.getDay() === 6) wib.setDate(wib.getDate() - 1);
      }
      return wib.toISOString().slice(0, 10);
    }

    function decodeHtmlEntities(str) {
      return String(str || "")
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;|&#039;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function isValidNewsImage(url) {
      if (!url || typeof url !== "string" || !url.startsWith("http")) return false;
      if (url.length < 20) return false;
      return !/gstatic\.com|news\.google\.com|googleusercontent\.com\/proxy|favicon|J6_coFbogxhRI9iM864NL|logo-small|spacer\.gif|pixel\.gif|1x1|default-image/i.test(url);
    }

    function cleanRedirectLink(rawLink) {
      const clean = decodeHtmlEntities(rawLink);
      try {
        if (clean.includes("bing.com/news/apiclick.aspx")) {
          const u = new URL(clean);
          const target = u.searchParams.get("url");
          if (target && target.startsWith("http")) return target;
        }
      } catch (_) {}
      return clean;
    }

    function extractRssImage(itemXml) {
      const decodedXml = decodeHtmlEntities(itemXml);
      const patterns = [
        /<News:Image[^>]*>([\s\S]*?)<\/News:Image>/i,
        /<enclosure[^>]+url=["']([^"']+)["']/i,
        /<media:content[^>]+url=["']([^"']+)["']/i,
        /<media:thumbnail[^>]+url=["']([^"']+)["']/i,
        /<img[^>]+(?:src|data-src)=["']([^"']+)["']/i
      ];
      for (const source of [itemXml, decodedXml]) {
        for (const re of patterns) {
          const m = source.match(re);
          if (m && m[1]) {
            let imgUrl = decodeHtmlEntities(m[1]);
            if (imgUrl.startsWith("//")) imgUrl = "https:" + imgUrl;
            if (isValidNewsImage(imgUrl)) return imgUrl;
          }
        }
      }
      return "";
    }

    function extractRssDescription(itemXml) {
      const rawDesc =
        itemXml.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i)?.[1] ||
        itemXml.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ||
        "";
      const clean = decodeHtmlEntities(rawDesc.replace(/<[^>]+>/g, " "));
      return clean.length > 220 ? clean.slice(0, 217) + "..." : clean;
    }

    function formatPubDateWIB(pubDate) {
      if (!pubDate) return "Hari Ini";
      const d = new Date(pubDate);
      if (isNaN(d.getTime())) return pubDate.slice(0, 22);
      const jam = d.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });
      const tgl = d.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });
      return `${jam} ${tgl}`;
    }

    function classifyNewsSentiment(title, desc = "") {
      const text = `${title} ${desc}`.toLowerCase();
      if (/halt|anjlok|ambruk|krisis|resesi|perang|outflow besar|guncangan|turun tajam|melemah tajam/.test(text)) {
        return "GUNCANGAN";
      }
      if (/menguat|melesat|borong|inflow|net buy|laba naik|dividen|rekor|surplus|melompat|bangkit|positif|tumbuh|akuisisi|rights issue|hmetd|injeksi aset/.test(text)) {
        return "POSITIF";
      }
      return "NETRAL";
    }

    function isCorporateCatalystNews(title, desc = "") {
      const text = `${title} ${desc}`.toLowerCase();
      return /akuisisi|diakuisisi|pengendali|backdoor|rights issue|hmetd|private placement|injeksi aset|setoran modal|ekspansi|merger|restrukturisasi|laba bersih|eps/.test(text);
    }

    async function fetchOgImage(articleUrl) {
      if (!articleUrl || !articleUrl.startsWith("http") || articleUrl.includes("news.google.com")) return "";
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6500);
        const resp = await fetch(articleUrl, {
          headers: BROWSER_HEADERS,
          redirect: "follow",
          signal: controller.signal
        });
        clearTimeout(timer);
        if (!resp.ok) return "";

        const html = await resp.text();
        const headSlice = html.slice(0, 120000);
        const metaPatterns = [
          /<meta[^>]+(?:property|name|itemprop)=["'](?:og:image|og:image:secure_url|og:image:url|twitter:image|twitter:image:src|image)["'][^>]+content=["']([^"']+)["']/i,
          /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["'](?:og:image|og:image:secure_url|og:image:url|twitter:image|twitter:image:src|image)["']/i,
          /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
          /"image"\s*:\s*\[\s*"(https?:\/\/[^"]+)"/i,
          /"image"\s*:\s*\{\s*"@type"\s*:\s*"ImageObject"\s*,\s*"url"\s*:\s*"(https?:\/\/[^"]+)"/i
        ];

        for (const re of metaPatterns) {
          const m = headSlice.match(re);
          if (m && m[1]) {
            let imgUrl = decodeHtmlEntities(m[1]);
            if (imgUrl.startsWith("//")) imgUrl = "https:" + imgUrl;
            else if (imgUrl.startsWith("/")) {
              const base = new URL(resp.url || articleUrl);
              imgUrl = base.origin + imgUrl;
            }
            if (isValidNewsImage(imgUrl)) return imgUrl;
          }
        }
      } catch (_) {}
      return "";
    }

    async function findBingNewsThumbnail(title) {
      if (!title) return "";
      try {
        const q = encodeURIComponent(title.slice(0, 80));
        const url = `https://www.bing.com/news/search?q=${q}&setlang=id&cc=ID&format=rss`;
        const resp = await fetch(url, { headers: BROWSER_HEADERS });
        if (!resp.ok) return "";
        const xml = await resp.text();
        const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
        for (const it of items.slice(0, 3)) {
          const img = extractRssImage(it);
          if (img) return img;
        }
      } catch (_) {}
      return "";
    }

    function bulatkanFraksiBEI(harga) {
      const h = Math.round(harga);
      let f = 1;
      if (h >= 5000) f = 25;
      else if (h >= 2000) f = 10;
      else if (h >= 500) f = 5;
      else if (h >= 200) f = 2;
      return Math.max(1, Math.round(h / f) * f);
    }

    const wibNow = getWIB();
    const todayStr = wibNow.toISOString().slice(0, 10);
    const hariIni = wibNow.getDay();
    const isWeekday = hariIni >= 1 && hariIni <= 5;
    const inputMode = process.env.INPUT_MODE || "auto";

    const metaOld = (await fetch(`${DB}/bpjs_meta.json`).then(r => r.json()).catch(() => ({}))) || {};
    const newsOld = (await fetch(`${DB}/bpjs_news.json`).then(r => r.json()).catch(() => ({}))) || {};
    const targetEod = getTglBursa(0);

    const sudahScanEodIni = metaOld.last_ia_eod === targetEod && (metaOld.ia_used_today || 0) > 0;
    const isFullRun = inputMode === "full" || inputMode === "investment" || (isWeekday && wibNow.getHours() === 8 && !sudahScanEodIni && inputMode === "auto");

    let groqCallsToday = metaOld.quota_date === todayStr ? (metaOld.groq_calls_today || 0) : 0;
    let iaUsedToday = metaOld.quota_date === todayStr ? (metaOld.ia_used_today || 0) : 0;

    // 1. TARIK DATA MAKRO GLOBAL & KURS
    const macroSymbols = [
      { sym: "^JKSE", name: "IHSG" },
      { sym: "IDR=X", name: "USD/IDR" },
      { sym: "^GSPC", name: "S&P 500" },
      { sym: "^N225", name: "Nikkei 225" },
      { sym: "^HSI", name: "Hang Seng" }
    ];

    const oldQuotesMap = new Map(
      (Array.isArray(newsOld.macro_quotes) ? newsOld.macro_quotes : []).map(q => [q.name, q])
    );

    async function fetchYahooQuote(sym) {
      const endpoints = [
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`,
        `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`
      ];
      for (const url of endpoints) {
        try {
          const r = await fetch(url, { headers: { ...BROWSER_HEADERS, "Accept": "application/json" } });
          if (!r.ok) continue;
          const res = await r.json();
          const result = res?.chart?.result?.[0];
          if (!result) continue;

          const meta = result.meta || {};
          const closes = (result.indicators?.quote?.[0]?.close || []).filter(v => typeof v === "number" && v > 0);
          const last = meta.regularMarketPrice || closes[closes.length - 1] || 0;
          const prev = (closes.length >= 2 ? closes[closes.length - 2] : 0) || meta.chartPreviousClose || meta.previousClose || last;

          if (last > 0) {
            const chg = prev > 0 ? Number((((last - prev) / prev) * 100).toFixed(2)) : 0;
            return { price: last, change_pct: chg };
          }
        } catch (_) {}
      }
      return null;
    }

    const macroQuotes = [];
    const failedMacro = [];
    for (const m of macroSymbols) {
      const fresh = await fetchYahooQuote(m.sym);
      if (fresh) {
        macroQuotes.push({
          name: m.name,
          price: m.sym === "IDR=X" ? Math.round(fresh.price) : Number(fresh.price.toFixed(2)),
          change_pct: fresh.change_pct
        });
      } else {
        failedMacro.push(m.name);
        if (oldQuotesMap.has(m.name)) {
          macroQuotes.push(oldQuotesMap.get(m.name));
        }
      }
    }
    if (failedMacro.length > 0) {
      await logSystemError(
        "WARNING",
        "NEWS",
        `Sebagian indeks makro memakai data cache (${failedMacro.join(", ")})`,
        "Endpoint Yahoo Finance mengalami pembatasan akses sementara."
      );
    }
    console.log(`Makro quotes berhasil dimuat: ${macroQuotes.length}/${macroSymbols.length}`);

    // 2. BING NEWS RSS (BERGAMBAR) + RSS MEDIA LOKAL + GOOGLE NEWS RSS (TERMASUK KATALIS KORPORASI)
    const rssUrls = [
      { url: "https://www.bing.com/news/search?q=IHSG+saham+BEI&setlang=id&cc=ID&format=rss", sumber: "Berita Pasar" },
      { url: "https://www.bing.com/news/search?q=ekonomi+Indonesia+Bank+Indonesia+rupiah&setlang=id&cc=ID&format=rss", sumber: "Ekonomi RI" },
      { url: "https://www.bing.com/news/search?q=akuisisi+rights+issue+saham+BEI&setlang=id&cc=ID&format=rss", sumber: "Aksi Korporasi" },
      { url: "https://www.cnbcindonesia.com/market/rss", sumber: "CNBC Indonesia" },
      { url: "https://investasi.kontan.co.id/rss", sumber: "Kontan Investasi" },
      { url: "https://www.antaranews.com/rss/ekonomi.xml", sumber: "ANTARA Ekonomi" },
      { url: "https://news.google.com/rss/search?q=IHSG+OR+saham+OR+BEI+when:2d&hl=id&gl=ID&ceid=ID:id", sumber: "Google News Saham" },
      { url: "https://news.google.com/rss/search?q=(akuisisi+OR+rights+issue+OR+backdoor+OR+laba+bersih)+saham+BEI+when:7d&hl=id&gl=ID&ceid=ID:id", sumber: "Google News Korporasi" }
    ];

    let rawNews = [];
    const rssSourceTelemetry = [];
    const failedRssFeeds = [];

    for (const feed of rssUrls) {
      try {
        const resp = await fetch(feed.url, { headers: BROWSER_HEADERS });
        if (!resp.ok) {
          console.warn(`RSS ${feed.sumber} dilewati (HTTP ${resp.status})`);
          failedRssFeeds.push(`${feed.sumber} (HTTP ${resp.status})`);
          continue;
        }
        const xml = await resp.text();
        const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
        let validCount = 0;

        for (const item of items.slice(0, 6)) {
          const rawTitle = item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "";
          const rawLink = item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "";
          const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "").trim();
          const sourceTag = decodeHtmlEntities(
            item.match(/<News:Source[^>]*>([\s\S]*?)<\/News:Source>/i)?.[1] ||
            item.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] ||
            ""
          );
          const rssImage = extractRssImage(item);
          const descText = extractRssDescription(item);

          let title = decodeHtmlEntities(rawTitle.replace(/<[^>]+>/g, ""));
          if (sourceTag && title.endsWith(` - ${sourceTag}`)) {
            title = title.slice(0, -(` - ${sourceTag}`.length)).trim();
          }

          const link = cleanRedirectLink(rawLink);
          if (title && link && link.startsWith("http")) {
            validCount++;
            rawNews.push({
              title,
              link,
              pubDate,
              waktu: formatPubDateWIB(pubDate),
              sumber: sourceTag || feed.sumber,
              image: rssImage,
              desc: descText,
              isCorporateCatalyst: isCorporateCatalystNews(title, descText)
            });
          }
        }
        if (validCount > 0) {
          rssSourceTelemetry.push({ name: feed.sumber, count: validCount });
        }
      } catch (e) {
        console.warn(`RSS ${feed.sumber} gagal:`, e.message);
        failedRssFeeds.push(`${feed.sumber} (${e.message})`);
      }
    }

    if (failedRssFeeds.length >= 4) {
      await logSystemError(
        "WARNING",
        "NEWS",
        `${failedRssFeeds.length} sumber RSS gagal diakses`,
        failedRssFeeds.join(" | ")
      );
    }

    rawNews.sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0));

    const seenTitles = new Set();
    const dedupedNews = rawNews.filter(n => {
      const key = n.title.toLowerCase().slice(0, 45);
      if (seenTitles.has(key)) return false;
      seenTitles.add(key);
      return true;
    });

    const corporateNewsPool = dedupedNews.filter(n => n.isCorporateCatalyst).slice(0, 10);
    const curatedNewsBase = dedupedNews.slice(0, 12);

    const enrichedNews = await Promise.all(
      curatedNewsBase.map(async (item, idx) => {
        let img = item.image || "";
        if (!img) img = await fetchOgImage(item.link);
        if (!img) img = await findBingNewsThumbnail(item.title);
        return { ...item, id: idx, image: img };
      })
    );

    enrichedNews.sort((a, b) => {
      const imgDiff = (b.image ? 1 : 0) - (a.image ? 1 : 0);
      if (imgDiff !== 0) return imgDiff;
      return (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0);
    });
    const finalRawNews = enrichedNews.map((item, idx) => ({ ...item, id: idx }));

    console.log(`Total berita RSS terkumpul: ${finalRawNews.length} artikel | Katalis korporasi: ${corporateNewsPool.length} | Dengan foto: ${finalRawNews.filter(x => x.image).length} artikel.`);

    async function getGroqModels() {
      try {
        const modelsRes = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { "Authorization": "Bearer " + GR }
        }).then(r => r.json());
        const activeIds = (modelsRes.data || [])
          .map(m => m.id)
          .filter(id => id && !/whisper|guard|tts|embed|orpheus|playai|vision|safeguard|prompt-guard|llama-3\.1-8b-instant/i.test(id));
        const priorityPatterns = [
          "llama-3.3-70b-versatile",
          "meta-llama/llama-4-maverick-17b-128e-instruct",
          "meta-llama/llama-4-scout-17b-16e-instruct",
          "openai/gpt-oss-120b",
          "qwen/qwen3-32b",
          "openai/gpt-oss-20b",
          "moonshotai/kimi-k2-instruct"
        ];
        const prioritized = priorityPatterns.filter(p => activeIds.includes(p));
        const remaining = activeIds.filter(id => !prioritized.includes(id));
        const combined = [...prioritized, ...remaining];
        if (combined.length > 0) return combined;
      } catch (_) {}
      return ["llama-3.3-70b-versatile", "meta-llama/llama-4-scout-17b-16e-instruct", "qwen/qwen3-32b"];
    }

    async function callGroqJSON(modelList, systemPrompt, userPayload, temperature = 0.15) {
      let lastErrMsg = "no response";
      const maxAttempts = Math.min(3, Math.max(1, modelList.length));
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const model = modelList[attempt % modelList.length];
        try {
          groqCallsToday++;
          const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + GR },
            body: JSON.stringify({
              model,
              temperature,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: typeof userPayload === "string" ? userPayload : JSON.stringify(userPayload) }
              ]
            })
          }).then(r => r.json());

          const content = res?.choices?.[0]?.message?.content;
          if (!content) {
            lastErrMsg = res?.error?.message || "no response";
            console.warn(`Groq (${model}) gagal:`, lastErrMsg);
            await sleep(1500);
            continue;
          }
          const cleaned = content
            .replace(/<think>[\s\S]*?<\/think>/gi, "")
            .replace(/```json|```/g, "")
            .trim();
          const start = cleaned.indexOf("{");
          const end = cleaned.lastIndexOf("}");
          if (start !== -1 && end !== -1) {
            return JSON.parse(cleaned.slice(start, end + 1));
          }
        } catch (e) {
          lastErrMsg = e.message;
          console.warn(`Groq (${model}) error:`, e.message);
        }
        await sleep(1500);
      }
      await logSystemError("WARNING", "API", "Groq AI gagal merespons (menggunakan fallback otomatis)", lastErrMsg);
      return null;
    }

    let modelList = null;
    let macroResult = newsOld;
    let newsAiMode = "RSS Auto Fallback";
    const currentHash = finalRawNews.map(n => n.title.slice(0, 30)).join("|");

    if (finalRawNews.length > 0) {
      modelList = await getGroqModels();
      const rawNewsForAI = finalRawNews.map(({ id, title, sumber, waktu, desc }) => ({ id, title, sumber, waktu, desc }));

      const parsedM = await callGroqJSON(
        modelList,
        `Kamu adalah Kepala Riset Makro & Manajemen Risiko STAR GROUP untuk bursa saham Indonesia (IHSG).
Kurasi maksimal 6 berita paling valid & berdampak ke pasar dari rawNews. Sertakan "raw_id" sesuai "id" dari rawNews.
Balas HANYA JSON murni:
{
  "risk_score": 3,
  "shock_halt": false,
  "regime": "NORMAL | BULLISH_CATALYST | CAUTION | MARKET_SHOCK_HALT",
  "headline_utama": "1 kalimat tajam kondisi makro saat ini",
  "ringkasan_makro": "2 kalimat analisis kondisi pasar global & domestik",
  "berita_valid": [
    {
      "raw_id": 0,
      "judul": "judul bersih",
      "dampak": "GUNCANGAN | POSITIF | NETRAL",
      "ringkasan": "1 kalimat ringkasan dampak pasar"
    }
  ]
}`,
        { waktu_wib: wibNow.toISOString(), is_weekend: !isWeekday, macroQuotes, rawNews: rawNewsForAI },
        0.1
      );

      let finalBerita = [];
      if (parsedM && Array.isArray(parsedM.berita_valid) && parsedM.berita_valid.length > 0) {
        newsAiMode = "Groq AI + RSS";
        finalBerita = parsedM.berita_valid.slice(0, 6).map((item, i) => {
          const matched =
            (typeof item.raw_id === "number" ? finalRawNews.find(r => r.id === item.raw_id) : null) ||
            finalRawNews.find(r => r.title.toLowerCase().slice(0, 30) === String(item.judul || "").toLowerCase().slice(0, 30)) ||
            finalRawNews[i];

          return {
            judul: item.judul || matched?.title || "",
            sumber: matched?.sumber || "Berita Pasar",
            dampak: item.dampak || classifyNewsSentiment(matched?.title, matched?.desc),
            ringkasan: item.ringkasan || matched?.desc || "Update sentimen pasar keuangan dan pergerakan bursa.",
            link: matched?.link || "",
            waktu: matched?.waktu || "Terkini",
            gambar: matched?.image || ""
          };
        });
      } else {
        console.log("Menggunakan kurasi otomatis langsung dari RSS (tanpa AI).");
        finalBerita = finalRawNews.slice(0, 6).map(r => ({
          judul: r.title,
          sumber: r.sumber,
          dampak: classifyNewsSentiment(r.title, r.desc),
          ringkasan: r.desc && r.desc !== r.title ? r.desc : `Laporan terbaru dari ${r.sumber} terkait sentimen pasar modal dan ekonomi.`,
          link: r.link,
          waktu: r.waktu,
          gambar: r.image || ""
        }));
      }

      const ihsgQuote = macroQuotes.find(q => q.name === "IHSG");
      const defaultHeadline = ihsgQuote
        ? `IHSG berada di level ${ihsgQuote.price.toLocaleString("id-ID")} (${ihsgQuote.change_pct >= 0 ? "+" : ""}${ihsgQuote.change_pct}%) dengan pantauan ${finalBerita.length} berita ekonomi terkini.`
        : `Pemantauan ${finalBerita.length} berita ekonomi & pasar modal terkini telah diperbarui.`;

      const defaultRingkasan = finalBerita[0]
        ? `Sorotan utama pasar: ${finalBerita[0].judul} (${finalBerita[0].sumber}). Pantau pergerakan indeks global dan nilai tukar Rupiah sebelum eksekusi.`
        : "Tidak terdeteksi guncangan sistemik pada pasar keuangan global maupun domestik.";

      const hasShockNews = finalBerita.some(b => b.dampak === "GUNCANGAN");
      const riskScore = parsedM?.risk_score || (hasShockNews ? 7 : 3);

      macroResult = {
        updated_at: new Date().toISOString(),
        headline_hash: currentHash,
        macro_quotes: macroQuotes.length > 0 ? macroQuotes : (newsOld.macro_quotes || []),
        risk_score: riskScore,
        shock_halt: Boolean(parsedM?.shock_halt) || (riskScore >= 8),
        regime: parsedM?.regime || (hasShockNews ? "CAUTION" : "NORMAL"),
        headline_utama: parsedM?.headline_utama || defaultHeadline,
        ringkasan_makro: parsedM?.ringkasan_makro || defaultRingkasan,
        berita_valid: finalBerita
      };

      await fbWrite("bpjs_news", "PUT", macroResult);
      const withImgCount = finalBerita.filter(b => b.gambar).length;
      console.log(`SUKSES FIREBASE: ${finalBerita.length} berita terbaru tersimpan (${withImgCount} artikel punya foto).`);
    } else {
      console.warn("PERINGATAN: 0 artikel RSS berhasil diambil.");
      await logSystemError(
        "ERROR",
        "NEWS",
        "0 artikel berita berhasil diambil dari seluruh feed RSS",
        failedRssFeeds.join(" | ") || "Tidak ada item RSS yang lolos filter."
      );
      if (macroQuotes.length > 0) {
        await fbWrite("bpjs_news", "PATCH", { macro_quotes: macroQuotes, updated_at: new Date().toISOString() });
      }
    }

    const newsTelemetryPayload = {
      ai_mode: newsAiMode,
      sources: rssSourceTelemetry
    };

    // 3. EVALUASI OTOMATIS RIWAYAT TP / SL (UNTUK WINRATE REKOMENDASI UTAMA)
    async function evaluateHistoryTpSl() {
      try {
        const histObj = await fetch(`${DB}/bpjs_history.json`).then(r => r.json()).catch(() => null);
        if (!histObj || typeof histObj !== "object") return;

        const dateKeys = Object.keys(histObj).sort().slice(-7);
        for (const callDate of dateKeys) {
          if (callDate >= todayStr) continue;
          const entry = histObj[callDate];
          if (!entry || !Array.isArray(entry.daftar_sinyal)) continue;

          let changed = false;
          for (const sig of entry.daftar_sinyal) {
            if (!sig || !sig.ticker || sig.hasil) continue;
            const tp = Number(sig.target_tp || 0);
            const sl = Number(sig.cut_loss || 0);
            if (tp <= 0 || sl <= 0) continue;

            try {
              const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sig.ticker + ".JK")}?range=7d&interval=1d`;
              const yRes = await fetch(yUrl, { headers: { ...BROWSER_HEADERS, "Accept": "application/json" } }).then(r => r.json());
              const r0 = yRes?.chart?.result?.[0];
              if (!r0) continue;

              const timestamps = r0.timestamp || [];
              const highs = r0.indicators?.quote?.[0]?.high || [];
              const lows = r0.indicators?.quote?.[0]?.low || [];

              for (let idx = 0; idx < timestamps.length; idx++) {
                const candleDate = new Date(timestamps[idx] * 1000).toISOString().slice(0, 10);
                if (candleDate <= callDate) continue;

                const hi = Number(highs[idx] || 0);
                const lo = Number(lows[idx] || 0);
                if (hi >= tp) {
                  sig.hasil = "KENA TP (PROFIT)";
                  sig.harga_exit = tp;
                  sig.tgl_exit = candleDate;
                  changed = true;
                  break;
                } else if (lo > 0 && lo <= sl) {
                  sig.hasil = "KENA SL (CUT LOSS)";
                  sig.harga_exit = sl;
                  sig.tgl_exit = candleDate;
                  changed = true;
                  break;
                }
              }
            } catch (_) {}
          }

          if (changed) {
            await fbWrite(`bpjs_history/${callDate}/daftar_sinyal`, "PUT", entry.daftar_sinyal);
            console.log(`Riwayat TP/SL tanggal ${callDate} diperbarui.`);
          }
        }
      } catch (e) {
        console.warn("Evaluasi TP/SL history dilewati:", e.message);
      }
    }

    await evaluateHistoryTpSl();

    // 4. MODUL INVESTMENT (TARGET +50% – MULTIBAGGER: AKUISISI / BACKDOOR, RIGHTS ISSUE / INJEKSI ASET, PERTUMBUHAN EPS)
    async function runInvestmentMultibaggerScan() {
      try {
        if (!modelList) modelList = await getGroqModels();

        const baseCols = ["name", "close", "change", "Value.Traded", "relative_volume_10d_calc"];
        const epsCols = ["basic_eps_ttm", "earnings_per_share_diluted_ttm", "price_earnings_ttm"];

        async function fetchTvInvestmentCandidates(useEpsCols) {
          const cols = useEpsCols ? [...baseCols, ...epsCols] : baseCols;
          const res = await fetch("https://scanner.tradingview.com/indonesia/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...BROWSER_HEADERS },
            body: JSON.stringify({
              filter: [
                { left: "Value.Traded", operation: "in_range", right: [5000000000, 1000000000000] },
                { left: "close", operation: "in_range", right: [50, 20000] }
              ],
              symbols: { query: { types: ["stock"] }, tickers: [] },
              columns: cols,
              sort: { sortBy: "Value.Traded", sortOrder: "desc" },
              range: [0, 35]
            })
          }).then(r => r.json()).catch(() => null);

          if (!res || !Array.isArray(res.data) || res.data.length === 0) return null;
          return res.data.map(r => {
            const d = r.d || [];
            const epsBasic = useEpsCols && typeof d[5] === "number" ? Number(d[5].toFixed(2)) : null;
            const epsDiluted = useEpsCols && typeof d[6] === "number" ? Number(d[6].toFixed(2)) : null;
            const perTtm = useEpsCols && typeof d[7] === "number" ? Number(d[7].toFixed(2)) : null;
            const epsVal = epsBasic !== null ? epsBasic : epsDiluted;
            return {
              ticker: d[0],
              harga_close: Math.round(d[1] || 0),
              persen_naik: Number((d[2] || 0).toFixed(2)),
              nilai_transaksi_miliar: Number(((d[3] || 0) / 1e9).toFixed(2)),
              lonjakan_volume: Number((d[4] || 1).toFixed(2)),
              eps_ttm: epsVal,
              per_ttm: perTtm
            };
          });
        }

        let tvCandidates = await fetchTvInvestmentCandidates(true);
        if (!tvCandidates) {
          tvCandidates = await fetchTvInvestmentCandidates(false);
        }
        tvCandidates = (tvCandidates || []).filter(c => c.ticker && c.harga_close > 0);

        if (tvCandidates.length === 0) {
          await logSystemError(
            "WARNING",
            "INVESTMENT",
            "Scanner kandidat Investment tidak mengembalikan data emiten",
            "Periksa akses scanner.tradingview.com pada modul Investment."
          );
          return;
        }

        const enrichedCandidates = [];
        for (const cand of tvCandidates.slice(0, 12)) {
          let ret1m = null;
          let ret3m = null;
          let low3m = null;
          let high3m = null;
          try {
            const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cand.ticker + ".JK")}?range=3mo&interval=1d`;
            const yRes = await fetch(yUrl, { headers: { ...BROWSER_HEADERS, "Accept": "application/json" } }).then(r => r.json());
            const r0 = yRes?.chart?.result?.[0];
            const closes = (r0?.indicators?.quote?.[0]?.close || []).filter(v => typeof v === "number" && v > 0);
            const lows = (r0?.indicators?.quote?.[0]?.low || []).filter(v => typeof v === "number" && v > 0);
            const highs = (r0?.indicators?.quote?.[0]?.high || []).filter(v => typeof v === "number" && v > 0);
            if (closes.length >= 2) {
              const last = closes[closes.length - 1];
              const idx1m = Math.max(0, closes.length - 22);
              ret1m = Number((((last - closes[idx1m]) / closes[idx1m]) * 100).toFixed(2));
              ret3m = Number((((last - closes[0]) / closes[0]) * 100).toFixed(2));
              low3m = lows.length ? Math.round(Math.min(...lows)) : null;
              high3m = highs.length ? Math.round(Math.max(...highs)) : null;
            }
          } catch (_) {}

          enrichedCandidates.push({
            ...cand,
            ret_1m_pct: ret1m,
            ret_3m_pct: ret3m,
            support_3m: low3m,
            resistance_3m: high3m
          });
        }

        const corpNewsForAI = (corporateNewsPool.length > 0 ? corporateNewsPool : finalRawNews.slice(0, 8)).map(n => ({
          judul: n.title,
          sumber: n.sumber,
          waktu: n.waktu,
          desc: n.desc,
          link: n.link
        }));

        await sleep(1000);
        const aiInv = await callGroqJSON(
          modelList,
          `Kamu adalah Kepala Analis Ekuitas & Special Situation / Multibagger STAR GROUP untuk saham BEI (horizon mingguan hingga berbulan-bulan, target +50% s/d multibagger).
Evaluasi kandidat emiten berdasarkan 3 PILAR UTAMA:
1. Akuisisi / Backdoor Listing / Pengendali Baru bereputasi & membawa added value.
2. Corporate Action (Rights Issue / HMETD / Private Placement) yang bertujuan INJEKSI ASET produktif (bukan sekadar tutup utang).
3. Pertumbuhan EPS (Laba per Saham) positif/meningkat serta likuiditas wajar.

Utamakan emiten yang memiliki katalis korporasi/EPS positif dan harga wajar untuk akumulasi bertahap. Pilih maksimal 4 emiten terbaik (atau 0-2 jika katalis lemah).
Balas HANYA JSON murni:
{
  "ringkasan_strategi": "2 kalimat ringkas kondisi peluang multibagger & katalis korporasi saat ini",
  "daftar_investment": [
    {
      "ticker": "KODE",
      "pilar_utama": "AKUISISI_BACKDOOR | RIGHTS_ISSUE_INJEKSI_ASET | EPS_GROWTH_CATALYST",
      "label_pilar": "label singkat pilar katalis",
      "status_kelayakan": "HIGH CONVICTION | ACCUMULATE WATCH",
      "skor_multibagger": 82,
      "eps_status": "EPS POSITIF / BERTUMBUH atau EPS PERLU KONFIRMASI LAPKEU",
      "katalis_korporasi": "penjelasan 1-2 kalimat soal akuisisi/backdoor/rights issue/injeksi aset & EPS",
      "area_akumulasi_min": 0,
      "area_akumulasi_max": 0,
      "target_tp_25": 0,
      "target_tp_50": 0,
      "target_multibagger": 0,
      "batas_invalidasi_sl": 0,
      "horizon_estimasi": "1 - 3 Bulan atau 3 - 6 Bulan",
      "risiko_utama": "risiko utama misal dilusi rights issue, batal akuisisi, atau volatilitas"
    }
  ]
}`,
          {
            tanggal_bursa: targetEod,
            macro_regime: macroResult.regime || "NORMAL",
            macro_risk_score: macroResult.risk_score || 3,
            corporate_news: corpNewsForAI,
            candidates: enrichedCandidates
          },
          0.2
        );

        const candidateMap = new Map(enrichedCandidates.map(c => [c.ticker, c]));
        const rawList = Array.isArray(aiInv?.daftar_investment) ? aiInv.daftar_investment : [];

        const daftarInvestment = rawList
          .filter(x => x && x.ticker && candidateMap.has(String(x.ticker).toUpperCase()))
          .slice(0, 4)
          .map(x => {
            const tk = String(x.ticker).toUpperCase();
            const base = candidateMap.get(tk);
            const px = Number(base.harga_close || 0);
            const accMax = Number(x.area_akumulasi_max) > 0 ? bulatkanFraksiBEI(x.area_akumulasi_max) : bulatkanFraksiBEI(px * 1.02);
            const accMin = Number(x.area_akumulasi_min) > 0 ? bulatkanFraksiBEI(x.area_akumulasi_min) : bulatkanFraksiBEI(px * 0.93);
            const tp25 = Number(x.target_tp_25) > 0 ? bulatkanFraksiBEI(x.target_tp_25) : bulatkanFraksiBEI(px * 1.25);
            const tp50 = Number(x.target_tp_50) > 0 ? bulatkanFraksiBEI(x.target_tp_50) : bulatkanFraksiBEI(px * 1.50);
            const tpMulti = Number(x.target_multibagger) > 0 ? bulatkanFraksiBEI(x.target_multibagger) : bulatkanFraksiBEI(px * 2.00);
            const slInv = Number(x.batas_invalidasi_sl) > 0 ? bulatkanFraksiBEI(x.batas_invalidasi_sl) : bulatkanFraksiBEI(px * 0.88);

            const epsText = x.eps_status || (
              typeof base.eps_ttm === "number"
                ? (base.eps_ttm > 0 ? `EPS TTM Positif (Rp ${base.eps_ttm})` : `EPS TTM ${base.eps_ttm} (Pantau Pemulihan)`)
                : "Pantau Laporan Keuangan Terbaru"
            );

            return {
              ticker: tk,
              tanggal_call: targetEod,
              jam_call: formatJamWIB(),
              harga_close: px,
              persen_naik: base.persen_naik,
              nilai_transaksi_miliar: base.nilai_transaksi_miliar,
              ret_1m_pct: base.ret_1m_pct,
              ret_3m_pct: base.ret_3m_pct,
              eps_ttm: base.eps_ttm,
              per_ttm: base.per_ttm,
              eps_status: epsText,
              pilar_utama: x.pilar_utama || "EPS_GROWTH_CATALYST",
              label_pilar: x.label_pilar || "Katalis Korporasi & Pertumbuhan EPS",
              status_kelayakan: x.status_kelayakan || "ACCUMULATE WATCH",
              skor_multibagger: Math.min(99, Math.max(50, Number(x.skor_multibagger || 76))),
              katalis_korporasi: x.katalis_korporasi || "Teridentifikasi aktivitas korporasi dan prospek pertumbuhan kinerja jangka menengah.",
              area_akumulasi_min: accMin,
              area_akumulasi_max: accMax,
              target_tp_25: tp25,
              target_tp_50: tp50,
              target_multibagger: tpMulti,
              batas_invalidasi_sl: slInv,
              horizon_estimasi: x.horizon_estimasi || "2 - 6 Bulan",
              risiko_utama: x.risiko_utama || "Perubahan jadwal aksi korporasi, dilusi saham baru, dan volatilitas pasar."
            };
          });

        const investmentPayload = {
          tanggal_bursa: targetEod,
          updated_at: new Date().toISOString(),
          shock_halt: Boolean(macroResult.shock_halt),
          macro_regime: macroResult.regime || "NORMAL",
          macro_risk_score: macroResult.risk_score || 3,
          ringkasan_strategi: aiInv?.ringkasan_strategi || "Seleksi saham berpotensi +50% hingga multibagger berbasis katalis akuisisi/backdoor, rights issue injeksi aset, dan pertumbuhan EPS.",
          katalis_berita_terdeteksi: corpNewsForAI.slice(0, 5),
          daftar_investment: daftarInvestment
        };

        await fbWrite("investment_signals", "PUT", investmentPayload);
        console.log(`SUKSES FIREBASE: ${daftarInvestment.length} kandidat Investment (+50% / Multibagger) tersimpan.`);
      } catch (e) {
        console.warn("Modul Investment mengalami kendala:", e.message);
        await logSystemError("WARNING", "INVESTMENT", "Gagal memperbarui data investment_signals", e.message);
      }
    }

    if (macroResult.shock_halt) {
      await fbWrite("bpjs_signals", "PUT", {
        tanggal_bursa: targetEod,
        updated_at: new Date().toISOString(),
        shock_halt: true,
        shock_reason: macroResult.ringkasan_makro,
        shock_headline: macroResult.headline_utama,
        daftar_sinyal: [],
        funnel_tahap1: [],
        alasan_seleksi_ai: "Sinyal ditahan otomatis oleh Macro Risk Guard: " + macroResult.headline_utama
      });
      await fbWrite("investment_signals", "PUT", {
        tanggal_bursa: targetEod,
        updated_at: new Date().toISOString(),
        shock_halt: true,
        macro_regime: macroResult.regime || "MARKET_SHOCK_HALT",
        macro_risk_score: macroResult.risk_score || 8,
        ringkasan_strategi: "Akumulasi jangka menengah ditahan sementara akibat guncangan makro: " + macroResult.headline_utama,
        katalis_berita_terdeteksi: [],
        daftar_investment: []
      });
      await fbWrite("bpjs_meta", "PATCH", {
        quota_date: todayStr,
        ia_used_today: iaUsedToday,
        ia_limit_daily: 5,
        last_ia_eod: metaOld.last_ia_eod || "-",
        groq_calls_today: groqCallsToday,
        last_news_sync: new Date().toISOString(),
        last_signal_sync: new Date().toISOString(),
        last_investment_sync: new Date().toISOString(),
        news_telemetry: newsTelemetryPayload
      });
      console.log("MARKET SHOCK HALT AKTIF.");
      return;
    }

    if (!isFullRun) {
      await fbWrite("bpjs_meta", "PATCH", {
        quota_date: todayStr,
        ia_used_today: iaUsedToday,
        ia_limit_daily: 5,
        groq_calls_today: groqCallsToday,
        last_news_sync: new Date().toISOString(),
        news_telemetry: newsTelemetryPayload
      });
      console.log("Update berita & makro selesai.");
      return;
    }

    // Jalankan modul Investment (+50% – Multibagger) saat full scan / mode investment
    await runInvestmentMultibaggerScan();

    if (inputMode === "investment") {
      await fbWrite("bpjs_meta", "PATCH", {
        quota_date: todayStr,
        ia_used_today: Math.min(5, iaUsedToday),
        ia_limit_daily: 5,
        groq_calls_today: groqCallsToday,
        last_news_sync: new Date().toISOString(),
        last_investment_sync: new Date().toISOString(),
        news_telemetry: newsTelemetryPayload
      });
      console.log("Scan Investment selesai.");
      return;
    }

    // 5. FULL SCAN BPJS (08:00 WIB)
    let tgl = targetEod;

    async function scanTradingView(agresif = true) {
      const filter = agresif
        ? [
            { left: "Value.Traded", operation: "in_range", right: [15000000000, 600000000000] },
            { left: "change", operation: "in_range", right: [2.5, 12.0] },
            { left: "relative_volume_10d_calc", operation: "greater", right: 1.3 },
            { left: "close", operation: "in_range", right: [100, 15000] }
          ]
        : [
            { left: "Value.Traded", operation: "in_range", right: [10000000000, 600000000000] },
            { left: "change", operation: "in_range", right: [1.8, 12.0] },
            { left: "close", operation: "in_range", right: [100, 15000] }
          ];

      const res = await fetch("https://scanner.tradingview.com/indonesia/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...BROWSER_HEADERS },
        body: JSON.stringify({
          filter,
          symbols: { query: { types: ["stock"] }, tickers: [] },
          columns: ["name", "close", "change", "Value.Traded", "relative_volume_10d_calc"],
          sort: { sortBy: "relative_volume_10d_calc", sortOrder: "desc" },
          range: [0, 20]
        })
      }).then(r => r.json()).catch(() => ({ data: [] }));

      return (res.data || []).map(r => ({
        ticker: r.d[0],
        harga_close: Math.round(r.d[1] || 0),
        persen_naik: Number((r.d[2] || 0).toFixed(2)),
        nilai_transaksi_miliar: Number(((r.d[3] || 0) / 1e9).toFixed(2)),
        lonjakan_volume: Number((r.d[4] || 1).toFixed(2)),
        dipilih_ai: false
      }));
    }

    let k1 = await scanTradingView(true);
    if (k1.length < 5) {
      const kFallback = await scanTradingView(false);
      const existing = new Set(k1.map(x => x.ticker));
      for (const item of kFallback) {
        if (!existing.has(item.ticker)) {
          k1.push(item);
          existing.add(item.ticker);
        }
        if (k1.length >= 15) break;
      }
    } else {
      k1 = k1.slice(0, 15);
    }

    if (!k1.length) {
      console.log("Tidak ada kandidat saham dari scanner.");
      await logSystemError(
        "ERROR",
        "BPJS",
        "Scanner TradingView mengembalikan 0 kandidat saham",
        "Cek konektivitas scanner.tradingview.com atau filter likuiditas BEI."
      );
      return;
    }
    if (!modelList) modelList = await getGroqModels();

    await sleep(1000);
    const sel = await callGroqJSON(
      modelList,
      "Analis kuantitatif BPJS BEI STAR GROUP. Pilih TEPAT 5 saham lapis kedua/menengah dengan lonjakan volume relatif tertinggi (>1.3x), momentum kenaikan sehat (+2.5% s/d +10%), dan likuiditas aktif untuk potensi sesi pagi 09.00 WIB. Balas JSON murni: {\"terpilih\":[\"T1\",\"T2\",\"T3\",\"T4\",\"T5\"],\"alasan_seleksi\":\"...\"}",
      k1,
      0.2
    );

    const top5 = (sel?.terpilih || k1.slice(0, 5).map(x => x.ticker)).slice(0, 5);
    const alasanSeleksi = sel?.alasan_seleksi || "Dipilih berdasarkan lonjakan volume relatif tertinggi, momentum harga +2,5% ke atas, dan likuiditas aktif second-liner untuk BPJS.";
    k1.forEach(s => { s.dipilih_ai = top5.includes(s.ticker); });

    const hasil = [];
    const brokerChecks = [];
    const jamCallStr = formatJamWIB();

    for (let i = 0; i < top5.length; i++) {
      const tk = top5[i];
      const info = k1.find(x => x.ticker === tk);
      if (!info) continue;

      iaUsedToday++;
      let brErrorDetail = "";
      let br = await fetch(`https://api.indexalpha.id/stocks/broker-summary?ticker=${tk}&from=${tgl}&to=${tgl}&investor=all&market=RG`, {
        headers: { "accept": "application/json", "Authorization": "Bearer " + IA }
      }).then(async r => {
        if (!r.ok) brErrorDetail = `HTTP ${r.status}`;
        return r.json();
      }).catch(e => {
        brErrorDetail = e.message;
        return null;
      });

      if ((!br || !br.success || !br.data?.length) && i === 0) {
        const prevTgl = getTglBursa(1);
        iaUsedToday++;
        br = await fetch(`https://api.indexalpha.id/stocks/broker-summary?ticker=${tk}&from=${prevTgl}&to=${prevTgl}&investor=all&market=RG`, {
          headers: { "accept": "application/json", "Authorization": "Bearer " + IA }
        }).then(async r => {
          if (!r.ok) brErrorDetail = `HTTP ${r.status} (EOD ${prevTgl})`;
          return r.json();
        }).catch(e => {
          brErrorDetail = e.message;
          return null;
        });
        if (br?.success && br.data?.length) tgl = prevTgl;
      }

      if (br?.success && br.data?.length) {
        const totBuy = br.data.reduce((a, b) => a + b.buy_value, 0);
        const allB = br.data.map(b => ({
          kode: b.code,
          net_value: b.buy_value - b.sell_value,
          net_miliar: Number(((b.buy_value - b.sell_value) / 1e9).toFixed(2)),
          buy_avg: Math.round(b.buy_avg),
          avg_order_juta: b.buy_freq > 0 ? Math.round((b.buy_value / b.buy_freq) / 1e6) : 0
        }));
        const buyers = allB.filter(b => b.net_value > 0).sort((a, b) => b.net_value - a.net_value).slice(0, 5);
        const sellers = allB.filter(b => b.net_value < 0).sort((a, b) => a.net_value - b.net_value).slice(0, 5);
        const dom3 = totBuy > 0 ? Number(((buyers.slice(0, 3).reduce((a, b) => a + b.net_value, 0) / totBuy) * 100).toFixed(1)) : 0;
        const avg1 = buyers[0]?.buy_avg || info.harga_close;

        await sleep(1000);
        const v = await callGroqJSON(
          modelList,
          "Analis bandarmologi institusional STAR GROUP untuk eksekusi BPJS 09.00 WIB. Berikan 'VALID BPJS' jika dominasi top 3 buyer >= 35%; 'WATCHLIST' jika 25%-34%; 'AVOID' jika < 25%. Balas JSON murni: {\"status_bandar\":\"BIG ACCUMULATION|NORMAL ACCUMULATION|NEUTRAL|DISTRIBUTION\",\"sinyal\":\"VALID BPJS|WATCHLIST|AVOID\",\"alasan\":\"2 kalimat ringkas\"}",
          { ...info, dom3, buyers, sellers, macro: macroResult.headline_utama || "Stabil" },
          0.2
        );

        const fallbackStatus = dom3 >= 42 ? "BIG ACCUMULATION" : dom3 >= 30 ? "NORMAL ACCUMULATION" : "NEUTRAL";
        const fallbackSinyal = dom3 >= 35 ? "VALID BPJS" : dom3 >= 25 ? "WATCHLIST" : "AVOID";
        const finalSinyal = v?.sinyal || fallbackSinyal;

        brokerChecks.push({
          ticker: tk,
          status: "OK",
          dom3,
          sinyal: finalSinyal
        });

        hasil.push({
          ...info,
          tanggal_call: tgl,
          jam_call: jamCallStr,
          dominasi_top3: dom3,
          buy_avg_bandar: avg1,
          selisih_modal_persen: Number((((info.harga_close - avg1) / avg1) * 100).toFixed(2)),
          max_beli_pagi: bulatkanFraksiBEI(info.harga_close * 1.02),
          target_tp: bulatkanFraksiBEI(info.harga_close * 1.03),
          cut_loss: bulatkanFraksiBEI(info.harga_close * 0.98),
          status_bandar: v?.status_bandar || fallbackStatus,
          sinyal: finalSinyal,
          alasan: v?.alasan || `Dominasi 3 pembeli teratas tercatat sebesar ${dom3}% dengan lonjakan volume ${info.lonjakan_volume}x dan rata-rata akumulasi di Rp ${avg1}.`,
          top_buyers: buyers,
          top_sellers: sellers
        });
      } else {
        const reasonDetail = br?.message || brErrorDetail || "Data broker summary kosong dari Index Alpha.";
        brokerChecks.push({
          ticker: tk,
          status: "KOSONG",
          dom3: 0,
          sinyal: "SKIP"
        });
        await logSystemError(
          "WARNING",
          "BPJS",
          `Data broker summary ${tk} (EOD ${tgl}) kosong / gagal ditarik`,
          reasonDetail
        );
      }
    }

    if (hasil.length > 0) {
      const prioritas = { "VALID BPJS": 1, "WATCHLIST": 2, "AVOID": 3 };
      hasil.sort((a, b) => (prioritas[a.sinyal] || 9) - (prioritas[b.sinyal] || 9));
      const payload = {
        tanggal_bursa: tgl,
        updated_at: new Date().toISOString(),
        shock_halt: false,
        macro_regime: macroResult.regime || "NORMAL",
        macro_headline: macroResult.headline_utama || "Kondisi makro stabil.",
        daftar_sinyal: hasil,
        funnel_tahap1: k1,
        alasan_seleksi_ai: alasanSeleksi
      };
      await fbWrite("bpjs_signals", "PUT", payload);
      await fbWrite(`bpjs_history/${tgl}`, "PUT", payload);
      console.log("Sinyal BPJS berhasil disimpan:", hasil.length, "emiten.");
    } else {
      await logSystemError(
        "ERROR",
        "BPJS",
        `Tidak ada sinyal BPJS yang berhasil diproses untuk EOD ${tgl}`,
        "Seluruh kandidat Top 5 gagal mendapatkan data broker summary."
      );
    }

    await fbWrite("bpjs_meta", "PATCH", {
      quota_date: todayStr,
      ia_used_today: Math.min(5, iaUsedToday),
      ia_limit_daily: 5,
      last_ia_eod: tgl,
      groq_calls_today: groqCallsToday,
      last_news_sync: new Date().toISOString(),
      last_signal_sync: new Date().toISOString(),
      last_investment_sync: new Date().toISOString(),
      bpjs_telemetry: {
        broker_checks: brokerChecks
      },
      news_telemetry: newsTelemetryPayload
    });
    console.log("Full scan selesai.");
  } catch (err) {
    console.error("Engine Error:", err);
    await logSystemError(
      "ERROR",
      "SYSTEM",
      "Engine.js berhenti karena error tak terduga",
      err?.stack || err?.message || String(err)
    );
    process.exit(1);
  }
})();
