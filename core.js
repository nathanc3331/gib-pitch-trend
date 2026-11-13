/* GIB Pitch Trends: data handling, rulebook ranges and the next-pitch read.
   No DOM in this file, so it can be checked with Node as well as in the page. */
(function (root) {
  'use strict';

  // ---------- numbers on the 1-1000 circle ----------
  const wrap = x => ((Math.round(x) - 1) % 1000 + 1000) % 1000 + 1;
  const cdist = (a, b) => { const d = Math.abs(a - b) % 1000; return d > 500 ? 1000 - d : d; };
  // signed move from b to a, in -499..500
  const sdelta = (a, b) => ((a - b) % 1000 + 1499) % 1000 - 499;
  const validNum = v => Number.isInteger(v) && v >= 1 && v <= 1000;

  // ---------- CSV ----------
  function parseCSV(t) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (c !== '\r') f += c;
    }
    if (f.length || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  function table(text) {
    const rows = parseCSV(text); if (!rows.length) return [];
    const h = rows[0].map(s => s.trim());
    return rows.slice(1).map(r => { const o = {}; h.forEach((k, i) => { if (k && !(k in o)) o[k] = (r[i] || '').trim(); }); return o; });
  }
  const int = s => /^\d+$/.test(s || '') ? parseInt(s, 10) : null;

  const HITS = new Set(['HR', '3B', '2B', '1B']);
  function resultClass(res) {
    const r = String(res || '').toUpperCase();
    if (HITS.has(r)) return 'hit';
    if (r === 'BB' || r === 'IBB' || r === 'HBP') return 'walk';
    if (r === 'SB' || r === 'CS' || r.startsWith('STEAL') || r.startsWith('CS ')) return 'steal';
    if (r.startsWith('AUTO') || r === '' || r === '#N/A' || r === 'N/A') return 'none';
    return 'out';
  }

  // PA Log rows -> plate appearances, in sheet order (which is game order)
  function loadPA(text, season) {
    const out = [];
    table(text).forEach((r, i) => {
      if (!r['Pitcher'] || !r['Hitter']) return;
      const pitch = int(r['Pitch']), swing = int(r['Swing']);
      const res = r['Old Result'] || r['Exact Result'] || '';
      out.push({
        season, row: i, hitter: r['Hitter'], hid: r['Hitter ID'], pitcher: r['Pitcher'], pid: r['Pitcher ID'] || r['Pitcher'],
        pitch: validNum(pitch) ? pitch : null, swing: validNum(swing) ? swing : null,
        res, exact: r['Exact Result'] || res, cls: resultClass(res),
        inning: r['Inning'] || '', outs: int(r['Outs']), obc: int(r['OBC']),
        game: season + '-' + (r['Game ID'] || '?'), session: r['Game'] || '', bteam: r['Batter Team'] || '', pteam: r['Pitcher Team'] || ''
      });
    });
    return out;
  }

  // Group pitches by pitcher. `prev` links to the same pitcher's previous pitch in the same game.
  function buildPitchers(pas) {
    const map = new Map();
    for (const pa of pas) {
      if (pa.pitch == null) continue;
      let p = map.get(pa.pid);
      if (!p) { p = { id: pa.pid, name: pa.pitcher, team: pa.pteam, seasons: new Set(), recs: [] }; map.set(pa.pid, p); }
      p.name = pa.pitcher; p.team = pa.pteam; p.seasons.add(pa.season);
      const last = p.recs[p.recs.length - 1];
      const rec = Object.assign({}, pa, { prev: last && last.game === pa.game ? last : null });
      p.recs.push(rec);
    }
    return map;
  }

  // ---------- trend summaries over any list of pitch records ----------
  function summarize(recs) {
    const n = recs.length;
    const hist50 = new Array(20).fill(0), hist100 = new Array(10).fill(0);
    const move50 = new Array(10).fill(0), offs50 = new Array(10).fill(0);
    const exact = new Map(), endDigit = new Array(10).fill(0);
    const firstHist = new Array(10).fill(0);
    const after = { hit: { n: 0, sum: 0, near: 0 }, walk: { n: 0, sum: 0, near: 0 }, out: { n: 0, sum: 0, near: 0 } };
    let moves = 0, moveSum = 0, near100 = 0, up = 0, offs = 0, offSum = 0, offNear = 0, firsts = 0;
    for (const r of recs) {
      hist50[Math.floor((r.pitch - 1) / 50)]++; hist100[Math.floor((r.pitch - 1) / 100)]++;
      exact.set(r.pitch, (exact.get(r.pitch) || 0) + 1); endDigit[r.pitch % 10]++;
      if (!r.prev) { firsts++; firstHist[Math.floor((r.pitch - 1) / 100)]++; continue; }
      const d = sdelta(r.pitch, r.prev.pitch), a = Math.abs(d);
      moves++; moveSum += a; if (a <= 100) near100++; if (d > 0) up++;
      move50[Math.min(9, Math.floor(Math.max(a - 1, 0) / 50))]++;
      const g = after[r.prev.cls]; if (g) { g.n++; g.sum += a; if (a <= 100) g.near++; }
      if (r.prev.swing != null) {
        const o = cdist(r.pitch, r.prev.swing);
        offs++; offSum += o; if (o <= 100) offNear++;
        offs50[Math.min(9, Math.floor(Math.max(o - 1, 0) / 50))]++;
      }
    }
    const top = [...exact.entries()].filter(e => e[1] > 1).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 8);
    return {
      n, hist50, hist100, move50, offs50, endDigit, firstHist, firsts, top, after,
      moves, avgMove: moves ? moveSum / moves : null, near100: moves ? near100 / moves : null, up: moves ? up / moves : null,
      offs, avgOff: offs ? offSum / offs : null, offNear: offs ? offNear / offs : null,
      round0: n ? endDigit[0] / n : null
    };
  }

  // ---------- rulebook section 4: types and result ranges ----------
  const OUTCOMES = ['HR', '3B', '2B', '1B', 'BB', 'DFO', 'WGO', 'SFO', 'K', 'PGO'];
  // 4.7 Type Listing. Each row: points for HR,3B,2B,1B,BB,DFO,WGO,SFO,K,PGO at 1..5 stars.
  const HIT_TYPES = {
    CON: [[3, 1, 7, 50, 10, 31, 67, 11, 20, 50], [4, 1, 9, 56, 10, 31, 61, 10, 20, 48], [5, 1, 11, 62, 12, 28, 59, 10, 16, 46], [6, 1, 13, 68, 13, 27, 53, 10, 15, 44], [7, 2, 16, 70, 14, 26, 49, 10, 16, 40]],
    EYE: [[5, 1, 7, 33, 30, 28, 38, 8, 60, 40], [6, 1, 9, 35, 34, 30, 35, 9, 55, 36], [7, 1, 11, 37, 38, 32, 32, 10, 50, 32], [7, 1, 14, 39, 44, 29, 30, 9, 45, 32], [8, 2, 16, 40, 50, 25, 30, 9, 40, 30]],
    POW: [[10, 1, 12, 25, 12, 60, 16, 4, 68, 42], [12, 1, 13, 28, 14, 61, 15, 3, 62, 41], [13, 1, 14, 32, 17, 55, 14, 4, 60, 40], [15, 1, 19, 32, 18, 53, 13, 4, 55, 40], [17, 1, 22, 32, 21, 52, 12, 3, 50, 40]],
    SPD: [[2, 3, 8, 40, 18, 12, 67, 34, 37, 29], [3, 3, 10, 42, 20, 14, 64, 32, 35, 27], [4, 3, 13, 45, 22, 15, 60, 30, 33, 25], [5, 4, 16, 47, 22, 15, 55, 30, 33, 23], [5, 4, 19, 52, 24, 15, 50, 30, 31, 20]]
  };
  const HIT_ZERO = [1, 0, 5, 20, 24, 15, 15, 20, 120, 30];      // 0* PIT (pitcher batting)
  const PIT_TYPES = {
    BL: [[12, 2, 21, 32, 30, 42, 40, 12, 35, 25], [11, 2, 20, 31, 28, 37, 35, 15, 40, 32], [10, 2, 19, 29, 26, 35, 30, 20, 45, 35], [9, 2, 18, 27, 24, 33, 28, 24, 48, 38], [8, 1, 17, 25, 22, 30, 26, 26, 52, 44]],
    GB: [[5, 4, 15, 59, 25, 25, 50, 14, 22, 32], [5, 3, 14, 56, 26, 25, 45, 15, 26, 36], [4, 3, 13, 53, 24, 23, 40, 16, 30, 45], [4, 3, 12, 50, 22, 21, 37, 14, 34, 54], [3, 2, 11, 48, 20, 19, 35, 12, 36, 65]],
    SO: [[10, 3, 24, 28, 33, 48, 23, 5, 57, 20], [9, 2, 22, 30, 32, 46, 20, 8, 62, 20], [7, 2, 22, 30, 29, 40, 20, 9, 67, 25], [6, 2, 20, 30, 29, 40, 15, 9, 70, 30], [4, 3, 16, 29, 28, 34, 15, 9, 83, 30]],
    FB: [[16, 4, 16, 37, 16, 70, 15, 22, 35, 20], [15, 3, 15, 35, 15, 65, 18, 25, 40, 20], [13, 3, 14, 37, 13, 60, 20, 31, 40, 20], [12, 3, 12, 37, 12, 60, 20, 35, 40, 20], [10, 2, 10, 37, 12, 55, 20, 45, 40, 20]]
  };
  const PIT_ZERO = [20, 3, 20, 20, 60, 49, 49, 10, 10, 10];     // 0* PPP (position player pitching)
  const HIT_NAMES = { CON: 'Contact', EYE: 'Eye', POW: 'Power', SPD: 'Speed', PIT: 'Pitcher batting' };
  const PIT_NAMES = { BL: 'Balanced', GB: 'Groundball', SO: 'Strikeout', FB: 'Flyball', PPP: 'Position player' };

  const normHitArch = a => { a = String(a || '').toUpperCase().trim(); return HIT_TYPES[a] ? a : null; };
  const normPitArch = a => {
    a = String(a || '').toUpperCase().trim();
    if (a === 'B' || a === 'BAL') a = 'BL'; if (a === 'K') a = 'SO';
    return PIT_TYPES[a] ? a : null;
  };
  const hitPoints = (arch, stars) => (stars >= 1 && HIT_TYPES[arch]) ? HIT_TYPES[arch][Math.min(5, stars) - 1] : HIT_ZERO;
  const pitPoints = (arch, stars) => (stars >= 1 && PIT_TYPES[arch]) ? PIT_TYPES[arch][Math.min(5, stars) - 1] : PIT_ZERO;

  // Sizes of the ten result ranges for one matchup (hitter + pitcher points, then park factors; rule 4.6).
  // Fielder adjustments (rule 4.2) are not included.
  function rangeSizes(hit, pit, park) {
    const s = hit.map((v, i) => v + pit[i]);
    if (park) {
      for (let i = 0; i < 5; i++) { const f = park[i]; if (isFinite(f) && f > 0) s[i] = Math.round(s[i] * f); }
      let sum = s.reduce((a, b) => a + b, 0);
      s[9] += 501 - sum;
      for (let i = 8; s[9] < 0 && i >= 5; i--) { const take = Math.min(s[i], -s[9]); s[i] -= take; s[9] += take; }
    }
    return s;
  }
  // -> [{o:'HR', lo:0, hi:14, size:15}, ...] over differences 0..500
  function bands(sizes) {
    const out = []; let d = 0;
    sizes.forEach((sz, i) => { if (sz > 0) out.push({ o: OUTCOMES[i], lo: d, hi: d + sz - 1, size: sz }); else out.push({ o: OUTCOMES[i], lo: null, hi: null, size: 0 }); d += sz; });
    return out;
  }
  function outcomeAt(sizes) {            // index by difference 0..500 -> outcome index
    const at = new Int8Array(501); let d = 0;
    sizes.forEach((sz, i) => { for (let k = 0; k < sz && d <= 500; k++) at[d++] = i; });
    while (d <= 500) at[d++] = 9;
    return at;
  }

  // Which type applies (rule 4.1): stars vs the opponent's hand, or clutch stars with 2 outs and a runner in scoring position.
  function matchupTypes(batter, pitcher, clutch) {
    const pHand = /^L/i.test(pitcher && pitcher.hand || '') ? 'L' : 'R';
    let bHand = String(batter && batter.hand || 'R').toUpperCase()[0];
    if (bHand !== 'L' && bHand !== 'R') bHand = pHand === 'L' ? 'R' : 'L';   // switch hitter takes the platoon side
    const hs = batter ? (clutch ? batter.hclt : pHand === 'L' ? batter.hitvl : batter.hitvr) : null;
    const ps = pitcher ? (clutch ? pitcher.pclt : bHand === 'L' ? pitcher.pitvl : pitcher.pitvr) : null;
    return { hitArch: batter ? batter.hitArch : null, hitStars: hs, pitArch: pitcher ? pitcher.pitArch : null, pitStars: ps, bHand, pHand };
  }

  function loadPlayers(text) {
    const map = new Map();
    table(text).forEach(r => {
      if (!r['Player ID'] || !r['Name']) return;
      const hitArch = normHitArch(r['Hit Archetype']), pitArch = normPitArch(r['Pitch Archetype']);
      if (!hitArch && !pitArch && !r['Hand']) return;       // retired / empty rows
      map.set(r['Player ID'], {
        id: r['Player ID'], name: r['Name'], team: r['Team'], hand: r['Hand'], pos: r['Positon'] || r['Position'] || '',
        hitvr: int(r['HITvR']) || 0, hitvl: int(r['HITvL']) || 0, hclt: int(r['HCLT']) || 0,
        pitvr: int(r['PITvR']) || 0, pitvl: int(r['PITvL']) || 0, pclt: int(r['PCLT']) || 0,
        hitArch, pitArch
      });
    });
    return map;
  }
  function loadParks(text) {
    return table(text).filter(r => (r['Team'] || r['Park Name'])).map(r => ({
      name: r['Park Name'] || r['Name'] || r['Team'], team: r['Team'] || '',
      f: ['HR', '3B', '2B', '1B', 'BB'].map(k => parseFloat(r[k]))
    })).filter(p => p.f.every(v => isFinite(v) && v > 0));
  }

  // ---------- next-pitch read ----------
  const SIGMA = 40;
  const KER = (() => {                       // Gaussian weights by circular distance, summing to 1 over the circle
    const k = new Float64Array(501); let s = 0;
    for (let d = 0; d <= 500; d++) { k[d] = d <= 4 * SIGMA ? Math.exp(-d * d / (2 * SIGMA * SIGMA)) : 0; s += (d === 0 || d === 500 ? 1 : 2) * k[d]; }
    for (let d = 0; d <= 500; d++) k[d] /= s;
    return k;
  })();
  const CUT = 4 * SIGMA;
  const COMPS = [
    { k: 'zones', label: 'Favourite areas', note: 'where this pitcher has thrown before, recent pitches counting a little more' },
    { k: 'move', label: 'Usual move from the last pitch', note: 'how far and which way they tend to go from their previous number' },
    { k: 'swing', label: 'Reaction to the last swing', note: 'where they go relative to the swing they just saw' },
    { k: 'league', label: 'League-wide move habit', note: 'how all pitchers in the log tend to move from their previous number' },
    { k: 'uniform', label: 'No pattern', note: 'every number equally likely' }
  ];
  const PRIOR = [1, 1, 1, 1.5, 6];           // pseudo-counts: with little history the read stays close to "no pattern"
  const MIN_PTS = 8;

  // Points (numbers + weights) each habit suggests for the pitch after records[0..i-1], given the context.
  function pointsFor(recs, i, ctx) {
    const res = {};
    if (i >= MIN_PTS) {
      const l = [], w = [];
      for (let j = 0; j < i; j++) { l.push(recs[j].pitch); w.push(Math.pow(0.985, i - 1 - j)); }
      res.zones = { l, w };
    }
    if (ctx.lastPitch != null) {
      const l = [], w = [];
      for (let j = 0; j < i; j++) if (recs[j].prev) { l.push(wrap(ctx.lastPitch + sdelta(recs[j].pitch, recs[j].prev.pitch))); w.push(1); }
      if (l.length >= MIN_PTS) res.move = { l, w };
    }
    if (ctx.lastSwing != null) {
      const l = [], w = [];
      for (let j = 0; j < i; j++) if (recs[j].prev && recs[j].prev.swing != null) { l.push(wrap(ctx.lastSwing + sdelta(recs[j].pitch, recs[j].prev.swing))); w.push(1); }
      if (l.length >= MIN_PTS) res.swing = { l, w };
    }
    return res;
  }
  function densAt(p, x) {                    // scaled so "every number equally likely" is 1
    if (!p) return 1;
    let s = 0, t = 0;
    for (let j = 0; j < p.l.length; j++) { const d = cdist(x, p.l[j]); if (d <= CUT) s += p.w[j] * KER[d]; t += p.w[j]; }
    return 1000 * s / t;
  }
  function densGrid(p) {
    const out = new Float64Array(1000);
    if (!p) return out.fill(1);
    let t = 0;
    for (let j = 0; j < p.l.length; j++) {
      t += p.w[j];
      for (let d = -CUT; d <= CUT; d++) out[((p.l[j] - 1 + d) % 1000 + 1000) % 1000] += p.w[j] * KER[Math.abs(d)];
    }
    for (let x = 0; x < 1000; x++) out[x] *= 1000 / t;
    return out;
  }
  // League move habit: smoothed distribution of signed moves, index = move + 499
  function leagueMoves(pitchers, excludeId) {
    const h = new Float64Array(1000); let n = 0;
    for (const p of pitchers.values()) { if (p.id === excludeId) continue; for (const r of p.recs) if (r.prev) { h[sdelta(r.pitch, r.prev.pitch) + 499]++; n++; } }
    const out = new Float64Array(1000);
    if (n < 50) return out.fill(1);
    for (let x = 0; x < 1000; x++) if (h[x]) for (let d = -CUT; d <= CUT; d++) out[((x + d) % 1000 + 1000) % 1000] += h[x] * KER[Math.abs(d)];
    for (let x = 0; x < 1000; x++) out[x] *= 1000 / n;
    return out;
  }
  const lgAt = (lg, ctx, x) => ctx.lastPitch == null ? 1 : lg[sdelta(x, ctx.lastPitch) + 499];
  const ctxOf = r => r.prev ? { lastPitch: r.prev.pitch, lastSwing: r.prev.swing } : { lastPitch: null, lastSwing: null };

  // Learn how much weight each habit deserves by replaying the pitcher's history in order:
  // each past pitch is scored using only what came before it.
  function fit(recs, lg) {
    const F = [];
    for (let i = 1; i < recs.length; i++) {
      const ctx = ctxOf(recs[i]), pts = pointsFor(recs, i, ctx), x = recs[i].pitch;
      F.push([densAt(pts.zones, x), densAt(pts.move, x), densAt(pts.swing, x), lgAt(lg, ctx, x), 1]);
    }
    const k = COMPS.length, psum = PRIOR.reduce((a, b) => a + b, 0);
    let w = PRIOR.map(v => v / psum);
    for (let it = 0; it < 80; it++) {
      const acc = PRIOR.slice();
      for (const f of F) { let tot = 0; for (let c = 0; c < k; c++) tot += w[c] * f[c]; for (let c = 0; c < k; c++) acc[c] += w[c] * f[c] / tot; }
      const s = acc.reduce((a, b) => a + b, 0); w = acc.map(v => v / s);
    }
    return { w, scored: F.length };
  }
  function density(recs, i, ctx, w, lg) {
    const pts = pointsFor(recs, i, ctx);
    const g = [densGrid(pts.zones), densGrid(pts.move), densGrid(pts.swing)];
    const out = new Float64Array(1000);
    for (let x = 0; x < 1000; x++) out[x] = w[0] * g[0][x] + w[1] * g[1][x] + w[2] * g[2][x] + w[3] * lgAt(lg, ctx, x + 1) + w[4];
    const used = [!!pts.zones, !!pts.move, !!pts.swing, ctx.lastPitch != null, true];
    return { dens: out, used };              // dens[x] is for number x+1; mean is 1
  }
  // Best non-overlapping windows of `width` numbers by share of probability
  function topWindows(dens, width, count) {
    const pre = new Float64Array(2001);
    for (let i = 0; i < 2000; i++) pre[i + 1] = pre[i] + dens[i % 1000];
    const mass = new Float64Array(1000);
    for (let s = 0; s < 1000; s++) mass[s] = (pre[s + width] - pre[s]) / 1000;
    const taken = new Uint8Array(1000), out = [];
    for (let c = 0; c < count; c++) {
      let best = -1;
      for (let s = 0; s < 1000; s++) { if (taken[s]) continue; if (best < 0 || mass[s] > mass[best]) best = s; }
      if (best < 0) break;
      out.push({ from: best + 1, to: wrap(best + width), p: mass[best] });
      for (let d = -width + 1; d < width; d++) taken[((best + d) % 1000 + 1000) % 1000] = 1;
    }
    return out;
  }
  // Replay: how often did the most likely 300 numbers contain the pitch actually thrown? (guessing = 30%)
  function backtest(recs, w, lg, maxTests) {
    let n = 0, hit = 0;
    const start = Math.max(MIN_PTS + 2, recs.length - (maxTests || 150));
    for (let i = start; i < recs.length; i++) {
      const { dens } = density(recs, i, ctxOf(recs[i]), w, lg);
      const sorted = Float64Array.from(dens).sort(); const thr = sorted[700];
      n++; if (dens[recs[i].pitch - 1] >= thr) hit++;
    }
    return { n, hit, rate: n ? hit / n : null };
  }

  // For every swing number: chance of each result, given the pitch read and the matchup's ranges.
  function swingMap(dens, sizes) {
    const at = outcomeAt(sizes);
    const onBase = new Float64Array(1000), hit = new Float64Array(1000), xbh = new Float64Array(1000);
    for (let s = 0; s < 1000; s++) {
      let ob = 0, h = 0, x = 0;
      for (let p = 0; p < 1000; p++) {
        let d = Math.abs(s - p); if (d > 500) d = 1000 - d;
        const o = at[d], v = dens[p];
        if (o <= 4) { ob += v; if (o <= 3) { h += v; if (o <= 2) x += v; } }
      }
      onBase[s] = ob / 1000; hit[s] = h / 1000; xbh[s] = x / 1000;
    }
    // with no read at all every swing has the same chance: (2*size - 1)/1000 for ranges starting at difference 0
    const flat = k => { let c = 0; for (let d = 0; d <= 500; d++) if (at[d] <= k) c += (d === 0 || d === 500) ? 1 : 2; return c / 1000; };
    return { onBase, hit, xbh, baseOnBase: flat(4), baseHit: flat(3) };
  }

  const api = {
    wrap, cdist, sdelta, parseCSV, table, loadPA, buildPitchers, summarize, resultClass,
    OUTCOMES, HIT_TYPES, PIT_TYPES, HIT_NAMES, PIT_NAMES, hitPoints, pitPoints, rangeSizes, bands, outcomeAt, matchupTypes,
    loadPlayers, loadParks, COMPS, MIN_PTS, leagueMoves, fit, density, topWindows, backtest, swingMap, ctxOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GIB = api;
})(typeof window !== 'undefined' ? window : globalThis);
