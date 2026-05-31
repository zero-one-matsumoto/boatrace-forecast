/**
 * app.js — UI制御
 * 出走表/レース条件の入力、予想実行、結果表示、ビジュアライザーの再生制御を担う。
 */
(function () {
  const BR = window.BR;

  const els = {
    entryBody: document.getElementById("entryBody"),
    sampleBtn: document.getElementById("sampleBtn"),
    randomBtn: document.getElementById("randomBtn"),
    predictBtn: document.getElementById("predictBtn"),
    canvas: document.getElementById("raceCanvas"),
    vizPlaceholder: document.getElementById("vizPlaceholder"),
    vizComment: document.getElementById("vizComment"),
    kimariteBadge: document.getElementById("kimariteBadge"),
    resultEmpty: document.getElementById("resultEmpty"),
    resultContent: document.getElementById("resultContent"),
    rankingList: document.getElementById("rankingList"),
    betList: document.getElementById("betList"),
    stadiumSel: document.getElementById("stadiumSel"),
    raceSel: document.getElementById("raceSel"),
    fetchBtn: document.getElementById("fetchBtn"),
    beforeBtn: document.getElementById("beforeBtn"),
    fetchStatus: document.getElementById("fetchStatus"),
    windDir: document.getElementById("windDir"),
    windSpeed: document.getElementById("windSpeed"),
    waveHeight: document.getElementById("waveHeight"),
    stadiumTrait: document.getElementById("stadiumTrait"),
    playerBar: document.getElementById("playerBar"),
    playBtn: document.getElementById("playBtn"),
    seekBar: document.getElementById("seekBar"),
  };

  // ---- セレクト生成 ----
  function buildSelectors() {
    if (!els.stadiumSel.options || els.stadiumSel.options.length === 0) {
      els.stadiumSel.innerHTML = BR.STADIUMS.map(
        (s) => `<option value="${s.code}">${s.name}</option>`
      ).join("");
    }
    if (!els.raceSel.options || els.raceSel.options.length === 0) {
      els.raceSel.innerHTML = Array.from({ length: 12 }, (_, i) =>
        `<option value="${i + 1}">${i + 1}R</option>`
      ).join("");
    }
    els.windDir.innerHTML = BR.WIND_DIRS.map(
      (w) => `<option value="${w.value}">${w.label}</option>`
    ).join("");
  }

  /** 場の特徴メモを表示 */
  function updateStadiumTrait() {
    const code = Number(els.stadiumSel.value);
    const t = BR.STADIUM_TRAITS[code];
    els.stadiumTrait.textContent = t ? `場の特徴: ${t.note}` : "";
  }

  // ---- 公式データ取得 ----
  async function fetchOfficial() {
    const stadium = Number(els.stadiumSel.value);
    const race = Number(els.raceSel.value);
    const name = (BR.STADIUMS.find((s) => s.code === stadium) || {}).name || "";
    setFetchStatus(`${name} ${race}R を取得中…`, "");
    els.fetchBtn.disabled = true;
    try {
      const { entries, meta } = await BR.fetchProgram(stadium, race);
      fillTable(entries);
      const title = meta.title ? `「${meta.title}」` : "";
      setFetchStatus(`✓ ${meta.stadiumName} ${race}R ${title} を読み込みました（出典: BoatraceOpenAPI）`, "ok");
    } catch (e) {
      setFetchStatus(`取得できませんでした: ${e.message}`, "error");
    } finally {
      els.fetchBtn.disabled = false;
    }
  }
  function setFetchStatus(msg, kind) {
    els.fetchStatus.textContent = msg;
    els.fetchStatus.classList.remove("is-error", "is-ok");
    if (kind === "error") els.fetchStatus.classList.add("is-error");
    else if (kind === "ok") els.fetchStatus.classList.add("is-ok");
  }

  /** 直前情報（展示・チルト・気象・展示進入・部品交換）をCORSプロキシ経由で取得・反映 */
  async function fetchBefore() {
    const stadium = Number(els.stadiumSel.value);
    const race = Number(els.raceSel.value);
    const name = (BR.STADIUMS.find((s) => s.code === stadium) || {}).name || "";
    setFetchStatus(`${name} ${race}R の直前情報を取得中…（プロキシ経由）`, "");
    els.beforeBtn.disabled = true;
    try {
      const info = await BR.fetchBeforeInfo(stadium, race);
      // 各艇: 展示タイム・チルト
      Object.keys(info.boats).forEach((k) => {
        const b = info.boats[k];
        if (b.exhibitionTime != null) setVal(b.no, "exhibitionTime", b.exhibitionTime);
        if (b.tilt != null) setVal(b.no, "tilt", b.tilt);
      });
      // 展示進入隊形 → 進入コース
      if (info.formation) {
        Object.keys(info.formation).forEach((no) => setVal(Number(no), "course", info.formation[no]));
      }
      // 気象
      if (info.weather.windSpeed != null) els.windSpeed.value = info.weather.windSpeed;
      if (info.weather.waveHeight != null) els.waveHeight.value = info.weather.waveHeight;

      const g = info.got;
      const parts = Object.keys(info.boats)
        .map((k) => info.boats[k])
        .filter((b) => b.parts)
        .map((b) => `${b.no}号:${b.parts}`);
      let msg = `✓ 直前情報を反映（展示${g.exh}/6・チルト${g.tilt}/6`;
      if (g.weather) msg += "・気象";
      if (g.formation) msg += "・展示進入";
      msg += "）";
      if (parts.length) msg += ` 部品交換: ${parts.join(" / ")}`;
      if (!g.formation || !g.weather) msg += "　※風向・展示進入は取得状況により手動調整を。";
      setFetchStatus(msg, "ok");
    } catch (e) {
      setFetchStatus(`直前情報を取得できませんでした: ${e.message}`, "error");
    } finally {
      els.beforeBtn.disabled = false;
    }
  }

  // ---- 出走表テーブル ----
  function buildTable() {
    els.entryBody.innerHTML = "";
    const styleOpts = BR.STYLE_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
    BR.BOATS.forEach((b) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="boat-badge" style="background:${b.color};color:${b.textColor}">${b.no}</span></td>
        <td><input class="name-input" data-no="${b.no}" data-f="name" type="text" placeholder="選手名"></td>
        <td><input class="course-input" data-no="${b.no}" data-f="course" type="number" step="1" min="1" max="6" value="${b.no}"></td>
        <td><input data-no="${b.no}" data-f="winRate" type="number" step="0.01" min="0" max="10" placeholder="0.00"></td>
        <td><input data-no="${b.no}" data-f="motorRate" type="number" step="1" min="0" max="100" placeholder="0"></td>
        <td><input data-no="${b.no}" data-f="avgST" type="number" step="0.01" min="0" max="1" placeholder="0.00"></td>
        <td><input data-no="${b.no}" data-f="exhibitionTime" type="number" step="0.01" min="6" max="8" placeholder="6.70"></td>
        <td><input data-no="${b.no}" data-f="tilt" type="number" step="0.5" min="-0.5" max="3" placeholder="0.0"></td>
        <td><select data-no="${b.no}" data-f="style">${styleOpts}</select></td>
      `;
      els.entryBody.appendChild(tr);
    });
  }

  function fillTable(entries) {
    entries.forEach((e) => {
      setVal(e.no, "name", e.name);
      setVal(e.no, "winRate", e.winRate);
      setVal(e.no, "motorRate", e.motorRate);
      setVal(e.no, "avgST", e.avgST);
      if (e.exhibitionTime !== undefined) setVal(e.no, "exhibitionTime", e.exhibitionTime || "");
      if (e.tilt !== undefined) setVal(e.no, "tilt", e.tilt);
      if (e.style !== undefined) setVal(e.no, "style", e.style);
    });
  }
  function setVal(no, field, value) {
    const el = els.entryBody.querySelector(`[data-no="${no}"][data-f="${field}"]`);
    if (el) el.value = value;
  }
  function getVal(no, field) {
    const el = els.entryBody.querySelector(`[data-no="${no}"][data-f="${field}"]`);
    return el ? String(el.value).trim() : "";
  }
  function num(v, fallback) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function readTable() {
    const rows = BR.BOATS.map((b) => ({
      no: b.no,
      course: num(getVal(b.no, "course"), b.no),
      name: getVal(b.no, "name") || `${b.no}号艇`,
      winRate: num(getVal(b.no, "winRate"), 5.5),
      motorRate: num(getVal(b.no, "motorRate"), 45),
      avgST: num(getVal(b.no, "avgST"), 0.16),
      exhibitionTime: num(getVal(b.no, "exhibitionTime"), 0),
      tilt: num(getVal(b.no, "tilt"), 0.5),
      style: getVal(b.no, "style") || "normal",
    }));
    // 進入コースが1〜6の順列でなければ枠なりに戻す
    const courses = rows.map((r) => r.course).sort((a, b) => a - b).join("");
    if (courses !== "123456") rows.forEach((r) => (r.course = r.no));
    return rows;
  }

  function readConditions() {
    return {
      stadium: Number(els.stadiumSel.value),
      windDir: els.windDir.value,
      windSpeed: num(els.windSpeed.value, 0),
      waveHeight: num(els.waveHeight.value, 0),
    };
  }

  // ---- 予想実行 ----
  function runPrediction() {
    const result = BR.predict(readTable(), readConditions());

    els.vizPlaceholder.style.display = "none";
    els.playerBar.hidden = false;
    BR.Visualizer.load(result);
    BR.Visualizer.play();

    els.kimariteBadge.textContent = `決まり手: ${result.kimarite}`;
    els.kimariteBadge.classList.remove("badge-hidden");
    els.vizComment.textContent = result.comment;
    renderResult(result);
  }

  function renderResult(result) {
    els.resultEmpty.hidden = true;
    els.resultContent.hidden = false;
    els.rankingList.innerHTML = "";
    result.ranking.forEach((no, i) => {
      const entry = result.entries.find((e) => e.no === no);
      const meta = BR.BOATS[no - 1];
      const prob = Math.round(result.winProb[no] * 100);
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="rank-pos">${i + 1}着</span>
        <span class="boat-badge" style="background:${meta.color};color:${meta.textColor}">${no}</span>
        <span class="rank-name">${escapeHtml(entry.name)}</span>
        <span class="prob-bar-wrap"><span class="prob-bar" style="width:${prob}%"></span></span>
        <span class="prob-val">${prob}%</span>`;
      els.rankingList.appendChild(li);
    });
    els.betList.innerHTML = "";
    result.bets.forEach((bet) => {
      const div = document.createElement("div");
      div.className = "bet-item";
      div.innerHTML = `
        <span class="bet-type">${bet.type}</span>
        <span class="bet-combo">${bet.combo}</span>
        <span class="bet-conf">${bet.conf}</span>`;
      els.betList.appendChild(div);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---- 再生制御の配線 ----
  function setupPlayer() {
    BR.Visualizer.onProgress = (t) => { els.seekBar.value = Math.round(t * 1000); };
    BR.Visualizer.onStateChange = (playing) => {
      els.playBtn.textContent = playing ? "❚❚" : "▶";
    };
    els.playBtn.addEventListener("click", () => BR.Visualizer.toggle());
    els.seekBar.addEventListener("input", () => {
      BR.Visualizer.pause();
      BR.Visualizer.seek(Number(els.seekBar.value) / 1000);
    });
  }

  // ---- イベント ----
  els.sampleBtn.addEventListener("click", () => fillTable(BR.SAMPLE_ENTRY));
  els.randomBtn.addEventListener("click", () => fillTable(BR.makeRandomEntry()));
  els.predictBtn.addEventListener("click", runPrediction);
  els.fetchBtn.addEventListener("click", fetchOfficial);
  els.beforeBtn.addEventListener("click", fetchBefore);
  els.stadiumSel.addEventListener("change", updateStadiumTrait);

  // ---- 初期化 ----
  buildSelectors();
  buildTable();
  setupPlayer();
  BR.Visualizer.init(els.canvas);
  fillTable(BR.SAMPLE_ENTRY);
  updateStadiumTrait();
})();
