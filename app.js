const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const STORAGE_KEY = "chonggong-builder-mobile-v3";

const state = {
  default: { term: 10, title: "" },
  builds: [],
  editingSidIndex: null,
  editingYoutubeIndex: null,
  animateNextCardId: null
};

function createId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function createBuild(time, title = "") {
  const [hour, minute] = splitTime(time);
  return {
    id: createId(),
    hour,
    minute,
    title,
    galleryInfo: null,
    galleryQuery: "",
    smingTitle: "",
    smingLink: "",
    youtubeLink: "",
    songQuery: "",
    sid: []
  };
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 1800);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function nowHHMM() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function splitTime(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time || "")) return ["22", "00"];
  return time.split(":");
}

function isValidHour(value) {
  return /^([01]?\d|2[0-3])$/.test(String(value));
}

function isValidMinute(value) {
  return /^[0-5]?\d$/.test(String(value));
}

function normalizePart(value) {
  return pad(Number(value));
}

function isValidBuildTime(build) {
  return isValidHour(build.hour) && isValidMinute(build.minute);
}

function buildHHMM(build) {
  if (!isValidBuildTime(build)) return `${build.hour || "--"}:${build.minute || "--"}`;
  return `${normalizePart(build.hour)}:${normalizePart(build.minute)}`;
}

function addMinutesToHHMM(value, diff) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || "")) return value;
  const [h, m] = value.split(":").map(Number);
  const d = new Date(2000, 0, 1, h, m);
  d.setMinutes(d.getMinutes() + diff);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function latestTime() {
  const valid = state.builds.filter(isValidBuildTime);
  if (!valid.length) return nowHHMM();
  return buildHHMM(valid[valid.length - 1]);
}

function changeTimePart(build, part, diff) {
  const hour = isValidHour(build.hour) ? Number(build.hour) : 0;
  const minute = isValidMinute(build.minute) ? Number(build.minute) : 0;

  if (part === "hour") {
    build.hour = pad((hour + diff + 24) % 24);
  } else {
    build.minute = pad((minute + diff + 60) % 60);
  }
}

function normalizeGalleryUrl(input) {
  const raw = (input || "").trim();
  if (!raw) return null;

  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) candidate = "https://" + candidate;

  try {
    const url = new URL(candidate);
    const host = url.hostname.replace(/^www\./, "");
    if (!host.includes("dcinside.com")) return null;

    const id = url.searchParams.get("id");
    if (!id) return null;

    let type = "major";
    if (url.pathname.includes("/mgallery")) type = "minor";
    if (url.pathname.includes("/mini")) type = "mini";

    const path =
      type === "minor" ? "mgallery/board/lists" :
      type === "mini" ? "mini/board/lists" :
      "board/lists";

    return {
      name: `${id} 갤러리`,
      id,
      type,
      url: `https://gall.dcinside.com/${path}/?id=${encodeURIComponent(id)}`
    };
  } catch {
    return null;
  }
}

function sidToText(sid) {
  const parts = [];
  if (sid.melon) parts.push("M:" + sid.melon);
  if (sid.genie) parts.push("G:" + sid.genie);
  if (sid.bugs) parts.push("B:" + sid.bugs);
  // N/Y는 사용하지 않음. Y는 유튜브 링크 팝업의 smingLink로 처리.
  return parts.length ? "SID " + parts.join("|") : "";
}

function buildToString(build) {
  if (!build.galleryInfo) return "";

  const timeText = buildHHMM(build);
  const galleryText = build.galleryInfo.url || "";
  const titleText = "총공명 : " + (build.title || state.default.title || "미정");
  const displaySming = build.youtubeLink || build.smingTitle || "미정";
  const smingText = "스밍 : " + displaySming + (build.smingLink && !build.youtubeLink ? " " + build.smingLink : "");
  const sidText = build.youtubeLink ? "" : build.sid.map(sidToText).filter(Boolean).join("\n");

  return [timeText, galleryText, titleText, smingText, sidText].filter(Boolean).join("\n");
}

function getOutputText() {
  return state.builds.map(buildToString).filter(Boolean).join("\n\n");
}

function dcGalleryUrlByType(id, type) {
  const path =
    type === "minor" ? "mgallery/board/lists" :
    type === "mini" ? "mini/board/lists" :
    "board/lists";

  return `https://gall.dcinside.com/${path}/?id=${encodeURIComponent(id)}`;
}

function normalizeDcGalleryItem(gallery) {
  if (!gallery) return null;

  const id =
    gallery.name ||
    gallery.id ||
    gallery.gall_id ||
    gallery.gallery_id ||
    gallery.gallid;

  const koName =
    gallery.ko_name ||
    gallery.name_ko ||
    gallery.title ||
    gallery.gall_name ||
    gallery.nickname ||
    id;

  const gallType = String(gallery.gall_type || gallery.type || "").toUpperCase();

  let type = "major";
  if (gallType === "M" || gallType === "MINOR" || gallery.is_minor) type = "minor";
  if (gallType === "MI" || gallType === "MINI" || gallery.is_mini) type = "mini";

  if (!id) return null;

  const suffix =
    type === "minor" ? " 마이너 갤러리" :
    type === "mini" ? " 미니 갤러리" :
    " 갤러리";

  const hasSuffix = /갤러리$/.test(String(koName));

  return {
    name: hasSuffix ? String(koName) : String(koName) + suffix,
    id: String(id),
    type,
    url: dcGalleryUrlByType(String(id), type)
  };
}

function dcJsonpAutocomplete(keyword, signal) {
  return new Promise((resolve, reject) => {
    const callbackName = "__dcAuto_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("디시 자동완성 응답 시간 초과"));
    }, 4500);

    function cleanup() {
      clearTimeout(timer);
      script.remove();
      if (signal) signal.removeEventListener("abort", onAbort);
      try {
        delete window[callbackName];
      } catch {
        window[callbackName] = undefined;
      }
    }

    function onAbort() {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    }

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    window[callbackName] = data => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("디시 자동완성 호출 실패"));
    };

    script.src = "https://search.dcinside.com/autocomplete?callback=" +
      encodeURIComponent(callbackName) +
      "&k=" +
      encodeURIComponent(keyword);

    document.head.appendChild(script);
  });
}

async function dcSearchProvider(keyword, signal) {
  const raw = keyword.trim();
  const q = raw.toLowerCase();
  if (!q) return [];

  const parsed = normalizeGalleryUrl(keyword);
  if (parsed) return [parsed];

  if (!q) return [];

  if (gallerySearchCache.has(q)) {
    return gallerySearchCache.get(q);
  }

  try {
    const data = await dcJsonpAutocomplete(keyword, signal);
    const rawGallery =
      data?.gallery ||
      data?.galleries ||
      data?.result?.gallery ||
      data?.data?.gallery ||
      [];

    const rawArray = Array.isArray(rawGallery) ? rawGallery : Object.values(rawGallery);

    const remote = rawArray
      .map(normalizeDcGalleryItem)
      .filter(Boolean)
      .slice(0, 30);

    if (remote.length) {
      gallerySearchCache.set(q, remote);
      return remote;
    }
  } catch (error) {
    if (error.name === "AbortError") throw error;
    console.warn(error);
  }

  const local = window.LOCAL_GALLERIES
    .filter(g => g.name.toLowerCase().includes(q) || g.id.toLowerCase().includes(q))
    .slice(0, 30);

  gallerySearchCache.set(q, local);
  return local;
}

const songSearchCache = new Map();
const SONG_SEARCH_CACHE_LIMIT = 50;

function setSongSearchCache(key, value) {
  if (songSearchCache.has(key)) songSearchCache.delete(key);
  songSearchCache.set(key, value);

  while (songSearchCache.size > SONG_SEARCH_CACHE_LIMIT) {
    const oldestKey = songSearchCache.keys().next().value;
    songSearchCache.delete(oldestKey);
  }
}

let gallerySearchTimer = null;
let gallerySearchController = null;
let gallerySearchSeq = 0;
const gallerySearchCache = new Map();

async function fetchLiveSongSearch(keyword, signal) {
  const q = keyword.trim();
  if (!q || q.length < 2) return [];

  const cacheKey = q.toLowerCase();
  if (songSearchCache.has(cacheKey)) {
    return songSearchCache.get(cacheKey);
  }

  const response = await fetch(`/api/song-search?q=${encodeURIComponent(q)}`, {
    cache: "no-store",
    signal
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || "멜론 곡 검색 실패");
  }

  const data = await response.json();
  const list = Array.isArray(data) ? data.filter(Boolean).slice(0, 10) : [];
  setSongSearchCache(cacheKey, list);
  return list;
}

function pickFirstSid(value) {
  if (!value) return "";
  if (Array.isArray(value)) return value[0] ? String(value[0]).trim() : "";
  return String(value).trim();
}

function normalizeSongItem(song) {
  return {
    title: String(song.title || song.songTitle || song.name || "").trim(),
    artist: String(song.artist || song.artistName || song.singer || "").trim(),
    melon: pickFirstSid(song.melon),
    genie: pickFirstSid(song.genie),
    bugs: pickFirstSid(song.bugs),
    naver: pickFirstSid(song.naver),
    youtube: pickFirstSid(song.youtube)
  };
}

async function songSearchProvider(keyword, signal) {
  const q = keyword.trim();
  if (!q || q.length < 2) return [];

  const results = await fetchLiveSongSearch(q, signal);

  return results
    .map(normalizeSongItem)
    .filter(s => s.title || s.artist)
    .slice(0, 10);
}

function getCheckUrl(platform, sid) {
  const value = String(sid || "").trim();
  if (!value) return "";

  const urls = {
    melon: `https://www.melon.com/song/detail.htm?songId=${encodeURIComponent(value)}`,
    genie: `https://www.genie.co.kr/detail/songInfo?xgnm=${encodeURIComponent(value)}`,
    bugs: `https://music.bugs.co.kr/track/${encodeURIComponent(value)}`,
  };
  return urls[platform] || "";
}

function openCheck(platform) {
  const sidMap = {
    melon: "#melonSid",
    genie: "#genieSid",
    bugs: "#bugsSid",
    naver: "#naverSid",
    youtube: "#youtubeSid"
  };

  const input = sidMap[platform] ? $(sidMap[platform]) : null;
  const sid = input ? String(input.value || "").trim() : "";
  const searchQuery = getSearchQueryFromSidDialog();

  let url = "";

  if (platform === "melon") {
    if (!sid || sid === "0") {
      showToast("멜론 SID를 먼저 선택해주세요.");
      return;
    }
    url = getCheckUrl("melon", sid);
  }

  if (platform === "genie") {
    url = sid && sid !== "0"
      ? getCheckUrl("genie", sid)
      : (searchQuery ? `https://www.genie.co.kr/search/searchSong?query=${encodeURIComponent(searchQuery)}` : "");
  }

  if (platform === "bugs") {
    url = sid && sid !== "0"
      ? getCheckUrl("bugs", sid)
      : (searchQuery ? `https://music.bugs.co.kr/search/track?q=${encodeURIComponent(searchQuery)}` : "");
  }

  if (!url) {
    showToast("확인할 SID 또는 곡명이 없습니다.");
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}


function normalizeSidValue(value) {
  const text = String(value || "").trim();
  return text && text !== "0" ? text : "0";
}

function getSidLabel(build) {
  return build.sidTitle || build.songQuery || build.smingTitle || "곡제목";
}

function setSidResolvePending(isPending) {
  const genieInput = $("#genieSid");
  const bugsInput = $("#bugsSid");
  const saveBtn = $("#saveSidBtn");

  if (!genieInput || !bugsInput || !saveBtn) return;

  if (isPending) {
    genieInput.value = "";
    bugsInput.value = "";
    genieInput.placeholder = "확인 중...";
    bugsInput.placeholder = "확인 중...";
    genieInput.classList.add("sid-pending");
    bugsInput.classList.add("sid-pending");
    saveBtn.disabled = true;
  } else {
    genieInput.placeholder = "GENIE SID";
    bugsInput.placeholder = "BUGS SID";
    genieInput.classList.remove("sid-pending");
    bugsInput.classList.remove("sid-pending");
    saveBtn.disabled = false;
  }
}

function setSidDialogValues({ melon = "", genie = "", bugs = "" } = {}) {
  $("#melonSid").value = melon || "";
  $("#genieSid").value = genie || "";
  $("#bugsSid").value = bugs || "";
}

function setupSidTextareas() {
  ["#melonSid", "#genieSid", "#bugsSid"].forEach(selector => {
    const el = $(selector);
    if (!el) return;

    el.setAttribute("autocomplete", "off");
    el.setAttribute("autocapitalize", "off");
    el.setAttribute("spellcheck", "false");
    el.setAttribute("rows", "1");
    el.setAttribute("wrap", "off");

    el.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        el.blur();
      }
    });

    el.addEventListener("input", () => {
      const next = el.value.replace(/[\r\n]+/g, "").trim();
      if (el.value !== next) el.value = next;
    });
  });
}

function getSearchQueryFromSidDialog() {
  const title = ($("#sidSongTitle").value || $("#sidSongSearch").value || "").trim();
  return title.replace(/^(.+?)\s*-\s*/, "$1 ");
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    default: state.default,
    builds: state.builds
  }));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try {
    const saved = JSON.parse(raw);
    state.default = saved.default || state.default;
    state.builds = Array.isArray(saved.builds) ? saved.builds.map(b => {
      if (!b.id) b.id = createId();
      if (b.time && (!b.hour || !b.minute)) {
        const [h, m] = splitTime(b.time);
        b.hour = h;
        b.minute = m;
      }
      return b;
    }) : [];
    return true;
  } catch {
    return false;
  }
}

function updateSetupInputs() {
  $("#termInput").value = state.default.term;
  $("#defaultTitleInput").value = state.default.title;
}

function renderSuggestions(container, items, onSelect, type) {
  container.innerHTML = "";

  if (!items.length) {
    container.classList.add("hidden");
    return;
  }

  items.forEach(item => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "suggestion-item";

    if (type === "gallery") {
      btn.innerHTML = `${item.name}<small>${item.url}</small>`;
    } else {
      const normalized = normalizeSongItem(item);
      const sid = sidToText(normalized);
      const main = normalized.artist ? `${normalized.artist} - ${normalized.title}` : normalized.title;
      btn.innerHTML = `${main}<small>${sid || "SID 없음"}</small>`;
    }

    btn.addEventListener("click", () => onSelect(item));
    container.appendChild(btn);
  });

  container.classList.remove("hidden");
}

function render() {
  updateSetupInputs();
  const list = $("#buildList");
  const template = $("#buildCardTemplate");
  list.innerHTML = "";

  state.builds.forEach((build, index) => {
    const node = template.content.firstElementChild.cloneNode(true);
    if (state.animateNextCardId === build.id) {
      node.classList.add("new-card");
    }

    const hourInput = $(".hour-input", node);
    const minuteInput = $(".minute-input", node);
    const galleryInput = $(".gallery-search", node);
    const galleryCheckBtn = $(".gallery-check-btn", node);
    const gallerySelected = $(".gallery-selected", node);
    const gallerySuggestions = $(".gallery-suggestions", node);
    const titleInput = $(".title-input", node);
    const smingInput = $(".sming-input", node);
    const songSelected = $(".song-selected", node);

    hourInput.value = build.hour || "";
    minuteInput.value = build.minute || "";

    hourInput.classList.toggle("invalid", !isValidHour(build.hour));
    minuteInput.classList.toggle("invalid", !isValidMinute(build.minute));

    galleryInput.value = build.galleryQuery || "";
    gallerySelected.textContent = build.galleryInfo
      ? `선택됨: ${build.galleryInfo.name} (${build.galleryInfo.id})`
      : "";
    galleryCheckBtn.classList.toggle("hidden", !build.galleryInfo);

    titleInput.value = build.title || "";
    smingInput.value = build.youtubeLink ? "" : (build.smingTitle || "");
    smingInput.placeholder = build.youtubeLink ? "유튜브 링크 사용 중" : "스밍";
    smingInput.disabled = Boolean(build.youtubeLink);
    smingInput.classList.toggle("has-youtube", Boolean(build.youtubeLink));
    const sidLabel = build.sid.length
      ? `${getSidLabel(build)}: ${build.sid.map(sidToText).filter(Boolean).join(" / ")}`
      : "";

    songSelected.textContent = build.youtubeLink
      ? `유튜브 링크 사용 중: ${build.youtubeLink}`
      : sidLabel;

    $(".hour-up", node).addEventListener("click", () => {
      changeTimePart(build, "hour", 1);
      saveState();
      render();
    });

    $(".hour-down", node).addEventListener("click", () => {
      changeTimePart(build, "hour", -1);
      saveState();
      render();
    });

    $(".minute-up", node).addEventListener("click", () => {
      changeTimePart(build, "minute", 1);
      saveState();
      render();
    });

    $(".minute-down", node).addEventListener("click", () => {
      changeTimePart(build, "minute", -1);
      saveState();
      render();
    });

    hourInput.addEventListener("input", e => {
      build.hour = e.target.value;
      e.target.classList.toggle("invalid", !isValidHour(build.hour));
      saveState();
    });

    minuteInput.addEventListener("input", e => {
      build.minute = e.target.value;
      e.target.classList.toggle("invalid", !isValidMinute(build.minute));
      saveState();
    });

    hourInput.addEventListener("blur", () => {
      if (isValidHour(build.hour)) {
        build.hour = normalizePart(build.hour);
        saveState();
        render();
      }
    });

    minuteInput.addEventListener("blur", () => {
      if (isValidMinute(build.minute)) {
        build.minute = normalizePart(build.minute);
        saveState();
        render();
      }
    });

    galleryCheckBtn.addEventListener("click", () => {
      if (!build.galleryInfo || !build.galleryInfo.url) {
        showToast("선택된 갤러리가 없습니다.");
        return;
      }
      window.open(build.galleryInfo.url, "_blank", "noopener,noreferrer");
    });

    const moveUpBtn = $(".move-up-btn", node);
    const moveDownBtn = $(".move-down-btn", node);
    moveUpBtn.disabled = index === 0;
    moveDownBtn.disabled = index === state.builds.length - 1;

    moveUpBtn.addEventListener("click", () => {
      if (index <= 0) return;
      [state.builds[index - 1], state.builds[index]] = [state.builds[index], state.builds[index - 1]];
      saveState();
      render();
    });

    moveDownBtn.addEventListener("click", () => {
      if (index >= state.builds.length - 1) return;
      [state.builds[index + 1], state.builds[index]] = [state.builds[index], state.builds[index + 1]];
      saveState();
      render();
    });

    $(".delete-btn", node).addEventListener("click", () => {
      if (!confirm("이 총공을 삭제할까요?")) return;
      state.builds.splice(index, 1);
      saveState();
      render();
    });

    galleryInput.addEventListener("input", e => {
      build.galleryQuery = e.target.value;
      const keyword = build.galleryQuery.trim();
      const parsed = normalizeGalleryUrl(keyword);

      if (parsed) {
        build.galleryInfo = parsed;
        saveState();
        renderSuggestions(gallerySuggestions, [parsed], item => {
          build.galleryInfo = item;
          build.galleryQuery = item.name;
          saveState();
          render();
        }, "gallery");
        return;
      }

      saveState();

      if (gallerySearchTimer) clearTimeout(gallerySearchTimer);
      if (gallerySearchController) gallerySearchController.abort();

      if (!keyword) {
        gallerySuggestions.innerHTML = "";
        gallerySuggestions.classList.add("hidden");
        return;
      }

      const seq = ++gallerySearchSeq;
      gallerySuggestions.innerHTML = `<div class="suggestion-note">검색 중...</div>`;
      gallerySuggestions.classList.remove("hidden");

      gallerySearchTimer = setTimeout(async () => {
        gallerySearchController = new AbortController();

        try {
          const results = await dcSearchProvider(keyword, gallerySearchController.signal);
          if (seq !== gallerySearchSeq) return;

          if (!results.length) {
            gallerySuggestions.innerHTML = `<div class="suggestion-note">검색 결과가 없습니다.</div>`;
            gallerySuggestions.classList.remove("hidden");
            return;
          }

          renderSuggestions(gallerySuggestions, results, item => {
            build.galleryInfo = item;
            build.galleryQuery = item.name;
            saveState();
            render();
          }, "gallery");
        } catch (error) {
          if (error.name === "AbortError") return;
          console.warn(error);
          if (seq !== gallerySearchSeq) return;
          gallerySuggestions.innerHTML = `<div class="suggestion-note">검색에 실패했습니다.</div>`;
          gallerySuggestions.classList.remove("hidden");
        }
      }, 400);
    });

    titleInput.addEventListener("input", e => {
      build.title = e.target.value;
      saveState();
    });

    smingInput.addEventListener("input", e => {
      build.smingTitle = e.target.value;
      build.songQuery = e.target.value;
      build.youtubeLink = "";
      saveState();
    });

    $(".sid-open-btn", node).addEventListener("click", () => {
      openSidDialog(index);
    });

    $(".youtube-open-btn", node).addEventListener("click", () => {
      openYoutubeDialog(index);
    });

    list.appendChild(node);
  });

  state.animateNextCardId = null;
}

function openSidDialog(index) {
  state.editingSidIndex = index;
  const build = state.builds[index];
  const first = build.sid[0] || {};
  const label = build.sidTitle || build.songQuery || "";

  $("#sidSongSearch").value = label;
  $("#sidSongSuggestions").classList.add("hidden");
  $("#sidSongSuggestions").innerHTML = "";
  $("#sidSongTitle").value = label;

  setSidResolvePending(false);
  setSidDialogValues({
    melon: first.melon || "",
    genie: first.genie || "",
    bugs: first.bugs || ""
  });

  $("#sidDialog").classList.add("sid-dialog-open");
  $("#sidDialog").showModal();
}

function normalizeYoutubeShortUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
  try {
    const url = new URL(withProtocol);
    if (url.hostname !== "youtu.be" || url.pathname.length <= 1) return "";
    url.protocol = "https:";
    return url.toString();
  } catch {
    return "";
  }
}

function isValidYoutubeShortUrl(value) {
  return Boolean(normalizeYoutubeShortUrl(value));
}

function openYoutubeDialog(index) {
  state.editingYoutubeIndex = index;
  const build = state.builds[index];
  $("#youtubeLinkInput").value = build.youtubeLink ? build.youtubeLink.replace(/^https:\/\//, "") : "";
  $("#youtubeLinkInput").classList.toggle("invalid", Boolean(build.youtubeLink) && !isValidYoutubeShortUrl(build.youtubeLink));
  $("#youtubeDialog").showModal();
}

async function selectSongFromSidDialog(item) {
  const index = state.editingSidIndex;
  if (index == null || !state.builds[index]) return;

  const normalized = normalizeSongItem(item);
  const build = state.builds[index];
  const label = `${normalized.artist ? normalized.artist + " - " : ""}${normalized.title}`;
  const melon = normalized.melon || "";

  build.songQuery = label;
  build.sidTitle = label;
  build.youtubeLink = "";
  build.sid = [{
    melon,
    genie: "0",
    bugs: "0"
  }];

  $("#sidSongTitle").value = label;
  $("#sidSongSearch").value = label;
  $("#melonSid").value = melon;
  setSidResolvePending(true);

  $("#sidSongSuggestions").classList.add("hidden");
  $("#sidSongSuggestions").innerHTML = "";

  saveState();
  showToast("지니/벅스 SID 확인 중...");

  try {
    const params = new URLSearchParams({
      melon,
      title: normalized.title || "",
      artist: normalized.artist || ""
    });

    const response = await fetch(`/api/song-resolve?${params.toString()}`, {
      cache: "no-store"
    });

    const data = response.ok ? await response.json() : null;
    const sid = {
      melon: data?.melon || melon,
      genie: normalizeSidValue(data?.genie),
      bugs: normalizeSidValue(data?.bugs)
    };

    if (!state.builds[index]) return;

    state.builds[index].sid = [sid];
    state.builds[index].songQuery = label;
    state.builds[index].sidTitle = label;

    setSidDialogValues(sid);
    saveState();
    showToast("SID 확인 완료");
  } catch (error) {
    console.warn(error);

    const fallbackSid = {
      melon,
      genie: "0",
      bugs: "0"
    };

    if (state.builds[index]) {
      state.builds[index].sid = [fallbackSid];
      state.builds[index].songQuery = label;
      state.builds[index].sidTitle = label;
      saveState();
    }

    setSidDialogValues(fallbackSid);
    showToast("지니/벅스는 0으로 저장했습니다.");
  } finally {
    setSidResolvePending(false);
  }
}

function addBuild() {
  const term = Number(state.default.term) || 10;
  const nextTime = state.builds.length
    ? addMinutesToHHMM(latestTime(), term)
    : nowHHMM();

  const newBuild = createBuild(nextTime, state.default.title);
  state.builds.push(newBuild);
  saveState();
  render();
}

async function copyOutput() {
  const text = getOutputText();
  if (!text) {
    showToast("갤러리가 선택된 총공이 없습니다.");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast("복사했습니다.");
  } catch {
    $("#previewText").value = text;
    $("#previewPanel").classList.remove("hidden");
    $("#previewText").select();
    showToast("미리보기에서 직접 복사해주세요.");
  }
}

function showPreview() {
  $("#previewText").value = getOutputText() || "갤러리가 선택된 총공이 없습니다.";
  $("#previewPanel").classList.remove("hidden");
}

function buildToImageString(build) {
  if (!build.galleryInfo) return "";
  const timeText = `${buildHHMM(build)}   ${build.galleryInfo.name || ""}`;
  const titleText = "제목 : " + (build.title || state.default.title || "미정");
  const smingValue = build.youtubeLink || build.smingTitle || "미정";
  const smingText = "스밍 : " + smingValue;
  return [timeText, titleText, smingText].join("\n");
}

function exportImage() {
  const text = state.builds.map(buildToImageString).filter(Boolean).join("\n\n");
  if (!text) {
    showToast("이미지로 만들 총공이 없습니다.");
    return;
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const lines = text.split("\n");
  const fontSize = 21;
  const lineHeight = fontSize * 1.6;
  const padding = 24;

  ctx.font = `${fontSize}px Arial`;
  const width = Math.max(420, ...lines.map(line => ctx.measureText(line).width + padding * 2));
  const height = lines.length * lineHeight + padding * 2;

  canvas.width = width;
  canvas.height = height;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "black";
  ctx.font = `${fontSize}px Arial`;

  lines.forEach((line, i) => {
    ctx.fillText(line, padding, padding + fontSize + i * lineHeight);
  });

  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/jpeg", 0.92);
  a.download = "chonggong-image.jpg";
  a.click();
  showToast("이미지를 저장했습니다.");
}

$("#termInput").addEventListener("input", e => {
  state.default.term = Math.max(1, Number(e.target.value) || 1);
  saveState();
});

$("#defaultTitleInput").addEventListener("input", e => {
  state.default.title = e.target.value;
  saveState();
});

$("#addBuildBtn").addEventListener("click", addBuild);
$("#copyBtn").addEventListener("click", copyOutput);
$("#previewBtn").addEventListener("click", showPreview);
$("#closePreviewBtn").addEventListener("click", () => $("#previewPanel").classList.add("hidden"));
$("#saveBtn").addEventListener("click", () => {
  saveState();
  showToast("임시저장했습니다.");
});
$("#loadBtn").addEventListener("click", () => {
  if (loadState()) {
    render();
    showToast("불러왔습니다.");
  } else {
    showToast("저장된 내용이 없습니다.");
  }
});

$("#imageBtn").addEventListener("click", exportImage);

function renderSongSearchResults(box, results) {
  box.innerHTML = "";

  if (!results.length) {
    box.innerHTML = `<div class="suggestion-note">검색 결과가 없습니다.</div>`;
    box.classList.remove("hidden");
    return;
  }

  results.forEach(item => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "suggestion-item";

    const normalized = normalizeSongItem(item);
    const sid = sidToText(normalized);
    const main = normalized.artist ? `${normalized.artist} - ${normalized.title}` : normalized.title;
    btn.innerHTML = `${main}<small>${sid || "SID 없음"}</small>`;

    btn.addEventListener("click", () => selectSongFromSidDialog(normalized));
    box.appendChild(btn);
  });

  box.classList.remove("hidden");
}

let sidSearchTimer = null;
let sidSearchController = null;
let sidSearchSeq = 0;

$("#sidSongSearch").addEventListener("input", e => {
  const keyword = e.target.value.trim();
  const box = $("#sidSongSuggestions");

  if (sidSearchTimer) clearTimeout(sidSearchTimer);
  if (sidSearchController) sidSearchController.abort();

  if (!keyword) {
    box.innerHTML = "";
    box.classList.add("hidden");
    return;
  }

  if (keyword.length < 2) {
    box.innerHTML = `<div class="suggestion-note">2글자 이상 입력하면 검색합니다.</div>`;
    box.classList.remove("hidden");
    return;
  }

  const seq = ++sidSearchSeq;
  box.innerHTML = `<div class="suggestion-note">검색 중...</div>`;
  box.classList.remove("hidden");

  sidSearchTimer = setTimeout(async () => {
    sidSearchController = new AbortController();

    try {
      const results = await songSearchProvider(keyword, sidSearchController.signal);
      if (seq !== sidSearchSeq) return;
      renderSongSearchResults(box, results);
    } catch (error) {
      if (error.name === "AbortError") return;
      console.warn(error);
      if (seq !== sidSearchSeq) return;
      box.innerHTML = `<div class="suggestion-note">검색에 실패했습니다.</div>`;
      box.classList.remove("hidden");
    }
  }, 500);
});



$("#melonCheck").addEventListener("click", () => openCheck("melon"));
$("#genieCheck").addEventListener("click", () => openCheck("genie"));
$("#bugsCheck").addEventListener("click", () => openCheck("bugs"));

$("#saveSidBtn").addEventListener("click", e => {
  e.preventDefault();
  const index = state.editingSidIndex;
  if (index == null || !state.builds[index]) return;

  const build = state.builds[index];
  const label = $("#sidSongTitle").value.trim() || $("#sidSongSearch").value.trim();

  if (label) {
    build.songQuery = label;
    build.sidTitle = label;
  }

  build.sid = [{
    melon: $("#melonSid").value.trim(),
    genie: normalizeSidValue($("#genieSid").value),
    bugs: normalizeSidValue($("#bugsSid").value)
  }];
  build.youtubeLink = "";
  saveState();
  $("#sidDialog").classList.remove("sid-dialog-open");
  $("#sidDialog").close();
  render();
});

$("#cancelSidBtn").addEventListener("click", () => {
  setSidResolvePending(false);
  $("#sidDialog").classList.remove("sid-dialog-open");
  $("#sidDialog").close();
});

$("#youtubeLinkInput").addEventListener("input", e => {
  const hasValue = e.target.value.trim().length > 0;
  e.target.classList.toggle("invalid", hasValue && !isValidYoutubeShortUrl(e.target.value));
});

$("#saveYoutubeBtn").addEventListener("click", e => {
  e.preventDefault();
  const index = state.editingYoutubeIndex;
  if (index == null || !state.builds[index]) return;

  const rawValue = $("#youtubeLinkInput").value.trim();
  const value = rawValue ? normalizeYoutubeShortUrl(rawValue) : "";
  if (rawValue && !value) {
    $("#youtubeLinkInput").classList.add("invalid");
    showToast("youtu.be 형식의 링크만 사용할 수 있습니다.");
    return;
  }

  const build = state.builds[index];
  build.youtubeLink = value;
  if (value) {
    build.smingTitle = "";
    build.smingLink = "";
    build.songQuery = "";
    build.sid = [];
  }
  saveState();
  $("#youtubeDialog").close();
  render();
});

$("#cancelYoutubeBtn").addEventListener("click", () => $("#youtubeDialog").close());

setupSidTextareas();

if (!loadState()) {
  state.builds = [];
}
render();
