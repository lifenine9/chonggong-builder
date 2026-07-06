import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
});

function parseJsonp(text) {
  const start = text.indexOf("(");
  const end = text.lastIndexOf(")");
  if (start < 0 || end < start) throw new Error("JSONP 응답 파싱 실패");
  return JSON.parse(text.slice(start + 1, end));
}

function stripHtml(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function searchMelonKeyword(q) {
  const callback = "jsonp_callback_" + Date.now();
  const url =
    "https://www.melon.com/search/keyword/index.json" +
    "?jscallback=" + encodeURIComponent(callback) +
    "&query=" + encodeURIComponent(q) +
    "&_=" + Date.now();

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "*/*",
      "Accept-Language": "ko-KR,ko;q=0.9",
      "Referer": "https://www.melon.com/"
    }
  });

  if (!response.ok) throw new Error(`Melon error: ${response.status}`);

  const data = parseJsonp(await response.text());
  const songs = Array.isArray(data.SONGCONTENTS) ? data.SONGCONTENTS : [];

  return songs.map(song => ({
    title: stripHtml(song.SONGNAME || song.SONGNAMEDP || ""),
    artist: stripHtml(song.ARTISTNAME || ""),
    melon: song.SONGID ? [String(song.SONGID)] : [],
    genie: [],
    bugs: [],
    album: stripHtml(song.ALBUMNAME || "")
  })).filter(song => song.title && song.melon.length).slice(0, 10);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=600");

  const q = String(req.query.q || "").trim();
  if (!q) return res.status(200).json([]);

  const key = `search:melon:${q.toLowerCase()}`;

  try {
    const cached = await redis.get(key);
    if (cached) return res.status(200).json(cached);

    const results = await searchMelonKeyword(q);
    await redis.set(key, results, { ex: 60 * 60 * 24 });

    return res.status(200).json(results);
  } catch (error) {
    console.error(error);
    return res.status(500).send("멜론 곡 검색 실패");
  }
}