import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const outputDir = new URL('../public/icons/', import.meta.url);
const logo = fileURLToPath(new URL('../public/logo.svg', import.meta.url));

await mkdir(outputDir, { recursive: true });

async function renderIcon(filename, size, safePadding) {
  const foreground = await sharp(logo)
    .resize({
      width: size - safePadding * 2,
      height: size - safePadding * 2,
      fit: 'contain',
    })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: '#02070c',
    },
  })
    .composite([{ input: foreground, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toFile(fileURLToPath(new URL(filename, outputDir)));
}

await Promise.all([
  renderIcon('apple-touch-icon.png', 180, 18),
  renderIcon('icon-192.png', 192, 18),
  renderIcon('icon-512.png', 512, 48),
  renderIcon('icon-maskable-512.png', 512, 102),
]);

console.log('Generated God\'s Eye View app icons.');
