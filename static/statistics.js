(function () {
    'use strict';

    var root = null;
    var inited = false;
    var library = [];          
    var currentKey = null;     
    var data = null;           
    var selPlayer = -1;        
    var avatarCache = {};      
    var loadToken = 0;         
    var sortKey = 'rating';    
    var sortDir = -1;          

    function el(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function mapShort(m) { return String(m || '').replace(/^de_/, ''); }
    function n1(v) { return (v == null || isNaN(v)) ? '0.0' : Number(v).toFixed(1); }
    function n2(v) { return (v == null || isNaN(v)) ? '0.00' : Number(v).toFixed(2); }
    function pct(v) { return (v == null || isNaN(v)) ? '0%' : Math.round(v) + '%'; }
    function sgn(v) { v = Math.round(v || 0); return (v > 0 ? '+' : '') + v; }
    function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

    /** Same contract as Impact 1.0's T(): look the key up, then fill {slots}. */
    function T(k, params) {
        var s = (window.t ? window.t(k) : k);
        if (params) for (var p in params) s = s.split('{' + p + '}').join(params[p]);
        return s;
    }

    function scoutOf(idx) {
        var sc = data && data.scout;
        return (sc && sc.players && sc.players[idx]) || null;
    }
    function nameOf(idx) {
        var s = (data.stats || [])[idx] || {}, p = (data.players || [])[idx] || {};
        return s.name || p.name || '?';
    }

    /** A number with no baseline is useless to a scout, so every headline
     *  metric is placed against the other nine. `low` flips the ordering for
     *  metrics where less is better (time blinded, openings lost un-traded). */
    function series(get) {
        return (data.stats || []).map(function (s, i) {
            var v = get(s || {}, scoutOf(i) || {}, i);
            return (v == null || isNaN(v)) ? 0 : Number(v);
        });
    }
    function rankIn(arr, idx, low) {
        var v = arr[idx] || 0, better = 0, max = 0;
        for (var i = 0; i < arr.length; i++) {
            if (Math.abs(arr[i]) > max) max = Math.abs(arr[i]);
            if (i !== idx && (low ? arr[i] < v : arr[i] > v)) better++;
        }
        return { rank: better + 1, of: arr.length, frac: max ? Math.abs(v) / max : 0 };
    }
    function metric(label, arr, idx, readout, opts) {
        opts = opts || {};
        var r = rankIn(arr, idx, !!opts.low);
        var top = r.rank === 1;
        // The chip stays compact (#3) so it can't clip in either language; the
        // spelled-out standing, and the direction for "less is better"
        // metrics, live in the tooltip.
        var full = (top ? T('st.rankBest', { m: r.of }) : T('st.rank', { n: r.rank, m: r.of })) +
                   (opts.low ? ' — ' + T('st.rankLow') : '');
        return '<div class="sc-m' + (opts.hero ? ' is-hero' : '') + '">' +
            '<span class="sc-m-l" title="' + esc(label) + '">' + esc(label) + '</span>' +
            '<span class="sc-m-bar"><i style="width:' + Math.round(clamp01(r.frac) * 100) + '%"></i></span>' +
            '<span class="sc-m-v">' + readout + '</span>' +
            '<span class="sc-rank' + (top ? ' is-top' : '') + '" title="' + esc(full) + '">' +
                '#' + r.rank + '</span>' +
        '</div>';
    }

    function mapImgUrl(mapId) {
        if (!mapId) return '';
        var list = (typeof MAPS !== 'undefined' && Array.isArray(MAPS)) ? MAPS : [];
        for (var i = 0; i < list.length; i++) if (list[i].id === mapId) return '/maps/' + list[i].file;
        var base = mapId.replace(/^de_/, '');
        if (!base) return '';
        return '/maps/' + base.charAt(0).toUpperCase() + base.slice(1) + '.jpg';
    }

    function initials(name) {
        var parts = String(name || '?').trim().split(/[\s_\-|]+/).filter(Boolean);
        if (!parts.length) return '?';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }

    function fallbackAvatar(node, name, isCt) {
        node.classList.add('stats-av--fallback');
        node.classList.toggle('is-ct', isCt);
        node.classList.toggle('is-t', !isCt);
        node.textContent = initials(name);
    }

    function loadAvatar(node, steamid, name, isCt) {
        function paintImg(url) {
            node.classList.remove('stats-av--fallback', 'is-ct', 'is-t');
            node.textContent = '';
            var img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            img.onerror = function () { fallbackAvatar(node, name, isCt); };
            img.src = url;
            node.appendChild(img);
        }
        if (!steamid) { fallbackAvatar(node, name, isCt); return; }
        if (avatarCache[steamid] === false) { fallbackAvatar(node, name, isCt); return; }
        if (avatarCache[steamid]) { paintImg(avatarCache[steamid]); return; }
        
        fallbackAvatar(node, name, isCt);
        fetch('/api/faceit/avatar?steamid=' + encodeURIComponent(steamid))
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (j && j.ok && j.url) { avatarCache[steamid] = j.url; paintImg(j.url); }
                else { avatarCache[steamid] = false; }
            })
            .catch(function () { avatarCache[steamid] = false; });
    }

    function isCtIndex(idx) {

        return data && data.teamA && data.teamA.indexOf(idx) !== -1;
    }

    function buildShell() {
        root.innerHTML = '' +
            '<header class="stats-head">' +
                '<div class="stats-head-title">' +
                    '<span class="stats-kicker">' + esc(T('st.kicker')) + '</span>' +
                    '<h2 class="stats-h2">' + esc(T('st.title')) + '</h2>' +
                '</div>' +
                '<div class="stats-picker" id="statsPicker"></div>' +
            '</header>' +
            '<div class="stats-summary" id="statsSummary"></div>' +
            '<div class="stats-board" id="statsBoard"></div>' +
            '<div class="stats-dossier" id="statsDossier"></div>';
    }

    function showEmptyLibrary() {
        root.innerHTML =
            '<div class="stats-empty">' +
                '<div class="stats-empty-tick"></div>' +
                '<div class="stats-empty-title">' + esc(T('st.empty.title')) + '</div>' +
                '<p class="stats-empty-body">' + esc(T('st.empty.body')) + '</p>' +
            '</div>';
    }
    function showError(msg) {
        var d = el('statsDossier');
        if (d) d.innerHTML = '<div class="stats-empty stats-empty--inline">' +
            '<div class="stats-empty-title">' + esc(T('st.err.title')) + '</div>' +
            '<p class="stats-empty-body">' + esc(msg || T('st.err.body')) + '</p></div>';
    }

    function renderPicker() {
        var box = el('statsPicker');
        if (!box) return;
        box.innerHTML = '';
        
        var lib = library.slice().sort(function (a, b) { return (b.added || 0) - (a.added || 0); });
        lib.forEach(function (d) {
            var b = document.createElement('button');
            b.className = 'stats-demo' + (d.key === currentKey ? ' is-on' : '');
            b.type = 'button';
            b.title = d.name || d.key;
            b.innerHTML =
                '<img class="stats-demo-thumb" alt="" loading="lazy">' +
                '<span class="stats-demo-text">' +
                    '<span class="stats-demo-map">' + esc(mapShort(d.map).toUpperCase()) + '</span>' +
                    '<span class="stats-demo-score"><b>' + esc(d.sa) + '</b>:<b>' + esc(d.sb) + '</b></span>' +
                '</span>';
            var img = b.querySelector('.stats-demo-thumb');
            img.onerror = function () { img.style.visibility = 'hidden'; };
            var u = mapImgUrl(d.map);
            if (u) img.src = u; else img.style.visibility = 'hidden';
            b.addEventListener('click', function () { selectDemo(d.key); });
            box.appendChild(b);
        });
    }

    function renderSummary() {
        var box = el('statsSummary');
        if (!box || !data) { if (box) box.innerHTML = ''; return; }
        var aWin = data.sa > data.sb, bWin = data.sb > data.sa;
        box.innerHTML =
            '<div class="stats-sum-map">' +
                '<img class="stats-sum-thumb" alt="">' +
                '<span class="stats-sum-name">' + esc(mapShort(data.map).toUpperCase()) + '</span>' +
            '</div>' +
            '<div class="stats-sum-score">' +
                '<span class="stats-sum-s ' + (aWin ? 'win' : '') + ' is-ct">' + esc(data.sa) + '</span>' +
                '<span class="stats-sum-sep">:</span>' +
                '<span class="stats-sum-s ' + (bWin ? 'win' : '') + ' is-t">' + esc(data.sb) + '</span>' +
            '</div>' +
            '<dl class="stats-sum-meta">' +
                '<div><dt>' + esc(T('st.sum.rounds')) + '</dt><dd>' + esc(data.rounds) + '</dd></div>' +
                '<div><dt>' + esc(T('st.sum.players')) + '</dt><dd>' + esc((data.players || []).length) + '</dd></div>' +
            '</dl>';
        var img = box.querySelector('.stats-sum-thumb');
        img.onerror = function () { img.style.visibility = 'hidden'; };
        var u = mapImgUrl(data.map);
        if (u) img.src = u; else img.style.visibility = 'hidden';
    }

    /* Labels are i18n keys resolved at render time, not at module load, so a
       language switch repaints the header without a reload. */
    var COLS = [
        { key: 'rating', lk: 'st.col.rating', tk: 'st.colT.rating', group: 'rate',
          val: function (s) { return s.rating || 0; } },
        { key: 'k',  lk: 'st.col.k', tk: 'st.colT.k', group: 'frag', val: function (s) { return s.k || 0; },   fmt: function (s) { return esc(s.k); } },
        { key: 'd',  lk: 'st.col.d', tk: 'st.colT.d', group: 'frag', val: function (s) { return s.d || 0; },   fmt: function (s) { return esc(s.d); } },
        { key: 'a',  lk: 'st.col.a', tk: 'st.colT.a', group: 'frag', val: function (s) { return s.a || 0; },   fmt: function (s) { return esc(s.a); } },
        { key: 'pm', lk: 'st.col.pm', tk: 'st.colT.pm', group: 'frag',
          val: function (s) { return s.pm || 0; },
          fmt: function (s) { var v = s.pm || 0; return '<span class="' + (v >= 0 ? 'good' : 'bad') + '">' + sgn(v) + '</span>'; } },
        { key: 'adr',   lk: 'st.col.adr', tk: 'st.colT.adr', group: 'impact',
          val: function (s) { return s.adr || 0; }, fmt: function (s) { return Math.round(s.adr || 0); } },
        { key: 'kast',  lk: 'st.col.kast', tk: 'st.colT.kast', group: 'impact',
          val: function (s) { return s.kast || 0; }, fmt: function (s) { return pct(s.kast); } },
        { key: 'hsPct', lk: 'st.col.hs', tk: 'st.colT.hs', group: 'impact',
          val: function (s) { return s.hsPct || 0; }, fmt: function (s) { return pct(s.hsPct); } }
    ];

    function sortIndices(indices) {
        var col = null;
        for (var i = 0; i < COLS.length; i++) if (COLS[i].key === sortKey) { col = COLS[i]; break; }
        if (!col) col = COLS[0];
        var arr = (indices || []).slice();
        arr.sort(function (a, b) {
            var va = col.val(data.stats[a] || {}), vb = col.val(data.stats[b] || {});
            if (va === vb) {  
                var ra = (data.stats[a] || {}).rating || 0, rb = (data.stats[b] || {}).rating || 0;
                return rb - ra;
            }
            return (va - vb) * sortDir;
        });
        return arr;
    }

    function boardHead() {
        var cells = COLS.map(function (c) {
            var on = c.key === sortKey;
            var caret = on ? (sortDir < 0 ? '▾' : '▴') : '';
            return '<button class="stats-th c-num g-' + c.group + (on ? ' is-sort' : '') + '" type="button" ' +
                'data-key="' + c.key + '" title="' + esc(T(c.tk)) + '" ' +
                'aria-sort="' + (on ? (sortDir < 0 ? 'descending' : 'ascending') : 'none') + '">' +
                esc(T(c.lk)) + '<i class="stats-th-caret">' + caret + '</i></button>';
        }).join('');
        return '<div class="stats-thead" role="row">' +
            '<span class="stats-th c-name" role="columnheader">' + esc(T('st.col.player')) + '</span>' +
            cells + '</div>';
    }

    function dividerRow(name, isCt, score) {
        return '<div class="stats-div ' + (isCt ? 'is-ct' : 'is-t') + '" role="row">' +
            '<span class="stats-div-led"></span>' +
            '<span class="stats-div-name">' + esc(name) + '</span>' +
            '<span class="stats-div-score">' + esc(score) + '</span></div>';
    }

    function ratingClass(r) {
        if (r >= 1.0) return 'good';
        if (r < 0.85) return 'bad';
        return 'mid';
    }

    function playerRow(idx, ratMax) {
        var s = data.stats[idx], p = data.players[idx] || {};
        var sel = idx === selPlayer ? ' is-sel' : '';
        var r = s.rating || 0;
        var barW = Math.round(clamp01(ratMax ? r / ratMax : 0) * 100);

        var numCells = COLS.slice(1).map(function (c) {
            var v = c.fmt ? c.fmt(s) : '0';
            var active = c.key === sortKey ? ' is-sort' : '';
            return '<span class="c-num g-' + c.group + active + '">' + v + '</span>';
        }).join('');

        return '<button class="stats-row' + sel + '" type="button" data-idx="' + idx + '" role="row">' +
            '<span class="stats-row-name">' +
                '<span class="stats-av" data-av="' + idx + '"></span>' +
                '<span class="stats-row-nick">' + esc(s.name || p.name) + '</span>' +
            '</span>' +
            '<span class="stats-row-rat c-num g-rate' + (sortKey === 'rating' ? ' is-sort' : '') + '">' +
                '<span class="stats-rat-bar"><i class="' + ratingClass(r) + '" style="width:' + barW + '%"></i></span>' +
                '<b class="' + ratingClass(r) + '">' + n2(r) + '</b>' +
            '</span>' +
            numCells +
        '</button>';
    }

    function renderBoard() {
        var box = el('statsBoard');
        if (!box || !data) { if (box) box.innerHTML = ''; return; }

        var ratMax = 1;
        (data.stats || []).forEach(function (s) { if ((s.rating || 0) > ratMax) ratMax = s.rating; });

        function group(indices) {
            return sortIndices(indices).map(function (idx) { return playerRow(idx, ratMax); }).join('');
        }

        box.innerHTML =
            '<div class="stats-table" role="table">' +
                boardHead() +
                dividerRow(data.teamAName || 'TEAM A', true, data.sa) +
                group(data.teamA) +
                dividerRow(data.teamBName || 'TEAM B', false, data.sb) +
                group(data.teamB) +
            '</div>';

        box.querySelectorAll('.stats-av[data-av]').forEach(function (node) {
            var idx = +node.getAttribute('data-av');
            var p = data.players[idx] || {}, s = data.stats[idx] || {};
            loadAvatar(node, p.steamid, s.name || p.name, isCtIndex(idx));
        });
        
        box.querySelectorAll('.stats-row').forEach(function (b) {
            b.addEventListener('click', function () { selectPlayer(+b.getAttribute('data-idx')); });
        });
        
        box.querySelectorAll('.stats-th[data-key]').forEach(function (b) {
            b.addEventListener('click', function () {
                var k = b.getAttribute('data-key');
                if (k === sortKey) { sortDir = -sortDir; }
                else { sortKey = k; sortDir = -1; }
                renderBoard();
            });
        });
        if (window.cs2reveal) window.cs2reveal(box, '.stats-row');
    }

    function cell(label, value, klass) {
        return '<div class="stats-cell ' + (klass || '') + '">' +
            '<span class="stats-cell-v">' + value + '</span>' +
            '<span class="stats-cell-l">' + esc(label) + '</span></div>';
    }

    function meter(label, frac, readout, klass) {
        var w = Math.round(clamp01(frac) * 100);
        return '<div class="stats-meter ' + (klass || '') + '">' +
            '<span class="stats-meter-l">' + esc(label) + '</span>' +
            '<span class="stats-meter-track"><i style="width:' + w + '%"></i></span>' +
            '<span class="stats-meter-v">' + readout + '</span></div>';
    }

    function hitGroups(hg) {
        hg = hg || {};
        var segs = [
            ['head', hg.head || 0, 'HEAD'],
            ['chest', hg.chest || 0, 'CHEST'],
            ['stomach', hg.stomach || 0, 'STOM'],
            ['arm', hg.arm || 0, 'ARMS'],
            ['leg', hg.leg || 0, 'LEGS']
        ];
        var total = segs.reduce(function (a, s) { return a + s[1]; }, 0) || 1;
        var bar = segs.map(function (s) {
            var w = (s[1] / total) * 100;
            return '<i class="hg-' + s[0] + '" style="width:' + w.toFixed(2) + '%" title="' +
                s[2] + ' ' + s[1] + '"></i>';
        }).join('');
        var legend = segs.map(function (s) {
            return '<span class="stats-hg-key"><b class="hg-' + s[0] + '"></b>' +
                s[2] + ' <em>' + Math.round((s[1] / total) * 100) + '%</em></span>';
        }).join('');
        return '<div class="stats-hg"><div class="stats-hg-bar">' + bar + '</div>' +
            '<div class="stats-hg-legend">' + legend + '</div></div>';
    }

    function weaponBars(wk) {
        var arr = Object.keys(wk || {}).map(function (k) { return [k, wk[k]]; });
        arr.sort(function (a, b) { return b[1] - a[1]; });
        arr = arr.slice(0, 6);
        if (!arr.length) return '<div class="stats-faint">No weapon kills recorded.</div>';
        var max = arr[0][1] || 1;
        return '<div class="stats-wk">' + arr.map(function (w) {
            var pctw = Math.round((w[1] / max) * 100);
            return '<div class="stats-wk-row">' +
                '<span class="stats-wk-name">' +
                    (window.WeaponIcons ? window.WeaponIcons.html(w[0], 'wic-lg') : esc(w[0])) +
                '</span>' +
                '<span class="stats-wk-track"><i style="width:' + pctw + '%"></i></span>' +
                '<span class="stats-wk-v">' + w[1] + '</span></div>';
        }).join('') + '</div>';
    }

    function multiKills(multi) {
        multi = multi || [0, 0, 0, 0, 0];
        var labels = ['2K', '3K', '4K', 'ACE'];
        var vals = [multi[1] || 0, multi[2] || 0, multi[3] || 0, multi[4] || 0];
        return '<div class="stats-multi">' + labels.map(function (lb, i) {
            var on = vals[i] > 0 ? ' is-on' : '';
            return '<div class="stats-multi-col' + on + '">' +
                '<span class="stats-multi-v">' + vals[i] + '</span>' +
                '<span class="stats-multi-l">' + lb + '</span></div>';
        }).join('') + '</div>';
    }

    function clutches(w, l) {
        w = w || [0, 0, 0, 0, 0];
        l = l || [0, 0, 0, 0, 0];
        var out = '';
        for (var i = 0; i < 5; i++) {
            var won = w[i] || 0, lost = l[i] || 0, played = won + lost;
            var state = played === 0 ? 'none' : (won > 0 ? 'won' : 'lost');
            out += '<div class="stats-clutch is-' + state + '">' +
                '<span class="stats-clutch-l">1v' + (i + 1) + '</span>' +
                '<span class="stats-clutch-v">' + won + '<i>/</i>' + played + '</span></div>';
        }
        return '<div class="stats-clutches">' + out + '</div>';
    }

    function section(title, body) {
        return '<section class="stats-sec">' +
            '<h4 class="stats-sec-title">' + esc(title) + '</h4>' +
            '<div class="stats-sec-body">' + body + '</div></section>';
    }

    /* ---------------------------------------------- scout report components */

    /** A block states why its numbers matter, then shows them. */
    function block(titleKey, whyKey, body) {
        return '<section class="sc-block">' +
            '<h4 class="sc-block-t">' + esc(T(titleKey)) + '</h4>' +
            '<p class="sc-block-why">' + esc(T(whyKey)) + '</p>' +
            '<div class="sc-block-body">' + body + '</div></section>';
    }

    /** Round-by-round strip: form across the map rather than one average.
     *  Top edge = team result, centre = his kills, bottom strip = his own
     *  outcome (opening kill / died first / died / survived). */
    function timelineCard(sp) {
        var rounds = (sp && sp.rounds) || [];
        if (!rounds.length) return '';
        var cells = rounds.map(function (r) {
            var cls = 'sc-tl-c' + (r.won ? ' is-won' : ' is-lost');
            if (r.open) cls += ' is-open';
            else if (r.openDied) cls += ' is-opendied';
            else if (r.d) cls += ' is-died';
            var bits = [T('st.tl.round') + ' ' + r.n, r.won ? T('st.tl.won') : T('st.tl.lost'),
                        (r.k || 0) + ' ' + T('st.tl.kills')];
            if (r.open) bits.push(T('st.tl.open'));
            if (r.openDied) bits.push(T('st.tl.openDied'));
            else if (r.d) bits.push(T('st.tl.died'));
            else bits.push(T('st.tl.survived'));
            return '<div class="' + cls + '" title="' + esc(bits.join(' · ')) + '">' +
                '<span class="sc-tl-n">' + esc(r.n) + '</span>' +
                '<span class="sc-tl-k' + (r.k ? '' : ' is-zero') + '">' + (r.k || '·') + '</span>' +
                '<i class="sc-tl-f"></i></div>';
        }).join('');
        var key = function (c, k) { return '<span class="sc-tl-key"><i class="' + c + '"></i>' + esc(T(k)) + '</span>'; };
        return '<div class="sc-tl-card">' +
            '<div class="sc-tl-head">' +
                '<h4 class="sc-block-t">' + esc(T('st.tl.title')) + '</h4>' +
                '<p class="sc-block-why">' + esc(T('st.tl.why')) + '</p>' +
            '</div>' +
            '<div class="sc-tl">' + cells + '</div>' +
            '<div class="sc-tl-legend">' + key('k-won', 'st.tl.won') + key('k-lost', 'st.tl.lost') +
                key('k-open', 'st.tl.open') + key('k-od', 'st.tl.openDied') + key('', 'st.tl.died') +
            '</div></div>';
    }

    /** Cross-team duel grid. Rows are team A, columns team B, and each cell
     *  carries both directions as killed:died, so a lopsided pair is visible
     *  from either side. Same-team cells don't exist (the only diagonal value
     *  in the payload is a self-inflicted death), so a 5x5 is the real shape. */
    function matrixCard(selIdx) {
        var m = (data.scout && data.scout.matrix) || [];
        var A = data.teamA || [], B = data.teamB || [];
        if (!m.length || !A.length || !B.length) return '';
        var head = '<div class="sc-mx-corner"></div>' + B.map(function (bi) {
            return '<div class="sc-mx-hd is-t' + (bi === selIdx ? ' is-sel' : '') +
                '" title="' + esc(nameOf(bi)) + '">' + esc(nameOf(bi)) + '</div>';
        }).join('');
        var body = A.map(function (ai) {
            return '<div class="sc-mx-rh is-ct' + (ai === selIdx ? ' is-sel' : '') +
                    '" title="' + esc(nameOf(ai)) + '">' + esc(nameOf(ai)) + '</div>' +
                B.map(function (bi) {
                    var x = ((m[ai] || [])[bi]) || 0, y = ((m[bi] || [])[ai]) || 0, tot = x + y;
                    // "owns" the pair: enough duels to mean something, 3:1 or worse
                    var edge = tot >= 4 && (x >= y * 3 || y >= x * 3);
                    var cls = 'sc-mx-c' + (tot ? '' : ' is-void') + (edge ? ' is-edge' : '') +
                              ((ai === selIdx || bi === selIdx) ? ' is-sel' : '');
                    var ttl = T('st.mx.cell', { a: nameOf(ai), b: nameOf(bi), x: x, y: y });
                    return '<div class="' + cls + '" title="' + esc(ttl) + '">' +
                        (tot ? '<b>' + x + '</b><em>:</em><s>' + y + '</s>' : '·') + '</div>';
                }).join('');
        }).join('');
        var cols = 'grid-template-columns: minmax(96px, 1.5fr) repeat(' + B.length + ', minmax(60px, 1fr));';
        return '<div class="sc-mx-card">' +
            '<div class="sc-tl-head">' +
                '<h4 class="sc-block-t">' + esc(T('st.mx.title')) + '</h4>' +
                '<p class="sc-block-why">' + esc(T('st.mx.why')) + '</p>' +
            '</div>' +
            '<div class="sc-mx-scroll"><div class="sc-mx" style="' + cols + '">' + head + body + '</div></div>' +
            '<div class="sc-mx-foot"><span>' + esc(T('st.mx.legend')) + '</span>' +
                '<span>' + esc(T('st.mx.edge')) + '</span></div>' +
        '</div>';
    }

    /** Clutches folded to 1v1 / 1v2 / 1v3+, wins forward and attempts muted —
     *  attempts are roughly "rounds his team was already losing". */
    function clutchGrid(sp) {
        var c = (sp && sp.clutch) || {};
        var keys = Object.keys(c);
        if (!keys.length) return '<div class="sc-empty">' + esc(T('st.close.none')) + '</div>';
        var buckets = [['1v1', [0, 0]], ['1v2', [0, 0]], [T('st.close.plus'), [0, 0]]];
        keys.forEach(function (k) {
            var v = c[k] || [0, 0];
            var n = parseInt(String(k).split('v')[1], 10) || 1;
            var b = n === 1 ? 0 : (n === 2 ? 1 : 2);
            buckets[b][1][0] += v[0] || 0;
            buckets[b][1][1] += v[1] || 0;
        });
        return '<div class="stats-clutches">' + buckets.map(function (b) {
            var att = b[1][0], won = b[1][1];
            var state = att === 0 ? 'none' : (won > 0 ? 'won' : 'lost');
            return '<div class="stats-clutch is-' + state + '">' +
                '<span class="stats-clutch-l">' + esc(b[0]) + '</span>' +
                '<span class="stats-clutch-v">' + won + '<i>/</i>' + att + '</span></div>';
        }).join('') + '</div>';
    }

    function buySplit(sp) {
        var b = (sp && sp.buys) || {};
        var eco = b.eco || 0, force = b.force || 0, full = b.full || 0;
        var tot = eco + force + full || 1;
        var seg = function (cls, v, key) {
            return v ? '<i class="' + cls + '" style="width:' + ((v / tot) * 100).toFixed(2) + '%" title="' +
                esc(T(key) + ' ' + v) + '"></i>' : '';
        };
        return '<div class="sc-buys">' + seg('sc-buy-eco', eco, 'st.disc.eco') +
            seg('sc-buy-force', force, 'st.disc.force') + seg('sc-buy-full', full, 'st.disc.full') + '</div>' +
            '<div class="stats-hg-legend">' +
                '<span class="stats-hg-key"><b class="sc-buy-eco"></b>' + esc(T('st.disc.eco')) + ' <em>' + eco + '</em></span>' +
                '<span class="stats-hg-key"><b class="sc-buy-force"></b>' + esc(T('st.disc.force')) + ' <em>' + force + '</em></span>' +
                '<span class="stats-hg-key"><b class="sc-buy-full"></b>' + esc(T('st.disc.full')) + ' <em>' + full + '</em></span>' +
            '</div>';
    }

    function renderDossier() {
        var box = el('statsDossier');
        if (!box || !data) { if (box) box.innerHTML = ''; return; }
        if (selPlayer < 0 || !data.stats[selPlayer]) {
            box.innerHTML = '<div class="stats-empty stats-empty--inline">' +
                '<p class="stats-empty-body">' + esc(T('st.selectPlayer')) + '</p></div>';
            return;
        }
        var i = selPlayer;
        var s = data.stats[i], p = data.players[i] || {}, sp = scoutOf(i) || {};
        var ct = isCtIndex(i);
        var u = sp.util || {};

        /* ---- OPENS ROUNDS: first contact, and whether it cost the team ---- */
        var openW = sp.openW || 0, openL = sp.openL || 0, openTr = sp.openLTraded || 0;
        var alone = Math.max(0, openL - openTr);
        var opensBody = (openW + openL)
            ? '<div class="stats-cellgrid stats-cellgrid--4">' +
                  cell(T('st.open.won'), esc(openW)) +
                  cell(T('st.open.lost'), esc(openL)) +
                  cell(T('st.open.traded'), esc(openTr)) +
                  cell(T('st.open.alone'), '<b class="' + (alone > 2 ? 'bad' : '') + '">' + alone + '</b>') +
              '</div>' +
              metric(T('st.open.won'), series(function (x, y) { return y.openW; }), i, esc(openW), { hero: true }) +
              metric(T('st.open.rate'), series(function (x, y) {
                  var t = (y.openW || 0) + (y.openL || 0); return t ? (y.openW / t) * 100 : 0;
              }), i, pct((openW + openL) ? (openW / (openW + openL)) * 100 : 0)) +
              metric(T('st.open.alone'), series(function (x, y) {
                  return Math.max(0, (y.openL || 0) - (y.openLTraded || 0));
              }), i, esc(alone), { low: true })
            : '<div class="sc-empty">' + esc(T('st.open.none')) + '</div>';

        /* ---- CLOSES ROUNDS: clutches; only the wins mean anything --------- */
        var clutchWon = 0, clutchAtt = 0;
        Object.keys(sp.clutch || {}).forEach(function (k) {
            var v = sp.clutch[k] || [0, 0]; clutchAtt += v[0] || 0; clutchWon += v[1] || 0;
        });
        var closesBody =
            '<div class="stats-cellgrid stats-cellgrid--2">' +
                cell(T('st.close.won'), '<b class="' + (clutchWon ? 'good' : '') + '">' + clutchWon + '</b>') +
                cell(T('st.close.att'), esc(clutchAtt)) +
            '</div>' +
            clutchGrid(sp) +
            metric(T('st.close.won'), series(function (x, y) {
                var w = 0; Object.keys(y.clutch || {}).forEach(function (k) { w += (y.clutch[k] || [0, 0])[1] || 0; });
                return w;
            }), i, esc(clutchWon), { hero: true });

        /* ---- PLAYS FOR THE TEAM: trades both ways + flash support -------- */
        var teamBody =
            '<div class="stats-cellgrid stats-cellgrid--4">' +
                cell(T('st.team.tradedFor'), esc(sp.tradedFor || 0)) +
                cell(T('st.team.tradedBy'), esc(sp.tradedBy || 0)) +
                cell(T('st.team.flAssist'), esc(s.flAssist || 0)) +
                cell(T('st.team.flThrown'), esc(u.flash != null ? u.flash : (s.flThrown || 0))) +
            '</div>' +
            metric(T('st.team.tradedBy'), series(function (x, y) { return y.tradedBy; }), i, esc(sp.tradedBy || 0), { hero: true }) +
            metric(T('st.team.tradedFor'), series(function (x, y) { return y.tradedFor; }), i, esc(sp.tradedFor || 0)) +
            metric(T('st.team.flEnemy'), series(function (x, y) {
                return (y.util || {}).flashHits;
            }), i, esc(u.flashHits != null ? u.flashHits : (s.flEnemy || 0))) +
            metric(T('st.team.blindOut'), series(function (x, y) {
                return (y.util || {}).flashBlindTime;
            }), i, n1(u.flashBlindTime) + 's');

        /* ---- DISCIPLINE: buys, and walking into flashes ------------------ */
        var discBody =
            '<h5 class="stats-subhead">' + esc(T('st.disc.buys')) + '</h5>' +
            buySplit(sp) +
            metric(T('st.disc.blinded'), series(function (x, y) { return (y.util || {}).blindedTime; }), i,
                   n1(u.blindedTime) + 's', { low: true }) +
            metric(T('st.disc.hs'), series(function (x) { return x.hsPct; }), i, pct(s.hsPct)) +
            metric(T('st.disc.acc'), series(function (x) { return x.acc; }), i, pct(s.acc)) +
            metric(T('st.aim.firstAcc'), series(function (x) { return x.firstAcc; }), i, pct(s.firstAcc));

        /* ---- AIM --------------------------------------------------------- */
        var aimBody =
            '<div class="stats-cellgrid stats-cellgrid--3">' +
                cell(T('st.col.hs'), pct(s.hsPct)) +
                cell(T('st.disc.acc'), pct(s.acc)) +
                cell(T('st.out.react'), Math.round(s.react || 0) + 'ms') +
            '</div>' +
            '<div class="stats-shots">' + esc(T('st.aim.shots', { h: s.hits || 0, s: s.shots || 0 })) + '</div>' +
            '<h5 class="stats-subhead">' + esc(T('st.aim.hitdist')) + '</h5>' +
            hitGroups(s.hg) +
            '<h5 class="stats-subhead">' + esc(T('st.aim.weapons')) + '</h5>' +
            weaponBars(s.wk);

        /* ---- OUTPUT: the raw production line ----------------------------- */
        var outBody =
            '<div class="stats-cellgrid stats-cellgrid--4">' +
                cell(T('st.out.rating'), '<b class="' + (s.rating >= 1 ? 'good' : 'bad') + '">' + n2(s.rating) + '</b>') +
                cell(T('st.out.kast'), pct(s.kast)) +
                cell(T('st.out.adr'), Math.round(s.adr || 0)) +
                cell(T('st.out.kpr'), n2(s.kpr)) +
                cell(T('st.out.kd'), '<b>' + esc(s.k) + '</b><i>/</i>' + esc(s.d)) +
                cell(T('st.out.assists'), esc(s.a)) +
                cell(T('st.out.pm'), '<b class="' + (s.pm >= 0 ? 'good' : 'bad') + '">' + sgn(s.pm) + '</b>') +
                cell(T('st.out.kdr'), n2(s.kd)) +
            '</div>' +
            metric(T('st.out.rating'), series(function (x) { return x.rating; }), i, n2(s.rating), { hero: true }) +
            metric(T('st.out.adr'), series(function (x) { return x.adr; }), i, Math.round(s.adr || 0)) +
            metric(T('st.out.kast'), series(function (x) { return x.kast; }), i, pct(s.kast)) +
            '<h5 class="stats-subhead">' + esc(T('st.out.multi')) + '</h5>' +
            multiKills(s.multi) +
            '<div class="stats-cellgrid stats-cellgrid--4">' +
                cell(T('st.out.mvp'), esc(s.mvp || 0)) +
                cell(T('st.out.dmg'), Math.round(s.dmg || 0)) +
                cell(T('st.out.dmgTaken'), Math.round(s.dmgTaken || 0)) +
                cell(T('st.out.utilDmg'), Math.round(s.utilDmg || 0)) +
            '</div>' +
            '<div class="stats-cellgrid stats-cellgrid--1">' +
                cell(T('st.out.talk'), fmtTime(s.talk)) +
            '</div>';

        box.innerHTML =
            '<div class="sc-wrap">' +
                '<div class="stats-dossier-card ' + (ct ? 'is-ct' : 'is-t') + '">' +
                    '<header class="stats-dossier-head">' +
                        '<span class="stats-av stats-av--lg" id="statsDossierAv"></span>' +
                        '<div class="stats-dossier-id">' +
                            '<span class="stats-dossier-side">' +
                                esc(ct ? (data.teamAName || T('st.teamA')) : (data.teamBName || T('st.teamB'))) + '</span>' +
                            '<h3 class="stats-dossier-name">' + esc(s.name || p.name) + '</h3>' +
                            '<span class="stats-dossier-sub">' + esc(s.rounds || data.rounds) + ' ' +
                                esc(T('st.roundsSuffix')) + ' · ' + n2(s.rating) + ' ' + esc(T('st.ratingSuffix')) + '</span>' +
                        '</div>' +
                        '<div class="stats-dossier-rat">' +
                            '<span class="stats-dossier-rat-v">' + n2(s.rating) + '</span>' +
                            '<span class="stats-dossier-rat-l">' + esc(T('st.hltv')) + '</span>' +
                        '</div>' +
                    '</header>' +
                '</div>' +
                timelineCard(sp) +
                '<div class="sc-blocks">' +
                    block('st.open.title', 'st.open.why', opensBody) +
                    block('st.close.title', 'st.close.why', closesBody) +
                    block('st.team.title', 'st.team.why', teamBody) +
                    block('st.disc.title', 'st.disc.why', discBody) +
                    block('st.aim.title', 'st.aim.why', aimBody) +
                    block('st.out.title', 'st.out.why', outBody) +
                '</div>' +
                matrixCard(i) +
            '</div>';

        if (window.cs2reveal) window.cs2reveal(box, '.sc-block');
        var av = el('statsDossierAv');
        if (av) loadAvatar(av, p.steamid, s.name || p.name, ct);
    }

    function fmtTime(sec) {
        sec = Math.round(sec || 0);
        var m = Math.floor(sec / 60), r = sec % 60;
        return m + ':' + (r < 10 ? '0' : '') + r;
    }

    function selectPlayer(idx) {
        if (idx === selPlayer) return;
        selPlayer = idx;
        
        var box = el('statsBoard');
        if (box) box.querySelectorAll('.stats-row').forEach(function (b) {
            b.classList.toggle('is-sel', +b.getAttribute('data-idx') === idx);
        });
        renderDossier();
    }

    function defaultPlayer() {
        
        if (!data || !data.stats || !data.stats.length) return -1;
        var best = 0;
        for (var i = 1; i < data.stats.length; i++) {
            if ((data.stats[i].rating || 0) > (data.stats[best].rating || 0)) best = i;
        }
        return best;
    }

    function selectDemo(key) {
        if (!key) return;
        currentKey = key;
        renderPicker();
        var summary = el('statsSummary'), board = el('statsBoard'), dossier = el('statsDossier');
        if (summary) summary.innerHTML = '<div class="stats-loading">LOADING…</div>';
        if (board) board.innerHTML = '';
        if (dossier) dossier.innerHTML = '';

        var token = ++loadToken;
        fetch('/api/demo/stats/' + encodeURIComponent(key))
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (token !== loadToken) return;   
                if (!j || !j.ok) { showError(j && j.error); return; }
                data = j;
                selPlayer = defaultPlayer();
                renderSummary();
                renderBoard();
                renderDossier();
            })
            .catch(function () {
                if (token !== loadToken) return;
                showError('Network error while loading stats.');
            });
    }

    function load() {
        fetch('/api/demo/library')
            .then(function (r) { return r.json(); })
            .then(function (j) {
                library = (j && j.library) || [];
                if (!library.length) { showEmptyLibrary(); return; }
                buildShell();
                renderPicker();
                
                var recent = library.slice().sort(function (a, b) {
                    return (b.added || 0) - (a.added || 0);
                })[0];
                selectDemo(recent.key);
            })
            .catch(function () {
                root.innerHTML = '<div class="stats-empty"><div class="stats-empty-title">' +
                    esc(T('st.err.title')) + '</div><p class="stats-empty-body">' +
                    esc(T('st.err.body')) + '</p></div>';
            });
    }

    /* Labels are resolved at render time, so a language switch only needs a
       repaint of whatever is currently on screen. */
    document.addEventListener('langchange', function () {
        if (!root || !inited) return;
        var head = root.querySelector('.stats-kicker');
        if (head) {
            head.textContent = T('st.kicker');
            var h2 = root.querySelector('.stats-h2');
            if (h2) h2.textContent = T('st.title');
        }
        if (data) { renderSummary(); renderBoard(); renderDossier(); }
    });

    window.initStatistics = function () {
        root = el('statsRoot');
        if (!root) return;
        if (!inited) {
            inited = true;
            load();
            return;
        }
        
        fetch('/api/demo/library')
            .then(function (r) { return r.json(); })
            .then(function (j) {
                var lib = (j && j.library) || [];
                if (!lib.length) { showEmptyLibrary(); inited = false; return; }
                library = lib;
                if (!el('statsPicker')) { buildShell(); }
                renderPicker();
                var stillThere = currentKey && library.some(function (d) { return d.key === currentKey; });
                if (!stillThere) {
                    var recent = library.slice().sort(function (a, b) {
                        return (b.added || 0) - (a.added || 0);
                    })[0];
                    selectDemo(recent.key);
                }
            })
            .catch(function () {  });
    };
})();
