// Vercel Serverless Function
// /api/song-search?q=검색어
//
// 멜론 자동완성 JSONP API만 사용합니다.
// 빠르고 안정적이지만 SONGCONTENTS는 멜론 측에서 10개만 반환합니다.

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
    "?jscallback=" +
    encodeURIComponent(callback) +
    "&query=" +
    encodeURIComponent(q) +
    "&_=" +
    Date.now();

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept": "*/*",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
      "Referer": "https://www.melon.com/"
    }
  });

  if (!response.ok) throw new Error(`Melon keyword API error: ${response.status}`);

  const text = await response.text();
  const data = parseJsonp(text);
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
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=1200");

  if (req.method !== "GET") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const q = String(req.query.q || "").trim();

  if (!q) {
    res.status(200).json([]);
    return;
  }

  try {
    const results = await searchMelonKeyword(q);
    res.status(200).json(results);
  } catch (error) {
    console.error(error);
    res.status(500).send("멜론 곡 검색에 실패했습니다.");
  }
}
