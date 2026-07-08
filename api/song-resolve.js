import { Redis } from "@upstash/redis";

let redisClient = null;
const SONG_CACHE_TTL_SECONDS = 60 * 60 * 24 * 90;

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

function norm(value = "") {
  return stripTags(value)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function isInstrumentalTitle(title = "") {
  const text = String(title).toLowerCase();

  return (
    /\binst\.?\b/.test(text) ||
    /\binstrumental\b/.test(text) ||
    /\boff\s*vocal\b/.test(text) ||
    /\bmr\b/.test(text) ||
    /\(inst\.?\)/i.test(title) ||
    /\[inst\.?\]/i.test(title)
  );
}

function scoreCandidate(item, title, artist) {
  const targetTitle = norm(title);
  const targetArtist = norm(artist);
  const candidateTitle = norm(item.title);
  const candidateArtist = norm(item.artist);
  const rawText = norm(item.raw || "");

  let score = 0;

  if (candidateTitle && candidateTitle === targetTitle) score += 110;
  else if (candidateTitle && (candidateTitle.includes(targetTitle) || targetTitle.includes(candidateTitle))) score += 70;
  else if (targetTitle && rawText.includes(targetTitle)) score += 55;

  if (targetArtist) {
    if (candidateArtist && candidateArtist === targetArtist) score += 70;
    else if (candidateArtist && (candidateArtist.includes(targetArtist) || targetArtist.includes(candidateArtist))) score += 40;
    else if (rawText.includes(targetArtist)) score += 30;
  }

  return score;
}

async function fetchText(url, referer) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
      "Referer": referer
    }
  });

  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return await response.text();
}

function uniqueById(items) {
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
  const candidates = [];
  const patterns = [
    /songInfo\?xgnm=(\d{3,})/g,
    /detail\/songInfo\?xgnm=(\d{3,})/g,
    /fnPlaySong\(['"]?(\d{3,})['"]?/g,
    /fnViewSongInfo\(['"]?(\d{3,})['"]?/g,
    /data-song-id=["']?(\d{3,})["']?/g,
    /xgnm[=:]["']?(\d{3,})["']?/g
  ];

  for (const regex of patterns) {
    for (const match of html.matchAll(regex)) {
      const index = match.index || 0;
      const block = html.slice(Math.max(0, index - 3500), Math.min(html.length, index + 4500));

      const titleMatch =
        block.match(/class=["'][^"']*title[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
        block.match(/class=["'][^"']*title[^"']*["'][^>]*>\s*([\s\S]*?)\s*<\//i) ||
        block.match(/title=["']([^"']+)["']/i);

      const artistMatch =
        block.match(/class=["'][^"']*artist[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
        block.match(/class=["'][^"']*artist[^"']*["'][^>]*>\s*([\s\S]*?)\s*<\//i) ||
        block.match(/artistInfo[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);

      candidates.push({
        id: match[1],
        title: stripTags(titleMatch?.[1] || ""),
        artist: stripTags(artistMatch?.[1] || ""),
        raw: block
      });
    }
  }

  return uniqueById(candidates);
}

async function findGenie(title, artist) {
  const q = `${title} ${artist || ""}`.trim();
  const html = await fetchText(
    "https://www.genie.co.kr/search/searchSong?query=" + encodeURIComponent(q),
    "https://www.genie.co.kr/"
  );

  const candidates = extractGenieCandidates(html);
  if (!candidates.length) return "0";

  const ranked = candidates
    .map(item => ({ ...item, score: scoreCandidate(item, title, artist) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];

  if (best && best.score >= 60) return best.id;

  // 지니 HTML에서 제목/가수 텍스트를 못 뽑는 경우가 있어, 후보가 하나뿐이면 그 값을 사용한다.
  if (ranked.length === 1) return ranked[0].id;

  return "0";
}

function extractBugsCandidates(html) {
  const candidates = [];
  const patterns = [
    /\/track\/(\d{3,})/g,
    /trackId[=:]["']?(\d{3,})["']?/g,
    /data-track-id=["']?(\d{3,})["']?/g
  ];

  for (const regex of patterns) {
    for (const match of html.matchAll(regex)) {
      const index = match.index || 0;
      const block = html.slice(Math.max(0, index - 3000), Math.min(html.length, index + 4500));

      const titleMatch =
        block.match(/class=["']title["'][\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
        block.match(/title=["']([^"']+)["']/i);

      const artistMatch =
        block.match(/class=["']artist["'][\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
        block.match(/artist[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);

      candidates.push({
        id: match[1],
        title: stripTags(titleMatch?.[1] || ""),
        artist: stripTags(artistMatch?.[1] || ""),
        raw: block
      });
    }
  }

  return uniqueById(candidates);
}

async function findBugs(title, artist) {
  const q = `${title} ${artist || ""}`.trim();
  const html = await fetchText(
    "https://music.bugs.co.kr/search/track?q=" + encodeURIComponent(q),
    "https://music.bugs.co.kr/"
  );

  const candidates = extractBugsCandidates(html)
    .filter(item => !isInstrumentalTitle(item.title));

  const ranked = candidates
    .map(item => ({ ...item, score: scoreCandidate(item, title, artist) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (best && best.score >= 60) return best.id;
  if (ranked.length === 1) return ranked[0].id;
  return "0";
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
  const cacheKey = `song:v3:melon:${melon}`;

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
