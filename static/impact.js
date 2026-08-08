'use strict';

/* Impact 1.0 — per-side positional analysis for the demo viewer.
 *
 * Everything here is derived from the frame table the viewer already has in
 * memory (position, side, alive flag, active weapon at 8 fps), so opening the
 * panel costs one pass over the frames and needs no re-parse.
 *
 * Two things are deliberate:
 *  - Only live play counts (freeze-end .. round end). Buy time would otherwise
 *    park everyone on spawn and flatten every positional metric.
 *  - Metrics are ranked WITHIN a side, never against absolute cutoffs. T-side
 *    roam runs ~2x CT-side on every map, so a fixed threshold would label the
 *    whole T side "roamer" and the whole CT side "anchor".
 */
(function () {
    const SNIPERS = new Set(['AWP', 'SSG 08', 'SCAR-20', 'G3SG1']);
    const GRID = 64;                 // heat cells per axis over the 1024px radar
    const MIN_FRAMES = 60;           // ignore a player with almost no time on a side
    const MOVING_PX_S = 40;          // above this speed we call it "repositioning"
    // A cell the player entered in only one round is a one-off — a rotation that
    // never repeated, or a chase. Showing it implies a habit that isn't there.
    const MIN_ROUNDS_PER_CELL = 2;
    // Everyone stands on their spawn for the first seconds of a round. Counting
    // that paints both spawns solid on every single player's map without saying
    // anything about how they play, so the opening seconds are skipped.
    const SKIP_OPENING_SECONDS = 5;

    const CT = 1, T = 0;

    /* ---------------------------------------------------------------- maths */

    function median(a) {
        if (!a.length) return 0;
        const b = Float64Array.from(a).sort();
        return b[b.length >> 1];
    }

    /** 0..1 rank of each key within `obj`, 1 = highest value. */
    function ranks(obj, key) {
        const ids = Object.keys(obj);
        const sorted = ids.slice().sort((a, b) => obj[a][key] - obj[b][key]);
        const out = {};
        sorted.forEach((id, i) => {
            out[id] = sorted.length < 2 ? 0.5 : i / (sorted.length - 1);
        });
        return out;
    }

    /** Zero out cells the player only ever occupied in a single round. Must run
     *  BEFORE the blur, or the one-offs get smeared into their neighbours and
     *  survive as a halo. */
    function filterOneOffs(grid, cellRounds) {
        const out = new Float64Array(grid.length);
        for (let i = 0; i < grid.length; i++) {
            if (cellRounds[i] >= MIN_ROUNDS_PER_CELL) out[i] = grid[i];
        }
        return out;
    }

    /** Separable box blur, run 3x — close enough to a gaussian, and cheap. */
    function blur(grid, n, passes) {
        let src = grid;
        for (let p = 0; p < (passes || 3); p++) {
            const tmp = new Float64Array(n * n);
            for (let y = 0; y < n; y++) {
                for (let x = 0; x < n; x++) {
                    let s = 0, c = 0;
                    for (let d = -1; d <= 1; d++) {
                        const xx = x + d;
                        if (xx >= 0 && xx < n) { s += src[y * n + xx]; c++; }
                    }
                    tmp[y * n + x] = s / c;
                }
            }
            const dst = new Float64Array(n * n);
            for (let y = 0; y < n; y++) {
                for (let x = 0; x < n; x++) {
                    let s = 0, c = 0;
                    for (let d = -1; d <= 1; d++) {
                        const yy = y + d;
                        if (yy >= 0 && yy < n) { s += tmp[yy * n + x]; c++; }
                    }
                    dst[y * n + x] = s / c;
                }
            }
            src = dst;
        }
        return src;
    }

    /* ------------------------------------------------------------ the pass */

    /**
     * One sweep over every live frame, bucketed per player per side.
     * Returns { 1: {idx: metrics}, 0: {idx: metrics} }.
     */
    function compute(D) {
        const N = D.nFrames, FR = D.frames, RD = D.rounds || [], FPS = D.fps || 8;
        const size = D.radarSize || 1024;
        const cell = size / GRID;
        const sniperIdx = new Set();
        (D.weapons || []).forEach((w, i) => { if (SNIPERS.has(w)) sniperIdx.add(i); });

        const acc = { 1: {}, 0: {} };
        const bucket = (side, i) => {
            let b = acc[side][i];
            if (!b) {
                b = acc[side][i] = {
                    n: 0, sx: 0, sy: 0, sniper: 0,
                    pts: [], speeds: [], iso: [], grid: new Float64Array(GRID * GRID),
                    cellRounds: new Uint16Array(GRID * GRID),
                    cellLast: new Int16Array(GRID * GRID).fill(-1),
                    roundCent: [], roundDepth: [], openK: 0, openD: 0, roundsSeen: 0,
                    deaths: 0, kills: 0,
                };
            }
            return b;
        };

        for (const r of RD) {
            const f0 = r.freeze, f1 = Math.min(r.end, N - 1);
            if (f1 <= f0) continue;

            // spawn anchor per side = that side's centroid the moment play starts
            const anchor = {};
            for (const side of [CT, T]) {
                const base = [];
                for (let i = 0; i < FR[f0].length; i++) {
                    const e = FR[f0][i];
                    if (e && e[4] === side) base.push(e);
                }
                anchor[side] = base.length
                    ? [base.reduce((s, e) => s + e[0], 0) / base.length,
                       base.reduce((s, e) => s + e[1], 0) / base.length]
                    : null;
            }

            // Spawn anchors above are read at f0 (the real spawn); the metrics
            // themselves start once players have actually left it.
            const fLive = Math.min(f1, f0 + SKIP_OPENING_SECONDS * FPS);

            const rc = {};   // per-round accumulation, flushed at round end
            for (let f = fLive; f < f1; f++) {
                const row = FR[f];
                if (!row) continue;
                const live = [];
                for (let i = 0; i < row.length; i++) {
                    const e = row[i];
                    if (e && e[5]) live.push(i);
                }
                for (const i of live) {
                    const e = row[i], side = e[4];
                    if (side !== CT && side !== T) continue;
                    const b = bucket(side, i);
                    b.n++; b.sx += e[0]; b.sy += e[1];
                    if (sniperIdx.has(e[7])) b.sniper++;

                    const gx = Math.max(0, Math.min(GRID - 1, (e[0] / cell) | 0));
                    const gy = Math.max(0, Math.min(GRID - 1, (e[1] / cell) | 0));
                    const ci = gy * GRID + gx;
                    b.grid[ci]++;
                    if (b.cellLast[ci] !== r.n) { b.cellLast[ci] = r.n; b.cellRounds[ci]++; }

                    b.pts.push(f, e[0], e[1]);

                    // nearest living team-mate on the same side
                    let best = Infinity;
                    for (const j of live) {
                        if (j === i) continue;
                        const o = row[j];
                        if (!o || o[4] !== side) continue;
                        const d = Math.hypot(e[0] - o[0], e[1] - o[1]);
                        if (d < best) best = d;
                    }
                    if (best < Infinity) b.iso.push(best);

                    const a = anchor[side];
                    if (a) {
                        const d = Math.hypot(e[0] - a[0], e[1] - a[1]);
                        const k = side + ':' + i;
                        if (!rc[k]) rc[k] = { side, i, n: 0, sx: 0, sy: 0, maxD: 0 };
                        const c = rc[k];
                        c.n++; c.sx += e[0]; c.sy += e[1];
                        if (d > c.maxD) c.maxD = d;
                    }
                }
            }
            for (const k in rc) {
                const c = rc[k];
                if (c.n < 8) continue;
                const b = bucket(c.side, c.i);
                b.roundCent.push([c.sx / c.n, c.sy / c.n]);
                b.roundDepth.push(c.maxD);       // furthest push that round, not the average
                b.roundsSeen++;
            }

            // opening duel of the round
            const ks = (D.kills || []).filter(k => k.f >= f0 && k.f <= r.end);
            if (ks.length) {
                const k = ks.reduce((m, x) => (x.f < m.f ? x : m), ks[0]);
                const ea = k.a != null && FR[k.f] ? FR[k.f][k.a] : null;
                const ev = k.v != null && FR[k.f] ? FR[k.f][k.v] : null;
                if (ea && (ea[4] === CT || ea[4] === T)) bucket(ea[4], k.a).openK++;
                if (ev && (ev[4] === CT || ev[4] === T)) bucket(ev[4], k.v).openD++;
            }
        }

        // total kills/deaths per side, for context in the profile
        for (const k of (D.kills || [])) {
            const row = FR[k.f];
            if (!row) continue;
            const ea = k.a != null ? row[k.a] : null;
            const ev = k.v != null ? row[k.v] : null;
            if (ea && (ea[4] === CT || ea[4] === T)) bucket(ea[4], k.a).kills++;
            if (ev && (ev[4] === CT || ev[4] === T)) bucket(ev[4], k.v).deaths++;
        }

        const out = { 1: {}, 0: {} };
        for (const side of [CT, T]) {
            for (const idx in acc[side]) {
                const b = acc[side][idx];
                if (b.n < MIN_FRAMES) continue;
                const mx = b.sx / b.n, my = b.sy / b.n;

                const dist = [];
                let vxx = 0, vyy = 0, vxy = 0;
                for (let p = 0; p < b.pts.length; p += 3) {
                    const dx = b.pts[p + 1] - mx, dy = b.pts[p + 2] - my;
                    dist.push(Math.hypot(dx, dy));
                    vxx += dx * dx; vyy += dy * dy; vxy += dx * dy;
                }
                vxx /= b.n; vyy /= b.n; vxy /= b.n;

                const sp = [];
                for (let p = 3; p < b.pts.length; p += 3) {
                    if (b.pts[p] === b.pts[p - 3] + 1) {
                        sp.push(Math.hypot(b.pts[p + 1] - b.pts[p - 2],
                                           b.pts[p + 2] - b.pts[p - 1]) * FPS);
                    }
                }

                const cd = [];
                for (let a = 0; a < b.roundCent.length; a++) {
                    for (let c = a + 1; c < b.roundCent.length; c++) {
                        cd.push(Math.hypot(b.roundCent[a][0] - b.roundCent[c][0],
                                           b.roundCent[a][1] - b.roundCent[c][1]));
                    }
                }

                out[side][idx] = {
                    idx: +idx, side, frames: b.n, seconds: b.n / FPS,
                    mx, my, cov: [vxx, vyy, vxy],
                    roam: median(dist),
                    speed: median(sp),
                    moving: sp.length ? sp.filter(v => v > MOVING_PX_S).length / sp.length : 0,
                    spotHold: cd.length ? cd.reduce((s, v) => s + v, 0) / cd.length : 0,
                    sniper: b.n ? b.sniper / b.n : 0,
                    iso: median(b.iso),
                    depth: median(b.roundDepth),
                    openK: b.openK, openD: b.openD, rounds: b.roundsSeen,
                    kills: b.kills, deaths: b.deaths,
                    grid: blur(filterOneOffs(b.grid, b.cellRounds), GRID, 4),
                    cellRounds: b.cellRounds,
                    gridN: GRID,
                };
            }
        }

        for (const side of [CT, T]) assignRoles(out[side], side);
        return out;
    }

    /* -------------------------------------------------------------- roles */

    /**
     * Role is picked from ranked metrics and always carries the evidence that
     * produced it, so the label can be argued with rather than trusted blindly.
     */
    function assignRoles(m, side) {
        const ids = Object.keys(m);
        if (!ids.length) return;
        const rRoam = ranks(m, 'roam'), rIso = ranks(m, 'iso'),
              rHold = ranks(m, 'spotHold'), rDepth = ranks(m, 'depth'),
              rMov = ranks(m, 'moving');

        for (const id of ids) {
            const v = m[id];
            const openRate = v.rounds ? (v.openK + v.openD) / v.rounds : 0;
            v.rank = {
                roam: rRoam[id], iso: rIso[id], hold: rHold[id],
                depth: rDepth[id], moving: rMov[id], openRate,
            };

            // Reasons are stored as translation keys + params, not finished
            // sentences, so switching language re-renders them properly.
            let role, why;
            if (v.sniper >= 0.12) {
                role = 'SNIPER';
                why = [['impact.why.awp', { p: Math.round(v.sniper * 100) }]];
                if (rIso[id] > 0.6) why.push(['impact.why.awpAngles']);
            } else if (side === CT) {
                if (rRoam[id] <= 0.34 && rHold[id] <= 0.34) {
                    role = 'ANCHOR';
                    why = [['impact.why.anchor1'], ['impact.why.anchor2']];
                } else if (rDepth[id] >= 0.66 && rMov[id] >= 0.5) {
                    role = 'AGGRESSOR';
                    why = [['impact.why.aggr1'], ['impact.why.aggr2']];
                } else if (rRoam[id] >= 0.66) {
                    role = 'ROTATOR';
                    why = [['impact.why.rotator']];
                } else {
                    role = 'RIFLER';
                    why = [['impact.why.balanced']];
                }
            } else {
                if (openRate >= 0.28) {
                    role = 'ENTRY';
                    why = [['impact.why.entry', { n: v.openK + v.openD, r: v.rounds }]];
                    if (v.openK > v.openD) {
                        why.push(['impact.why.entryWins', { w: v.openK, l: v.openD }]);
                    }
                } else if (rIso[id] >= 0.75) {
                    role = 'LURKER';
                    why = [['impact.why.lurker']];
                } else if (rIso[id] <= 0.3) {
                    role = 'SUPPORT';
                    why = [['impact.why.support']];
                } else {
                    role = 'RIFLER';
                    why = [['impact.why.balanced']];
                }
            }
            v.role = role;
            v.why = why;
        }
    }

    /* ------------------------------------------------------------ hotspots */

    /** Top-N separated local maxima of the blurred occupancy grid. */
    function hotspots(v, n) {
        const g = v.grid, G = v.gridN, cells = [];
        let total = 0;
        for (let i = 0; i < g.length; i++) total += g[i];
        if (!total) return [];
        for (let i = 0; i < g.length; i++) if (g[i] > 0) cells.push(i);
        cells.sort((a, b) => g[b] - g[a]);
        const picked = [];
        const minSep = G * 0.14;
        for (const i of cells) {
            const x = i % G, y = (i / G) | 0;
            if (picked.some(p => Math.hypot(p.gx - x, p.gy - y) < minSep)) continue;
            // share = mass within a small radius, not just the peak cell
            let mass = 0;
            const R = Math.max(1, Math.round(G * 0.06));
            for (let dy = -R; dy <= R; dy++) {
                for (let dx = -R; dx <= R; dx++) {
                    const xx = x + dx, yy = y + dy;
                    if (xx < 0 || yy < 0 || xx >= G || yy >= G) continue;
                    if (Math.hypot(dx, dy) <= R) mass += g[yy * G + xx];
                }
            }
            let rounds = 0;
            if (v.cellRounds) {
                for (let dy = -R; dy <= R; dy++) {
                    for (let dx = -R; dx <= R; dx++) {
                        const xx = x + dx, yy = y + dy;
                        if (xx < 0 || yy < 0 || xx >= G || yy >= G) continue;
                        const c = v.cellRounds[yy * G + xx];
                        if (c > rounds) rounds = c;
                    }
                }
            }
            picked.push({ gx: x, gy: y, share: mass / total, rounds });
            if (picked.length >= (n || 3)) break;
        }
        return picked;
    }

    /* ------------------------------------------------------- zone naming */

    /* Landmarks come straight from the radar calibration the parser already
     * ships (bombsites and spawns, world units). Only a hotspot close enough to
     * one gets its name — nothing is invented for the space in between. */
    let CALIB = null;
    fetch('/static/radars/calibration.json')
        .then(r => r.json()).then(j => { CALIB = j; })
        .catch(() => { CALIB = {}; });

    const LANDMARKS = [
        ['bomb_a', 'impact.lm.a'], ['bomb_b', 'impact.lm.b'],
        ['ct_spawn', 'impact.lm.ctSpawn'], ['t_spawn', 'impact.lm.tSpawn'],
    ];
    const NAME_RADIUS = 115;          // radar px (0..1024) — sites are big

    /** Names for a whole set of hotspots, in radar-pixel space.
     *
     *  Assigned greedily nearest-first, and each landmark is handed out once —
     *  two hotspots both sitting inside the B site would otherwise both come
     *  back "B SITE", which reads like a bug. The loser stays unnamed. */
    function nameSpots(map, spots, cellPx) {
        const out = spots.map(() => null);
        const c = CALIB && CALIB[map];
        if (!c) return out;
        const cand = [];
        spots.forEach((s, i) => {
            const px = (s.gx + 0.5) * cellPx, py = (s.gy + 0.5) * cellPx;
            for (const [key, label] of LANDMARKS) {
                const w = c[key];
                if (!w || typeof w.x !== 'number') continue;
                const lx = (w.x - c.pos_x) / c.scale;
                const ly = (c.pos_y - w.y) / c.scale;
                const d = Math.hypot(px - lx, py - ly);
                if (d < NAME_RADIUS) cand.push({ i, label, d });
            }
        });
        cand.sort((a, b) => a.d - b.d);
        const usedLabel = new Set(), usedSpot = new Set();
        for (const k of cand) {
            if (usedLabel.has(k.label) || usedSpot.has(k.i)) continue;
            usedLabel.add(k.label);
            usedSpot.add(k.i);
            out[k.i] = k.label;
        }
        return out;
    }

    window.Impact = {
        compute, hotspots, nameSpots, LANDMARKS, GRID, CT, T,
        calib: map => (CALIB && CALIB[map]) || null,
    };
})();

/* ---------------------------------------------------------------- the panel */
(function () {
    const $ = id => document.getElementById(id);
    const panel = $('impPanel');
    if (!panel) return;

    const btn = $('dvImpact'), closeBtn = $('impClose'), seg = $('impSide'),
          roster = $('impRoster'), profile = $('impProfile'), sub = $('impSub'),
          canvas = $('impCanvas'), scaleBar = $('impScaleBar');
    const ctx = canvas.getContext('2d');

    const SIDE_COL = { 1: [132, 180, 222], 0: [255, 154, 92] };

    /* Inline SVG rather than image files: it inherits currentColor, stays crisp
     * at any size and matches the stroke weight used elsewhere in the app. */
    const SVG = (d, extra) =>
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (extra || '') + d + '</svg>';
    /* CT/T faction silhouettes and the kill/death marks are the game's own
     * artwork, lifted from the local CS2 install (see static/cs2_icons). They
     * are loaded as files rather than inlined because they carry a lot of path
     * data; `.imp-ico` masks them so they still take the surrounding colour. */
    const FILE_ICON = n =>
        '<i class="imp-ico" style="-webkit-mask-image:url(/static/cs2_icons/' + n +
        '.svg);mask-image:url(/static/cs2_icons/' + n + '.svg)"></i>';

    const ICON = {
        ct: FILE_ICON('ct'),
        t:  FILE_ICON('t'),
        kill:  FILE_ICON('kill'),
        death: FILE_ICON('death'),
        positioning: SVG('<circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
        movement:    SVG('<path d="M4 17h9M4 17l3-3M4 17l3 3"/><path d="M20 7h-9M20 7l-3-3M20 7l-3 3"/>'),
        role:        SVG('<path d="M12 3l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.4 6.7 19.2l1.1-5.9L3.5 9.2l5.9-.8z"/>'),
        zones:       SVG('<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>'),
        team:        SVG('<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="3.2"/><path d="M22 20v-2a4 4 0 0 0-3-3.8"/>'),
    };

    /* Official FACEIT rank colours, so the badge reads the same as on faceit.com */
    const LVL_COL = { 1: '#eeeeee', 2: '#1ce400', 3: '#1ce400', 4: '#ffc800',
                      5: '#ffc800', 6: '#ffc800', 7: '#ffc800', 8: '#ff6309',
                      9: '#ff6309', 10: '#fe1f00' };

    const T = (k, params) => {
        let s = (window.t ? window.t(k) : k);
        if (params) for (const p in params) s = s.split('{' + p + '}').join(params[p]);
        return s;
    };

    /** Slavic plural pick: "1 раунд / 2 раунда / 5 раундов". The key holds all
     *  three forms pipe-separated; languages without the distinction just repeat
     *  the same word three times. */
    function plural(n, key) {
        const f = T(key).split('|');
        if (f.length < 3) return f[0] || '';
        const n10 = n % 10, n100 = n % 100;
        if (n10 === 1 && n100 !== 11) return f[0];
        if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return f[1];
        return f[2];
    }
    // Heat ramp per side. Additive blending turns dense areas into white fog, so
    // the colour is ramped explicitly instead: cool+faint where a player passes
    // through, saturated where they actually hold.
    const RAMP = {
        1: [[0.00, [30, 62, 104], 0.00], [0.20, [46, 96, 156], 0.26],
            [0.45, [96, 158, 214], 0.52], [0.72, [158, 206, 240], 0.74],
            [1.00, [226, 243, 255], 0.90]],
        0: [[0.00, [92, 44, 16], 0.00], [0.20, [148, 72, 24], 0.26],
            [0.45, [216, 118, 44], 0.52], [0.72, [248, 172, 84], 0.74],
            [1.00, [255, 231, 166], 0.90]],
    };

    function rampAt(side, t) {
        const st = RAMP[side];
        for (let i = 1; i < st.length; i++) {
            if (t <= st[i][0]) {
                const [p0, c0, a0] = st[i - 1], [p1, c1, a1] = st[i];
                const k = (t - p0) / (p1 - p0 || 1);
                return [
                    c0[0] + (c1[0] - c0[0]) * k,
                    c0[1] + (c1[1] - c0[1]) * k,
                    c0[2] + (c1[2] - c0[2]) * k,
                    (a0 + (a1 - a0) * k) * 255,
                ];
            }
        }
        const l = st[st.length - 1];
        return [l[1][0], l[1][1], l[1][2], l[2] * 255];
    }
    let D = null, model = null, side = 1, sel = null, radar = null, raf = 0, computeMs = 0;

    function renderSub() {
        const n = (D.rounds || []).length;
        sub.textContent = T('impact.sub') + ' · ' + n + ' ' +
            plural(n, 'impact.roundsF') + ' · ' + computeMs + 'MS';
    }

    // Everything below is rendered from JS, so it has to be rebuilt by hand when
    // the user switches language — applyLang() only touches [data-i18n] nodes.
    document.addEventListener('langchange', () => {
        const scale = document.querySelector('.imp-scale-lab');
        if (scale) scale.textContent = T('impact.timeSpent');
        const hi = document.querySelectorAll('.imp-scale-lab')[1];
        if (hi) hi.textContent = T('impact.high');
        if (!panel.hidden && model) { renderSub(); setSide(side); }
    });

    function attach(data) {
        D = data; model = null; sel = null; side = 1;
        close();
    }

    /** The canvas was pinned to the 560px it is authored at, so on a 1080p
     *  screen the radar sat in the middle of a 1200px column at half size.
     *  Size it to whatever the stage cell actually offers, minus the scale
     *  legend below it. Everything in paint() derives from canvas.width, so
     *  the drawing is resolution-independent and just follows. */
    function sizeCanvas() {
        const stage = canvas.parentElement;
        if (!stage || panel.hidden) return false;
        const cs = getComputedStyle(stage);
        const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        const legend = stage.querySelector('.imp-scale');
        const legendH = legend ? legend.getBoundingClientRect().height + parseFloat(cs.rowGap || 12) : 0;
        const box = stage.getBoundingClientRect();
        const s = Math.round(Math.max(520, Math.min(920,
            Math.min(box.width - padX, box.height - padY - legendH))));
        if (s === canvas.width) return false;
        canvas.width = s; canvas.height = s;
        return true;
    }

    function open() {
        if (!D) return;
        if (!model) {
            const t0 = performance.now();
            model = window.Impact.compute(D);
            computeMs = Math.round(performance.now() - t0);
        }
        renderSub();
        radar = new Image();
        radar.onload = draw;
        radar.onerror = () => { radar = null; draw(); };
        radar.src = '/static/radars/' + D.map + '.png';
        panel.hidden = false;
        // after the panel is shown, or the stage measures 0
        sizeCanvas();
        setSide(side);
        document.addEventListener('keydown', onKey);
    }

    window.addEventListener('resize', () => { if (!panel.hidden && sizeCanvas()) draw(); });

    function close() {
        panel.hidden = true;
        document.removeEventListener('keydown', onKey);
    }

    function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); close(); }
    }

    function setSide(s) {
        side = s;
        seg.querySelectorAll('.imp-seg-btn').forEach(b => {
            const on = +b.dataset.side === s;
            b.classList.toggle('on', on);
            b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        const m = model[side] || {};
        const ids = Object.keys(m).sort((a, b) => m[b].frames - m[a].frames);
        if (sel == null || !m[sel]) sel = ids[0] != null ? +ids[0] : null;
        scaleBar.style.background = 'linear-gradient(90deg,' + RAMP[side]
            .map(([p, c, a]) => `rgba(${c[0]},${c[1]},${c[2]},${a}) ${(p * 100).toFixed(0)}%`)
            .join(',') + ')';
        renderRoster(ids, m);
        renderProfile();
        draw();
    }

    const nameOf = i => (D.players[i] && D.players[i].name) || '?';

    /* FACEIT profiles, resolved once per steamid and reused across side
     * switches. No key configured just means every row keeps its initials. */
    /* One store shared with the demo viewer: it prefetches every profile behind
     * the loading screen, so by the time this panel opens the lookups are hits
     * and the FACEIT block renders on the first paint. */
    const profiles = {};
    const pending = {};
    function faceitProfile(steamid) {
        if (!steamid) return Promise.resolve(null);
        if (profiles[steamid] !== undefined) return Promise.resolve(profiles[steamid]);
        if (pending[steamid]) return pending[steamid];
        pending[steamid] = fetch('/api/faceit/avatar?steamid=' + encodeURIComponent(steamid))
            .then(r => r.json())
            .then(j => (profiles[steamid] = j && j.ok ? j : null))
            .catch(() => (profiles[steamid] = null))
            .finally(() => { delete pending[steamid]; });
        return pending[steamid];
    }
    window.FaceitProfile = { get: faceitProfile, peek: sid => profiles[sid] || null };

    function initials(name) {
        const s = (name || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim();
        if (!s) return '?';
        const parts = s.split(/\s+/);
        return (parts.length > 1 ? parts[0][0] + parts[1][0] : s.slice(0, 2)).toUpperCase();
    }

    /** Both squads play both sides across the halves, so a flat list of ten is
     *  just a heap. Split it back into the two actual teams. */
    function byTeam(ids) {
        const a = new Set((D.teamA || []).map(Number));
        const groups = [
            { name: D.teamAName, ids: [] },
            { name: D.teamBName, ids: [] },
        ];
        for (const id of ids) groups[a.has(+id) ? 0 : 1].ids.push(id);
        return groups.filter(g => g.ids.length);
    }

    function addRow(id, v) {
        const p = D.players[+id] || {};
        const row = document.createElement('button');
        row.className = 'imp-row' + (+id === sel ? ' on' : '');
        row.type = 'button';
        row.innerHTML =
            '<span class="imp-av" data-initials="' + initials(p.name) + '"></span>' +
            '<span class="imp-row-name"></span>' +
            '<span class="imp-row-role"></span>' +
            '<span class="imp-row-meta"><b class="imp-lvl" hidden></b>' +
            '<span class="imp-row-time"></span></span>';
        row.querySelector('.imp-row-name').textContent = p.name || '?';
        row.querySelector('.imp-row-role').textContent = T('impact.role.' + v.role);
        row.querySelector('.imp-row-time').textContent = Math.round(v.seconds) + 's';
        row.addEventListener('click', () => {
            sel = +id;
            roster.querySelectorAll('.imp-row').forEach(r => r.classList.remove('on'));
            row.classList.add('on');
            renderProfile(); draw();
        });
        roster.appendChild(row);

        faceitProfile(p.steamid).then(fp => {
            if (!fp || !row.isConnected) return;
            const av = row.querySelector('.imp-av');
            if (fp.url) {
                const im = new Image();
                im.alt = '';
                im.onload = () => { av.classList.add('has-img'); av.appendChild(im); };
                im.src = fp.url;
            }
            if (+id === sel) renderProfile();
            if (fp.lvl) {
                const b = row.querySelector('.imp-lvl');
                b.innerHTML = '<img src="/static/faceit_levels/' + fp.lvl + '.png" alt="">';
                b.title = 'FACEIT ' + fp.lvl + (fp.elo ? ' · ' + fp.elo + ' elo' : '');
                b.hidden = false;
            }
        });
    }

    function renderRoster(ids, m) {
        roster.innerHTML = '';
        const head = document.createElement('div');
        head.className = 'imp-roster-head ' + (side === 1 ? 'is-ct' : 'is-t');
        head.innerHTML = '<i class="imp-side-ico">' + (side === 1 ? ICON.ct : ICON.t) + '</i>' +
            '<span>' + T(side === 1 ? 'impact.ct' : 'impact.t') + '</span>' +
            '<em>' + ids.length + '</em>';
        roster.appendChild(head);

        byTeam(ids).forEach((g, gi) => {
            const th = document.createElement('div');
            th.className = 'imp-team-head';
            th.innerHTML = '<i>' + ICON.team + '</i><span></span><em>' + g.ids.length + '</em>';
            th.querySelector('span').textContent =
                g.name || (T('impact.team') + ' ' + (gi + 1));
            roster.appendChild(th);
            for (const id of g.ids) addRow(id, m[id]);
        });
    }

    function bar(label, value, text, hint) {
        const pct = Math.max(0, Math.min(1, value)) * 100;
        return '<div class="imp-metric" title="' + (hint || '') + '">' +
               '<span class="imp-metric-lab">' + label + '</span>' +
               '<span class="imp-metric-track"><i style="width:' + pct.toFixed(0) + '%"></i></span>' +
               '<span class="imp-metric-val">' + text + '</span></div>';
    }

    function renderProfile() {
        const v = model[side][sel];
        if (!v) { profile.innerHTML = ''; return; }
        const r = v.rank;
        const spots = window.Impact.hotspots(v, 3);
        const kd = v.deaths ? (v.kills / v.deaths).toFixed(2) : v.kills.toFixed(2);

        const sec = (icon, key) =>
            '<div class="imp-sec"><i>' + icon + '</i>' + T(key) + '</div>';

        const fp = profiles[(D.players[v.idx] || {}).steamid] || null;
        const faceit = fp && fp.lvl
            ? '<span class="imp-card-faceit">' +
                '<img src="/static/faceit_levels/' + fp.lvl + '.png" alt="">' +
                '<b>' + T('impact.lvl') + ' ' + fp.lvl + '</b>' +
                (fp.elo ? '<u>' + fp.elo.toLocaleString('en-US') + ' ELO</u>' : '') +
              '</span>'
            : '';

        profile.innerHTML =
            '<div class="imp-card">' +
              '<div class="imp-card-name">' + nameOf(v.idx) + '</div>' +
              faceit +
              '<div class="imp-role">' + T('impact.role.' + v.role) + '</div>' +
              '<ul class="imp-why">' +
                v.why.map(w => '<li>' + T(w[0], w[1]) + '</li>').join('') + '</ul>' +
            '</div>' +

            sec(ICON.positioning, 'impact.sec.positioning') +
            '<div class="imp-note">' + T('impact.pxNote') + '</div>' +
            bar(T('impact.m.spread'), r.roam, Math.round(v.roam) + 'px', T('impact.m.spreadH')) +
            bar(T('impact.m.discipline'), 1 - r.hold, Math.round(v.spotHold) + 'px',
                T('impact.m.disciplineH')) +
            bar(T('impact.m.isolation'), r.iso, Math.round(v.iso) + 'px', T('impact.m.isolationH')) +
            bar(T('impact.m.depth'), r.depth, Math.round(v.depth) + 'px', T('impact.m.depthH')) +

            sec(ICON.movement, 'impact.sec.movement') +
            bar(T('impact.m.repos'), v.moving, Math.round(v.moving * 100) + '%',
                T('impact.m.reposH')) +
            bar(T('impact.m.pace'), r.moving, Math.round(v.speed) + 'px/s', T('impact.m.paceH')) +

            sec(ICON.role, 'impact.sec.role') +
            bar(T('impact.m.sniper'), v.sniper, Math.round(v.sniper * 100) + '%',
                T('impact.m.sniperH')) +
            bar(T('impact.m.duels'), Math.min(1, r.openRate),
                (v.openK + v.openD) + ' (' + v.openK + 'W ' + v.openD + 'L)',
                T('impact.m.duelsH')) +

            sec(ICON.zones, 'impact.sec.zones') +
            '<div class="imp-zones">' +
              (spots.length
                ? (names => spots.map((s, i) => {
                    const nm = names[i];
                    return '<div class="imp-zone"><b>' + (i + 1) + '</b>' +
                      '<span class="imp-zone-main">' +
                        '<span class="imp-zone-name">' +
                          (nm ? T(nm) : T('impact.zone') + ' ' + (i + 1)) + '</span>' +
                        '<span class="imp-zone-bar"><i style="width:' +
                          Math.min(100, s.share * 100 * 2.2).toFixed(0) + '%"></i></span>' +
                      '</span>' +
                      '<span class="imp-zone-val">' + (s.share * 100).toFixed(0) + '%' +
                        '<em>' + s.rounds + ' ' + T('impact.rd') + '</em></span></div>';
                  }).join(''))(window.Impact.nameSpots(D.map, spots,
                        (D.radarSize || 1024) / v.gridN))
                : '<div class="imp-empty">' + T('impact.noZones') + '</div>') +
            '</div>' +

            '<div class="imp-foot">' +
              '<span>' + Math.round(v.seconds) + 's ' + T('impact.live') + ' · ' +
                v.rounds + ' ' + plural(v.rounds, 'impact.roundsLcF') + '</span>' +
              '<span class="imp-kd">' +
                '<b>' + ICON.kill + v.kills + '</b>' +
                '<b>' + ICON.death + v.deaths + '</b>' +
                '<u>' + kd + '</u></span>' +
            '</div>';
    }

    /* ------------------------------------------------------------ drawing */

    function draw() {
        // rAF never fires while the tab is hidden, which would leave the canvas
        // blank until the next interaction after the user comes back.
        if (document.hidden) { paint(); return; }
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(paint);
    }

    /** Canvas can't read CSS variables, so resolve the few tokens the radar
     *  paints with. Without this the plates and labels stay at the dark
     *  theme's values and invert against the light themes' radar. */
    function token(name, fallback) {
        const v = getComputedStyle(document.documentElement)
            .getPropertyValue(name).trim();
        return v || fallback;
    }
    function tokenRGBA(name, alpha, fallback) {
        const hex = token(name, fallback).replace('#', '');
        if (!/^[0-9a-f]{6}$/i.test(hex)) return fallback;
        return 'rgba(' + parseInt(hex.slice(0, 2), 16) + ','
                       + parseInt(hex.slice(2, 4), 16) + ','
                       + parseInt(hex.slice(4, 6), 16) + ',' + alpha + ')';
    }

    function paint() {
        raf = 0;
        const v = model && model[side] ? model[side][sel] : null;
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = token('--radar-bg', '#14130f');
        ctx.fillRect(0, 0, W, H);

        if (radar) {
            ctx.globalAlpha = 0.78;
            ctx.drawImage(radar, 0, 0, W, H);
            ctx.globalAlpha = 1;
            // knock the map back toward the page ground so the heat reads as
            // the foreground — toward black on dark, toward paper on light
            ctx.fillStyle = tokenRGBA('--bg', 0.34, 'rgba(14,13,11,0.34)');
            ctx.fillRect(0, 0, W, H);
        }
        if (!v) return;

        const S = W / (D.radarSize || 1024);
        const G = v.gridN, g = v.grid;
        let peak = 0;
        for (let i = 0; i < g.length; i++) if (g[i] > peak) peak = g[i];
        if (!peak) return;

        // Heat, drawn at grid resolution then scaled up so the browser does the
        // smoothing for us — the banded steps are what make it read like a
        // football heat map rather than a fog.
        const off = document.createElement('canvas');
        off.width = G; off.height = G;
        const octx = off.getContext('2d');
        const img = octx.createImageData(G, G);
        const c = SIDE_COL[side];
        for (let i = 0; i < g.length; i++) {
            const t = g[i] / peak;
            // Below this a cell is just transit — drawing it floods the map on
            // T side, where players cover far more ground than on CT.
            if (t <= 0.07) continue;
            // gamma-lift the low end, then quantise into bands: the discrete
            // steps are what make this read as a football heat map, not a blur
            const band = Math.ceil(Math.pow(t, 0.62) * 5) / 5;
            const [r, gg, b, a] = rampAt(side, band);
            const p = i * 4;
            img.data[p] = r; img.data[p + 1] = gg; img.data[p + 2] = b; img.data[p + 3] = a;
        }
        octx.putImageData(img, 0, 0);

        // Blurring pushes occupancy past walls and off the map edge. The radar
        // PNG is ~69% transparent outside the playable area, so using its alpha
        // as a mask clips the spill back to where the map actually is.
        const layer = document.createElement('canvas');
        layer.width = W; layer.height = H;
        const lctx = layer.getContext('2d');
        lctx.imageSmoothingEnabled = true;
        lctx.imageSmoothingQuality = 'high';
        lctx.drawImage(off, 0, 0, W, H);
        if (radar) {
            lctx.globalCompositeOperation = 'destination-in';
            lctx.drawImage(radar, 0, 0, W, H);
            lctx.globalCompositeOperation = 'source-over';
        }
        ctx.drawImage(layer, 0, 0);

        const col = `rgb(${c[0]},${c[1]},${c[2]})`;

        // 1-sigma dispersion ellipse from the position covariance
        const [vxx, vyy, vxy] = v.cov;
        const tr = vxx + vyy, det = vxx * vyy - vxy * vxy;
        const disc = Math.max(0, tr * tr / 4 - det);
        const l1 = tr / 2 + Math.sqrt(disc), l2 = tr / 2 - Math.sqrt(disc);
        const ang = Math.abs(vxy) < 1e-6 ? (vxx >= vyy ? 0 : Math.PI / 2)
                                         : Math.atan2(l1 - vxx, vxy);
        ctx.save();
        ctx.translate(v.mx * S, v.my * S);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.sqrt(Math.max(l1, 1)) * S, Math.sqrt(Math.max(l2, 1)) * S,
                    0, 0, Math.PI * 2);
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.25 * Math.max(1, W / 560);
        ctx.setLineDash([5, 4].map(n => n * Math.max(1, W / 560)));
        ctx.stroke();
        ctx.restore();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        // Annotation scale. All the sizes below were tuned against the 560px
        // canvas this was authored at; the stage now grows to fill the column,
        // so scale them with it or the labels shrink away against the map.
        const K = Math.max(1, W / 560);

        // map landmarks, so the numbered hotspots have something to sit against
        const cal = window.Impact.calib(D.map);
        if (cal) {
            ctx.font = '600 ' + (9 * K).toFixed(1) + 'px "IBM Plex Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (const [key, label] of window.Impact.LANDMARKS) {
                const w = cal[key];
                if (!w || typeof w.x !== 'number') continue;
                const lx = (w.x - cal.pos_x) / cal.scale * S;
                const ly = (cal.pos_y - w.y) / cal.scale * S;
                ctx.fillStyle = tokenRGBA('--text-primary', 0.32, 'rgba(236,230,218,0.30)');
                ctx.fillText(T(label), lx, ly);
            }
        }

        // numbered hotspots
        const spots = window.Impact.hotspots(v, 3);
        const cellPx = (D.radarSize || 1024) / G;
        spots.forEach((s, i) => {
            const x = (s.gx + 0.5) * cellPx * S, y = (s.gy + 0.5) * cellPx * S;
            ctx.beginPath();
            ctx.arc(x, y, 10 * K, 0, Math.PI * 2);
            ctx.fillStyle = tokenRGBA('--bg', 0.82, 'rgba(14,13,11,0.82)');
            ctx.fill();
            ctx.strokeStyle = col;
            ctx.lineWidth = 1.4 * K;
            ctx.stroke();
            ctx.fillStyle = col;
            ctx.font = '700 ' + (11 * K).toFixed(1) + 'px "IBM Plex Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(i + 1), x, y + 0.5 * K);
        });

        // average position — the football "average position" marker
        const ax = v.mx * S, ay = v.my * S;
        ctx.strokeStyle = token('--bg', '#0e0d0b');
        ctx.lineWidth = 3.5 * K;
        crosshair(ax, ay, K);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.6 * K;
        crosshair(ax, ay, K);

        // canvas needs a literal stack; keep it in step with --font-head so the
        // radar labels match the panel around them, Cyrillic nicks included
        ctx.font = '700 ' + (11 * K).toFixed(1) + 'px "Exo 2", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const label = nameOf(v.idx).toUpperCase();
        const w = ctx.measureText(label).width;
        ctx.fillStyle = tokenRGBA('--bg', 0.88, 'rgba(14,13,11,0.88)');
        ctx.fillRect(ax - w / 2 - 5 * K, ay - 32 * K, w + 10 * K, 14 * K);
        ctx.fillStyle = col;
        ctx.fillText(label, ax, ay - 20 * K);
    }

    function crosshair(x, y, k) {
        const a = 8 * k, b = 2.5 * k;
        ctx.beginPath();
        ctx.moveTo(x - a, y); ctx.lineTo(x - b, y);
        ctx.moveTo(x + b, y); ctx.lineTo(x + a, y);
        ctx.moveTo(x, y - a); ctx.lineTo(x, y - b);
        ctx.moveTo(x, y + b); ctx.lineTo(x, y + a);
        ctx.stroke();
    }

    if (btn) btn.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    seg.addEventListener('click', e => {
        const b = e.target.closest('.imp-seg-btn');
        if (b) setSide(+b.dataset.side);
    });

    window.ImpactPanel = { attach, open, close };
})();

/* ------------------------------------------------- FACEIT key card (demo tab) */
(function () {
    const $ = id => document.getElementById(id);
    const card = $('faceitKeyCard');
    if (!card) return;

    const state = $('fkState'), input = $('fkInput'), save = $('fkSave'),
          clear = $('fkClear'), msg = $('fkMsg');

    const TT = k => (window.t ? window.t(k) : k);
    let connected = false;

    function setState(on) {
        connected = !!on;
        document.dispatchEvent(new CustomEvent('faceitkey', { detail: { set: !!on } }));
        state.textContent = TT(on ? 'fk.connected' : 'fk.notSet');
        state.classList.toggle('on', !!on);
        clear.hidden = !on;
        input.placeholder = TT(on ? 'fk.phSet' : 'fk.ph');
    }

    // applyLang() rewrites the [data-i18n] nodes but not the state text or the
    // placeholder, both of which depend on whether a key is stored.
    document.addEventListener('langchange', () => { setState(connected); msg.textContent = ''; });

    function note(text, bad) {
        msg.textContent = text || '';
        msg.classList.toggle('bad', !!bad);
    }

    fetch('/api/faceit/key').then(r => r.json())
        .then(j => setState(j && j.set))
        .catch(() => setState(false));

    save.addEventListener('click', () => {
        const key = input.value.trim();
        if (!key) { note(TT('fk.needKey'), true); return; }
        save.disabled = true; note(TT('fk.checkingMsg'));
        fetch('/api/faceit/key', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key }),
        }).then(r => r.json()).then(j => {
            if (j && j.ok) { input.value = ''; setState(true); note(TT('fk.saved')); }
            else note((j && j.message) || TT('fk.rejected'), true);
        }).catch(() => note(TT('fk.noBackend'), true))
          .finally(() => { save.disabled = false; });
    });

    clear.addEventListener('click', () => {
        fetch('/api/faceit/key', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: '' }),
        }).then(() => { input.value = ''; setState(false); note(TT('fk.removed')); })
          .catch(() => note(TT('fk.noBackend'), true));
    });
})();
