/**
 * visualize.js — 展開予想ビジュアライザー（反時計回り・フルラップ・スクラブ対応）
 *
 *  - コースは実際のボートレースと同じ反時計回り（左回り）。
 *    ホームストレッチ(下,→東)→1マーク(右)→バックストレッチ(上,←西)→2マーク(左)→ホーム。
 *  - 再生開始は「作戦待機行動終了後」= 各艇が進入コースで助走を起こす位置から。
 *  - 1マーク通過後もバック〜2マークまで描画を継続。シークバーで任意位置へスクラブ可能。
 *  - 予想着順・決まり手・戦法に基づき、誰がどのコースから起こしてどう回るかを表現する。
 */
var BR = window.BR || {};

var Visualizer = (function () {
  const W = 960, H = 560;
  const M1 = { x: 790, y: 300 };   // 1マーク（右）
  const M2 = { x: 170, y: 300 };   // 2マーク（左）
  const X_START = 470;             // スタートライン（ホーム上）
  const CENTER = { x: 480, y: 300 };

  let canvas, ctx, dpr = 1;
  let boats = [];
  let rafId = null;
  let lastTs = 0;
  let progress = 0;          // 0..1 タイムライン全体
  let playing = false;
  const DURATION = 7200;     // フルラップ再生時間(ms)
  let phaseTicks = { start: 0.15, mark: 0.45 };

  // コールバック
  let onProgress = null;     // (t) => void
  let onStateChange = null;  // (playing) => void

  /** ホームストレッチ上のレーンY（進入コース別。内=1コースが上/中央寄り） */
  function yHome(course) { return 360 + (course - 1) * 18; }
  /** バックストレッチ上のレーンY（着順別。1着=内=下/中央寄り） */
  function yBack(rank) { return 246 - rank * 18; }

  // ---------- Catmull-Rom スプライン（円弧長で等速サンプリング） ----------
  function catmull(p0, p1, p2, p3, s) {
    const s2 = s * s, s3 = s2 * s;
    return {
      x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * s +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s3),
      y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * s +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s3),
    };
  }

  function buildSmoothPath(wp) {
    const pts = [];
    const ext = [wp[0], ...wp, wp[wp.length - 1]];
    const STEPS = 26;
    for (let i = 0; i < ext.length - 3; i++) {
      for (let s = 0; s < STEPS; s++) {
        pts.push(catmull(ext[i], ext[i + 1], ext[i + 2], ext[i + 3], s / STEPS));
      }
    }
    pts.push(wp[wp.length - 1]);
    // 累積長
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
      cum.push(cum[i - 1] + Math.hypot(dx, dy));
    }
    return { pts, cum, total: cum[cum.length - 1] };
  }

  /** 円弧長フラクション(0..1)での位置と向き */
  function sampleAt(path, frac) {
    frac = Math.max(0, Math.min(1, frac));
    const target = frac * path.total;
    const { pts, cum } = path;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1; else hi = mid;
    }
    const i = Math.max(1, lo);
    const seg = cum[i] - cum[i - 1] || 1;
    const r = (target - cum[i - 1]) / seg;
    const a = pts[i - 1], b = pts[i];
    const x = a.x + (b.x - a.x) * r, y = a.y + (b.y - a.y) * r;
    // 向きは少し先のサンプルから
    const j = Math.min(pts.length - 1, i + 1);
    const angle = Math.atan2(pts[j].y - a.y, pts[j].x - a.x);
    return { x, y, angle };
  }

  /** 1艇分のフルラップ航跡ウェイポイントを作る */
  function makeWaypoints(d) {
    const c = d.course, r = d.rank, tight = d.tight;
    const yh = yHome(c), yb = yBack(r);
    // ターン半径: 着順が上＝小回り、握る型ほど締まる
    const R = Math.max(22, Math.min(120, 28 + r * 15 - (tight - 0.7) * 20));
    // 起こし位置（助走開始）: 深さ d.okoshiDepth
    const xOkoshi = X_START - (120 + d.okoshiDepth * 70);

    return [
      { x: xOkoshi, y: yh },                         // 0 起こし(待機行動終了後)
      { x: X_START, y: yh },                         // 1 スタートライン通過
      { x: 690, y: yh },                             // 2 1M進入
      { x: M1.x + R * 0.55, y: M1.y + R * 0.9 },     // 3 1Mターン入口(右下)
      { x: M1.x + R, y: M1.y + R * 0.05 },           // 4 1M頂点(右)
      { x: M1.x + R * 0.1, y: M1.y - R * 0.95 },     // 5 1Mターン出口(右上)
      { x: 650, y: yb },                             // 6 バック進入(西へ)
      { x: 400, y: yb },                             // 7 バック中盤
      { x: M2.x + 120, y: yb + (M2.y - yb) * 0.35 }, // 8 2M進入
      { x: M2.x - (18 + r * 10), y: M2.y - 6 },      // 9 2M頂点(左)
      { x: M2.x + 90, y: yHome(r + 1) },             // 10 2M出口→ホーム復帰
      { x: 360, y: yHome(r + 1) },                   // 11 ホーム(2周目)
    ];
  }

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d");
    dpr = (window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
  }

  /** 予想結果を読み込み、起こし位置(t=0)を描画（自動再生はしない） */
  function load(result) {
    const dev = result.development;
    boats = dev.map((d) => {
      const meta = BR.BOATS[d.no - 1];
      const path = buildSmoothPath(makeWaypoints(d));
      // タイミング: STが速い/着順上位ほど僅かに先行
      const off = 0.022 * d.stDelay + 0.03 * (d.rank / 5);
      return { no: d.no, course: d.course, rank: d.rank, color: meta.color,
        textColor: meta.textColor, path, off, trail: [] };
    });

    // フェーズ位置（代表＝先頭艇のパス長から算出）
    const lead = boats.find((b) => b.rank === 0) || boats[0];
    if (lead) {
      phaseTicks = {
        start: fracAtWaypoint(lead.path, 1, makeWaypointsCountRef(lead)),
        mark: fracAtWaypoint(lead.path, 4, makeWaypointsCountRef(lead)),
      };
    }

    stop();
    progress = 0;
    playing = false;
    drawScene(0);
    if (onStateChange) onStateChange(false);
    if (onProgress) onProgress(0);
  }

  // ウェイポイント本数（フェーズ算出の補助）
  function makeWaypointsCountRef() { return 12; }
  /** n番目のウェイポイントが全長のどのフラクションかを近似 */
  function fracAtWaypoint(path, wpIndex, wpCount) {
    // ウェイポイントは等間隔の制御点。対応サンプルインデックスを推定。
    const approx = wpIndex / (wpCount - 1);
    return Math.max(0, Math.min(1, approx));
  }

  // ---------- 再生制御 ----------
  function play() {
    if (!boats.length) return;
    if (progress >= 1) progress = 0;
    playing = true;
    if (onStateChange) onStateChange(true);
    lastTs = 0;
    stop();
    rafId = requestAnimationFrame(loop);
  }
  function pause() {
    playing = false;
    stop();
    if (onStateChange) onStateChange(false);
  }
  function toggle() { playing ? pause() : play(); }
  function seek(t) {
    progress = Math.max(0, Math.min(1, t));
    drawScene(progress);
    if (onProgress) onProgress(progress);
  }
  function stop() { if (rafId) cancelAnimationFrame(rafId); rafId = null; }
  function isPlaying() { return playing; }

  function loop(ts) {
    if (!playing) return;
    if (!lastTs) lastTs = ts;
    const dt = ts - lastTs;
    lastTs = ts;
    progress += dt / DURATION;
    if (progress >= 1) {
      progress = 1;
      drawScene(1);
      if (onProgress) onProgress(1);
      pause();
      return;
    }
    drawScene(progress);
    if (onProgress) onProgress(progress);
    rafId = requestAnimationFrame(loop);
  }

  // ---------- 描画 ----------
  function drawScene(t) {
    drawCourse();
    const positions = boats.map((b) => {
      const p = Math.max(0, Math.min(1, t - b.off));
      const s = sampleAt(b.path, p);
      if (p > 0 && p < 1) {
        b.trail.push({ x: s.x, y: s.y });
        if (b.trail.length > 70) b.trail.shift();
      } else if (p <= 0) {
        b.trail.length = 0;
      }
      return { b, s, p };
    });
    positions.forEach(({ b }) => drawTrail(b));
    // 起こし位置（待機行動終了後）の薄いマーカー（t序盤のみ）
    if (t < phaseTicks.start + 0.05) positions.forEach(({ b }) => drawOkoshiMark(b));
    positions.forEach(({ b, s, p }) => drawBoat(b, s, p, t));
  }

  function drawCourse() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#2a8bc4");
    g.addColorStop(1, "#0b4d7a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // インフィールド（中央の島）
    ctx.fillStyle = "rgba(20,70,110,0.55)";
    roundRect(M2.x + 60, M1.y - 120, (M1.x - 60) - (M2.x + 60), 240, 90);
    ctx.fill();

    // 走路（レーシングライン）の目安オーバル
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 2;
    roundRect(M2.x - 70, M1.y - 200, (M1.x + 70) - (M2.x - 70), 400, 170);
    ctx.stroke();

    // 反時計回りの方向矢印
    drawArrow(560, 488, 1);   // ホーム(下) 東向き →
    drawArrow(400, 112, -1);  // バック(上) 西向き ←

    // スタートライン
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(X_START, yHome(1) - 26);
    ctx.lineTo(X_START, yHome(6) + 26);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("スタート/ゴール", X_START, yHome(6) + 44);

    // ターンマーク
    drawBuoy(M1.x, M1.y); label("1マーク", M1.x + 16, M1.y - 16, "left");
    drawBuoy(M2.x, M2.y); label("2マーク", M2.x - 16, M2.y - 16, "right");
  }

  function label(text, x, y, align) {
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = "bold 15px sans-serif";
    ctx.textAlign = align || "left";
    ctx.fillText(text, x, y);
  }

  function drawArrow(x, y, dir) {
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 34 * dir, y);
    ctx.lineTo(x + 22 * dir, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 34 * dir, y);
    ctx.lineTo(x + 16 * dir, y - 7);
    ctx.lineTo(x + 16 * dir, y + 7);
    ctx.closePath();
    ctx.fill();
  }

  function drawBuoy(x, y) {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.ellipse(x, y + 14, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e63946";
    ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(x, y, 11, Math.PI * 0.15, Math.PI * 0.85); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke();
  }

  function drawOkoshiMark(b) {
    const s = sampleAt(b.path, 0);
    ctx.strokeStyle = hexA(b.color, 0.5, b.no === 1);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(s.x, s.y, 10, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawTrail(b) {
    if (b.trail.length < 2) return;
    ctx.lineWidth = 5; ctx.lineCap = "round";
    for (let i = 1; i < b.trail.length; i++) {
      const alpha = (i / b.trail.length) * 0.5;
      ctx.strokeStyle = hexA(b.color, alpha, b.no === 1);
      ctx.beginPath();
      ctx.moveTo(b.trail[i - 1].x, b.trail[i - 1].y);
      ctx.lineTo(b.trail[i].x, b.trail[i].y);
      ctx.stroke();
    }
  }

  function drawBoat(b, s, p, t) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.beginPath();
    ctx.moveTo(14, 0); ctx.lineTo(-9, -7); ctx.lineTo(-6, 0); ctx.lineTo(-9, 7);
    ctx.closePath();
    ctx.fillStyle = b.color;
    ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.lineWidth = 1.5;
    ctx.fill(); ctx.stroke();
    ctx.restore();

    // 艇番ラベル
    ctx.beginPath(); ctx.arc(s.x, s.y - 16, 9, 0, Math.PI * 2);
    ctx.fillStyle = b.color; ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = b.textColor;
    ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(b.no), s.x, s.y - 16);
    ctx.textBaseline = "alphabetic";
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hexA(hex, alpha, isWhite) {
    if (isWhite) return `rgba(210,225,235,${alpha})`;
    const c = hex.replace("#", "");
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  return {
    init, load, play, pause, toggle, seek, isPlaying,
    getPhaseTicks: () => phaseTicks,
    set onProgress(fn) { onProgress = fn; },
    set onStateChange(fn) { onStateChange = fn; },
    _debugBoats: () => boats,
  };
})();

BR.Visualizer = Visualizer;
window.BR = BR;
