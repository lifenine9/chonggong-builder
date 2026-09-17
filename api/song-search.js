import { Redis } from "@upstash/redis";

let redisClient = null;

const SEARCH_CACHE_TTL_SECONDS = 60 * 60 * 24;

function getRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  if (!redisClient) {
    redisClient = new Redis({ url, token });
  }

  return redisClient;
}

function parseJsonp(text) {
  const trimmed = String(text || "").trim();
  const firstParen = trimmed.indexOf("(");
  const lastParen = trimmed.lastIndexOf(")");

  if (firstParen < 0 || lastParen <= firstParen) {
    throw new Error("JSONP 응답 파싱 실패");
  }

  const jsonText = trimmed.slice(firstParen + 1, lastParen);
  return JSON.parse(jsonText);
}

function stripHtml(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchKey(q) {
  return String(q || "").trim().toLowerCase();
}

function normalizeSongResult(songs) {
  return songs
    .map(song => ({
      title: stripHtml(song.SONGNAME || song.SONGNAMEDP || song.title || ""),
      artist: stripHtml(song.ARTISTNAME || song.artist || ""),
      melon: song.SONGID || song.melon
        ? [String(song.SONGID || song.melon)]
        : [],
      genie: [],
      bugs: [],
      album: stripHtml(song.ALBUMNAME || song.album || "")
    }))
    .filter(song => song.title && song.melon.length)
    .slice(0, 10);
}

async function searchMelonKeyword(q) {
  const callback = "jQuery" + Date.now();
  const url =
    "https://www.melon.com/search/keyword/index.json" +
    "?jscallback=" +
    encodeURIComponent(callback) +
    "&query=" +
    encodeURIComponent(q) +
    "&_=" +
    Date.now();

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "*/*",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
      Referer: "https://www.melon.com/index.htm"
    }
  });

  if (!response.ok) {
    throw new Error(`Melon keyword API error: ${response.status}`);
  }

  const text = await response.text();
  const data = parseJsonp(text);
  const songs = Array.isArray(data?.SONGCONTENTS)
    ? data.SONGCONTENTS
    : [];

  return normalizeSongResult(songs);
}

function extractAttribute(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text || "").match(
    new RegExp(`${escaped}=["']([^"']+)["']`, "i")
  );
  return match ? match[1] : "";
}

function extractMelonHtmlSongs(html) {
  const source = String(html || "");
  const results = [];
  const seen = new Set();

  const idRegex = /melon\.link\.goSongDetail\(['"](\d+)['"]\)/gi;

  for (const match of source.matchAll(idRegex)) {
    const songId = match[1];
    if (seen.has(songId)) continue;

    const index = match.index || 0;
    const block = source.slice(
      Math.max(0, index - 5000),
      Math.min(source.length, index + 5000)
    );

    const titleMatch =
      block.match(/class=["'][^"']*rank01[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
      block.match(/class=["'][^"']*title[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);

    const artistMatch =
      block.match(/class=["'][^"']*rank02[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
      block.match(/class=["'][^"']*artist[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);

    const title = stripHtml(titleMatch?.[1] || "");
    const artist = stripHtml(artistMatch?.[1] || "");

    if (!title) continue;

    seen.add(songId);
    results.push({
      SONGID: songId,
      SONGNAME: title,
      ARTISTNAME: artist
    });

    if (results.length >= 10) break;
  }

  return normalizeSongResult(results);
}

async function searchMelonHtml(q) {
  const url =
    "https://www.melon.com/search/total/index.htm?q=" +
    encodeURIComponent(q);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
      Referer: "https://www.melon.com/"
    }
  });

  if (!response.ok) {
    throw new Error(`Melon HTML search error: ${response.status}`);
  }

  const html = await response.text();
  return extractMelonHtmlSongs(html);
}

async function searchMelon(q) {
  try {
    const results = await searchMelonKeyword(q);
    if (results.length) return results;
  } catch (error) {
    console.warn("Melon keyword search failed:", error);
  }

  return searchMelonHtml(q);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=600");

  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  const q = String(req.query.q || "").trim();

  if (!q) {
    return res.status(200).json([]);
  }

  const redis = getRedis();
  const cacheKey = `search:melon:${normalizeSearchKey(q)}`;

  try {
    if (redis) {
      const cached = await redis.get(cacheKey);

      if (cached) {
        res.setHeader("X-Cache", "HIT");
        return res.status(200).json(cached);
      }
    }

    const results = await searchMelon(q);

    if (redis) {
      await redis.set(cacheKey, results, {
        ex: SEARCH_CACHE_TTL_SECONDS
      });
      res.setHeader("X-Cache", "MISS");
    } else {
      res.setHeader("X-Cache", "BYPASS");
    }

    return res.status(200).json(results);
  } catch (error) {
    console.error("song-search error:", error);
    return res.status(500).send("멜론 곡 검색에 실패했습니다.");
  }
}
