/**
 * app.js — UI制御
 * 出走表の生成・入力読み取り、予想実行、結果と可視化の表示を担う。
 */
(function () {
  const BR = window.BR;

  const els = {
    entryBody: document.getElementById("entryBody"),
    sampleBtn: document.getElementById("sampleBtn"),
    randomBtn: document.getElementById("randomBtn"),
    predictBtn: document.getElementById("predictBtn"),
    replayBtn: document.getElementById("replayBtn"),
    canvas: document.getElementById("raceCanvas"),
    vizPlaceholder: document.getElementById("vizPlaceholder"),
    vizComment: document.getElementById("vizComment"),
    kimariteBadge: document.getElementById("kimariteBadge"),
    resultEmpty: document.getElementById("resultEmpty"),
    resultContent: document.getElementById("resultContent"),
    rankingList: document.getElementById("rankingList"),
    betList: document.getElementById("betList"),
  };

  /** 出走表の入力行を生成 */
  function buildTable() {
    els.entryBody.innerHTML = "";
    BR.BOATS.forEach((b) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <span class="boat-badge" style="background:${b.color};color:${b.textColor}">${b.no}</span>
        </td>
        <td><input class="name-input" data-no="${b.no}" data-f="name" type="text" placeholder="選手名"></td>
        <td><input data-no="${b.no}" data-f="winRate" type="number" step="0.01" min="0" max="10" placeholder="0.00"></td>
        <td><input data-no="${b.no}" data-f="motorRate" type="number" step="1" min="0" max="100" placeholder="0"></td>
        <td><input data-no="${b.no}" data-f="avgST" type="number" step="0.01" min="0" max="1" placeholder="0.00"></td>
      `;
      els.entryBody.appendChild(tr);
    });
  }

  /** 出走表に値をセット */
  function fillTable(entries) {
    entries.forEach((e) => {
      setVal(e.no, "name", e.name);
      setVal(e.no, "winRate", e.winRate);
      setVal(e.no, "motorRate", e.motorRate);
      setVal(e.no, "avgST", e.avgST);
    });
  }

  function setVal(no, field, value) {
    const el = els.entryBody.querySelector(`input[data-no="${no}"][data-f="${field}"]`);
    if (el) el.value = value;
  }

  /** 出走表から入力値を読み取り。未入力はコース平均的なデフォルトで補完 */
  function readTable() {
    return BR.BOATS.map((b) => {
      const name = getVal(b.no, "name") || `${b.no}号艇`;
      const winRate = num(getVal(b.no, "winRate"), 5.5);
      const motorRate = num(getVal(b.no, "motorRate"), 45);
      const avgST = num(getVal(b.no, "avgST"), 0.16);
      return { no: b.no, name, winRate, motorRate, avgST };
    });
  }

  function getVal(no, field) {
    const el = els.entryBody.querySelector(`input[data-no="${no}"][data-f="${field}"]`);
    return el ? el.value.trim() : "";
  }
  function num(v, fallback) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }

  /** 予想を実行 */
  function runPrediction() {
    const entries = readTable();
    const result = BR.predict(entries);

    // 可視化
    els.vizPlaceholder.style.display = "none";
    BR.Visualizer.render(result);
    els.replayBtn.disabled = false;

    // 決まり手バッジ
    els.kimariteBadge.textContent = `決まり手: ${result.kimarite}`;
    els.kimariteBadge.classList.remove("badge-hidden");

    // コメント
    els.vizComment.textContent = result.comment;

    // 結果（着順・買い目）
    renderResult(result);
  }

  /** 着順予想と買い目を描画 */
  function renderResult(result) {
    els.resultEmpty.hidden = true;
    els.resultContent.hidden = false;

    // 着順（勝率の降順 = ranking順）
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
        <span class="prob-val">${prob}%</span>
      `;
      els.rankingList.appendChild(li);
    });

    // 買い目
    els.betList.innerHTML = "";
    result.bets.forEach((bet) => {
      const div = document.createElement("div");
      div.className = "bet-item";
      div.innerHTML = `
        <span class="bet-type">${bet.type}</span>
        <span class="bet-combo">${bet.combo}</span>
        <span class="bet-conf">${bet.conf}</span>
      `;
      els.betList.appendChild(div);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  // ---- イベント登録 ----
  els.sampleBtn.addEventListener("click", () => fillTable(BR.SAMPLE_ENTRY));
  els.randomBtn.addEventListener("click", () => fillTable(BR.makeRandomEntry()));
  els.predictBtn.addEventListener("click", runPrediction);
  els.replayBtn.addEventListener("click", () => BR.Visualizer.replay());

  // ---- 初期化 ----
  buildTable();
  BR.Visualizer.init(els.canvas);
  fillTable(BR.SAMPLE_ENTRY); // 初期表示としてサンプルを投入
})();
