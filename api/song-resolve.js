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

function removeParenText(value = "") {
  return String(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function titleMatches(candidateTitle, targetTitle) {
  const c = norm(candidateTitle);
  const t = norm(targetTitle);
  if (!c || !t) return false;
  if (c === t) return true;

  const cNoParen = norm(removeParenText(candidateTitle));
  const tNoParen = norm(removeParenText(targetTitle));
  return Boolean(cNoParen && tNoParen && cNoParen === tNoParen);
}

function artistMatches(candidateArtist, targetArtist) {
  const c = norm(candidateArtist);
  const t = norm(targetArtist);
  if (!t) return true;
  if (!c) return false;
  return c === t || c.includes(t) || t.includes(c);
}

function rawContainsTitleArtist(raw, title, artist) {
  const rawNorm = norm(raw);
  const titleNorm = norm(title);
  const artistNorm = norm(artist);
  if (!rawNorm || !titleNorm) return false;
  if (!rawNorm.includes(titleNorm)) return false;
  return !artistNorm || rawNorm.includes(artistNorm);
}

function buildSearchQueries(title, artist) {
  const cleanedTitle = removeParenText(title);
  const queries = [
    `${title} ${artist || ""}`.trim(),
    `${artist || ""} ${title}`.trim(),
    `${cleanedTitle} ${artist || ""}`.trim(),
    `${artist || ""} ${cleanedTitle}`.trim(),
    title,
    cleanedTitle
  ];
  return [...new Set(queries.filter(Boolean))];
}

function pickGenieCandidateText(row, id) {
  const escapedId = String(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const titlePatterns = [
    new RegExp(`fnViewSongInfo\\(['\"]?${escapedId}['\"]?\\)[\\s\\S]*?<a[^>]*>([\\s\\S]*?)<\\/a>`, "i"),
    new RegExp(`songInfo\\?xgnm=${escapedId}[^>]*>([\\s\\S]*?)<\\/a>`, "i"),
    /class=["'][^"']*title[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
    /class=["'][^"']*title[^"']*["'][^>]*>\s*([\s\S]*?)\s*<\//i,
    /title=["']([^"']+)["']/i
  ];

  const artistPatterns = [
    /class=["'][^"']*artist[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
    /class=["'][^"']*artist[^"']*["'][^>]*>\s*([\s\S]*?)\s*<\//i,
    /artistInfo[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
    /fnViewArtist[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i
  ];

  const title = stripTags((titlePatterns.map(p => row.match(p)?.[1]).find(Boolean)) || "");
  const artist = stripTags((artistPatterns.map(p => row.match(p)?.[1]).find(Boolean)) || "");
  return { title, artist };
}

function scoreCandidate(item, title, artist) {
  const targetTitle = norm(title);
  const targetArtist = norm(artist);
  const candidateTitle = norm(item.title);
  const candidateArtist = norm(item.artist);
  const rawText = norm(item.raw || "");

  let score = 0;

  if (titleMatches(item.title, title)) score += 140;
  else if (candidateTitle && targetTitle && (candidateTitle.includes(targetTitle) || targetTitle.includes(candidateTitle))) score += 70;
  else if (targetTitle && rawText.includes(targetTitle)) score += 55;

  if (targetArtist) {
    if (artistMatches(item.artist, artist)) score += 80;
    else if (rawText.includes(targetArtist)) score += 35;
  }

  if (isInstrumentalTitle(item.title)) score -= 300;
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
  const seen = new Set();

  const rows = [
    ...(html.match(/<tr[\s\S]*?<\/tr>/gi) || []),
    ...(html.match(/<li[\s\S]*?<\/li>/gi) || [])
  ];

  for (const row of rows) {
    const idMatch =
      row.match(/songInfo\?xgnm=(\d{3,})/i) ||
      row.match(/detail\/songInfo\?xgnm=(\d{3,})/i) ||
      row.match(/fnPlaySong\(['"]?(\d{3,})['"]?/i) ||
      row.match(/fnViewSongInfo\(['"]?(\d{3,})['"]?/i) ||
      row.match(/data-song-id=["']?(\d{3,})["']?/i) ||
      row.match(/xgnm[=:]["']?(\d{3,})["']?/i);

    if (!idMatch) continue;
    const id = idMatch[1];
    if (seen.has(id)) continue;

    const picked = pickGenieCandidateText(row, id);
    seen.add(id);
    candidates.push({
      id,
      title: picked.title,
      artist: picked.artist,
      raw: row
    });
  }

  // 지니 HTML이 row 단위로 안 잡히는 경우의 fallback.
  if (!candidates.length) {
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
        const id = match[1];
        if (seen.has(id)) continue;
        const index = match.index || 0;
        const block = html.slice(Math.max(0, index - 2500), Math.min(html.length, index + 3500));
        const picked = pickGenieCandidateText(block, id);

        seen.add(id);
        candidates.push({
          id,
          title: picked.title,
          artist: picked.artist,
          raw: block
        });
      }
    }
  }

  return uniqueById(candidates);
}

async function searchGenieOnce(query, title, artist) {
  const html = await fetchText(
    "https://www.genie.co.kr/search/searchSong?query=" + encodeURIComponent(query),
    "https://www.genie.co.kr/"
  );

  return extractGenieCandidates(html)
    .filter(item => !isInstrumentalTitle(item.title))
    .map(item => ({ ...item, score: scoreCandidate(item, title, artist) }))
    .sort((a, b) => b.score - a.score);
}

async function findGenie(title, artist) {
  for (const query of buildSearchQueries(title, artist)) {
    const ranked = await searchGenieOnce(query, title, artist).catch(() => []);

    const verified = ranked.find(item => {
      if (titleMatches(item.title, title) && artistMatches(item.artist, artist)) return true;
      return rawContainsTitleArtist(item.raw, title, artist) && item.score >= 90;
    });

    if (verified) return verified.id;
  }

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
  const cacheKey = `song:v9:melon:${melon}`;

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
