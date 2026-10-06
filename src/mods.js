/**
 * Lista modow, ktore mozna wybrac na panelu "Sprawdz swoja licencje" i przy /licencja.
 * Chcesz dodac kolejnego moda? Dopisz tu nowy wpis, np.:
 *   nowymod: { label: 'NowyMod', emoji: '⚔️', desc: 'Licencja do moda NowyMod' },
 * i zrestartuj bota - pojawi sie na liscie wyboru.
 */
export const MODS = {
  autorynek: { label: 'AutoRynek', emoji: '🔑', desc: 'Licencja do moda AutoRynek' },
};

// licencje wystawione przed v5 nie maja pola "mod" - traktujemy je jako AutoRynek
export const DEFAULT_MOD = 'autorynek';
