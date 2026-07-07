import { Redis } from "@upstash/redis";

let redisClient = null;
const SONG_CACHE_TTL_SECONDS = 60 * 60 * 24 * 90;
const CACHE_VERSION = "v2";

function getRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  if (!redisClient) {
    redisClient = new Redis({ url, token });
  }

  return redisClient;
}

function stripTags(html = "") {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSongTitle(value = "") {
  return stripTags(value)
    .replace(/\bTITLE\b/gi, "")
    .replace(/\b19금\b/g, "")
    .replace(/\bTITLE곡정보\s*보기\b/gi, "")
    .replace(/곡정보\s*보기/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function norm(v = "") {
  return stripTags(v)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function score(item, title, artist) {
  const t = norm(title);
  const a = norm(artist);
  const ct = norm(item.title);
  const ca = norm(item.artist);

  let s = 0;

  if (ct && t) {
    if (ct === t) s += 120;
    else if (ct.includes(t) || t.includes(ct)) s += 70;
  }

  if (a && ca) {
    if (ca === a) s += 70;
    else if (ca.includes(a) || a.includes(ca)) s += 35;
  }

  return s;
}

async function fetchText(url, referer) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
      "Referer": referer
    }
  });

  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return await res.text();
}

function uniqById(items) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    if (!item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }

  return out;
}

function extractGenieCandidates(html) {
  const hits = [];
  const regexes = [
    /songInfo\?xgnm=(\d{3,})/g,
    /detail\/songInfo\?xgnm=(\d{3,})/g,
    /fnViewSongInfo\(['"]?(\d{3,})['"]?\)/g,
    /fnPlaySong\(['"]?(\d{3,})['"]?\)/g,
    /addSong\(['"]?(\d{3,})['"]?\)/g,
    /data-songid=["']?(\d{3,})["']?/gi,
    /songid=["']?(\d{3,})["']?/gi
  ];

  for (const regex of regexes) {
    for (const match of html.matchAll(regex)) {
      hits.push({ id: match[1], index: match.index || 0 });
    }
  }

  const results = [];

  for (const hit of hits) {
    const block = html.slice(Math.max(0, hit.index - 3500), Math.min(html.length, hit.index + 4500));

    const titlePatterns = [
      new RegExp(`<a[^>]+(?:songInfo\\?xgnm=${hit.id}|fnViewSongInfo\\(['\"]?${hit.id})[\\s\\S]*?>([\\s\\S]*?)<\\/a>`, "i"),
      /class=["']title[^"']*["'][^>]*>\s*([\s\S]*?)<\/a>/i,
      /class=["']title[^"']*["'][^>]*>\s*([\s\S]*?)(?:<\/td>|<\/div>|<\/p>)/i,
      /title=["']([^"']+)["']/i
    ];

    const artistPatterns = [
      /class=["']artist[^"']*["'][^>]*>\s*([\s\S]*?)<\/a>/i,
      /class=["']artist[^"']*["'][^>]*>\s*([\s\S]*?)(?:<\/td>|<\/div>|<\/p>)/i,
      /artistInfo[^>]*>\s*([\s\S]*?)<\/a>/i
    ];

    let title = "";
    let artist = "";

    for (const pattern of titlePatterns) {
      const match = block.match(pattern);
      if (match?.[1]) {
        title = cleanSongTitle(match[1]);
        if (title) break;
      }
    }

    for (const pattern of artistPatterns) {
      const match = block.match(pattern);
      if (match?.[1]) {
        artist = stripTags(match[1]);
        if (artist) break;
      }
    }

    results.push({ id: hit.id, title, artist });
  }

  return uniqById(results);
}

async function findGenie(title, artist) {
  const queries = [
    `${title} ${artist || ""}`.trim(),
    title
  ].filter(Boolean);

  for (const q of [...new Set(queries)]) {
    const html = await fetchText(
      "https://www.genie.co.kr/search/searchSong?query=" + encodeURIComponent(q),
      "https://www.genie.co.kr/"
    );

    const candidates = extractGenieCandidates(html);
    const best = candidates
      .map(item => ({ ...item, score: score(item, title, artist) }))
      .sort((a, b) => b.score - a.score)[0];

    if (best && best.score >= 70) {
      return best.id;
    }

    const titleOnlyBest = candidates
      .map(item => ({ ...item, score: score(item, title, "") }))
      .sort((a, b) => b.score - a.score)[0];

    if (titleOnlyBest && titleOnlyBest.score >= 100) {
      return titleOnlyBest.id;
    }
  }

  return "0";
}

function extractBugsCandidates(html) {
  const hits = [];
  const regexes = [
    /\/track\/(\d{3,})/g,
    /trackId[=:"]["']?(\d{3,})/g,
    /track_id[=:"]["']?(\d{3,})/gi
  ];

  for (const regex of regexes) {
    for (const match of html.matchAll(regex)) {
      hits.push({ id: match[1], index: match.index || 0 });
    }
  }

  const results = [];

  for (const hit of hits) {
    const block = html.slice(Math.max(0, hit.index - 3000), Math.min(html.length, hit.index + 4000));

    const titleMatch =
      block.match(/class=["']title["'][\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
      block.match(/title=["']([^"']+)["']/i);

    const artistMatch =
      block.match(/class=["']artist["'][\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
      block.match(/artist[^>]*>\s*([^<]+)</i);

    results.push({
      id: hit.id,
      title: cleanSongTitle(titleMatch?.[1] || ""),
      artist: stripTags(artistMatch?.[1] || "")
    });
  }

  return uniqById(results);
}

async function findBugs(title, artist) {
  const q = `${title} ${artist || ""}`.trim();
  const html = await fetchText(
    "https://music.bugs.co.kr/search/track?q=" + encodeURIComponent(q),
    "https://music.bugs.co.kr/"
  );

  const candidates = extractBugsCandidates(html);
  const best = candidates
    .map(item => ({ ...item, score: score(item, title, artist) }))
    .sort((a, b) => b.score - a.score)[0];

  return best && best.score >= 60 ? best.id : "0";
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  const melon = String(req.query.melon || "").trim();
  const title = String(req.query.title || "").trim();
  const artist = String(req.query.artist || "").trim();

  if (!melon || !title) {
    return res.status(400).send("missing melon/title");
  }

  const redis = getRedis();
  const cacheKey = `song:${CACHE_VERSION}:melon:${melon}`;

  try {
    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        res.setHeader("X-Cache", "HIT");
        return res.status(200).json(cached);
      }
    }

    const [genieResult, bugsResult] = await Promise.allSettled([
      findGenie(title, artist),
      findBugs(title, artist)
    ]);

    const result = {
      title,
      artist,
      melon,
      genie: genieResult.status === "fulfilled" ? genieResult.value : "0",
      bugs: bugsResult.status === "fulfilled" ? bugsResult.value : "0"
    };

    if (redis) {
      await redis.set(cacheKey, result, { ex: SONG_CACHE_TTL_SECONDS });
      res.setHeader("X-Cache", "MISS");
    } else {
      res.setHeader("X-Cache", "BYPASS");
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error(error);
    return res.status(200).json({
      title,
      artist,
      melon,
      genie: "0",
      bugs: "0"
    });
  }
}
