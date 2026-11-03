#!/usr/bin/env node
// Instagram Carousel Publisher
// Usage: node --env-file=.env publish.js --images "slide1.jpg,slide2.jpg" --caption "..." [--dry-run]

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Argument parsing ──────────────────────────────────────────

export function parseArgs(argv) {
  const args = { images: [], caption: '', dryRun: false, integrationTest: false,
    publish: false, allowPublicUpload: false, imagesRoot: resolve('squads') };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--images') {
      if (i + 1 < argv.length) args.images = argv[++i].split(',').map(s => s.trim());
    }
    else if (argv[i] === '--caption') {
      if (i + 1 < argv.length) args.caption = argv[++i];
    }
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--integration-test') args.integrationTest = true;
    else if (argv[i] === '--publish') args.publish = true;
    else if (argv[i] === '--allow-public-upload') args.allowPublicUpload = true;
    else if (argv[i] === '--images-root' && i + 1 < argv.length) args.imagesRoot = argv[++i];
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  return args;
}

// ── Image upload (imgBB) ──────────────────────────────────────

export function readValidatedImage(imagePath, imagesRoot = resolve('squads')) {
  const root = realpathSync(imagesRoot);
  const absolutePath = realpathSync(resolve(imagePath));
  const rel = relative(root, absolutePath);
  if (!rel || rel === '..' || rel.startsWith('..' + '/') || rel.startsWith('..' + '\\') || isAbsolute(rel)) {
    throw new Error('Image must be inside --images-root');
  }
  const info = statSync(absolutePath);
  if (!info.isFile() || info.size > 10 * 1024 * 1024) throw new Error('Image must be a file of at most 10 MiB');
  if (!['.jpg', '.jpeg'].includes(extname(absolutePath).toLowerCase())) throw new Error('Only JPEG images are accepted');
  const fileBuffer = readFileSync(absolutePath);
  if (fileBuffer.length < 4 || fileBuffer[0] !== 0xff || fileBuffer[1] !== 0xd8 || fileBuffer[2] !== 0xff) {
    throw new Error('Invalid JPEG signature');
  }
  return fileBuffer;
}

export async function uploadToImgBB(imagePath, apiKey, imagesRoot = resolve('squads')) {
  const fileBuffer = readValidatedImage(imagePath, imagesRoot);
  const base64Image = fileBuffer.toString('base64');
  const form = new FormData();
  form.append('key', apiKey);
  form.append('image', base64Image);
  form.append('expiration', '3600');
  const res = await fetch('https://api.imgbb.com/1/upload', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`imgBB upload failed [${res.status}]: ${await res.text()}`);
  const json = await res.json();
  if (!json.success) throw new Error(`imgBB upload failed: ${JSON.stringify(json)}`);
  return json.data.url;
}

// ── Instagram Graph API ───────────────────────────────────────

const IG_BASE = 'https://graph.facebook.com/v21.0';

async function graphRequest(id, endpoint, params, accessToken, method = 'POST') {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(id))) throw new Error('Invalid Graph API identifier');
  const url = `${IG_BASE}/${id}${endpoint}${method === 'GET' ? `?${params}` : ''}`;
  return fetch(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}` },
    ...(method === 'POST' ? { body: params } : {}),
    signal: AbortSignal.timeout(30_000),
  });
}

export async function createChildContainer(userId, imageUrl, accessToken) {
  const params = new URLSearchParams({
    image_url: imageUrl,
    is_carousel_item: 'true',
  });
  const res = await graphRequest(userId, '/media', params, accessToken);
  if (!res.ok) throw new Error(`createChildContainer failed [${res.status}]: ${await res.text()}`);
  return (await res.json()).id;
}

export async function getContainerStatus(containerId, accessToken) {
  const params = new URLSearchParams({ fields: 'status_code' });
  const res = await graphRequest(containerId, '', params, accessToken, 'GET');
  if (!res.ok) throw new Error(`getContainerStatus failed [${res.status}]: ${await res.text()}`);
  return (await res.json()).status_code;
}

export async function pollUntilFinished(containerId, accessToken, timeoutMs = 60_000, intervalMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getContainerStatus(containerId, accessToken);
    if (status === 'FINISHED') return;
    if (status === 'ERROR') throw new Error(`Container ${containerId} entered ERROR state`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Container ${containerId} timed out after ${timeoutMs}ms`);
}

export async function createCarouselContainer(userId, childIds, caption, accessToken) {
  const params = new URLSearchParams({
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption,
  });
  const res = await graphRequest(userId, '/media', params, accessToken);
  if (!res.ok) throw new Error(`createCarouselContainer failed [${res.status}]: ${await res.text()}`);
  return (await res.json()).id;
}

export async function publishMedia(userId, containerId, accessToken) {
  const params = new URLSearchParams({ creation_id: containerId });
  const res = await graphRequest(userId, '/media_publish', params, accessToken);
  if (!res.ok) throw new Error(`publishMedia failed [${res.status}]: ${await res.text()}`);
  return (await res.json()).id;
}

export async function getPermalink(mediaId, accessToken) {
  const params = new URLSearchParams({ fields: 'permalink' });
  const res = await graphRequest(mediaId, '', params, accessToken, 'GET');
  if (!res.ok) return null; // non-fatal — just skip the URL display
  const json = await res.json();
  return json.permalink ?? null;
}

// ── Main ──────────────────────────────────────────────────────

export async function main(argv = process.argv) {
  const { images, caption, dryRun, integrationTest, publish, allowPublicUpload, imagesRoot } = parseArgs(argv);

  if (!images.length) throw new Error('--images is required (e.g. --images "slide1.jpg,slide2.jpg")');
  if (!caption) throw new Error('--caption is required');
  if (images.length < 2 || images.length > 10) {
    throw new Error(`Instagram carousels require 2–10 images (got ${images.length})`);
  }
  if (caption.length > 2200) {
    throw new Error(`Caption exceeds Instagram's 2200-character limit (got ${caption.length})`);
  }

  if ([dryRun, integrationTest, publish].filter(Boolean).length !== 1) {
    throw new Error('Choose exactly one mode: --dry-run, --integration-test or --publish');
  }
  // Validate the complete batch before any external side effect.
  images.forEach(p => readValidatedImage(p, imagesRoot));
  if (dryRun) {
    console.log('DRY RUN: local validation passed. No uploads or API calls. Credentials were not tested.');
    return;
  }
  if (!allowPublicUpload) throw new Error('Public image hosting requires --allow-public-upload');

  const { INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID, IMGBB_API_KEY } = process.env;
  if (!INSTAGRAM_ACCESS_TOKEN) throw new Error('INSTAGRAM_ACCESS_TOKEN is not set in environment');
  if (!INSTAGRAM_USER_ID) throw new Error('INSTAGRAM_USER_ID is not set in environment');
  if (!IMGBB_API_KEY) throw new Error('IMGBB_API_KEY is not set in environment. Get one at https://api.imgbb.com/');

  console.log(`📸 Uploading ${images.length} image(s) to imgBB...`);
  const imageUrls = await Promise.all(images.map(p => uploadToImgBB(p, IMGBB_API_KEY, imagesRoot)));
  imageUrls.forEach((url, i) => console.log(`   [${i + 1}] ${url}`));

  console.log('\n📦 Creating Instagram media containers...');
  const childIds = await Promise.all(
    imageUrls.map(url => createChildContainer(INSTAGRAM_USER_ID, url, INSTAGRAM_ACCESS_TOKEN))
  );
  console.log(`   Container IDs: ${childIds.join(', ')}`);

  console.log('\n⏳ Waiting for containers to finish processing...');
  await Promise.all(childIds.map(id => pollUntilFinished(id, INSTAGRAM_ACCESS_TOKEN)));
  console.log('   All containers ready.');

  console.log('\n🎠 Creating carousel container...');
  const carouselId = await createCarouselContainer(
    INSTAGRAM_USER_ID, childIds, caption, INSTAGRAM_ACCESS_TOKEN
  );
  await pollUntilFinished(carouselId, INSTAGRAM_ACCESS_TOKEN);
  console.log(`   Carousel container ID: ${carouselId}`);

  if (integrationTest) {
    console.log('\n✅ INTEGRATION TEST complete — media uploaded, skipping final publish call.');
    console.log(`   Carousel container ready: ${carouselId}`);
    return;
  }

  console.log('\n🚀 Publishing to Instagram...');
  const postId = await publishMedia(INSTAGRAM_USER_ID, carouselId, INSTAGRAM_ACCESS_TOKEN);
  const permalink = await getPermalink(postId, INSTAGRAM_ACCESS_TOKEN);
  console.log(`\n✅ Published successfully!`);
  console.log(`   Post ID: ${postId}`);
  if (permalink) console.log(`   URL: ${permalink}`);
}

// Run only when executed directly (not when imported for tests)
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(err => {
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
  });
}
