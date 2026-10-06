import fs from 'node:fs';
import path from 'node:path';

/**
 * Prosta baza w pliku JSON (data/licenses.json). Przy kilkuset licencjach wystarczy w zupelnosci.
 * Zapis jest atomowy (plik tymczasowy + rename), wiec plik nie zostanie uszkodzony przy awarii.
 */
export class Store {
  constructor(file) {
    this.file = file;
    this.data = { licenses: {}, suggestions: {} };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!this.data.licenses) this.data.licenses = {};
      if (!this.data.suggestions) this.data.suggestions = {};
    }
  }

  get(key) { return this.data.licenses[key] || null; }
  has(key) { return key in this.data.licenses; }
  byDiscord(id) { return Object.values(this.data.licenses).filter(l => l.discordId === id); }

  getSuggestion(msgId) { return this.data.suggestions[msgId] || null; }
  putSuggestion(msgId, sug) { this.data.suggestions[msgId] = sug; this.save(); return sug; }

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
