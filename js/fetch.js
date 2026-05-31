/**
 * fetch.js — 公式データ由来の出走表取得（BoatraceOpenAPI / CORS対応JSON）
 *
 * ブラウザから直接 today.json を取得し、指定した「場 × レース番号」の
 * 出走表を、予想エンジンが要求する形 {no, name, winRate, motorRate, avgST} に変換する。
 *
 * 注意:
 *  - JSONのフィールド名は提供元の仕様変更に備え、複数候補から解決する（defensive）。
 *  - 公式の「勝率」が無くパーセント値しか取れない場合は、近似的に勝率へ換算する。
 */
var BR = window.BR || {};

/** 数値化（不正値はnull） */
function _num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 複数候補キーから最初に見つかった数値を返す */
function _pickNum(obj, keys) {
  for (const k of keys) {
    const n = _num(obj[k]);
    if (n !== null) return n;
  }
  return null;
}

/** 複数候補キーから最初に見つかった文字列を返す */
function _pickStr(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** APIのboatオブジェクトをエンジン入力形へ変換 */
function mapBoat(b) {
  const no = _pickNum(b, ["racer_boat_number", "boat_number", "boatNumber", "no"]);
  const name =
    _pickStr(b, ["racer_name", "name", "racerName"]) || (no ? `${no}号艇` : "選手");

  // 全国勝率（競争得点ベース, おおむね4.5〜8.0）。無ければ2連対率%等から近似換算。
  let winRate = _pickNum(b, [
    "racer_rate_national", "racer_national_win_rate", "racer_national_rate",
    "racer_win_rate_national", "national_win_rate", "win_rate",
  ]);
  if (winRate === null || winRate > 12) {
    // 勝率が取れない/明らかにパーセント値 → 全国2連対率% or 1着率% から近似
    const top2 = _pickNum(b, [
      "racer_national_top_2_percent", "racer_national_top_2percent",
      "national_top_2_percent", "racer_national_top2",
    ]);
    const top1 = _pickNum(b, [
      "racer_national_top_1_percent", "racer_national_top_1percent",
      "national_top_1_percent",
    ]);
    if (top2 !== null) winRate = 3.0 + top2 * 0.06;       // 2連率45%→約5.7
    else if (top1 !== null) winRate = 2.5 + top1 * 0.12;  // 1着率25%→約5.5
    else winRate = 5.5;
  }
  winRate = _clamp(winRate, 1, 9);

  // モーター2連対率(%)
  let motorRate = _pickNum(b, [
    "racer_assigned_motor_top_2_percent", "racer_motor_top_2_percent",
    "motor_top_2_percent", "racer_assigned_motor_top_2percent",
  ]);
  if (motorRate === null) motorRate = 45;
  motorRate = _clamp(motorRate, 0, 100);

  // 平均ST
  let avgST = _pickNum(b, [
    "racer_average_start_timing", "racer_avg_st", "racer_average_st",
    "average_start_timing", "avg_st",
  ]);
  if (avgST === null || avgST <= 0) avgST = 0.16;
  avgST = _clamp(avgST, 0.01, 0.5);

  return {
    no, name,
    winRate: Number(winRate.toFixed(2)),
    motorRate: Math.round(motorRate),
    avgST: Number(avgST.toFixed(2)),
  };
}

function _stadiumOf(p) {
  return _pickNum(p, ["race_stadium_number", "stadium_number", "jcd", "stadium"]);
}
function _raceOf(p) {
  return _pickNum(p, ["race_number", "race_no", "rno", "race"]);
}

/**
 * 指定の場・レースの出走表を取得する。
 * @param {number} stadium 場コード(1〜24)
 * @param {number} race レース番号(1〜12)
 * @returns {Promise<{entries:Array, meta:Object}>}
 */
BR.fetchProgram = async function (stadium, race) {
  let res;
  try {
    res = await fetch(BR.OPENAPI_PROGRAMS_URL, { cache: "no-store" });
  } catch (e) {
    throw new Error("ネットワークに接続できませんでした（オフライン/通信制限の可能性）。");
  }
  if (!res.ok) throw new Error(`データ取得に失敗しました (HTTP ${res.status})。`);

  const data = await res.json();
  const programs = Array.isArray(data)
    ? data
    : data.programs || data.results || data.data || [];

  const prog = programs.find(
    (p) => _stadiumOf(p) === stadium && _raceOf(p) === race
  );
  if (!prog) {
    throw new Error("本日の該当レースが見つかりませんでした（開催が無い、または締切後の可能性）。");
  }

  const rawBoats = prog.boats || prog.racers || prog.entries || [];
  const entries = rawBoats
    .map(mapBoat)
    .filter((b) => b.no >= 1 && b.no <= 6)
    .sort((a, b) => a.no - b.no);

  if (entries.length < 6) {
    throw new Error("出走表の艇数が不足しています（データ未確定の可能性）。");
  }

  const stadiumName =
    (BR.STADIUMS.find((s) => s.code === stadium) || {}).name || `場${stadium}`;
  const meta = {
    stadium, race, stadiumName,
    title: _pickStr(prog, ["race_title", "title"]) || "",
    date: _pickStr(data, ["date"]) || _pickStr(prog, ["race_date", "date"]) || "",
  };
  return { entries, meta };
};

/* ===================== 直前情報（boatrace.jp / CORSプロキシ経由） ===================== */

/**
 * 公開CORSプロキシ。boatrace.jp はCORS不可のため、プロキシ越しにHTMLを取得する。
 * 先頭から順に試し、成功したものを使う（不安定なため複数用意）。
 */
BR.CORS_PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://thingproxy.freeboard.io/fetch/${u}`,
];

function _jcd2(stadium) { return String(stadium).padStart(2, "0"); }
function _todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
/** boatrace.jp 直前情報ページのURL */
function makeBeforeUrl(stadium, race, ymd) {
  return `https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=${race}&jcd=${_jcd2(stadium)}&hd=${ymd || _todayYmd()}`;
}

/** プロキシ経由でHTMLテキストを取得 */
async function fetchViaProxy(targetUrl) {
  let lastErr;
  for (const make of BR.CORS_PROXIES) {
    try {
      const res = await fetch(make(targetUrl), { cache: "no-store" });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      const text = await res.text();
      if (text && text.length > 500) return text;
      lastErr = new Error("空のレスポンス");
    } catch (e) { lastErr = e; }
  }
  throw new Error(
    `CORSプロキシ経由の取得に失敗しました（${lastErr ? lastErr.message : "不明"}）。時間をおいて再試行してください。`
  );
}

/** 気象テキストから 風速(m)・波高(cm) を抽出 */
function parseWeatherText(text) {
  const out = {};
  let m = text.match(/風速\s*([0-9]+(?:\.[0-9]+)?)\s*m/);
  if (m) out.windSpeed = Number(m[1]);
  let w = text.match(/波高\s*([0-9]+(?:\.[0-9]+)?)\s*cm/);
  if (w) out.waveHeight = Number(w[1]);
  // 天候（晴/曇/雨/雪）
  const wx = text.match(/(晴|曇|雨|雪)/);
  if (wx) out.weather = wx[1];
  return out;
}

/** 数値が展示タイムらしいか（150m, おおむね6.0〜7.5秒） */
function isExhTime(v) { return v >= 6.0 && v <= 7.6; }
/** 数値がチルト角度らしいか（-0.5〜3.0, 0.5刻み） */
function isTilt(v) { return v >= -0.5 && v <= 3.0 && (Math.round(v * 2) === v * 2); }

const PART_KEYWORDS = ["ピストン", "リング", "電気", "キャブ", "ギヤ", "ギア", "シャフト",
  "プロペラ", "ペラ", "シリンダ", "クランク", "キャリ", "その他"];

/** DOMから各艇の展示タイム・チルト・部品交換を抽出（ベストエフォート） */
function parseBoatsFromDoc(doc) {
  const result = {};
  const tbodies = Array.prototype.slice.call(doc.querySelectorAll("table tbody"));
  tbodies.forEach((tb) => {
    let no = null;
    const colorCell = tb.querySelector('[class*="is-boatColor"]');
    if (colorCell) {
      const m = (colorCell.className || "").match(/is-boatColor(\d)/);
      if (m) no = Number(m[1]);
    }
    if (!no) {
      const firstTd = tb.querySelector("td");
      const t = firstTd && firstTd.textContent.trim();
      if (/^[1-6]$/.test(t)) no = Number(t);
    }
    if (!no || no < 1 || no > 6 || result[no]) return;

    const cells = Array.prototype.slice
      .call(tb.querySelectorAll("td"))
      .map((td) => td.textContent.replace(/\s+/g, " ").trim());

    let exhibitionTime = null, tilt = null;
    cells.forEach((c) => {
      if (exhibitionTime === null) {
        const m = c.match(/(^|[^\d.])([67]\.\d{2})($|[^\d])/);
        if (m && isExhTime(Number(m[2]))) exhibitionTime = Number(m[2]);
      }
    });
    cells.forEach((c) => {
      // チルトは必ず小数表記(例 -0.5 / 0.0 / 1.5)。艇番など裸の整数は除外。
      if (tilt === null) {
        const m = c.match(/^(-?[0-3]\.[05])$/);
        if (m && isTilt(Number(m[1]))) tilt = Number(m[1]);
      }
    });
    const partsHit = cells.filter((c) => PART_KEYWORDS.some((k) => c.includes(k)));
    const parts = partsHit.length ? partsHit.join(" / ").slice(0, 60) : null;

    result[no] = { no, exhibitionTime, tilt, parts };
  });
  return result;
}

/**
 * 展示時の進入隊形を抽出（ベストエフォート）。
 * 「スタート展示」周辺から、コース順(内→外)に並ぶ艇番列を取り出す。
 * 1〜6が過不足なく取れた場合のみ採用し、course[艇番]=進入コースを返す。
 */
function parseFormationFromDoc(doc) {
  const text = doc.body ? doc.body.textContent : "";
  const idx = text.indexOf("スタート展示");
  if (idx < 0) return null;
  // スタート展示見出し以降のテーブルを探す
  const tables = Array.prototype.slice.call(doc.querySelectorAll("table"));
  for (const tbl of tables) {
    const tt = tbl.textContent || "";
    if (!/スタート展示|展示\s*ST|進入/.test(tt) && tbl.previousElementSibling &&
        !/スタート展示/.test(tbl.previousElementSibling.textContent || "")) continue;
    // 艇番候補（コードで色分けされたセル）をDOM順（=コース順）に収集
    const colorCells = Array.prototype.slice.call(tbl.querySelectorAll('[class*="is-boatColor"]'));
    const order = [];
    colorCells.forEach((c) => {
      const m = (c.className || "").match(/is-boatColor(\d)/);
      if (m) order.push(Number(m[1]));
    });
    const uniq = Array.from(new Set(order));
    if (uniq.length === 6 && uniq.slice().sort().join("") === "123456") {
      const course = {};
      uniq.forEach((boatNo, i) => (course[boatNo] = i + 1)); // i番目=i+1コース
      return course;
    }
  }
  return null;
}

/**
 * 直前情報を取得して整形する。
 * @returns {Promise<{boats:Object, weather:Object, formation:?Object, raw:Object}>}
 */
BR.fetchBeforeInfo = async function (stadium, race, ymd) {
  if (typeof DOMParser === "undefined") {
    throw new Error("この環境ではHTML解析(DOMParser)が使えません。ブラウザで実行してください。");
  }
  const url = makeBeforeUrl(stadium, race, ymd);
  const html = await fetchViaProxy(url);
  const doc = new DOMParser().parseFromString(html, "text/html");

  const bodyText = doc.body ? doc.body.textContent : html;
  const weather = parseWeatherText(bodyText);
  const boats = parseBoatsFromDoc(doc);
  const formation = parseFormationFromDoc(doc);

  const got = {
    exh: Object.values(boats).filter((b) => b.exhibitionTime != null).length,
    tilt: Object.values(boats).filter((b) => b.tilt != null).length,
    parts: Object.values(boats).filter((b) => b.parts).length,
    weather: Object.keys(weather).length > 0,
    formation: !!formation,
  };
  if (got.exh === 0 && got.tilt === 0 && !got.weather && !got.formation) {
    throw new Error("直前情報を解析できませんでした（ページ構造の変更、またはレース未確定の可能性）。");
  }
  return { boats, weather, formation, got, url };
};

// テスト用に純粋関数を公開
BR._beforeHelpers = {
  parseWeatherText, isExhTime, isTilt, parseBoatsFromDoc,
  parseFormationFromDoc, makeBeforeUrl, fetchViaProxy,
};

window.BR = BR;
