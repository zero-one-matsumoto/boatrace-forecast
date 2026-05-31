/**
 * engine.js — 展開予想エンジン
 *
 * 出走表（選手の勝率・モーター2連率・平均ST・進入コース）から、
 * 各艇の「強さ」と勝率、1マークでの決まり手、着順予想、推奨買い目を算出する。
 *
 * 競艇の基本特性:
 *  - インコースほど1着率が高い（1号艇が圧倒的有利）。
 *  - スタートタイミング(ST)が速いほど主導権を握りやすく、特に外艇は
 *    速いSTがあると「まくり」が決まりやすい。
 *  - 決まり手は概ね進入コースに対応する（1=逃げ, 2=差し, 4=まくり…）。
 */
var BR = window.BR || {};

/** 値を範囲内に収める */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * 1艇分の基礎指標を計算する。
 * @returns {{base:number, startScore:number, courseRate:number}}
 */
function computeMetrics(entry) {
  const courseRate = BR.COURSE_WIN_RATE[entry.no] || 5; // 進入=艇番として扱う

  // 各要素を 0〜1 付近に正規化
  const skill = clamp(entry.winRate / 7.5, 0, 1.1);       // 全国勝率（7.5でほぼ満点）
  const motor = clamp(entry.motorRate / 60, 0, 1.1);      // モーター2連率
  const course = clamp(courseRate / 55, 0, 1);            // コース有利度
  // STは速い(小さい)ほど良い。0.20を基準に 0.10差で大きく変動。
  const startScore = clamp((0.20 - entry.avgST) / 0.10, -0.5, 1.3);

  // 総合的な「強さ」（コース有利度の比重を最も大きく取る）
  const base =
    0.34 * course +
    0.30 * skill +
    0.21 * motor +
    0.15 * startScore;

  return { base, startScore, courseRate };
}

/**
 * 1マーク到達時点の主導権スコア。
 * 強さに加え、STの速さと外艇の攻撃力（まくり適性）を加味する。
 */
function firstMarkScore(entry, metrics) {
  let s = metrics.base;

  // STアドバンテージ: 速いSTは1マークの主導権に直結
  s += 0.12 * metrics.startScore;

  // 外艇(4〜6)は「速いST × 高い実力」が揃うとまくりで主導権を取れる
  if (entry.no >= 4) {
    const attack = clamp(metrics.startScore, 0, 1.3) * clamp(entry.winRate / 7.5, 0, 1.1);
    s += 0.10 * attack;
  }
  return s;
}

/** 決まり手を判定する */
function decideKimarite(rankingNos, scoreByNo) {
  const leader = rankingNos[0];
  const second = rankingNos[1];
  const gap = scoreByNo[leader] - scoreByNo[second];

  if (leader === 1) return "逃げ";
  if (leader === 2) return "差し";
  if (leader === 3) {
    // 内に差せる隙があれば差し、スピード勝負ならまくり
    return gap > 0.04 ? "まくり" : "差し";
  }
  // 4〜6号艇が先頭 = まくり主体。内艇がすぐ後ろに残れば「まくり差し」決着も。
  if (second <= 3) return "まくり差し";
  return "まくり";
}

/**
 * メインの予想関数。
 * @param {Array} entries 出走表（6艇分）
 * @returns 予想結果オブジェクト
 */
BR.predict = function (entries) {
  // 1. 各艇の指標を算出
  const enriched = entries.map((e) => {
    const m = computeMetrics(e);
    return { ...e, _m: m, base: m.base, firstMark: firstMarkScore(e, m) };
  });

  // 2. 着順予想は 1マーク主導権スコアの降順
  const ranking = [...enriched].sort((a, b) => b.firstMark - a.firstMark);
  const rankingNos = ranking.map((e) => e.no);
  const scoreByNo = {};
  enriched.forEach((e) => (scoreByNo[e.no] = e.firstMark));

  // 3. 勝率: 主導権スコアを温度付きで強調し正規化
  const GAMMA = 3.2; // 大きいほど本命に集中
  const expScores = enriched.map((e) => ({
    no: e.no,
    w: Math.pow(Math.max(e.firstMark, 0.01), GAMMA),
  }));
  const sumW = expScores.reduce((acc, x) => acc + x.w, 0);
  const winProb = {};
  expScores.forEach((x) => (winProb[x.no] = x.w / sumW));

  // 4. 決まり手
  const kimarite = decideKimarite(rankingNos, scoreByNo);
  const leaderNo = rankingNos[0];

  // 5. コメント生成
  const leaderEntry = enriched.find((e) => e.no === leaderNo);
  const comment = buildComment(kimarite, leaderEntry, ranking, winProb);

  // 6. 推奨買い目
  const bets = buildBets(rankingNos, winProb);

  return {
    entries: enriched,
    ranking: rankingNos,
    winProb,
    kimarite,
    leaderNo,
    comment,
    bets,
  };
};

/** 予想コメントを組み立てる */
function buildComment(kimarite, leader, ranking, winProb) {
  const topProb = Math.round(winProb[leader.no] * 100);
  const secondNo = ranking[1].no;
  const info = BR.KIMARITE_INFO[kimarite] || "";
  let lead;
  if (kimarite === "逃げ") {
    lead = `本命は ${leader.no}号艇「${leader.name}」のイン逃げ。`;
  } else if (kimarite === "差し") {
    lead = `${leader.no}号艇「${leader.name}」が内を突く差しで主導権を握る展開。`;
  } else if (kimarite.startsWith("まくり")) {
    lead = `${leader.no}号艇「${leader.name}」のスピードを活かした${kimarite}に注目。`;
  } else {
    lead = `${leader.no}号艇「${leader.name}」が中心。`;
  }
  return `${lead} ${info} 勝率予想は約${topProb}%、相手は ${secondNo}号艇が有力です。`;
}

/**
 * 推奨買い目（3連単・2連単）を組み立てる。
 * 軸＝予想1着、相手＝予想2・3着を中心に、点数を絞った買い目を提示する。
 */
function buildBets(ranking, winProb) {
  const [a, b, c, d] = ranking;
  const pct = (no) => Math.round(winProb[no] * 100);

  const bets = [
    { type: "3連単 本命", combo: `${a}-${b}-${c}`, conf: "◎" },
    { type: "3連単 対抗", combo: `${a}-${c}-${b}`, conf: "○" },
    { type: "3連単 抑え", combo: `${a}-${b}-${d}`, conf: "▲" },
    { type: "2連単 軸流し", combo: `${a}-${b},${a}-${c}`, conf: "◎" },
    { type: "3連複 押さえ", combo: `${a}=${b}=${c}`, conf: "○" },
  ];
  return bets.map((x) => ({ ...x, note: `1着${pct(a)}%` }));
}

window.BR = BR;
