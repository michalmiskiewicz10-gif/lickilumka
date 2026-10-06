import fs from 'node:fs';
import path from 'node:path';

/**
 * Prosta baza w pliku JSON (data/licenses.json). Przy kilkuset licencjach wystarczy w zupelnosci.
 * Zapis jest atomowy (plik tymczasowy + rename), wiec plik nie zostanie uszkodzony przy awarii.
 */
export class Store {
  constructor(file) {
    this.file = file;
    this.data = { licenses: {}, suggestions: {}, users: {}, meta: {}, giveaways: {}, media: { apps: {}, cd: {} } };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!this.data.licenses) this.data.licenses = {};
      if (!this.data.suggestions) this.data.suggestions = {};
      if (!this.data.users) this.data.users = {};
      if (!this.data.meta) this.data.meta = {};
      if (!this.data.giveaways) this.data.giveaways = {};
      if (!this.data.media) this.data.media = {};
      if (!this.data.media.apps) this.data.media.apps = {};
      if (!this.data.media.cd) this.data.media.cd = {};
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

  // konkursy (klucz = id wiadomosci konkursu)
  getGiveaway(id) { return this.data.giveaways[id] || null; }
  putGiveaway(gw) { this.data.giveaways[gw.id] = gw; this.save(); return gw; }
  allGiveaways() { return Object.values(this.data.giveaways); }

  // podania na range Media (klucz = id wiadomosci na kanale administracji) + cooldowny po odrzuceniu
  putMedia(app) { this.data.media.apps[app.id] = app; this.save(); return app; }
  pendingMedia(userId) { return Object.values(this.data.media.apps).find(a => a.userId === userId && a.status === 'pending') || null; }
  getMediaCd(userId) { return this.data.media.cd[userId] || 0; }
  setMediaCd(userId, until) { this.data.media.cd[userId] = until; this.save(); }

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
