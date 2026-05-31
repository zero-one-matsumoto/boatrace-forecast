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
const BR = window.BR || {};

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

window.BR = BR;
