(async () => {
  try {
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
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
    }

    function isValidNewsImage(url) {
      if (!url || typeof url !== "string" || !url.startsWith("http")) return false;
      if (url.length < 18) return false;
      return !/gstatic\.com|news\.google\.com|googleusercontent\.com\/proxy|favicon|J6_coFbogxhRI9iM864NL|logo-small|spacer\.gif|pixel\.gif|1x1/i.test(url);
    }

    function extractRssImage(itemXml) {
      const decodedXml = decodeHtmlEntities(itemXml);
      const patterns = [
        /<enclosure[^>]+url=["']([^"']+)["']/i,
        /<media:content[^>]+url=["']([^"']+)["']/i,
        /<media:thumbnail[^>]+url=["']([^"']+)["']/i,
        /<image[^>]*>[\s\S]*?<url>([^<]+)<\/url>/i,
        /<img[^>]+src=["']([^"']+)["']/i
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

    // Decode link redirect Google News agar mengarah langsung ke URL media aslinya
    async function resolveRealArticleUrl(url) {
      if (!url || !url.includes("news.google.com")) return url;
      try {
        const parsed = new URL(url);
        const parts = parsed.pathname.split("/").filter(Boolean);
        const token = parts[parts.length - 1];
        if (!token) return url;

        // 1. Coba decode base64 langsung dari token URL Google News
        try {
          const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
          const buf = Buffer.from(b64, "base64").toString("latin1");
          const found = buf.match(/https?:\/\/[^\x00-\x1f\x7f"'<>\\s]+/g);
          if (found) {
            const real = found.find(u => !u.includes("news.google.com") && !u.includes("gstatic.com"));
            if (real) return real;
          }
        } catch (_) {}

        // 2. Fallback via endpoint batchexecute Google News
        const pageRes = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow" });
        const pageHtml = await pageRes.text();
        const sigMatch = pageHtml.match(/data-n-a-sg=["']([^"']+)["']/);
        const tsMatch = pageHtml.match(/data-n-a-ts=["']([^"']+)["']/);
        if (sigMatch && tsMatch) {
          const payload = JSON.stringify([
            [["Fbv4je", JSON.stringify(["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], token, Number(tsMatch[1]), sigMatch[1]]), null, "generic"]]
          ]);
          const batchRes = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
            method: "POST",
            headers: { ...BROWSER_HEADERS, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: "f.req=" + encodeURIComponent(payload)
          });
          const batchText = await batchRes.text();
          const decodedUrlMatch = batchText.match(/\["garturlres","(https?:\\\/\\\/[^"]+)"/);
          if (decodedUrlMatch && decodedUrlMatch[1]) {
            return JSON.parse(`"${decodedUrlMatch[1]}"`);
          }
        }
      } catch (_) {}
      return url;
    }

    async function fetchOgImage(articleUrl) {
      if (!articleUrl || !articleUrl.startsWith("http")) return "";
      try {
        const realUrl = await resolveRealArticleUrl(articleUrl);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 7000);
        const resp = await fetch(realUrl, {
          headers: BROWSER_HEADERS,
          redirect: "follow",
          signal: controller.signal
        });
        clearTimeout(timer);
        if (!resp.ok) return "";

        const html = await resp.text();
        const headSlice = html.slice(0, 100000);
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
              const base = new URL(resp.url || realUrl);
              imgUrl = base.origin + imgUrl;
            }
            if (isValidNewsImage(imgUrl)) return imgUrl;
          }
        }
      } catch (_) {}
      return "";
    }

    const wibNow = getWIB();
    const todayStr = wibNow.toISOString().slice(0, 10);
    const hariIni = wibNow.getDay();
    const isWeekday = hariIni >= 1 && hariIni <= 5;
    const inputMode = process.env.INPUT_MODE || "auto";
    const isManualDispatch = process.env.GITHUB_EVENT_NAME === "workflow_dispatch";

    const metaOld = (await fetch(`${DB}/bpjs_meta.json`).then(r => r.json()).catch(() => ({}))) || {};
    const newsOld = (await fetch(`${DB}/bpjs_news.json`).then(r => r.json()).catch(() => ({}))) || {};
    const targetEod = getTglBursa(0);

    const sudahScanEodIni = metaOld.last_ia_eod === targetEod && (metaOld.ia_used_today || 0) > 0;
    const isFullRun = inputMode === "full" || (isWeekday && wibNow.getHours() === 8 && !sudahScanEodIni && inputMode === "auto");

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
    for (const m of macroSymbols) {
      const fresh = await fetchYahooQuote(m.sym);
      if (fresh) {
        macroQuotes.push({
          name: m.name,
          price: m.sym === "IDR=X" ? Math.round(fresh.price) : Number(fresh.price.toFixed(2)),
          change_pct: fresh.change_pct
        });
      } else if (oldQuotesMap.has(m.name)) {
        macroQuotes.push(oldQuotesMap.get(m.name));
      }
    }
    console.log(`Makro quotes berhasil dimuat: ${macroQuotes.length}/${macroSymbols.length}`);

    // 2. TARIK RSS BERITA EKONOMI & PASAR MODAL + THUMBNAIL RSS
    const rssUrls = [
      { url: "https://www.cnbcindonesia.com/market/rss", sumber: "CNBC Indonesia" },
      { url: "https://investasi.kontan.co.id/rss", sumber: "Kontan Investasi" },
      { url: "https://www.antaranews.com/rss/ekonomi.xml", sumber: "ANTARA Ekonomi" },
      { url: "https://economy.okezone.com/rss", sumber: "Okezone Economy" },
      { url: "https://news.google.com/rss/search?q=IHSG+OR+saham+OR+%22Bank+Indonesia%22+OR+rupiah+OR+BEI&hl=id&gl=ID&ceid=ID:id", sumber: "Google News Market" }
    ];

    let rawNews = [];
    for (const feed of rssUrls) {
      try {
        const resp = await fetch(feed.url, { headers: BROWSER_HEADERS });
        if (!resp.ok) {
          console.warn(`RSS ${feed.sumber} status HTTP ${resp.status}`);
          continue;
        }
        const xml = await resp.text();
        const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
        for (const item of items.slice(0, 6)) {
          const rawTitle = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1] || item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "";
          const rawLink = item.match(/<link><!\[CDATA\[([\s\S]*?)\]\]><\/link>/)?.[1] || item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
          const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "").trim();
          const rssImage = extractRssImage(item);

          const title = decodeHtmlEntities(rawTitle.replace(/<[^>]+>/g, ""));
          const link = decodeHtmlEntities(rawLink);
          if (title && link && link.startsWith("http")) {
            rawNews.push({
              id: rawNews.length,
              title,
              link,
              pubDate,
              sumber: feed.sumber,
              image: rssImage
            });
          }
        }
      } catch (e) {
        console.warn(`RSS ${feed.sumber} gagal:`, e.message);
      }
    }

    const seenTitles = new Set();
    rawNews = rawNews.filter(n => {
      const key = n.title.toLowerCase().slice(0, 45);
      if (seenTitles.has(key)) return false;
      seenTitles.add(key);
      return true;
    }).slice(0, 15).map((n, idx) => ({ ...n, id: idx }));

    console.log(`Total berita RSS terkumpul: ${rawNews.length} artikel (RSS bawaan gambar: ${rawNews.filter(x => x.image).length}).`);

    const currentHash = rawNews.map(n => n.title.slice(0, 30)).join("|");
    const hasExistingNews = Array.isArray(newsOld.berita_valid) && newsOld.berita_valid.length > 0;
    const oldMissingImages = hasExistingNews && newsOld.berita_valid.some(b => !b.gambar);
    const hasNewHeadlines = rawNews.length > 0 && (
      currentHash !== (newsOld.headline_hash || "") ||
      !hasExistingNews ||
      oldMissingImages ||
      isManualDispatch ||
      inputMode === "news_only"
    );

    async function getGroqModels() {
      const modelsRes = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { "Authorization": "Bearer " + GR }
      }).then(r => r.json()).catch(() => ({}));
      const activeIds = (modelsRes.data || [])
        .map(m => m.id)
        .filter(id => !/whisper|guard|tts|embed|orpheus|playai|vision/i.test(id));
      const preferred = [
        "llama-3.3-70b-versatile",
        "meta-llama/llama-4-maverick-17b-128e-instruct",
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "qwen/qwen3-32b",
        "llama-3.1-8b-instant"
      ].filter(m => activeIds.includes(m));
      return preferred.length > 0 ? preferred : ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
    }

    async function callGroqJSON(modelList, systemPrompt, userPayload, temperature = 0.15) {
      for (let attempt = 0; attempt < 3; attempt++) {
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
            console.warn(`Percobaan ${attempt + 1} (${model}) tanpa choices:`, res?.error?.message || "rate limit");
            await sleep(2500);
            continue;
          }
          const cleaned = content.replace(/```json|```/g, "").trim();
          const start = cleaned.indexOf("{");
          const end = cleaned.lastIndexOf("}");
          if (start !== -1 && end !== -1) {
            return JSON.parse(cleaned.slice(start, end + 1));
          }
        } catch (e) {
          console.warn(`Percobaan ${attempt + 1} (${model}) error:`, e.message);
        }
        await sleep(2500);
      }
      return null;
    }

    let modelList = null;
    let macroResult = newsOld;

    if (hasNewHeadlines || (isFullRun && rawNews.length > 0)) {
      modelList = await getGroqModels();
      const rawNewsForAI = rawNews.map(({ id, title, link, pubDate, sumber }) => ({ id, title, link, pubDate, sumber }));

      const parsedM = await callGroqJSON(
        modelList,
        `Kamu adalah Kepala Riset Makro & Manajemen Risiko PT Bintang Ari Wibowo untuk bursa saham Indonesia (IHSG).
Tugasmu:
1. Evaluasi indeks global, USD/IDR, dan daftar berita terbaru secara cermat (abaikan berita promosi/klikbait). Jika hari libur/akhir pekan, sebutkan bahwa IHSG berada di posisi penutupan terakhir.
2. Tentukan "risk_score" (1-10):
  - 1-4: Pasar normal/kondusif.
  - 5-7: Katalis positif kuat (bullish IHSG / inflow asing) atau kewaspadaan moderat.
  - 8-10: GUNCANGAN SISTEMIK NYATA (contoh: pengumuman/rebalancing MSCI yang memicu outflow besar atau potensi trading halt IHSG, krisis perbankan/geopolitik akut, atau indeks global/Rupiah anjlok parah).
3. Set "shock_halt": true HANYA JIKA risk_score >= 8 (terbukti valid ada guncangan besar yang berbahaya untuk entry pagi).
4. Kurasi maksimal 6 berita paling valid & berdampak ke pasar dari daftar rawNews yang diberikan. Sertakan field "raw_id" sesuai "id" dari rawNews.
Balas HANYA JSON murni:
{
  "risk_score": 3,
  "shock_halt": false,
  "regime": "NORMAL | BULLISH_CATALYST | CAUTION | MARKET_SHOCK_HALT",
  "headline_utama": "1 kalimat tajam kondisi makro saat ini",
  "ringkasan_makro": "2-3 kalimat analisis valid mengapa pasar aman / bullish / sedang terguncang",
  "berita_valid": [
    {
      "raw_id": 0,
      "judul": "judul bersih",
      "sumber": "nama media",
      "dampak": "GUNCANGAN | POSITIF | NETRAL",
      "ringkasan": "1 kalimat dampak ke IHSG/sektor",
      "link": "url asli",
      "waktu": "jam/tanggal ringkas"
    }
  ]
}`,
        { waktu_wib: wibNow.toISOString(), is_weekend: !isWeekday, macroQuotes, rawNews: rawNewsForAI },
        0.1
      );

      if (parsedM && Array.isArray(parsedM.berita_valid) && parsedM.berita_valid.length > 0) {
        const beritaDenganGambar = await Promise.all(
          parsedM.berita_valid.slice(0, 6).map(async (item) => {
            const matchedRaw =
              (typeof item.raw_id === "number" ? rawNews.find(r => r.id === item.raw_id) : null) ||
              rawNews.find(r => r.link === item.link) ||
              rawNews.find(r => r.title.toLowerCase().slice(0, 30) === String(item.judul || "").toLowerCase().slice(0, 30));

            const linkFinal = matchedRaw?.link || item.link || "";
            let gambar = matchedRaw?.image || "";
            if (!gambar && linkFinal) {
              gambar = await fetchOgImage(linkFinal);
            }
            console.log(`[IMG] ${String(item.judul || "").slice(0, 40)} -> ${gambar ? "OK (" + gambar.slice(0, 45) + "...)" : "KOSONG"}`);

            return {
              judul: item.judul || matchedRaw?.title || "",
              sumber: item.sumber || matchedRaw?.sumber || "Berita Pasar",
              dampak: item.dampak || "NETRAL",
              ringkasan: item.ringkasan || "",
              link: linkFinal,
              waktu: item.waktu || matchedRaw?.pubDate || "",
              gambar: gambar || ""
            };
          })
        );

        const jumlahGambar = beritaDenganGambar.filter(b => b.gambar).length;
        console.log(`Thumbnail berita berhasil dimuat: ${jumlahGambar}/${beritaDenganGambar.length} artikel.`);

        macroResult = {
          updated_at: new Date().toISOString(),
          headline_hash: currentHash,
          macro_quotes: macroQuotes.length > 0 ? macroQuotes : (newsOld.macro_quotes || []),
          risk_score: parsedM.risk_score || 3,
          shock_halt: Boolean(parsedM.shock_halt) || (parsedM.risk_score >= 8),
          regime: parsedM.regime || "NORMAL",
          headline_utama: parsedM.headline_utama || "Kondisi makro terpantau stabil.",
          ringkasan_makro: parsedM.ringkasan_makro || "Tidak terdeteksi guncangan sistemik pada pasar keuangan global maupun domestik.",
          berita_valid: beritaDenganGambar
        };

        await fetch(`${DB}/bpjs_news.json`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(macroResult)
        });
        console.log("Berita & Makro berhasil disimpan:", macroResult.berita_valid.length, "artikel.");
      } else if (macroQuotes.length > 0) {
        await fetch(`${DB}/bpjs_news.json`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ macro_quotes: macroQuotes, updated_at: new Date().toISOString() })
        });
        console.log("Parsing AI kosong, hanya quote makro yang diperbarui.");
      }
    } else if (macroQuotes.length > 0) {
      await fetch(`${DB}/bpjs_news.json`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ macro_quotes: macroQuotes, updated_at: new Date().toISOString() })
      });
      console.log("Headline belum berubah, quote makro diperbarui.");
    }

    if (macroResult.shock_halt) {
      const haltPayload = {
        tanggal_bursa: targetEod,
        updated_at: new Date().toISOString(),
        shock_halt: true,
        shock_reason: macroResult.ringkasan_makro,
        shock_headline: macroResult.headline_utama,
        daftar_sinyal: [],
        funnel_tahap1: [],
        alasan_seleksi_ai: "Sinyal ditahan otomatis oleh Macro Risk Guard: " + macroResult.headline_utama
      };
      await fetch(`${DB}/bpjs_signals.json`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(haltPayload)
      });
      await fetch(`${DB}/bpjs_meta.json`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quota_date: todayStr,
          ia_used_today: iaUsedToday,
          ia_limit_daily: 5,
          last_ia_eod: metaOld.last_ia_eod || "-",
          groq_calls_today: groqCallsToday,
          last_news_sync: new Date().toISOString(),
          last_signal_sync: new Date().toISOString()
        })
      });
      console.log("MARKET SHOCK HALT AKTIF.");
      return;
    }

    if (!isFullRun) {
      await fetch(`${DB}/bpjs_meta.json`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quota_date: todayStr,
          ia_used_today: iaUsedToday,
          ia_limit_daily: 5,
          groq_calls_today: groqCallsToday,
          last_news_sync: new Date().toISOString()
        })
      });
      console.log("Update berita & makro selesai.");
      return;
    }

    // 4. FULL SCAN (08:00 WIB): MODE AGRESIF BPJS SECOND-LINER & VOLUME SPIKE
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
      return;
    }
    if (!modelList) modelList = await getGroqModels();

    await sleep(1500);
    const sel = await callGroqJSON(
      modelList,
      "Analis kuantitatif BPJS BEI PT Bintang Ari Wibowo. Konteks makro: " + (macroResult.headline_utama || "Stabil") + ". Pilih TEPAT 5 saham lapis kedua/menengah dengan kombinasi lonjakan volume relatif tertinggi (>1.3x), momentum kenaikan sehat (+2.5% s/d +10%), dan likuiditas aktif untuk potensi lanjutan sesi pagi 09.00 WIB. Hindari emiten perbankan jumbo yang lambat. Balas JSON murni: {\"terpilih\":[\"T1\",\"T2\",\"T3\",\"T4\",\"T5\"],\"alasan_seleksi\":\"...\"}",
      k1,
      0.2
    );

    const top5 = (sel?.terpilih || k1.slice(0, 5).map(x => x.ticker)).slice(0, 5);
    const alasanSeleksi = sel?.alasan_seleksi || "Dipilih berdasarkan lonjakan volume relatif tertinggi, momentum harga +2,5% ke atas, dan likuiditas aktif second-liner untuk BPJS.";
    k1.forEach(s => { s.dipilih_ai = top5.includes(s.ticker); });

    function bulatkanFraksiBEI(harga) {
      const h = Math.round(harga);
      let f = 1;
      if (h >= 5000) f = 25;
      else if (h >= 2000) f = 10;
      else if (h >= 500) f = 5;
      else if (h >= 200) f = 2;
      return Math.round(h / f) * f;
    }

    const hasil = [];
    for (let i = 0; i < top5.length; i++) {
      const tk = top5[i];
      const info = k1.find(x => x.ticker === tk);
      if (!info) continue;

      iaUsedToday++;
      let br = await fetch(`https://api.indexalpha.id/stocks/broker-summary?ticker=${tk}&from=${tgl}&to=${tgl}&investor=all&market=RG`, {
        headers: { "accept": "application/json", "Authorization": "Bearer " + IA }
      }).then(r => r.json()).catch(() => null);

      if ((!br || !br.success || !br.data?.length) && i === 0) {
        const prevTgl = getTglBursa(1);
        iaUsedToday++;
        br = await fetch(`https://api.indexalpha.id/stocks/broker-summary?ticker=${tk}&from=${prevTgl}&to=${prevTgl}&investor=all&market=RG`, {
          headers: { "accept": "application/json", "Authorization": "Bearer " + IA }
        }).then(r => r.json()).catch(() => null);
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

        await sleep(1500);
        const v = await callGroqJSON(
          modelList,
          "Analis bandarmologi institusional PT Bintang Ari Wibowo untuk eksekusi BPJS 09.00 WIB. Berikan 'VALID BPJS' jika dominasi top 3 buyer >= 35% dan akumulasi bersih lebih kuat dari distribusi; 'WATCHLIST' jika dominasi 25%-34% atau akumulasi moderat; 'AVOID' jika distribusi top seller lebih besar atau dominasi < 25%. Balas JSON murni: {\"status_bandar\":\"BIG ACCUMULATION|NORMAL ACCUMULATION|NEUTRAL|DISTRIBUTION\",\"sinyal\":\"VALID BPJS|WATCHLIST|AVOID\",\"alasan\":\"2 kalimat ringkas\"}",
          { ...info, dom3, buyers, sellers, macro: macroResult.headline_utama || "Stabil" },
          0.2
        );

        const fallbackStatus = dom3 >= 42 ? "BIG ACCUMULATION" : dom3 >= 30 ? "NORMAL ACCUMULATION" : "NEUTRAL";
        const fallbackSinyal = dom3 >= 35 ? "VALID BPJS" : dom3 >= 25 ? "WATCHLIST" : "AVOID";

        hasil.push({
          ...info,
          dominasi_top3: dom3,
          buy_avg_bandar: avg1,
          selisih_modal_persen: Number((((info.harga_close - avg1) / avg1) * 100).toFixed(2)),
          max_beli_pagi: bulatkanFraksiBEI(info.harga_close * 1.02),
          target_tp: bulatkanFraksiBEI(info.harga_close * 1.03),
          cut_loss: bulatkanFraksiBEI(info.harga_close * 0.98),
          status_bandar: v?.status_bandar || fallbackStatus,
          sinyal: v?.sinyal || fallbackSinyal,
          alasan: v?.alasan || `Dominasi 3 pembeli teratas tercatat sebesar ${dom3}% dengan lonjakan volume ${info.lonjakan_volume}x dan rata-rata akumulasi di Rp ${avg1}.`,
          top_buyers: buyers,
          top_sellers: sellers
        });
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
      await fetch(`${DB}/bpjs_signals.json`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      await fetch(`${DB}/bpjs_history/${tgl}.json`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      console.log("Sinyal BPJS berhasil disimpan:", hasil.length, "emiten.");
    }

    await fetch(`${DB}/bpjs_meta.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quota_date: todayStr,
        ia_used_today: Math.min(5, iaUsedToday),
        ia_limit_daily: 5,
        last_ia_eod: tgl,
        groq_calls_today: groqCallsToday,
        last_news_sync: new Date().toISOString(),
        last_signal_sync: new Date().toISOString()
      })
    });
    console.log("Full scan selesai.");
  } catch (err) {
    console.error("Engine Error:", err);
    process.exit(1);
  }
})();
