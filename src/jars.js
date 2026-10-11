import fs from 'node:fs';
import path from 'node:path';
import { MODS } from './mods.js';

/** Wersje Minecrafta obslugiwane przez panel pobierania (od najnowszej). */
export const MC_VERSIONS = ['1.21.11', '1.21.10', '1.21.9', '1.21.8', '1.21.7', '1.21.6', '1.21.5', '1.21.4', '1.21.3', '1.21.2', '1.21.1'];
/** Plik bez znacznika "-mc..." w nazwie (np. stary autorynek-1.11.0.jar) uznajemy za zbudowany pod te wersje. */
export const LEGACY_MC = '1.21.11';

const byPriority = (a, b) => (Number(b.explicit) - Number(a.explicit)) || (b.mtime - a.mtime);

const TAG_RE = /-mc((?:1\.21(?:\.\d+)?)(?:[_+]1\.21(?:\.\d+)?)*)(?=[-.]|$)/i;

/**
 * Nazwy plikow w folderze mod/:
 *   <prefix>-<wersjaModa>-mc<wersjaMC>.jar            np. autorynek-1.11.0-mc1.21.4.jar
 *   <prefix>-<wersjaModa>-mc<w1>_<w2>.jar             jeden plik na kilka wersji, np. playerhighlight-1.0.0-mc1.21.2_1.21.3.jar
 * Prefiks = jarPrefix z src/mods.js. Pliki -sources / -dev sa pomijane.
 */
export function parseJarName(name) {
  const low = name.toLowerCase();
  if (!low.endsWith('.jar') || /-(sources|dev|javadoc)\.jar$/.test(low)) return null;
  const modId = Object.keys(MODS).find(id => low.startsWith(MODS[id].jarPrefix.toLowerCase()));
  if (!modId) return null;
  const m = low.match(TAG_RE);
  // nazwa bez "-mc": jesli po prefiksie jest TYLKO wersja MC (np. playerhighlight-1.21.1.jar) - to jest wersja Minecrafta
  const bare = low.slice(MODS[modId].jarPrefix.length).match(/^-(1\.21(?:\.\d+)?)\.jar$/);
  const versions = (m ? m[1].split(/[_+]/) : bare ? [bare[1]] : [LEGACY_MC]).filter(v => MC_VERSIONS.includes(v));
  return versions.length ? { modId, versions, explicit: !!(m || bare) } : null;
}

/** Wszystkie rozpoznane pliki moda: [{ name, path, modId, versions, mtime }] */
export function listJars(modDir) {
  let files;
  try { files = fs.readdirSync(modDir); } catch { return []; }
  const out = [];
  for (const name of files) {
    const info = parseJarName(name);
    if (!info) continue;
    try { out.push({ name, path: path.join(modDir, name), ...info, mtime: fs.statSync(path.join(modDir, name)).mtimeMs }); } catch { /* plik zniknal */ }
  }
  return out;
}

/** Najnowszy (wg daty pliku) jar danego moda dla danej wersji MC albo null. */
export function pickJar(modDir, modId, ver) {
  return listJars(modDir).filter(j => j.modId === modId && j.versions.includes(ver)).sort(byPriority)[0] || null;
}

/** Wersje MC, dla ktorych istnieje plik danego moda (od najnowszej): [{ ver, jar }] */
export function versionsFor(modDir, modId) {
  const jars = listJars(modDir).filter(j => j.modId === modId);
  return MC_VERSIONS.map(ver => ({ ver, jar: jars.filter(j => j.versions.includes(ver)).sort(byPriority)[0] }))
    .filter(x => x.jar);
}
