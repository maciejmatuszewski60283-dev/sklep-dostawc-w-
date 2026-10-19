'use strict';
// Przetwarzanie zdjęć produktów: weryfikacja, że plik to naprawdę obraz, zmiana rozmiaru,
// konwersja do WebP i usunięcie metadanych (EXIF/GPS) — ważne także dla Twojej prywatności.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('../config');
const { randomToken } = require('./crypto');

const ALLOWED = new Set(['jpeg', 'png', 'webp', 'gif', 'avif']);
const DIR = () => path.join(config.uploadsDir, 'products');

async function processProductImage(buffer) {
  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: 60_000_000 }).metadata();
  } catch {
    throw new Error('Plik nie jest prawidłowym obrazem.');
  }
  if (!ALLOWED.has(meta.format)) throw new Error('Dozwolone formaty: JPG, PNG, WebP, GIF, AVIF.');
  if (!meta.width || !meta.height || meta.width < 200 || meta.height < 150) throw new Error('Zdjęcie jest za małe (min. 200×150 px).');
  fs.mkdirSync(DIR(), { recursive: true });
  const name = randomToken(12);
  const file = `${name}.webp`;
  const thumb = `${name}-t.webp`;
  const main = await sharp(buffer, { limitInputPixels: 60_000_000 }).rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 84 }).toFile(path.join(DIR(), file));
  await sharp(buffer, { limitInputPixels: 60_000_000 }).rotate()
    .resize({ width: 640, height: 480, fit: 'cover', position: 'attention' })
    .webp({ quality: 80 }).toFile(path.join(DIR(), thumb));
  return { file, thumb, width: main.width, height: main.height };
}

function removeImageFiles(img) {
  for (const f of [img.file, img.thumb]) {
    if (!f || f.includes('/') || f.includes('..')) continue;
    fs.rm(path.join(DIR(), f), { force: true }, () => {});
  }
}

module.exports = { processProductImage, removeImageFiles };
