'use strict';
// Ruletka – imprezowa gra w kategorie (polska wariacja na temat Puffer Party z krillion.io, w scenerii rosyjskiej ruletki).
// Przeglądarka, która zakłada pokój (host), trzyma cały stan gry i rozsyła go graczom przez WebRTC (PeerJS).
// Serwera gry nie ma, więc całość działa jako statyczna strona, np. na GitHub Pages.

// Reguły i czasy przepisane z kodu krilliona (DEFAULT_SETTINGS, zakresy ustawień, COUNTDOWN_MS, POP_FREEZE_MS, CATEGORY_SWAP_MS).
const LONT = { min: 10000, max: 30000 };  // ukryty lont jednej kategorii
const ODLICZANIE = 3000;        // odliczanie przed pierwszą kategorią
const ZAMROZENIE = 1500;        // przerwa po wybuchu, zanim ruszy następna tura
const ZMIANA_KATEGORII = 1300;  // przerwa po zaliczeniu kategorii
// W każdej turze kurek odciąga się od zera do 5 stopni. Progi w sekundach tury jak w krillionie, każdy przesunięty losowo o −0,25…+0,3 s.
const PROGI_POMPY = [1.2, 2.5, 3.9, 5.4, 7.1];
// Tyle dobrych odpowiedzi zalicza kategorię bez wybuchu. W krillionie próg przysyła serwer (w ich pokazie 5, 8, 13 i 17),
// więc losujemy go z tego zakresu.
const PROG_ZALICZENIA = [5, 17];
const USTAWIENIA = { zycia: 2, minTura: 8, miejsca: 6, maxZycia: 5, pasek: 600, boty: 2, publiczny: false, zamkniety: false };
const ZAKRESY = { zycia: [1, 10, 1], minTura: [3, 15, 1], miejsca: [2, 16, 1], maxZycia: [1, 10, 1], pasek: [50, 5000, 50], boty: [1, 3, 1] };
const PAMIEC_PYTAN = 300;  // tyle ostatnich kategorii pamięta każdy gracz
// Kopia na localhost (testy, chaos.js, praca nad grą) ma osobną listę pokoi i osobne nazwy pokoi na serwerze PeerJS i w przekaźniku:
// jej pokoje nie pokażą się prawdziwym graczom ani nie zajmą kodu prawdziwego pokoju.
const LOKALNIE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
// wydaj.js wpisuje tu czas i skrót wydania. Host wpuszcza tylko gości z tą samą wersją: po aktualizacji strony stary host
// z nowymi gośćmi (albo odwrotnie) mówiliby różnymi wersjami protokołu, a kontrola uczciwości brałaby różnice za oszustwo.
const WERSJA = '202610252301-70e4755b';
const PREFIKS = LOKALNIE ? 'ruletka-pl-test-' : 'ruletka-pl-';
// Publiczna tablica ogłoszeń pokoi: temat na ntfy.sh (darmowe, bez konta, z CORS). Ogłaszają się tylko pokoje publiczne.
const TABLICA = 'https://ntfy.sh/ruletka-pl-pokoje-' + (LOKALNIE ? 'test' : 'v1');
const NA_POWROT = 30000;  // tyle host czeka na gracza, któremu zerwało połączenie
const LITERY = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const AWATARY = ['😨', '😰', '😱', '🤕', '😵', '😶', '😬', '🥴', '😓', '😖', '🫥', '🥶'];
// Jak w krillionie: kolejne postacie odblokowuje seria dni z grą.
const SPECJALNE = [{ av: '🤡', dni: 3 }, { av: '👹', dni: 7 }, { av: '👻', dni: 14 }, { av: '💀', dni: 30 }];
const WSZYSTKIE_AWATARY = [...AWATARY, ...SPECJALNE.map(s => s.av)];
const REAKCJE = ['😂', '👏', '😱', '🔥', '🤯', '💀'];
const BOTY = ['Zenek', 'Halina', 'Mietek', 'Grażyna', 'Bogdan', 'Krysia', 'Stefan', 'Jadzia', 'Tadek', 'Wiesia', 'Rysiek', 'Basia',
  'Józek', 'Danka', 'Heniek', 'Zośka', 'Marian', 'Bożena', 'Waldek', 'Teresa', 'Edek', 'Jola'];  // więcej niż 15 botów, żeby imiona się nie powtarzały
// Poziomy botów: jak często sięgają po rzadkie odpowiedzi, jak często się mylą albo zawieszają i jak szybko piszą.
const POZIOMY_BOTOW = [
  { nazwa: 'łatwe', wagi: { p: 10, t: 2, s: 2, r: 0.4, d: 0.1, k: 0 }, blad: 0.2, tempo: 1.35 },
  { nazwa: 'średnie', wagi: { p: 8, t: 2, s: 5, r: 2, d: 0.7, k: 0.2 }, blad: 0.11, tempo: 1 },
  { nazwa: 'trudne', wagi: { p: 3, t: 1, s: 5, r: 4, d: 2, k: 0.8 }, blad: 0.05, tempo: 0.7 },
];
const poziomBotow = () => POZIOMY_BOTOW[G.ust.boty - 1] ?? POZIOMY_BOTOW[1];

const $ = s => document.querySelector(s);
const losuj = (a, b) => a + Math.random() * (b - a);
const wybierz = t => t[Math.floor(Math.random() * t.length)];
const suma = seg => seg.reduce((s, x) => s + x.ile, 0);
function tasuj(t) {
  for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; }
  return t;
}
// Tworzy element bez innerHTML, więc imiona i odpowiedzi od innych graczy nie wstrzykną kodu.
const czyste = dzieci => [dzieci].flat(Infinity).filter(d => d != null && d !== false);  // null z warunku `x && [...]` to pusta lista
function h(tag, wlasnosci = {}, ...dzieci) {
  const el = Object.assign(document.createElement(tag), wlasnosci);
  el.append(...czyste(dzieci));
  return el;
}
// Chwilowy element efektu znika po animacji, a najpóźniej po `ms`: w karcie w tle animationend potrafi nie przyjść.
function zniknie(el, ms = 4000) {
  el.addEventListener('animationend', () => el.remove());
  setTimeout(() => el.remove(), ms);
  return el;
}
const magazyn = sklep => ({
  daj(k, d = null) { try { return sklep().getItem('ruletka.' + k) ?? d; } catch { return d; } },
  zapisz(k, v) { try { sklep().setItem('ruletka.' + k, v); } catch {} },
});
const pamiec = magazyn(() => localStorage);
const sesja = magazyn(() => sessionStorage);
// Token karty: po przeładowaniu strony gracz wraca na to samo miejsce w pokoju.
// tajny token karty (powrót na swoje miejsce po zerwaniu): 16 znaków z crypto, nie z Math.random
const TOKEN = /^[a-z0-9]{8,24}$/.test(sesja.daj('token') ?? '') ? sesja.daj('token') : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => (b % 36).toString(36)).join('');
sesja.zapisz('token', TOKEN);
// Identyfikator tej przeglądarki (wspólny dla kart): ban hosta działa też na nową kartę tego samego gracza.
const URZADZENIE = (() => {
  let u = pamiec.daj('urzadzenie');
  if (!/^[a-z0-9]{16,24}$/.test(u ?? '')) { u = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => (b % 36).toString(36)).join(''); pamiec.zapisz('urzadzenie', u); }
  return u;
})();

// ---------- dźwięk: nagrania z Freesound (CC0) w zasoby/dzwieki, drobne piknięcia z syntezatora ----------
let ac = null, efekty = null;
// Głośność muzyki (pętle piwnicy) i efektów 0–1, z suwaków pod ikoną dźwięku. Obie na zero to cisza: nagrania się nie pobierają.
// Dawny przycisk wyciszenia zapisywał 'cisza' = '1': taki gracz zaczyna z suwakami na zero.
const glosnoscZPamieci = (k, d) => { const v = Number(pamiec.daj(k, 'x')); return v >= 0 && v <= 1 ? v : d; };
const glosnosc = { muzyka: glosnoscZPamieci('muzyka', pamiec.daj('cisza') === '1' ? 0 : 1), efekty: glosnoscZPamieci('efekty', pamiec.daj('cisza') === '1' ? 0 : 1) };
let cisza = !glosnosc.muzyka && !glosnosc.efekty;
// pliki (pół megabajta) pobierają się po starcie strony, żeby nie zabierały łącza pytaniom i obrazom ekranu startowego,
// a dekodują po pierwszym kliknięciu (wcześniej przeglądarka nie da AudioContext)
const PLIKI = ['strzal', 'zapadka', 'kurek', 'beben', 'magnetofon', 'tlo', 'kapanie'];
let pobrane = null;
const pobierzDzwieki = () => (pobrane ??= Object.fromEntries(PLIKI.map(n => [n, fetch(`zasoby/dzwieki/${n}.mp3`).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null)])));
const NAGRANIA = {}, dekodowane = {};
function odblokujDzwiek() {
  if (cisza) return;  // wyciszona gra nie pobiera nagrań; przycisk dźwięku woła to jeszcze raz
  try {
    ac ??= new AudioContext(); ac.resume();
    if (!efekty) { efekty = ac.createGain(); efekty.gain.value = glosnosc.efekty; efekty.connect(ac.destination); }
    pobierzDzwieki();
    for (const n of PLIKI) dekodowane[n] ??= pobrane[n].then(b => b && ac.decodeAudioData(b)).then(buf => { if (buf) NAGRANIA[n] = buf; tloDzwiekowe(); }).catch(() => {});
  } catch {}
}
// Odtwarza nagranie; false, jeśli jeszcze go nie ma (wtedy wołający gra zastępczy dźwięk z syntezatora).
function graj(n, mnoznik = 1, cel = efekty) {
  if (!ac || !NAGRANIA[n]) return false;
  if (cisza) return true;
  const z = ac.createBufferSource(), g = ac.createGain();
  z.buffer = NAGRANIA[n]; g.gain.value = mnoznik;
  z.connect(g).connect(cel); z.start();
  return true;
}
function ton(f, dl = 0.1, typ = 'square', glosnosc = 0.05, za = 0) {
  if (cisza || !ac) return;
  const t = ac.currentTime + za, o = ac.createOscillator(), g = ac.createGain();
  o.type = typ; o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(glosnosc, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dl);
  o.connect(g).connect(efekty); o.start(t); o.stop(t + dl);
}
function slizg(od, doCz, dl, typ = 'sine', glosnosc = 0.08) {
  if (cisza || !ac) return;
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.type = typ; o.frequency.setValueAtTime(od, t); o.frequency.exponentialRampToValueAtTime(doCz, t + dl);
  g.gain.setValueAtTime(glosnosc, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dl);
  o.connect(g).connect(efekty); o.start(t); o.stop(t + dl);
}
// Wibracja na telefonie (twoja tura, wybuch u ciebie); przeglądarki bez niej po prostu nic nie robią.
const wibruj = wzor => { try { if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.(wzor); } catch {} };
const melodia = (nuty, typ = 'triangle') => nuty.forEach((f, i) => ton(f, 0.16, typ, 0.07, i * 0.07));
const MELODIE = { p: [523], t: [523, 415], s: [523, 659], r: [523, 659, 784], d: [523, 659, 784, 988], k: [523, 659, 784, 1047, 1319] };
// Tło dźwiękowe piwnicy (muzyka): niski pomruk i kapiąca woda w pętlach, głośność z suwaka „Muzyka”.
let piwnica = null;
const petle = new Set();
function tloDzwiekowe() {
  if (!ac) return;
  if (!piwnica) { piwnica = ac.createGain(); piwnica.gain.value = glosnosc.muzyka; piwnica.connect(ac.destination); }
  for (const [n, glosnosc] of [['tlo', 0.3], ['kapanie', 0.55]]) {
    if (petle.has(n) || !NAGRANIA[n]) continue;
    petle.add(n);
    const z = ac.createBufferSource(), g = ac.createGain();
    z.buffer = NAGRANIA[n]; z.loop = true; g.gain.value = glosnosc;
    z.connect(g).connect(piwnica); z.start();
  }
}

// Szur rewolweru przesuwanego po metalowym blacie: szum przez filtr pasmowy, którego środek opada.
function szur(glosnosc = 0.045) {
  if (cisza || !ac) return;
  const t = ac.currentTime, dl = 0.26, n = Math.floor(ac.sampleRate * dl), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const z = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  f.type = 'bandpass'; f.Q.value = 1.6;
  f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(650, t + dl);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(glosnosc, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + dl);
  z.buffer = buf; z.connect(f).connect(g).connect(efekty); z.start(t); z.stop(t + dl);
}

// Kartka z nową kategorią plaśnięta o blat: krótki szum przez filtr dolnoprzepustowy.
function plask(mnoznik = 0.14) {
  if (cisza || !ac) return;
  const n = Math.floor(ac.sampleRate * 0.09), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 4;
  const z = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  f.type = 'lowpass'; f.frequency.value = 1800; g.gain.value = mnoznik;
  z.buffer = buf; z.connect(f).connect(g).connect(efekty); z.start();
}

// Gong z głośnika porywacza przy każdej nowej kategorii: dwa dzwonki „ding-dong” jak zapowiedź przez megafon (pasmo taniego
// głośnika wokół 1,4 kHz). Głośny i wysoki, żeby było go słychać nawet zaraz po huku wystrzału; cichy plask kartki ginął.
function gong() {
  if (cisza || !ac) return;
  const t0 = ac.currentTime + 0.05, glosnik = ac.createBiquadFilter();
  glosnik.type = 'bandpass'; glosnik.frequency.value = 1400; glosnik.Q.value = 0.6;
  glosnik.connect(efekty);
  for (const [f, za] of [[659, 0], [523, 0.42]]) {
    // dzwon: ton podstawowy i dwa nieharmoniczne alikwoty, które gasną szybciej
    for (const [mn, gl, dl] of [[1, 0.55, 1.5], [2.76, 0.16, 0.7], [5.4, 0.07, 0.3]]) {
      const t = t0 + za, o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = f * mn;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gl, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dl);
      o.connect(g).connect(glosnik); o.start(t); o.stop(t + dl);
    }
  }
}

// Wystrzał: nagranie rewolweru i niskie uderzenie odbite od betonu; bez nagrania sam syntezator.
function strzal() {
  ton(90, 0.6, 'sine', 0.3); ton(55, 0.8, 'triangle', 0.22);
  if (graj('strzal')) return;
  ton(1400, 0.035, 'square', 0.14);
  if (cisza || !ac) return;
  const n = ac.sampleRate * 0.5, buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
  const zr = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  f.type = 'lowpass'; f.frequency.value = 1200; g.gain.value = 0.6;
  zr.buffer = buf; zr.connect(f).connect(g).connect(efekty); zr.start();
}

// ---------- host: stan gry i zasady ----------
let G = null;        // stan gry, istnieje tylko u hosta
let peer = null;     // obiekt PeerJS
let doHosta = null;  // połączenie gościa z hostem
let ja = null;       // moje id w pokoju

const gracz = id => G.gracze.find(g => g.id === id);

function nowyPokoj(online, publiczny) {
  G = { faza: 'lobby', fazaOd: Date.now(), nr: 0, gracze: [], online, kod: null, ust: { ...USTAWIENIA, publiczny: online && publiczny }, nrKat: 0,
        trzyma: null, kat: null, uzyte: new Set(), ostatnie: {}, lont: 0, odTury: 0, odPytania: 0, progi: PROGI_POMPY, prog: 0, zaliczone: 0,
        grane: new Set(), zwyciezca: null, botCzas: 0, botNr: 0, czat: [], ogloszenie: { czas: 0, klucz: '' }, bany: new Set(), banyU: new Set(),
        zob: null, odkr: null, sekret: online ? losowySekret() : null };
  uruchomZegar(petlaHosta);
}

// Zegar hosta tyka w osobnym wątku (tik.js): w karcie schowanej w tle przeglądarka spowalnia setTimeout do raz na sekundę,
// a po kilku minutach nawet do raz na minutę, za to wiadomości od workera dochodzą dalej co 100 ms.
// Zaplanowany krok rusza z setTimeout albo z najbliższego tyknięcia, co pierwsze nastąpi.
const zadania = new Set();
function zaplanuj(ms, fn) {
  const z = { czas: Date.now() + ms, fn };
  zadania.add(z);
  setTimeout(() => wykonaj(z), ms);
}
function wykonaj(z) { if (zadania.delete(z) && G) z.fn(); }
function uruchomZegar(fn) {
  const tyk = () => {
    if (!G) return;  // host właśnie zamyka pokój
    const t = Date.now();
    try { for (const z of [...zadania]) if (z.czas <= t) wykonaj(z); fn(); } catch (e) { zgloszBlad(e); }
  };
  try {
    const w = new Worker(Zaufane.createScriptURL('tik.js'));
    w.onmessage = tyk;
    w.onerror = () => { w.terminate(); setInterval(tyk, 100); };
  } catch { setInterval(tyk, 100); }
}
// Każda zmiana fazy unieważnia zaplanowane wcześniej kroki (pozniej sprawdza numer fazy).
function zmienFaze(f) { G.faza = f; G.fazaOd = Date.now(); G.nr++; }
function pozniej(ms, fn) { const nr = G.nr; zaplanuj(ms, () => G.nr === nr && fn()); }

function widok() {
  const t = Date.now();
  return {
    t: 'stan', kod: G.kod, online: G.online, faza: G.faza, odFazy: t - G.fazaOd, ust: G.ust, nrKat: G.nrKat,
    gracze: G.gracze.map(g => ({ id: g.id, imie: g.imie, av: g.av, zycia: g.zycia, seg: g.seg, zywy: g.zywy, widz: g.widz, bot: g.bot, offline: !!g.offlineOd })),
    trzyma: G.trzyma, q: G.kat?.q ?? null, ostatnie: G.ostatnie,
    odTury: t - G.odTury, odPytania: t - G.odPytania, progi: G.progi, zwyciezca: G.zwyciezca,
    pods: G.faza === 'koniec' ? G.pods : null, zob: G.zob, odkr: G.odkr, pauza: !!G.pauza, zaliczone: G.zaliczone,
  };
}
function rozeslij(m) {
  for (const g of G.gracze) if (g.conn?.open) g.conn.send(m);
  odbierz(m);
  zapiszHosta();
}
const rozeslijStan = () => rozeslij(widok());

// Wiadomości od graczy (także od samego hosta). Wszystko, co przychodzi z sieci, traktujemy jak niezaufane.
// Limity od jednego gracza chronią przed zasypaniem pokoju (np. skryptem sprawdzającym cały słownik albo spamem czatu).
function zaCzesto(g, rodzaj, ms) {
  const t = Date.now();
  g.limity ??= {};
  if (t - (g.limity[rodzaj] || 0) < ms) return true;
  g.limity[rodzaj] = t;
  return false;
}
function doHostaOd(id, m, conn) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return;
  // jedno połączenie to jedna postać: kolejne „wejdź” z tego samego połączenia nie dopiszą graczy
  if (m.t === 'wejdz') { if (conn && !conn.graczId && !conn.wchodzi) { conn.wchodzi = true; sprawdzWejscie(m, conn); } return; }
  const g = id && gracz(id);
  if (!g) return;
  if (m.t === 'odp') { if (!zaCzesto(g, 'odp', 250)) odpowiedz(id, tekst(m.tekst, 60).trim()); }
  else if (m.t === 'pisze') { if (id === G.trzyma && G.faza === 'gra' && !zaCzesto(g, 'pisze', 40)) rozeslij({ t: 'pisze', id, tekst: tekst(m.tekst, 60) }); }
  else if (m.t === 'czat') {
    const wiad = tekst(m.tekst, 160).trim();
    if (wiad && !zaCzesto(g, 'czat', 700)) wpisNaCzat({ imie: g.imie, tekst: wiad });
  }
  else if (m.t === 'reakcja') reaguj(id, m.e);
}

// Szybka reakcja nad postacią; najwyżej jedna na sekundę od gracza, tylko z listy.
function reaguj(id, e) {
  const g = gracz(id), t = Date.now();
  if (!g || !REAKCJE.includes(e) || t - (g.reakcjaOd || 0) < 1000) return;
  g.reakcjaOd = t;
  rozeslij({ t: 'reakcja', id, e });
}
// Boty też kibicują: czasem reagują na rzadką odpowiedź albo wybuch.
function botyReaguja(emoji, szansa, poza) {
  for (const b of G.gracze.filter(g => g.bot && g.id !== poza)) if (Math.random() < szansa) zaplanuj(losuj(300, 1500), () => G.gracze.includes(b) && reaguj(b.id, wybierz(emoji)));
}

// Host może wyrzucić gracza; jego token zostaje zablokowany do końca życia pokoju.
function wyrzuc(id) {
  const g = gracz(id);
  if (!g || id === ja) return;
  if (!g.bot) { G.bany.add(g.sekret ?? id); if (g.u) G.banyU.add(g.u); g.conn?.send({ t: 'wyrzucony' }); }
  const c = g.conn;
  usunGracza(id, true);
  setTimeout(() => c?.close(), 300);
}

// Podpis gościa (jeśli ma sekret z linku) musi się zgadzać z odciskami kluczy tego połączenia; host zawsze dokłada własny.
async function sprawdzWejscie(m, conn) {
  if (m.w !== WERSJA) {
    conn.send({ t: 'innaWersja', w: WERSJA });
    setTimeout(() => conn.close(), 300);
    // wersje mają na początku czas wydania, więc da się powiedzieć, kto ma starszą
    if (typeof m.w === 'string' && m.w > WERSJA) komunikat('Ktoś z nowszą wersją gry nie mógł wejść. Odśwież stronę: pokój i gracze zostaną.');
    return;
  }
  const sekret = G?.sekret;
  if (typeof m.dowod === 'string') {
    const wzor = await podpis(sekret, 'gosc', conn, true).catch(() => null);
    if (!wzor || m.dowod !== wzor) { conn.send({ t: 'zlyPodpis' }); setTimeout(() => conn.close(), 300); return; }
  }
  conn.dowodHosta = await podpis(sekret, 'host', conn, true).catch(() => null);
  if (G && conn.open !== false) wejscie(m, conn);
}

// Gość przedstawia się tajnym tokenem swojej karty; ten sam token po zerwaniu wraca na swoje miejsce. Token zna tylko gość
// i host: inni gracze widzą losowe id, które nadaje host (dawniej id = 'g' + token szło w stanie do wszystkich, więc każdy mógł
// przedstawić się cudzym tokenem i przejąć jego miejsce, życia i turę).
const noweId = () => 'g' + Array.from(crypto.getRandomValues(new Uint8Array(10)), b => (b % 36).toString(36)).join('');
function wejscie(m, conn) {
  const token = tekst(m.token, 40).replace(/[^a-z0-9]/gi, '').slice(0, 24);
  if (!conn || token.length < 8) return;
  const g = G.gracze.find(x => !x.bot && x.sekret === token), u = typeof m.u === 'string' && /^[a-z0-9]{16,24}$/.test(m.u) ? m.u : null;
  if (G.bany.has(token) || (g && G.bany.has(g.id)) || (u && G.banyU.has(u))) { conn.send({ t: 'wyrzucony' }); setTimeout(() => conn.close(), 300); return; }
  // zamknięty pokój wpuszcza tylko tych, którzy już w nim są (powrót po zerwaniu)
  if (!g && G.ust.zamkniety) { conn.send({ t: 'zamkniety' }); setTimeout(() => conn.close(), 300); return; }
  const byly = czysteKlucze(m.byly);
  if (!g) {
    let id;
    do id = noweId(); while (gracz(id));
    conn.graczId = id;
    nieprzedstawione.delete(conn);
    return dodajGracza(id, m.imie, m.av, conn, false, byly, u, token);
  }
  conn.graczId = g.id;
  nieprzedstawione.delete(conn);
  if (g.conn && g.conn !== conn) g.conn.close();
  g.conn = conn;
  conn.send({ t: 'witaj', id: g.id, dowod: conn.dowodHosta ?? undefined });
  g.offlineOd = 0;
  g.byly = byly;
  conn.send({ t: 'czatHistoria', wpisy: G.czat });
  wpisNaCzat({ sys: true, tekst: `${g.imie} wraca` });
  rozeslijStan();
}

function rozlaczony(conn) {
  const g = G.gracze.find(x => x.conn === conn);
  if (!g) return;
  g.conn = null;
  g.offlineOd = Date.now();
  rozeslijStan();
}

function wpisNaCzat(w) {
  G.czat = [...G.czat, w].slice(-40);
  rozeslij({ t: 'czat', ...w });
}

function dodajGracza(id, imie, av, conn, bot = false, byly = [], u = null, sekret = null) {
  if (gracz(id)) return;
  if (G.gracze.length >= G.ust.miejsca) { conn?.send({ t: 'pelno' }); return; }
  const wGrze = G.faza !== 'lobby' && G.faza !== 'koniec';
  const g = {
    id, conn, bot, zycia: G.ust.zycia, seg: [], zywy: !wGrze, widz: wGrze, offlineOd: 0, byly, u, sekret,
    imie: poprawneImie(imie) ?? 'Nieznajomy',
    av: WSZYSTKIE_AWATARY.includes(av) ? av : wybierz(AWATARY),
  };
  G.gracze.push(g);
  conn?.send({ t: 'witaj', id, dowod: conn.dowodHosta ?? undefined });
  conn?.send({ t: 'czatHistoria', wpisy: G.czat });
  if (!bot && id !== ja) wpisNaCzat({ sys: true, tekst: `${g.imie} dołącza` });
  rozeslijStan();
}

function usunGracza(id, wyrzucony = false) {
  const g = gracz(id);
  if (!g) return;
  const nast = G.trzyma === id ? nastepny(id) : null;
  G.gracze.splice(G.gracze.indexOf(g), 1);
  if (!g.bot) wpisNaCzat({ sys: true, tekst: wyrzucony ? `${g.imie} wylatuje z pokoju` : `${g.imie} wychodzi` });
  if (['odliczanie', 'gra', 'pekniecie', 'zmiana'].includes(G.faza) && G.gracze.filter(x => x.zywy).length < 2) return koniec();
  if (nast && G.faza === 'gra') return podaj(nast);
  if (nast && (G.faza === 'zmiana' || G.faza === 'odliczanie')) G.trzyma = nast;
  rozeslijStan();
}

const wPoczekalni = () => G.faza === 'lobby' || G.faza === 'koniec';
function dodajBota() {
  if (!wPoczekalni()) return;
  const wolne = BOTY.filter(n => !G.gracze.some(g => g.imie === n));
  const wolneTwarze = AWATARY.filter(a => !G.gracze.some(g => g.av === a));
  dodajGracza('bot' + ++G.botNr, wybierz(wolne.length ? wolne : BOTY), wybierz(wolneTwarze.length ? wolneTwarze : AWATARY), null, true);
}
function usunBota() {
  const b = G.gracze.findLast(g => g.bot);
  if (b && wPoczekalni()) usunGracza(b.id);
}

function ustaw(klucz, kierunek) {
  if (!wPoczekalni()) return;
  if (klucz === 'publiczny' || klucz === 'zamkniety') {
    G.ust[klucz] = G.online && !G.ust[klucz];
    if (G.ust.publiczny && klucz === 'zamkniety') oglos(G.ust.zamkniety);  // zamknięty pokój znika z listy publicznych
    if (klucz === 'publiczny' && !G.ust.publiczny) oglos(true);
    return rozeslijStan();
  }
  const [min, max, krok] = ZAKRESY[klucz];
  // jak w krillionie: serc na start nie więcej niż limit serc, miejsc nie mniej niż graczy w pokoju
  const dol = klucz === 'miejsca' ? Math.max(min, G.gracze.length) : min;
  const gora = klucz === 'zycia' ? Math.min(max, G.ust.maxZycia) : max;
  G.ust[klucz] = Math.min(gora, Math.max(dol, G.ust[klucz] + kierunek * krok));
  if (klucz === 'maxZycia') G.ust.zycia = Math.min(G.ust.zycia, G.ust.maxZycia);
  for (const g of G.gracze) g.zycia = G.ust.zycia;
  rozeslijStan();
}

function nastepny(id) {
  const n = G.gracze.length, i = G.gracze.findIndex(g => g.id === id);
  for (let k = 1; k <= n; k++) { const g = G.gracze[(i + k) % n]; if (g.zywy) return g.id; }
  return id;
}

function start() {
  if (G.gracze.length < 2 || !wPoczekalni()) return;
  for (const g of G.gracze) Object.assign(g, { zycia: G.ust.zycia, seg: [], zywy: true, widz: false, ile: 0 });
  Object.assign(G, { zwyciezca: null, kat: null, trzyma: null, nrKat: 0, ostatnie: {}, naj: null, pods: null, zob: null, odkr: null, tajne: null });
  G.trzyma = wybierz(G.gracze).id;  // już w odliczaniu wiadomo, na kim zatrzyma się zakręcony rewolwer
  zmienFaze('odliczanie');
  rozeslijStan();
  pozniej(ODLICZANIE, () => nowePytanie(G.trzyma));
}

// Kategoria, której w tym pokoju jeszcze nie było, najlepiej taka, której nie widział żaden z graczy
// (każdy przynosi listę ostatnio widzianych, jak w krillionie).
function wybierzKategorie() {
  const byly = new Set([...bylePytania(), ...G.gracze.flatMap(g => g.byly || [])]);
  const klucze = Baza.klucze(), wszystkie = klucze.map((_, i) => i);
  let wolne = wszystkie.filter(i => !G.grane.has(klucze[i]));
  if (!wolne.length) { G.grane.clear(); wolne = wszystkie; }
  const swieze = wolne.filter(i => !byly.has(klucze[i]));
  return Baza.otworz(wybierz(swieze.length ? swieze : wolne));
}

function nowePytanie(kto) {
  // podaj() rozsyła stan, zanim zobowiaz() policzy nowe zobowiązanie: stare (z poprzedniej kategorii, czasem z tym samym
  // numerem z poprzedniej rundy) nie może w nim zostać, bo gość wziąłby je za zobowiązanie nowej kategorii
  G.zob = G.odkr = G.tajne = null;
  G.kat = wybierzKategorie();
  G.grane.add(kluczPytania(G.kat.q));
  G.nrKat++;
  G.uzyte = new Set();
  G.zaliczone = 0;
  G.prog = Math.floor(losuj(PROG_ZALICZENIA[0], PROG_ZALICZENIA[1] + 1));
  G.ostatnie = {};
  G.odPytania = Date.now();
  G.lont = G.odPytania + Math.round(losuj(LONT.min, LONT.max));
  zmienFaze('gra');
  podaj(kto);
  zobowiaz();
}

// Uczciwy host: na starcie kategorii wysyła skrót SHA-256 z ukrytego czasu strzału i progu zaliczenia (z losową solą),
// a po strzale albo zaliczeniu ujawnia wartości. Goście sprawdzają skrót i to, czy strzał padł wtedy, kiedy miał.
const hex = bajty => Array.from(new Uint8Array(bajty), b => b.toString(16).padStart(2, '0')).join('');
const trescZobowiazania = o => `ruletka|${o.nrKat}|${o.lont}|${o.prog}|${o.sol}`;
const skrot = t => (crypto.subtle ? crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)).then(hex) : Promise.resolve(null));
function zobowiaz() {
  const nr = G.nrKat, q = G.kat?.q ?? null, o = { nrKat: nr, q, lont: G.lont - G.odPytania, prog: G.prog, sol: hex(crypto.getRandomValues(new Uint8Array(16))) };
  G.tajne = o;
  G.zob = null;
  skrot(trescZobowiazania(o)).then(s => { if (G.nrKat === nr && (G.kat?.q ?? null) === q && s) { G.zob = { nrKat: nr, q, skrot: s }; rozeslijStan(); } });
}
function odkryj() { if (G.tajne) G.odkr = G.tajne; }

function podaj(kto) {
  G.trzyma = kto;
  G.odTury = Date.now();
  G.progi = PROGI_POMPY.map(p => p + losuj(-0.25, 0.3));
  if (gracz(kto)?.bot) G.botCzas = Date.now() + czasBota();
  rozeslijStan();
}

// Po progu dobrych odpowiedzi kategoria jest zaliczona: nikt nie traci serca, rewolwer idzie dalej,
// a po krótkiej przerwie przychodzi nowa kategoria z nowym lontem.
function zalicz(kto) {
  odkryj();
  zmienFaze('zmiana');
  G.trzyma = kto;
  rozeslij({ t: 'fx', r: 'zaliczona' });
  rozeslijStan();
  pozniej(ZMIANA_KATEGORII, () => nowePytanie(G.trzyma));
}

function odpowiedz(id, tekst) {
  if (G.faza !== 'gra' || id !== G.trzyma || G.pauza) return;
  const odp = odpowiedzi(G.kat), i = dopasuj(G.kat, tekst);
  if (i < 0) return rozeslij({ t: 'fx', r: 'zle', powod: 'pudlo', id, tekst });
  if (G.uzyte.has(i)) return rozeslij({ t: 'fx', r: 'zle', powod: 'bylo', id, tekst: odp[i].a });
  const o = odp[i], g = gracz(id);
  G.uzyte.add(i);
  G.zaliczone++;
  G.ostatnie = { ...G.ostatnie, [id]: { a: o.a, t: o.t } };
  g.seg.push({ t: o.t, ile: POZIOMY[o.t].pkt });
  g.ile = (g.ile || 0) + 1;
  if (!G.naj || KOLEJNOSC.indexOf(o.t) > KOLEJNOSC.indexOf(G.naj.t)) G.naj = { a: o.a, t: o.t, imie: g.imie };
  // pasek jak w krillionie: pełny daje serce (nadwyżka zostaje), a przy limicie serc stoi pełny i serce przyjdzie po stracie
  let serce = false;
  if (suma(g.seg) >= G.ust.pasek && g.zycia < G.ust.maxZycia) {
    g.zycia++;
    serce = true;
    obetnij(g, suma(g.seg) - G.ust.pasek);
  }
  if (suma(g.seg) > G.ust.pasek) obetnij(g, G.ust.pasek);
  rozeslij({ t: 'fx', r: 'ok', id, a: o.a, p: o.t, serce });
  if ('dk'.includes(o.t)) botyReaguja(['🤯', '👏', '🔥'], 0.35, id);
  if (G.zaliczone >= G.prog) return zalicz(nastepny(id));
  podaj(nastepny(id));
}

// Zostawia w pasku tylko ostatnie segmenty o łącznej wartości `reszta` (nadwyżka po pełnym pasku).
function obetnij(g, reszta) {
  const nowe = [];
  for (let k = g.seg.length - 1; k >= 0 && reszta > 0; k--) {
    const ile = Math.min(g.seg[k].ile, reszta);
    nowe.unshift({ t: g.seg[k].t, ile });
    reszta -= ile;
  }
  g.seg = nowe;
}

function peka() {
  const g = gracz(G.trzyma);
  g.zycia--;
  g.zywy = g.zycia > 0;
  odkryj();
  zmienFaze('pekniecie');
  rozeslij({ t: 'fx', r: 'pek', id: g.id, odpada: !g.zywy });
  rozeslijStan();
  botyReaguja(['😂', '😱', '💀'], 0.25, g.id);
  // krillion: zwycięzca jest znany od razu, a baner pokazuje się po 1,2 s; inaczej nowa kategoria po zamrożeniu
  if (G.gracze.filter(x => x.zywy).length < 2) pozniej(1200, koniec);
  else pozniej(ZAMROZENIE, () => nowePytanie(nastepny(g.id)));
}

function koniec() {
  zmienFaze('koniec');
  const w = G.gracze.find(x => x.zywy);
  G.zwyciezca = w?.id ?? null;
  G.trzyma = null;
  G.ostatnie = {};
  const gadula = G.gracze.reduce((a, b) => ((b.ile || 0) > (a?.ile || 0) ? b : a), null);
  G.pods = { kategorie: G.nrKat, odpowiedzi: G.gracze.reduce((s, x) => s + (x.ile || 0), 0), naj: G.naj, gadula: gadula && { imie: gadula.imie, ile: gadula.ile } };
  if (w) wpisNaCzat({ sys: true, tekst: `${w.imie} przeżywa` });
  rozeslijStan();
}

// ---------- host przeżywa odświeżenie strony ----------
// Stan gry leży w sessionStorage (zostaje po przeładowaniu tej karty, znika po jej zamknięciu). Po odświeżeniu host wraca
// z tym samym kodem pokoju, goście łączą się ponownie na swoje miejsca, a zegary gry stoją przez czas przerwy.
const ZAPIS_WAZNY = 120000;
let zapisCzeka = false;
function zapiszHosta(teraz = false) {
  if (!G) return;
  if (!teraz) {  // najwyżej raz na 0,4 s, nawet gdy ktoś pisze i stan leci co chwilę
    if (!zapisCzeka) { zapisCzeka = true; setTimeout(() => { zapisCzeka = false; zapiszHosta(true); }, 400); }
    return;
  }
  const { gracze, kat, uzyte, grane, bany, banyU, ...reszta } = G;
  sesja.zapisz('host', JSON.stringify({ v: 1, zapis: Date.now(), G: {
    ...reszta, kat: kat?.q ?? null, uzyte: [...uzyte], grane: [...grane], bany: [...bany], banyU: [...banyU],
    gracze: gracze.map(({ conn, limity, ...g }) => g),
  } }));
}
function przywrocHosta() {
  // tylko odświeżenie albo powrót przyciskiem Wstecz; wejście z linku czy wpisanego adresu w tej samej karcie zaczyna od nowa
  const wejscie = performance.getEntriesByType?.('navigation')[0]?.type;
  if (wejscie !== 'reload' && wejscie !== 'back_forward') { sesja.zapisz('host', ''); return false; }
  let z;
  try { z = JSON.parse(sesja.daj('host', 'null')); } catch { return false; }
  if (!obiekt(z) || z.v !== 1 || !(Date.now() - z.zapis < ZAPIS_WAZNY) || !obiekt(z.G) || !Array.isArray(z.G.gracze)) return false;
  const d = z.G, przerwa = Math.max(0, Date.now() - z.zapis);
  ja = 'host';
  G = { ...d, kat: Baza.znajdz(d.kat), uzyte: new Set(d.uzyte), grane: new Set(d.grane),
        bany: new Set(d.bany), banyU: new Set(d.banyU), ogloszenie: { czas: 0, klucz: '' } };
  for (const k of ['fazaOd', 'lont', 'odTury', 'odPytania']) G[k] += przerwa;  // gra stała, kiedy hosta nie było
  for (const g of G.gracze) if (!g.bot && g.id !== ja) { g.conn = null; g.offlineOd = Date.now(); }
  if (gracz(G.trzyma)?.bot) G.botCzas = Date.now() + 1500;  // bot mógł być w połowie pisania
  uruchomZegar(petlaHosta);
  odbierz({ t: 'czatHistoria', wpisy: G.czat });
  wpisNaCzat({ sys: true, tekst: 'Host wraca po odświeżeniu strony' });
  if (G.faza === 'gra' && !G.kat) nowePytanie(G.trzyma);  // po aktualizacji strony tej kategorii może już nie być
  // Goście potrzebują kilku sekund, żeby wrócić; do tego czasu gra stoi, żeby nikt nie dostał kuli, będąc jeszcze offline.
  else if (G.online && G.gracze.some(g => !g.bot && g.id !== ja)) G.pauza = { od: Date.now(), do: Date.now() + 12000 };
  else dokonczFaze();
  if (G.online) otworzPokoj(G.kod);
  else rozeslijStan();
  return true;
}
function pilnujPauzy(t) {
  if (!G.pauza) return false;
  if (t < G.pauza.do && G.gracze.some(g => !g.bot && g.id !== ja && !g.conn)) return true;
  const przerwa = t - G.pauza.od;
  for (const k of ['fazaOd', 'lont', 'odTury', 'odPytania']) G[k] += przerwa;
  if (Number.isFinite(G.botCzas)) G.botCzas += przerwa;
  G.pauza = null;
  dokonczFaze();
  rozeslijStan();
  return false;
}
// Kroki zaplanowane przed odświeżeniem przepadły: faza przejściowa rusza dalej po tym, ile jej jeszcze zostało.
function dokonczFaze() {
  const reszta = ms => Math.max(0, ms - (Date.now() - G.fazaOd));
  if (G.faza === 'odliczanie' || G.faza === 'zmiana') pozniej(reszta(G.faza === 'odliczanie' ? ODLICZANIE : ZMIANA_KATEGORII), () => nowePytanie(G.trzyma));
  else if (G.faza === 'pekniecie') {
    if (G.gracze.filter(x => x.zywy).length < 2) pozniej(reszta(1200), koniec);
    else pozniej(reszta(ZAMROZENIE), () => nowePytanie(nastepny(G.trzyma)));
  }
}

// Host co kilka sekund sprawdza swoje wejście na serwer PeerJS: zerwany sygnał wznawia, zniszczony obiekt tworzy od nowa
// z tym samym kodem (zdarzenie 'disconnected' przychodzi raz, a ponowna próba potrafi się nie udać).
let naprawaPeer = { czas: 0, przerwa: 5000 };
function pilnujPeer(t) {
  if (!G.online || !G.kod || ukryjIp() || typeof Peer !== 'function' || t - naprawaPeer.czas < naprawaPeer.przerwa) return;
  naprawaPeer.czas = t;
  if (peer?.open) { naprawaPeer.przerwa = 5000; return; }
  naprawaPeer.przerwa = Math.min(60000, naprawaPeer.przerwa * 2);
  if (peer && !peer.destroyed && peer.disconnected) { try { peer.reconnect(); } catch {} }
  else if (!peer || peer.destroyed) otworzPokoj(G.kod, 6);  // proba 6: przy zajętym kodzie od razu zostaje przekaźnik
}

function petlaHosta() {
  const t = Date.now();
  pilnujPeer(t);
  for (const g of G.gracze.filter(g => g.conn && zerwane(g.conn))) { const c = g.conn; rozlaczony(c); c.close(); }
  for (const g of G.gracze.filter(g => g.offlineOd && t - g.offlineOd > NA_POWROT)) usunGracza(g.id);
  pilnujOgloszenia();
  if (pilnujPauzy(t) || G.faza !== 'gra') return;
  if (t >= Math.max(G.lont, G.odTury + G.ust.minTura * 1000)) return peka();
  const g = gracz(G.trzyma);
  if (g?.bot && t >= G.botCzas) ruchBota(g);
}

function czasBota() {
  const wolnych = odpowiedzi(G.kat).length - G.uzyte.size, b = poziomBotow();
  let ms = (losuj(900, 4200) + Math.max(0, 20 - wolnych) * 350) * b.tempo;
  if (Math.random() < b.blad) ms += G.ust.minTura * 1000; // zawiecha, wtedy bot może nie zdążyć
  return ms;
}

// Bot "pisze" odpowiedź litera po literze, żeby było widać, co się dzieje, a potem ją wysyła.
function ruchBota(g) {
  const wolne = odpowiedzi(G.kat).filter((_, i) => !G.uzyte.has(i));
  G.botCzas = Infinity;
  if (!wolne.length) return;
  let tekst;
  const { wagi, blad } = poziomBotow();
  if (Math.random() < blad) { // bot też się myli: powtórka albo odpowiedź z innej kategorii
    const uzyte = odpowiedzi(G.kat).filter((_, i) => G.uzyte.has(i));
    tekst = uzyte.length && Math.random() < 0.5 ? wybierz(uzyte).a : wybierz(odpowiedzi(Baza.otworz(Math.floor(Math.random() * Baza.ile)))).a;
  } else {
    // najpierw poziom rzadkości (według poziomu botów), potem losowa odpowiedź z tego poziomu
    const poziomy = Object.keys(wagi).filter(t => wagi[t] > 0 && wolne.some(o => o.t === t));
    if (!poziomy.length) poziomy.push(wolne[0].t);
    let los = Math.random() * poziomy.reduce((s, t) => s + (wagi[t] || 1), 0);
    const poziom = poziomy.find(t => (los -= wagi[t] || 1) <= 0) ?? poziomy[0];
    tekst = wybierz(wolne.filter(o => o.t === poziom)).a.toLowerCase();
  }
  const nr = G.nr;
  let i = 0;
  const krok = () => {
    if (G.nr !== nr || G.trzyma !== g.id) return;
    if (i++ < tekst.length) { rozeslij({ t: 'pisze', id: g.id, tekst: tekst.slice(0, i) }); zaplanuj(losuj(45, 110), krok); return; }
    G.botCzas = Date.now() + losuj(900, 2200); // gdyby odpowiedź nie przeszła
    odpowiedz(g.id, tekst);
  };
  krok();
}

// ---------- tablica pokoi publicznych ----------
function daneOgloszenia(zamkniety = false) {
  return JSON.stringify({ v: 1, kod: G.kod, host: G.gracze.find(g => g.id === ja)?.imie ?? '', gracze: G.gracze.length, miejsca: G.ust.miejsca, gra: !wPoczekalni(), zamkniety: zamkniety || G.ust.zamkniety });
}
function oglos(zamkniety = false) {
  if (!G?.kod) return;
  G.ogloszenie.czas = Date.now();
  fetch(TABLICA, { method: 'POST', body: daneOgloszenia(zamkniety) }).catch(() => {});
}
// Pokój publiczny odświeża ogłoszenie co 50 s, a po zmianie (gracze, miejsca, start gry) najwyżej co 12 s.
function pilnujOgloszenia() {
  if (!G.ust.publiczny || !G.kod) return;
  const klucz = `${G.gracze.length}|${G.ust.miejsca}|${wPoczekalni()}`, minelo = Date.now() - G.ogloszenie.czas;
  if (minelo > 50000 || (klucz !== G.ogloszenie.klucz && minelo > 12000)) { G.ogloszenie.klucz = klucz; oglos(); }
}

// Lista pokoi z ostatnich 100 sekund; nowsze ogłoszenie tego samego pokoju zastępuje starsze. Dane z sieci są niezaufane.
async function pobierzPokoje() {
  try {
    // bez limitu nieosiągalny ntfy.sh (filtr DNS, blokada adresu) trzymał listę i szybką grę 15-30 s, aż przeglądarka sama się podda
    const odp = await fetch(TABLICA + '/json?poll=1&since=100s', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!odp.ok) return null;  // limit zapytań (429) to błąd, a nie pusta lista
    const pokoje = new Map();
    for (const linia of (await odp.text()).split('\n')) {
      let w, d;
      if (linia.length > 2000) continue;  // temat jest publiczny: długie śmieci odrzucamy bez parsowania
      try { w = JSON.parse(linia); d = JSON.parse(w.message); } catch { continue; }
      if (w.event !== 'message' || d?.v !== 1 || !/^[A-Z]{4}$/.test(d.kod)) continue;
      pokoje.set(d.kod, {
        kod: d.kod, host: tekst(d.host, 16).trim() || 'Nieznajomy', zamkniety: !!d.zamkniety, gra: !!d.gra, czas: Number(w.time) || 0,
        gracze: Math.min(16, Math.max(0, Number(d.gracze) || 0)), miejsca: Math.min(16, Math.max(2, Number(d.miejsca) || 6)),
      });
    }
    return [...pokoje.values()].filter(p => !p.zamkniety && Date.now() / 1000 - p.czas < 100 && p.kod !== G?.kod).slice(0, 40);
  } catch { return null; }
}

// ntfy.sh limituje zapytania z jednego adresu IP (kilka telefonów na jednej imprezie dzieli IP), więc lista odświeża się
// co 20 s, tylko na widocznym ekranie startowym, a po błędzie (limit zwraca odpowiedź bez CORS) coraz rzadziej, do minuty.
let przerwaPokoi = 20000, zegarPokoi = 0;
async function odswiezPokoje() {
  clearTimeout(zegarPokoi);
  if ($('#start').hidden || document.visibilityState !== 'visible') { zegarPokoi = setTimeout(odswiezPokoje, przerwaPokoi); return; }
  const pokoje = await pobierzPokoje(), lista = $('#pokoje');
  przerwaPokoi = pokoje ? 20000 : Math.min(60000, przerwaPokoi * 2);
  clearTimeout(zegarPokoi);
  zegarPokoi = setTimeout(odswiezPokoje, przerwaPokoi);
  if (!pokoje) { lista.replaceChildren(h('p', { className: 'szary', textContent: 'Nie udało się pobrać listy pokoi. Spróbuję za chwilę.' })); return; }
  pokoje.sort((a, b) => a.gra - b.gra || b.gracze - a.gracze);
  $('#pokoje-ile').textContent = pokoje.length || '';
  lista.replaceChildren(...(pokoje.length ? pokoje.map(p => {
    const pelny = p.gracze >= p.miejsca;
    return h('div', { className: 'pokoj' },
      h('b', { className: 'pokoj-kod', textContent: p.kod }),
      h('div', { className: 'pokoj-opis' }, h('span', { textContent: p.host }), h('small', { className: p.gra ? 'gra' : '', textContent: `${p.gracze}/${p.miejsca} · ${p.gra ? 'grają' : 'czekają'}` })),
      h('button', { className: 'link-pokoju', textContent: pelny ? 'pełny' : 'Dołącz', disabled: pelny, onclick: () => dolacz(p.kod) }));
  }) : [h('p', { className: 'szary', textContent: 'Nikt teraz nie gra publicznie. Załóż publiczny pokój albo wybierz szybką grę, a inni znajdą cię tutaj.' })]));
}

async function szybkaGra() {
  bladStartu('Szukam wolnego pokoju…');
  const wolny = ((await pobierzPokoje()) ?? []).filter(p => !p.gra && p.gracze < p.miejsca).sort((a, b) => b.gracze - a.gracze)[0];
  if (wolny) return dolacz(wolny.kod);
  bladStartu('');
  stworzPokoj(true, true);
  komunikat('Nikt nie czekał, więc otwieram publiczny pokój. Inni znajdą go na liście.');
}

// ---------- sieć ----------
function stworzPokoj(online, publiczny = false) {
  if (!Baza.ile) return bladStartu('Pytania się nie wczytały. Odśwież stronę.');
  ja = 'host';
  nowyPokoj(online, publiczny);
  dodajGracza(ja, profil.imie, profil.av, null);
  if (online) otworzPokoj();
  else for (let i = 0; i < 3; i++) dodajBota();
}

// PeerJS (zasoby/js: plik 1.5.4 z jsDelivr z jedną poprawką, opisaną w README; strona nie ładuje kodu z obcych serwerów) wczytuje się dopiero
// do gry przez internet: przy wczytaniu tworzy próbne połączenie WebRTC, co blokowało stronę na pół sekundy (zmierzone 537 ms)
// także tym, którzy grają tylko z botami. Sam plik pobiera się wcześniej w tle (init).
const PEERJS = { src: 'zasoby/js/peerjs.min.js', integrity: 'sha384-w0Jqlwd6c55biy0TWNEUxUrQxkAomPOqtLNGpghjF8XxtMJFLj6bVoyD3km7TwVg' };
let peerjsProbowano = false, peerjsWczytanie = null;
function wczytajPeerJS() {
  return (peerjsWczytanie ??= new Promise(r => {
    const s = Object.assign(document.createElement('script'), { src: Zaufane.createScriptURL(PEERJS.src), integrity: PEERJS.integrity, crossOrigin: 'anonymous' });
    s.onload = s.onerror = () => { peerjsProbowano = true; r(); };  // bez biblioteki zostaje przekaźnik, jak przy zablokowanym CDN
    document.head.append(s);
  }));
}

// ---------- weryfikacja hosta sekretem z linku ----------
// Link zaproszenia niesie we fragmencie (#k=...) losowy sekret pokoju (128 bitów); fragment nie trafia do żadnego serwera.
// Gość z sekretem i host podpisują HMAC-em odciski kluczy tego jednego połączenia: certyfikatów DTLS w WebRTC, kluczy ECDH
// w przekaźniku. Ktoś w środku (serwer PeerJS albo broker, który podmienia klucze) ma z każdą stroną inne klucze, więc podpisy
// się nie zgodzą i połączenie zostaje zerwane. Kto wpisał sam kod (bez linku), łączy się jak dotąd, bez tej ochrony.
let sekretPokoju = null, polaczenieZweryfikowane = false;  // gość: sekret z linku zaproszenia; czy host podpisał to połączenie
const losowySekret = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const poprawnySekret = s => typeof s === 'string' && /^[A-Za-z0-9_-]{22}$/.test(s);
const odcisk = sdp => /a=fingerprint:\S+ ([0-9A-Fa-f:]+)/.exec(sdp || '')?.[1]?.toUpperCase() ?? '';
const odciski = conn => conn.odciski ?? { moj: odcisk(conn.peerConnection?.localDescription?.sdp), obcy: odcisk(conn.peerConnection?.remoteDescription?.sdp) };
async function podpis(sekret, rola, conn, jestemHostem) {
  const { moj, obcy } = odciski(conn);
  if (!sekret || !moj || !obcy) return null;
  const [kluczHosta, kluczGoscia] = jestemHostem ? [moj, obcy] : [obcy, moj];
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(sekret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const b = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`ruletka|${rola}|${kluczHosta}|${kluczGoscia}`)));
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}
// Tryb „ukryj mój adres IP”: bez WebRTC (które pokazuje drugiej stronie adres IP), wszystko przez przekaźnik. Brokerzy
// widzą adres jak każdy serwer, inni gracze nie.
const ukryjIp = () => pamiec.daj('ukryjIp') === '1';

// Serwery do zestawiania połączeń: dwa STUN (Google i Cloudflare) plus przekaźniki TURN z domyślnej konfiguracji PeerJS.
const opcjePeerJS = () => ({
  debug: 0,
  config: { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }, ...(window.peerjs?.util?.defaultConfig?.iceServers ?? []).filter(s => String(s.urls).includes('turn:'))] },
});

// Błędy PeerJS, po których serwer zestawiający połączenia jest nieosiągalny (a nie np. zajęty kod).
const BLEDY_SIECI = ['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'];
// ?przekaznik w adresie: gość od razu łączy się przez przekaźnik (gdy WebRTC u kogoś w ogóle nie działa, i do testów)
const WYMUS_PRZEKAZNIK = new URLSearchParams(location.search).has('przekaznik');
let przekaznikPokoju = null, przekaznikZgloszony = false;

// Połączenie, które się nie przedstawi („wejdź”), zamykamy po 10 s, a naraz trzymamy najwyżej 8 takich: kod pokoju bywa
// publiczny, więc ktoś mógłby zalać hosta setkami połączeń WebRTC albo sesji przekaźnika. Ponad 60 wiadomości na sekundę
// z jednego połączenia to zalew (najszybsze, czyli „piszę”, idą co kilkadziesiąt ms), więc połączenie się zamyka.
const nieprzedstawione = new Set();
function przyjmijPolaczenie(conn) {
  if (nieprzedstawione.size >= 8) { conn.close(); return; }
  nieprzedstawione.add(conn);
  const limit = setTimeout(() => { nieprzedstawione.delete(conn); if (!conn.graczId) conn.close(); }, 10000);
  let okno = 0, ile = 0;
  conn.on('data', m => {
    const t = Date.now();
    if (t - okno > 1000) { okno = t; ile = 0; }
    if (++ile > 60) { conn.close(); return; }
    doHostaOd(conn.graczId, m, conn);
  });
  conn.on('close', () => { clearTimeout(limit); nieprzedstawione.delete(conn); rozlaczony(conn); });
}
// Host słucha też na przekaźniku, bo nie wie z góry, któremu gościowi WebRTC się nie zestawi.
function sluchajPrzekaznika(kod) {
  if (!przekaznikPokoju && Przekaznik.dostepny) przekaznikPokoju = Przekaznik.nasluchuj(PREFIKS + kod, przyjmijPolaczenie);
}

function otworzPokoj(kod = Array.from({ length: 4 }, () => wybierz(LITERY)).join(''), proba = 0) {
  if (ukryjIp()) {  // goście dostaną od serwera PeerJS „nie ma takiego pokoju” i od razu przejdą na przekaźnik
    G.kod ??= kod;
    rozeslijStan();
    if (Przekaznik.dostepny) sluchajPrzekaznika(G.kod);
    else komunikat('Ta przeglądarka nie obsłuży pokoju bez WebRTC. Wyłącz ukrywanie adresu IP albo zagraj z botami.');
    return;
  }
  if (typeof Peer !== 'function' && !peerjsProbowano) { const g = G; return void wczytajPeerJS().then(() => G === g && otworzPokoj(kod, proba)); }
  // biblioteka PeerJS z CDN się nie wczytała (zablokowany jsDelivr, brak sieci przy starcie): pokój na samym przekaźniku
  if (typeof Peer !== 'function') {
    G.kod ??= kod;
    rozeslijStan();
    if (Przekaznik.dostepny) { sluchajPrzekaznika(G.kod); komunikat('Nie wczytała się biblioteka połączeń, więc pokój działa przez przekaźnik.'); }
    else komunikat('Ta przeglądarka nie obsługuje gry przez internet. Zagraj z botami.');
    return;
  }
  peer?.destroy();
  const p = peer = new Peer(PREFIKS + kod, opcjePeerJS());
  const przywracany = G.kod === kod;  // po odświeżeniu host zostaje przy swoim kodzie
  p.on('open', () => { G.kod = kod; rozeslijStan(); sluchajPrzekaznika(kod); });
  p.on('error', e => {
    if (e.type === 'unavailable-id') {
      p.destroy();
      // wpis hosta sprzed odświeżenia może jeszcze chwilę wisieć na serwerze PeerJS; w końcu zostaje sam przekaźnik
      if (przywracany && proba < 6) setTimeout(() => otworzPokoj(kod, proba + 1), 1500);
      else if (przywracany) sluchajPrzekaznika(kod);
      else otworzPokoj();
    } else if (!p.open && BLEDY_SIECI.includes(e.type) && Przekaznik.dostepny && (przywracany || !G.kod)) {
      G.kod = kod;
      rozeslijStan();
      sluchajPrzekaznika(kod);
      if (!przekaznikZgloszony) komunikat('Serwer połączeń PeerJS nie odpowiada, więc pokój działa przez przekaźnik (trochę wolniej).');
      przekaznikZgloszony = true;
    } else if (!G.kod) komunikat(`Nie udało się otworzyć pokoju (${e.type}). Zagraj z botami albo spróbuj ponownie.`);
  });
  p.on('disconnected', () => { if (G.kod && !p.destroyed) p.reconnect(); });
  p.on('connection', przyjmijPolaczenie);
}

let kodPokoju = null, polaczenieNr = 0, proby = 0, straznik = 0;
function dolacz(kod) {
  kod = kod.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(kod)) return bladStartu('Kod pokoju to 4 litery.');
  kodPokoju = kod;
  sesja.zapisz('pokoj', kod);  // po przeładowaniu karty wracamy do tego pokoju sami
  const zapisany = sesja.daj('sekret', '');
  sekretPokoju = zapisany.startsWith(kod + ':') && poprawnySekret(zapisany.slice(5)) ? zapisany.slice(5) : null;
  ja = null;  // id nada host wiadomością „witaj”
  polaczenieZweryfikowane = false;
  $('#dolacz').disabled = $('#zajmij').disabled = true;
  bladStartu(`Łączę z pokojem ${kod}…`);
  polacz();
}

// Jedno podejście do połączenia z hostem: najpierw bezpośrednio przez WebRTC, a gdy to po 6 s nie wyjdzie (albo serwer PeerJS
// nie odpowiada, albo nie zna pokoju), przez przekaźnik. Wygrywa pierwsze połączenie, które się otworzy.
// Po zerwaniu w trakcie gry próbujemy kilka razy wrócić na to samo miejsce (host po odświeżeniu też wraca z tym kodem).
let przezPrzekaznik = false;
function polacz() {
  if (typeof Peer !== 'function' && !peerjsProbowano && !WYMUS_PRZEKAZNIK && !ukryjIp()) { const nr = polaczenieNr; return void wczytajPeerJS().then(() => nr === polaczenieNr && polacz()); }
  const nr = ++polaczenieNr, moje = () => nr === polaczenieNr;
  peer?.destroy();
  if (doHosta?.przekaznik) doHosta.close();
  clearInterval(straznik);
  let gotowe = false, zapasStan = null, powodZapasu, zapasCzas = 0;
  const nieWyszlo = powod => {
    if (!moje() || gotowe) return;
    gotowe = true;
    clearTimeout(limit); clearTimeout(zapasCzas);
    if (S) return zerwanie();
    sesja.zapisz('pokoj', '');
    bladStartu(powod === 'peer-unavailable' ? `Nie ma pokoju ${kodPokoju}. Sprawdź kod.` : powod ? `Błąd połączenia (${powod}). Spróbuj ponownie.` : 'Nie udało się połączyć. Sprawdź kod albo spróbuj ponownie.');
  };
  const limit = setTimeout(() => nieWyszlo(null), 20000);
  const przyjmij = c => {
    if (!moje() || gotowe) return c.close();
    gotowe = true;
    clearTimeout(limit); clearTimeout(zapasCzas);
    proby = 0;
    doHosta = c;
    polaczenieZweryfikowane = false;  // każde połączenie host podpisuje od nowa
    if (statusChwilowy?.tekst.startsWith('Zerwało')) { statusChwilowy = null; if (S) rysujStatus(); }
    c.on('data', m => { const w = moje() && oczyscWiadomosc(m); if (w) odbierz(w); });
    c.on('close', () => moje() && zerwanie());
    if (c.przekaznik) {
      p?.destroy();
      if (!przezPrzekaznik) komunikat('Bezpośrednie połączenie nie wyszło, więc gram przez przekaźnik (trochę wolniej, ale działa).');
      przezPrzekaznik = true;
    } else straznik = setInterval(() => { if (moje() && zerwane(c)) zerwanie(); }, 1000);
    const wejdz = dowod => c.send({ t: 'wejdz', w: WERSJA, token: TOKEN, u: URZADZENIE, imie: profil.imie, av: profil.av, byly: bylePytania(), dowod: dowod ?? undefined });
    if (sekretPokoju) podpis(sekretPokoju, 'gosc', c, false).then(wejdz, () => wejdz(null)); else wejdz(null);
  };
  // Przekaźnik rusza raz na podejście. Porażkę zgłaszamy dopiero, gdy padło i WebRTC (powód z błędu PeerJS), i przekaźnik;
  // sam brak odpowiedzi przekaźnika przy wciąż zestawianym WebRTC niczego nie przesądza (pilnuje tego limit 20 s).
  const zapas = powod => {
    if (!moje() || gotowe) return;
    if (powod !== undefined) powodZapasu = powod;
    if (!Przekaznik.dostepny || zapasStan === 'nie') return powodZapasu !== undefined && nieWyszlo(powodZapasu);
    if (zapasStan) return;
    zapasStan = 'trwa';
    Przekaznik.polacz(PREFIKS + kodPokoju, S ? 5000 : 8000).then(przyjmij, () => { zapasStan = 'nie'; if (powodZapasu !== undefined) nieWyszlo(powodZapasu); });
  };
  const p = WYMUS_PRZEKAZNIK || ukryjIp() || typeof Peer !== 'function' ? null : (peer = new Peer(opcjePeerJS()));
  if (!p) return zapas('peer-unavailable');
  if (przezPrzekaznik) zapas();  // u tego gościa WebRTC już raz nie wyszło: przekaźnik od razu, równolegle
  p.on('open', () => {
    const c = p.connect(PREFIKS + kodPokoju, { serialization: 'json', reliable: true });
    c.on('open', () => przyjmij(c));
    zapasCzas = setTimeout(() => zapas(), 6000);  // ICE się nie zestawia: równolegle próbujemy przekaźnika
  });
  p.on('error', e => { if (moje()) zapas(e.type); });
}

// Gość z sekretem z linku: host musi podpisać odciski kluczy tego połączenia. Brak albo zły podpis = ktoś w środku.
async function sprawdzPodpisHosta(dowod) {
  const c = doHosta;
  const wzor = await podpis(sekretPokoju, 'host', c, false).catch(() => null);
  if (c !== doHosta) return;
  if (wzor && dowod === wzor) { polaczenieZweryfikowane = true; return rysujUczciwosc(); }
  proby = 99; polaczenieNr++; clearInterval(straznik); c.close();
  rozlaczono('To połączenie nie przeszło weryfikacji: ktoś po drodze mógł je podmienić. Spróbuj ponownie za chwilę albo poproś o nowy link.');
}

function zerwanie() {
  polaczenieNr++;  // to podejście jest już martwe
  clearInterval(straznik);
  if (kontrola) kontrola.przerwa = true;  // czas bez łączności nie świadczy o oszustwie hosta
  if (proby++ < 6) {
    chwilowyStatus('Zerwało połączenie, wracam do pokoju…', 'zly', 6000);
    setTimeout(polacz, Math.min(3000, 1000 * proby));
  } else rozlaczono('Host zamknął pokój albo zerwało się połączenie.');
}

// Zamknięta karta albo uśpiony telefon nie zawsze zamykają połączenie WebRTC (PeerJS nie zgłasza wtedy "close"),
// więc zerwane ICE przez 5 sekund traktujemy jak wyjście z gry.
function zerwane(conn) {
  const stan = conn.peerConnection?.iceConnectionState;
  if (stan !== 'disconnected' && stan !== 'failed' && stan !== 'closed') { conn.zerwaneOd = 0; return false; }
  conn.zerwaneOd ||= Date.now();
  return Date.now() - conn.zerwaneOd > 5000;
}

function wyslij(m) {
  if (G) doHostaOd(ja, m);
  else if (doHosta?.open) doHosta.send(m);
}

// ---------- seria dni i statystyki (tylko w tej przeglądarce) ----------
const dzien = przesuniecie => new Date(Date.now() - przesuniecie * 864e5).toLocaleDateString('sv');
function zaliczDzien() {
  const ostatni = pamiec.daj('dzien');
  if (ostatni === dzien(0)) return;
  pamiec.zapisz('seria', ostatni === dzien(1) ? Number(pamiec.daj('seria', 0)) + 1 : 1);
  pamiec.zapisz('dzien', dzien(0));
}
const seria = () => [dzien(0), dzien(1)].includes(pamiec.daj('dzien')) ? Number(pamiec.daj('seria', 0)) : 0;
const KOLEJNOSC = 'ptsrdk';
// Najrzadsza odpowiedź z tej przeglądarki; zepsuty albo ręcznie zmieniony wpis nie wywraca strony.
function najrzadsza() {
  try {
    const n = JSON.parse(pamiec.daj('najrzadsza', 'null'));
    return obiekt(n) && kluczPoziomu(n.t) ? { a: tekst(n.a, 60), t: n.t } : null;
  } catch { return null; }
}
function zapiszOdpowiedz(a, t) {
  const naj = najrzadsza();
  if (!naj || KOLEJNOSC.indexOf(t) >= KOLEJNOSC.indexOf(naj.t)) pamiec.zapisz('najrzadsza', JSON.stringify({ a, t }));
}
const dodaj = k => pamiec.zapisz(k, Number(pamiec.daj(k, 0)) + 1);

// Ostatnio widziane kategorie jako krótkie klucze (skrót FNV-1a, ten sam co categoryKey w krillionie).
function kluczPytania(q) {
  const t = q.trim().toLowerCase().replace(/\s+/g, ' ');
  let n = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { n ^= t.charCodeAt(i); n = Math.imul(n, 0x1000193); }
  return (n >>> 0).toString(36);
}

// ---------- baza pytań ----------
// Pytania i odpowiedzi leżą w pamięci zaszyfrowane: każda kategoria osobnym strumieniem z losowym ziarnem, innym w każdej
// sesji, a odszyfrowana jest tylko ta, która jest właśnie grana. Zrzut pamięci ani wyszukiwanie tekstu w narzędziach
// przeglądarki nie znajdzie odpowiedzi, a z konsoli bazy w ogóle nie widać (gra.js jest modułem, nic z niego nie wystaje
// do window). To utrudnienie, nie szyfr: kod odszyfrowania jest w grze, bo bez serwera przeglądarka sama sprawdza odpowiedzi.
const Baza = (() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  let wpisy = [], ileOdpowiedzi = 0;
  const strumien = (bajty, ziarno) => {
    const w = new Uint8Array(bajty.length);
    let x = ziarno | 1;
    for (let i = 0; i < bajty.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; w[i] = bajty[i] ^ (x >>> 24); }
    return w;
  };
  const otworz = w => (w ? JSON.parse(dec.decode(strumien(w.dane, w.ziarno))) : null);
  return {
    zaladuj(kategorie) {
      const ziarna = crypto.getRandomValues(new Uint32Array(kategorie.length));
      ileOdpowiedzi = kategorie.reduce((s, k) => s + odpowiedzi(k).length, 0);
      wpisy = kategorie.map(({ _odp, ...k }, i) => ({ klucz: kluczPytania(k.q), ziarno: ziarna[i], dane: strumien(enc.encode(JSON.stringify(k)), ziarna[i]) }));
    },
    get ile() { return wpisy.length; },
    get ileOdpowiedzi() { return ileOdpowiedzi; },
    klucze: () => wpisy.map(w => w.klucz),
    otworz: i => otworz(wpisy[i]),
    // po treści pytania: klucz FNV może się powtórzyć, więc ostatecznie decyduje pełna treść
    znajdz: q => (typeof q === 'string' ? wpisy.filter(w => w.klucz === kluczPytania(q)).map(otworz).find(k => k.q === q) ?? null : null),
  };
})();
const czysteKlucze = t => (Array.isArray(t) ? t.slice(-PAMIEC_PYTAN).filter(k => typeof k === 'string' && /^[0-9a-z]{1,7}$/.test(k)) : []);  // najpierw przycięcie: lista z sieci może być ogromna
function bylePytania() {
  try { return czysteKlucze(JSON.parse(pamiec.daj('byly', '[]'))); } catch { return []; }
}
function zapamietajPytanie(q) {
  const k = kluczPytania(q);
  pamiec.zapisz('byly', JSON.stringify([...bylePytania().filter(x => x !== k), k].slice(-PAMIEC_PYTAN)));
}
// Imię: 2–16 znaków. Litery, cyfry, znaki przestankowe, symbole i emoji zostają, wypadają tylko znaki sterujące, niewidoczne
// i łączące (napisy „zalgo”). Dawniej jeden znak spoza liter, cyfr i _ . ' - zamieniał całe imię na „Nieznajomy”.
function poprawneImie(s) {
  const t = tekst(s, 40).normalize('NFC').replace(/[^\p{L}\p{N}\p{P}\p{S}\s]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16).replace(/[\uD800-\uDBFF]$/, '').trim();
  return t.length >= 2 ? t : null;
}

// ---------- wiadomości z sieci: sprawdzone, zanim dotkną stanu albo ekranu ----------
// Host jest zaufany tylko we własnej przeglądarce. U gościa każda wiadomość od hosta przechodzi przez białą listę pól,
// typów i długości, więc złośliwy host nie wywali gry, nie podmieni prototypów i nie wklei tekstu odwracającego kierunek.
const FAZY = ['lobby', 'odliczanie', 'gra', 'pekniecie', 'zmiana', 'koniec'];
const ZAKAZANE_KLUCZE = ['__proto__', 'constructor', 'prototype'];
// bez znaków sterujących, niewidocznych i zmieniających kierunek tekstu (podszywanie się pod cudze imię albo odpowiedź)
// tylko napisy i liczby: obiekt z sieci z polem toString wywróciłby String()
const tekst = (v, max) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, '').slice(0, max);
const liczba = (v, min, max, d = min) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const idGracza = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,30}$/.test(v) && !ZAKAZANE_KLUCZE.includes(v) ? v : null);
const kluczPoziomu = v => (typeof v === 'string' && Object.hasOwn(POZIOMY, v) ? v : null);
const tablica = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const obiekt = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function oczyscStan(m) {
  const ust = { publiczny: m.ust?.publiczny === true, zamkniety: m.ust?.zamkniety === true };
  for (const [k, [min, max]] of Object.entries(ZAKRESY)) ust[k] = Math.round(liczba(m.ust?.[k], min, max, USTAWIENIA[k]));
  const gracze = tablica(m.gracze, 16).filter(g => obiekt(g) && idGracza(g.id)).map(g => ({
    id: g.id, imie: tekst(g.imie, 16) || '?', av: WSZYSTKIE_AWATARY.includes(g.av) ? g.av : '😶',
    zycia: Math.round(liczba(g.zycia, 0, 10)), zywy: g.zywy === true, widz: g.widz === true, bot: g.bot === true, offline: g.offline === true,
    seg: tablica(g.seg, 60).filter(s => obiekt(s) && kluczPoziomu(s.t)).map(s => ({ t: s.t, ile: liczba(s.ile, 0, 100) })),
  }));
  const ostatnie = Object.create(null);
  if (obiekt(m.ostatnie)) for (const [k, o] of Object.entries(m.ostatnie).slice(0, 16)) if (idGracza(k) && obiekt(o) && kluczPoziomu(o.t)) ostatnie[k] = { a: tekst(o.a, 60), t: o.t };
  const p = obiekt(m.pods) ? m.pods : null;
  return {
    t: 'stan', kod: typeof m.kod === 'string' && /^[A-Z]{4}$/.test(m.kod) ? m.kod : null, online: m.online === true,
    faza: FAZY.includes(m.faza) ? m.faza : 'lobby', odFazy: liczba(m.odFazy, 0, 864e5), ust, nrKat: Math.round(liczba(m.nrKat, 0, 1e6)), gracze,
    trzyma: idGracza(m.trzyma), q: m.q == null ? null : tekst(m.q, 200), ostatnie,
    odTury: liczba(m.odTury, 0, 864e5), odPytania: liczba(m.odPytania, 0, 864e5), zaliczone: Math.round(liczba(m.zaliczone, 0, 1000)),
    progi: tablica(m.progi, 5).map(x => liczba(x, 0, 60)), zwyciezca: idGracza(m.zwyciezca), pauza: m.pauza === true,
    zob: obiekt(m.zob) && typeof m.zob.skrot === 'string' && /^[0-9a-f]{64}$/.test(m.zob.skrot) ? { nrKat: Math.round(liczba(m.zob.nrKat, 0, 1e6)), q: tekst(m.zob.q, 200), skrot: m.zob.skrot } : null,
    odkr: obiekt(m.odkr) && typeof m.odkr.sol === 'string' && /^[0-9a-f]{32}$/.test(m.odkr.sol)
      ? { nrKat: Math.round(liczba(m.odkr.nrKat, 0, 1e6)), q: tekst(m.odkr.q, 200), lont: Math.round(liczba(m.odkr.lont, 0, 1e6)), prog: Math.round(liczba(m.odkr.prog, 0, 1e3)), sol: m.odkr.sol } : null,
    pods: p && {
      kategorie: Math.round(liczba(p.kategorie, 0, 1e6)), odpowiedzi: Math.round(liczba(p.odpowiedzi, 0, 1e7)),
      naj: obiekt(p.naj) && kluczPoziomu(p.naj.t) ? { a: tekst(p.naj.a, 60), t: p.naj.t, imie: tekst(p.naj.imie, 16) } : null,
      gadula: obiekt(p.gadula) ? { imie: tekst(p.gadula.imie, 16), ile: Math.round(liczba(p.gadula.ile, 0, 1e6)) } : null,
    },
  };
}

function oczyscWiadomosc(m) {
  if (!obiekt(m)) return null;
  const wpis = w => ({ sys: w.sys === true, imie: tekst(w.imie, 16), tekst: tekst(w.tekst, 160) });
  switch (m.t) {
    case 'stan': return oczyscStan(m);
    case 'fx': return ['ok', 'zle', 'pek', 'zaliczona'].includes(m.r)
      ? { t: 'fx', r: m.r, id: idGracza(m.id), a: tekst(m.a, 60), p: kluczPoziomu(m.p), tekst: tekst(m.tekst, 60), powod: m.powod === 'bylo' ? 'bylo' : 'pudlo', odpada: m.odpada === true, serce: m.serce === true }
      : null;
    case 'pisze': return { t: 'pisze', id: idGracza(m.id), tekst: tekst(m.tekst, 60) };
    case 'czat': return { t: 'czat', ...wpis(m) };
    case 'czatHistoria': return { t: 'czatHistoria', wpisy: tablica(m.wpisy, 60).filter(obiekt).map(wpis) };
    case 'reakcja': return REAKCJE.includes(m.e) ? { t: 'reakcja', id: idGracza(m.id), e: m.e } : null;
    case 'witaj': return idGracza(m.id) && m.id !== 'host' ? { t: 'witaj', id: m.id, dowod: typeof m.dowod === 'string' && /^[0-9a-f]{64}$/.test(m.dowod) ? m.dowod : null } : null;
    case 'innaWersja': return { t: 'innaWersja', w: tekst(m.w, 40) };
    case 'zlyPodpis':
    case 'pelno': case 'wyrzucony': case 'zamkniety': case 'koniecPokoju': return { t: m.t };
    default: return null;
  }
}

// ---------- klient: rysowanie stanu ----------
let S = null;           // ostatni stan od hosta
const dymki = Object.create(null);  // chwilowe dymki nad graczami: id -> { tekst, klasa, t, do }; bez prototypu, klucze przychodzą z sieci
let statusChwilowy = null, nowaKategoriaDo = 0, nowaKartaZegar = 0;

// ---------- gość sprawdza hosta ----------
// Dla każdej kategorii: zobowiązanie z początku, lokalne czasy (start, kto i od kiedy trzyma), przyjęte odpowiedzi.
// Po ujawnieniu: skrót musi się zgadzać, strzał musi paść nie wcześniej i nie dużo później niż max(lont, start tury + min. tura),
// zaliczenie po dokładnie tylu dobrych odpowiedziach, ile wynosił próg. Decyzje o odpowiedziach gość sprawdza na własnej liście.
const ZAPAS_WCZESNIE = 1500, ZAPAS_POZNO = 3000;
let kontrola = null, sprawdzone = 0, oszustwo = null;
function zarzut(powod) {
  if (oszustwo) return;
  oszustwo = powod;
  rysujUczciwosc();
  komunikat('Host oszukuje: ' + powod);
  dopiszCzat({ sys: true, tekst: 'Uwaga, host oszukuje: ' + powod });
}
function rysujUczciwosc() {
  const el = $('#uczciwosc');
  el.hidden = !!G || !S?.online;
  el.classList.toggle('oszust', !!oszustwo);
  el.textContent = (oszustwo ? '⚠ host oszukuje' : sprawdzone ? `✓ host uczciwy (${sprawdzone})` : '✓ sprawdzam hosta') + (polaczenieZweryfikowane ? ' · 🔒' : '');
  el.title = oszustwo || 'Każda kategoria jest podpisana skrótem SHA-256 z czasem strzału i progiem; po kategorii sprawdzamy, czy host ich nie zmienił.'
    + (polaczenieZweryfikowane ? ' 🔒: połączenie zweryfikowane sekretem z linku zaproszenia, nikt po drodze go nie podmienił.' : ' Wejście z linku zaproszenia (zamiast wpisanego kodu) dodatkowo sprawdza, czy nikt po drodze nie podmienił połączenia.');
}
function sprawdzHosta(poprz) {
  if (G || !S.online) return;
  const teraz = performance.now(), k = kontrola;
  // kategorię rozpoznaje numer razem z pytaniem: numer zaczyna się od 1 w każdej rundzie, więc po rundzie zakończonej na pierwszej
  // kategorii sam numer brał pierwszą kategorię następnej rundy za tę samą i porównywał jej ujawnienie ze starym zobowiązaniem
  const ta = k && S.nrKat === k.nrKat && S.q === k.q;
  if (S.faza === 'gra' && !ta) {
    // Gość, który widzi kategorię pierwszy raz dopiero w jej trakcie (wszedł albo wrócił po zerwaniu), nie zna jej początku
    // ani odpowiedzi uznanych przed nim, więc u niego liczy się tylko podpis, bez czasu strzału i liczby odpowiedzi do progu
    // Host wysyła stan w chwili startu kategorii, więc normalnie odPytania to kilkadziesiąt ms; kto zobaczy kategorię później niż
    // po sekundzie, liczyłby jej początek od chwili odbioru i brał uczciwy strzał za zbyt wczesny (tak było przy progu 2,5 s),
    // a kto zobaczy ją po pierwszej uznanej odpowiedzi, liczyłby za mało odpowiedzi do progu.
    kontrola = { nrKat: S.nrKat, q: S.q, start: teraz - Math.min(S.odPytania, 1000), trzyma: S.trzyma, trzymaOd: teraz - Math.min(S.odTury, 1000), zob: null, uzyte: new Set(), dobre: 0, koniec: null, faza: null,
                 przerwa: S.odPytania > 1000 || S.zaliczone > 0 };
  } else if (ta && S.trzyma !== k.trzyma && S.faza === 'gra') { k.trzyma = S.trzyma; k.trzymaOd = teraz - Math.min(S.odTury, 1500); }  // stan zmiany tury mógł iść chwilę dłużej
  const kk = kontrola;
  if (!kk) return;
  if (!kk.zob && S.zob?.nrKat === kk.nrKat && S.zob.q === kk.q) kk.zob = S.zob.skrot;  // pierwsze zobowiązanie tej kategorii wygrywa, późniejsza podmiana się nie liczy
  if (!kk.koniec && (S.faza === 'pekniecie' || S.faza === 'zmiana') && poprz?.faza === 'gra') { kk.koniec = teraz; kk.faza = S.faza; }
  const o = S.odkr;
  if (kk.koniec && o?.nrKat === kk.nrKat && o.q === kk.q && !kk.zweryfikowano) {
    kk.zweryfikowano = true;
    if (!kk.zob) return zarzut('kategoria nie miała podpisu przed strzałem');
    skrot(trescZobowiazania(o)).then(s => {
      if (s === null) return;  // przeglądarka bez crypto.subtle (strona bez https): nie ma czym sprawdzić
      if (s !== kk.zob) return zarzut('host zmienił ukryty czas strzału albo próg w trakcie kategorii');
      const tura = kk.trzymaOd - kk.start + S.ust.minTura * 1000, wystrzal = Math.max(o.lont, tura), trwalo = kk.koniec - kk.start;
      // po zerwaniu łączności w trakcie kategorii lokalne czasy są przekłamane, więc sprawdzamy tylko podpis i próg
      const sek = ms => (ms / 1000).toFixed(1).replace('.', ',') + ' s';
      if (!kk.przerwa && kk.faza === 'pekniecie' && trwalo < wystrzal - ZAPAS_WCZESNIE) return zarzut(`strzał padł przed ukrytym czasem (${sek(wystrzal - trwalo)} za wcześnie)`);
      if (!kk.przerwa && trwalo > wystrzal + ZAPAS_POZNO) return zarzut(`rewolwer nie wystrzelił, choć czas minął (${sek(trwalo - wystrzal)} za późno)`);
      if (!kk.przerwa && kk.faza === 'zmiana' && kk.dobre !== o.prog) return zarzut(`kategoria zaliczona po ${kk.dobre} odpowiedziach zamiast ${o.prog}`);
      sprawdzone++;
      rysujUczciwosc();
    });
  }
}
function sprawdzDecyzje(m) {
  const kk = kontrola;
  if (G || !S?.online || !kk || kk.nrKat !== S.nrKat || kk.q !== S.q) return;
  const kat = kk.kat ??= Baza.znajdz(kk.q);
  if (!kat) return;  // inna wersja pytań u hosta: nie ma z czym porównać
  const odp = odpowiedzi(kat);
  if (m.r === 'ok') {
    const i = odp.findIndex(x => x.a === m.a && x.t === m.p);
    if (i < 0) return zarzut(`uznał odpowiedź spoza listy („${m.a}”)`);
    if (kk.uzyte.has(i)) return zarzut(`uznał drugi raz tę samą odpowiedź („${m.a}”)`);
    kk.uzyte.add(i);
    kk.dobre++;
  } else if (m.r === 'zle') {
    const i = dopasuj(kat, m.tekst);
    if (m.powod === 'pudlo' && i >= 0 && !kk.uzyte.has(i)) zarzut(`odrzucił dobrą odpowiedź („${m.tekst}”)`);
    // po przerwie gość nie widział wszystkich wcześniejszych odpowiedzi, więc „już padło” może być prawdą
    if (m.powod === 'bylo' && !kk.przerwa && !(i >= 0 && kk.uzyte.has(i))) zarzut(`odrzucił odpowiedź „${m.tekst}” jako użytą, choć nie padła`);
  }
}

function odbierz(m) {
  if (m.t === 'stan') {
    const poprz = S;
    S = m;
    S._t0 = performance.now();
    zaplanujKlatke();
    if (poprz?.nrKat !== S.nrKat || poprz?.faza !== S.faza && !['pekniecie', 'zmiana'].includes(S.faza)) for (const k in dymki) delete dymki[k];
    if (S.faza === 'gra' && S.q && poprz?.nrKat !== S.nrKat) {
      zapamietajPytanie(S.q);
      if (S.nrKat > 1) {  // krillion: „new category” w pasku statusu przez 3,2 s
        nowaKategoriaDo = Date.now() + 3200;
        setTimeout(() => S && rysujStatus(), 3220);
      }
    }
    if (S.faza === 'odliczanie' && poprz?.faza !== 'odliczanie' && S.gracze.some(g => g.id === ja)) { zaliczDzien(); dodaj('gry'); }
    if (S.faza === 'koniec' && poprz && poprz.faza !== 'koniec' && S.zwyciezca === ja) dodaj('wygrane');
    sprawdzHosta(poprz);
    try { render(poprz); } catch (e) { zgloszBlad(e); }  // jeden zły stan nie zatrzyma kolejnych
    rysujUczciwosc();
  } else if (m.t === 'fx' && S) { sprawdzDecyzje(m); efekt(m); }
  else if (m.t === 'pisze' && m.id !== ja) ustawDymek(m.id, m.tekst ? { klasa: 'caret', tekst: String(m.tekst) } : null);
  else if (m.t === 'czat') dopiszCzat(m);
  else if (m.t === 'czatHistoria') { $('#czat-wpisy').replaceChildren(); (m.wpisy || []).forEach(dopiszCzat); }
  else if (m.t === 'witaj' && !G) { ja = m.id; if (sekretPokoju) sprawdzPodpisHosta(m.dowod); }
  else if (m.t === 'zlyPodpis') { proby = 99; polaczenieNr++; clearInterval(straznik); rozlaczono('Host nie przyjął podpisu z twojego linku: link jest nieaktualny albo ktoś po drodze podmienił połączenie. Poproś o nowy link albo wpisz sam kod.'); }
  else if (m.t === 'pelno') { proby = 99; rozlaczono('Ten pokój jest pełny.'); }
  else if (m.t === 'innaWersja') {
    proby = 99; polaczenieNr++; clearInterval(straznik);
    rozlaczono(m.w < WERSJA ? 'Host ma starszą wersję gry. Niech odświeży stronę (pokój mu zostanie), a potem wejdź jeszcze raz.'
      : 'Masz starszą wersję gry niż host. Odśwież stronę i wejdź jeszcze raz.');
  }
  else if (m.t === 'zamkniety') { proby = 99; polaczenieNr++; rozlaczono('Host zamknął wejście do pokoju. Poproś go, żeby je otworzył.'); }
  else if (m.t === 'reakcja' && S) pokazReakcje(m.id, m.e);
  else if (m.t === 'koniecPokoju' && !G) { polaczenieNr++; clearInterval(straznik); rozlaczono('Host zamknął pokój.'); }
  else if (m.t === 'wyrzucony') {
    polaczenieNr++;  // zamknięcie połączenia nie uruchomi już powrotu do pokoju
    clearInterval(straznik);
    rozlaczono('Host wyrzucił cię z pokoju.');
  }
}

function pokazReakcje(id, e) {
  const el = [...miejsca.values()].find(x => x.id === id)?.el;
  if (!el || !REAKCJE.includes(e)) return;
  const r = h('span', { className: 'reakcja', textContent: e, style: `--dx:${losuj(-18, 18)}px` });
  el.append(zniknie(r));
  ton(1320, 0.05, 'sine', 0.03);
}

// Host klika cudze miejsce, żeby wyrzucić gracza albo bota.
function klikMiejsca(id) {
  const g = G && id && id !== ja && gracz(id);
  if (g && confirm(g.bot ? `Usunąć bota ${g.imie}?` : `Wyrzucić ${g.imie} z pokoju?`)) wyrzuc(id);
}

const imieGracza = id => S.gracze.find(g => g.id === id)?.imie ?? '?';
const tabliczkaHosta = () => S.gracze[0]?.imie ?? 'host';

function render(poprz) {
  $('#start').hidden = true;
  $('#gra').hidden = false;
  const { faza } = S, wGrze = ['gra', 'pekniecie', 'zmiana'].includes(faza);
  const zywi = S.gracze.filter(g => g.zywy).length;
  const ja_ = S.gracze.find(g => g.id === ja);

  $('#pokoj-typ').textContent = !S.online ? 'Gra z botami' : S.ust.publiczny ? 'Pokój publiczny' : 'Pokój';
  $('#pokoj-kod').textContent = S.online ? (S.kod ?? '····') : '';
  // kamera nagrywa tylko w trakcie rundy, w poczekalni stoi w gotowości
  const nagrywa = faza !== 'lobby' && faza !== 'koniec';
  $('#faza-napis').textContent = nagrywa ? 'REC' : 'STBY';
  $('#faza-napis').classList.toggle('rec', nagrywa);
  $('#licznik-napis').textContent = wGrze || faza === 'odliczanie' ? 'żywych' : 'przy stole';
  $('#licznik').textContent = wGrze || faza === 'odliczanie' ? `${zywi}/${S.gracze.filter(g => !g.widz).length}` : `${S.gracze.length}/${S.ust.miejsca}`;

  $('#tytul').hidden = !(faza === 'lobby' || faza === 'odliczanie');
  rysujKreski(S.nrKat || 0);
  // po wybuchu karta znika na czas zamrożenia, po zaliczeniu zostaje z dopiskiem, aż przyjdzie nowa (jak w krillionie)
  $('#karta').hidden = !(faza === 'gra' || faza === 'zmiana');
  $('#karta').classList.toggle('zaliczona', faza === 'zmiana');
  $('#wygrana').hidden = faza !== 'koniec';
  if (faza === 'gra' || faza === 'zmiana') {
    $('#kat-nr').textContent = `Kategoria ${S.nrKat}`;
    $('#pytanie').textContent = S.q;
    if (poprz?.nrKat !== S.nrKat) {
      // nowa kartka spada na stół z plaśnięciem, z głośnika dzwoni gong, pytanie świeci jak zakreślone, a przy numerze miga „NOWA”
      potrzasnij($('#karta'), 'nowa');
      clearTimeout(nowaKartaZegar);
      nowaKartaZegar = setTimeout(() => $('#karta').classList.remove('nowa'), 3200);
      plask(); gong();
    }
  }
  if (faza === 'koniec') {
    const w = S.gracze.find(g => g.id === S.zwyciezca);
    $('#wygrana-av').innerHTML = Zaufane.createHTML(w ? Twarze.svg(w.av) : '');
    $('#wygrana-imie').textContent = w ? w.imie : 'nikt';
    const p = S.pods, naj = p?.naj && POZIOMY[p.naj.t] && p.naj;
    $('#wygrana-pods').replaceChildren(...czyste(p && [
      h('span', {}, 'Kategorie: ', h('b', { textContent: p.kategorie }), ', odpowiedzi: ', h('b', { textContent: p.odpowiedzi })),
      naj && h('span', {}, 'Najrzadsza: ', h('b', { textContent: naj.a, style: `color:${POZIOMY[naj.t].kolor}` }), ` (${naj.imie})`),
      p.gadula?.ile > 0 && h('span', {}, 'Najwięcej dobrych: ', h('b', { textContent: p.gadula.ile }), ` (${p.gadula.imie})`),
    ]));
    if (poprz?.faza !== 'koniec') { graj('magnetofon', 0.9); melodia([523, 659, 784, 1047, 784, 1047], 'square'); setTimeout(() => iskry($('#wygrana-av'), '#f2c14e', 40), 100); }
  }

  $('#formularz').hidden = !wGrze;
  $('#lobby').hidden = !(faza === 'lobby' || faza === 'koniec');
  const odl = $('#odliczanie');
  odl.hidden = faza !== 'odliczanie';
  if (faza !== 'odliczanie') odl.textContent = '';

  rysujMiejsca();
  rysujRewolwer(poprz);
  rysujLobby();
  rysujZaproszenie();
  rysujMojeSerce(ja_);
  nieGasnij();

  const moja = faza === 'gra' && S.trzyma === ja;
  document.body.classList.toggle('moja-tura', moja);
  document.body.classList.toggle('host', !!G);
  document.body.classList.toggle('po-rundzie', faza === 'koniec');
  $('#odp').placeholder = moja ? 'lufa na tobie, pisz' : ja_?.widz ? 'oglądasz tę grę' : ja_ && !ja_.zywy ? 'odpadasz, możesz kibicować' : `${imieGracza(S.trzyma)} pod lufą…`;
  $('#odp').disabled = !(wGrze && ja_?.zywy) || S.pauza;  // jak w krillionie: pole działa tylko dla grających
  if (moja && !S.pauza && !(poprz?.faza === 'gra' && poprz.trzyma === ja && !poprz.pauza)) { $('#odp').focus(); ton(988, 0.09, 'sine', 0.06); wibruj(60); }
  rysujStatus();

  const online = !!S.online;
  $('#czat-przycisk').hidden = !online;
  if (!online) $('#czat').hidden = true;
  else if (!poprz && innerWidth > 1400) $('#czat').hidden = false;  // na szerokim ekranie czat mieści się obok kręgu
  if (S.kod) { $('#czat-kod').textContent = S.kod; $('#czat-link').textContent = linkPokoju().replace(/^https?:\/\//, '').replace(/#.*$/, ''); }
}

// Pasek statusu jest też komunikatem dla czytnika ekranu (role="status"), więc podmieniamy go tylko, gdy tekst się zmienia:
// czytnik nie powtarza wtedy w kółko tego samego zdania przy każdym nowym stanie od hosta.
function rysujStatus() {
  const el = h('p'), cel = $('#status');
  szkicStatusu(el);
  if (cel.textContent !== el.textContent || cel.className !== el.className) { cel.replaceChildren(...el.childNodes); cel.className = el.className; }
}
function szkicStatusu(el) {
  if (statusChwilowy && statusChwilowy.do > Date.now()) { el.replaceChildren(statusChwilowy.tekst); el.className = 'status ' + statusChwilowy.klasa; return; }
  el.className = 'status';
  const imie = t => h('b', { textContent: t });
  const glos = tekst => [h('span', { className: 'glos', textContent: 'głos z głośnika' }), `„${tekst}”`];  // porywacz mówi przez głośnik
  const { faza } = S;
  if (S.pauza) el.replaceChildren(...glos('Host wrócił. Czekamy, aż wszyscy się połączą.'));
  else if (faza === 'gra') el.replaceChildren(...czyste([nowaKategoriaDo > Date.now() && 'Nowa kategoria. ']),
    ...(S.trzyma === ja ? [imie('Lufa na tobie'), ', odpowiadaj.'] : [imie(imieGracza(S.trzyma)), ' pod lufą.']));
  else if (faza === 'zmiana') el.replaceChildren(...glos('Zaliczone. Następne pytanie.'));
  else if (faza === 'pekniecie') el.replaceChildren('Strzał. Trafiony: ', imie(imieGracza(S.trzyma)), '.');
  else if (faza === 'odliczanie') el.replaceChildren(...glos('Bębenek się kręci. Zaczynamy.'));
  else if (G) el.replaceChildren(...glos(S.gracze.length < 2 ? 'Za mało gości. Zaproś kogoś albo dodaj bota.' : faza === 'koniec' ? 'Jeszcze jedna runda?' : 'Wszyscy na miejscach? Zakręć bębenkiem.'));
  else el.replaceChildren('Czekamy, aż ', imie(tabliczkaHosta()), faza === 'koniec' ? ' zacznie kolejną rundę.' : ' zakręci bębenkiem.');
}

function chwilowyStatus(tekst, klasa, ms = 1400) {
  statusChwilowy = { tekst, klasa, do: Date.now() + ms };
  if (S) rysujStatus();
  setTimeout(() => S && rysujStatus(), ms + 20);
}

// ----- krąg graczy wokół stołu; ja zawsze na dole -----
const miejsca = new Map();  // klucz (id gracza albo "wolne-N") -> elementy miejsca

function noweMiejsce() {
  const m = {
    dymek: h('div', { className: 'dymek', hidden: true }),
    tag: h('div', { className: 'tag-poziomu' }),
    postac: h('div', { className: 'postac' }),
    pierscien: h('div', { className: 'pierscien' }),
    imie: h('b', { className: 'imie' }),
    serca: h('span', { className: 'serca' }),
  };
  m.el = h('div', { className: 'miejsce', onclick: () => klikMiejsca(m.id), onkeydown: e => { if ((e.key === 'Enter' || e.key === ' ') && m.el.tabIndex === 0) { e.preventDefault(); klikMiejsca(m.id); } } },
    m.tag, m.dymek, h('div', { className: 'zeton' }, m.pierscien, m.postac), m.serca, m.imie);
  return m;
}

// Kto stoi w kręgu. Jak w krillionie: wolne miejsca widać tylko w poczekalni, a w trakcie gry i po niej
// krąg tworzą sami grający (odpadnięci zostają na swoich miejscach, widzowie czekają poza nim).
const krag = () => (S.faza === 'lobby' ? S.gracze : S.gracze.filter(g => !g.widz));
const miejscWKregu = () => (S.faza === 'lobby' ? Math.max(S.ust.miejsca, S.gracze.length) : Math.max(1, krag().length));

function rysujMiejsca() {
  const lista = krag(), n = miejscWKregu(), klucze = new Set();
  const moj = Math.max(0, lista.findIndex(g => g.id === ja));
  const arena = $('#arena'), skala = n <= 8 ? 1 : n <= 12 ? 0.86 : 0.74;
  arena.style.setProperty('--skala', skala);
  // Miejsce sięga 3,5 em nad środek żetonu i 4,8 em pod (serca, taśma z imieniem), a krój nie maleje poniżej 10 px. Krąg jest więc
  // w pionie tak niski, żeby górne i dolne miejsce mieściły się w arenie (inaczej na 1366x768, na telefonie z klawiaturą
  // i w poziomie dolne wchodziło na napis pod areną, a górne na kartkę z kategorią), a jego środek (i stołu: --cy) leży odpowiednio wyżej.
  const em = (parseFloat(getComputedStyle(arena).fontSize) * skala * 100) / (arena.clientHeight || 1), nad = 3.5 * em, pod = 4.8 * em;
  const rx = n <= 8 ? 40 : 43, ry = Math.max(14, Math.min(n <= 8 ? 36 : n <= 12 ? 38 : 39, (100 - nad - pod) / 2)), cy = Math.min(50, (nad + 100 - pod) / 2);
  arena.style.setProperty('--cy', cy + '%');
  $('.krag').style.inset = `${cy - ry}% ${50 - rx}% ${100 - cy - ry}%`;  // linia kręgu przechodzi przez środki żetonów
  for (let i = 0; i < n; i++) {
    const g = lista[i], klucz = g ? g.id : 'wolne-' + i;
    klucze.add(klucz);
    let m = miejsca.get(klucz);
    if (!m) { m = noweMiejsce(); miejsca.set(klucz, m); $('#miejsca').append(m.el); }
    const kat = Math.PI / 2 + (2 * Math.PI * (i - moj)) / n;
    m.el.style.left = 50 + rx * Math.cos(kat) + '%';
    m.el.style.top = cy + ry * Math.sin(kat) + '%';
    m.el.style.zIndex = Math.round(10 + 10 * Math.sin(kat));
    const klasy = ['miejsce'];
    if (Math.sin(kat) < -0.55) klasy.push('u-gory');  // u górnych miejsc odpowiedź pod imieniem, żeby nie uciekała poza kadr
    if (!g) klasy.push('wolne');
    else {
      if (!g.zywy) klasy.push('martwy');
      if (g.id === ja) klasy.push('ja');
      if (g.id === S.trzyma && (S.faza === 'gra' || S.faza === 'zmiana')) klasy.push('trzyma');
      if (S.faza === 'koniec' && g.id === S.zwyciezca) klasy.push('zwyciezca');
      if (g.widz) klasy.push('widz');
      if (g.offline) klasy.push('offline');
    }
    for (const c of ['zapas', 'trafiony']) if (m.el.classList.contains(c)) klasy.push(c);  // chwilowe animacje przeżywają przerysowanie
    m.el.className = klasy.join(' ');
    if (m.postac.dataset.av !== (g?.av ?? '')) { m.postac.dataset.av = g?.av ?? ''; m.postac.innerHTML = Zaufane.createHTML(g ? Twarze.svg(g.av) : ''); }  // stały rysunek z twarze.js, bez danych z sieci
    m.el.style.setProperty('--obrot', g ? `${(kluczPytania(g.id).charCodeAt(1) % 9) - 4}deg` : '0deg');  // każda taśma z imieniem przyklejona trochę krzywo
    m.imie.replaceChildren(...czyste([g ? g.imie : 'wolne', g?.bot && h('small', { textContent: 'bot' }), g?.widz && h('small', { textContent: 'widz' }), g?.offline && h('small', { textContent: 'rozłączony' })]));
    const zycia = g ? Math.min(10, Number(g.zycia) || 0) : 0;
    const klucz2 = g ? `${zycia}/${Math.max(S.ust.zycia, zycia)}` : '';
    if (m.serca.dataset.k !== klucz2) {
      const stare = Number(m.serca.dataset.z ?? zycia);
      m.serca.dataset.k = klucz2;
      m.serca.dataset.z = zycia;
      m.serca.replaceChildren(...(g ? Array.from({ length: Math.max(S.ust.zycia, zycia) }, (_, k) =>
        h('i', { className: (k < zycia ? '' : 'puste') + (k === zycia && stare > zycia ? ' traci' : '') + (k === zycia - 1 && stare < zycia ? ' zyskuje' : ''), textContent: '♥' })) : []));
    }
    // pierścień wokół awatara: pasek do dodatkowego serca, każdy kawałek w kolorze poziomu odpowiedzi
    let od = 0;
    const stopy = (g?.seg || []).map(s => {
      const doK = Math.min(100, od + (100 * Number(s.ile)) / S.ust.pasek), st = `${POZIOMY[s.t]?.kolor ?? '#888'} ${od}% ${doK}%`;
      od = doK;
      return st;
    });
    m.pierscien.style.background = `conic-gradient(${[...stopy, `rgba(233, 229, 217, .1) ${od}% 100%`].join(', ')})`;
    m.id = g?.id;
    // host wyrzuca gracza kliknięciem albo z klawiatury (Tab do miejsca, Enter)
    const doWyrzucenia = !!G && !!g && g.id !== ja, opis = doWyrzucenia ? (g.bot ? `Usuń bota ${g.imie}` : `Wyrzuć ${g.imie} z pokoju`) : '';
    if (m.el.dataset.wyrzuc !== opis) {
      m.el.dataset.wyrzuc = opis;
      if (opis) { m.el.tabIndex = 0; m.el.role = 'button'; m.el.ariaLabel = opis; } else { m.el.removeAttribute('tabindex'); m.el.removeAttribute('role'); m.el.removeAttribute('aria-label'); }
    }
  }
  for (const [k, m] of miejsca) if (!klucze.has(k)) { m.el.remove(); miejsca.delete(k); }
  for (const g of S.gracze) rysujDymek(g.id);
}

// Dymek nad graczem: na żywo to, co pisze; po dobrej odpowiedzi błyska kolorem poziomu i zostaje mniejszy do końca kategorii.
function ustawDymek(id, d) {
  if (d) dymki[id] = d; else delete dymki[id];
  rysujDymek(id);
  if (d?.do) setTimeout(() => { if (dymki[id] === d) { delete dymki[id]; rysujDymek(id); } }, d.do - Date.now());
}

function rysujDymek(id) {
  const m = miejsca.get(id);
  if (!m || !S) return;
  const chwilowy = dymki[id], odlozony = S.ostatnie?.[id];
  const d = chwilowy ?? (odlozony && { klasa: 'odlozony', tekst: odlozony.a, t: odlozony.t });
  m.dymek.hidden = !d?.tekst;
  if (m.dymek.hidden) return;
  m.dymek.className = 'dymek ' + d.klasa;
  m.dymek.textContent = d.tekst;
  m.dymek.style.setProperty('--k', POZIOMY[d.t]?.kolor ?? '#e8f1ff');
}

// ----- rewolwer -----
// Nagant ze zdjęcia leży na stole i obraca się wokół środka ciężkości (środek pola SVG -60..60).
// Oś lufy biegnie 11,3 jednostki nad nim, wylot jest 67 jednostek przed nim.
const LUFA_Y = -11.3, WYLOT_X = 67;
let katTeraz = -24;  // stopnie, rosną bez zawijania, żeby broń zawsze obracała się krótszą drogą

function srodekRewolweru() {
  const b = $('#rewolwer').getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2, k: b.width / 120 };
}

// Kąt obrotu, przy którym przedłużenie lufy przechodzi przez środek żetonu (lufa nie leży na osi obrotu, więc to nie jest zwykły kąt do celu).
function katLufy(id) {
  const m = miejsca.get(id);
  if (!m) return 0;
  const o = srodekRewolweru(), c = m.el.querySelector('.zeton').getBoundingClientRect();
  const dx = c.left + c.width / 2 - o.x, dy = c.top + c.height / 2 - o.y;
  return Math.atan2(dy, dx) - Math.asin(Math.max(-1, Math.min(1, (LUFA_Y * o.k) / Math.hypot(dx, dy))));
}

// Czerwona linia strzału od wylotu lufy do żetonu: od razu widać, kto odpowiada.
function rysujLinie(id) {
  const linia = $('#linia'), m = miejsca.get(id);
  linia.classList.toggle('widac', !!m);
  if (!m) return;
  const a = $('#arena').getBoundingClientRect(), o = srodekRewolweru(), c = m.el.querySelector('.zeton').getBoundingClientRect(), kat = katLufy(id);
  const wx = o.x - a.left + o.k * (WYLOT_X * Math.cos(kat) - LUFA_Y * Math.sin(kat));
  const wy = o.y - a.top + o.k * (WYLOT_X * Math.sin(kat) + LUFA_Y * Math.cos(kat));
  const dx = c.left + c.width / 2 - a.left - wx, dy = c.top + c.height / 2 - a.top - wy;
  linia.style.left = wx + 'px';
  linia.style.top = wy + 'px';
  linia.style.width = Math.max(0, Math.hypot(dx, dy) - c.width * 0.62 - 3 * o.k) + 'px';
  linia.style.transform = `rotate(${Math.atan2(dy, dx)}rad) translateX(${3 * o.k}px)`;
}

function rysujRewolwer(poprz) {
  const bron = $('#rewolwer'), { faza } = S;
  const celuje = miejsca.has(S.trzyma) && (faza === 'gra' || faza === 'zmiana' || faza === 'pekniecie');
  rysujLinie(celuje ? S.trzyma : null);
  // w poczekalni i po rundzie broń leży tam, gdzie się zatrzymała
  if (!miejsca.has(S.trzyma) || faza === 'lobby' || faza === 'koniec') { bron.classList.remove('kreci'); return; }
  const cel = (katLufy(S.trzyma) * 180) / Math.PI, roznica = ((((cel - katTeraz) % 360) + 540) % 360) - 180;
  if (faza === 'odliczanie') {
    // zakręcony na stole jak butelka: kilka obrotów i zatrzymuje się lufą na pierwszej osobie
    if (poprz?.faza !== 'odliczanie') {
      bron.style.setProperty('--kat-start', katTeraz + 'deg');
      katTeraz += 1440 + roznica;
      bron.style.setProperty('--kat-koniec', katTeraz + 'deg');
      bron.style.setProperty('--kat', katTeraz + 'deg');
      potrzasnij(bron, 'kreci');
      graj('beben', 1.2) || slizg(900, 300, 2.6, 'triangle', 0.03);
    }
    return;
  }
  bron.classList.remove('kreci');
  katTeraz += roznica;
  bron.style.setProperty('--kat', katTeraz + 'deg');
  if (poprz?.trzyma !== S.trzyma && faza !== 'pekniecie') szur();  // broń przesuwa się po blacie do następnej osoby
}

// Nagant M1895 ze zdjęcia z Muzeum Straży Granicznej w Imatrze (domena publiczna), wycięty siecią BiRefNet, lufą w prawo.
// Błysk: rozżarzony rdzeń, języki ognia i ciepła łuna, która na chwilę oświetla stół wokół wylotu.
function rysujRewolwerSvg() {
  // drgania i odrzut to elementy HTML, nie grupy SVG: animacje transformacji w SVG szły na głównym wątku z przeliczeniem
  // i przerysowaniem obrazka w każdej klatce, a broń na ostatnim stopniu kurka drży sekundami. Błysk leży w drugim SVG nad bronią.
  $('#rewolwer').innerHTML = Zaufane.createHTML(`<div class="obrot"><div class="drgania"><div class="odrzut"><svg viewBox="-60 -30 120 60" aria-hidden="true">
    <image href="zasoby/rewolwer.webp" x="-44.8" y="-20.2" width="112" height="58.2"/></svg></div></div>
  <svg viewBox="-60 -30 120 60" aria-hidden="true">
    <defs>
      <radialGradient id="rdzen"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="#fff3c4"/><stop offset=".65" stop-color="#ffb347" stop-opacity=".75"/><stop offset="1" stop-color="#ff7a1a" stop-opacity="0"/></radialGradient>
      <radialGradient id="luna"><stop offset="0" stop-color="#ffd590" stop-opacity=".6"/><stop offset=".35" stop-color="#ff9a3c" stop-opacity=".22"/><stop offset="1" stop-color="#ff7a1a" stop-opacity="0"/></radialGradient>
      <filter id="plomien" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter>
    </defs>
    <circle class="wylot" cx="${WYLOT_X}" cy="${LUFA_Y}" r="1" fill="none"/>
    <g transform="translate(${WYLOT_X} ${LUFA_Y})"><g class="ogien">
      <circle r="125" fill="url(#luna)"/>
      <g filter="url(#plomien)">
        <path d="M0 0 40-10 80 0 40 10Z" fill="#ffc46b"/>
        <path d="M2 0 24-24 16-3Z M2 0 24 24 16 3Z M2 0 10-16 8-2Z M2 0 10 16 8 2Z" fill="#ff9f3d"/>
        <path d="M0 0 30-6 54 0 30 6Z" fill="#fff4d6"/>
      </g>
      <ellipse cx="12" rx="26" ry="12" fill="url(#rdzen)"/>
    </g></g>
  </svg></div>`);
}

function rysujMojeSerce(g) {
  const el = $('#moje-serce');
  el.querySelector('b').textContent = g ? g.zycia : 0;
  el.style.setProperty('--p', g ? Math.min(1, suma(g.seg || []) / S.ust.pasek) : 0);
}

// ----- poczekalnia: ustawienia jak w krillionie -----
let zasadyOtwarte = false;
function rysujLobby() {
  const host = !!G, w = S.faza === 'lobby' || S.faza === 'koniec';
  const pole = (klucz, etykieta, fmt = v => v) => h('div', { className: 'ustawienie' },
    h('span', { textContent: etykieta }),
    h('div', { className: 'krokomierz' },
      host && h('button', { type: 'button', textContent: '−', ariaLabel: etykieta + ' mniej', onclick: () => ustaw(klucz, -1) }),
      h('b', { textContent: fmt(S.ust[klucz]) }),
      host && h('button', { type: 'button', textContent: '+', ariaLabel: etykieta + ' więcej', onclick: () => ustaw(klucz, 1) })));
  const wiersz = (etykieta, tekst, klik, wylaczony = false) => h('div', { className: 'ustawienie' }, h('span', { textContent: etykieta }),
    h('button', { type: 'button', className: 'link-ustawien', textContent: tekst, disabled: wylaczony, onclick: klik }));
  $('#ustawienia').replaceChildren(
    pole('zycia', 'Serca'), pole('minTura', 'Min. tura', v => v + ' s'), pole('miejsca', 'Miejsca'),
    wiersz('Zasady pokoju', zasadyOtwarte ? 'mniej' : 'więcej', () => { zasadyOtwarte = !zasadyOtwarte; rysujLobby(); }));
  $('#zasady-serc').hidden = !zasadyOtwarte || !w;
  $('#zasady-serc').replaceChildren(...czyste([
    pole('maxZycia', 'Limit serc'), pole('pasek', 'Punkty na serce'),
    pole('boty', 'Boty', v => POZIOMY_BOTOW[v - 1]?.nazwa ?? ''),
    S.online && wiersz('Widoczność', S.ust.publiczny ? 'publiczny' : 'prywatny', () => ustaw('publiczny'), !host),
    S.online && wiersz('Wejście', S.ust.zamkniety ? 'zamknięte' : 'otwarte', () => ustaw('zamkniety'), !host)]));
  const gl = $('#glowny');
  gl.hidden = !host;
  gl.textContent = S.faza === 'koniec' ? 'Jeszcze raz' : 'Zakręć bębenkiem';
  gl.disabled = S.gracze.length < 2;
  $('#bot-plus').hidden = $('#bot-minus').hidden = !host || !w;
  $('#bot-plus').disabled = S.gracze.length >= S.ust.miejsca;
  $('#bot-minus').disabled = !S.gracze.some(g => g.bot);
  const wolne = Math.max(0, S.ust.miejsca - S.gracze.length);
  $('#gotowi-info').textContent = w ? `wolne miejsca: ${wolne}` : '';
}

// ----- czat -----
function dopiszCzat(w) {
  const box = $('#czat-wpisy');
  box.append(w.sys ? h('p', { className: 'sys', textContent: w.tekst }) : h('p', {}, h('b', { textContent: w.imie }), ' ' + w.tekst));
  while (box.children.length > 60) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
  if (!w.sys && $('#czat').hidden) $('#czat-przycisk').classList.add('nowe');
}

const linkPokoju = () => { const k = G?.sekret ?? sekretPokoju; return location.origin + location.pathname + '?pokoj=' + S.kod + (k ? '#k=' + k : ''); };
function udostepnij() {
  const url = linkPokoju();
  if (navigator.share && matchMedia('(pointer: coarse)').matches) return navigator.share({ title: 'Ruletka', text: `Wejdź do piwnicy, kod pokoju ${S.kod}`, url }).catch(() => {});
  kopiujLink();
}
// Kod QR z linkiem do pokoju (biblioteka qrcode-generator, MIT, kopia w zasoby/js): znajomi skanują ekran hosta telefonem.
let bibliotekaQr = null;
const zaladujQr = () => (bibliotekaQr ??= new Promise((ok, zle) => {
  const s = h('script', { src: Zaufane.createScriptURL('zasoby/js/qrcode.min.js'), integrity: 'sha384-lQXOAyZwHXE55JFyrOMB7nY2Wv+m5ZWNtJcHrd1rceRQXAYNLak8ukN5TjBTcIwz', crossOrigin: 'anonymous', onload: () => ok(window.qrcode), onerror: () => { bibliotekaQr = null; zle(); } });
  document.head.append(s);
}));
async function rysujZaproszenie() {
  const blok = $('#zaproszenie-gra'), widac = !!(S.online && S.kod && S.faza === 'lobby');
  blok.hidden = !widac;
  if (!widac) return;
  $('#zaproszenie-kod').textContent = S.kod;
  $('#zaproszenie-adres').textContent = location.host + location.pathname.replace(/index\.html$/, '');
  const qr = $('#qr');
  if (qr.dataset.kod === S.kod) return;
  qr.dataset.kod = S.kod;
  try {
    const q = (await zaladujQr())(0, 'M');
    q.addData(linkPokoju());
    q.make();
    qr.innerHTML = Zaufane.createHTML(q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }));
    qr.hidden = false;
  } catch { qr.hidden = true; }
}

// Ekran telefonu nie gaśnie w trakcie gry (Screen Wake Lock); przeglądarka zdejmuje blokadę, gdy karta schowa się w tle.
let blokadaEkranu = null;
async function nieGasnij() {
  if (blokadaEkranu || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    blokadaEkranu = await navigator.wakeLock.request('screen');
    blokadaEkranu.addEventListener('release', () => { blokadaEkranu = null; });
  } catch {}
}

function kopiujLink() {
  const url = linkPokoju();
  if (!navigator.clipboard) return prompt('Skopiuj link:', url);
  navigator.clipboard.writeText(url).then(() => komunikat('Skopiowano link do pokoju. Wyślij go znajomym!'), () => prompt('Skopiuj link:', url));
}

// ---------- efekty ----------
function efekt(m) {
  const miejsce = [...miejsca.values()].find(x => x.id === m.id), el = miejsce?.el;
  if (m.r === 'ok') {
    const p = POZIOMY[m.p];
    if (!p) return;
    ustawDymek(m.id, { klasa: 'ok', tekst: m.a, t: m.p, do: Date.now() + 1300 });
    melodia(MELODIE[m.p]);
    // jak w krillionie: nad graczem wylatuje nazwa poziomu przy każdej dobrej odpowiedzi
    if (miejsce) wylatuje(miejsce, p.nazwa, p.kolor);
    if (m.p === 'd' || m.p === 'k') { iskry(el, p.kolor, m.p === 'k' ? 34 : 20); potrzasnij($('#arena'), 'blysk'); }
    if (m.serce && el) {  // krillion: „+1 ♥ SPARE LIFE”, pasek na 0,7 s cały złoty
      melodia([784, 988, 1175, 1568], 'sine');
      el.classList.add('zapas');
      setTimeout(() => el.classList.remove('zapas'), 700);
      setTimeout(() => miejsce && wylatuje(miejsce, '+1 serce', '#ff6b5a'), 450);
    }
    if (m.id === ja) { $('#odp').value = ''; zapiszOdpowiedz(m.a, m.p); }
  } else if (m.r === 'zle') {
    ustawDymek(m.id, { klasa: 'zle', tekst: m.tekst, do: Date.now() + 1400 });
    if (m.powod === 'pudlo') { ton(140, 0.18, 'sawtooth', 0.05); ton(105, 0.22, 'sawtooth', 0.05, 0.07); }
    else { ton(392, 0.1, 'square', 0.04); ton(330, 0.14, 'square', 0.04, 0.1); }
    if (m.id === ja) {
      chwilowyStatus(m.powod === 'pudlo' ? `„${m.tekst}”: nie ma tego na liście, próbuj dalej.` : `„${m.tekst}”: już padło.`, 'zly', 2200);
      potrzasnij($('#formularz'));
      $('#odp').select();
    }
  } else if (m.r === 'pek') {
    strzal();
    if (m.id === ja) wibruj([120, 60, 260]);
    ustawDymek(m.id, null);
    const bron = $('#rewolwer'), wylot = bron.querySelector('.wylot');
    potrzasnij(bron, 'strzal');
    iskry(wylot, '#ffcf7a', 10);
    dymStrzalu(wylot, (katTeraz * Math.PI) / 180);
    potrzasnij($('#arena'), 'blysk');
    potrzasnij($('#arena'));
    wstrzas(m.odpada);
    if (el && !m.odpada) potrzasnij(el, 'trafiony');
    if (m.odpada) setTimeout(() => slizg(300, 60, 0.9, 'sine', 0.08), 400);  // odpada z kręgu
    chwilowyStatus(m.odpada ? `${imieGracza(m.id)} już nie odpowie.` : `Strzał. Trafiony: ${imieGracza(m.id)}.`, 'zly', m.odpada ? 2400 : ZAMROZENIE);
  } else if (m.r === 'zaliczona') {
    graj('magnetofon', 0.9);  // klik taśmy: głos z głośnika ogłasza następne pytanie
    melodia([659, 784, 988, 1319], 'triangle');
    iskry($('#karta'), '#e8b45a', 18);
  }
}

// Dym z lufy po strzale: wylatuje wzdłuż lufy, zwalnia i rozchodzi się w górę.
function dymStrzalu(el, kat) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  for (let i = 0; i < 6; i++) {
    const dal = losuj(25, 85), x = Math.cos(kat) * dal + losuj(-14, 14), y = Math.sin(kat) * dal - losuj(25, 70);
    const d = h('i', { className: 'dym-strzalu', style: `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;--dx:${x}px;--dy:${y}px;--s:${losuj(2.4, 4.2)};animation-delay:${i * 60}ms` });
    document.body.append(zniknie(d));
  }
}

// Napis wylatujący znad gracza (poziom odpowiedzi, dodatkowe serce); znika po 1,8 s jak w krillionie.
function wylatuje(miejsce, tekst, kolor) {
  miejsce.tag.textContent = tekst;
  miejsce.tag.style.setProperty('--k', kolor);
  potrzasnij(miejsce.tag, 'widac');
}

function iskry(el, kolor, ile) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  for (let i = 0; i < ile; i++) {
    const kat = Math.random() * Math.PI * 2, d = losuj(40, 170);
    const s = h('i', { className: 'iskra', style: `left:${x}px;top:${y}px;--k:${kolor};--dx:${Math.cos(kat) * d}px;--dy:${Math.sin(kat) * d}px` });
    document.body.append(zniknie(s));
  }
}

// Wstrząs po strzale: kadr szarpie, ekran błyska.
function wstrzas(mocny) {
  potrzasnij(document.body, mocny ? 'wstrzas-mocny' : 'wstrzas');
  setTimeout(() => document.body.classList.remove('wstrzas', 'wstrzas-mocny'), 900);
}

// Kreski wydrapane na ścianie: jedna za każdą kategorię tej rundy, po pięć (cztery pionowe i skośna przez nie). Rozrzut
// każdej kreski wynika z jej numeru, więc przerysowanie nic nie przesuwa, a nowa kreska wydrapuje się na oczach graczy.
const KRESKI_MAKS = 75;  // ponytail: pięć rzędów po trzy piątki; dłuższa runda już nie dopisuje kresek
let kreskiNa = -1;
function rysujKreski(ile) {
  ile = Math.min(ile, KRESKI_MAKS);
  if (ile === kreskiNa) return;
  const los = i => (((Math.sin(i * 12.9898) * 43758.5453) % 1) + 1) % 1, rozrzut = (i, o) => (los(i + o) - 0.5) * o * 10;
  const sciezki = [];
  for (let i = 0; i < ile; i++) {
    const grupa = Math.floor(i / 5), w = i % 5, x0 = (grupa % 3) * 56 + 4, y0 = Math.floor(grupa / 3) * 72 + 12;
    const d = w < 4
      ? `M${x0 + 4 + w * 12 + rozrzut(i, 0.3)} ${y0 + rozrzut(i, 0.6)}L${x0 + 4 + w * 12 + rozrzut(i, 0.4)} ${y0 + 60 + rozrzut(i, 0.6)}`
      : `M${x0 + rozrzut(i, 0.3)} ${y0 + 42 + rozrzut(i, 0.4)}L${x0 + 50 + rozrzut(i, 0.3)} ${y0 + 20 + rozrzut(i, 0.4)}`;
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    p.setAttribute('pathLength', '1');
    if (kreskiNa >= 0 && i >= kreskiNa) p.classList.add('swieza');
    sciezki.push(p);
  }
  const svg = $('.kreski');
  svg.setAttribute('viewBox', `0 0 172 ${Math.max(1, Math.ceil(ile / 15)) * 72 + 12}`);
  svg.replaceChildren(...sciezki);
  kreskiNa = ile;
}

// Ponownie odpala animację CSS przypiętą do klasy (domyślnie potrząśnięcie).
function potrzasnij(el, klasa = 'trzes') { el.classList.remove(klasa); void el.offsetWidth; el.classList.add(klasa); }

// Stopień odciągnięcia kurka 0–5 w bieżącej turze: liczba progów, które już minęły (jak level w krillionie).
function stopienPompy(minelo) {
  if (S.faza !== 'gra' || S.pauza || !Array.isArray(S.progi)) return 0;
  const sek = (S.odTury + minelo) / 1000;
  return sek < 0 ? 0 : S.progi.filter(p => sek >= p).length;
}

// Animacje zależne od czasu: odciąganie kurka, klikanie bębenka, bicie serca, pasek pod polem, odliczanie.
// Klatka liczy się tylko wtedy, gdy coś się zmienia (następny stopień kurka, uderzenie serca, cyfra odliczania, nowy stan),
// a nie przy każdym odświeżeniu ekranu: każda klatka głównego wątku przeliczała style wszystkich animacji CSS
// (zmierzone: 21% czasu wątku w grze z botami, bez tej pętli 0,8%). Klatka idzie przez requestAnimationFrame,
// więc w ukrytej karcie czeka, jak dawniej, i po powrocie nadrabia jednym kliknięciem bębenka.
let ostatniTik = 0, ostatniStopien = 0, klatkaCzas = 0, klatkaCzeka = false;
function zaplanujKlatke(za = 0) {
  clearTimeout(klatkaCzas);
  klatkaCzas = setTimeout(() => { if (!klatkaCzeka) { klatkaCzeka = true; requestAnimationFrame(klatka); } }, za);
}
function klatka(t) {
  klatkaCzeka = false;
  if (!S) return;
  const minelo = performance.now() - S._t0;
  const pasek = $('#bezpiecznie'), bron = $('#rewolwer');
  let za = Infinity;  // za ile ms następna zmiana
  if (S.faza === 'gra') {
    // kurek odciąga się skokami od nowa w każdej turze; na 5. stopniu broń drży, a ten, w kogo celuje, widzi alarm (krillion: "danger")
    const st = stopienPompy(minelo), groza = st >= 5;
    bron.classList.toggle('drzy', groza);
    document.body.classList.toggle('groza', groza && S.trzyma === ja);
    pasek.style.transform = `scaleX(${st / 5})`;
    if (st > ostatniStopien) {
      // klik bębenka przy każdym stopniu i drgnięcie broni na stole; na ostatnim odciągnięty kurek
      graj(st >= 5 ? 'kurek' : 'zapadka', st >= 5 ? 1.2 : 0.3 + 0.1 * st) || ton(2400 - 150 * st, 0.03, 'square', 0.035);
      if (st < 5) potrzasnij(bron, 'drgnie');
    }
    ostatniStopien = st;
    if (groza && t - ostatniTik > 620) { ostatniTik = t; ton(70, 0.12, 'sine', 0.25); ton(62, 0.14, 'sine', 0.2, 0.16); }  // bicie serca
    if (groza) za = 621 - (t - ostatniTik);
    else if (!S.pauza && Array.isArray(S.progi)) {
      const sek = (S.odTury + minelo) / 1000;
      za = (Math.min(...S.progi.filter(p => p > sek)) - sek) * 1000 + 5;  // Infinity, gdy kurek już na ostatnim progu
    }
  } else {
    ostatniStopien = 0;
    pasek.style.transform = 'scaleX(0)';
    bron.classList.remove('drzy');
    document.body.classList.remove('groza');
  }
  if (S.faza === 'odliczanie') {
    const o = $('#odliczanie'), n = String(Math.max(1, 3 - Math.floor((S.odFazy + minelo) / 1000)));
    if (o.textContent !== n) { o.textContent = n; potrzasnij(o, 'wyskok'); ton(660, 0.12, 'square', 0.05); }
    za = Math.min(za, 1005 - ((S.odFazy + minelo) % 1000));
  }
  if (za < Infinity) zaplanujKlatke(Math.max(0, za));
}

// ---------- komunikaty ----------
function bladStartu(tekst) {
  $('#blad').textContent = tekst;
  $('#dolacz').disabled = $('#zajmij').disabled = tekst.startsWith('Łączę');
}
let toastCzas = 0;
function komunikat(tekst) {
  const t = $('#toast');
  t.textContent = tekst;
  t.classList.add('widac');
  clearTimeout(toastCzas);
  toastCzas = setTimeout(() => t.classList.remove('widac'), 4500);
}
// Nieoczekiwany błąd w kodzie gry: raz krótki komunikat zamiast cichego zawieszenia (szczegóły w konsoli).
let bladPokazany = false;
function zgloszBlad(e) {
  console.error(e);
  if (bladPokazany) return;
  bladPokazany = true;
  komunikat('Coś poszło nie tak. Jeśli gra stanęła, odśwież stronę – wrócisz na swoje miejsce w pokoju.');
}
function rozlaczono(tekst) {
  sesja.zapisz('pokoj', '');
  $('#info-tekst').textContent = tekst;
  if (!$('#info').open) $('#info').showModal();
}

// ---------- start strony ----------
const profil = { imie: tekst(pamiec.daj('imie', ''), 16), av: WSZYSTKIE_AWATARY.includes(pamiec.daj('av')) ? pamiec.daj('av') : null };
if (!WSZYSTKIE_AWATARY.includes(profil.av)) pamiec.zapisz('av', profil.av = wybierz(AWATARY));

function rysujAwatary() {
  const dni = seria();
  const przycisk = (av, wymaga = 0) => {
    const zablokowany = dni < wymaga;
    return h('button', {
      type: 'button', className: (av === profil.av ? 'wybrany' : '') + (zablokowany ? ' zablokowany' : ''), disabled: zablokowany,
      ariaLabel: zablokowany ? `postać ${av}, odblokujesz po ${wymaga} dniach grania z rzędu` : 'postać ' + av,
      title: wymaga ? `seria ${wymaga} dni` : '',
      onclick: () => { profil.av = av; pamiec.zapisz('av', av); rysujAwatary(); },
    }, h('span', { innerHTML: Zaufane.createHTML(Twarze.svg(av)) }), wymaga > 0 && h('small', { textContent: `${wymaga} dni` }));
  };
  $('#awatary').replaceChildren(...AWATARY.map(a => przycisk(a)), ...SPECJALNE.map(s => przycisk(s.av, s.dni)));
}

function rysujStatystyki() {
  const naj = najrzadsza();
  $('#statystyki').replaceChildren(...czyste([
    h('span', {}, 'Dni z rzędu ', h('b', { textContent: seria() })),
    h('span', {}, 'Gry ', h('b', { textContent: pamiec.daj('gry', 0) })),
    h('span', {}, 'Wygrane ', h('b', { textContent: pamiec.daj('wygrane', 0) })),
    naj && h('span', {}, 'Najrzadsza ', h('b', { textContent: naj.a, style: `color:${POZIOMY[naj.t].kolor}` })),
  ]));
}

function init() {
  if (window.top !== window.self) { try { window.top.location.replace(location.href); } catch { document.body.hidden = true; } return; }
  rysujRewolwerSvg();
  // OSD kamery: licznik taśmy (nagranie trwa od kilkunastu minut) i prawdziwa data z godziną
  const odKiedy = Date.now() - Math.floor(losuj(600, 3000)) * 1000;
  const czasKamery = () => {
    const sek = Math.floor((Date.now() - odKiedy) / 1000), d = n => String(n).padStart(2, '0'), t = new Date();
    const licznik = `${Math.floor(sek / 3600)}:${d(Math.floor(sek / 60) % 60)}:${d(sek % 60)}`;
    const data = `${d(t.getDate())}.${d(t.getMonth() + 1)}.${t.getFullYear()}\n${String(t.getHours()).padStart(2, ' ')}:${d(t.getMinutes())}:${d(t.getSeconds())}`;
    for (const el of document.querySelectorAll('.osd-licznik')) el.textContent = licznik;
    for (const el of document.querySelectorAll('.osd-data')) el.textContent = data;
  };
  czasKamery();
  setInterval(czasKamery, 1000);
  // pył w snopie światła żarówki: drobinki dryfują powoli, każda własnym torem
  $('#pyl').append(...Array.from({ length: 34 }, () => h('i', { style: `left:${losuj(30, 70)}%;top:${losuj(4, 96)}%;--dx:${losuj(-40, 40)}px;--dy:${losuj(-60, 30)}px;--t:${losuj(9, 22)}s;--o:${losuj(0.25, 0.8)};animation-delay:${-losuj(0, 22)}s;width:${losuj(1, 2.6)}px` })));
  addEventListener('resize', () => { if (S) { rysujMiejsca(); rysujRewolwer(S); } });
  rysujAwatary();
  rysujStatystyki();
  const imie = $('#imie');
  imie.value = profil.imie;
  imie.oninput = () => { profil.imie = imie.value.trim(); pamiec.zapisz('imie', profil.imie); };
  $('#widocznosc-opis').textContent = 'Pokój publiczny: widać go na liście i każdy może dołączyć';
  $('#ukryj-ip').checked = ukryjIp();
  $('#ukryj-ip').onchange = e => pamiec.zapisz('ukryjIp', e.target.checked ? '1' : '0');
  $('#stworz').onclick = () => stworzPokoj(true, $('#widocznosc').checked);
  $('#boty').onclick = () => stworzPokoj(false);
  $('#szybka').onclick = szybkaGra;
  $('#dolacz').onclick = () => dolacz($('#kod').value);
  $('#kod').onkeydown = e => { if (e.key === 'Enter') dolacz($('#kod').value); };
  const zaproszony = (new URLSearchParams(location.search).get('pokoj') || '').toUpperCase().slice(0, 4);
  const sekretZLinku = new URLSearchParams(location.hash.slice(1)).get('k');
  if (/^[A-Z]{4}$/.test(zaproszony) && poprawnySekret(sekretZLinku)) sesja.zapisz('sekret', zaproszony + ':' + sekretZLinku);
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);  // sekret nie zostaje w pasku adresu
  if (zaproszony) {
    $('#kod').value = zaproszony;
    $('#kod-zaproszenia').textContent = zaproszony;
    $('#panel-zaproszenia').hidden = false;
    $('#zajmij').onclick = () => dolacz(zaproszony);
  }
  $('#legenda').replaceChildren(...Object.values(POZIOMY).map(p => h('div', { style: `--k:${p.kolor}` }, h('b', { textContent: `${p.nazwa} +${p.pkt}` }), h('span', { textContent: p.opis }))));
  $('#ile-pytan').textContent = `${Baza.ile} pytań · ${Baza.ileOdpowiedzi.toLocaleString('pl')} odpowiedzi`;
  for (const id of ['#jak', '#menu']) $(id).onclick = () => $('#zasady').showModal();
  $('#info-ok').onclick = () => { location.href = location.pathname; };
  $('#glowny').onclick = () => start();
  $('#bot-plus').onclick = () => dodajBota();
  $('#bot-minus').onclick = () => usunBota();
  $('#zapros').onclick = udostepnij;
  document.addEventListener('visibilitychange', () => { if (S) nieGasnij(); });
  $('#czat-link').onclick = kopiujLink;
  $('#formularz').onsubmit = e => {
    e.preventDefault();
    const tekst = $('#odp').value.trim();
    if (!tekst || !S) return;
    if (S.faza !== 'gra' || S.trzyma !== ja) { potrzasnij($('#formularz')); return; }
    wyslij({ t: 'odp', tekst });
  };
  $('#odp').oninput = () => {
    if (S?.faza !== 'gra' || S.trzyma !== ja) return;
    const tekst = $('#odp').value;
    wyslij({ t: 'pisze', tekst });
    ustawDymek(ja, tekst ? { klasa: 'caret', tekst } : null);
  };
  $('#czat-formularz').onsubmit = e => {
    e.preventDefault();
    const pole = $('#czat-pole');
    if (pole.value.trim()) wyslij({ t: 'czat', tekst: pole.value });
    pole.value = '';
  };
  // reakcje: paleta pod ikoną albo klawisze 1–6, gdy nie piszesz w polu
  const paleta = $('#reakcje'), wyslijReakcje = e => wyslij({ t: 'reakcja', e });
  paleta.replaceChildren(...REAKCJE.map((e, i) => h('button', { type: 'button', textContent: e, title: `klawisz ${i + 1}`, ariaLabel: 'reakcja ' + e, onclick: () => wyslijReakcje(e) })));
  addEventListener('keydown', e => {
    if (S && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName) && REAKCJE[e.key - 1]) wyslijReakcje(REAKCJE[e.key - 1]);
  });
  const czatPrzelacz = () => { $('#czat').hidden = !$('#czat').hidden; $('#czat-przycisk').classList.remove('nowe'); };
  $('#czat-przycisk').onclick = czatPrzelacz;
  $('#czat-zamknij').onclick = czatPrzelacz;
  $('#wyjdz').onclick = () => {
    if (!confirm(G?.online ? 'Wyjść z pokoju? Jako host zamkniesz go dla wszystkich.' : 'Wyjść z pokoju?')) return;
    sesja.zapisz('pokoj', ''); sesja.zapisz('host', '');
    // goście dowiadują się od razu, zamiast przez kilkanaście sekund próbować wrócić; chwila na wysłanie przed przeładowaniem
    const bylHost = G?.online;
    if (bylHost) for (const g of G.gracze) if (g.conn?.open) g.conn.send({ t: 'koniecPokoju' });
    G = null;  // pagehide nie zapisze już stanu hosta
    setTimeout(() => { location.href = location.pathname; }, bylHost ? 400 : 0);
  };
  // Skopiowanie pytania do wyszukiwarki albo czatu AI i wklejenie odpowiedzi to najprostsze oszustwo: na ekranie gry tekstu
  // nie da się zaznaczyć ani skopiować (poza polami do pisania), a w pole odpowiedzi nie da się nic wkleić ani upuścić.
  const wPolu = e => /^(INPUT|TEXTAREA)$/.test(e.target?.tagName);
  for (const z of ['copy', 'cut']) document.addEventListener(z, e => { if (!$('#gra').hidden && !wPolu(e)) e.preventDefault(); });
  for (const z of ['paste', 'drop']) $('#odp').addEventListener(z, e => e.preventDefault());
  const ikonaDzwieku = () => { $('#dzwiek').classList.toggle('wyciszony', cisza); };
  ikonaDzwieku();
  // ikona dźwięku otwiera suwaki muzyki i efektów (w tym samym miejscu co reakcje, więc jedno zamyka drugie)
  const okienko = (ktore, inne) => e => {
    $(inne).hidden = true;
    $(ktore).hidden = !$(ktore).hidden;
    for (const [p, o] of [['#dzwiek', '#glosnosc'], ['#reakcje-przycisk', '#reakcje']]) $(p).ariaExpanded = String(!$(o).hidden);
    if (ktore === '#glosnosc') odblokujDzwiek();
  };
  $('#dzwiek').onclick = okienko('#glosnosc', '#reakcje');
  $('#reakcje-przycisk').onclick = okienko('#reakcje', '#glosnosc');
  for (const k of ['muzyka', 'efekty']) {
    const suwak = $('#glosnosc-' + k);
    suwak.value = Math.round(glosnosc[k] * 100);
    suwak.oninput = () => {
      glosnosc[k] = suwak.value / 100;
      pamiec.zapisz(k, String(glosnosc[k]));
      cisza = !glosnosc.muzyka && !glosnosc.efekty;
      if (piwnica) piwnica.gain.value = glosnosc.muzyka;
      if (efekty) efekty.gain.value = glosnosc.efekty;
      ikonaDzwieku();
      odblokujDzwiek();
    };
    if (k === 'efekty') suwak.onchange = () => ton(660, 0.09, 'triangle', 0.08);  // próbka głośności po puszczeniu suwaka
  }
  addEventListener('pointerdown', odblokujDzwiek);
  addEventListener('keydown', odblokujDzwiek);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register(Zaufane.createScriptURL('sw.js')).catch(() => {});
  odswiezPokoje();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !$('#start').hidden) odswiezPokoje(); });  // po powrocie do karty lista od razu świeża
  if (!cisza) setTimeout(pobierzDzwieki, 0);
  // plik PeerJS pobiera się w tle bez wykonania, żeby pokój przez internet nie czekał na CDN
  if (!ukryjIp()) setTimeout(() => document.head.append(Object.assign(document.createElement('link'), { rel: 'prefetch', as: 'script', href: PEERJS.src, crossOrigin: 'anonymous' })), 2500);
  addEventListener('error', e => { if (/\/(gra|logika|przekaznik)\.js/.test(e.filename || '')) zgloszBlad(e.error || e.message); });
  addEventListener('offline', () => komunikat('Nie ma internetu. Gra z botami działa dalej, pokój online wróci, gdy sieć wróci.'));
  addEventListener('online', () => { if (S?.online) komunikat('Internet wrócił.'); });
  // host: ostatni stan na wypadek odświeżenia; pokój publiczny znika z listy, a po powrocie hosta ogłasza się od nowa
  addEventListener('pagehide', () => {
    if (!G) return;
    zapiszHosta(true);
    if (G.ust.publiczny && G.kod) navigator.sendBeacon(TABLICA, daneOgloszenia(true));
  });
  const wracam = sesja.daj('pokoj');
  // nowy link z innym kodem pokoju wygrywa z powrotem do poprzedniego pokoju z tej karty
  if (!przywrocHosta() && wracam && (!zaproszony || zaproszony === wracam)) dolacz(wracam);
  // test odporności (chaos.js leży tylko w repozytorium, na stronie go nie ma)
  if (LOKALNIE && new URLSearchParams(location.search).has('chaos')) import('./chaos.js').catch(e => console.error('chaos.js:', e));
}

// Pytania i odpowiedzi przychodzą spakowane w zasoby/dane.bin (pakuj.js), nie jako czytelne pliki JS.
async function wczytajDane(proba = 0) {
  if (typeof DecompressionStream !== 'function') throw new Error('stara przeglądarka');
  const odp = await fetch('zasoby/dane.bin').catch(e => (proba < 2 ? null : Promise.reject(e)));
  if (!odp?.ok) {
    if (proba < 2) { await new Promise(r => setTimeout(r, 1500 * (proba + 1))); return wczytajDane(proba + 1); }
    throw new Error('HTTP ' + odp?.status);
  }
  const bajty = przeksztalcDane(new Uint8Array(await odp.arrayBuffer()));
  const strumien = new Blob([bajty]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  Baza.zaladuj(JSON.parse(await new Response(strumien).text()));
}
// Testy (test-przegladarka.mjs, chaos.js) zaglądają do środka gry tylko na localhost; na prawdziwej stronie z modułu gra.js
// nic nie wystaje do konsoli (?produkcja wyłącza to także lokalnie, do sprawdzenia).
if (LOKALNIE && !new URLSearchParams(location.search).has('produkcja')) {
  const zmienne = { G: () => G, S: () => S, ja: () => ja, doHosta: () => doHosta, peer: () => peer, kontrola: () => kontrola, oszustwo: () => oszustwo,
    nieprzedstawione: () => nieprzedstawione, Baza: () => Baza, sekretPokoju: () => sekretPokoju, polaczenieZweryfikowane: () => polaczenieZweryfikowane, przekaznikPokoju: () => przekaznikPokoju };
  for (const [nazwa, daj] of Object.entries(zmienne)) Object.defineProperty(globalThis, nazwa, { get: daj, configurable: true });
  Object.assign(globalThis, { $, doHostaOd, przyjmijPolaczenie, podpis, losowySekret, odciski, linkPokoju, dolacz, stworzPokoj, dodajBota, usunBota, start,
    wyslij, ustaw, wczytajPeerJS, opcjePeerJS, sprawdzPodpisHosta, kluczPytania, widok, nowePytanie, WERSJA });
}

wczytajDane().catch(e => bladStartu(e.message === 'stara przeglądarka'
  ? 'Ta przeglądarka jest za stara na grę (brakuje DecompressionStream). Zaktualizuj ją albo użyj innej.'
  : 'Nie udało się wczytać pytań. Odśwież stronę.')).finally(init);
