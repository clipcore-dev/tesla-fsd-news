const commons = 'https://commons.wikimedia.org';
const licenses = {
  'cc-by-2.0': ['CC BY 2.0', 'https://creativecommons.org/licenses/by/2.0/'],
  'cc-by-3.0': ['CC BY 3.0', 'https://creativecommons.org/licenses/by/3.0/'],
  'cc-by-4.0': ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'],
  'cc-by-sa-2.0': ['CC BY-SA 2.0', 'https://creativecommons.org/licenses/by-sa/2.0/'],
  'cc-by-sa-3.0': ['CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/3.0/'],
  'cc-by-sa-4.0': ['CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'],
  cc0: ['CC0', 'https://creativecommons.org/publicdomain/zero/1.0/'],
};
const plainText = (value, limit) => typeof value === 'string' && value.trim().length > 0 &&
  value.length <= limit && !/[<>\u0000-\u001f]/.test(value);
const commonsFile = (value) => plainText(value, 240) && /^File:[^|#]+\.(?:jpe?g|png|webp)$/i.test(value);
const validImage = (value) => typeof value === 'string' && /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/thumb\/[a-zA-Z0-9_./%+(),;:~!'-]+$/.test(value);

function publicUrl(value) {
  if (typeof value !== 'string' || value.length > 2400 || /[\s<>"\\]/.test(value)) return null;
  try {
    const link = new URL(value);
    return link.protocol === 'https:' && !link.username && !link.password && !link.port &&
      /\.[a-z]{2,}$/i.test(link.hostname) && !/\.(?:local|localhost|internal|test|invalid|example)$/i.test(link.hostname)
      ? link : null;
  } catch {
    return null;
  }
}

function externalCover(photo) {
  const source = publicUrl(photo.source);
  const image = publicUrl(photo.image);
  const permission = publicUrl(photo.permission);
  const license = photo.license === 'publisher-permission' ? ['掲載許可・利用条件', permission?.href] :
    Object.hasOwn(licenses, photo.license) ? licenses[photo.license] : null;
  if (!source || !image || !permission || !license || !/\.(?:jpe?g|png|webp|avif)$/i.test(image.pathname) ||
      !plainText(photo.publisher, 160)) return null;
  return { caption: photo.caption, author: photo.author, publisher: photo.publisher, image: image.href,
    license: license[0], licenseUrl: license[1], source: source.href, permission: permission.href };
}

export function publicCover(photo) {
  if (!plainText(photo?.caption, 240) || !plainText(photo.author, 300)) return null;
  if (!photo.file) return externalCover(photo);
  const license = Object.hasOwn(licenses, photo?.license) ? licenses[photo.license] : null;
  if (!commonsFile(photo.file) || !license || !validImage(photo.image)) return null;
  return { caption: photo.caption, author: photo.author, image: photo.image,
    license: license[0], licenseUrl: license[1], publisher: 'Wikimedia Commons',
    source: `${commons}/wiki/${encodeURIComponent(photo.file.replaceAll(' ', '_'))}` };
}

export async function resolveCover(candidate, usedCovers) {
  if (candidate && !candidate.file) {
    const display = publicCover(candidate);
    if (!display || usedCovers.some((used) => used?.image === display.image || used?.source === display.source)) return null;
    return { caption: display.caption, author: display.author, publisher: display.publisher, image: display.image,
      source: display.source, permission: display.permission, license: candidate.license };
  }
  if (!commonsFile(candidate?.file) || !plainText(candidate.caption, 240)) return null;
  const query = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', titles: candidate.file, prop: 'imageinfo', redirects: '1',
    iiprop: 'url|size|mime|extmetadata', iiurlwidth: '960', iiextmetadatafilter: 'License|Artist|Restrictions',
  });
  const response = await fetch(`${commons}/w/api.php?${query}`, {
    headers: { 'User-Agent': 'TeslaFSDWorldNews/1.0 (https://tesla.clipcore.io/about/)' },
    redirect: 'error', signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;
  const [page] = (await response.json()).query?.pages || [];
  const entry = page?.imageinfo?.[0];
  if (!entry || !['image/jpeg', 'image/png', 'image/webp'].includes(entry.mime) ||
      !entry.thumburl || entry.extmetadata?.Restrictions?.value) return null;
  const photo = {
    file: page.title, caption: candidate.caption, image: entry.thumburl.split('?')[0],
    author: entry.extmetadata?.Artist?.value?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
    license: entry.extmetadata?.License?.value,
  };
  if (usedCovers.some((used) => used?.file === photo.file || used?.image === photo.image) || !publicCover(photo)) return null;
  return photo;
}
