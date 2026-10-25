// Wspólna logika odpowiedzi. Działa w przeglądarce i w Node (test.js).

// W Node (pakuj.js, test.js) pliki z katalogu kategorie/ dopisują się do tej listy (KATEGORIE.push). W przeglądarce jej nie ma:
// gra trzyma pytania w module gra.js, poza zasięgiem konsoli.
if (typeof module === 'object') globalThis.KATEGORIE ??= [];

// Trusted Types (CSP require-trusted-types-for): przeglądarka przyjmuje do innerHTML i do adresów skryptów i workerów tylko
// to, co przeszło przez tę politykę. HTML pochodzi wyłącznie z rysunków w kodzie gry (twarze, rewolwer, kod QR) i nie może
// mieć skryptów ani atrybutów zdarzeń; skrypty tylko z listy. Przypadkowy innerHTML z danymi z sieci rzuci błąd, zamiast się wykonać.
const ZAUFANE_SKRYPTY = ['tik.js', 'sw.js', 'zasoby/js/peerjs.min.js', 'zasoby/js/qrcode.min.js'];
const zaufaneReguly = {
  createHTML: s => { if (/<script|<iframe|<object|<embed|<foreignObject|\son\w+\s*=|javascript:|href\s*=\s*"(?!zasoby\/)/i.test(s)) throw new TypeError('niedozwolony HTML'); return s; },
  createScriptURL: u => { if (!ZAUFANE_SKRYPTY.includes(u)) throw new TypeError('niedozwolony skrypt: ' + u); return u; },
};
globalThis.Zaufane ??= globalThis.trustedTypes?.createPolicy ? trustedTypes.createPolicy('ruletka', zaufaneReguly) : zaufaneReguly;

const POZIOMY = {
  p: { nazwa: 'Banał', emoji: '🃏', pkt: 10, kolor: '#b0a590', opis: 'Odpowiedź, którą każdy wypala pierwszą.' },
  t: { nazwa: 'Blef', emoji: '🎭', pkt: 15, kolor: '#e08a3a', opis: 'Niby sprytne, a wpada na to każdy.' },
  s: { nazwa: 'Pewniak', emoji: '🎲', pkt: 30, kolor: '#6fc0b0', opis: 'Solidnie, bez wstydu.' },
  r: { nazwa: 'As w rękawie', emoji: '♠️', pkt: 60, kolor: '#e0524a', opis: 'Naprawdę nietypowe. Ładnie.' },
  d: { nazwa: 'Czarny koń', emoji: '🐎', pkt: 85, kolor: '#a98bff', opis: 'Mało kto tak gra.' },
  k: { nazwa: 'Złota kula', emoji: '🌟', pkt: 100, kolor: '#f2c14e', opis: 'Jedna na milion.' },
};

// Małe litery, bez polskich znaków, bez spacji i interpunkcji: "Łódź" i "lodz" to to samo.
// Plus i krzyżyk zostają jako litery, żeby C, C++ i C# były różnymi odpowiedziami.
const norm = s => String(s).toLowerCase().replace(/ł/g, 'l').replace(/\+/g, 'p').replace(/#/g, 's').normalize('NFD').replace(/[^a-z0-9]/g, '');

// Rozkłada teksty kategorii na listę { a: wyświetlana nazwa, t: poziom, klucze: [...] }. Wynik zostaje w kategorii.
function odpowiedzi(kat) {
  if (!kat._odp) {
    kat._odp = Object.keys(POZIOMY).flatMap(t => (kat[t] || '').split(',').map(s => s.trim()).filter(Boolean).map(s => {
      const warianty = s.split('/').map(w => w.trim());
      return { a: warianty[0], t, klucze: warianty.map(norm) };
    }));
  }
  return kat._odp;
}

// Odległość edycyjna z zamianą sąsiednich liter ("pszczoal" -> "pszczola" to jedna pomyłka).
// Liczy tylko do `limit`; gdy wyjdzie więcej, zwraca limit + 1.
function odleglosc(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let przed = null, wiersz = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const nowy = [i];
    let min = i;
    for (let j = 1; j <= b.length; j++) {
      nowy[j] = Math.min(wiersz[j] + 1, nowy[j - 1] + 1, wiersz[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (przed && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) nowy[j] = Math.min(nowy[j], przed[j - 2] + 1);
      min = Math.min(min, nowy[j]);
    }
    if (min > limit) return limit + 1;
    przed = wiersz;
    wiersz = nowy;
  }
  return wiersz[b.length];
}

// Ile pomyłek wybaczamy: krótkie słowa muszą być dokładne, od 5 liter jedna, od 10 liter dwie.
const tolerancja = dlugosc => dlugosc >= 10 ? 2 : dlugosc >= 5 ? 1 : 0;

// Indeks pasującej odpowiedzi albo -1. Literówkę wybaczamy tylko wtedy, gdy pasuje do jednej odpowiedzi.
// Gdy odpowiedź nie pasuje, próbujemy jeszcze bez tytułu na początku: "św. Wojciech", "król Julian", "komisarz Rex".
const TYTUL = /^\s*(św|święt[yaeo]j?|bł|błogosławion[ya]|król(owa)?|królewna|królewicz|książę|księżna|księżniczka|cesarz(owa)?|car|papież|pan|pani|dr|doktor|prof|profesor|komisarz|inspektor|detektyw|porucznik|kapitan|sir|lord|lady|saint|st)[.\s]+/iu;
function dopasuj(kat, tekst) {
  const i = szukaj(kat, tekst);
  return i < 0 && TYTUL.test(tekst) ? dopasuj(kat, String(tekst).replace(TYTUL, '')) : i;
}

function szukaj(kat, tekst) {
  const n = norm(tekst), odp = odpowiedzi(kat);
  if (!n) return -1;
  const i = odp.findIndex(o => o.klucze.includes(n));
  const limit = tolerancja(n.length);
  if (i >= 0 || !limit) return i;
  const blisko = odp.flatMap((o, j) => o.klucze.some(k => k.length >= 5 && odleglosc(k, n, limit) <= limit) ? [j] : []);
  return blisko.length === 1 ? blisko[0] : -1;
}

// Dane gry w zasoby/dane.bin są spakowane (deflate) i przepuszczone przez XOR ze strumieniem z ziarna (pakuj.js), żeby odpowiedzi
// nie dało się wyczytać z plików strony ani znaleźć wyszukiwarką w narzędziach przeglądarki. To zaciemnienie, nie szyfr:
// klucz leży tutaj, więc ktoś z debugerem dane odkoduje. Ta sama funkcja koduje i odkodowuje.
function przeksztalcDane(bajty) {
  const wynik = new Uint8Array(bajty.length);
  let x = 0x52554c45;  // "RULE"
  for (let i = 0; i < bajty.length; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    wynik[i] = bajty[i] ^ (x & 0xff);
  }
  return wynik;
}

// W Node pliki kategorii widzą te nazwy tak jak w przeglądarce, czyli globalnie.
if (typeof module === 'object') Object.assign(globalThis, module.exports = { POZIOMY, norm, odpowiedzi, odleglosc, dopasuj, przeksztalcDane });
