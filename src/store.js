import fs from 'node:fs';
import path from 'node:path';

/**
 * Prosta baza w pliku JSON (data/licenses.json). Przy kilkuset licencjach wystarczy w zupelnosci.
 * Zapis jest atomowy (plik tymczasowy + rename), wiec plik nie zostanie uszkodzony przy awarii.
 */
export class Store {
  constructor(file) {
    this.file = file;
    this.data = { licenses: {}, suggestions: {}, users: {}, meta: {} };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!this.data.licenses) this.data.licenses = {};
      if (!this.data.suggestions) this.data.suggestions = {};
      if (!this.data.users) this.data.users = {};
      if (!this.data.meta) this.data.meta = {};
    }
  }

  get(key) { return this.data.licenses[key] || null; }
  has(key) { return key in this.data.licenses; }
  byDiscord(id) { return Object.values(this.data.licenses).filter(l => l.discordId === id); }

  getSuggestion(msgId) { return this.data.suggestions[msgId] || null; }
  putSuggestion(msgId, sug) { this.data.suggestions[msgId] = sug; this.save(); return sug; }

  // tokeny OAuth2 zweryfikowanych uzytkownikow (do ponownego dodania na serwer)
  getUser(id) { return this.data.users[id] || null; }
  putUser(id, u) { this.data.users[id] = u; this.save(); return u; }
  delUser(id) { delete this.data.users[id]; this.save(); }
  allUsers() { return Object.entries(this.data.users).map(([id, u]) => ({ id, ...u })); }

  // proste wartosci (licznik legitcheckow itp.)
  getMeta(k, def = null) { return k in this.data.meta ? this.data.meta[k] : def; }
  setMeta(k, v) { this.data.meta[k] = v; this.save(); return v; }

  put(lic) {
    this.data.licenses[lic.key] = lic;
    this.save();
    return lic;
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
