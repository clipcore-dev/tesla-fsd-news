const commons = 'https://commons.wikimedia.org';
const licenses = {
  'cc-by-4.0': ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'],
  'cc-by-sa-4.0': ['CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'],
  cc0: ['CC0', 'https://creativecommons.org/publicdomain/zero/1.0/'],
};
const plainText = (value, limit) => typeof value === 'string' && value.trim().length > 0 &&
  value.length <= limit && !/[<>\u0000-\u001f]/.test(value);
const commonsFile = (value) => plainText(value, 240) && /^File:[^|#]+\.(?:jpe?g|png|webp)$/i.test(value);
const validImage = (value) => typeof value === 'string' && /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/thumb\/[a-zA-Z0-9_./%+(),;:~!'-]+$/.test(value);

export function publicCover(photo) {
  const license = Object.hasOwn(licenses, photo?.license) ? licenses[photo.license] : null;
  if (!commonsFile(photo?.file) || !plainText(photo.caption, 240) || !plainText(photo.author, 300) ||
      !license || !validImage(photo.image)) return null;
  return { caption: photo.caption, author: photo.author, image: photo.image,
    license: license[0], licenseUrl: license[1], source: `${commons}/wiki/${encodeURIComponent(photo.file.replaceAll(' ', '_'))}` };
}

export async function resolveCover(candidate, usedCovers) {
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
