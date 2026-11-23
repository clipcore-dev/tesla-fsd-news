import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const env = process.env;
const postsDir = '.publish/posts';
const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', dateStyle: 'short' }).format();
const postDate = /^\d{4}-\d{2}-\d{2}$/;
const safeText = (value, max) => typeof value === 'string' && value.trim().length > 0 &&
  value.length <= max && !/[<>\[\]*\u0000-\u001f]|https?:\/\//i.test(value);
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const origin = () => {
  const url = new URL(env.SITE_URL);
  if (url.protocol !== 'https:' || url.href !== url.origin + '/') throw new Error('公開先はルートのHTTPS URLを指定してください。');
  return url.origin;
};
const trustedImages = {
  'model3.jpg': '80e67f7a4e93695169b09fb2a7bc4f30dff9fad33af224b5ed98907a74c42ad1',
  'modely.jpg': '65f33f83e2de4dd0296bb575e80528e9a8ef517f8baf3a2f791d6eada427b65e',
};
const isSource = (link) => {
  try {
    const url = new URL(link);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      url.pathname !== '/' && !url.hash && url.href === link;
  } catch {
    return false;
  }
};

function issue() {
  const handoff = env.EDITORIAL_HANDOFF?.trim();
  if (!handoff) throw new Error('朝6時のChatGPT記事が届いていません。');
  const article = JSON.parse(handoff);
  if (article?.date !== date || !safeText(article.title, 160) || !safeText(article.summary, 400) ||
      !Array.isArray(article.sections) || article.sections.length < 1 || article.sections.length > 12) {
    throw new Error('当日の記事の形式を確認できませんでした。');
  }
  for (const section of article.sections) {
    if (!safeText(section?.title, 160) || !Array.isArray(section.paragraphs) ||
        section.paragraphs.length < 1 || section.paragraphs.length > 12 ||
        section.paragraphs.some((paragraph) => !safeText(paragraph, 1600)) ||
        !['公式発表', '報道', '独自分析'].includes(section.kind) ||
        !Array.isArray(section.sources) || section.sources.length < 2 || section.sources.length > 6 ||
        section.sources.some((source) => !safeText(source?.name, 160) || !isSource(source.url)) ||
        new Set(section.sources.map((source) => new URL(source.url).hostname.replace(/^www\\./, ''))).size < 2) {
      throw new Error('記事の本文または出典の形式が正しくありません。');
    }
  }
  return {
    date, edition: '朝刊', title: article.title, description: article.summary, lead: [article.summary],
    blocks: article.sections.flatMap((section) => [
      { type: 'h2', text: section.title },
      { type: 'meta', text: `【${section.kind}】` },
      ...section.paragraphs.map((paragraph) => ({ type: 'p', text: paragraph })),
      ...section.sources.map(({ name, url }) => ({ type: 'source', text: name, url })),
    ]),
    conclusion: 'FSD（Supervised）は運転支援機能です。運転者には常時の監視が求められます。',
  };
}

async function prepare() {
  const mode = env.PUBLISH_MODE;
  if (!['daily', 'archive', 'bootstrap'].includes(mode)) throw new Error('公開モードが不正です。');
  const base = origin();
  const project = await cloudflare();
  if (project.production_branch !== 'main' || project.source) {
    throw new Error('本番ブランチがmainのDirect Uploadプロジェクトを使用してください。');
  }
  const previous = project.canonical_deployment;
  const bootstrap = mode === 'bootstrap';
  const daily = mode === 'daily';
  if (bootstrap && previous) throw new Error('公開済みのプロジェクトを初期化できません。');
  if (!bootstrap && !previous?.id) throw new Error('初回セットアップを先に実行してください。');
  let posts = [];
  const archivePath = 'src/japan-watch/archive.html';
  const importedArchive = await fs.stat(archivePath).then((file) => file.isFile(), (error) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  if (mode === 'archive' && !importedArchive) throw new Error('公開する過去記事が同梱されていません。');
  if (previous) {
    const publicCheck = await fetch(`${base}/edition-state.json`, {
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000),
    });
    if (!publicCheck.ok) throw new Error('独自ドメインの準備ができていません。');
    const deployment = new URL(previous.url);
    if (deployment.protocol !== 'https:' || !deployment.hostname.endsWith('.pages.dev')) throw new Error('アーカイブの取得先を確認できません。');
    const response = await fetch(new URL('/edition-state.json', deployment), {
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error('公開中のアーカイブを取得できません。');
    const stateText = await response.text();
    if (stateText !== await publicCheck.text()) throw new Error('公開中の版と最新のアーカイブが一致しません。');
    const state = JSON.parse(stateText);
    if (state.version !== 1 || !Array.isArray(state.posts)) throw new Error('既存アーカイブの形式が不正です。');
    posts = state.posts;
    if (state.importedArchive === true && !importedArchive) {
      throw new Error('公開済みの過去記事が同梱されていません。');
    }
  }
  const days = new Set();
  for (const post of posts) {
    if (typeof post?.date !== 'string' || !postDate.test(post.date) || post.date > date || days.has(post.date)) {
      throw new Error('既存アーカイブに無効または重複する日付があります。');
    }
    days.add(post.date);
  }
  if (daily && days.has(date)) {
    await fs.appendFile(env.GITHUB_OUTPUT, 'deploy=false\n');
    return;
  }
  const photos = await fs.readdir('src/photos');
  if (photos.length !== Object.keys(trustedImages).length) throw new Error('未確認の画像が含まれています。');
  for (const photo of photos) {
    if (hash(await fs.readFile(path.join('src/photos', photo))) !== trustedImages[photo]) {
      throw new Error('承認済み画像と一致しません。');
    }
  }
  posts.sort((first, second) => first.date.localeCompare(second.date));
  if (daily) posts.push(issue());
  await fs.mkdir(postsDir, { recursive: true });
  for (const post of posts) await fs.writeFile(path.join(postsDir, `${post.date}.json`), JSON.stringify(post), { flag: 'wx' });
  const build = spawnSync(process.execPath, ['build.mjs', '--allow-empty'], {
    env: { ...env, POSTS_DIR: postsDir }, stdio: 'inherit',
  });
  if (build.status !== 0) throw new Error('記事のビルドに失敗しました。');
  const state = JSON.stringify({ version: 1, posts, ...(importedArchive ? { importedArchive } : {}) });
  await fs.writeFile('dist/edition-state.json', state);
  await fs.writeFile('dist/_headers', '/edition-state.json\n  Cache-Control: no-store\n  X-Robots-Tag: noindex\n');
  const latest = posts.at(-1)?.date;
  const routes = ['/', '/archive/', '/feed.xml', '/sitemap.xml', '/edition-state.json'];
  if (importedArchive) routes.push('/japan-watch/sitemap.xml');
  if (latest) routes.push(`/posts/${latest}/`);
  const expected = {};
  for (const route of routes) {
    expected[route] = hash(await fs.readFile(`dist${route}${route.endsWith('/') ? 'index.html' : ''}`));
  }
  await fs.writeFile('.publish/expected.json', JSON.stringify(expected));
  await fs.appendFile(env.GITHUB_OUTPUT, `deploy=true\nprevious=${previous?.id || ''}\n`);
}

async function cloudflare(suffix = '', method = 'GET') {
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token, PAGES_PROJECT: project } = env;
  if (!/^[a-f0-9]{32}$/.test(account || '') || !/^[a-z0-9-]+$/.test(project || '') || !token) {
    throw new Error('Cloudflareの公開設定が不足しています。');
  }
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}${suffix}`, {
    method, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(`Cloudflare API エラー (${response.status})`);
  return body.result;
}

async function verify() {
  const expected = JSON.parse(await fs.readFile('.publish/expected.json', 'utf8'));
  const project = env.PUBLISH_MODE === 'bootstrap' ? await cloudflare() : null;
  const hostname = project?.subdomain;
  if (project && !/^[a-z0-9-]+\.pages\.dev$/.test(hostname || '')) throw new Error('Pagesの初期URLを確認できません。');
  const target = project ? `https://${hostname}` : origin();
  for (let attempt = 0; attempt < 8; attempt++) {
    const results = await Promise.allSettled(Object.entries(expected).map(async ([route, checksum]) => {
      const response = await fetch(`${target}${route}?verify=${env.GITHUB_RUN_ID}-${attempt}`, {
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== checksum) throw new Error(route);
    }));
    if (results.every((result) => result.status === 'fulfilled')) return;
    if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 8_000));
  }
  throw new Error('公開サイトがビルド結果と一致しません。');
}

switch (process.argv[2]) {
  case 'prepare': await prepare(); break;
  case 'verify': await verify(); break;
  case 'rollback':
    if (!/^[a-f0-9-]{36}$/i.test(env.PREVIOUS_DEPLOYMENT || '')) throw new Error('切り戻し先がありません。');
    await cloudflare(`/deployments/${env.PREVIOUS_DEPLOYMENT}/rollback`, 'POST');
    break;
  default: throw new Error('prepare / verify / rollback を指定してください。');
}
