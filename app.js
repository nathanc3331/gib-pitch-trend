/* GIB Pitch Trends: page logic. Data handling and the maths live in core.js. */
(function () {
  'use strict';
  const G = window.GIB, $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = (x, d = 0) => x == null || !isFinite(x) ? '–' : (100 * x).toFixed(d) + '%';
  const num = (x, d = 0) => x == null || !isFinite(x) ? '–' : x.toFixed(d);
  const RAND_NEAR = 0.201, RAND_MOVE = 250;
  const MOVE_LABELS = ['0–50', '51–100', '101–150', '151–200', '201–250', '251–300', '301–350', '351–400', '401–450', '451–500'];
  const MOVE_CHANCE = [0.101, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.099];
  const H100 = ['1–100', '101–200', '201–300', '301–400', '401–500', '501–600', '601–700', '701–800', '801–900', '901–1000'];

  const state = { season: 'all', view: 'league', pid: null, trendPid: '', sort: 'n' };
  let PAS = [], PLAYERS = new Map(), PARKS = [], pitchers = new Map(), league = null, fitCache = new Map();

  // ---------- data ----------
  function dataBases() {
    const bases = [];
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i), repo = location.pathname.split('/').filter(Boolean)[0];
    // the raw file is always the latest copy, even if the site itself has not been republished yet
    if (m && repo) bases.push(`https://raw.githubusercontent.com/${m[1]}/${repo}/main/data/`);
    bases.push('data/');
    return bases;
  }
  async function getText(name, optional) {
    let err;
    for (const b of dataBases()) {
      try { const r = await fetch(b + name, { cache: 'no-cache' }); if (r.ok) return await r.text(); err = new Error(name + ': ' + r.status); }
      catch (e) { err = e; }
    }
    if (optional) return null;
    throw err;
  }
  const RAW = { s1: null, s2: null, pl: null, pk: null };
  function ingest() {
    PAS = [...(RAW.s1 ? G.loadPA(RAW.s1, 1) : []), ...(RAW.s2 ? G.loadPA(RAW.s2, 2) : [])];
    if (RAW.pl) PLAYERS = G.loadPlayers(RAW.pl);
    if (RAW.pk) PARKS = G.loadParks(RAW.pk);
    const keep = ['batter', 'park', 'hArch', 'hStars', 'pArch', 'pStars'].map(id => [id, $(id).value]);
    initControls();
    keep.forEach(([id, v]) => { if (v && [...$(id).options].some(o => o.value === v)) $(id).value = v; });
    rebuild();
  }
  const stamp = d => d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  async function load() {
    try {
      const [s1, s2, pl, pk, meta] = await Promise.all([getText('s1_pa.csv', true), getText('s2_pa.csv', true), getText('s2_players.csv', true), getText('s2_parks.csv', true), getText('meta.json', true)]);
      if (!s1 && !s2) throw new Error('no data files yet');
      Object.assign(RAW, { s1, s2, pl, pk });
      try { const u = meta && JSON.parse(meta).updated; if (u) $('updated').textContent = 'Saved copy from ' + stamp(new Date(u)) + '.'; } catch (e) { }
      $('status').hidden = true; $('refresh').disabled = false;
      ingest();
    } catch (e) {
      $('status').textContent = 'The league data has not loaded. If this site was just set up, the first data copy may still be running; try again in a few minutes. (' + e.message + ')';
    }
  }
  // Refresh button: read the current-season tabs straight from the league's Google Sheet (same tabs the scheduled copy uses)
  const S2_SHEET = '1eH3lgNQ-sXnuUV1QtRk26dRjp5ltXFNBeiScDYH__QU', SHEET = 'https://docs.google.com/spreadsheets/d/' + S2_SHEET;
  const LIVE = [
    ['s2', SHEET + '/export?format=csv&gid=692400938', ['Hitter', 'Hitter ID', 'Swing', 'Pitcher', 'Pitcher ID', 'Pitch'], 50],
    ['pl', SHEET + '/gviz/tq?tqx=out:csv&headers=1&sheet=' + encodeURIComponent('Players (DO NOT EDIT)'), ['Player ID', 'Name', 'Team'], 20],
    ['pk', SHEET + '/gviz/tq?tqx=out:csv&headers=1&sheet=' + encodeURIComponent('Parks and Teams (EDIT)'), ['Park Name', 'Team Name', 'Team'], 2]
  ];
  async function refresh() {
    const btn = $('refresh'); btn.disabled = true; btn.textContent = 'Refreshing…';
    const before = PAS.filter(p => p.season === 2).length;
    const got = await Promise.all(LIVE.map(async ([key, url, head, min]) => {
      try {
        const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) return null;
        const text = await r.text(), rows = G.parseCSV(text);
        // only accept a download that looks like the right tab
        if (!rows.length || head.some((h, i) => (rows[0][i] || '').trim() !== h) || rows.length - 1 < min) return null;
        return [key, text];
      } catch (e) { return null; }
    }));
    const pa = got.find(g => g && g[0] === 's2');
    if (pa) {
      got.forEach(g => { if (g) RAW[g[0]] = g[1]; });
      ingest();
      const added = PAS.filter(p => p.season === 2).length - before;
      $('updated').textContent = `Refreshed from the league sheet at ${new Date().toLocaleTimeString([], { timeStyle: 'short' })}: ${added > 0 ? added + ' new plate appearance' + (added === 1 ? '' : 's') : 'nothing new since the saved copy'}.`;
    } else {
      $('updated').textContent = 'Could not reach the league sheet just now, so the page is still showing the copy it had.';
    }
    btn.disabled = false; btn.textContent = 'Refresh data';
  }
  function rebuild() {
    const pas = state.season === 'all' ? PAS : PAS.filter(p => String(p.season) === state.season);
    pitchers = G.buildPitchers(pas); fitCache = new Map();
    const all = []; for (const p of pitchers.values()) { p.sum = G.summarize(p.recs); for (const r of p.recs) all.push(r); }
    league = G.summarize(all); league.pitchers = pitchers.size;
    league.games = new Set(all.map(r => r.game)).size;
    fillPitcherSelect();
    render();
  }

  // ---------- small chart kit (inline SVG) ----------
  const tip = $('tip');
  document.addEventListener('mousemove', e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tip.style.display = 'none'; return; }
    tip.innerHTML = t.getAttribute('data-tip'); tip.style.display = 'block';
    const w = tip.offsetWidth; tip.style.left = Math.min(window.innerWidth - w - 8, e.clientX + 12) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
  });
  // bars: values are shares (0-1). ref: array of shares drawn as a dashed step line.
  function bars(el, o) {
    const W = 520, H = o.h || 190, L = 34, R = 6, T = 8, B = 34, n = o.values.length;
    const max = Math.max(...o.values, ...(o.ref || [0]), 0.0001) * 1.12, iw = (W - L - R) / n, y = v => T + (H - T - B) * (1 - v / max);
    const step = max > 0.3 ? 0.1 : max > 0.12 ? 0.05 : 0.02;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || '')}">`;
    for (let g = 0; g <= max; g += step) s += `<line class="gridl" x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}"/><text x="${L - 5}" y="${y(g) + 4}" text-anchor="end">${Math.round(g * 100)}%</text>`;
    o.values.forEach((v, i) => {
      const x = L + i * iw + 1, bw = iw - 2, yy = y(v), hh = Math.max(0, H - B - yy);
      const t = `${esc(o.labels[i])}: <b>${pct(v, 1)}</b>${o.counts ? ' (' + o.counts[i] + ')' : ''}${o.ref ? '<br>' + esc(o.refName || 'Reference') + ': ' + pct(o.ref[i], 1) : ''}`;
      s += `<path class="bar" data-tip="${esc(t)}" d="M${x},${H - B} v${-Math.max(0, hh - 3)} q0,-3 3,-3 h${Math.max(0, bw - 6)} q3,0 3,3 v${Math.max(0, hh - 3)} z"/>`;
      s += `<rect x="${x}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent" data-tip="${esc(t)}"/>`;
      if (n <= 10 || i % 2 === 0) s += `<text x="${x + bw / 2}" y="${H - B + 14}" text-anchor="middle">${esc(o.short ? o.short[i] : o.labels[i])}</text>`;
    });
    if (o.ref) { let d = ''; o.ref.forEach((v, i) => { d += `${i ? 'L' : 'M'}${L + i * iw},${y(v)} L${L + (i + 1) * iw},${y(v)} `; }); s += `<path class="ref" d="${d}"/>`; }
    if (o.axis) s += `<text x="${(W + L - R) / 2}" y="${H - 4}" text-anchor="middle">${esc(o.axis)}</text>`;
    el.innerHTML = s + '</svg>';
  }
  // curve over numbers 1..1000. vals[0..999]; base = dashed reference level; zones = [{from,to}]
  function curve(el, o) {
    const W = 1000, H = 230, L = 40, R = 10, T = 10, B = 26, v = o.vals;
    let max = o.base; for (let i = 0; i < 1000; i++) if (v[i] > max) max = v[i]; max *= 1.1;
    const x = n => L + (W - L - R) * (n - 1) / 999, y = a => T + (H - T - B) * (1 - a / max);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || '')}">`;
    (o.zones || []).forEach(z => {
      const segs = z.from <= z.to ? [[z.from, z.to]] : [[z.from, 1000], [1, z.to]];
      segs.forEach(([a, b]) => { s += `<rect x="${x(a)}" y="${T}" width="${Math.max(1, x(b) - x(a))}" height="${H - T - B}" fill="var(--s1soft)"/>`; });
    });
    for (let n = 0; n <= 1000; n += 100) { const nn = Math.max(1, n); s += `<line class="gridl" x1="${x(nn)}" x2="${x(nn)}" y1="${T}" y2="${H - B}"/><text x="${x(nn)}" y="${H - B + 15}" text-anchor="middle">${nn}</text>`; }
    let d = `M${x(1)},${y(v[0])}`; for (let i = 1; i < 1000; i++) d += `L${x(i + 1).toFixed(1)},${y(v[i]).toFixed(1)}`;
    s += `<path d="${d} L${x(1000)},${H - B} L${x(1)},${H - B} Z" fill="var(--s1)" opacity=".12"/><path d="${d}" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round"/>`;
    s += `<line class="ref" x1="${L}" x2="${W - R}" y1="${y(o.base)}" y2="${y(o.base)}"/>`;
    s += `<text x="${L - 5}" y="${y(o.base) + 4}" text-anchor="end">${esc(o.fmt(o.base))}</text>` + (max / 1.1 > o.base * 1.25 ? `<text x="${L - 5}" y="${y(max / 1.1) + 4}" text-anchor="end">${esc(o.fmt(max / 1.1))}</text>` : '');
    (o.marks || []).forEach(m => { s += `<line x1="${x(m.n)}" x2="${x(m.n)}" y1="${T}" y2="${H - B}" stroke="var(--text2)" stroke-width="1.5"/><text x="${x(m.n)}" y="${T + 10}" text-anchor="${m.n > 880 ? 'end' : 'start'}" dx="${m.n > 880 ? -5 : 5}">${esc(m.t)}</text>`; });
    s += `<line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--text)" stroke-width="1" visibility="hidden"/><rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/></svg>`;
    el.innerHTML = s;
    const svg = el.firstChild, xh = svg.querySelector('.xh'), hit = svg.querySelector('.hit');
    hit.addEventListener('mousemove', e => {
      const r = hit.getBoundingClientRect(), n = Math.min(1000, Math.max(1, Math.round(1 + 999 * (e.clientX - r.left) / r.width)));
      xh.setAttribute('x1', x(n)); xh.setAttribute('x2', x(n)); xh.setAttribute('visibility', 'visible');
      hit.setAttribute('data-tip', o.tip(n, v[n - 1]));
    });
    hit.addEventListener('mouseleave', () => xh.setAttribute('visibility', 'hidden'));
  }
  const gamesOf = p => { const games = []; for (const r of p.recs) { const g = games[games.length - 1]; if (g && g.id === r.game) g.recs.push(r); else games.push({ id: r.game, recs: [r] }); } return games; };
  // every pitch in order (oldest left), one band per game with a divider at each game break
  function seqChart(el, p) {
    const all = gamesOf(p), games = []; let total = 0;
    for (let i = all.length - 1; i >= 0 && (total === 0 || total + all[i].recs.length <= 160); i--) { games.unshift(all[i]); total += all[i].recs.length; }
    const W = 1000, H = 280, L = 40, R = 10, T = 24, B = 12, step = (W - L - R) / total, y = v => T + (H - T - B) * (1 - (v - 1) / 999);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pitch numbers in order, split by game">`, dots = '', i = 0;
    [1, 250, 500, 750, 1000].forEach(v => { s += `<line class="gridl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 5}" y="${y(v) + 4}" text-anchor="end">${v}</text>`; });
    games.forEach((g, gi) => {
      const x0 = L + i * step, w = g.recs.length * step, f = g.recs[0], opp = [...new Set(g.recs.map(r => r.bteam).filter(Boolean))].join('/');
      const name = `Season ${f.season} · Game ${esc(g.id.split('-')[1])}${opp ? ' · vs ' + esc(opp) : ''}`;
      if (gi % 2 === 1) s += `<rect x="${x0}" y="${T}" width="${w}" height="${H - T - B}" fill="var(--text)" opacity=".045"/>`;
      if (gi > 0) s += `<line x1="${x0}" x2="${x0}" y1="${T - 14}" y2="${H - B}" stroke="var(--text2)" stroke-width="1.5"/>`;
      const short = `S${f.season} G${esc(g.id.split('-')[1])}`;
      if (w > 44) s += `<text x="${x0 + 5}" y="${T - 6}" data-tip="${esc(name + ' · ' + g.recs.length + ' pitches')}">${w > 120 ? short + (opp ? ' vs ' + esc(opp) : '') : short}</text>`;
      let d = '';
      g.recs.forEach((r, k) => {
        const cx = L + (i + 0.5) * step, cy = y(r.pitch), on = r.cls === 'hit' || r.cls === 'walk';
        d += `${k ? 'L' : 'M'}${cx.toFixed(1)},${cy.toFixed(1)}`;
        const t = `${name}<br>${esc(r.inning)} vs ${esc(r.hitter)}<br>Pitch <b>${r.pitch}</b>${r.swing == null ? '' : ', swing ' + r.swing + ', diff ' + G.cdist(r.pitch, r.swing)}<br>${esc(r.exact)}${k ? '' : ' · first pitch of the game'}`;
        dots += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="var(${on ? '--s2' : '--s1'})" stroke="var(--surface)" stroke-width="1.5"/><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="9" fill="transparent" data-tip="${esc(t)}"/>`;
        i++;
      });
      s += `<path d="${d}" fill="none" stroke="var(--s1)" stroke-width="1.5" opacity=".45" stroke-linejoin="round"/>`;
    });
    el.innerHTML = s + dots + '</svg>' +
      `<div class="legend"><span><i style="border-radius:50%;width:10px"></i>Batter out (or steal attempt)</span><span><i style="border-radius:50%;width:10px;background:var(--s2)"></i>Batter reached base</span><span>Vertical lines and shading mark a new game${games.length < all.length ? '; showing the latest ' + games.length + ' of ' + all.length + ' games' : ''}</span></div>`;
  }
  const share = (arr, n) => arr.map(v => n ? v / n : 0);
  const tile = (big, label, sub) => `<div class="tile"><b>${big}</b><span>${label}</span>${sub ? `<i>${sub}</i>` : ''}</div>`;
  const rangeTxt = z => z.from + '–' + z.to;

  // ---------- league view ----------
  function renderLeague() {
    const el = $('v-league');
    if (!league.n) { el.innerHTML = '<div class="card">No pitches logged for this season yet.</div>'; return; }
    if (!pitchers.has(state.trendPid)) state.trendPid = '';
    const one = pitchers.get(state.trendPid), L = one ? one.sum : league;
    const sLabel = state.season === 'all' ? 'both seasons' : 'Season ' + state.season;
    const list = [...pitchers.values()].sort((a, b) => a.name.localeCompare(b.name));
    const who = one ? esc(one.name) : 'pitchers', their = one ? 'their' : 'the';
    // reference line: the league when one pitcher is shown, plain chance when the whole league is shown
    const refName = one ? 'League' : 'Random';
    const ref = (lg, n, chance) => one ? share(lg, n) : chance;
    const cmp = (lgVal, rnd) => one ? 'league ' + lgVal + ', random ' + rnd : 'random would be ' + rnd;
    const leg = name => `<div class="legend"><span><i></i>${one ? 'This pitcher' : name}</span><span><i class="r"></i>${one ? 'League' : 'Even spread / random'}</span></div>`;
    el.innerHTML = `
      <div class="card">
        <div class="row" style="margin:0">
          <label>Show trends for<select id="trendPitcher"><option value="">All pitchers (league)</option>${list.map(p => `<option value="${esc(p.id)}"${p.id === state.trendPid ? ' selected' : ''}>${esc(p.name)} (${p.recs.length})</option>`).join('')}</select></label>
          ${one ? `<button class="btn" id="toScout">Next pitch read for ${esc(one.name)}</button><button class="btn" id="toAll">Back to all pitchers</button>` : ''}
          <span class="hint" style="margin:0 0 8px">${one ? esc([one.team, 'seasons ' + [...one.seasons].join(' & ')].filter(Boolean).join(' · ')) + '. Dashed lines show the league for comparison.' : 'Pick a pitcher to see every chart below for that pitcher only.'}</span>
        </div>
        ${one && L.n < 30 ? `<p class="warn" style="margin:10px 0 0">Only ${L.n} pitches on record for this pitcher, so these charts are noisy.</p>` : ''}
      </div>
      <div class="tiles">
        ${tile(L.n.toLocaleString(), 'pitches logged', one ? new Set(one.recs.map(r => r.game)).size + ' games, ' + sLabel : league.pitchers + ' pitchers, ' + league.games + ' games, ' + sLabel)}
        ${tile(num(L.avgMove), 'average move from ' + their + ' last pitch', cmp(num(league.avgMove), RAND_MOVE))}
        ${tile(pct(L.near100, 1), 'stay within 100 of ' + their + ' last pitch', cmp(pct(league.near100, 1), pct(RAND_NEAR, 1)))}
        ${tile(pct(L.offNear, 1), 'land within 100 of the swing just seen', cmp(pct(league.offNear, 1), pct(RAND_NEAR, 1)))}
        ${tile(pct(L.round0, 1), 'of pitches end in 0', cmp(pct(league.round0, 1), '10%'))}
      </div>
      <div class="card half"><h2>Where ${one ? 'their' : ''} pitches land</h2><p class="hint">Share of ${one ? 'their' : 'all'} pitches in each block of 50 numbers.</p><div id="lgHist"></div>${leg('Pitches')}</div>
      <div class="card half"><h2>How far ${one ? 'they move' : 'pitchers move'} from their last pitch</h2><p class="hint">Shortest distance around the 1–1000 circle, same game only.</p><div id="lgMove"></div>${leg('Pitches')}</div>
      <div class="card half"><h2>Distance from the swing they just saw</h2><p class="hint">Small = ${one ? 'they go' : 'pitchers go'} near the last swing; large = they run from it.</p><div id="lgOff"></div>${leg('Pitches')}</div>
      <div class="card half"><h2>First pitch of a game</h2><p class="hint">${one ? 'Their' : "Each pitcher's"} opening number, by block of 100 (${L.firsts} opener${L.firsts === 1 ? '' : 's'}).</p><div id="lgFirst"></div>${leg('Openers')}</div>
      <div class="card half"><h2>After a hit, a walk or an out</h2><p class="hint">How far the next pitch moves depending on what the last one led to.</p><div class="scroll"><table id="lgAfter"></table></div></div>
      <div class="card half"><h2>Last digit of the pitch</h2><p class="hint">People are not random: some endings get picked more than others.</p><div id="lgDigit"></div><h2 style="margin-top:12px">${one ? 'Numbers thrown more than once' : 'Most repeated numbers'}</h2><div class="chips" id="lgTop"></div></div>
      ${one ? '<div class="card"><h2>Pitch by pitch, game by game</h2><p class="hint">Every pitch in the order it was thrown, oldest on the left. Remember 1 and 1000 are neighbours, so a jump from the top to the bottom can be a small move.</p><div id="lgSeq"></div></div><div class="card"><h2>Latest pitches</h2><p class="hint">Newest first, one block per game. Moves are only measured within a game.</p><div class="scroll"><table id="lgLog"></table></div></div>' : ''}
      <div class="card"><h2>Every pitcher</h2><p class="hint">Click a pitcher to see their trends. Click a column heading to sort.</p><div class="scroll"><table id="lgPitchers"></table></div></div>`;
    const even = n => new Array(n).fill(1 / n);
    bars($('lgHist'), { values: share(L.hist50, L.n), counts: L.hist50, labels: L.hist50.map((_, i) => (i * 50 + 1) + '–' + (i * 50 + 50)), short: L.hist50.map((_, i) => i * 50 + 1), ref: ref(league.hist50, league.n, even(20)), refName: one ? 'League' : 'Even spread', axis: 'Pitch number (block starts at)' });
    bars($('lgMove'), { values: share(L.move50, L.moves), counts: L.move50, labels: MOVE_LABELS, ref: ref(league.move50, league.moves, MOVE_CHANCE), refName, axis: 'Distance from previous pitch' });
    bars($('lgOff'), { values: share(L.offs50, L.offs), counts: L.offs50, labels: MOVE_LABELS, ref: ref(league.offs50, league.offs, MOVE_CHANCE), refName, axis: 'Distance from previous swing' });
    bars($('lgFirst'), { values: share(L.firstHist, L.firsts), counts: L.firstHist, labels: H100, short: H100.map(s => s.split('–')[0]), ref: ref(league.firstHist, league.firsts, even(10)), refName: one ? 'League' : 'Even spread', axis: 'Pitch number (block starts at)' });
    bars($('lgDigit'), { h: 150, values: share(L.endDigit, L.n), counts: L.endDigit, labels: L.endDigit.map((_, i) => 'Ends in ' + i), short: L.endDigit.map((_, i) => i), ref: ref(league.endDigit, league.n, even(10)), refName: one ? 'League' : 'Even spread' });
    afterTable($('lgAfter'), L, one ? league : null);
    $('lgTop').innerHTML = L.top.map(t => `<span class="chip">${t[0]} <small>×${t[1]}</small></span>`).join('') || '<span class="hint">No number has been thrown twice.</span>';
    if (one) { seqChart($('lgSeq'), one); pitchLog($('lgLog'), one); }
    pitcherTable();
  }
  // Latest pitches, newest first, grouped under a heading for each game (whole games, until about 30 pitches are shown)
  function pitchLog(el, p) {
    const games = gamesOf(p);
    let shown = 0, html = '';
    for (let i = games.length - 1; i >= 0 && shown < 30; i--) {
      const g = games[i], f = g.recs[0], opp = [...new Set(g.recs.map(r => r.bteam).filter(Boolean))].join('/');
      shown += g.recs.length;
      html += `<tr class="game"><td colspan="7">Season ${f.season} · Game ${esc(g.id.split('-')[1])}${opp ? ' · vs ' + esc(opp) : ''} · ${g.recs.length} pitch${g.recs.length === 1 ? '' : 'es'}</td></tr>` +
        g.recs.slice().reverse().map(r => { const mv = r.prev ? G.sdelta(r.pitch, r.prev.pitch) : null; return `<tr><td>${esc(r.inning)}</td><td>${esc(r.hitter)}</td><td class="n"><b>${r.pitch}</b></td><td class="n">${mv == null ? 'first of game' : (mv > 0 ? '+' : '') + mv}</td><td class="n">${r.swing == null ? '–' : r.swing}</td><td class="n">${r.swing == null ? '–' : G.cdist(r.pitch, r.swing)}</td><td>${esc(r.exact)}</td></tr>`; }).join('');
    }
    el.innerHTML = '<tr><th>Inning</th><th>Batter</th><th class="n">Pitch</th><th class="n">Move</th><th class="n">Swing</th><th class="n">Diff</th><th>Result</th></tr>' + html;
  }
  function afterTable(el, S, ref) {
    const row = (k, name) => { const g = S.after[k], r = ref && ref.after[k]; return `<tr><td>${name}</td><td class="n">${g.n}</td><td class="n">${g.n ? num(g.sum / g.n) : '–'}</td><td class="n">${g.n ? pct(g.near / g.n) : '–'}</td>${ref ? `<td class="n">${r.n ? num(r.sum / r.n) : '–'}</td>` : ''}</tr>`; };
    el.innerHTML = `<tr><th>Last pitch led to</th><th class="n">Pitches</th><th class="n">Average move</th><th class="n">Stayed within 100</th>${ref ? '<th class="n">League average move</th>' : ''}</tr>` + row('hit', 'A hit') + row('walk', 'A walk') + row('out', 'An out') +
      `<tr><td>Random</td><td class="n"></td><td class="n">${RAND_MOVE}</td><td class="n">${pct(RAND_NEAR)}</td>${ref ? '<td></td>' : ''}</tr>`;
  }
  function favBlock(S) { let b = 0; S.hist100.forEach((v, i) => { if (v > S.hist100[b]) b = i; }); return { label: H100[b], share: S.n ? S.hist100[b] / S.n : 0 }; }
  function pitcherTable() {
    const cols = [['name', 'Pitcher'], ['team', 'Team'], ['n', 'Pitches'], ['avgMove', 'Average move'], ['near100', 'Within 100 of last pitch'], ['offNear', 'Within 100 of last swing'], ['fav', 'Busiest block']];
    const rows = [...pitchers.values()].map(p => ({ id: p.id, name: p.name, team: p.team, n: p.sum.n, avgMove: p.sum.moves >= 5 ? p.sum.avgMove : null, near100: p.sum.moves >= 5 ? p.sum.near100 : null, offNear: p.sum.offs >= 5 ? p.sum.offNear : null, favO: favBlock(p.sum) }));
    const k = state.sort;
    rows.sort((a, b) => k === 'name' || k === 'team' ? String(a[k]).localeCompare(b[k]) : k === 'fav' ? b.favO.share - a.favO.share : (b[k] == null ? -1 : b[k]) - (a[k] == null ? -1 : a[k]));
    $('lgPitchers').innerHTML = '<tr>' + cols.map(c => `<th class="sort${c[0] === 'name' || c[0] === 'team' ? '' : ' n'}" data-k="${c[0]}">${c[1]}${k === c[0] ? ' ▾' : ''}</th>`).join('') + '</tr>' +
      rows.map(r => `<tr class="click" data-id="${esc(r.id)}"${r.id === state.trendPid ? ' style="font-weight:600"' : ''}><td>${esc(r.name)}</td><td>${esc(r.team)}</td><td class="n">${r.n}</td><td class="n">${num(r.avgMove)}</td><td class="n">${pct(r.near100)}</td><td class="n">${pct(r.offNear)}</td><td class="n">${r.favO.label} (${pct(r.favO.share)})</td></tr>`).join('');
  }

  // ---------- pitcher view ----------
  function fillPitcherSelect() {
    const list = [...pitchers.values()].sort((a, b) => b.recs.length - a.recs.length);
    $('pitcher').innerHTML = list.map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${p.recs.length})</option>`).join('');
    if (!pitchers.has(state.pid)) state.pid = list.length ? list[0].id : null;
    if (state.pid != null) $('pitcher').value = state.pid;
  }
  function getFit(p) {
    if (!fitCache.has(p.id)) {
      const lg = G.leagueMoves(pitchers, p.id), ex = G.leagueExact(pitchers, p.id), f = G.fit(p.recs, lg, ex);
      fitCache.set(p.id, { lg, ex, w: f.w, bt: G.backtest(p.recs, f.w, lg, ex, 150) });
    }
    return fitCache.get(p.id);
  }
  const readNum = id => { const v = parseInt($(id).value, 10); return v >= 1 && v <= 1000 ? v : null; };
  let lastDens = null;
  function renderPitcher() {
    const p = pitchers.get(state.pid);
    if (!p) { $('pmeta').textContent = 'No pitchers for this season yet.'; return; }
    const S = p.sum, pl = PLAYERS.get(p.id);
    $('pmeta').textContent = [p.team, pl && pl.hand ? 'throws ' + pl.hand : '', pl && pl.pitArch ? G.PIT_NAMES[pl.pitArch] + ' type' : '', 'seasons ' + [...p.seasons].join(' & ')].filter(Boolean).join(' · ');
    const fav = favBlock(S);
    $('ptiles').innerHTML = tile(S.n, 'pitches logged', new Set(p.recs.map(r => r.game)).size + ' games') +
      tile(num(S.avgMove), 'average move from last pitch', 'league ' + num(league.avgMove) + ', random ' + RAND_MOVE) +
      tile(pct(S.near100), 'stay within 100 of last pitch', 'league ' + pct(league.near100) + ', random ' + pct(RAND_NEAR)) +
      tile(pct(S.offNear), 'within 100 of the swing just seen', 'league ' + pct(league.offNear) + ', random ' + pct(RAND_NEAR)) +
      tile(fav.label, 'busiest block of 100', pct(fav.share) + ' of their pitches, even spread 10%');
    bars($('pHist'), { values: share(S.hist100, S.n), counts: S.hist100, labels: H100, short: H100.map(s => s.split('–')[0]), ref: share(league.hist100, league.n), refName: 'League', axis: 'Pitch number (block starts at)' });
    bars($('pMove'), { values: share(S.move50, S.moves), counts: S.move50, labels: MOVE_LABELS, ref: share(league.move50, league.moves), refName: 'League', axis: 'Distance from previous pitch' });
    bars($('pOff'), { values: share(S.offs50, S.offs), counts: S.offs50, labels: MOVE_LABELS, ref: share(league.offs50, league.offs), refName: 'League', axis: 'Distance from previous swing' });
    afterTable($('pAfter'), S, league);
    $('pTop').innerHTML = S.top.map(t => `<span class="chip">${t[0]} <small>×${t[1]}</small></span>`).join('') || '<span class="hint">None yet.</span>';
    seqChart($('pSeq'), p); pitchLog($('pLog'), p);
    renderRead();
  }
  function renderRead() {
    const p = pitchers.get(state.pid); if (!p) return;
    const f = getFit(p), ctx = { lastPitch: readNum('lastPitch'), lastSwing: readNum('lastSwing') };
    const { dens, used } = G.density(p.recs, p.recs.length, ctx, f.w, f.lg, f.ex);
    lastDens = dens;
    // weights of habits that cannot apply right now (no last pitch or swing entered) fall back to "no pattern"
    const eff = f.w.slice(); used.forEach((u, i) => { if (!u) { eff[5] += eff[i]; eff[i] = 0; } });
    const zones = G.topWindows(dens, 100, 3);
    const flat = eff[5] > 0.85;
    $('readWarn').innerHTML = p.recs.length < 25 ? `<p class="warn">Only ${p.recs.length} pitches on record, so this read leans heavily on an even spread.</p>` : flat ? '<p class="warn">This pitcher shows no strong habit in the log. Treat every number as close to equally likely.</p>' : '';
    const marks = []; if (ctx.lastPitch) marks.push({ n: ctx.lastPitch, t: 'last pitch' }); if (ctx.lastSwing) marks.push({ n: ctx.lastSwing, t: 'last swing' });
    curve($('densChart'), { vals: dens, base: 1, zones, marks, fmt: v => v.toFixed(1) + '×', label: 'Chance of each pitch number', tip: (n, v) => `Number <b>${n}</b>: ${v.toFixed(2)}× an even chance` });
    $('zones').innerHTML = zones.map((z, i) => `<div class="zone"><b>${rangeTxt(z)}</b><span>${pct(z.p, 1)} chance the pitch is here<br>${(z.p / 0.1).toFixed(1)}× an even spread (10%)</span></div>`).join('');
    const singles = Array.from(dens, (v, i) => [i + 1, v]).sort((x, y) => y[1] - x[1]).slice(0, 10);
    $('exactNums').innerHTML = singles[0][1] < 1.5 ? '<span class="hint">No single number stands out.</span>' : singles.filter(x => x[1] >= 1.5).map(x => `<span class="chip">${x[0]} <small>${x[1].toFixed(1)}× even chance</small></span>`).join('');
    const bt = f.bt;
    $('btNote').innerHTML = bt.n >= 10 ? `Replayed over their last ${bt.n} pitches, the 300 numbers this read rated most likely contained the actual pitch <b>${pct(bt.rate)}</b> of the time. Guessing would get 30%.` : 'Not enough history yet to check how this read would have done.';
    $('weights').innerHTML = G.COMPS.map((c, i) => `<div class="wbar" data-tip="${esc(c.note)}"><span>${c.label}${!used[i] && f.w[i] > 0.005 ? ' <small style="color:var(--muted)">(needs last ' + (c.k === 'swing' ? 'swing' : 'pitch') + ')</small>' : ''}</span><div><i style="width:${(100 * eff[i]).toFixed(1)}%"></i></div><span>${pct(eff[i])}</span></div>`).join('');
    renderSwing();
  }

  // ---------- matchup / swing map ----------
  function initControls() {
    const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
    $('hArch').innerHTML = Object.keys(G.HIT_TYPES).map(k => opt(k, G.HIT_NAMES[k])).join('') + opt('PIT', G.HIT_NAMES.PIT);
    $('pArch').innerHTML = Object.keys(G.PIT_TYPES).map(k => opt(k, G.PIT_NAMES[k])).join('') + opt('PPP', G.PIT_NAMES.PPP);
    const stars = [1, 2, 3, 4, 5].map(s => opt(s, s + '★')).join('');
    $('hStars').innerHTML = stars; $('pStars').innerHTML = stars; $('hStars').value = 3; $('pStars').value = 3;
    const bat = [...PLAYERS.values()].filter(p => p.hitArch && !/^(RET|FA)$/i.test(p.team || '')).sort((a, b) => a.name.localeCompare(b.name));
    $('batter').innerHTML = opt('', 'Choose types by hand') + bat.map(p => opt(p.id, `${p.name} (${p.team})`)).join('');
    $('park').innerHTML = opt('', 'No park factors') + PARKS.map((p, i) => opt(i, `${p.name}${p.team ? ' (' + p.team + ')' : ''}`)).join('');
    if (!PLAYERS.size) $('batter').disabled = true;
  }
  // fill the type pickers from the roster for the chosen batter and pitcher
  function applyRoster() {
    const b = PLAYERS.get($('batter').value), pp = PLAYERS.get(state.pid), clutch = $('clutch').checked;
    const m = G.matchupTypes(b || null, pp || null, clutch), notes = [];
    if (b) {
      if (m.hitStars >= 1 && m.hitArch) { $('hArch').value = m.hitArch; $('hStars').value = m.hitStars; } else $('hArch').value = 'PIT';
      notes.push(`${b.name}: using ${clutch ? 'clutch' : 'vs-' + m.pHand + 'HP'} stars`);
    }
    if (pp && pp.pitArch != null || pp && (pp.pitvr + pp.pitvl + pp.pclt) === 0) {
      if (m.pitStars >= 1 && m.pitArch) { $('pArch').value = m.pitArch; $('pStars').value = m.pitStars; } else $('pArch').value = 'PPP';
      notes.push(`pitcher: using ${clutch ? 'clutch' : 'vs-' + m.bHand + 'HB'} stars`);
    } else if (!pp) notes.push('pitcher is not on the Season 2 roster, so set their type by hand');
    $('muNote').textContent = notes.join(' · ');
  }
  function renderSwing() {
    if (!lastDens) return;
    const ha = $('hArch').value, pa = $('pArch').value;
    $('hStars').disabled = ha === 'PIT'; $('pStars').disabled = pa === 'PPP';
    const hp = G.hitPoints(ha, ha === 'PIT' ? 0 : +$('hStars').value), pp = G.pitPoints(pa, pa === 'PPP' ? 0 : +$('pStars').value);
    const park = PARKS[$('park').value], sizes = G.rangeSizes(hp, pp, park ? park.f : null), b = G.bands(sizes);
    $('rangeTable').innerHTML = '<tr><th>Result</th>' + b.map(x => `<th class="n">${x.o}</th>`).join('') + '</tr>' +
      '<tr><td>Difference</td>' + b.map(x => `<td class="n">${x.size ? x.lo + '–' + x.hi : '–'}</td>`).join('') + '</tr>' +
      '<tr><td>Chance with no read</td>' + b.map(x => `<td class="n">${x.size ? pct((2 * x.size - (x.lo === 0 ? 1 : 0) - (x.hi === 500 ? 1 : 0)) / 1000, 1) : '–'}</td>`).join('') + '</tr>';
    const m = G.swingMap(lastDens, sizes);
    const scaled = Float64Array.from(m.onBase, v => v * 1000);       // topWindows averages a density, so feed it per-number values
    const best = G.topWindows(scaled, 50, 3).map(z => ({ from: z.from, to: z.to, ob: z.p * 1000 / 50 / 1000 }));
    curve($('swingChart'), { vals: m.onBase, base: m.baseOnBase, zones: best, fmt: v => pct(v), label: 'Chance of reaching base by swing number',
      tip: (n, v) => `Swing <b>${n}</b>: ${pct(v, 1)} to reach base, ${pct(m.hit[n - 1], 1)} a hit, ${pct(m.xbh[n - 1], 1)} extra bases` });
    $('swingZones').innerHTML = best.map(z => `<div class="zone"><b>${rangeTxt(z)}</b><span>${pct(z.ob, 1)} to reach base on average<br>${pct(m.baseOnBase, 1)} with no read</span></div>`).join('');
  }

  // ---------- wiring ----------
  function render() {
    ['league', 'pitcher', 'rules'].forEach(v => { $('v-' + v).hidden = state.view !== v; });
    document.querySelectorAll('nav button').forEach(b => b.setAttribute('aria-selected', b.dataset.v === state.view));
    if (state.view === 'league') renderLeague();
    if (state.view === 'pitcher') { applyRoster(); renderPitcher(); }
  }
  document.querySelector('nav').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || !PAS.length) return; state.view = b.dataset.v; render(); });
  $('season').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !PAS.length) return;
    state.season = b.dataset.s; document.querySelectorAll('#season button').forEach(x => x.setAttribute('aria-pressed', x === b));
    rebuild();
  });
  const openScout = id => { state.pid = id; $('pitcher').value = id; $('lastPitch').value = ''; $('lastSwing').value = ''; state.view = 'pitcher'; render(); window.scrollTo(0, 0); };
  $('v-league').addEventListener('click', e => {
    const th = e.target.closest('th.sort'); if (th) { state.sort = th.dataset.k; pitcherTable(); return; }
    if (e.target.closest('#toScout')) { openScout(state.trendPid); return; }
    if (e.target.closest('#toAll')) { state.trendPid = ''; renderLeague(); return; }
    const tr = e.target.closest('tr.click'); if (tr) { state.trendPid = tr.dataset.id; renderLeague(); window.scrollTo(0, 0); }
  });
  $('v-league').addEventListener('change', e => { if (e.target.id === 'trendPitcher') { state.trendPid = e.target.value; renderLeague(); } });
  $('pitcher').addEventListener('change', e => { state.pid = e.target.value; $('lastPitch').value = ''; $('lastSwing').value = ''; applyRoster(); renderPitcher(); });
  ['lastPitch', 'lastSwing'].forEach(id => $(id).addEventListener('input', renderRead));
  $('useLast').addEventListener('click', () => { const p = pitchers.get(state.pid); if (!p || !p.recs.length) return; const r = p.recs[p.recs.length - 1]; $('lastPitch').value = r.pitch; $('lastSwing').value = r.swing == null ? '' : r.swing; renderRead(); });
  $('clearLast').addEventListener('click', () => { $('lastPitch').value = ''; $('lastSwing').value = ''; renderRead(); });
  ['batter', 'clutch'].forEach(id => $(id).addEventListener('change', () => { applyRoster(); renderSwing(); }));
  ['park', 'hArch', 'hStars', 'pArch', 'pStars'].forEach(id => $(id).addEventListener('change', renderSwing));

  $('refresh').addEventListener('click', refresh);
  load();
})();
