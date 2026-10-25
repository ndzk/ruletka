'use strict';
// Zakładnicy mają na głowach papierowe torby, a porywacz nabazgrał na nich twarze markerem. Postać wybiera się dalej emoji
// (tak idzie przez sieć i tak zapisuje się w przeglądarce), a tu każde emoji zamienia się w rysunek: dziury na oczy
// z połyskiem w środku (ktoś tam jest) i kreski markera, lekko drżące jak odręczne.
const Twarze = (() => {
  // powtarzalny „los”, żeby ta sama postać zawsze wyglądała tak samo
  const ziarno = s => { let n = 7; for (const c of s) n = (n * 31 + c.codePointAt(0)) >>> 0; return () => ((n = (n * 1103515245 + 12345) >>> 0) / 4294967296); };
  const z1 = x => Math.round(x * 10) / 10;

  // nierówna elipsa (dziura wycięta nożyczkami albo kółko narysowane ręką)
  function owal(r, cx, cy, rx, ry, drzenie = 0.12) {
    const n = 10, p = [];
    for (let i = 0; i < n; i++) {
      const k = (i / n) * Math.PI * 2, d = 1 + (r() - 0.5) * drzenie * 2;
      p.push([cx + Math.cos(k) * rx * d, cy + Math.sin(k) * ry * d]);
    }
    // gładka krzywa przez punkty (Catmull-Rom na Béziera)
    let s = `M${z1(p[0][0])} ${z1(p[0][1])}`;
    for (let i = 0; i < n; i++) {
      const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n], d = p[(i + 2) % n];
      s += `C${z1(b[0] + (c[0] - a[0]) / 6)} ${z1(b[1] + (c[1] - a[1]) / 6)} ${z1(c[0] - (d[0] - b[0]) / 6)} ${z1(c[1] - (d[1] - b[1]) / 6)} ${z1(c[0])} ${z1(c[1])}`;
    }
    return s + 'Z';
  }
  // kreska markera przez punkty, każdy lekko przesunięty
  function kreska(r, punkty, drzenie = 0.8) {
    const p = punkty.map(([x, y]) => [x + (r() - 0.5) * drzenie, y + (r() - 0.5) * drzenie]);
    let s = `M${z1(p[0][0])} ${z1(p[0][1])}`;
    for (let i = 1; i < p.length; i++) {
      const [x0, y0] = p[i - 1], [x1, y1] = p[i];
      s += `Q${z1((x0 + x1) / 2 + (r() - 0.5) * drzenie)} ${z1((y0 + y1) / 2 + (r() - 0.5) * drzenie)} ${z1(x1)} ${z1(y1)}`;
    }
    return s;
  }
  const dziura = (r, cx, cy, rx, ry) =>
    `<path class="dziura" d="${owal(r, cx, cy, rx, ry, 0.16)}"/><circle class="blysk" cx="${z1(cx - rx * 0.25)}" cy="${z1(cy - ry * 0.2)}" r="${z1(Math.min(rx, ry) * 0.22)}"/>`;
  const marker = (d, klasa = '') => `<path class="marker ${klasa}" d="${d}"/>`;
  const iks = (r, cx, cy, s) => marker(kreska(r, [[cx - s, cy - s], [cx + s, cy + s]]) + kreska(r, [[cx + s, cy - s], [cx - s, cy + s]]));
  const brwi = (r, y, nachylenie = 0) => marker(kreska(r, [[30, y + nachylenie], [42, y - nachylenie]]) + kreska(r, [[58, y - nachylenie], [70, y + nachylenie]]));

  // twarz każdej postaci: dziury na oczy, brwi, usta; współrzędne w pudełku torby 100 x 110
  const RYSUNKI = {
    '😨': r => dziura(r, 37, 50, 6, 7) + dziura(r, 63, 50, 6, 7) + brwi(r, 38, -2) + marker(owal(r, 50, 77, 4, 5)),
    '😰': r => dziura(r, 37, 51, 6, 6.5) + dziura(r, 63, 51, 6, 6.5) + brwi(r, 40, -3) + marker(kreska(r, [[42, 79], [50, 76], [58, 79]])) +
      marker(`M77 44q-3 6 0 8q3-2 0-8z M24 58q-2 5 0 6q2-1 0-6z`, 'kropla'),
    '😱': r => dziura(r, 36, 48, 7, 9.5) + dziura(r, 64, 48, 7, 9.5) + `<path class="dziura" d="${owal(r, 50, 81, 6.5, 10, 0.12)}"/>` + brwi(r, 33, -3),
    '🤕': r => dziura(r, 63, 51, 6, 6.5) + iks(r, 37, 51, 5) + marker(kreska(r, [[40, 80], [50, 77], [60, 80]])) +
      `<path class="opatrunek" d="M18 34 L84 22 L86 31 L20 43 Z"/>` + marker(kreska(r, [[46, 30], [48, 37]]) + kreska(r, [[52, 29], [54, 36]]), 'cienki'),
    '😵': r => iks(r, 37, 50, 5.5) + iks(r, 63, 50, 5.5) + marker(kreska(r, [[38, 79], [43, 75], [48, 80], [53, 75], [58, 80], [62, 76]])),
    '😶': r => dziura(r, 38, 52, 4.5, 5) + dziura(r, 62, 52, 4.5, 5),
    '😬': r => dziura(r, 37, 50, 6, 6.5) + dziura(r, 63, 50, 6, 6.5) + marker(owal(r, 50, 79, 15, 6, 0.06)) +
      marker(kreska(r, [[35, 79], [65, 79]]) + [40, 45, 50, 55, 60].map(x => kreska(r, [[x, 74], [x, 84]], 0.5)).join(''), 'cienki'),
    '🥴': r => dziura(r, 36, 49, 7.5, 8) + dziura(r, 64, 54, 4, 4.5) + marker(kreska(r, [[36, 78], [44, 82], [52, 77], [62, 81]])) +
      marker(kreska(r, [[27, 38], [43, 41]]) + kreska(r, [[57, 46], [70, 43]])),
    '😓': r => dziura(r, 37, 52, 6, 6) + dziura(r, 63, 52, 6, 6) + marker(kreska(r, [[29, 44], [43, 39]]) + kreska(r, [[57, 39], [71, 44]])) +
      marker(kreska(r, [[41, 80], [59, 80]])) + marker('M74 34q-3 7 0 9q3-2 0-9z', 'kropla'),
    '😖': r => marker(kreska(r, [[31, 45], [42, 51], [31, 57]]) + kreska(r, [[69, 45], [58, 51], [69, 57]])) +
      marker(kreska(r, [[36, 78], [41, 74], [46, 80], [50, 74], [54, 80], [59, 74], [64, 78]])),
    '🫥': r => `<path class="marker przerywany" d="${owal(r, 37, 51, 6, 6.5)}"/><path class="marker przerywany" d="${owal(r, 63, 51, 6, 6.5)}"/>` +
      `<path class="marker przerywany" d="${kreska(r, [[40, 79], [60, 79]])}"/>`,
    '🥶': r => dziura(r, 37, 50, 6, 6) + dziura(r, 63, 50, 6, 6) + marker(kreska(r, [[37, 79], [42, 75], [47, 82], [53, 75], [58, 82], [63, 77]], 0.4)) +
      marker(kreska(r, [[11, 62], [8, 66], [11, 70]]) + kreska(r, [[89, 62], [92, 66], [89, 70]]), 'cienki'),
    // postacie za serię dni
    '🤡': r => `<path class="farba-biala" d="${owal(r, 37, 50, 10, 11)}"/><path class="farba-biala" d="${owal(r, 63, 50, 10, 11)}"/>` +
      dziura(r, 37, 51, 5, 5.5) + dziura(r, 63, 51, 5, 5.5) + `<path class="farba-czerwona" d="${owal(r, 50, 64, 6, 5.5)}"/>` +
      `<path class="farba-czerwona" d="${kreska(r, [[30, 76], [40, 86], [50, 88], [60, 86], [70, 76]], 0.5)}" fill="none" stroke-width="5"/>`,
    '👹': r => `<path class="farba-czerwona" d="M20 27Q14 14 19 4Q24 16 34 22Z M80 27Q86 14 81 4Q76 16 66 22Z"/>` +
      dziura(r, 37, 52, 6, 5) + dziura(r, 63, 52, 6, 5) + marker(kreska(r, [[27, 40], [43, 47]]) + kreska(r, [[73, 40], [57, 47]])) +
      marker(kreska(r, [[34, 76], [66, 76]]) + kreska(r, [[39, 76], [42, 85], [45, 76]], 0.4) + kreska(r, [[55, 76], [58, 85], [61, 76]], 0.4)),
    '👻': r => dziura(r, 38, 50, 5.5, 8) + dziura(r, 62, 50, 5.5, 8) + `<path class="dziura" d="${owal(r, 50, 75, 4.5, 6)}"/>`,
    '💀': r => `<path class="dziura" d="${owal(r, 36, 52, 9, 9.5, 0.1)}"/><path class="dziura" d="${owal(r, 64, 52, 9, 9.5, 0.1)}"/>` +
      `<circle class="blysk" cx="34" cy="50" r="1.6"/><circle class="blysk" cx="62" cy="50" r="1.6"/>` +
      marker('M50 63l-4 8h8z') + marker(kreska(r, [[34, 81], [66, 81]]) + [39, 45, 50, 55, 61].map(x => kreska(r, [[x, 77], [x, 86]], 0.4)).join(''), 'cienki'),
  };

  // Torba: postrzępiony, zmięty brzeg u góry, lekko rozszerzona ku dołowi; prześcieradło ducha ma miękkie fałdy.
  function obrys(r, duch) {
    if (duch) return 'M50 6C28 6 16 22 15 44C14 66 12 86 8 104C16 99 22 106 30 101C37 107 44 100 50 105C57 100 63 107 71 101C78 106 85 99 92 104C88 86 86 66 85 44C84 22 72 6 50 6Z';
    const gora = [[12, 26]];
    for (let x = 18; x <= 88; x += 7) gora.push([x, 15 + r() * 10]);
    gora.push([88, 26]);
    return 'M' + gora.map(([x, y]) => `${z1(x)} ${z1(y)}`).join('L') + 'C90 52 92 82 91 105C70 110 30 110 9 105C8 82 10 52 12 26Z';
  }

  function svg(av, klasa = '') {
    const r = ziarno(av || '?'), duch = av === '👻', rysunek = Object.hasOwn(RYSUNKI, av) ? RYSUNKI[av] : RYSUNKI['😶'];
    const kontur = obrys(r, duch);
    // fałdy: zagięcie pod brzegiem i pionowe zgniecenia, za każdym razem trochę inne
    const faldy = duch
      ? `<path class="falda" d="M34 40C30 64 28 84 26 100M66 40C70 64 72 84 74 100"/>`
      : `<path class="falda" d="M13 33Q50 ${z1(36 + r() * 4)} 89 31"/><path class="falda" d="M${z1(28 + r() * 8)} 36L${z1(24 + r() * 8)} 104M${z1(64 + r() * 8)} 36L${z1(70 + r() * 8)} 104"/>`;
    return `<svg class="torba ${duch ? 'duch' : ''} ${klasa}" viewBox="0 0 100 110" aria-hidden="true">` +
      `<path class="cien" d="${kontur}"/><path class="papier" d="${kontur}"/><path class="cieniowanie" d="${kontur}"/>${faldy}<g class="twarz">${rysunek(r)}</g></svg>`;
  }
  return { svg };
})();
