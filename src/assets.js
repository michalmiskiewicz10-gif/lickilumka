import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');

/**
 * Szuka pliku assets/<nazwa>.(gif|png|jpg|jpeg|webp) - kolejnosc nazw = kolejnosc waznosci.
 * Zwraca {attachment, name} gotowe do wyslania jako zalacznik (nie wygasa jak link z Discorda) albo null.
 */
export function findAsset(...bases) {
  for (const b of bases) {
    for (const ext of ['png', 'gif', 'jpg', 'jpeg', 'webp']) {
      const f = path.join(dir, `${b}.${ext}`);
      if (fs.existsSync(f)) return { attachment: f, name: `${b}.${ext}` };
    }
  }
  return null;
}
