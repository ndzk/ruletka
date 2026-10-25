'use strict';
// Przekaźnik zapasowy: gdy bezpośrednie połączenie WebRTC nie wyjdzie (np. telefon w sieci komórkowej za podwójnym NAT-em),
// gość i host wymieniają te same wiadomości przez publiczny broker MQTT po WebSocket. Darmowe, bez konta i bez naszego serwera.
// Host słucha naraz na kilku brokerach, gość bierze pierwszy, który u niego działa (filtry DNS blokują niektóre adresy).
// Każde połączenie ma własny klucz AES-GCM z wymiany ECDH, więc ktoś, kto tylko podsłuchuje temat na brokerze, nic nie odczyta.
// Przed aktywnym atakiem w środku (podmiana kluczy) to nie chroni: dlatego przekaźnik jest tylko zapasem, a gość i tak sprawdza hosta.
// Każda wiadomość ma w szyfrogramie numer kolejny, więc przechwyconej ramki nie da się odtworzyć drugi raz (np. „pa”, które
// rozłączało gościa, albo zdublowana wiadomość na czacie).
const Przekaznik = (() => {
  const BROKERY = [
    { url: 'wss://public.cloud.shiftr.io/mqtt', login: 'public', haslo: 'public' },
    { url: 'wss://mqtt-dashboard.com:8884/mqtt' },
    { url: 'wss://broker.hivemq.com:8884/mqtt' },
    { url: 'wss://broker.emqx.io:8084/mqtt' },
  ];
  const TEMAT = pokoj => 'ruletka/' + pokoj;  // pokoj = nazwa z gra.js (PREFIKS + kod), osobna dla kopii na localhost
  const CISZA = 8000;         // tyle bez żadnej wiadomości i połączenie uznajemy za zerwane
  const PING = 2000;          // gość daje znak życia co 2 s, host odpowiada
  const MAKS_POLACZEN = 32;   // host nie trzyma więcej obcych sesji naraz
  const NOWE_NA_SEKUNDE = 5;  // więcej powitań z nowymi sesjami na sekundę to zalew (każde to wymiana kluczy)
  const RAMEK_NA_SEKUNDE = 100;  // id sesji widać na brokerze, więc ktoś może zalać ją ramkami do odszyfrowania; gra wysyła kilka na sekundę
  const zaDuzo = s => { const t = Date.now(); if (t - (s.oknoRamek || 0) > 1000) { s.oknoRamek = t; s.ramek = 0; } return ++s.ramek > RAMEK_NA_SEKUNDE; };
  const enc = new TextEncoder(), dec = new TextDecoder();
  const losowe = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => (b % 36).toString(36)).join('');
  // błąd w kodzie gry wywołanym z wiadomości nie może zatrzymać kolejki odbioru, ale ma być widoczny (window 'error')
  const zglos = e => setTimeout(() => { throw e; });

  // Zegary przekaźnika tykają z workera (tik.js): w karcie w tle zwykłe timery zwalniają nawet do raz na minutę,
  // a wtedy broker zrywa połączenie bez pingu, a druga strona po 8 s ciszy uznaje nas za martwych.
  const zegary = new Set();
  let tykacz = false;
  const tyk = () => { const t = Date.now(); for (const z of zegary) if (t >= z.nast) { z.nast = t + z.ms; try { z.fn(); } catch (e) { zglos(e); } } };
  function co(ms, fn) {
    if (!tykacz) {
      tykacz = true;
      try { const w = new Worker(globalThis.Zaufane ? Zaufane.createScriptURL('tik.js') : 'tik.js'); w.onmessage = tyk; w.onerror = () => { w.terminate(); setInterval(tyk, 100); }; }
      catch { setInterval(tyk, 100); }  // bez workerów (np. Node w teście)
    }
    const z = { ms, fn, nast: Date.now() + ms };
    zegary.add(z);
    return () => zegary.delete(z);
  }

  // ---------- minimalny klient MQTT 3.1.1 (QoS 0: CONNECT, SUBSCRIBE, PUBLISH, PINGREQ) ----------
  const napis = s => { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
  const dlugosc = n => { const o = []; do { let x = n % 128; n = Math.floor(n / 128); if (n) x |= 128; o.push(x); } while (n); return o; };
  const pakiet = (typ, ...czesci) => {
    const tresc = czesci.flatMap(c => (c instanceof Uint8Array ? [...c] : c));
    return new Uint8Array([typ, ...dlugosc(tresc.length), ...tresc]);
  };
  function klient({ url, login, haslo }, { gotowy, wiadomosc, koniec }) {
    let ws, bufor = new Uint8Array(0), stopPing = () => {}, nrPakietu = 0, zywy = true, polaczony = false;
    const tematy = new Set();
    const wyslij = b => { if (ws?.readyState === 1) ws.send(b); };
    const zamknij = () => { zywy = false; stopPing(); clearTimeout(czekaj); try { ws?.close(); } catch {} };
    // broker, który przyjął WebSocket, ale milczy, nie trzyma nas w zawieszeniu: bez CONNACK w 10 s próbujemy od nowa
    const czekaj = setTimeout(() => { if (!polaczony && zywy) { zamknij(); koniec?.(); } }, 10000);
    const subskrybuj = t => { tematy.add(t); wyslij(pakiet(0x82, [0, (++nrPakietu % 65535) + 1], napis(t), [0])); };
    try { ws = new WebSocket(url, 'mqtt'); } catch { setTimeout(() => koniec?.(), 0); return { zamknij, subskrybuj, publikuj() {} }; }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      const flagi = 2 | (login ? 0x80 : 0) | (haslo ? 0x40 : 0);
      wyslij(pakiet(0x10, napis('MQTT'), [4, flagi, 0, 30], napis('rt' + losowe(10)), login ? napis(login) : [], haslo ? napis(haslo) : []));
    };
    ws.onmessage = e => {
      const nowe = new Uint8Array(e.data), b = new Uint8Array(bufor.length + nowe.length);
      b.set(bufor); b.set(nowe, bufor.length); bufor = b;
      for (;;) {  // w jednej ramce WebSocket może być kilka pakietów albo kawałek jednego
        let i = 1, mnoznik = 1, dl = 0, bajt;
        do { if (i >= bufor.length) return; bajt = bufor[i++]; dl += (bajt & 127) * mnoznik; mnoznik *= 128; } while (bajt & 128 && i < 5);
        if (dl > 1 << 20) { zamknij(); return koniec?.(); }  // nasze wiadomości mają kilka kB; olbrzymia długość to śmieci
        if (bufor.length < i + dl) return;
        const typ = bufor[0], tresc = bufor.subarray(i, i + dl);
        bufor = bufor.slice(i + dl);
        if (typ === 0x20) {
          if (tresc[1] !== 0) { zamknij(); return koniec?.(); }
          polaczony = true;
          clearTimeout(czekaj);
          stopPing = co(20000, () => wyslij(new Uint8Array([0xc0, 0])));
          for (const t of tematy) subskrybuj(t);
          gotowy?.();
        } else if ((typ & 0xf0) === 0x30) {
          const dlT = (tresc[0] << 8) | tresc[1], qos = (typ >> 1) & 3, start = 2 + dlT + (qos ? 2 : 0);
          wiadomosc?.(dec.decode(tresc.subarray(2, 2 + dlT)), tresc.slice(start));
        }
      }
    };
    ws.onclose = () => { stopPing(); clearTimeout(czekaj); if (zywy) { zywy = false; koniec?.(); } };
    return {
      zamknij,
      subskrybuj(t) { if (polaczony) subskrybuj(t); else tematy.add(t); },  // przed CONNACK broker nie przyjmie SUBSCRIBE
      publikuj: (t, dane) => wyslij(pakiet(0x30, napis(t), dane)),
    };
  }

  // ---------- szyfrowanie: ECDH P-256 -> klucz AES-GCM dla jednej sesji ----------
  // Ramka: 1 bajt rodzaju (1 = powitanie gościa, 2 = odpowiedź hosta, 3 = szyfrogram), 12 znaków id sesji, reszta.
  const PARA = () => crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  const publiczny = async para => new Uint8Array(await crypto.subtle.exportKey('raw', para.publicKey));
  async function wspolnyKlucz(para, obcy) {
    const klucz = await crypto.subtle.importKey('raw', obcy, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    return crypto.subtle.deriveKey({ name: 'ECDH', public: klucz }, para.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  const ramka = (rodzaj, sid, reszta) => { const b = new Uint8Array(13 + reszta.length); b[0] = rodzaj; b.set(enc.encode(sid), 1); b.set(reszta, 13); return b; };
  async function zaszyfruj(klucz, sid, obiekt) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const szyfr = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, klucz, enc.encode(JSON.stringify(obiekt))));
    const reszta = new Uint8Array(12 + szyfr.length); reszta.set(iv); reszta.set(szyfr, 12);
    return ramka(3, sid, reszta);
  }
  const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  const odszyfruj = async (klucz, reszta) => JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: reszta.subarray(0, 12) }, klucz, reszta.subarray(12))));
  // wysyłki jednej sesji gęsiego: numer kolejny i publikacja zawsze w tej samej kolejności (mały ping szyfrowany szybciej niż
  // duży stan gry nie może go wyprzedzić, bo odbiorca odrzuciłby wtedy stan jako starszy)
  const gesiego = () => { let ogon = Promise.resolve(); return fn => { const p = ogon.then(fn); ogon = p.catch(() => {}); return p; }; };
  const rozbierz = b => (b.length >= 13 && b[0] >= 1 && b[0] <= 3 ? { rodzaj: b[0], sid: dec.decode(b.subarray(1, 13)), reszta: b.subarray(13) } : null);

  // Obiekt połączenia udaje DataConnection z PeerJS (open, send, close, on('data' | 'close')), więc gra obsługuje oba tak samo.
  function polaczenie(wyslijObiekt, sprzataj) {
    const sluchacze = {};
    let kolejka = Promise.resolve();
    const c = {
      open: true, przekaznik: true,
      on(zd, fn) { (sluchacze[zd] ??= []).push(fn); return c; },
      emit(zd, x) { for (const fn of sluchacze[zd] ?? []) fn(x); },
      // szyfrowanie jest asynchroniczne, więc wysyłki idą gęsiego, żeby nie zmienić kolejności wiadomości
      send(m) { if (c.open) kolejka = kolejka.then(() => wyslijObiekt({ k: 'd', m })).catch(() => {}); },
      close() {
        if (!c.open) return;
        c.open = false;
        kolejka.then(() => wyslijObiekt({ k: 'pa' })).catch(() => {}).finally(sprzataj);
        c.emit('close');
      },
    };
    return c;
  }

  // ---------- host: słucha na wszystkich brokerach, dla każdego gościa osobna sesja ----------
  function nasluchuj(kod, nowePolaczenie) {
    const temat = TEMAT(kod), sesje = new Map();
    let para = null, zamkniety = false, okno = 0, noweWOknie = 0;
    const klienci = [];
    const start = async () => {
      para = await PARA();
      const mojKlucz = await publiczny(para);
      BROKERY.forEach((b, nr) => {
        const podlacz = (przerwa = 2000) => {
          if (zamkniety) return;
          const k = klienci[nr] = klient(b, {
            gotowy: () => { przerwa = 2000; },
            koniec: () => setTimeout(() => podlacz(Math.min(60000, przerwa * 2)), przerwa),  // broker padł: wracamy coraz rzadziej
            wiadomosc: (_, dane) => odebrano(k, dane, mojKlucz),
          });
          k.subskrybuj(temat + '/h');
        };
        podlacz();
      });
    };
    async function odebrano(k, dane, mojKlucz) {
      const r = rozbierz(dane);
      if (!r || !/^[a-z0-9]{12}$/.test(r.sid)) return;
      let s = sesje.get(r.sid);
      if (r.rodzaj === 1 && r.reszta.length === 65) {  // powitanie (gość powtarza je, póki nie dostanie odpowiedzi)
        if (!s) {
          if (sesje.size >= MAKS_POLACZEN) return;
          const t = Date.now();
          if (t - okno > 1000) { okno = t; noweWOknie = 0; }
          if (++noweWOknie > NOWE_NA_SEKUNDE) return;
          if (sesje.size >= MAKS_POLACZEN) {
            // pełno: miejsce zwalnia najstarsza sesja, która jeszcze nie należy do żadnego gracza (zalew fałszywymi powitaniami)
            const obca = [...sesje].filter(([, x]) => !x.conn.graczId).sort((a, b) => a[1].od - b[1].od)[0];
            if (!obca) return;
            sesje.delete(obca[0]); obca[1].conn.close();
          }
          s = { klient: k, od: t, ostatnio: t, odbior: Promise.resolve(), nrWy: 0, nrWe: 0, kolejka: gesiego() };
          sesje.set(r.sid, s);
          s.klucz = wspolnyKlucz(para, r.reszta.slice());
          const tematGoscia = `${temat}/g/${r.sid}`;
          // gość wita się na wszystkich brokerach, a zostaje na jednym: odpowiadamy tam, skąd przyszła jego ostatnia wiadomość
          s.wyslij = o => s.kolejka(async () => s.klient.publikuj(tematGoscia, await zaszyfruj(await s.klucz, r.sid, { ...o, n: ++s.nrWy })));
          s.conn = polaczenie(s.wyslij, () => sesje.delete(r.sid));
          s.conn.odciski = { moj: hex(mojKlucz), obcy: hex(r.reszta) };  // do podpisu sekretem pokoju (gra.js)
          s.klucz.then(() => nowePolaczenie(s.conn)).catch(() => sesje.delete(r.sid));
        }
        k.publikuj(`${temat}/g/${r.sid}`, ramka(2, r.sid, mojKlucz));
      } else if (r.rodzaj === 3 && s) {
        if (zaDuzo(s)) return;
        const reszta = r.reszta.slice();
        s.odbior = s.odbior.then(async () => {
          let o;
          try { o = await odszyfruj(await s.klucz, reszta); } catch { return; }  // śmieci albo cudzy klucz: ignorujemy
          if (!o || typeof o !== 'object' || !Number.isSafeInteger(o.n) || o.n <= s.nrWe) return;  // powtórzona albo zła ramka
          s.nrWe = o.n;
          s.ostatnio = Date.now();
          s.klient = k;
          if (o.k === 'd') s.conn.emit('data', o.m);
          else if (o.k === 'ping') s.wyslij({ k: 'ping' }).catch(() => {});
          else if (o.k === 'pa') { s.conn.open = false; sesje.delete(r.sid); s.conn.emit('close'); }
        }).catch(zglos);
      }
    }
    const stopStraz = co(1000, () => {
      for (const [sid, s] of sesje) if (Date.now() - s.ostatnio > CISZA) { sesje.delete(sid); if (s.conn.open) { s.conn.open = false; s.conn.emit('close'); } }
    });
    start().catch(() => {});
    return { zamknij() { zamkniety = true; stopStraz(); for (const s of sesje.values()) s.conn.close(); klienci.forEach(k => k?.zamknij()); } };
  }

  // ---------- gość: pierwszy broker, przez który host odpowie, wygrywa ----------
  function polacz(kod, limit = 6000) {
    return new Promise((ok, zle) => {
      const temat = TEMAT(kod), sid = losowe(12), klienci = [];
      let gotowe = false, powitanie = null;
      const koniecProby = setTimeout(() => { if (!gotowe) { gotowe = true; klienci.forEach(k => k.zamknij()); zle(new Error('brak odpowiedzi')); } }, limit);
      PARA().then(async para => {
        powitanie = ramka(1, sid, await publiczny(para));
        BROKERY.forEach(b => {
          let stopPowitania = () => {};
          const k = klient(b, {
            gotowy: () => { const wyslij = () => !gotowe && k.publikuj(temat + '/h', powitanie); wyslij(); stopPowitania = co(1000, wyslij); },
            koniec: () => { stopPowitania(); k.poZerwaniu?.(); },
            wiadomosc: async (_, dane) => {
              const r = rozbierz(dane);
              if (!r || r.sid !== sid || gotowe) return k.odbierz?.(r);
              if (r.rodzaj !== 2 || r.reszta.length !== 65) return;
              gotowe = true;
              clearTimeout(koniecProby);
              stopPowitania();
              klienci.filter(x => x !== k).forEach(x => x.zamknij());
              try { ok(await sesja(k, sid, `${temat}/h`, await wspolnyKlucz(para, r.reszta.slice()), { moj: hex(powitanie.subarray(13)), obcy: hex(r.reszta) })); } catch (e) { k.zamknij(); zle(e); }
            },
          });
          k.subskrybuj(`${temat}/g/${sid}`);
          klienci.push(k);
        });
      }).catch(e => { if (!gotowe) { gotowe = true; clearTimeout(koniecProby); zle(e); } });
    });
  }
  // Ustalona sesja gościa: odbiór po kolei, ping co 2 s, cisza od hosta przez 8 s = zerwane.
  function sesja(k, sid, tematHosta, klucz, odciski) {
    let ostatnio = Date.now(), odbior = Promise.resolve(), stopZegar = () => {}, nrWy = 0, nrWe = 0;
    const kolejka = gesiego(), wyslij = o => kolejka(async () => k.publikuj(tematHosta, await zaszyfruj(klucz, sid, { ...o, n: ++nrWy })));
    const conn = polaczenie(wyslij, () => { stopZegar(); k.zamknij(); });
    conn.odciski = odciski;
    const koniec = () => { if (!conn.open) return; conn.open = false; stopZegar(); k.zamknij(); conn.emit('close'); };
    const licznik = {};
    k.odbierz = r => {
      if (!r || r.sid !== sid || r.rodzaj !== 3 || zaDuzo(licznik)) return;
      const reszta = r.reszta.slice();
      odbior = odbior.then(async () => {
        let o;
        try { o = await odszyfruj(klucz, reszta); } catch { return; }
        if (!o || typeof o !== 'object' || !Number.isSafeInteger(o.n) || o.n <= nrWe) return;  // powtórzona albo zła ramka
        nrWe = o.n;
        ostatnio = Date.now();
        if (o.k === 'd') conn.emit('data', o.m);
        else if (o.k === 'pa') koniec();
      }).catch(zglos);
    };
    k.poZerwaniu = koniec;  // broker zerwał WebSocket: nie czekamy 8 s ciszy
    stopZegar = co(PING, () => {
      if (Date.now() - ostatnio > CISZA) return koniec();
      wyslij({ k: 'ping' }).catch(() => {});
    });
    return conn;
  }

  return { nasluchuj, polacz, dostepny: !!(globalThis.WebSocket && globalThis.crypto?.subtle) };
})();
