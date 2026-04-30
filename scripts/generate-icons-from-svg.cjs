const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SOURCE_SVG = 'c:/Users/gurra/Downloads/PTR logga.svg';
const ASSETS_DIR = 'c:/Users/gurra/Desktop/Naphab applikation/naphab-app/assets';
const APP_BG = '#0F1419';
const CANVAS_SIZE = 1024;
const BASE_DENSITY = 1024;
const ICON_LOGO_SIZE = 560;
const ADAPTIVE_LOGO_SIZE = 420;
const SPLASH_LOGO_SIZE = 620;

async function renderTrimmedLogoBuffer(sizePx) {
  const svg = fs.readFileSync(SOURCE_SVG);
  const rendered = await sharp(svg, { density: BASE_DENSITY }).png().toBuffer();
  const trimmed = await sharp(rendered).trim().png().toBuffer();
  return sharp(trimmed)
    .resize(sizePx, sizePx, { fit: 'inside' })
    .png()
    .toBuffer();
}

async function run() {
  const iconLogo = await renderTrimmedLogoBuffer(ICON_LOGO_SIZE);
  await sharp({
    create: { width: CANVAS_SIZE, height: CANVAS_SIZE, channels: 4, background: APP_BG },
  })
    .composite([{ input: iconLogo, gravity: 'center' }])
    .png()
    .toFile(path.join(ASSETS_DIR, 'icon.png'));

  const adaptiveLogo = await renderTrimmedLogoBuffer(ADAPTIVE_LOGO_SIZE);
  await sharp({
    create: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: adaptiveLogo, gravity: 'center' }])
    .png()
    .toFile(path.join(ASSETS_DIR, 'adaptive-icon.png'));

  const splashLogo = await renderTrimmedLogoBuffer(SPLASH_LOGO_SIZE);
  await sharp({
    create: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: splashLogo, gravity: 'center' }])
    .png()
    .toFile(path.join(ASSETS_DIR, 'splash-icon.png'));

  console.log('Generated icon.png, adaptive-icon.png and splash-icon.png');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
