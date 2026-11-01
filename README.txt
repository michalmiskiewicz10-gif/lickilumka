SERWER LICENCJI AUTORYNEK  (bot Discord + API dla moda)

WYMAGANIA: Node.js 22 LTS (min. 20.12) - https://nodejs.org
Serwer musi dzialac caly czas (najlepiej tani VPS albo Twoj komputer z przekierowanym portem),
bo mod pyta go o licencje.

1. BOT NA DISCORDZIE
   - https://discord.com/developers/applications -> New Application -> zakladka Bot -> Reset Token (skopiuj)
   - OAuth2 -> URL Generator: zaznacz "bot" + "applications.commands", uprawnienia: Send Messages, Embed Links
     -> otworz wygenerowany link i dodaj bota na swoj serwer.
   - Bot musi widziec kanal licencji i miec na nim prawo pisania.

2. KONFIGURACJA
   - w tym folderze:   npm install
   - skopiuj .env.example na .env i uzupelnij: DISCORD_TOKEN, GUILD_ID
     (ID kopiujesz prawym klikiem po wlaczeniu Trybu dewelopera w ustawieniach Discorda)
   - wygeneruj klucze:   npm run keys
       * linijke SIGNING_PRIVATE_KEY=... wklej do .env  (TAJNE, nikomu nie pokazuj)
       * klucz PUBLICZNY wklej w modzie: License.java -> PUBLIC_KEY_B64
   - w License.java ustaw tez SERVER_URL, np. http://123.45.67.89:8787/api/validate
     (port z .env, na VPS otworz ten port w firewallu)

3. START:   npm start
   Powinno pokazac "Bot zalogowany" i "Komenda /licencja zarejestrowana".

4. UZYCIE NA DISCORDZIE
   /licencja discord:@kupujacy jednostka:Dni ilosc:30
   /licencja discord:@kupujacy jednostka:Permanentna
   - kod XXXX-XXXX-XXXX-XXXX widzisz od razu (tylko Ty), dostaje go kupujacy w DM,
     a na kanale licencji pojawia sie wiadomosc: nick, kod, kiedy wygasa + przyciski
     [Przedluz licencje] (zielony - wpisujesz np. 7d, 12h, 90m, 30s albo perm)
     [Uniewaznij licencje] (czerwony).
   - Komenda i przyciski dzialaja tylko dla osob z uprawnieniem "Zarzadzanie serwerem"
     (albo dla ID z ADMIN_IDS w .env).

5. W GRZE (kupujacy):   /autorynek licencja XXXX-XXXX-XXXX-XXXX
   Pierwsze uzycie przypisuje kod do jego komputera i nicku. Na innym komputerze - odmowa.
   Gdy kupujacy zmieni komputer: uniewaznij stara licencje i wystaw nowa.

BAZA: data/licenses.json (rob kopie zapasowe).


=== NOWE FUNKCJE ===
/panel        - (admin) wysyla na kanal panel z przyciskami "Zobacz swoja licencje" (kod + data wygasniecia na PV) i "Jak zainstalowac moda"
/licencja     - (admin) tworzy licencje; informacja z przyciskami Przedluz/Uniewaznij trafia na kanal LICENSE_CHANNEL_ID
Propozycje    - gracz po prostu pisze wiadomosc na kanale PROPOSALS_CHANNEL_ID; bot ja usuwa i zamienia w embed z glosowaniem i watkiem (wymaga "Message Content Intent")
Powitania     - gdy ustawisz WELCOME_CHANNEL_ID (i wlaczysz "Server Members Intent" w Developer Portal -> Bot)


=== NOWE FUNKCJE (v2) ===
/licencja     - na kanale, na ktorym uzyto komendy (np. ticket): embed z licencja (pelny kod, bez przyciskow) + zaraz pod nim
                plik .jar z folderu mod/ i instrukcja jak go pobrac, zainstalowac i wpisac kod (wersja 1.21.11).
                Jesli ustawisz LICENSE_CHANNEL_ID, tam trafi kopia z przyciskami Przedluz/Uniewaznij.
/panel        - panel licencji z jednym przyciskiem "Sprawdz swoja licencje" (kod widzi tylko klikajacy).
/instalacja   - panel na osobny kanal z przyciskiem "Jak zainstalowac moda" (instrukcja + kod kupujacego + plik .jar).
/weryfikacja  - panel z przyciskiem; okienko z dzialaniem do 10; po poprawnej odpowiedzi rola VERIFIED_ROLE_ID.
                Kazdy nowy czlonek od razu dostaje role UNVERIFIED_ROLE_ID, ktora jest zabierana po weryfikacji.
/zgloszenia   - panel ticketow: Zakup / Pomoc / Wspolpraca (v5); prywatny kanal + przycisk zamykania.
LEGITCHECK_CHANNEL_ID - kazda wiadomosc gracza = +1, bot wysyla embed z licznikiem pod nia. /licznik ustawia wartosc.
OBRAZEK POWITANIA - wrzuc plik assets/welcome.gif (lub .png/.jpg) do repo; bot dolacza go do powitania (linki z Discorda wygasaja).

WYMAGANE W DEVELOPER PORTAL (Bot -> Privileged Gateway Intents): Server Members Intent (powitania + rola niezweryfikowanego) i Message Content Intent (propozycje).
Uprawnienia bota: Zarzadzanie rolami (jego rola musi byc WYZEJ niz role weryfikacji), Zarzadzanie kanalami, Zarzadzanie wiadomosciami, Wysylanie wiadomosci, Osadzanie linkow, Dolaczanie plikow, Tworzenie publicznych watkow.
RAILWAY: dodaj Volume i ustaw DATA_DIR na jego sciezke - inaczej baza licencji kasuje sie przy kazdym deployu!


=== NOWE FUNKCJE (v5) ===
TICKETY (/zgloszenia)
  - Panel z grafika kota (assets/kot.png) i lista: Zakup / Pomoc / Wspolpraca (Media usuniete).
  - Kazda kategoria = osobny folder Discorda: TICKET_CATEGORY_ZAKUP / _POMOC / _WSPOLPRACA.
  - "Zamknij zgloszenie": gracz jest USUWANY z kanalu, kanal przechodzi do folderu TICKET_CATEGORY_DELETED,
    a administracja zostaje. W tym folderze przycisk "Zamknij i usun kanal" kasuje kanal calkowicie.
  - Bot potrzebuje uprawnien: Zarzadzanie kanalami + Zarzadzanie rolami (usuwanie gracza z kanalu).

GRAFIKA KOTA / POWITANIA
  - assets/kot.png jest wysylany jako ZALACZNIK (nie wygasa jak link z Discorda) - w panelu ticketow i w powitaniach.
  - Wlasny obrazek powitania: assets/welcome.gif (ma pierwszenstwo przed kotem). Wlasny baner ticketow: assets/ticket.png.
  - Bot musi miec uprawnienie "Dolaczanie plikow" na kanale powitan.

MEDIA (/media)
  - Panel z wymaganiami (TikTok / YouTube) i przyciskiem "Aplikuj na Media". W "Co oferujemy": Dowolny Mod.
  - Po kliknieciu bot pisze do gracza NA PV: 1) nick z Minecrafta, 2) konto premium (Tak/Nie), 3) nazwa konta YT/TikTok,
    potem przyciski [Wyslij apelacje] / [Usun apelacje].
  - Podanie laduje na kanale MEDIA_REVIEW_CHANNEL_ID z przyciskami [Akceptuj] / [Odrzuc].
    Akceptuj -> ranga MEDIA_ROLE_ID nadana automatycznie + wiadomosc na PV.
    Odrzuc (z opcjonalnym powodem) -> wiadomosc na PV + cooldown 3 dni (MEDIA_COOLDOWN_DAYS) na ponowne podanie.
  - Gracz musi miec wlaczone wiadomosci prywatne od czlonkow serwera.

KONKURSY
  /konkurs wymagania:<tekst> ilosc_wygranych:<1-20> nagroda:<tekst> czas:<np. 30m, 2h, 1d>
     - bot wrzuca embed z przyciskiem "Wez udzial"; po uplywie czasu losuje zwyciezcow i PINGUJE ich na kanale.
     - konkursy sa w bazie, wiec przezywaja restart bota.
  /roll konkurs [id] [ilosc]
     - dolosowuje kolejna osobe (spoza dotychczasowych zwyciezcow). Bez "id" bierze ostatni zakonczony konkurs na kanale.

LICENCJE - WYBOR MODA
  - Panel (/panel) ma teraz liste wyboru modow zamiast przycisku. Nowe mody dopisujesz w src/mods.js (jeden wpis = jeden mod).
  - /licencja ma opcjonalny parametr "mod" (domyslnie AutoRynek). Stare licencje bez tego pola traktowane sa jako AutoRynek.


=== NOWE FUNKCJE (v6) ===
CENNIK / ZAKUP (/cennik)
  - Panel z lista wyboru moda (jak panel licencji). Po wybraniu AutoRynek gracz widzi (tylko on) oferte:
    1 tydzien 10 zl, 1 miesiac 30 zl, 3 miesiace 60 zl, Lifetime 100 zl; addon Reset HWID 5 zl; platnosci: BLIK, PayPal, Paysafecard (+10 zl); tylko MC 1.21.11.
  - Przycisk [ZAKUP] tworzy ticket w kategorii TICKET_CATEGORY_ZAKUP. Przycisk [Co to Reset HWID?] tlumaczy addon.
  - Ceny i teksty edytujesz w src/shop.js (obiekt OFFERS).

RESET HWID
  /resethwid kod:XXXX-XXXX-XXXX-XXXX   (albo przycisk [Resetuj HWID] na wiadomosci licencji dla administracji)
  - kod zostaje odpiety od komputera; STARY komputer zostaje zablokowany dla tego kodu (nie da sie go znow przypiac),
    a kod mozna aktywowac na nowym komputerze. Mod sprawdza licencje co jakis czas, wiec stary komputer przestanie dzialac.

MEDIA - TICKETY
  - Kazde podanie = osobny kanal w kategorii MEDIA_CATEGORY_ID (widza go tylko administracja / TICKET_STAFF_ROLE_ID / ADMIN_IDS).
  - Akceptuj -> ranga + PV + kanal sie usuwa. Odrzuc -> PV + cooldown + kanal sie usuwa.
  - MEDIA_REVIEW_CHANNEL_ID nie jest juz uzywane - zastap go MEDIA_CATEGORY_ID.

KONKURSY
  /konkurs_wylacz [id] [losuj]  - anuluje trwajacy konkurs (bez losowania); z losuj:True konczy go od razu i losuje zwyciezcow.

GRAFIKA: przy starcie bot loguje, czy znalazl assets/kot.png. Jesli grafika sie nie laduje, a w logach jest 'brak' - folder assets/ nie trafil na serwer.


=== NOWE FUNKCJE (v7) ===
NAPRAWA: odrzucanie podan Media ("Invalid string length") - etykieta pola powodu miala 48 znakow, a limit Discorda to 45.
MEDIA: nowe pytanie 3/4 - platforma (przyciski TikTok / YouTube). Nazwa konta jest pytana juz pod wybrana platforme; podanie pokazuje platforme.
CENNIK: przycisk "Co to?" jest teraz PO PRAWEJ stronie linii Reset HWID (komponenty V2); Reset HWID kosztuje 5 zl.
ANTYREKLAMA: link do innego serwera Discord -> wiadomosc usunieta, mute 30 min, komunikat na kanale (znika po 30 s). Wylaczenie: ANTI_INVITE=0.
  Zwolnieni: Administrator / Zarzadzanie wiadomosciami, ADMIN_IDS, TICKET_STAFF_ROLE_ID, ANTI_INVITE_EXEMPT_ROLE_IDS.
BOOSTY: embed "Dziekujemy za boosta!" + reakcja 💜 (wlacz w Ustawieniach serwera -> Wiadomosci systemowe powiadomienia o boostach).
  BOOST_ROLE_ID - ranga dla boosterow (nadawana/zabierana automatycznie).
/przedluz_wszystkie dni:<N> [mod]  - przedluza KAZDA aktywna licencje (nie uniewazniona, nie wygasla; permanentne pomijane). Z potwierdzeniem.


=== NOWE FUNKCJE (v8) ===
PANELE JAKO WIADOMOSC BOTA: /cennik, /panel, /instalacja, /zgloszenia, /media, /weryfikacja wysylaja panel jako zwykla wiadomosc bota
  (bez naglowka "X uzyl /komenda"); Ty dostajesz tylko prywatne potwierdzenie. /roll konkurs tez publikuje wynik jako wiadomosc bota.
/reset cooldown gracz:@nick - zdejmuje blokade ponownego podania na Media (po odrzuceniu).
COOLDOWN po odrzuceniu: domyslnie 3 dni (MEDIA_COOLDOWN_DAYS; jesli masz tam wpisane 7 w .env - zmien).
BLOKADA ZDJEC I GIF-OW: IMAGE_CHANNEL_IDS = kanaly, na ktorych wolno wysylac zdjecia/GIF-y (zalaczniki + linki tenor/giphy/imgur...).
  Reszta kanalow: wiadomosc usuwana + krotki komunikat. Wyjatki: tickety, boosterzy, BOOST_ROLE_ID, MEDIA_ROLE_ID, TICKET_STAFF_ROLE_ID,
  ADMIN_IDS, Administrator/Zarzadzanie wiadomosciami oraz role z IMAGE_ALLOWED_ROLE_IDS. Puste IMAGE_CHANNEL_IDS = funkcja wylaczona.
  Dodaj tez kanaly, gdzie obrazki sa potrzebne (np. propozycje, legitcheck).


=== NOWE FUNKCJE (v9) ===
/regulamin [kanal]  - wysyla regulamin modow i licencji jako 7 wiadomosci bota (embedy) na kanal. Tekst edytujesz w src/regulamin-tekst.js.
  Zmienne: REGULAMIN_SPRZEDAWCA (dane sprzedawcy w §1), REGULAMIN_DATA (data obowiazywania; puste = dzisiaj).


=== NOWE KOMENDY (v10) ===
/zaproponuj_zamkniecie [powod]  - (personel/admin, w tickecie) bot pyta autora zgloszenia przyciskami [Zamknij] / [Zostaw otwarte].
  [Zamknij] dziala jak zwykle zamkniecie ticketu (gracz usuniety z kanalu, kanal do kategorii "Usuniete").
/usun_licencje gracz:@nick [mod]  - (admin) unieważnia i usuwa licencję gracza po jego koncie Discord - NIE potrzeba kodu.
  Jesli gracz ma kilka licencji, podaj mod. Rekord zostaje w bazie jako unieważniony (historia).
/odrzuc_podanie gracz:@nick [powod]  - (admin) odrzuca oczekujące podanie na Media bez klikania przycisku (to samo co [Odrzuć]:
  PV do gracza, cooldown, kanal podania sie usuwa). Przycisk [Odrzuć] nadal dziala.
/licencja - BEZ ZMIAN (wersje modow dodamy pozniej).


=== UPRAWNIENIA LICENCJI (v11) ===
/licencja, /resethwid, /usun_licencje oraz przyciski [Uniewaznij licencje] i [Resetuj HWID] dzialaja TYLKO dla osob z ranga LICENSE_ROLE_ID
(albo z ID wpisanym w LICENSE_USER_IDS). Wlasciciel serwera jest ZAWSZE wykluczony. Przedluzanie i reszta komend: bez zmian (ADMIN_IDS / Zarzadzanie serwerem).

=== v12 ===
Licencje (/licencja, /resethwid, /usun_licencje, przyciski Uniewaznij i Resetuj HWID): TYLKO wlasciciel serwera LUB osoba z ranga LICENSE_ROLE_ID (albo ID z LICENSE_USER_IDS).
Cooldown po odrzuceniu podania na Media: 3 dni (MEDIA_COOLDOWN_DAYS=3).

=== v13 ===
KANAL ZE ZDJECIAMI (PHOTO_CHANNEL_ID): kazda wiadomosc gracza jest usuwana; zdjecie/GIF (zalacznik) bot wysyla ponownie w embedzie, reszta (tekst, pliki) tylko znika.

=== v13b ===
Przycisk [Przedluz licencje] (i okienko z czasem) wymaga teraz tej samej rangi co Uniewaznij/Resetuj HWID: wlasciciel serwera, LICENSE_ROLE_ID lub LICENSE_USER_IDS.

=== v13c ===
/przedluz_wszystkie (i jego przyciski potwierdzenia) dziala teraz TYLKO dla: wlasciciela serwera, osob z ranga LICENSE_ROLE_ID lub ID z LICENSE_USER_IDS
(tak samo jak /licencja, /resethwid, /usun_licencje i przyciski Przedluz / Uniewaznij / Resetuj HWID).


=== PLAYERHIGHLIGHT (nowy mod) ===
- Dodany do src/mods.js (lista wyboru w panelu licencji, /licencja, /resethwid itd.), src/api.js i src/shop.js (/cennik).
- Cennik: Na zawsze (Lifetime) 10,00 zl; addon Reset HWID 3,00 zl; platnosci jak w AutoRynek.
- /licencja gracz:@ jednostka:Permanentna mod:PlayerHighlight  -> kod dziala TYLKO w PlayerHighlight (inne mody dostaja wrong_mod).
- Plik moda: wrzuc playerhighlight-1.0.0.jar do folderu mod/ (nazwa musi zaczynac sie od "playerhighlight") - bot dolaczy go do instrukcji.
- Kanal administracji dla licencji PlayerHighlight: PLAYERHIGHLIGHT_LICENSE_CHANNEL_ID w .env (opcjonalny; puste = brak kopii dla administracji).
- Naprawiono przycisk "Jak zainstalowac moda" (panel:help) - wczesniej wywalal blad (niezdefiniowane modId).
- Po aktualizacji zrestartuj bota.


=== PANEL POBIERANIA MODOW (/pobierz) ===
- /pobierz (admin) wysyla na kanal, na ktorym uzyjesz komendy, panel z lista modow. Stworz nowy kanal i uzyj tam komendy.
- Gracz wybiera moda -> bot sprawdza licencje -> gracz wybiera wersje Minecrafta -> dostaje plik .jar + krotka instrukcje (widzi tylko on).
- Licencja musi byc AKTYWNA (nieuniewazniona i niewygasla) i dotyczyc WYBRANEGO moda:
    * ma tylko AutoRynek, wybiera BotyLuma -> "Nie masz aktywnej licencji na BotyLuma. Aktywna licencje masz tylko na: AutoRynek."
    * licencja wygasla -> osobny komunikat; brak licencji -> prosba o kontakt w zgloszeniu.
  Licencja jest sprawdzana jeszcze raz w chwili wysylania pliku (gdy w miedzyczasie wygasnie / zostanie uniewazniona - plik nie pojdzie).
- Pliki wrzucasz do folderu mod/ wg nazw z mod/JAK-NAZYWAC-PLIKI.txt (autorynek-1.11.0-mc1.21.4.jar itd.). Lista wersji budowana jest z plikow.
- LICENCJA NIE ZALEZY OD WERSJI MINECRAFTA: serwer dostaje tylko kod, HWID i id moda (nie wersje MC), wiec ten sam kod dziala na 1.21.1, 1.21.10 itd.
  Warunek: kazda wersja moda ma TEN SAM License.java (ten sam SERVER_URL, PUBLIC_KEY_B64, id moda i sol HWID).
  Po restarcie bota odswiez komendy Discorda (pojawi sie /pobierz).

/licencja - NOWA OPCJA "wersja" (Minecraft 1.21.1 ... 1.21.11, domyslnie 1.21.11)
  - Wybiera, dla ktorej wersji bot wysle plik moda (i instrukcje) na kanal po utworzeniu licencji.
  - Sama licencja NIE jest przypisana do wersji - ten sam kod dziala na kazdej wersji Minecrafta.
  - Plik jest brany z mod/ wg nazw z mod/JAK-NAZYWAC-PLIKI.txt. Brak pliku dla wybranej wersji -> licencja i tak powstaje,
    a Ty dostajesz ostrzezenie z lista wersji, ktore sa dostepne dla tego moda.


=== LEAFBOT (nowy mod z licencja) ===
- LeafBot dodany do src/mods.js (lista wyboru w /licencja, /panel, /pobierz, /resethwid, /usun_licencje, /przedluz_wszystkie) i do /cennik (src/shop.js).
  CENY LEAFBOT W src/shop.js SA PRZYKLADOWE (skopiowane z AutoRynek) - ustaw swoje.
- Licencja dziala tak samo jak w pozostalych modach: ten sam serwer (SERVER_URL) i ten sam klucz publiczny co PlayerHighlight/AutoRynek,
  kod przypinany do komputera (HWID), Reset HWID, wygasanie, uniewaznianie. Kod innego moda w LeafBot = "ten kod jest do innego moda".
  Licencja LeafBot NIE jest przypisana do wersji Minecrafta.
- /licencja gracz:@nick jednostka:Dni ilosc:30 mod:LeafBot
- W GRZE: klawisz J -> okno "LeafBot - licencja" (wklej kod, Aktywuj) albo komenda /leafbot licencja XXXX-XXXX-XXXX-XXXX.
  Po aktywacji J otwiera normalne GUI LeafBota. Bez waznej licencji bota nie da sie uruchomic, a gdy licencja wygasnie/zostanie
  uniewazniona w trakcie gry - bot sam sie zatrzymuje. Kod zapisuje sie w config/leafbot/license.key.
- Plik moda: mod/leafbot-2.0.0-mc1.21.11.jar (juz wrzucony; stary leafbot-1.0.0 trzeba usunac z folderu mods - inaczej gra sie nie wlaczy).
- Kanal administracji dla licencji LeafBot: LEAFBOT_LICENSE_CHANNEL_ID w .env (opcjonalny).
- Po aktualizacji zrestartuj bota (odswiezy liste modow w komendach).
