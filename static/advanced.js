(function () {
    'use strict';

    var root = null, inited = false;
    var upId = null, players = [], mapName = '', curSteam = null;
    var advDuels = [], radarMap = '', radarScale = 4.5, radarImg = null, radarImgMap = '', hoverIdx = -1;
    var lastResult = null;
    var duelFilter = 'all';
    var RADAR = 1024;

    function el(id) { return document.getElementById(id); }
    function T(k, params) {
        var v = (window.t ? window.t(k) : k);
        if (params) for (var p in params) v = v.split('{' + p + '}').join(params[p]);
        return v;
    }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

    function shell() {
        curSteam = null; lastResult = null; advDuels = [];
        root.innerHTML = '' +
            '<header class="stats-head">' +
                '<div class="stats-head-title">' +
                    '<span class="stats-kicker">' + esc(T('av.kicker')) + '</span>' +
                    '<h2 class="stats-h2">' + esc(T('av.title')) + '</h2>' +
                '</div>' +
                '<div class="adv-loadwrap">' +
                    '<button class="adv-load" id="advLoadBtn" type="button">' + esc(T('av.load')) + '</button>' +
                    '<input type="file" id="advFile" accept=".dem,.gz,.zst" hidden>' +
                '</div>' +
            '</header>' +
            '<div class="adv-body" id="advBody">' +
                '<div class="adv-drop" id="advDrop">' +
                    '<div class="adv-drop-tick"></div>' +
                    '<div class="adv-drop-title">' + esc(T('av.drop.title')) + '</div>' +
                    '<p class="adv-drop-sub">' + esc(T('av.drop.sub')) + '</p>' +
                '</div>' +
            '</div>';
        el('advLoadBtn').addEventListener('click', function () { el('advFile').click(); });
        el('advFile').addEventListener('change', function (e) {
            if (e.target.files[0]) upload(e.target.files[0]);
        });
        var drop = el('advDrop');
        ['dragover', 'dragenter'].forEach(function (ev) {
            drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
        });
        ['dragleave', 'drop'].forEach(function (ev) {
            drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
        });
        drop.addEventListener('drop', function (e) {
            var f = e.dataTransfer.files[0]; if (f) upload(f);
        });
    }

    function backBtn() { return '<button class="adv-load adv-back" id="advBack" type="button">' + esc(T('av.loadAnother')) + '</button>'; }
    function wireBack() { var b = el('advBack'); if (b) b.addEventListener('click', shell); }

    function upload(file) {
        var body = el('advBody');
        body.innerHTML = '<div class="adv-loading">' + esc(T('av.parsing')) + ' <span>' + esc(file.name) + '</span></div>';
        fetch('/api/demo/advanced/upload?name=' + encodeURIComponent(file.name.toLowerCase()),
              { method: 'POST', body: file })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!j || !j.ok) {
                    body.innerHTML = '<div class="adv-err">' + esc((j && j.message) || T('av.uploadFail')) + '</div>' + backBtn();
                    wireBack(); return;
                }
                upId = j.id; players = j.players || []; mapName = j.map || ''; curSteam = null;
                renderPickers();
            })
            .catch(function () {
                body.innerHTML = '<div class="adv-err">' + esc(T('av.netErrUpload')) + '</div>' + backBtn(); wireBack();
            });
    }

    /* ------------------------------------------------------------- roster -- */

    function initials(name) {
        var s = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim();
        if (!s) return '?';
        var parts = s.split(/\s+/);
        return (parts.length > 1 ? parts[0][0] + parts[1][0] : s.slice(0, 2)).toUpperCase();
    }

    /** team_num 3 is CT, 2 is T — colour the strip by side so the two rosters
     *  read as teams and not as one pile of ten names. */
    function isCtTeam(tn) { return Number(tn) === 3; }

    /** One avatar slot used everywhere: initials until the FACEIT picture
     *  arrives, and the name travels with it so a failed image can fall back
     *  without reaching back into the DOM for a title. */
    function avatarEl(sid, name, cls) {
        return '<span class="av-av' + (cls ? ' ' + cls : '') + '" data-av="' + esc(sid || '') +
                '" data-name="' + esc(name || '') + '">' + esc(initials(name)) + '</span>';
    }
    function lvlEl(sid, cls) {
        return '<span class="av-lvl' + (cls ? ' ' + cls : '') + '" data-lvl="' + esc(sid || '') + '"></span>';
    }

    /* Avatars and FACEIT levels come from the shared profile store, so a demo
       already opened elsewhere in the app costs nothing here. Both selectors are
       attribute-only: the verdict card and the picker use different classes. */
    function paintProfiles(scope) {
        if (!scope || !window.FaceitProfile) return;
        scope.querySelectorAll('[data-av]').forEach(function (node) {
            var sid = node.getAttribute('data-av');
            if (!sid) return;
            window.FaceitProfile.get(sid).then(function (fp) {
                if (!fp) return;
                if (fp.url) {
                    var im = document.createElement('img');
                    im.alt = ''; im.loading = 'lazy';
                    im.onerror = function () { node.textContent = initials(node.getAttribute('data-name')); };
                    im.onload = function () { node.textContent = ''; node.appendChild(im); };
                    im.src = fp.url;
                }
                scope.querySelectorAll('[data-lvl="' + sid + '"]').forEach(function (b) {
                    if (!fp.lvl) return;
                    b.innerHTML = '<img src="/static/faceit_levels/' + fp.lvl + '.png" alt="">';
                    b.title = 'FACEIT ' + fp.lvl + (fp.elo ? ' · ' + fp.elo + ' ELO' : '');
                });
            });
        });
    }

    /* ------------------------------------------------------- player picker -- */

    function playerBy(sid) {
        for (var i = 0; i < players.length; i++) if (players[i].steamid === sid) return players[i];
        return null;
    }

    function teamGroups() {
        var byTeam = {};
        players.forEach(function (p) { (byTeam[p.team] = byTeam[p.team] || []).push(p); });
        return Object.keys(byTeam).sort().map(function (k, gi) {
            var ps = byTeam[k];
            return { ct: isCtTeam(k), players: ps,
                     label: (ps[0] && ps[0].clan) ? ps[0].clan : (T('av.team') + ' ' + (gi === 0 ? 'A' : 'B')) };
        });
    }

    function menuHtml() {
        return teamGroups().map(function (g) {
            return '<div class="av-sel-team ' + (g.ct ? 'is-ct' : 'is-t') + '" role="group">' +
                '<div class="av-sel-h"><i></i>' + esc(g.label) + '</div>' +
                g.players.map(function (p) {
                    var on = p.steamid === curSteam;
                    return '<button class="av-o' + (on ? ' is-on' : '') + '" type="button" role="option" ' +
                            'aria-selected="' + on + '" data-sid="' + esc(p.steamid) + '">' +
                        avatarEl(p.steamid, p.name) +
                        '<span class="av-o-nick">' + esc(p.name) + '</span>' +
                        lvlEl(p.steamid) +
                    '</button>';
                }).join('') +
            '</div>';
        }).join('');
    }

    function triggerHtml() {
        var p = playerBy(curSteam);
        if (!p) return '<span class="av-sel-ph">' + esc(T('av.pick.placeholder')) + '</span>';
        return avatarEl(p.steamid, p.name, 'av-av-sm') +
               '<span class="av-sel-nick">' + esc(p.name) + '</span>' +
               lvlEl(p.steamid);
    }

    function closeMenu() {
        var s = el('advSel'); if (!s) return;
        s.classList.remove('is-open');
        s.querySelector('.av-sel-menu').hidden = true;
        s.querySelector('.av-sel-btn').setAttribute('aria-expanded', 'false');
    }
    function openMenu() {
        var s = el('advSel'); if (!s) return;
        s.classList.add('is-open');
        s.querySelector('.av-sel-menu').hidden = false;
        s.querySelector('.av-sel-btn').setAttribute('aria-expanded', 'true');
        paintProfiles(s);
    }

    function renderPickers() {
        el('advBody').innerHTML =
            '<div class="av-bar">' +
                '<span class="adv-pick-map">' + esc((mapName || '').replace(/^de_/, '').toUpperCase()) + '</span>' +
                '<div class="av-sel" id="advSel">' +
                    '<button class="av-sel-btn" type="button" aria-haspopup="listbox" aria-expanded="false">' +
                        '<span class="av-sel-cur">' + triggerHtml() + '</span>' +
                        '<i class="av-sel-caret" aria-hidden="true"></i>' +
                    '</button>' +
                    '<div class="av-sel-menu" role="listbox" hidden>' + menuHtml() + '</div>' +
                '</div>' +
                backBtn() +
            '</div>' +
            '<div class="adv-result" id="advResult">' +
                '<div class="adv-hint">' + esc(T('av.hint.pick')) + '</div>' +
            '</div>';
        wireSelect();
        wireBack();
    }

    function wireSelect() {
        var s = el('advSel'); if (!s) return;
        s.querySelector('.av-sel-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            s.classList.contains('is-open') ? closeMenu() : openMenu();
        });
        s.querySelectorAll('.av-o[data-sid]').forEach(function (b) {
            b.addEventListener('click', function () { closeMenu(); pick(b.getAttribute('data-sid')); });
        });
        paintProfiles(s);
    }

    /* One document-level pair, not one per render: the picker is rebuilt on
       every upload and per-instance listeners would pile up. */
    document.addEventListener('click', function (e) {
        var s = el('advSel');
        if (s && s.classList.contains('is-open') && !s.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeMenu();
    });

    function markRoster() {
        var s = el('advSel'); if (!s) return;
        s.querySelectorAll('.av-o[data-sid]').forEach(function (b) {
            var on = b.getAttribute('data-sid') === curSteam;
            b.classList.toggle('is-on', on);
            b.setAttribute('aria-selected', String(on));
        });
        var cur = s.querySelector('.av-sel-cur');
        if (cur) { cur.innerHTML = triggerHtml(); paintProfiles(cur); }
    }

    function pick(sid) {
        curSteam = sid;
        markRoster();
        var res = el('advResult');
        res.innerHTML = '<div class="adv-loading">' + esc(T('av.analyzing')) + '</div>';
        fetch('/api/demo/advanced/analyze?id=' + encodeURIComponent(upId) + '&steamid=' + encodeURIComponent(sid))
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!j || !j.ok) { res.innerHTML = '<div class="adv-err">' + esc((j && j.message) || T('av.analysisFail')) + '</div>'; return; }
                lastResult = j;
                renderResult(j);
            })
            .catch(function () { res.innerHTML = '<div class="adv-err">' + esc(T('av.netErr')) + '</div>'; });
    }

    /* ------------------------------------------------------- formatting ---- */

    function fMs(v)  { return v != null ? (v + ' ' + T('av.u.ms')) : '—'; }
    function fDeg(v) { return v != null ? (v + T('av.u.deg')) : '—'; }
    function fPc(v)  { return v != null ? (v + '%') : '—'; }
    function fM(v)   { return v != null ? (v + ' ' + T('av.u.m')) : '—'; }

    /* ----------------------------------------------------------- verdict --- */

    /** Plain-language tags derived only from thresholds on measured values —
     *  no scoring, no invented composite. Each one is a thing a scout would
     *  actually write down after watching him. */
    function verdictTags(a) {
        var out = [];
        if (a.reactMed != null && a.reactMed <= 250) out.push(['good', 'av.tag.fastReact']);
        else if (a.reactMed != null && a.reactMed >= 450) out.push(['bad', 'av.tag.slowReact']);
        if (a.crossMed != null && a.crossMed <= 8) out.push(['good', 'av.tag.tightCross']);
        else if (a.crossMed != null && a.crossMed >= 30) out.push(['bad', 'av.tag.looseCross']);
        if (a.csPct >= 70) out.push(['good', 'av.tag.stops']);
        else if (a.csPct > 0 && a.csPct <= 35) out.push(['bad', 'av.tag.runs']);
        if (a.firstBulletPct >= 45) out.push(['good', 'av.tag.firstBullet']);
        if (a.hsPct >= 60) out.push(['good', 'av.tag.headshots']);
        if (a.avgDist != null && a.avgDist >= 20) out.push(['', 'av.tag.longRange']);
        else if (a.avgDist != null && a.avgDist <= 10) out.push(['', 'av.tag.closeRange']);
        if ((a.flashedLost || 0) >= 3) out.push(['bad', 'av.tag.blindDeaths']);
        return out;
    }

    /* Under this many duels a threshold is noise, not a trait, so the card says
       so instead of stamping a label on three rounds. */
    var MIN_DUELS_FOR_TAGS = 8;

    function verdictCard(j) {
        var a = j.agg || {};
        var w = a.won || 0, l = a.lost || 0, tot = w + l || 1;
        var tags = (a.duels || 0) >= MIN_DUELS_FOR_TAGS ? verdictTags(a) : [];
        var read = tags.length
            ? tags.map(function (t) {
                  return '<span class="av-tag' + (t[0] ? ' is-' + t[0] : '') + '">' + esc(T(t[1])) + '</span>';
              }).join('')
            : '<span class="av-tag">' + esc(T('av.vd.none')) + '</span>';
        return '<div class="av-vd">' +
            '<div class="av-vd-id">' +
                avatarEl(j.steamid, j.name, 'av-av-lg') +
                '<span class="av-vd-name">' + esc(j.name || '?') + '</span>' +
                lvlEl(j.steamid, 'av-lvl-lg') +
            '</div>' +
            '<div class="av-vd-hero">' +
                '<span class="av-vd-pct">' + (a.winPct || 0) + '<i>%</i></span>' +
                '<span class="av-vd-pct-l">' + esc(T('av.vd.winrate')) + '</span>' +
                '<span class="av-vd-wl">' +
                    '<i class="w" style="width:' + ((w / tot) * 100).toFixed(2) + '%"></i>' +
                    '<i class="l" style="width:' + ((l / tot) * 100).toFixed(2) + '%"></i>' +
                '</span>' +
                '<span class="av-vd-rec">' +
                    '<b class="good">' + w + '</b>' + esc(T('av.wShort')) +
                    '<em>·</em>' +
                    '<b class="bad">' + l + '</b>' + esc(T('av.lShort')) +
                    '<u>' + (a.duels || 0) + ' ' + esc(T('av.vd.duels')) + '</u>' +
                '</span>' +
            '</div>' +
            '<div class="av-vd-read">' +
                '<span class="sc-sub">' + esc(T('av.vd.readTitle')) + '</span>' +
                '<div class="av-tags">' + read + '</div>' +
            '</div>' +
        '</div>';
    }

    /* -------------------------------------------------------- components --- */

    function block(titleKey, whyKey, body) {
        return '<section class="sc-block">' +
            '<h4 class="sc-block-t">' + esc(T(titleKey)) + '</h4>' +
            '<p class="sc-block-why">' + esc(T(whyKey)) + '</p>' +
            '<div class="sc-block-body">' + body + '</div></section>';
    }

    /** The aggregate already carries every headline metric split by outcome,
     *  and that split is the point: the median says how good he is, the gap
     *  between wins and losses says what breaks when he loses. Both bars share
     *  one scale, so "green short, red long" is readable without reading. */
    function split(o) {
        var vals = [o.won, o.lost].filter(function (v) { return v != null; });
        var max = vals.length ? Math.max.apply(null, vals.map(Math.abs)) : 0;
        function bar(cls, v, key) {
            var wpc = (max && v != null) ? clamp01(Math.abs(v) / max) * 100 : 0;
            return '<div class="av-sp-row">' +
                '<span class="av-sp-k">' + esc(T(key)) + '</span>' +
                '<span class="av-sp-track"><i class="' + cls + '" style="width:' + wpc.toFixed(2) + '%"></i></span>' +
                '<span class="av-sp-v">' + (v != null ? o.fmt(v) : '—') + '</span>' +
            '</div>';
        }
        var gap = '';
        if (o.won != null && o.lost != null) {
            var d = Math.round(Math.abs(o.lost - o.won));
            gap = (d >= o.gapMin)
                ? '<span class="av-sp-gap">' + esc(T(o.gapKey, { v: o.gapFmt(d) })) + '</span>'
                : '<span class="av-sp-gap is-flat">' + esc(T('av.split.gapNone')) + '</span>';
        }
        return '<div class="av-sp">' +
            '<div class="av-sp-head">' +
                '<span class="av-sp-l">' + esc(o.label) + '</span>' +
                '<span class="av-sp-med">' + esc(T(o.headKey)) +
                    ' <b>' + (o.med != null ? o.fmt(o.med) : '—') + '</b></span>' +
            '</div>' +
            bar('w', o.won, 'av.split.wins') +
            bar('l', o.lost, 'av.split.losses') +
            gap +
            sampleNote(o.field) +
        '</div>';
    }

    /** Reaction is only measurable when the opponent visibly appears first, so
     *  it often rests on a third of the duels. A median off six samples reads
     *  exactly like a median off forty unless the count is on screen. */
    function sampleNote(field) {
        if (!field) return '';
        var tot = advDuels.length;
        var n = advDuels.filter(function (d) { return d[field] != null; }).length;
        if (!tot || n === tot) return '';
        return '<span class="av-sp-n">' + esc(T('av.split.n', { k: n, n: tot })) + '</span>';
    }

    /** A median hides the shape. Stacked won/lost columns show whether he is
     *  consistently quick or swinging between instant and hopeless. */
    function histo(pairs, edges, labels) {
        var used = pairs.filter(function (p) { return p.v != null; });
        if (used.length < 4) return '<div class="sc-empty">' + esc(T('av.hist.none')) + '</div>';
        var nb = labels.length;
        var buckets = [];
        for (var i = 0; i < nb; i++) buckets.push([0, 0]);
        used.forEach(function (p) {
            var b = nb - 1;
            for (var i = 0; i < edges.length; i++) if (p.v < edges[i]) { b = i; break; }
            buckets[b][p.won ? 0 : 1]++;
        });
        var max = 1;
        buckets.forEach(function (b) { if (b[0] + b[1] > max) max = b[0] + b[1]; });
        var cols = buckets.map(function (b, i) {
            var tot = b[0] + b[1];
            var h = (tot / max) * 100;
            var ttl = T('av.hist.bucket', { r: labels[i], w: b[0], l: b[1] });
            return '<div class="av-hc" title="' + esc(ttl) + '">' +
                '<span class="av-hc-n">' + (tot || '') + '</span>' +
                '<span class="av-hc-bar">' +
                    '<span class="av-hc-stack" style="height:' + h.toFixed(2) + '%">' +
                        (b[0] ? '<i class="w" style="flex:' + b[0] + '"></i>' : '') +
                        (b[1] ? '<i class="l" style="flex:' + b[1] + '"></i>' : '') +
                    '</span>' +
                '</span>' +
                '<span class="av-hc-x">' + esc(labels[i]) + '</span>' +
            '</div>';
        }).join('');
        return '<div class="av-hist"><div class="av-hist-cols">' + cols + '</div>' +
            '<div class="stats-hg-legend">' +
                '<span class="stats-hg-key"><b class="av-key-w"></b>' + esc(T('av.hist.won')) + '</span>' +
                '<span class="stats-hg-key"><b class="av-key-l"></b>' + esc(T('av.hist.lost')) + '</span>' +
                (used.length < pairs.length
                    ? '<span class="av-sp-n">' + esc(T('av.split.n', { k: used.length, n: pairs.length })) + '</span>'
                    : '') +
            '</div></div>';
    }

    function cell(label, value, klass) {
        return '<div class="stats-cell ' + (klass || '') + '">' +
            '<span class="stats-cell-v">' + value + '</span>' +
            '<span class="stats-cell-l">' + esc(label) + '</span></div>';
    }

    /* ------------------------------------------------------------ report --- */

    function renderResult(j) {
        var a = j.agg || {};
        if (!a.duels) {
            el('advResult').innerHTML = '<div class="adv-hint">' + esc(T('av.noDuelsPlayer')) + '</div>';
            return;
        }
        advDuels = j.duels || [];
        radarMap = j.map || '';
        radarScale = j.scale || 4.5;
        duelFilter = 'all';

        // percentage-points, not percent: the drop from 85% to 13% is 72 pts
        var fPts = function (d) { return d + ' ' + T('av.u.pts'); };

        var contact =
            split({ label: T('av.kpi.reaction'), headKey: 'av.split.median', field: 'react',
                    med: a.reactMed, won: a.reactWon, lost: a.reactLost, fmt: fMs,
                    gapKey: 'av.split.gapSlower', gapMin: 25,
                    gapFmt: function (d) { return d + ' ' + T('av.u.ms'); } }) +
            split({ label: T('av.kpi.crosshair'), headKey: 'av.split.median', field: 'cross',
                    med: a.crossMed, won: a.crossWon, lost: a.crossLost, fmt: fDeg,
                    gapKey: 'av.split.gapWider', gapMin: 3,
                    gapFmt: function (d) { return d + T('av.u.deg'); } });

        var bullet =
            split({ label: T('av.kpi.firstBullet'), headKey: 'av.split.overall', field: 'firstBullet',
                    med: a.firstBulletPct, won: a.fbWonPct, lost: a.fbLostPct, fmt: fPc,
                    gapKey: 'av.split.gapDrop', gapMin: 5, gapFmt: fPts }) +
            split({ label: T('av.kpi.counterStrafe'), headKey: 'av.split.overall', field: 'cs',
                    med: a.csPct, won: a.csWon, lost: a.csLost, fmt: fPc,
                    gapKey: 'av.split.gapDrop', gapMin: 5, gapFmt: fPts }) +
            '<div class="stats-cellgrid stats-cellgrid--1">' +
                cell(T('av.kpi.hsKills'), fPc(a.hsPct)) +
            '</div>';

        var hps = advDuels.map(function (d) { return d.hp; }).filter(function (v) { return v != null; });
        var hpMed = hps.length ? hps.slice().sort(function (x, y) { return x - y; })[hps.length >> 1] : null;
        var cond =
            '<div class="stats-cellgrid stats-cellgrid--3">' +
                cell(T('av.kpi.engagement'), fM(a.avgDist)) +
                cell(T('av.cond.hp'), hpMed != null ? esc(hpMed) : '—') +
                cell(T('av.kpi.flashed'),
                     '<b class="' + ((a.flashedLost || 0) >= 3 ? 'bad' : '') + '">' + (a.flashedLost || 0) + '</b>') +
            '</div>';

        var reactPairs = advDuels.map(function (d) { return { v: d.react, won: d.won }; });
        var distPairs  = advDuels.map(function (d) { return { v: d.dist, won: d.won }; });

        el('advResult').innerHTML =
            verdictCard(j) +
            '<div class="av-grid av-grid-3">' +
                block('av.b.contact.t', 'av.b.contact.why', contact) +
                block('av.b.bullet.t', 'av.b.bullet.why', bullet) +
                block('av.b.cond.t', 'av.b.cond.why', cond) +
            '</div>' +
            '<div class="av-grid av-grid-2">' +
                block('av.b.react.t', 'av.b.react.why',
                      histo(reactPairs, [150, 250, 350, 450, 600],
                            ['<150', '150–250', '250–350', '350–450', '450–600', '600+'])) +
                block('av.b.dist.t', 'av.b.dist.why',
                      histo(distPairs, [5, 8, 12, 16, 22],
                            ['<5', '5–8', '8–12', '12–16', '16–22', '22+'])) +
            '</div>' +
            duelsSection();

        paintProfiles(el('advResult'));
        wireDuels();
        if (window.cs2reveal) window.cs2reveal(el('advResult'), '.av-vd, .sc-block');
    }

    /* ------------------------------------------------------------- duels --- */

    function duelRows() {
        var out = '';
        advDuels.forEach(function (d, i) {
            if (duelFilter === 'win' && !d.won) return;
            if (duelFilter === 'lose' && d.won) return;
            out += '<button class="adv-duel-row ' + (d.won ? 'is-win' : 'is-lose') + '" data-i="' + i + '" type="button">' +
                '<span class="adv-duel-c rt">R' + esc(d.round) + '</span>' +
                '<span class="adv-duel-c res">' + esc(d.won ? T('av.won') : T('av.lost')) + '</span>' +
                '<span class="adv-duel-c opp">' + esc(d.opp) + '</span>' +
                '<span class="adv-duel-c wpn">' +
                    (window.WeaponIcons ? window.WeaponIcons.html(d.weapon || '') : esc(d.weapon || '')) +
                '</span>' +
                '<span class="adv-duel-c num">' + (d.react != null ? (d.react + T('av.u.ms')) : '—') + '</span>' +
                '<span class="adv-duel-c num">' + (d.cross != null ? (d.cross + '°') : '—') + '</span>' +
                '<span class="adv-duel-c fb">' +
                    (d.firstBullet == null ? '' :
                     '<i class="av-fb ' + (d.firstBullet ? 'is-hit' : 'is-miss') + '" title="' +
                     esc(T('av.r.fb') + ': ' + T(d.firstBullet ? 'av.r.hit' : 'av.r.miss')) + '"></i>') +
                '</span>' +
                '</button>';
        });
        return out;
    }

    function duelsSection() {
        var wins = advDuels.filter(function (d) { return d.won; }).length;
        var chip = function (k, label, n) {
            return '<button class="av-f' + (duelFilter === k ? ' is-on' : '') + '" type="button" data-f="' + k + '">' +
                esc(label) + '<b>' + n + '</b></button>';
        };
        var head = '<div class="adv-duel-head">' +
            '<span>' + esc(T('av.tbl.round')) + '</span>' +
            '<span>' + esc(T('av.tbl.result')) + '</span>' +
            '<span>' + esc(T('av.tbl.opponent')) + '</span>' +
            '<span>' + esc(T('av.tbl.weapon')) + '</span>' +
            '<span class="num">' + esc(T('av.tbl.reaction')) + '</span>' +
            '<span class="num">' + esc(T('av.tbl.crosshair')) + '</span>' +
            '<span class="num" title="' + esc(T('av.tbl.firstBullet')) + '">' + esc(T('av.tbl.fbShort')) + '</span>' +
        '</div>';
        return '<div class="adv-duels" id="advDuelsDet">' +
            '<div class="av-duels-bar">' +
                '<span class="sc-sub">' + esc(T('av.duels')) + '</span>' +
                '<div class="av-fs">' +
                    chip('all', T('av.f.all'), advDuels.length) +
                    chip('win', T('av.f.wins'), wins) +
                    chip('lose', T('av.f.losses'), advDuels.length - wins) +
                '</div>' +
            '</div>' +
            '<div class="adv-duels-body" id="advDuelsBody">' +
                '<div class="adv-duels-list" id="advDuelsList">' + head + duelRows() + '</div>' +
                '<div class="adv-radar-pane">' +
                    '<canvas id="advRadarCv" width="600" height="600"></canvas>' +
                    '<div class="adv-radar-info" id="advRadarInfo"></div>' +
                '</div>' +
            '</div></div>';
    }

    function wireRows() {
        var list = el('advDuelsList'); if (!list) return;
        list.querySelectorAll('.adv-duel-row').forEach(function (r) {
            var i = +r.getAttribute('data-i');
            r.addEventListener('mouseenter', function () { showDuel(i); });
            r.addEventListener('click', function () { showDuel(i); });
            r.addEventListener('focus', function () { showDuel(i); });
        });
    }

    function wireDuels() {
        var body = el('advDuelsBody'), det = el('advDuelsDet');
        if (!det) return;
        wireRows();
        det.querySelectorAll('.av-f[data-f]').forEach(function (b) {
            b.addEventListener('click', function () {
                duelFilter = b.getAttribute('data-f');
                det.querySelectorAll('.av-f[data-f]').forEach(function (o) {
                    o.classList.toggle('is-on', o.getAttribute('data-f') === duelFilter);
                });
                var list = el('advDuelsList');
                // the sticky column header is the first child and must survive
                list.innerHTML = list.firstElementChild.outerHTML + duelRows();
                wireRows();
                clearRadar();
            });
        });
        if (body) body.addEventListener('mouseleave', clearRadar);
        ensureRadarImg(radarMap);
        clearRadar();
    }

    function showDuel(i) {
        hoverIdx = i;
        var d = advDuels[i]; if (!d) return;
        ensureRadarImg(radarMap);
        drawDuelRadar(d);
        var info = el('advRadarInfo');
        if (info) info.innerHTML =
            '<div class="adv-radar-h ' + (d.won ? 'win' : 'lose') + '">' +
                esc(d.won ? T('av.won') : T('av.lost')) + ' ' + esc(T('av.r.vs')) + ' ' + esc(d.opp) +
            '</div>' +
            '<dl class="adv-radar-dl">' +
                kv(T('av.r.round'), 'R' + esc(d.round) + ' · ' + esc(d.time) + ' ' + T('av.u.s')) +
                kv(T('av.r.weapon'), window.WeaponIcons ? window.WeaponIcons.html(d.weapon || '—') : esc(d.weapon || '—')) +
                kv(T('av.r.hp'), d.hp != null ? esc(d.hp) : '—') +
                kv(T('av.r.dist'), d.dist != null ? (esc(d.dist) + ' ' + T('av.u.m')) : '—') +
                kv(T('av.r.react'), d.react != null ? (esc(d.react) + ' ' + T('av.u.ms')) : '—') +
                kv(T('av.r.cross'), d.cross != null ? (esc(d.cross) + '°') : '—') +
                kv(T('av.r.fb'), d.firstBullet != null ? T(d.firstBullet ? 'av.r.hit' : 'av.r.miss') : '—') +
                kv(T('av.r.cs'), d.cs != null ? T(d.cs ? 'av.r.stopped' : 'av.r.moving') : '—') +
                (d.flashed ? kv(T('av.r.flashed'), T('av.r.yes')) : '') +
            '</dl>';
    }
    function kv(k, v) { return '<div><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>'; }

    function clearRadar() {
        hoverIdx = -1;
        drawCleanRadar();
        var info = el('advRadarInfo');
        if (info) info.innerHTML = '<div class="adv-radar-hint">' + esc(T('av.radar.hint')) + '</div>';
    }

    function ensureRadarImg(mapId) {
        if (radarImgMap === mapId && radarImg) return;
        radarImgMap = mapId;
        radarImg = new Image();
        radarImg.onload = function () { (hoverIdx >= 0 && advDuels[hoverIdx]) ? drawDuelRadar(advDuels[hoverIdx]) : drawCleanRadar(); };
        radarImg.onerror = function () { radarImg = null; };
        radarImg.src = '/static/radars/' + mapId + '.png';
    }

    function drawCleanRadar() {
        var cv = el('advRadarCv'); if (!cv) return;
        var ctx = cv.getContext('2d'), S = cv.width;
        var bg = getComputedStyle(document.documentElement).getPropertyValue('--radar-bg').trim() || '#14130f';
        ctx.clearRect(0, 0, S, S); ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);
        if (radarImg && radarImg.complete && radarImg.naturalWidth) ctx.drawImage(radarImg, 0, 0, S, S);
    }

    function drawDuelRadar(d) {
        var cv = el('advRadarCv'); if (!cv) return;
        drawCleanRadar();
        var ctx = cv.getContext('2d'), S = cv.width, sc = S / RADAR;
        var cs = getComputedStyle(document.documentElement);
        var ct = cs.getPropertyValue('--team-ct').trim() || '#84b4de';
        var tt = cs.getPropertyValue('--team-t').trim() || '#ff9a5c';
        var good = cs.getPropertyValue('--green').trim() || '#6fae5e';
        var bad = cs.getPropertyValue('--red').trim() || '#d8593f';

        if (d.rp && d.ro) {
            ctx.strokeStyle = d.firstBullet ? good : bad; ctx.lineWidth = Math.max(2, S * 0.005);
            ctx.beginPath(); ctx.moveTo(d.rp[0] * sc, d.rp[1] * sc); ctx.lineTo(d.ro[0] * sc, d.ro[1] * sc); ctx.stroke();
        }
        if (d.ro) dot(ctx, d.ro[0] * sc, d.ro[1] * sc, tt, S, true);
        if (d.rp) dot(ctx, d.rp[0] * sc, d.rp[1] * sc, ct, S, false);
    }
    function dot(ctx, x, y, col, S, ringed) {
        var r = S * 0.013;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = col; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#0e0d0b'; ctx.stroke();
        if (ringed) { ctx.beginPath(); ctx.arc(x, y, r * 1.7, 0, 7); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); }
    }

    /* Labels resolve at render time, so a language switch only needs a repaint.
       The analysis payload is kept, which means no second trip to the parser. */
    document.addEventListener('langchange', function () {
        if (!root || !inited) return;
        var k = root.querySelector('.stats-kicker'), h = root.querySelector('.stats-h2');
        if (k) k.textContent = T('av.kicker');
        if (h) h.textContent = T('av.title');
        var btn = el('advLoadBtn'); if (btn) btn.textContent = T('av.load');
        var dt = root.querySelector('.adv-drop-title'); if (dt) dt.textContent = T('av.drop.title');
        var ds = root.querySelector('.adv-drop-sub'); if (ds) ds.textContent = T('av.drop.sub');
        var bk = el('advBack'); if (bk) bk.textContent = T('av.loadAnother');
        var hint = root.querySelector('#advResult .adv-hint');
        if (hint && !lastResult) hint.textContent = T('av.hint.pick');
        if (lastResult && el('advResult')) renderResult(lastResult);
    });

    window.initAdvanced = function () {
        root = el('advRoot'); if (!root) return;
        if (!inited) { inited = true; shell(); }
    };
})();
