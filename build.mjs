#!/usr/bin/env node
// posts/*.json から dist/ に静的サイトを作ります。外部パッケージは使いません。
//   node build.mjs                 本番用
//   node build.mjs --local         手元確認用（リンクの先頭に basePath を付けない）
//   node build.mjs --preview-ads   広告の位置を点線の枠で見せる
//   node build.mjs --check         記事の形式だけ確かめて、書き出さない
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicCover } from './cover.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const SITE_URL = process.env.SITE_URL ? new URL(process.env.SITE_URL) : null;
if (SITE_URL && (SITE_URL.protocol !== 'https:' || SITE_URL.username || SITE_URL.password || SITE_URL.search || SITE_URL.hash)) {
  throw new Error('SITE_URL は公開サイトの HTTPS URL を指定してください。');
}
const ORIGIN = (SITE_URL?.href || cfg.baseUrl || '').replace(/\/$/, '');
const BASE = args.has('--local') ? '' : (SITE_URL ? SITE_URL.pathname.replace(/\/$/, '') : cfg.basePath || '');
const PREVIEW_ADS = args.has('--preview-ads');
const DIST = path.join(ROOT, 'dist');
const importedArchive = path.join(ROOT, 'src', 'japan-watch');
const hasImportedArchive = fs.existsSync(path.join(importedArchive, 'archive.html'));

// ---------- 文字の処理 ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isUrl = (u) => typeof u === 'string' && /^https?:\/\/[^\s"<>]+$/.test(u);
// **太字** と [文字](https://...) だけを解釈します
const inline = (s) =>
  esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
const plain = (s) => String(s ?? '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const jpDate = (d) => {
  const [y, m, dd] = d.split('-').map(Number);
  return `${y}年${m}月${dd}日（${WD[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]}）`;
};
const dotDate = (d) => d.replace(/-/g, '.');
const url = (p) => `${BASE}${p}`;
const abs = (p) => `${ORIGIN}${p}`;

// ---------- 記事の形式を確かめる ----------
const TONES = [undefined, '', 'warn', 'good'];
const BLOCKS = ['h2', 'h3', 'meta', 'p', 'note', 'list', 'source', 'tiles', 'features', 'share', 'meter', 'table', 'kv', 'hr'];
function validate(post, file) {
  const errs = [];
  const need = (c, m) => { if (!c) errs.push(m); };
  const str = (v) => typeof v === 'string' && v.trim().length > 0;
  need(/^\d{4}-\d{2}-\d{2}$/.test(post.date || ''), 'date は YYYY-MM-DD');
  need(path.basename(file, '.json') === post.date, 'ファイル名と date が一致していない');
  need(str(post.title), 'title が無い');
  need(str(post.description), 'description が無い');
  need(Array.isArray(post.lead) && post.lead.length > 0 && post.lead.every(str), 'lead は文字の配列');
  need(Array.isArray(post.blocks) && post.blocks.length > 0, 'blocks が無い');
  need(str(post.conclusion), 'conclusion が無い');
  const srcs = (list, where) => {
    if (list === undefined) return;
    need(Array.isArray(list), `${where}: sources は配列`);
    for (const s of list || []) {
      need(str(s?.name), `${where}: sources の name が無い`);
      need(s.url === undefined || isUrl(s.url), `${where}: sources の url が正しくない (${s?.url})`);
    }
  };
  (post.blocks || []).forEach((b, i) => {
    const w = `blocks[${i}] (${b?.type})`;
    if (!BLOCKS.includes(b?.type)) { errs.push(`${w}: 知らない type`); return; }
    srcs(b.sources, w);
    switch (b.type) {
      case 'h2': case 'h3': case 'meta': case 'p': case 'note':
        need(str(b.text), `${w}: text が無い`); break;
      case 'list':
        need(Array.isArray(b.items) && b.items.length > 0 && b.items.every(str), `${w}: items は文字の配列`); break;
      case 'source':
        need(str(b.text), `${w}: text が無い`); need(b.url === undefined || isUrl(b.url), `${w}: url が正しくない`); break;
      case 'tiles':
        need(Array.isArray(b.items) && b.items.length >= 2 && b.items.length % 2 === 0, `${w}: items は偶数個（2個以上）`);
        for (const t of b.items || []) { need(str(t.label) && str(t.value), `${w}: label と value が必要`); need(TONES.includes(t.tone), `${w}: tone は warn / good のみ`); }
        break;
      case 'features':
        need(Array.isArray(b.items) && b.items.length > 0, `${w}: items が無い`);
        for (const t of b.items || []) need(str(t.title), `${w}: title が必要`);
        break;
      case 'share': {
        need(str(b.label) && str(b.value), `${w}: label と value が必要`);
        need(Array.isArray(b.parts) && b.parts.length >= 2, `${w}: parts は2つ以上`);
        const sum = (b.parts || []).reduce((a, p) => a + Number(p.pct || 0), 0);
        need(Math.abs(sum - 100) < 0.6, `${w}: parts の pct の合計が100にならない (${sum})`);
        need(str(b.note), `${w}: note（母集団・出典・基準日）が必要`);
        break;
      }
      case 'meter':
        need(str(b.label) && str(b.value), `${w}: label と value が必要`);
        need(typeof b.pct === 'number' && b.pct >= 0 && b.pct <= 100, `${w}: pct は 0〜100 の数字`);
        need(str(b.note), `${w}: note（何の割合か・出典）が必要`);
        break;
      case 'table':
        need(Array.isArray(b.head) && b.head.length >= 2, `${w}: head は2列以上`);
        need(Array.isArray(b.rows) && b.rows.length > 0 && b.rows.every((r) => Array.isArray(r) && r.length === b.head.length), `${w}: rows の列数が head と合わない`);
        break;
      case 'kv':
        need(str(b.title), `${w}: title が無い`);
        need(Array.isArray(b.rows) && b.rows.length > 0, `${w}: rows が無い`);
        for (const r of b.rows || []) { need(str(r.k) && str(r.v), `${w}: k と v が必要`); need(TONES.includes(r.tone), `${w}: tone は warn / good のみ`); }
        break;
    }
  });
  const hasLinkedSource = JSON.stringify(post.blocks || []).includes('"url":"http') || /\]\(https?:/.test(JSON.stringify(post));
  need(hasLinkedSource, '出典のリンクが1つも無い');
  return errs;
}

// ---------- 部品 ----------
const ICONS = {
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3.5 3.5 0 000-7H9a3.5 3.5 0 010-7h6.5"/>',
  alert: '<path d="M12 4l9 16H3l9-16z"/><path d="M12 10v4"/><path d="M12 17.5v.01"/>',
  bike: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-8h5l3 8"/><path d="M10 8l3 8"/>',
  car: '<path d="M4 16v-3l2-5h12l2 5v3"/><path d="M3 16h18v2H3z"/><circle cx="7.5" cy="18" r="1.5"/><circle cx="16.5" cy="18" r="1.5"/>',
  chip: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 3.5 3 14.5 0 18-3-3.5-3-14.5 0-18z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>',
  yen: '<path d="M7 4l5 8 5-8"/><path d="M12 12v8"/><path d="M8 13h8M8 16.5h8"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ICONS.dot}</svg>`;

// 写真は Wikimedia Commons の、再利用が認められているものだけを使います（出典・作者・ライセンス・加工を表示）
const PHOTOS = {
  model3: { file: 'model3.jpg', caption: 'Model 3（2018年撮影・海外参考写真。日本仕様やHWを示すものではありません）', author: 'Darin Caggiano', source: 'https://commons.wikimedia.org/wiki/File:Tesla_Model_3.jpg', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0' },
  modely: { file: 'modely.jpg', caption: 'Model Y（2022年・英国撮影。日本仕様やHWを示すものではありません）', author: 'Vauxford', source: 'https://commons.wikimedia.org/wiki/File:2022_Tesla_Model_Y_Long_Range_AWD_Front.jpg', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0' },
};
const photoOf = (post) => {
  if (typeof post.photo === 'object') return publicCover(post.photo);
  return PHOTOS[post.photo] || (Number(post.date.slice(8)) % 2 === 0 ? PHOTOS.model3 : PHOTOS.modely);
};
const photoSrc = (photo) => photo.image || url(`/photos/${photo.file}`);
const absolutePhoto = (photo) => photo?.image || (photo ? abs(`/photos/${photo.file}`) : null);
const photoAttribution = (photo) => `<a href="${esc(photo.source)}" target="_blank" rel="noopener">${esc(photo.author)} / ${esc(photo.publisher || 'Wikimedia Commons')}</a> · <a href="${esc(photo.licenseUrl)}" target="_blank" rel="noopener">${esc(photo.license)}</a>${photo.permission && photo.permission !== photo.licenseUrl ? ` · <a href="${esc(photo.permission)}" target="_blank" rel="noopener">利用条件の出典</a>` : ''}`;
const photoCaption = (photo) => `${esc(photo.caption)}<br>${photoAttribution(photo)} · 表示枠に合わせたトリミングあり。`;
const photoCredit = (photo) => `<p class="card-credit">写真：${photoAttribution(photo)}（表示枠でトリミング）</p>`;
const photoFigure = (photo, type) => photo ? `<figure class="${type}-photo"><img src="${esc(photoSrc(photo))}" alt="${esc(photo.caption)}" ${type === 'hero' ? 'fetchpriority="high"' : ''} referrerpolicy="no-referrer" width="1600" height="900"><figcaption>${photoCaption(photo)}</figcaption></figure>` : '';

const chips = (list, inlineMode) =>
  !list?.length ? '' :
  `<${inlineMode ? 'span' : 'div'} class="tags${inlineMode ? ' inline' : ''}">${list.map((s) => (s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)} ↗</a>` : `<span>${esc(s.name)}</span>`)).join('')}</${inlineMode ? 'span' : 'div'}>`;
const tone = (t) => (t ? ` tone-${t}` : '');

function adUnit(pos) {
  const a = cfg.adsense || {};
  const slot = a.slots?.[pos];
  if (a.client && slot) {
    return `<aside class="ad" aria-label="広告"><p class="adlabel">広告</p><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(a.client)}" data-ad-slot="${esc(slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script></aside>`;
  }
  if (PREVIEW_ADS) return `<aside class="ad" aria-label="広告"><p class="adlabel">広告</p><div class="adpreview">広告がここに表示されます（${esc(pos)}）</div></aside>`;
  return '';
}
function affiliateBox() {
  const items = (cfg.affiliate?.items || []).filter((x) => isUrl(x.url) && x.title);
  if (!items.length) return '';
  return `<aside class="pr"><p class="prhead"><span class="prtag">PR</span>おすすめ</p>${items.map((x) => `<a class="pritem" href="${esc(x.url)}" target="_blank" rel="sponsored noopener"><b>${esc(x.title)} ↗</b><span>${esc(x.note || '')}</span></a>`).join('')}</aside>`;
}

function block(b) {
  switch (b.type) {
    case 'h2': return `<h2>${inline(b.text)}</h2>`;
    case 'h3': return `<h3>${inline(b.text)}</h3>`;
    case 'meta': return `<p class="kicker">${inline(b.text)}</p>`;
    case 'p': return `<p>${inline(b.text)}${chips(b.sources, true)}</p>`;
    case 'note': return `<p class="note" style="margin-bottom:20px">${inline(b.text)}${chips(b.sources, true)}</p>`;
    case 'list': return `<ul class="list">${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`;
    case 'source': return `<p class="src">出典：${b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.text)} ↗</a>` : esc(b.text)}</p>`;
    case 'hr': return '<hr>';
    case 'tiles':
      return `${b.title ? `<h2>${inline(b.title)}</h2>` : ''}<div class="tiles">${b.items.map((t) => `<div class="tile"><div class="label">${inline(t.label)}</div><div class="value${tone(t.tone)}">${inline(t.value)}</div>${t.note ? `<div class="sub">${inline(t.note)}</div>` : ''}</div>`).join('')}</div>${chips(b.sources)}`;
    case 'features':
      return `<section class="panel">${b.title ? `<p class="ptitle">${inline(b.title)}</p>` : ''}${b.items.map((f, i) => `<div class="feat${i === 0 && f.value ? ' accent' : ''}">${icon(f.icon)}<div><div class="ft">${inline(f.title)}</div>${f.value ? `<div class="fv">${inline(f.value)}</div>` : ''}${f.note ? `<div class="fn">${inline(f.note)}</div>` : ''}</div></div>`).join('')}</section>${b.sources ? `<p class="src">出典：${b.sources.map((s) => (s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)} ↗</a>` : esc(s.name))).join('、')}</p>` : ''}`;
    case 'share':
      return `<section class="panel"><p class="plabel">${inline(b.label)}</p><p class="big">${inline(b.value)}</p><div class="bar" role="img" aria-label="${esc(b.parts.map((p) => `${p.label} ${p.pct}%`).join('、'))}">${b.parts.map((p) => `<span class="c-${esc(p.tone || 'other')}" style="width:${Number(p.pct)}%"></span>`).join('')}</div><div class="legend">${b.parts.map((p) => `<span><i class="c-${esc(p.tone || 'other')}"></i>${inline(p.label)}${p.value ? `：${inline(p.value)}` : ''}</span>`).join('')}</div><p class="note">${inline(b.note)}</p></section>`;
    case 'meter':
      return `<section class="panel"><p class="plabel">${inline(b.label)}</p><p class="big">${inline(b.value)}</p><div class="meter" role="img" aria-label="${esc(b.value)}"><span style="width:${b.pct}%"></span></div><p class="note">${inline(b.note)}</p></section>`;
    case 'table':
      return `${b.title ? `<h3>${inline(b.title)}</h3>` : ''}<div class="table-wrap"><table class="cols-${b.head.length}"><thead><tr>${b.head.map((h) => `<th scope="col">${inline(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${b.note ? `<p class="note table-note">${inline(b.note)}${chips(b.sources, true)}</p>` : ''}`;
    case 'kv':
      return `<section class="panel"><span class="kicker">STATUS</span><p class="kv-head">${inline(b.title)}</p><p class="kv-sub">${b.sub ? inline(b.sub) : ''}</p><div class="kv">${b.rows.map((r) => `<div class="row"><span>${inline(r.k)}</span><span class="v${tone(r.tone)}">${inline(r.v)}</span></div>`).join('')}</div></section>`;
  }
  return '';
}

// ---------- ページの外枠 ----------
let LATEST = null;
function layout({ title, description, pathName, body, type = 'website', jsonld, image }) {
  const a = cfg.adsense || {};
  const full = title === cfg.title ? `${cfg.title}｜${cfg.tagline}` : `${title}｜${cfg.title}`;
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(abs(pathName))}">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="${esc(cfg.title)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(abs(pathName))}">
${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="theme-color" content="#f7f6f2">
<link rel="alternate" type="application/rss+xml" title="${esc(cfg.title)}" href="${url('/feed.xml')}">
<link rel="icon" href="${url('/favicon.svg')}" type="image/svg+xml">
<link rel="stylesheet" href="${url('/style.css')}">
${a.client ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(a.client)}" crossorigin="anonymous"></script>` : ''}
${cfg.analytics?.ga4 ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(cfg.analytics.ga4)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${esc(cfg.analytics.ga4)}');</script>` : ''}
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<div class="topline"><span>TESLA FSD · WORLD NEWS</span><span>HW3 / HW4 · JAPAN</span></div>
<header class="site"><a class="brand" href="${url('/')}">TESLA<span>FSD WORLD NEWS<span class="brand-dot">●</span></span></a><nav class="main" aria-label="メイン">${LATEST ? `<a href="${url(`/posts/${LATEST.date}/`)}">最新号</a>` : ''}<a href="${url('/archive/')}">記事一覧</a><a href="${url('/about/')}">運営方針</a><a class="rss" href="${url('/feed.xml')}">RSS ↗</a></nav></header>
<main id="main">
${body}
</main>
<footer class="site"><strong>${esc(cfg.title)}</strong><p>日本のオーナーへ、事実と、その先を。Tesla, Inc. とは関係のない独立サイトです。</p><p><a href="${url('/about/')}">運営方針</a><a href="${url('/privacy/')}">プライバシーポリシー・免責事項</a>${isUrl(cfg.contactUrl) ? `<a href="${esc(cfg.contactUrl)}" target="_blank" rel="noopener">お問い合わせ</a>` : ''}<a href="${url('/feed.xml')}">RSS</a></p><small>事実・報道・独自分析を区別して掲載します。情報は各確認日時点のものです。FSD（Supervised）は運転支援機能で、運転者による常時の監視が必要です。Tesla、FSD、Model 3 などの名称は各社の商標です。© ${new Date().getFullYear()} ${esc(cfg.title)}</small></footer>
</body>
</html>
`;
}

function linkedSources(post) {
  const seen = new Map();
  const add = (name, u) => { if (isUrl(u) && !seen.has(u)) seen.set(u, name); };
  for (const b of post.blocks) {
    (b.sources || []).forEach((s) => add(s.name, s.url));
    if (b.type === 'source') add(b.text, b.url);
  }
  return [...seen].map(([u, name]) => ({ url: u, name }));
}

function postPage(post, prev, next) {
  const p = `/posts/${post.date}/`;
  const ph = photoOf(post);
  // 広告の位置：最初の数字カードの後・本文の中ほどの見出しの前・記事の最後
  const out = [];
  const h2s = post.blocks.map((b, i) => (b.type === 'h2' ? i : -1)).filter((i) => i >= 0);
  const midAt = h2s.length >= 4 ? h2s[Math.floor(h2s.length / 2)] : -1;
  const firstTiles = post.blocks.findIndex((b) => b.type === 'tiles');
  post.blocks.forEach((b, i) => {
    if (i === midAt) out.push(adUnit('middle'));
    out.push(block(b));
    if (i === firstTiles) out.push(adUnit('top'));
  });
  const srcs = linkedSources(post);
  const body = `<div class="article-top"><a href="${url('/archive/')}">← 記事一覧</a><span>${esc(post.edition || '朝刊')} / ${post.date}</span></div>
<article class="reading">
<div class="eyebrow">TESLA FSD · WORLD NEWS · ${dotDate(post.date)}</div>
<h1>${inline(post.title)}</h1>
<p class="standfirst">${esc(post.description)}</p>
<p class="article-meta">${jpDate(post.date)}${post.edition ? esc(post.edition) : ''}${post.updated ? `｜日本時間${esc(post.updated)}更新` : ''}｜AIを活用して作成。出典は記事の末尾に掲載しています。</p>
${photoFigure(ph, 'article')}
${post.lead.map((t) => `<p>${inline(t)}</p>`).join('\n')}
${firstTiles < 0 ? adUnit('top') : ''}
${out.join('\n')}
<div class="notice"><span class="kicker">今日の結論</span>${inline(post.conclusion)}</div>
${srcs.length ? `<div class="sources"><h2>出典</h2><ul>${srcs.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)} ↗</a></li>`).join('')}</ul><p>リンクのない出典は、本文中に媒体名を記載しています。事実・報道・独自分析は見出しの下の表示で区別しています。</p></div>` : ''}
${affiliateBox()}
${adUnit('bottom')}
<nav class="pager${prev ? '' : ' single'}" aria-label="前後の記事">
${prev ? `<a href="${url(`/posts/${prev.date}/`)}"><small>← 前の記事 / ${prev.date}</small><b>${esc(plain(prev.title))}</b></a>` : ''}
${next ? `<a class="next" href="${url(`/posts/${next.date}/`)}"><small>次の記事 / ${next.date} →</small><b>${esc(plain(next.title))}</b></a>` : `<a class="next" href="${url('/archive/')}"><small>ALL ARTICLES</small><b>記事一覧を見る ↗</b></a>`}
</nav>
</article>`;
  return layout({
    title: plain(post.title), description: post.description, pathName: p, body, type: 'article', image: absolutePhoto(ph),
    jsonld: {
      '@context': 'https://schema.org', '@type': 'NewsArticle', headline: plain(post.title).slice(0, 110),
      description: post.description, datePublished: `${post.date}T${(post.updated || '09:00').padStart(5, '0')}:00+09:00`,
      dateModified: `${post.date}T${(post.updated || '09:00').padStart(5, '0')}:00+09:00`,
      author: { '@type': 'Organization', name: cfg.author }, publisher: { '@type': 'Organization', name: cfg.title },
      ...(ph ? { image: absolutePhoto(ph) } : {}), mainEntityOfPage: abs(p), inLanguage: 'ja',
    },
  });
}

const card = (post, wide) => {
  const photo = photoOf(post);
  const href = url(`/posts/${post.date}/`);
  const tags = Array.isArray(post.tags) && post.tags.length ? post.tags : ['FSD', 'HW3', 'HW4'];
  const thumbnail = photo ? `<a href="${href}" tabindex="-1" aria-hidden="true"><img src="${esc(photoSrc(photo))}" alt="" loading="lazy" referrerpolicy="no-referrer" width="640" height="400"></a>` : '';
  const credit = photo ? photoCredit(photo) : '';
  return `<article class="card${wide && photo ? ' wide' : ''}">${thumbnail}${wide ? '' : credit}<div class="card-body"><div class="eyebrow">${esc(post.edition || '朝刊')}<span>${post.date}</span></div><h3><a href="${href}">${esc(plain(post.title))}</a></h3><p>${esc(post.description)}</p><div class="tags">${tags.slice(0, 4).map((tag) => `<span>${esc(tag)}</span>`).join('')}</div>${wide ? credit : ''}</div></article>`;
};

function indexPage(posts) {
  if (!posts.length) {
    return layout({ title: cfg.title, description: cfg.description, pathName: '/',
      body: `<section class="reading page-plain"><h1>Tesla FSD・世界ニュース</h1><p>日本と世界のFSD、運転支援の認証、HW3・HW4の動向を出典付きでお届けします。初回の記事は検証が済み次第掲載します。</p>${hasImportedArchive ? `<p><a class="button" href="${url('/archive/')}">過去の記事を読む</a></p>` : ''}</section>` });
  }
  const latest = posts[0];
  const ph = photoOf(latest);
  const tiles = latest.blocks.find((b) => b.type === 'tiles');
  const world = latest.blocks.find((b) => b.type === 'table' && b.head[0] === '地域' && b.head.length === 3);
  const deltaClass = (d) => (/進展|前進|解禁|開始|承認/.test(d) ? 'up' : /悪化|後退|遅延|停止|却下/.test(d) ? 'down' : '');
  const body = `<section class="hero${ph ? '' : ' hero-text'}"><div class="hero-copy"><div class="eyebrow">FOR JAPAN'S TESLA OWNERS</div><h1>Tesla FSD・<br>世界の<br><em>最新ニュース</em></h1><p>各国の認証、HW3・HW4、日本での提供見通し。<br>出典と確認日を添えて、毎朝まとめます。</p><a class="button" href="${url(`/posts/${latest.date}/`)}">今日の記事を読む <span>↗</span></a><div class="hero-meta">独立系ニュース / 出典付き / 毎朝更新</div></div>${photoFigure(ph, 'hero')}</section>
<div class="status-strip"><span class="pulse"></span><strong>LATEST</strong><span>最終更新 ${jpDate(latest.date)}${latest.updated ? ` ${esc(latest.updated)}` : ''}</span><span class="status-count">${posts.length} 本の記事</span><a href="${url('/archive/')}">記事一覧を見る ↗</a></div>
${tiles ? `<section style="margin-bottom:0"><div class="brief">${tiles.items.slice(0, 4).map((t, i) => `<div><span class="kicker">${String(i + 1).padStart(2, '0')} / ${inline(t.label)}</span><h2${t.tone ? ` class="tone-${t.tone}"` : ''}>${inline(t.value)}</h2><p>${inline(t.note || '')}</p></div>`).join('')}</div><p class="brief-more"><a href="${url(`/posts/${latest.date}/`)}">${esc(plain(latest.title))} ↗</a></p></section>` : ''}
${adUnit('list')}
<section id="latest"><div class="section-head"><div><span class="kicker">THE JOURNAL</span><h2>最新の記事</h2></div><span>${posts.length} ARTICLES</span></div><div class="cards${posts.length < 3 ? ' few' : ''}">${posts.slice(0, 9).map((p) => card(p, posts.length < 3)).join('')}</div>${posts.length > 9 ? `<p class="archive-link"><a href="${url('/archive/')}">過去の記事をすべて読む ↗</a></p>` : ''}</section>
${world ? `<section class="guide-band"><div><span class="kicker">WORLD STATUS</span><h2>世界のFSDは、<br>いま、どこまで。</h2><p>${jpDate(latest.date)}時点の各国の状況です。<br>契約できることと、実際に使えることは区別しています。</p><a class="more" href="${url(`/posts/${latest.date}/`)}">根拠と出典を記事で読む ↗</a></div><div class="guide-links">${world.rows.map((r) => `<div><span>${inline(r[0])}</span><span class="st">${inline(r[1])}<b class="${deltaClass(r[2])}">${inline(r[2])}</b></span></div>`).join('')}</div></section>` : ''}`;
  return layout({ title: cfg.title, description: cfg.description, pathName: '/', body, jsonld: { '@context': 'https://schema.org', '@type': 'WebSite', name: cfg.title, url: abs('/'), inLanguage: 'ja' } });
}
function archivePage(posts) {
  const byMonth = new Map();
  for (const p of posts) { const k = p.date.slice(0, 7); byMonth.set(k, [...(byMonth.get(k) || []), p]); }
  const body = `<div class="article-top"><a href="${url('/')}">← トップ</a><span>${posts.length} ARTICLES</span></div><section><div class="section-head"><div><span class="kicker">ARCHIVE</span><h2>記事一覧</h2></div></div>${[...byMonth].map(([k, list]) => `<h3 class="month">${Number(k.slice(0, 4))}年${Number(k.slice(5))}月</h3><div class="cards${posts.length < 3 ? ' few' : ''}">${list.map((p) => card(p, posts.length < 3)).join('')}</div>`).join('')}</section>`;
  const imported = hasImportedArchive ? `<section class="reading page-plain"><h2>Tesla Japan Watchの過去記事</h2><p>日次の定点観測レポートと編集記事を、掲載時点の出典・確認状況とともに読めます。</p><p><a class="button" href="${url('/japan-watch/archive')}">過去記事をすべて見る</a></p></section>` : '';
  return layout({ title: '記事一覧', description: `${cfg.title} の記事一覧です。`, pathName: '/archive/', body: body + imported });
}
function staticPage(file, title, pathName) {
  const html = fs.readFileSync(path.join(ROOT, 'src', file), 'utf8').replaceAll('{{title}}', esc(cfg.title));
  return layout({ title, description: `${cfg.title} の「${title}」のページです。`, pathName, body: `<div class="article-top"><a href="${url('/')}">← トップ</a><span>${esc(title)}</span></div><article class="reading page-plain"><div class="eyebrow">ABOUT THIS SITE</div>${html}</article>` });
}

// ---------- 実行 ----------
const postDir = path.resolve(ROOT, process.env.POSTS_DIR || 'posts');
const files = fs.readdirSync(postDir).filter((f) => f.endsWith('.json')).sort().reverse();
const posts = [];
let bad = 0;
for (const f of files) {
  let post;
  try { post = JSON.parse(fs.readFileSync(path.join(postDir, f), 'utf8')); }
  catch (e) { console.error(`✗ ${f}: JSON として読めません (${e.message})`); bad++; continue; }
  const errs = validate(post, f);
  if (errs.length) { console.error(`✗ ${f}\n  - ${errs.join('\n  - ')}`); bad++; continue; }
  posts.push(post);
}
if (bad) { console.error(`\n${bad} 件の記事に問題があります。公開を中止しました。`); process.exit(1); }
if (!posts.length && !args.has('--allow-empty')) { console.error('記事が1件もありません。'); process.exit(1); }
LATEST = posts[0];
if (args.has('--check')) { console.log(`✓ ${posts.length} 件の記事の形式は正しいです。`); process.exit(0); }

fs.rmSync(DIST, { recursive: true, force: true });
if (hasImportedArchive) fs.cpSync(importedArchive, path.join(DIST, 'japan-watch'), { recursive: true });
const write = (rel, content) => { const f = path.join(DIST, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
write('style.css', fs.readFileSync(path.join(ROOT, 'src', 'style.css'), 'utf8'));
write('favicon.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#202523"/><text x="30" y="41" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-weight="800" font-size="21" fill="#f7f6f2">FSD</text><circle cx="54" cy="38" r="3.5" fill="#c63b32"/></svg>');
for (const f of fs.readdirSync(path.join(ROOT, 'src', 'photos'))) { fs.mkdirSync(path.join(DIST, 'photos'), { recursive: true }); fs.copyFileSync(path.join(ROOT, 'src', 'photos', f), path.join(DIST, 'photos', f)); }
write('.nojekyll', '');
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${abs('/sitemap.xml')}\n${hasImportedArchive ? `Sitemap: ${abs('/japan-watch/sitemap.xml')}\n` : ''}`);
if (cfg.adsense?.client) write('ads.txt', `google.com, ${cfg.adsense.client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`);
write('index.html', indexPage(posts));
write('archive/index.html', archivePage(posts));
write('about/index.html', staticPage('about.html', 'このサイトについて', '/about/'));
write('privacy/index.html', staticPage('privacy.html', 'プライバシーポリシー・免責事項', '/privacy/'));
write('404.html', layout({ title: 'ページが見つかりません', description: cfg.description, pathName: '/404.html', body: `<article class="reading page-plain"><div class="eyebrow">404</div><h1>ページが見つかりません</h1><p><a href="${url('/')}">最新の記事へ戻る ↗</a></p></article>` }));
posts.forEach((p, i) => write(`posts/${p.date}/index.html`, postPage(p, posts[i + 1], posts[i - 1])));
const pages = ['/', '/archive/', '/about/', '/privacy/', ...posts.map((p) => `/posts/${p.date}/`)];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `<url><loc>${esc(abs(p))}</loc></url>`).join('\n')}\n</urlset>\n`);
write('feed.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${esc(cfg.title)}</title><link>${esc(abs('/'))}</link><description>${esc(cfg.description)}</description><language>ja</language>\n${posts.slice(0, 20).map((p) => `<item><title>${esc(plain(p.title))}</title><link>${esc(abs(`/posts/${p.date}/`))}</link><guid>${esc(abs(`/posts/${p.date}/`))}</guid><pubDate>${new Date(`${p.date}T${(p.updated || '09:00').padStart(5, '0')}:00+09:00`).toUTCString()}</pubDate><description>${esc(p.description)}</description></item>`).join('\n')}\n</channel></rss>\n`);
console.log(`✓ ${posts.length} 件の記事を dist/ に書き出しました${LATEST ? `（最新: ${LATEST.date}）` : ''}`);
