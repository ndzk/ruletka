// Service worker: kod gry i pytania zawsze z sieci (żeby nowe wersje docierały od razu), a bez internetu z pamięci.
// Obrazy, dźwięki i czcionki (zasoby/ poza dane.bin i bibliotekami) przy kolejnej wizycie od razu z pamięci, a świeża kopia
// dochodzi w tle: nie wpływają na zgodność hosta z gośćmi, a strona nie czeka na kilkanaście odpowiedzi 304.
// Wszystko, co gra raz wczytała, zostaje w pamięci, więc po pierwszej wizycie gra z botami działa offline.
// Obce adresy (lista pokoi na Supabase i ntfy.sh, serwer PeerJS, brokerzy przekaźnika) idą zawsze prosto do sieci.
const PAMIEC = 'ruletka-v6';

self.addEventListener('install', () => self.skipWaiting());
// stare pamięci (np. z kopiami bibliotek z jsDelivr sprzed przeniesienia do zasoby/js) do kosza
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== PAMIEC).map(n => caches.delete(n)))).then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const zadanie = e.request;
  if (zadanie.method !== 'GET') return;
  const url = new URL(zadanie.url);
  if (url.origin !== self.location.origin) return;
  // strona (z ?pokoj=... albo bez) leży w pamięci pod jednym adresem, żeby każdy link zaproszenia nie dokładał kopii
  const klucz = zadanie.mode === 'navigate' ? url.origin + url.pathname : zadanie;
  const zapisz = odp => {
    const kopia = odp.clone();
    caches.open(PAMIEC).then(c => c.put(klucz, kopia));
    return odp;
  };
  // własne pliki zawsze z potwierdzeniem świeżości (304 kosztuje grosze): bez tego GitHub Pages pozwala trzymać je 10 min,
  // a host i goście z różnymi wersjami gry to proszenie się o kłopoty
  const swiezo = zadanie.mode === 'navigate' ? zadanie : new Request(zadanie, { cache: 'no-cache' });
  // biblioteki (zasoby/js) mają sumy SRI w gra.js: stara kopia z pamięci przy nowym gra.js by się nie wczytała, więc idą jak kod
  if (/\/zasoby\//.test(url.pathname) && !url.pathname.endsWith('/dane.bin') && !url.pathname.includes('/zasoby/js/')) {
    const zSieci = fetch(swiezo).then(o => (o.ok ? zapisz(o) : o));
    e.respondWith(caches.match(zadanie).then(w => {
      if (!w) return zSieci;
      e.waitUntil(zSieci.catch(() => {}));
      return w;
    }));
    return;
  }
  e.respondWith(fetch(swiezo).then(o => (o.ok ? zapisz(o) : o)).catch(() => caches.match(klucz).then(w => w ?? caches.match(zadanie, { ignoreSearch: true }))));
});
