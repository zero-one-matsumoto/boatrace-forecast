/**
 * data.js — 静的データと定数の定義
 * ボートレースのドメイン知識（艇番カラー・コース別成績・サンプル出走表）を保持する。
 */
// 複数の<script>で共有するグローバル名前空間。var を使い再宣言エラーを避ける。
var BR = window.BR || {};

/** 艇番ごとの標準カラーと表記 */
BR.BOATS = [
  { no: 1, color: "#ffffff", textColor: "#222", label: "白" },
  { no: 2, color: "#1a1a1a", textColor: "#fff", label: "黒" },
  { no: 3, color: "#e63946", textColor: "#fff", label: "赤" },
  { no: 4, color: "#2a6fdb", textColor: "#fff", label: "青" },
  { no: 5, color: "#f4c20d", textColor: "#222", label: "黄" },
  { no: 6, color: "#2a9d4a", textColor: "#fff", label: "緑" },
];

/**
 * コース（進入コース＝通常は艇番）別の全国平均 1着率。
 * インコースほど有利という競艇の基本特性を反映した近似値（%）。
 */
BR.COURSE_WIN_RATE = {
  1: 55,
  2: 14,
  3: 12,
  4: 11,
  5: 6,
  6: 2,
};

/** 決まり手の説明文 */
BR.KIMARITE_INFO = {
  "逃げ": "1号艇がインから先マイしてそのまま押し切る、最も基本的な展開。",
  "差し": "先行艇がターンで外へ流れた内側を、後続がすくって逆転する展開。",
  "まくり": "外側の艇がスピードに乗り、内の艇を一気に抜き去って先マイする展開。",
  "まくり差し": "まくって来た艇のさらに内を差す、近年増加している複合的な展開。",
  "抜き": "1マークでは決着せず、道中（バックストレッチ等）で抜く展開。",
};

/**
 * BoatraceOpenAPI（公式の番組表データを整形しGitHub Pagesで公開しているJSON）。
 * CORS対応(Access-Control-Allow-Origin: *)のため、静的フロントからも直接取得できる。
 * 本日開催分の全レースの出走表を含む。
 */
BR.OPENAPI_PROGRAMS_URL = "https://boatraceopenapi.github.io/programs/v2/today.json";

/** 競艇場コード(1〜24)と場名 */
BR.STADIUMS = [
  { code: 1, name: "桐生" }, { code: 2, name: "戸田" }, { code: 3, name: "江戸川" },
  { code: 4, name: "平和島" }, { code: 5, name: "多摩川" }, { code: 6, name: "浜名湖" },
  { code: 7, name: "蒲郡" }, { code: 8, name: "常滑" }, { code: 9, name: "津" },
  { code: 10, name: "三国" }, { code: 11, name: "びわこ" }, { code: 12, name: "住之江" },
  { code: 13, name: "尼崎" }, { code: 14, name: "鳴門" }, { code: 15, name: "丸亀" },
  { code: 16, name: "児島" }, { code: 17, name: "宮島" }, { code: 18, name: "徳山" },
  { code: 19, name: "下関" }, { code: 20, name: "若松" }, { code: 21, name: "芦屋" },
  { code: 22, name: "福岡" }, { code: 23, name: "唐津" }, { code: 24, name: "大村" },
];

/** サンプル出走表（イン逃げが軸になりやすい標準的な構成） */
BR.SAMPLE_ENTRY = [
  { no: 1, name: "峰  竜太",   winRate: 7.42, motorRate: 58, avgST: 0.14 },
  { no: 2, name: "毒島 誠",   winRate: 6.85, motorRate: 49, avgST: 0.15 },
  { no: 3, name: "石野 貴之", winRate: 6.61, motorRate: 52, avgST: 0.16 },
  { no: 4, name: "井口 佳典", winRate: 6.20, motorRate: 46, avgST: 0.13 },
  { no: 5, name: "茅原 悠紀", winRate: 5.78, motorRate: 41, avgST: 0.17 },
  { no: 6, name: "西山 貴浩", winRate: 5.40, motorRate: 38, avgST: 0.12 },
];

/** ランダム出走表を生成（テスト・デモ用） */
BR.makeRandomEntry = function () {
  const surnames = ["佐藤","鈴木","高橋","田中","渡辺","伊藤","山本","中村","小林","加藤","吉田","山田","松本","井上","木村"];
  const given = ["太郎","健","誠","翔","大輔","拓也","直樹","和也","隆","勇気","涼","純"];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const rnd = (min, max, dec = 2) => {
    const v = min + Math.random() * (max - min);
    return Number(v.toFixed(dec));
  };
  return BR.BOATS.map((b) => ({
    no: b.no,
    name: `${pick(surnames)} ${pick(given)}`,
    winRate: rnd(4.5, 7.8, 2),
    motorRate: Math.round(rnd(32, 62, 0)),
    avgST: rnd(0.11, 0.22, 2),
  }));
};

window.BR = BR;
