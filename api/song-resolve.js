import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
});

function stripTags(html = "") {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function norm(v = "") {
  return stripTags(v).toLowerCase().replace(/\s+/g, "").replace(/[^\p{L}\p{N}]/gu, "");
}

function score(item, title, artist) {
  const t = norm(title);
  const a = norm(artist);
  const ct = norm(item.title);
  const ca = norm(item.artist);

  let s = 0;
  if (ct === t) s += 100;
  else if (ct.includes(t) || t.includes(ct)) s += 60;

  if (a && ca) {
    if (ca === a) s += 60;
    else if (ca.includes(a) || a.includes(ca)) s += 30;
  }

  return s;
}

async function fetchText(url, referer) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
      "Referer": referer
    }
  });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return await r.text();
}

async function findGenie(title, artist) {
  const q = `${title} ${artist || ""}`.trim();
  const html = await fetchText(
    "https://www.genie.co.kr/search/searchSong?query=" + encodeURIComponent(q),
    "https://www.genie.co.kr/"
  );

  const results = [];
  for (const regex of [/songInfo\?xgnm=(\d{3,})/g, /fnPlaySong\(['"]?(\d{3,})['"]?\)/g]) {
    for (const m of html.matchAll(regex)) {
      const block = html.slice(Math.max(0, m.index - 2500), Math.min(html.length, m.index + 3500));
      results.push({
        id: m[1],
        title: stripTags(block.match(/class="title[^"]*"[^>]*>\s*(?:<[^>]+>)*\s*([^<]+)/i)?.[1] || ""),
        artist: stripTags(block.match(/class="artist[^"]*"[^>]*>\s*(?:<[^>]+>)*\s*([^<]+)/i)?.[1] || "")
      });
    }
  }

  const best = results.map(x => ({ ...x, score: score(x, title, artist) })).sort((a, b) => b.score - a.score)[0];
  return best && best.score >= 60 ? best.id : "0";
}

async function findBugs(title, artist) {
  const q = `${title} ${artist || ""}`.trim();
  const html = await fetchText(
    "https://music.bugs.co.kr/search/track?q=" + encodeURIComponent(q),
    "https://music.bugs.co.kr/"
  );

  const results = [];
  for (const regex of [/\/track\/(\d{3,})/g, /trackId[=:]["']?(\d{3,})/g]) {
    for (const m of html.matchAll(regex)) {
      const block = html.slice(Math.max(0, m.index - 2500), Math.min(html.length, m.index + 3500));
      results.push({
        id: m[1],
        title: stripTags(block.match(/class="title"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] || ""),
        artist: stripTags(block.match(/class="artist"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] || "")
      });
    }
  }

  const best = results.map(x => ({ ...x, score: score(x, title, artist) })).sort((a, b) => b.score - a.score)[0];
  return best && best.score >= 60 ? best.id : "0";
}

export default async function handler(req, res) {
  const melon = String(req.query.melon || "").trim();
  const title = String(req.query.title || "").trim();
  const artist = String(req.query.artist || "").trim();

  if (!melon || !title) return res.status(400).send("missing melon/title");

  const key = `song:melon:${melon}`;

  try {
    const cached = await redis.get(key);
    if (cached) return res.status(200).json(cached);

    const [genie, bugs] = await Promise.allSettled([
      findGenie(title, artist),
      findBugs(title, artist)
    ]);

    const result = {
      title,
      artist,
      melon,
      genie: genie.status === "fulfilled" ? genie.value : "0",
      bugs: bugs.status === "fulfilled" ? bugs.value : "0"
    };

    await redis.set(key, result, { ex: 60 * 60 * 24 * 90 });

    return res.status(200).json(result);
  } catch (error) {
    console.error(error);
    return res.status(200).json({ title, artist, melon, genie: "0", bugs: "0" });
  }
}