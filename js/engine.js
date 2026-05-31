/**
 * engine.js — 展開予想エンジン（拡張版）
 *
 * 出走表（実力・モーター・ST）に加え、以下のファクターを取り込んで
 * 各艇の強さ・1マーク主導権・決まり手・進入隊形・着順・買い目を算出する。
 *
 *  - 展示タイム（周回展示の伸び/行き足の目安。速いほど機力上位）
 *  - チルト角度（上げるほど伸び型＝まくり有利・ターン安定性は低下）
 *  - 風向き / 風速（追い風=逃げ有利だがターンは流れやすい、向かい風=差し・まくり有利）
 *  - 波高（高いほど内・経験者有利、外まくり/高チルトは不利）
 *  - 場の特徴（イン有利度・まくり発生度などの会場補正）
 *  - 選手の1M戦法（握る/差し/まくり/標準/流す）= ターンラインと決まり手傾向
 */
var BR = window.BR || {};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/** 風向きごとの係数（逃げ・まくり差し系への影響） */
const WIND_EFFECT = {
  none: { nige: 0, attack: 0, variance: 0 },
  tail: { nige: 0.06, attack: -0.03, variance: 0.04 }, // 追い風: 逃げ有利・ターン流れる
  head: { nige: -0.05, attack: 0.06, variance: 0.03 }, // 向かい風: 差し/まくり有利
  side: { nige: -0.02, attack: 0.0, variance: 0.07 },  // 横風: 荒れやすい
};

/** 1M戦法の特性（ターンの締まり=tight, 決まり手の寄り） */
const STYLE_TRAIT = {
  nige:   { label: "逃げ握り", tight: 1.0,  biasInner: 0.06, biasOuter: 0.0,  power: 0.02 },
  sashi:  { label: "差し",     tight: 0.55, biasInner: 0.03, biasOuter: 0.0,  power: 0.0 },
  makuri: { label: "まくり",   tight: 0.85, biasInner: 0.0,  biasOuter: 0.07, power: 0.04 },
  normal: { label: "標準",     tight: 0.7,  biasInner: 0.0,  biasOuter: 0.0,  power: 0.0 },
  drift:  { label: "流す",     tight: 0.35, biasInner: -0.02, biasOuter: 0.0, power: -0.02 },
};
BR.STYLE_TRAIT = STYLE_TRAIT;

/** 1艇分の基礎指標 */
function computeMetrics(entry, ctx) {
  const traits = (BR.STADIUM_TRAITS && BR.STADIUM_TRAITS[ctx.stadium]) ||
    { inAdvantage: 1.0, makuri: 1.0 };

  // 進入コース別の1着率（会場のイン有利度で補正）
  const baseCourseRate = BR.COURSE_WIN_RATE[entry.course] || 5;
  const courseRate = baseCourseRate * traits.inAdvantage;

  const skill = clamp(entry.winRate / 7.5, 0, 1.1);
  const motor = clamp(entry.motorRate / 60, 0, 1.1);
  const course = clamp(courseRate / 55, 0, 1.05);
  const startScore = clamp((0.20 - entry.avgST) / 0.10, -0.5, 1.3);

  // 展示タイム: 速い(小さい)ほど良い。フィールド平均との差で評価。
  const exhScore = ctx.exhMean
    ? clamp((ctx.exhMean - entry.exhibitionTime) / 0.10, -1.0, 1.0)
    : 0;

  // チルト: 高いほど伸び型。0.5を基準に評価（プラスで伸び/まくり力）。
  const tiltScore = clamp((entry.tilt - 0.5) / 2.0, -0.3, 1.0);

  const base =
    0.30 * course +
    0.26 * skill +
    0.17 * motor +
    0.13 * startScore +
    0.10 * exhScore +
    0.04 * tiltScore;

  return { base, startScore, exhScore, tiltScore, courseRate, traits };
}

/** 1マーク主導権スコア（ST・攻撃力・風・波・戦法を加味） */
function firstMarkScore(entry, m, ctx) {
  const style = STYLE_TRAIT[entry.style] || STYLE_TRAIT.normal;
  let s = m.base;

  // STアドバンテージ
  s += 0.12 * m.startScore;

  // 外艇(進入4〜6)の攻め: 速いST×実力×伸び(チルト/展示)でまくり主導権
  if (entry.course >= 4) {
    const attack =
      clamp(m.startScore, 0, 1.3) *
      (0.6 * clamp(entry.winRate / 7.5, 0, 1.1) + 0.4 * clamp(m.exhScore + 0.5, 0, 1));
    s += 0.10 * attack * (1 + 0.3 * m.tiltScore);
    s += WIND_EFFECT[ctx.windDir].attack * ctx.windStrength;
  }

  // インの逃げ: 追い風で有利、向かい風で軽減
  if (entry.course <= 2) {
    s += WIND_EFFECT[ctx.windDir].nige * ctx.windStrength;
  }

  // 波高: 高いほど内・経験者(実力)有利、外艇/高チルトは不利
  if (ctx.waveHeight > 3) {
    const waveFactor = clamp((ctx.waveHeight - 3) / 10, 0, 1);
    if (entry.course >= 4) s -= 0.05 * waveFactor * (0.5 + m.tiltScore);
    s += 0.04 * waveFactor * clamp(entry.winRate / 7.5, 0, 1.1) * (entry.course <= 3 ? 1 : 0.3);
  }

  // 戦法による攻め寄り/守り寄り
  s += style.power + (entry.course <= 3 ? style.biasInner : style.biasOuter);

  return s;
}

/** 決まり手判定（戦法・風を加味） */
function decideKimarite(ranking, scoreByNo, byNo, ctx) {
  const leader = ranking[0];
  const second = ranking[1];
  const lead = byNo[leader];
  const gap = scoreByNo[leader] - scoreByNo[second];
  const lc = lead.course;

  if (lc === 1) return "逃げ";
  if (lc === 2) return lead.style === "makuri" ? "まくり" : "差し";
  if (lc === 3) {
    if (lead.style === "makuri") return "まくり";
    if (lead.style === "sashi") return "差し";
    return gap > 0.04 ? "まくり" : "差し";
  }
  // 4〜6コースが先頭 = まくり主体。内が残れば まくり差し。
  if (byNo[second] && byNo[second].course <= 3) return "まくり差し";
  return "まくり";
}

/**
 * メイン予想。
 * @param {Array} entries 出走表（各艇: no, course, name, winRate, motorRate, avgST, exhibitionTime, tilt, style）
 * @param {Object} conditions 風向/風速/波高/場
 */
BR.predict = function (entries, conditions) {
  conditions = conditions || {};
  const windDir = WIND_EFFECT[conditions.windDir] ? conditions.windDir : "none";
  const windSpeed = Number(conditions.windSpeed) || 0;
  const ctx = {
    stadium: conditions.stadium,
    windDir,
    windSpeed,
    windStrength: clamp(windSpeed / 6, 0, 1.6), // 6m/sでほぼ最大
    waveHeight: Number(conditions.waveHeight) || 0,
    exhMean: 0,
  };

  // 進入コースの既定は枠なり（艇番＝コース）
  const normalized = entries.map((e) => ({
    ...e,
    course: e.course || e.no,
    exhibitionTime: Number(e.exhibitionTime) || 0,
    tilt: e.tilt === undefined || e.tilt === "" ? 0.5 : Number(e.tilt),
    style: STYLE_TRAIT[e.style] ? e.style : "normal",
  }));

  // 展示タイムの平均（0は未入力として除外）
  const exhVals = normalized.map((e) => e.exhibitionTime).filter((v) => v > 0);
  ctx.exhMean = exhVals.length ? exhVals.reduce((a, b) => a + b, 0) / exhVals.length : 0;

  // 指標算出
  const enriched = normalized.map((e) => {
    const m = computeMetrics(e, ctx);
    return { ...e, _m: m, base: m.base, firstMark: firstMarkScore(e, m, ctx) };
  });

  // 着順 = 1マーク主導権の降順
  const ranking = [...enriched].sort((a, b) => b.firstMark - a.firstMark);
  const rankingNos = ranking.map((e) => e.no);
  const scoreByNo = {}, byNo = {};
  enriched.forEach((e) => { scoreByNo[e.no] = e.firstMark; byNo[e.no] = e; });

  // 勝率（主導権スコアを強調し正規化）。荒れ条件では集中度を緩める。
  const variance =
    WIND_EFFECT[windDir].variance * ctx.windStrength +
    clamp(ctx.waveHeight / 30, 0, 0.4);
  const GAMMA = clamp(3.2 - variance * 2.5, 1.6, 3.4);
  const expScores = enriched.map((e) => ({
    no: e.no,
    w: Math.pow(Math.max(e.firstMark, 0.01), GAMMA),
  }));
  const sumW = expScores.reduce((a, x) => a + x.w, 0);
  const winProb = {};
  expScores.forEach((x) => (winProb[x.no] = x.w / sumW));

  const kimarite = decideKimarite(rankingNos, scoreByNo, byNo, ctx);
  const leaderNo = rankingNos[0];
  const leader = byNo[leaderNo];

  // 可視化用の隊形データ（進入コース・起こし位置・ターン特性・タイミング）
  const stMin = Math.min(...enriched.map((e) => e.avgST));
  const stMax = Math.max(...enriched.map((e) => e.avgST));
  const development = ranking.map((e, idx) => {
    const style = STYLE_TRAIT[e.style] || STYLE_TRAIT.normal;
    const stNorm = stMax > stMin ? (e.avgST - stMin) / (stMax - stMin) : 0; // 0=速い
    return {
      no: e.no,
      course: e.course,
      rank: idx,                  // 0 = 予想1着
      tight: style.tight,         // ターンの締まり(握る=大,流す=小)
      stDelay: stNorm,            // スタートの遅れ(0=速い)
      // 起こし(助走開始)の深さ: STが速い/握る型ほど深く起こす傾向（演出）
      okoshiDepth: clamp(0.5 + (1 - stNorm) * 0.5 + (style.tight - 0.7) * 0.4, 0.2, 1.2),
    };
  });

  const comment = buildComment(kimarite, leader, ranking, winProb, ctx);
  const bets = buildBets(rankingNos, winProb);

  return {
    entries: enriched,
    ranking: rankingNos,
    winProb,
    kimarite,
    leaderNo,
    comment,
    bets,
    development,
    conditions: ctx,
  };
};

function buildComment(kimarite, leader, ranking, winProb, ctx) {
  const topProb = Math.round(winProb[leader.no] * 100);
  const secondNo = ranking[1].no;
  const info = BR.KIMARITE_INFO[kimarite] || "";
  let lead;
  if (kimarite === "逃げ") lead = `本命は ${leader.no}号艇「${leader.name}」のイン逃げ。`;
  else if (kimarite === "差し") lead = `${leader.no}号艇「${leader.name}」の差しが主導権を握る展開。`;
  else if (kimarite.startsWith("まくり")) lead = `${leader.no}号艇「${leader.name}」の${kimarite}に注目。`;
  else lead = `${leader.no}号艇「${leader.name}」が中心。`;

  const cond = [];
  if (ctx.windDir !== "none" && ctx.windSpeed > 0) {
    const wn = { tail: "追い風", head: "向かい風", side: "横風" }[ctx.windDir];
    cond.push(`${wn}${ctx.windSpeed}m`);
  }
  if (ctx.waveHeight > 0) cond.push(`波高${ctx.waveHeight}cm`);
  const condStr = cond.length ? `（${cond.join("・")}）` : "";

  return `${lead}${condStr} ${info} 勝率予想は約${topProb}%、相手は ${secondNo}号艇が有力です。`;
}

function buildBets(ranking, winProb) {
  const [a, b, c, d] = ranking;
  const pct = (no) => Math.round(winProb[no] * 100);
  return [
    { type: "3連単 本命", combo: `${a}-${b}-${c}`, conf: "◎" },
    { type: "3連単 対抗", combo: `${a}-${c}-${b}`, conf: "○" },
    { type: "3連単 抑え", combo: `${a}-${b}-${d}`, conf: "▲" },
    { type: "2連単 軸流し", combo: `${a}-${b},${a}-${c}`, conf: "◎" },
    { type: "3連複 押さえ", combo: `${a}=${b}=${c}`, conf: "○" },
  ].map((x) => ({ ...x, note: `1着${pct(a)}%` }));
}

window.BR = BR;
