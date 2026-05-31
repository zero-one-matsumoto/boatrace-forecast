/**
 * visualize.js — 展開予想ビジュアライザー
 *
 * スタートから1マーク（第1ターンマーク）までの攻防を Canvas 上でアニメーション表示する。
 * 予想された着順・決まり手に基づき、各艇の航跡（ターンライン）を描画する。
 *  - 予想1着の艇は最も内側を小回りし、先にマークを回る。
 *  - 下位艇ほど外側を大回りし、遅れて回る。
 *  - 「まくり」では外艇が先頭に立つため、その艇が内側ラインで先マイする。
 */
var BR = window.BR || {};

var Visualizer = (function () {
  // 論理キャンバスサイズ
  const W = 920, H = 520;
  // 1マーク（ターンマーク）の位置
  const BUOY = { x: 690, y: 350 };
  const START_X = 120;

  let canvas, ctx, dpr = 1;
  let boats = [];          // 描画用の艇データ（パス・色など）
  let rafId = null;
  let startTime = 0;
  const DURATION = 4200;   // アニメーション時間(ms)
  let onDone = null;

  /** 進入コース(=艇番)ごとのスタートライン上のY座標。内(1号艇)が下、外(6号艇)が上。 */
  function startY(course) {
    return 96 + (6 - course) * 41;
  }

  /** 初期化 */
  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d");
    dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
  }

  /**
   * 予想結果からアニメーション用のパスを構築して再生する。
   * @param {Object} prediction BR.predict() の戻り値
   */
  function render(prediction) {
    const rankIndex = {};
    prediction.ranking.forEach((no, i) => (rankIndex[no] = i));

    boats = prediction.entries.map((e) => {
      const r = rankIndex[e.no];            // 0 = 予想1着
      const meta = BR.BOATS[e.no - 1];
      const y0 = startY(e.no);

      // 着順が上の艇ほどマークを小回り(半径小)し、先に回る
      const R = 30 + r * 19;                 // ターン半径（内回り/外回り）
      const lead = r * 0.045;                // 進行の遅れ（先頭ほど小さい）

      // 3次ベジエ曲線の制御点: スタート → 直進 → マーク手前(小回り) → 旋回出口
      const P0 = { x: START_X, y: y0 };
      const P1 = { x: BUOY.x - 150, y: y0 };
      const P2 = { x: BUOY.x - R, y: BUOY.y + R * 0.25 };
      const P3 = { x: BUOY.x - R * 0.25, y: BUOY.y - R };

      return {
        no: e.no, name: e.name, rank: r,
        color: meta.color, textColor: meta.textColor,
        P0, P1, P2, P3, lead,
        trail: [],
      };
    });

    stop();
    startTime = performance.now();
    onDone = null;
    rafId = requestAnimationFrame(loop);
  }

  /** 再生（同じパスでもう一度） */
  function replay() {
    if (!boats.length) return;
    boats.forEach((b) => (b.trail = []));
    stop();
    startTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  /** 3次ベジエ上の点 */
  function bezier(b, t) {
    const mt = 1 - t;
    const a0 = mt * mt * mt, a1 = 3 * mt * mt * t, a2 = 3 * mt * t * t, a3 = t * t * t;
    return {
      x: a0 * b.P0.x + a1 * b.P1.x + a2 * b.P2.x + a3 * b.P3.x,
      y: a0 * b.P0.y + a1 * b.P1.y + a2 * b.P2.y + a3 * b.P3.y,
    };
  }

  /** 3次ベジエの接線（進行方向の角度算出用） */
  function bezierAngle(b, t) {
    const mt = 1 - t;
    const dx =
      3 * mt * mt * (b.P1.x - b.P0.x) +
      6 * mt * t * (b.P2.x - b.P1.x) +
      3 * t * t * (b.P3.x - b.P2.x);
    const dy =
      3 * mt * mt * (b.P1.y - b.P0.y) +
      6 * mt * t * (b.P2.y - b.P1.y) +
      3 * t * t * (b.P3.y - b.P2.y);
    return Math.atan2(dy, dx);
  }

  /** メインループ */
  function loop(now) {
    const elapsed = (now - startTime) / DURATION; // 0..1+
    drawScene(elapsed);
    if (elapsed < 1.05) {
      rafId = requestAnimationFrame(loop);
    } else {
      rafId = null;
      drawScene(1); // 最終フレームを確定描画
      if (onDone) onDone();
    }
  }

  /** 全体の描画 */
  function drawScene(progress) {
    drawCourse();

    // 各艇の現在位置を計算
    const positions = boats.map((b) => {
      const t = Math.max(0, Math.min(1, progress - b.lead));
      const pos = bezier(b, t);
      const ang = bezierAngle(b, t);
      // 航跡を記録
      if (t > 0 && t < 1.0) {
        b.trail.push({ x: pos.x, y: pos.y });
        if (b.trail.length > 60) b.trail.shift();
      }
      return { b, pos, ang, t };
    });

    // 航跡を先に描画
    positions.forEach(({ b }) => drawTrail(b));
    // 艇を描画
    positions.forEach(({ b, pos, ang }) => drawBoat(b, pos, ang));
  }

  /** コース（水面・ライン・ターンマーク）を描画 */
  function drawCourse() {
    // 水面グラデーション
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#2a8bc4");
    g.addColorStop(1, "#0b4d7a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // うっすらレーンガイド
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    for (let c = 1; c <= 6; c++) {
      const y = startY(c);
      ctx.beginPath();
      ctx.moveTo(START_X, y);
      ctx.lineTo(BUOY.x - 40, y);
      ctx.stroke();
    }

    // スタートライン
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(START_X, startY(6) - 30);
    ctx.lineTo(START_X, startY(1) + 30);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("スタート", START_X, startY(6) - 42);

    // ターンマーク（1マーク）: 赤白のブイ
    drawBuoy(BUOY.x, BUOY.y);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("1マーク", BUOY.x + 18, BUOY.y - 14);
  }

  /** ターンマークのブイを描画 */
  function drawBuoy(x, y) {
    // 影
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(x, y + 14, 14, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 本体（円柱風）
    ctx.fillStyle = "#e63946";
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, 11, Math.PI * 0.15, Math.PI * 0.85);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** 航跡（ウェイク）を描画 */
  function drawTrail(b) {
    if (b.trail.length < 2) return;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    for (let i = 1; i < b.trail.length; i++) {
      const alpha = (i / b.trail.length) * 0.5;
      ctx.strokeStyle = hexToRgba(b.color, alpha, b.no === 1);
      ctx.beginPath();
      ctx.moveTo(b.trail[i - 1].x, b.trail[i - 1].y);
      ctx.lineTo(b.trail[i].x, b.trail[i].y);
      ctx.stroke();
    }
  }

  /** 1艇を描画（進行方向に回転） */
  function drawBoat(b, pos, ang) {
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(ang);

    // 船体（先のとがった舟形）
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-9, -7);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-9, 7);
    ctx.closePath();
    ctx.fillStyle = b.color;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 艇番ラベル（回転させず水平に）
    ctx.beginPath();
    ctx.arc(pos.x, pos.y - 16, 9, 0, Math.PI * 2);
    ctx.fillStyle = b.color;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = b.textColor;
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(b.no), pos.x, pos.y - 16);
    ctx.textBaseline = "alphabetic";
  }

  /** #rrggbb → rgba文字列。1号艇(白)は視認性のため縁取り色を調整 */
  function hexToRgba(hex, alpha, isWhite) {
    const c = hex.replace("#", "");
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    if (isWhite) return `rgba(210,225,235,${alpha})`;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  return { init, render, replay, stop };
})();

BR.Visualizer = Visualizer;
window.BR = BR;
