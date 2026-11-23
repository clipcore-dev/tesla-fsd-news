#!/usr/bin/env node
// posts/*.json から dist/ に静的サイトを作ります。外部パッケージは使いません。
//   node build.mjs                 本番用
//   node build.mjs --local         手元確認用（リンクの先頭に basePath を付けない）
//   node build.mjs --preview-ads   広告の位置を点線の枠で見せる
//   node build.mjs --check         記事の形式だけ確かめて、書き出さない
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const BASE = args.has('--local') ? '' : (cfg.basePath || '');
const ORIGIN = (cfg.baseUrl || '').replace(/\/$/, '');
const PREVIEW_ADS = args.has('--preview-ads');
const DIST = path.join(ROOT, 'dist');

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

const chips = (list, block) =>
  !list?.length ? '' :
  `<span class="chips${block ? ' block' : ''}">${list.map((s) => (s.url ? `<a class="chip" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : `<span class="chip">${esc(s.name)}</span>`)).join('')}</span>`;
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
  return `<aside class="pr"><p class="prhead"><span class="prtag">PR</span>おすすめ</p>${items.map((x) => `<a class="pritem" href="${esc(x.url)}" target="_blank" rel="sponsored noopener"><b>${esc(x.title)}</b><span>${esc(x.note || '')}</span></a>`).join('')}</aside>`;
}

function block(b) {
  switch (b.type) {
    case 'h2': return `<h2>${inline(b.text)}</h2>`;
    case 'h3': return `<h3>${inline(b.text)}</h3>`;
    case 'meta': return `<p class="meta">${inline(b.text)}</p>`;
    case 'p': return `<p>${inline(b.text)}${chips(b.sources)}</p>`;
    case 'note': return `<p class="note" style="margin-bottom:16px">${inline(b.text)}${chips(b.sources)}</p>`;
    case 'list': return `<ul class="list">${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`;
    case 'source': return `<p class="src">出典：${b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.text)}</a>` : esc(b.text)}</p>`;
    case 'hr': return '<hr>';
    case 'tiles':
      return `${b.title ? `<h2>${inline(b.title)}</h2>` : ''}<div class="tiles">${b.items.map((t) => `<div class="tile"><div class="label">${inline(t.label)}</div><div class="value${tone(t.tone)}">${inline(t.value)}</div>${t.note ? `<div class="sub">${inline(t.note)}</div>` : ''}</div>`).join('')}</div>${chips(b.sources, true)}`;
    case 'features':
      return `<section class="panel">${b.title ? `<p class="ptitle">${inline(b.title)}</p>` : ''}${b.items.map((f, i) => `<div class="feat${i === 0 && f.value ? ' accent' : ''}">${icon(f.icon)}<div><div class="ft">${inline(f.title)}</div>${f.value ? `<div class="fv">${inline(f.value)}</div>` : ''}${f.note ? `<div class="fn">${inline(f.note)}</div>` : ''}</div></div>`).join('')}</section>${b.sources ? `<p class="src">出典：${b.sources.map((s) => (s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : esc(s.name))).join('、')}</p>` : ''}`;
    case 'share':
      return `<section class="panel"><p class="plabel">${inline(b.label)}</p><p class="big">${inline(b.value)}</p><div class="bar" role="img" aria-label="${esc(b.parts.map((p) => `${p.label} ${p.pct}%`).join('、'))}">${b.parts.map((p) => `<span class="c-${esc(p.tone || 'other')}" style="width:${Number(p.pct)}%"></span>`).join('')}</div><div class="legend">${b.parts.map((p) => `<span><i class="c-${esc(p.tone || 'other')}"></i>${inline(p.label)}${p.value ? `：${inline(p.value)}` : ''}</span>`).join('')}</div><p class="note">${inline(b.note)}</p></section>`;
    case 'meter':
      return `<section class="plain-stat"><p class="plabel" style="font-size:14px;color:var(--sub);margin:0">${inline(b.label)}</p><p class="big">${inline(b.value)}</p><div class="meter" role="img" aria-label="${esc(b.value)}"><span style="width:${b.pct}%"></span></div><p class="note">${inline(b.note)}</p></section>`;
    case 'table':
      return `${b.title ? `<h3>${inline(b.title)}</h3>` : ''}<div class="tablewrap"><table><thead><tr>${b.head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>${b.note ? `<p class="note">${inline(b.note)}${chips(b.sources)}</p>` : ''}</div>`;
    case 'kv':
      return `<section class="panel"><p class="kv-head">${inline(b.title)}</p>${b.sub ? `<p class="kv-sub">${inline(b.sub)}</p>` : '<p class="kv-sub"></p>'}<div class="kv">${b.rows.map((r) => `<div class="row"><span>${inline(r.k)}</span><span class="v${tone(r.tone)}">${inline(r.v)}</span></div>`).join('')}</div></section>`;
  }
  return '';
}

// ---------- ページの外枠 ----------
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
<meta property="og:image" content="${esc(abs(image || '/og.svg'))}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#000000">
<link rel="alternate" type="application/rss+xml" title="${esc(cfg.title)}" href="${url('/feed.xml')}">
<link rel="icon" href="${url('/favicon.svg')}" type="image/svg+xml">
<link rel="stylesheet" href="${url('/style.css')}">
${a.client ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(a.client)}" crossorigin="anonymous"></script>` : ''}
${cfg.analytics?.ga4 ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(cfg.analytics.ga4)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${esc(cfg.analytics.ga4)}');</script>` : ''}
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<header class="site-head"><div class="wrap"><a class="brand" href="${url('/')}">${esc(cfg.title)}</a><nav class="nav"><a href="${url('/archive/')}">記事一覧</a><a href="${url('/about/')}">サイト情報</a></nav></div></header>
<main><div class="wrap">
${body}
</div></main>
<footer class="site-foot"><div class="wrap">
<nav><a href="${url('/about/')}">このサイトについて</a><a href="${url('/privacy/')}">プライバシーポリシー・免責事項</a>${isUrl(cfg.contactUrl) ? `<a href="${esc(cfg.contactUrl)}" target="_blank" rel="noopener">お問い合わせ</a>` : ''}<a href="${url('/feed.xml')}">RSS</a></nav>
<p>当サイトは Tesla, Inc. とは関係のない非公式の情報サイトです。Tesla、FSD、Model 3 などの名称は各社の商標です。</p>
<p>FSD（Supervised）は運転支援機能です。運転者は常に前方と周囲を監視し、すぐに操作できる状態を保つ必要があります。</p>
<p>© ${new Date().getFullYear()} ${esc(cfg.title)}</p>
</div></footer>
</body>
</html>
`;
}

function postPage(post, prev, next) {
  const p = `/posts/${post.date}/`;
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
  const body = `<article>
<p class="eyebrow">${esc(cfg.title.replace('TESLA FSD WORLD NEWS', 'TESLA FSD・WORLD NEWS'))}｜${dotDate(post.date)}</p>
<h1 class="title">${inline(post.title)}</h1>
<p class="dateline">${jpDate(post.date)}${post.edition ? esc(post.edition) : ''}${post.updated ? `｜日本時間${esc(post.updated)}更新` : ''}</p>
${post.lead.map((t) => `<p>${inline(t)}</p>`).join('\n')}
${firstTiles < 0 ? adUnit('top') : ''}
${out.join('\n')}
<p class="conclusion">今日の結論：${inline(post.conclusion)}</p>
</article>
${affiliateBox()}
${adUnit('bottom')}
<nav class="pager${prev ? '' : ' single'}" aria-label="前後の記事">
${prev ? `<a href="${url(`/posts/${prev.date}/`)}"><small>前の記事｜${dotDate(prev.date)}</small><b>${esc(plain(prev.title))}</b></a>` : ''}
${next ? `<a class="next" href="${url(`/posts/${next.date}/`)}"><small>次の記事｜${dotDate(next.date)}</small><b>${esc(plain(next.title))}</b></a>` : `<a class="next" href="${url('/archive/')}"><small>すべての記事</small><b>記事一覧を見る</b></a>`}
</nav>`;
  return layout({
    title: plain(post.title), description: post.description, pathName: p, body, type: 'article',
    jsonld: {
      '@context': 'https://schema.org', '@type': 'NewsArticle', headline: plain(post.title).slice(0, 110),
      description: post.description, datePublished: `${post.date}T${(post.updated || '09:00').padStart(5, '0')}:00+09:00`,
      dateModified: `${post.date}T${(post.updated || '09:00').padStart(5, '0')}:00+09:00`,
      author: { '@type': 'Organization', name: cfg.author }, publisher: { '@type': 'Organization', name: cfg.title },
      mainEntityOfPage: abs(p), inLanguage: 'ja',
    },
  });
}

const card = (p, lead) => `<a class="card${lead ? ' lead' : ''}" href="${url(`/posts/${p.date}/`)}"><div class="cdate">${jpDate(p.date)}${p.edition ? esc(p.edition) : ''}</div><div class="ctitle">${esc(plain(p.title))}</div><div class="cdesc">${esc(p.description)}</div></a>`;

function indexPage(posts) {
  const latest = posts.slice(0, 10);
  const body = `<section class="hero"><h1>${esc(cfg.title)}</h1><p>${esc(cfg.tagline)}</p></section>
<div class="cards">${latest.map((p, i) => card(p, i === 0) + (i === 0 ? adUnit('list') : '')).join('\n')}</div>
${posts.length > latest.length ? `<p style="margin-top:20px"><a href="${url('/archive/')}">すべての記事を見る</a></p>` : ''}`;
  return layout({ title: cfg.title, description: cfg.description, pathName: '/', body, jsonld: { '@context': 'https://schema.org', '@type': 'WebSite', name: cfg.title, url: abs('/'), inLanguage: 'ja' } });
}
function archivePage(posts) {
  const byMonth = new Map();
  for (const p of posts) { const k = p.date.slice(0, 7); byMonth.set(k, [...(byMonth.get(k) || []), p]); }
  const body = `<div class="page"><h1>記事一覧</h1>${[...byMonth].map(([k, list]) => `<h2>${Number(k.slice(0, 4))}年${Number(k.slice(5))}月</h2><div class="cards">${list.map((p) => card(p)).join('')}</div>`).join('')}</div>`;
  return layout({ title: '記事一覧', description: `${cfg.title} の記事一覧です。`, pathName: '/archive/', body });
}
function staticPage(file, title, pathName) {
  const html = fs.readFileSync(path.join(ROOT, 'src', file), 'utf8').replaceAll('{{title}}', esc(cfg.title));
  return layout({ title, description: `${cfg.title} の「${title}」のページです。`, pathName, body: `<div class="page">${html}</div>` });
}

// ---------- 実行 ----------
const postDir = path.join(ROOT, 'posts');
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
if (!posts.length) { console.error('記事が1件もありません。'); process.exit(1); }
if (args.has('--check')) { console.log(`✓ ${posts.length} 件の記事の形式は正しいです。`); process.exit(0); }

fs.rmSync(DIST, { recursive: true, force: true });
const write = (rel, content) => { const f = path.join(DIST, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
write('style.css', fs.readFileSync(path.join(ROOT, 'src', 'style.css'), 'utf8'));
write('favicon.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#000"/><text x="32" y="41" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-weight="700" font-size="22" fill="#fff">FSD</text></svg>');
write('og.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#000"/><text x="80" y="300" font-family="Helvetica,Arial,sans-serif" font-weight="700" font-size="76" fill="#fff">TESLA FSD</text><text x="80" y="390" font-family="Helvetica,Arial,sans-serif" font-weight="700" font-size="76" fill="#fff">WORLD NEWS</text><rect x="80" y="430" width="220" height="10" rx="5" fill="#53b559"/></svg>`);
write('.nojekyll', '');
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${abs('/sitemap.xml')}\n`);
if (cfg.adsense?.client) write('ads.txt', `google.com, ${cfg.adsense.client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`);
write('index.html', indexPage(posts));
write('archive/index.html', archivePage(posts));
write('about/index.html', staticPage('about.html', 'このサイトについて', '/about/'));
write('privacy/index.html', staticPage('privacy.html', 'プライバシーポリシー・免責事項', '/privacy/'));
write('404.html', layout({ title: 'ページが見つかりません', description: cfg.description, pathName: '/404.html', body: `<div class="page"><h1>ページが見つかりません</h1><p><a href="${url('/')}">最新の記事へ戻る</a></p></div>` }));
posts.forEach((p, i) => write(`posts/${p.date}/index.html`, postPage(p, posts[i + 1], posts[i - 1])));
const pages = ['/', '/archive/', '/about/', '/privacy/', ...posts.map((p) => `/posts/${p.date}/`)];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `<url><loc>${esc(abs(p))}</loc></url>`).join('\n')}\n</urlset>\n`);
write('feed.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${esc(cfg.title)}</title><link>${esc(abs('/'))}</link><description>${esc(cfg.description)}</description><language>ja</language>\n${posts.slice(0, 20).map((p) => `<item><title>${esc(plain(p.title))}</title><link>${esc(abs(`/posts/${p.date}/`))}</link><guid>${esc(abs(`/posts/${p.date}/`))}</guid><pubDate>${new Date(`${p.date}T${(p.updated || '09:00').padStart(5, '0')}:00+09:00`).toUTCString()}</pubDate><description>${esc(p.description)}</description></item>`).join('\n')}\n</channel></rss>\n`);
console.log(`✓ ${posts.length} 件の記事を dist/ に書き出しました（最新: ${posts[0].date}）`);
