/**
 * Lista modow, ktore mozna wybrac na panelu "Sprawdz swoja licencje" i przy /licencja.
 * Chcesz dodac kolejnego moda? Dopisz tu nowy wpis, np.:
 *   nowymod: { label: 'NowyMod', emoji: '⚔️', desc: 'Licencja do moda NowyMod' },
 * i zrestartuj bota - pojawi sie na liscie wyboru.
 */
export const MODS = {
  botyluma: {
    label: 'BotyLuma', emoji: '🤖', desc: 'Licencja do moda BotyLuma',
    jarPrefix: 'lumabots', adminChannelEnv: 'LUMABOTS_LICENSE_CHANNEL_ID', cmd: '/lumabots licencja',
  },
  autorynek: {
    label: 'AutoRynek', emoji: '🔑', desc: 'Licencja do moda AutoRynek',
    jarPrefix: 'autorynek', adminChannelEnv: 'LICENSE_CHANNEL_ID', cmd: '/autorynek licencja',
  },
  playerhighlight: {
    label: 'PlayerHighlight', emoji: '✨', desc: 'Licencja do moda PlayerHighlight',
    jarPrefix: 'playerhighlight', adminChannelEnv: 'PLAYERHIGHLIGHT_LICENSE_CHANNEL_ID', cmd: '/playerhighlight licencja',
    openKey: 'Prawy Shift',
  },
};

// licencje wystawione przed v5 nie maja pola "mod" - traktujemy je jako AutoRynek
export const DEFAULT_MOD = 'autorynek';
