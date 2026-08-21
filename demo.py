"""
demo.py — parse a CS2 .dem into a compact JSON the 2D viewer can play back.

Pipeline (demoparser2):
  • header  -> map name
  • events  -> kills, grenades, bomb, round boundaries   (fast, one pass)
  • ticks   -> player positions, downsampled to `fps` frames/sec

World coords are transformed to radar-image pixels (0..1024) using the awpy
calibration in static/radars/calibration.json. Output is cached on disk by a
cheap file fingerprint so re-opening a demo is instant.
"""

import os
import sys
import json
import time
import hashlib
import threading

from demoparser2 import DemoParser

if getattr(sys, 'frozen', False):
    _BASE, _BUNDLE = os.path.dirname(sys.executable), sys._MEIPASS
else:
    _BASE = _BUNDLE = os.path.dirname(os.path.abspath(__file__))

_RADAR_DIR = os.path.join(_BUNDLE, 'static', 'radars')
CACHE_DIR  = os.path.join(_BASE, 'demos_cache')
RADAR_SIZE = 1024
TICKRATE   = 64

os.makedirs(CACHE_DIR, exist_ok=True)

with open(os.path.join(_RADAR_DIR, 'calibration.json'), encoding='utf-8') as _f:
    CALIB = json.load(_f)

_CACHE_VER = 'v15-bounce'

def cache_key(path):
    st  = os.stat(path)
    raw = f'{_CACHE_VER}|{os.path.basename(path)}|{st.st_size}|{int(st.st_mtime)}'
    return hashlib.sha1(raw.encode()).hexdigest()[:16]

def cached_path(key):
    return os.path.join(CACHE_DIR, key + '.json')

def voice_dir(key):
    return os.path.join(CACHE_DIR, key + '_voice')

def _ev(evs, name):
    """Return the DataFrame for an event, or None if it didn't occur."""
    df = evs.get(name)
    return df if df is not None and len(df) else None

_UTIL_W   = {'hegrenade', 'inferno', 'molotov', 'incgrenade'}
_NADE_W   = {'hegrenade', 'flashbang', 'smokegrenade', 'molotov', 'incgrenade', 'decoy'}
_HG_BUCKET = {'head': 'head', 'neck': 'head', 'chest': 'chest', 'stomach': 'stomach',
              'left_arm': 'arm', 'right_arm': 'arm', 'left_leg': 'leg', 'right_leg': 'leg'}

_ADV_WIN    = int(TICKRATE * 2.5)
_ADV_PROPS  = ['X', 'Y', 'Z', 'yaw', 'pitch', 'spotted', 'flash_duration', 'health', 'team_num']
_ADV_EVENTS = ['player_death', 'player_hurt', 'weapon_fire', 'round_freeze_end', 'begin_new_match',
               'smokegrenade_detonate', 'flashbang_detonate', 'hegrenade_detonate',
               'inferno_startburn', 'decoy_detonate']
_ADV_LOCK   = threading.Lock()
_ADV_CACHE  = {}

def _adv_source(dem_path):
    """The part of the Advanced pass that does not depend on who was picked: the
    header, the names, the events, and one tick pass wide enough to cover every
    duel window in the match. The tab used to reparse the demo for each player
    clicked — a second a click on a 290 MB file, ten of them per match — so the
    first pick pays for this and the rest read it. Keyed on the same fingerprint
    as the viewer cache, so a restaged demo re-reads; only the last one is kept."""
    import numpy as _np
    key = cache_key(dem_path)
    with _ADV_LOCK:
        hit = _ADV_CACHE.get(key)
        if hit is not None:
            return hit
        parser = DemoParser(dem_path)
        src = {'map': parser.parse_header().get('map_name', ''), 'names': {}}
        try:
            pi = parser.parse_player_info()
            for sid, nm in zip(pi['steamid'], pi['name']):
                if str(sid) and nm:
                    src['names'][str(sid)] = str(nm)
        except Exception:
            pass
        evs = src['evs'] = dict(parser.parse_events(_ADV_EVENTS))
        bnm = _ev(evs, 'begin_new_match')
        ms = src['match_start'] = int(bnm['tick'].max()) if bnm is not None else 0
        fe = _ev(evs, 'round_freeze_end')
        src['freeze'] = sorted(t for t in (fe['tick'].tolist() if fe is not None else [])
                               if t >= ms)
        _GN = {'smokegrenade_detonate': 'smoke', 'flashbang_detonate': 'flash',
               'hegrenade_detonate': 'he', 'inferno_startburn': 'molotov',
               'decoy_detonate': 'decoy'}
        nade_evs = src['nades'] = []
        for _evn, _typ in _GN.items():
            _df = _ev(evs, _evn)
            if _df is None:
                continue
            for _, _r in _df.iterrows():
                try:
                    nade_evs.append((int(_r['tick']), float(_r['x']), float(_r['y']), _typ))
                except Exception:
                    pass
        # The union of every duel window in the match. A pick takes its own ticks
        # back out of this below — never the whole thing, because a window it did
        # not ask for would answer a lookup that used to come back empty.
        dd = _ev(evs, 'player_death')
        want = set()
        if dd is not None:
            for tk in dd['tick'].tolist():
                if int(tk) >= ms:
                    want.update(range(max(0, int(tk) - _ADV_WIN - 2), int(tk) + 8))
        td = parser.parse_ticks(_ADV_PROPS, ticks=sorted(want)) if want else None
        _nan = _np.full(len(td) if td is not None else 0, _np.nan)
        src['cols'] = {c: (td[c].to_numpy() if c in td.columns else _nan)
                       for c in ['steamid', 'tick'] + _ADV_PROPS} if td is not None else {}
        _ADV_CACHE.clear()
        _ADV_CACHE[key] = src
        return src

def analyze_player(dem_path, steamid):
    """ADVANCED per-player duel analysis (tick-accurate). Builds, for the player
    `steamid`, every duel (kill/death involving them) with reaction time,
    crosshair-placement error, first-bullet hit, distance, HP and flash state.
    Returns a dict the Advanced tab renders. Reads `_adv_source` for the parse."""
    import math
    import numpy as _np
    src = _adv_source(dem_path)
    mapname, names, evs = src['map'], src['names'], src['evs']
    match_start, freeze, nade_evs = src['match_start'], src['freeze'], src['nades']

    cal = CALIB.get(mapname)

    def to_px(x, y):
        if not cal or x != x or y != y:
            return None
        return [round(float((x - cal['pos_x']) / cal['scale']), 1),
                round(float((cal['pos_y'] - y) / cal['scale']), 1)]

    def round_no(tk):
        r = 0
        for ft in freeze:
            if tk >= ft:
                r += 1
        return r

    def round_time(tk):
        ft = max([f for f in freeze if f <= tk], default=match_start)
        return round((tk - ft) / TICKRATE, 1)

    dd = _ev(evs, 'player_death')
    duels = []
    if dd is not None:
        dcols = dd.columns
        for _, r in dd.iterrows():
            tk = int(r['tick'])
            if tk < match_start:
                continue
            a, v = str(r.get('attacker_steamid')), str(r.get('user_steamid'))
            if steamid not in (a, v) or a == v:
                continue
            # The engine reports the attacker-to-victim distance itself, already
            # in metres. Preferred over measuring it here: no unit to get wrong
            # and no dependence on both players having a usable frame.
            gd = r.get('distance') if 'distance' in dcols else None
            try:
                gd = round(float(gd), 1) if gd == gd and gd is not None else None
            except (TypeError, ValueError):
                gd = None
            won = (a == steamid)
            duels.append({'tick': tk, 'won': won, 'opp': (v if won else a),
                          'weapon': str(r.get('weapon') or '').replace('weapon_', ''),
                          'hs': bool(r.get('headshot')), 'gdist': gd})
    if not duels:
        return {'ok': True, 'map': mapname, 'steamid': steamid,
                'name': names.get(steamid, '?'), 'duels': [], 'agg': {}}

    WIN = _ADV_WIN
    want = set()
    for d in duels:
        # Two ticks before the window so the counter-strafe can look one tick
        # back from the opening shot, and past the death because that shot may
        # land a few ticks after it.
        want.update(range(max(0, d['tick'] - WIN - 2), d['tick'] + 8))
    # A demo that does not carry one of these props must degrade to "unmeasured",
    # not take the whole tab down with a KeyError — `_adv_source` fills the
    # missing ones with NaN.
    C = src['cols']
    P = {}
    for i in (_np.flatnonzero(_np.isin(C['tick'], list(want))).tolist() if C and want else []):
        P[(str(C['steamid'][i]), int(C['tick'][i]))] = (
            C['X'][i], C['Y'][i], C['Z'][i], C['yaw'][i], C['pitch'][i],
            C['spotted'][i], C['flash_duration'][i], C['health'][i], C['team_num'][i])

    wf = _ev(evs, 'weapon_fire')
    myshots = sorted(int(r['tick']) for _, r in wf.iterrows()
                     if str(r.get('user_steamid')) == steamid
                     and not any(x in str(r.get('weapon') or '')
                                 for x in ('grenade', 'flash', 'molotov', 'decoy', 'knife', 'bayonet'))) if wf is not None else []
    from collections import defaultdict
    ph = _ev(evs, 'player_hurt')
    # Damage this player dealt, per victim. Utility is excluded: a molotov thrown
    # a minute earlier ticking on the opponent is neither a reaction nor a bullet,
    # and counting it stopped the reaction clock at times no human produced.
    myhits_vs = defaultdict(set)
    if ph is not None:
        hcols = ph.columns
        for _, r in ph.iterrows():
            if str(r.get('attacker_steamid')) != steamid:
                continue
            w = str(r.get('weapon') or '') if 'weapon' in hcols else ''
            if any(u in w for u in _UTIL_W):
                continue
            myhits_vs[str(r.get('user_steamid'))].add(int(r['tick']))

    D2R = math.pi / 180.0
    # 1 hammer unit = 1 inch. Checked against the engine's own player_death
    # distance field, which matches this factor and not the 1/100 used before.
    _U2M = 0.0254

    def aim_vec(yaw, pit):
        cp = math.cos(pit * D2R)
        return (cp * math.cos(yaw * D2R), cp * math.sin(yaw * D2R), -math.sin(pit * D2R))

    out = []
    for d in duels:
        tk, opp = d['tick'], d['opp']
        if not opp.isdigit() or opp == '0':
            continue                    # fall damage or a world kill: no opponent
        me = P.get((steamid, tk)); en = P.get((opp, tk))
        if (me and en and me[8] == me[8] and en[8] == en[8]
                and int(me[8]) == int(en[8])):
            continue                    # same side: a team-kill is not a duel
        dist = d.get('gdist')
        if dist is None and me and en and me[0] == me[0] and en[0] == en[0]:
            dist = round(math.dist((me[0], me[1], me[2]), (en[0], en[1], en[2])) * _U2M, 1)
        appear = None; prev = None
        for t in range(max(0, tk - WIN), tk + 1):
            cur = P.get((opp, t))
            if cur is None:
                continue
            sp = bool(cur[5]) if cur[5] == cur[5] else False
            if prev is False and sp is True:
                last_shot = max([s for s in myshots if s < t], default=-10 ** 9)
                if t - last_shot >= TICKRATE * 0.25:
                    appear = t; break
            prev = sp
        hits_opp = sorted(myhits_vs.get(opp, ()))
        react = None
        if appear is not None:
            h = next((t for t in hits_opp if appear <= t <= tk + 6), None)
            if h is not None:
                rt = (h - appear) / TICKRATE
                # 3 s matches the clamp the Statistics tab uses. The old 1.5 s
                # ceiling threw away every slow reaction, which is exactly the
                # tail a "slow to react" verdict is supposed to see.
                if 0.05 <= rt <= 3.0:
                    react = round(rt * 1000)
        # Crosshair placement, being blinded and HP are only meaningful at the
        # instant contact was made. Where that instant is unknown they are left
        # unmeasured rather than sampled 2.5 s before the death, which used to
        # mix an unrelated moment of the round into the averages — and did it
        # more often in lost duels, biasing the very comparison this tab makes.
        cross = None
        ref = P.get((steamid, appear)) if appear is not None else None
        eno = P.get((opp, appear)) if appear is not None else None
        if ref and eno and ref[0] == ref[0] and eno[0] == eno[0]:
            av = aim_vec(ref[3], ref[4])
            dx, dy, dz = eno[0] - ref[0], eno[1] - ref[1], eno[2] - ref[2]
            mag = math.sqrt(dx * dx + dy * dy + dz * dz)
            if mag > 1:
                dot = (av[0] * dx + av[1] * dy + av[2] * dz) / mag
                cross = round(math.degrees(math.acos(max(-1.0, min(1.0, dot)))), 1)
        # The opening shot of the burst that resolves this duel. Anchoring on the
        # player's own fire needs no visibility data, so it stays defined in the
        # duels where contact was never observed — most of the lost ones.
        fsh = None
        prior = [t for t in myshots if t <= tk + 6]
        if prior and tk - prior[-1] <= TICKRATE * 1.5:
            i = len(prior) - 1
            while i > 0 and prior[i] - prior[i - 1] <= TICKRATE // 2:
                i -= 1
            fsh = prior[i]
        fb = None
        if fsh is not None:
            # Against this opponent only. Testing "did he damage anybody on that
            # tick" credited a miss whenever a second enemy, a team-mate or a
            # molotov happened to take damage at the same moment.
            fb = (fsh in myhits_vs.get(opp, ())) or (fsh + 1 in myhits_vs.get(opp, ()))
        cs = None
        if fsh is not None:
            a1 = P.get((steamid, fsh)); b1 = P.get((steamid, fsh - 1))
            if a1 and b1 and a1[0] == a1[0] and b1[0] == b1[0]:
                # One tick of travel, not eight. Averaged over 125 ms a player who
                # was still moving reads as stopped; the velocity props cannot be
                # used here because demoparser2 derives them from the requested
                # tick list and this call requests a sparse one.
                spd = math.hypot(a1[0] - b1[0], a1[1] - b1[1]) * TICKRATE
                cs = spd < 55
        flashed = False
        rs = P.get((steamid, appear)) if appear is not None else None
        if rs and rs[6] == rs[6] and float(rs[6]) > 1.0:
            flashed = True
        hp = None
        if rs and rs[7] == rs[7]:
            hp = int(rs[7])
        rtk = fsh if fsh is not None else tk
        mp = P.get((steamid, rtk)); op = P.get((opp, rtk))
        rp = to_px(mp[0], mp[1]) if mp else None
        ro = to_px(op[0], op[1]) if op else None
        rn = []
        if cal and (mp or op):
            for (ntk, nx, ny, ntyp) in nade_evs:
                if abs(ntk - tk) > TICKRATE * 4:
                    continue
                near = (mp and math.hypot(nx - mp[0], ny - mp[1]) < 900) or \
                       (op and math.hypot(nx - op[0], ny - op[1]) < 900)
                if near:
                    px = to_px(nx, ny)
                    if px:
                        rn.append({'x': px[0], 'y': px[1], 't': ntyp})
        out.append({
            'round': round_no(tk), 'time': round_time(tk), 'won': d['won'],
            'opp': names.get(opp, '?'), 'weapon': d['weapon'], 'hs': d['hs'],
            'dist': dist, 'hp': hp, 'react': react, 'cross': cross,
            'firstBullet': fb, 'cs': cs, 'flashed': flashed,
            'rp': rp, 'ro': ro, 'rn': rn,
        })

    won = [d for d in out if d['won']]
    lost = [d for d in out if not d['won']]

    def _med(a):
        """True median. Returning the upper of the two middle values, as this did,
        skews small samples upward — and the lost-duel buckets, which are the
        smallest, hardest of all."""
        a = sorted(a)
        n = len(a)
        if not n:
            return None
        if n % 2:
            return a[n // 2]
        return round((a[n // 2 - 1] + a[n // 2]) / 2, 1)

    def med_of(key, subset):
        return _med([d[key] for d in subset if d[key] is not None])

    def n_of(key, subset):
        return sum(1 for d in subset if d[key] is not None)

    def pct_true(key, subset):
        v = [d[key] for d in subset if d[key] is not None]
        return round(sum(1 for x in v if x) / len(v) * 100) if v else None

    dists = [d['dist'] for d in out if d['dist'] is not None]
    agg = {
        'duels': len(out), 'won': len(won), 'lost': len(lost),
        'winPct': round(len(won) / len(out) * 100) if out else 0,
        'reactMed': med_of('react', out), 'reactWon': med_of('react', won), 'reactLost': med_of('react', lost),
        'crossMed': med_of('cross', out), 'crossWon': med_of('cross', won), 'crossLost': med_of('cross', lost),
        'firstBulletPct': pct_true('firstBullet', out) or 0,
        'fbWonPct': pct_true('firstBullet', won), 'fbLostPct': pct_true('firstBullet', lost),
        'csPct': pct_true('cs', out) or 0, 'csWon': pct_true('cs', won), 'csLost': pct_true('cs', lost),
        'hsPct': round(sum(1 for d in won if d['hs']) / len(won) * 100) if won else 0,
        'avgDist': _med(dists),
        'flashedLost': sum(1 for d in lost if d['flashed']),
        # How many duels each number actually rests on. Without these the panel
        # cannot tell a median of twenty from a median of three, and the split
        # bars were reporting the count of all duels regardless of what they
        # themselves measured.
        'reactN': n_of('react', out), 'reactWonN': n_of('react', won), 'reactLostN': n_of('react', lost),
        'crossN': n_of('cross', out), 'crossWonN': n_of('cross', won), 'crossLostN': n_of('cross', lost),
        'fbN': n_of('firstBullet', out), 'fbWonN': n_of('firstBullet', won), 'fbLostN': n_of('firstBullet', lost),
        'csN': n_of('cs', out), 'csWonN': n_of('cs', won), 'csLostN': n_of('cs', lost),
        'distN': len(dists),
    }
    return {'ok': True, 'map': mapname, 'steamid': steamid,
            'scale': float(cal['scale']) if cal else None,
            'name': names.get(steamid, '?'), 'duels': out, 'agg': agg}

def _player_stats(evs, sid2i, players, kills, rounds, frames, n_frames, voice, fps, t2f):
    """Per-player match statistics derived from the parsed events/frames.
    Returns a list aligned to `players` (index = player slot)."""
    from collections import defaultdict
    n  = len(players)
    nR = max(1, len(rounds))

    S = [{
        'name': players[i]['name'], 'steamid': players[i].get('steamid', ''),
        'k': 0, 'd': 0, 'a': 0, 'hs': 0, 'dmg': 0, 'dmgTaken': 0,
        'shots': 0, 'hits': 0, 'openK': 0, 'openD': 0, 'tradeK': 0, 'traded': 0,
        'utilDmg': 0, 'flThrown': 0, 'flEnemy': 0, 'flAssist': 0, 'mvp': 0, 'talk': 0.0,
        'multi': [0, 0, 0, 0, 0], 'hg': {'head': 0, 'chest': 0, 'stomach': 0, 'arm': 0, 'leg': 0},
        'wk': {}, 'clutchW': [0, 0, 0, 0, 0], 'clutchL': [0, 0, 0, 0, 0], 'kastR': 0,
        'firstShots': 0, 'firstHits': 0, 'firstAcc': 0, 'react': None,
    } for i in range(n)]

    shot_ticks = defaultdict(list)
    hit_ticks  = defaultdict(set)

    def side_at(i, f):
        e = frames[f][i] if (0 <= f < n_frames and frames[f][i]) else None
        return e[4] if e else None

    def round_of(f):
        for ri, rd in enumerate(rounds):
            if rd['start'] <= f <= rd['end']:
                return ri
        return None

    by_round = defaultdict(list)
    for k in kills:
        ri = round_of(k['f'])
        if ri is not None:
            by_round[ri].append(k)

    TW = fps * 5
    for ri in range(nR):
        ks = sorted(by_round.get(ri, []), key=lambda k: k['f'])
        killers, victims, assisters, tradedSet = set(), set(), set(), set()
        kc = defaultdict(int)
        for k in ks:
            a, v, asi = k['a'], k['v'], k['as']
            if a is not None:
                S[a]['k'] += 1; killers.add(a); kc[a] += 1
                if k['hs']:
                    S[a]['hs'] += 1
                w = (k['w'] or '').replace('weapon_', '')
                if w:
                    S[a]['wk'][w] = S[a]['wk'].get(w, 0) + 1
            if v is not None:
                S[v]['d'] += 1; victims.add(v)
            if asi is not None:
                S[asi]['a'] += 1; assisters.add(asi)
        if ks:
            fk = ks[0]
            if fk['a'] is not None: S[fk['a']]['openK'] += 1
            if fk['v'] is not None: S[fk['v']]['openD'] += 1
        for a, c in kc.items():
            if 1 <= c <= 5:
                S[a]['multi'][c - 1] += 1
        for k in ks:
            a, v = k['a'], k['v']
            if a is None or v is None:
                continue
            aside = side_at(a, k['f'])
            for pk in ks:
                if pk['f'] < k['f'] - TW or pk['f'] >= k['f']:
                    continue
                if pk['a'] == v and pk['v'] is not None and pk['v'] != a and side_at(pk['v'], pk['f']) == aside:
                    S[a]['tradeK'] += 1
                    S[pk['v']]['traded'] += 1; tradedSet.add(pk['v'])
                    break
        for i in range(n):
            if (i in killers) or (i in assisters) or (i not in victims) or (i in tradedSet):
                S[i]['kastR'] += 1
        rd = rounds[ri]
        sideA = {i for i in range(n) if side_at(i, rd['freeze']) == 1}
        sideB = {i for i in range(n) if side_at(i, rd['freeze']) == 0}
        alive = {1: set(sideA), 0: set(sideB)}
        wside = rd.get('wside')
        clutched = False
        for k in ks:
            v = k['v']
            if v is None:
                continue
            vs = side_at(v, k['f'])
            if vs in (0, 1):
                alive[vs].discard(v)
            for s in (0, 1):
                opp = 1 - s
                if not clutched and len(alive[s]) == 1 and len(alive[opp]) >= 1:
                    who = next(iter(alive[s])); size = min(5, len(alive[opp]))
                    won = (s == 1 and wside == 'CT') or (s == 0 and wside == 'T')
                    (S[who]['clutchW'] if won else S[who]['clutchL'])[size - 1] += 1
                    clutched = True

    ph = _ev(evs, 'player_hurt')
    if ph is not None:
        cols = ph.columns
        get = lambda r, c: r.get(c) if c in cols else None
        for _, r in ph.iterrows():
            a = sid2i.get(str(get(r, 'attacker_steamid')))
            v = sid2i.get(str(get(r, 'user_steamid')))
            dh = get(r, 'dmg_health'); dh = int(dh) if dh == dh and dh is not None else 0
            w  = str(get(r, 'weapon') or '').replace('weapon_', '')
            tk = get(r, 'tick')
            f = t2f(int(tk)) if tk is not None else -1
            sA = side_at(a, f) if a is not None else None
            sV = side_at(v, f) if v is not None else None
            if sA is not None and sV is not None and sA == sV:
                continue
            if v is not None:
                S[v]['dmgTaken'] += dh
            if a is not None and a != v:
                S[a]['dmg'] += dh
                if w in _UTIL_W:
                    S[a]['utilDmg'] += dh
                else:
                    S[a]['hits'] += 1
                    if tk is not None:
                        hit_ticks[a].add(int(tk))
                    hg = _HG_BUCKET.get(str(get(r, 'hitgroup')).lower())
                    if hg:
                        S[a]['hg'][hg] += 1

    wf = _ev(evs, 'weapon_fire')
    if wf is not None:
        for _, r in wf.iterrows():
            i = sid2i.get(str(r.get('user_steamid')))
            if i is None:
                continue
            w = str(r.get('weapon') or '').replace('weapon_', '')
            if 'flashbang' in w:
                S[i]['flThrown'] += 1
            elif w not in _NADE_W and 'knife' not in w and 'bayonet' not in w:
                S[i]['shots'] += 1
                shot_ticks[i].append(int(r['tick']))

    GAP = TICKRATE // 2
    for i in range(n):
        ts = sorted(shot_ticks.get(i, [])); ht = hit_ticks.get(i, set())
        prev, fs, fh = -10 ** 9, 0, 0
        for t in ts:
            if t - prev > GAP:
                fs += 1
                if t in ht or (t + 1) in ht or (t - 1) in ht:
                    fh += 1
            prev = t
        S[i]['firstShots'] = fs
        S[i]['firstHits'] = fh
        S[i]['firstAcc'] = round(fh / fs * 100) if fs else 0

    pb = _ev(evs, 'player_blind')
    if pb is not None and 'blind_duration' in pb.columns:
        blinds = []
        for _, r in pb.iterrows():
            att = sid2i.get(str(r.get('attacker_steamid')))
            vic = sid2i.get(str(r.get('user_steamid')))
            dur = r.get('blind_duration')
            if att is None or vic is None or dur is None or dur != dur:
                continue
            f = t2f(int(r['tick']))
            if side_at(att, f) is not None and side_at(att, f) != side_at(vic, f):
                S[att]['flEnemy'] += 1
                blinds.append((att, vic, f, float(dur)))
        for (att, vic, f, dur) in blinds:
            if dur < 1.1:
                continue
            aside = side_at(att, f)
            for k in kills:
                if k['v'] == vic and f <= k['f'] <= f + fps * 2 and k['a'] != att \
                        and k['a'] is not None and side_at(k['a'], k['f']) == aside:
                    S[att]['flAssist'] += 1
                    break

    rm = _ev(evs, 'round_mvp')
    if rm is not None:
        for _, r in rm.iterrows():
            i = sid2i.get(str(r.get('user_steamid')))
            if i is not None:
                S[i]['mvp'] += 1
    for u in (voice or []):
        if 0 <= u['idx'] < n:
            S[u['idx']]['talk'] += u.get('dur', 0)

    for s in S:
        k, d, a = s['k'], s['d'], s['a']
        kpr, dpr, apr = k / nR, d / nR, a / nR
        adr  = s['dmg'] / nR
        kast = s['kastR'] / nR * 100.0
        impact = 2.13 * kpr + 0.42 * apr - 0.41
        rating = 0.0073 * kast + 0.3591 * kpr - 0.5329 * dpr + 0.2372 * impact + 0.0032 * adr + 0.1587
        s['rounds']  = nR
        s['kd']      = round(k / d, 2) if d else float(k)
        s['pm']      = k - d
        s['hsPct']   = round(s['hs'] / k * 100) if k else 0
        s['adr']     = round(adr, 1)
        s['kast']    = round(kast)
        s['acc']     = round(s['hits'] / s['shots'] * 100) if s['shots'] else 0
        s['rating']  = round(rating, 2)
        s['kpr']     = round(kpr, 2)
        s['talk']    = round(s['talk'], 1)
    return S

def _bounces(rows, min_speed=3.0, cos_max=0.82, merge=6):
    """Ticks where a grenade hit something, read out of its own flight path.

    CS2 records no bounce event — the demo carries detonations and nothing else —
    so an impact has to be recognised by shape: the velocity vector turns sharply
    within a single tick. The speed gate is what keeps a grenade settling on the
    floor from firing off a dozen of these, and the merge window stops one impact
    spread over two samples from counting twice.

    Must run on the raw per-tick rows. The trajectory kept for the viewer is
    thinned by half, and the vertex of a bounce is exactly one tick — thin first
    and half the impacts disappear."""
    out = []
    for i in range(1, len(rows) - 1):
        a, b, c = rows[i - 1], rows[i], rows[i + 1]
        if b[0] - a[0] != 1 or c[0] - b[0] != 1:
            continue
        v0 = (b[1] - a[1], b[2] - a[2], b[6] - a[6])
        v1 = (c[1] - b[1], c[2] - b[2], c[6] - b[6])
        s0 = (v0[0] * v0[0] + v0[1] * v0[1] + v0[2] * v0[2]) ** 0.5
        s1 = (v1[0] * v1[0] + v1[1] * v1[1] + v1[2] * v1[2]) ** 0.5
        if s0 < min_speed or s1 < 0.4:
            continue
        if (v0[0] * v1[0] + v0[1] * v1[1] + v0[2] * v1[2]) / (s0 * s1) >= cos_max:
            continue
        if out and b[0] - out[-1][0] <= merge:
            continue
        out.append(b)
    return out

def parse_demo(path, fps=8):
    """Parse `path` into the compact viewer structure and cache it.
    Returns (key, meta_dict). Raises on unsupported map / parse failure."""
    key = cache_key(path)
    out = cached_path(key)
    if os.path.exists(out):
        with open(out, encoding='utf-8') as f:
            data = json.load(f)
        return key, _meta(data)

    parser  = DemoParser(path)
    header  = parser.parse_header()
    mapname = header.get('map_name', '')
    cal     = CALIB.get(mapname)
    if not cal:
        raise ValueError(f'No radar calibration for map "{mapname}". '
                         f'Supported: {", ".join(sorted(CALIB))}')

    def to_px(x, y):
        return (round((x - cal['pos_x']) / cal['scale'], 1),
                round((cal['pos_y'] - y) / cal['scale'], 1))

    lower_max = cal.get('lower_level_max_units', -1e9)
    has_lower = lower_max > -1e5

    want = ['player_death', 'player_hurt', 'weapon_fire', 'player_blind', 'round_mvp',
            'smokegrenade_detonate', 'smokegrenade_expired',
            'hegrenade_detonate', 'flashbang_detonate', 'inferno_startburn',
            'inferno_expire', 'decoy_detonate', 'bomb_planted', 'bomb_defused',
            'bomb_exploded', 'round_start', 'round_freeze_end', 'round_officially_ended',
            'round_end', 'begin_new_match']
    evs = dict(parser.parse_events(want))

    bnm = _ev(evs, 'begin_new_match')
    match_start = int(bnm['tick'].max()) if bnm is not None else 0

    fe = _ev(evs, 'round_freeze_end')
    freeze_ticks = sorted(t for t in (fe['tick'].tolist() if fe is not None else [])
                          if t >= match_start)
    rs = _ev(evs, 'round_start')
    rstart_ticks = sorted(t for t in (rs['tick'].tolist() if rs is not None else [])
                          if t >= match_start)

    def _buy_begin(ft):
        cand = [t for t in rstart_ticks if t < ft]
        return cand[-1] if cand else max(match_start, ft - TICKRATE * 20)

    all_ticks = []
    for df in evs.values():
        if 'tick' in df:
            all_ticks += df['tick'].tolist()
    end_tick   = int(max(all_ticks)) if all_ticks else match_start + TICKRATE
    start_tick = (_buy_begin(freeze_ticks[0]) - TICKRATE) if freeze_ticks else match_start
    start_tick = max(0, start_tick)

    step        = max(1, round(TICKRATE / fps))
    frame_ticks = list(range(start_tick, end_tick + 1, step))
    n_frames    = len(frame_ticks)

    def t2f(tick):
        return min(n_frames - 1, max(0, round((tick - start_tick) / step)))

    # Every parse_ticks call rescans the whole demo: about 0.4 s of fixed cost on
    # a 290 MB file, against a few tens of milliseconds for the props themselves.
    # So this pass asks for everything that is sampled on the frame grid at once
    # and the readers below take their own slice of it; the second and last pass,
    # further down, does the same for everything sampled off the grid.
    props = ['X', 'Y', 'Z', 'yaw', 'pitch', 'health', 'is_alive', 'team_num',
             'active_weapon_name', 'inventory']
    td = parser.parse_ticks(props, ticks=frame_ticks)

    counts = td['steamid'].value_counts()
    sids   = [s for s in (str(x) for x in counts.index) if s and s != '0'][:10]
    if not sids:
        raise ValueError('No player position data found in this demo.')
    sid2i  = {s: i for i, s in enumerate(sids)}

    names = {}
    for sid, nm in zip(td['steamid'], td['name']):
        s = str(sid)
        if s in sid2i and isinstance(nm, str) and nm:
            names[s] = nm
    players = [{'name': names.get(s, '?'), 'steamid': s} for s in sids]

    frames = [[None] * 10 for _ in range(n_frames)]

    weapons = []
    _widx = {}

    def _weapon(name):
        if not isinstance(name, str) or not name:
            return -1
        n = name.replace('weapon_', '')
        if n not in _widx:
            _widx[n] = len(weapons); weapons.append(n)
        return _widx[n]

    from collections import defaultdict
    import numpy as _np
    cols = {c: td[c].to_numpy() for c in
            ('steamid', 'tick', 'X', 'Y', 'Z', 'yaw', 'pitch', 'health', 'is_alive', 'team_num',
             'active_weapon_name')}
    # Walked with zip rather than by row index: 175k rows times ten dict-and-index
    # lookups is most of what this loop used to cost. The arithmetic stays in
    # Python — round() and numpy round the last digit differently, and these
    # numbers go into the cached blob verbatim.
    for sd, tk, x, y, z, yw, pit, hp, al, tn, wpn in zip(
            cols['steamid'], cols['tick'], cols['X'], cols['Y'], cols['Z'],
            cols['yaw'], cols['pitch'], cols['health'], cols['is_alive'],
            cols['team_num'], cols['active_weapon_name']):
        i = sid2i.get(str(sd))
        if i is None:
            continue
        if x != x or y != y or tn != tn or int(tn) not in (2, 3):
            continue
        fi = t2f(int(tk))
        px, py = to_px(float(x), float(y))
        lvl = 1 if (has_lower and z == z and float(z) < lower_max) else 0
        yaw = round(float(yw)) if yw == yw else 0
        pitch = round(float(pit)) if pit == pit else 0
        zi = round(float(z)) if z == z else 0
        hp = int(hp) if hp == hp else 0
        alive = 1 if (al == al and bool(al)) else 0
        frames[fi][i] = [px, py, yaw, hp, 1 if int(tn) == 3 else 0, alive, lvl,
                         _weapon(wpn), zi, pitch]

    inv = {}
    try:
        inv_raw = defaultdict(list)
        # Still every other frame, as when this had a pass of its own: the
        # checkpoint list is what the viewer replays, and sampling it twice as
        # often would only make the blob bigger.
        _half = _np.flatnonzero((cols['tick'] - start_tick) % (2 * step) == 0)
        for sd, tk, iv in zip(cols['steamid'][_half], cols['tick'][_half],
                              td['inventory'].to_numpy()[_half]):
            i = sid2i.get(str(sd))
            if i is None:
                continue
            if iv is not None and len(iv):
                inv_raw[i].append((t2f(int(tk)),
                                   tuple(sorted(_weapon(str(w)) for w in iv))))
        for i, lst in inv_raw.items():
            lst.sort()
            cps, prev = [], None
            for fi, t in lst:
                if t != prev:
                    cps.append([fi, list(t)]); prev = t
            inv[i] = cps
    except Exception:
        inv = {}

    flights = []
    throws  = []
    GTYPE = {'CHEGrenade': 'he', 'CSmokeGrenade': 'smoke', 'CFlashbang': 'flash',
             'CIncendiaryGrenade': 'molotov', 'CMolotovGrenade': 'molotov',
             'CDecoyGrenade': 'decoy', 'CMolotovProjectile': 'molotov',
             'CSmokeGrenadeProjectile': 'smoke', 'CFlashbangProjectile': 'flash',
             'CDecoyProjectile': 'decoy', 'CBaseCSGrenadeProjectile': 'he'}
    try:
        gr = parser.parse_grenades()
        from collections import defaultdict
        # Seven rows in eight are a grenade still sitting in somebody's inventory:
        # 1.67M rows come back and 230k of them are on a flight path. Sieving
        # them out with numpy keeps both the per-row Python work and the string
        # materialisation off the other 1.44M.
        _gt = gr['grenade_type']
        _live = [t for t in _gt.unique().tolist()
                 if t.endswith('Projectile') or t == 'CIncendiaryGrenade']
        _x = gr['x'].to_numpy(); _y = gr['y'].to_numpy()
        seg_rows = gr.iloc[_np.flatnonzero(
            ~(_np.isnan(_x) | _np.isnan(_y)) & _gt.isin(_live).to_numpy())]
        gx = seg_rows['x'].to_numpy(); gy = seg_rows['y'].to_numpy()
        gz = seg_rows['z'].to_numpy(); gt = seg_rows['tick'].to_numpy()
        ge = seg_rows['grenade_entity_id'].to_numpy()
        gty = seg_rows['grenade_type'].to_numpy()
        gsid = seg_rows['steamid'].to_numpy(); gnm = seg_rows['name'].to_numpy()
        ent = defaultdict(list)
        for eid, tk, x, y, ty, sd, nm, z in zip(ge, gt, gx, gy, gty, gsid, gnm, gz):
            ent[int(eid)].append((int(tk), float(x), float(y), str(ty), str(sd), str(nm),
                                  float(z) if z == z else 0.0))
        DET_EV = {'smoke': 'smokegrenade_detonate', 'he': 'hegrenade_detonate',
                  'flash': 'flashbang_detonate', 'molotov': 'inferno_startburn',
                  'decoy': 'decoy_detonate'}
        det = {}
        for _typ, _evn in DET_EV.items():
            _df = _ev(evs, _evn)
            det[_typ] = [(int(rw['tick']), *to_px(float(rw['x']), float(rw['y'])))
                         for _, rw in _df.iterrows()] if _df is not None else []
        for rows in ent.values():
            rows.sort()
            segs = [[]]
            for row in rows:
                if segs[-1] and row[0] - segs[-1][-1][0] > 128:
                    segs.append([])
                segs[-1].append(row)
            for seg in segs:
                if seg[0][0] < start_tick:
                    continue
                typ = GTYPE.get(seg[0][3], 'he')
                if typ == 'decoy':
                    continue
                s0, s1 = seg[0][0], seg[-1][0]
                land_tick = s1
                for (dt, dpx, dpy) in sorted(det.get(typ, [])):
                    if dt < s0 or dt > s1 + 16:
                        continue
                    rp = min(seg, key=lambda r: abs(r[0] - dt))
                    gpx, gpy = to_px(rp[1], rp[2])
                    if (gpx - dpx) ** 2 + (gpy - dpy) ** 2 < 900:
                        land_tick = dt
                        break
                kept = [row for row in seg if row[0] <= land_tick]
                ground = min(row[6] for row in kept)
                pts, lastk = [], len(kept) - 1
                for n, row in enumerate(kept):
                    if n % 2 and n != lastk:
                        continue
                    pts.append([round((row[0] - start_tick) / step, 2), *to_px(row[1], row[2]),
                                round(row[6] - ground)])
                # Impacts are read off the raw rows, before the thinning above.
                # `sid` rides along so utility can be attributed by steamid rather
                # than by display name, which collides and changes mid-match.
                bnc = [[round((r[0] - start_tick) / step, 2), *to_px(r[1], r[2])]
                       for r in _bounces(kept)]
                if len(pts) >= 2:
                    fl = {'t': typ, 'p': pts, 'by': seg[0][5], 'sid': seg[0][4]}
                    if bnc:
                        fl['b'] = bnc
                    flights.append(fl)
                    throws.append((seg[0][0], seg[0][4], len(flights) - 1))
    except Exception:
        flights, throws = [], []

    # Reaction time reads `spotted` every other tick around each kill. The tick
    # set is worked out here rather than down in the react block so it can ride
    # along on the pass below instead of paying for a scan of its own.
    dd2, wf2, klist, react_ticks = None, None, [], []
    try:
        dd2 = _ev(evs, 'player_death'); wf2 = _ev(evs, 'weapon_fire')
        if dd2 is not None and wf2 is not None:
            RWIN = TICKRATE * 3
            want_r = set()
            for _, r in dd2.iterrows():
                tk = int(r['tick'])
                if tk < match_start:
                    continue
                a = sid2i.get(str(r.get('attacker_steamid')))
                v = str(r.get('user_steamid'))
                if a is not None and v in sid2i:
                    klist.append((a, v, tk))
                    want_r.update(range(max(0, tk - RWIN), tk + 1, 2))
            react_ticks = sorted(want_r)
    except Exception:
        klist, react_ticks = [], []

    # The off-grid pass: buy-time economy, the spotted trace, the pose of whoever
    # threw each grenade and the clan names. Four scans of the demo when they
    # were asked for separately, one now. Each reader takes its own ticks back
    # out of the result, and keeps its own try/except so that a demo missing one
    # of these props still loses only what depends on it.
    snap  = {ft + 192: ri for ri, ft in enumerate(freeze_ticks)}
    probe = (freeze_ticks[:6] if freeze_ticks else [start_tick])
    throw_ticks = sorted({th for th, _, _ in throws})
    BT = {}
    try:
        bt = parser.parse_ticks(
            ['X', 'Y', 'Z', 'pitch', 'yaw', 'team_num', 'spotted', 'team_clan_name',
             'balance', 'armor_value', 'has_helmet', 'has_defuser', 'current_equip_value'],
            ticks=sorted(set(snap) | set(probe) | set(throw_ticks) | set(react_ticks)))
        BT = {c: bt[c].to_numpy() for c in bt.columns}
    except Exception:
        BT = {}

    def _bt_rows(ticks):
        """Rows of the off-grid pass at exactly `ticks`, in the order they came
        back — every reader below wants its own slice and none of the rest."""
        col = BT.get('tick')
        if col is None or not len(ticks):
            return _np.empty(0, dtype=_np.intp)
        return _np.flatnonzero(_np.isin(col, list(ticks)))

    econ = {}
    if freeze_ticks:
        try:
            _i = lambda v: int(v) if v == v else 0
            _b = lambda v: 1 if (v == v and bool(v)) else 0
            for r in _bt_rows(snap):
                i = sid2i.get(str(BT['steamid'][r]))
                ri = snap.get(int(BT['tick'][r]))
                if i is None or ri is None:
                    continue
                econ.setdefault(ri, {})[i] = [
                    _i(BT['balance'][r]), _i(BT['armor_value'][r]),
                    _b(BT['has_helmet'][r]), _b(BT['has_defuser'][r]),
                    _i(BT['current_equip_value'][r])]
        except Exception:
            econ = {}

    if throws:
        try:
            pose = {}
            for r in _bt_rows(throw_ticks):
                if BT['X'][r] != BT['X'][r]:
                    continue
                tn = BT['team_num'][r]
                pose[(str(BT['steamid'][r]), int(BT['tick'][r]))] = (
                    round(float(BT['X'][r])), round(float(BT['Y'][r])), round(float(BT['Z'][r])),
                    round(float(BT['pitch'][r]), 1), round(float(BT['yaw'][r]), 1),
                    1 if (tn == tn and int(tn) == 3) else 0)
            for (th, sid, fi) in throws:
                pz = pose.get((sid, th))
                if pz:
                    flights[fi]['sp'] = [pz[0], pz[1], pz[2]]
                    flights[fi]['sa'] = [pz[3], pz[4]]
                    flights[fi]['tm'] = pz[5]
        except Exception:
            flights = []

    kills = []
    dd = _ev(evs, 'player_death')
    if dd is not None:
        for _, row in dd.iterrows():
            if int(row['tick']) < start_tick:
                continue
            kills.append({
                'f':  t2f(int(row['tick'])),
                'a':  sid2i.get(str(row.get('attacker_steamid'))),
                'v':  sid2i.get(str(row.get('user_steamid'))),
                'as': sid2i.get(str(row.get('assister_steamid'))),
                'w':  row.get('weapon') or '',
                'hs': bool(row.get('headshot')),
            })

    shots = []
    wf = _ev(evs, 'weapon_fire')
    if wf is not None:
        _NOFIRE = {'hegrenade', 'flashbang', 'smokegrenade', 'molotov',
                   'incgrenade', 'decoy'}
        seen = set()
        for _, row in wf.iterrows():
            tk = int(row['tick'])
            if tk < start_tick:
                continue
            i = sid2i.get(str(row.get('user_steamid')))
            if i is None:
                continue
            w = str(row.get('weapon') or '').replace('weapon_', '')
            if w in _NOFIRE or 'knife' in w or 'bayonet' in w:
                continue
            fr = t2f(tk)
            if (fr, i) in seen:
                continue
            seen.add((fr, i))
            shots.append([fr, i])

    blinds = []
    pb = _ev(evs, 'player_blind')
    if pb is not None and 'blind_duration' in pb.columns:
        for _, row in pb.iterrows():
            tk = int(row['tick'])
            dur = row.get('blind_duration')
            i = sid2i.get(str(row.get('user_steamid')))
            if tk < start_tick or i is None or dur is None or dur != dur or float(dur) < 0.4:
                continue
            f0b = t2f(tk)
            blinds.append({'i': i, 'f': f0b, 'end': round(f0b + float(dur) * fps, 1)})

    def points(name):
        df = _ev(evs, name)
        if df is None:
            return []
        res = []
        for _, row in df.iterrows():
            if int(row['tick']) < start_tick:
                continue
            px, py = to_px(float(row['x']), float(row['y']))
            res.append({'f': t2f(int(row['tick'])), 'x': px, 'y': py,
                        'eid': int(row.get('entityid', -1))})
        return res

    def timed(start_name, expire_name, default_secs, max_secs):
        starts = points(start_name)
        exp = _ev(evs, expire_name)
        ends_by_eid = {}
        if exp is not None:
            for _, row in exp.iterrows():
                ends_by_eid.setdefault(int(row.get('entityid', -1)), []).append(
                    t2f(int(row['tick'])))
        for lst in ends_by_eid.values():
            lst.sort()
        for g in starts:
            cap = g['f'] + fps * max_secs
            nxt = next((fr for fr in ends_by_eid.get(g['eid'], []) if fr >= g['f']), None)
            g['end'] = min(nxt, cap) if nxt is not None else min(g['f'] + fps * default_secs, cap)
        return starts

    smokes    = timed('smokegrenade_detonate', 'smokegrenade_expired', 18, 20)
    molotovs  = timed('inferno_startburn', 'inferno_expire', 7, 9)
    hes       = points('hegrenade_detonate')
    flashes   = points('flashbang_detonate')
    decoys    = points('decoy_detonate')

    bomb = []
    for kind, name in (('plant', 'bomb_planted'), ('defuse', 'bomb_defused'),
                       ('explode', 'bomb_exploded')):
        df = _ev(evs, name)
        if df is None:
            continue
        for _, row in df.iterrows():
            if int(row['tick']) < start_tick:
                continue
            entry = {'k': kind, 'f': t2f(int(row['tick'])),
                     'site': int(row['site']) if 'site' in df.columns else None}
            if kind == 'plant':
                entry['by'] = sid2i.get(str(row.get('user_steamid')))
            bomb.append(entry)

    rounds = []
    for n, ft in enumerate(freeze_ticks, 1):
        buy = _buy_begin(ft)
        nxt = next((t for t in freeze_ticks if t > ft), None)
        end_t = (_buy_begin(nxt) - 1) if nxt else end_tick
        rounds.append({'n': n, 'start': t2f(buy), 'end': t2f(end_t),
                       'freeze': t2f(ft)})

    if not rounds:
        raise ValueError('No rounds found — is this a warm-up-only demo?')

    def _side_at(fi, idx):
        e = frames[fi][idx] if 0 <= fi < n_frames else None
        return e[4] if e else None

    first_freeze = rounds[0]['freeze'] if rounds else 0
    teamA = [i for i in range(10) if _side_at(first_freeze, i) == 1]
    if len(teamA) != 5:
        teamA = [0, 1, 2, 3, 4]
    teamB = [i for i in range(10) if i not in teamA]

    team_names = {}
    try:
        from collections import Counter as _Counter
        acc = {}
        for r in _bt_rows(probe):
            s = str(BT['steamid'][r]); nm = BT['team_clan_name'][r]
            if s in sid2i and isinstance(nm, str) and nm.strip():
                acc.setdefault(sid2i[s], _Counter())[nm.strip()] += 1
        for i, c in acc.items():
            team_names[i] = c.most_common(1)[0][0]
    except Exception:
        team_names = {}

    def _clan(group):
        for i in group:
            nm = team_names.get(i)
            if nm:
                nm = nm[5:] if nm.lower().startswith('team_') else nm
                return nm[:24]
        return None

    teamAName = _clan(teamA)
    teamBName = _clan(teamB)

    rend = _ev(evs, 'round_end')
    re_frames = sorted((t2f(int(r['tick'])), str(r.get('winner', '')), str(r.get('reason', '')))
                       for _, r in rend.iterrows()) if rend is not None else []
    sa = sb = 0
    for rd in rounds:
        win = next(((w, rs) for (f, w, rs) in re_frames if rd['start'] <= f <= rd['end']), None)
        if win:
            wside = 1 if win[0] == 'CT' else 0
            a_side = next((_side_at(rd['freeze'], i) for i in teamA
                           if _side_at(rd['freeze'], i) is not None), 1)
            rd['win'] = 'A' if a_side == wside else 'B'
            rd['wside'] = win[0]
            rd['reason'] = win[1]
            if rd['win'] == 'A':
                sa += 1
            else:
                sb += 1
        rd['sa'] = sa
        rd['sb'] = sb

    voice = []
    try:
        vd = parser.parse_voice()
    except Exception:
        vd = []
    if vd:
        try:
            import ctypes as _ct
            import struct as _st
            import threading as _th
            import numpy as _np
            from collections import defaultdict as _dd
            from concurrent.futures import ThreadPoolExecutor as _Pool
            from pyogg import opus as _opus

            SR  = 48000
            CAP = SR // 8
            PLC = SR * 20 // 1000
            GAP = int(TICKRATE * 0.8)
            MIN = SR // 5 * 2
            # libopus is loaded as a CDLL, so opus_decode drops the GIL while it
            # runs — the only work in this whole parse a second thread can
            # overlap, demoparser2 holding the GIL for every one of its calls.
            # Four workers is where it stops scaling: the ctypes marshalling
            # around each 20 ms packet runs under the GIL and there are 160k of
            # them, which caps the win at about a third.
            _lopus = _opus.libopus
            _tls = _th.local()

            def _wav(pcm):
                return (b'RIFF' + _st.pack('<I', 36 + len(pcm)) + b'WAVE' + b'fmt ' +
                        _st.pack('<IHHIIHH', 16, 1, 1, SR, SR * 2, 2, 16) +
                        b'data' + _st.pack('<I', len(pcm)) + pcm)

            def _decode(utt):
                """One utterance -> gain-corrected PCM, or None if it is too short
                to be speech. Runs on a pool thread: the decoder state and the
                output buffer are per-thread, libopus keeps no globals."""
                buf = getattr(_tls, 'buf', None)
                if buf is None:
                    buf = _tls.buf = (_ct.c_int16 * CAP)()
                err = _ct.c_int()
                dec = _opus.opus_decoder_create(SR, 1, _ct.byref(err))
                parts, prev = [], None
                for tk, cb in utt:
                    if prev is not None:
                        miss = round((tk - prev) / (TICKRATE * 0.02)) - 1
                        for _ in range(max(0, min(miss, 10))):
                            ns = _lopus.opus_decode(dec, None, 0, buf, PLC, 0)
                            if ns > 0:
                                parts.append(bytes((_ct.c_int16 * ns).from_buffer(buf, 0)))
                    arr = (_ct.c_ubyte * len(cb)).from_buffer_copy(cb)
                    ns = _lopus.opus_decode(dec, arr, len(cb), buf, CAP, 0)
                    if ns > 0:
                        parts.append(bytes((_ct.c_int16 * ns).from_buffer(buf, 0)))
                    prev = tk
                _opus.opus_decoder_destroy(dec)
                pcm = b''.join(parts)
                if len(pcm) < MIN:
                    return None
                _a = _np.frombuffer(pcm, dtype=_np.int16).astype(_np.float32)
                _rms = float(_np.sqrt(_np.mean(_a * _a))) if _a.size else 0.0
                if _rms >= 1.0:
                    _peak = float(_np.max(_np.abs(_a))) or 1.0
                    _gain = min(2400.0 / _rms, 30000.0 / _peak, 8.0)
                    pcm = _np.clip(_a * _gain, -32768, 32767).astype('<i2').tobytes()
                return pcm

            bysid = _dd(list)
            for e in vd:
                bysid[str(e['steamid'])].append((int(e['tick']), bytes(e['bytes'])))
            vdir = voice_dir(key)
            os.makedirs(vdir, exist_ok=True)
            for f in os.listdir(vdir):
                try: os.remove(os.path.join(vdir, f))
                except OSError: pass

            utts = []
            for sid, chunks in bysid.items():
                idx = sid2i.get(sid)
                if idx is None:
                    continue
                chunks.sort()
                i = 0
                while i < len(chunks):
                    j = i
                    while j + 1 < len(chunks) and chunks[j + 1][0] - chunks[j][0] <= GAP:
                        j += 1
                    utts.append((idx, chunks[i:j + 1]))
                    i = j + 1
            n = 0
            with _Pool(max_workers=min(4, os.cpu_count() or 1)) as _ex:
                # map() hands results back in submission order, so the .wav
                # numbering is the one this produced utterance by utterance.
                # A batch at a time rather than all 945: the decoded audio is
                # ~180 KB per utterance and holding the whole match at once
                # would put 170 MB on the heap for nothing.
                for b in range(0, len(utts), 64):
                    batch = utts[b:b + 64]
                    for (idx, utt), pcm in zip(batch, _ex.map(_decode, [u for _, u in batch])):
                        if pcm is None:
                            continue
                        with open(os.path.join(vdir, f'{n}.wav'), 'wb') as wf:
                            wf.write(_wav(pcm))
                        ff = t2f(utt[0][0])
                        e0 = frames[ff][idx] if 0 <= ff < n_frames else None
                        side = e0[4] if e0 else (1 if idx in teamA else 0)
                        voice.append({'idx': idx, 'n': n, 'f': ff,
                                      'dur': round(len(pcm) / 2 / SR, 2), 'side': side})
                        n += 1
            voice.sort(key=lambda u: u['f'])
        except Exception:
            voice = []

    react = {}
    try:
        from collections import defaultdict as _dd
        if wf2 is not None:
            shots_by = _dd(list)
            for _, r in wf2.iterrows():
                w = str(r.get('weapon') or '')
                if any(x in w for x in ('grenade', 'flashbang', 'molotov', 'decoy', 'knife', 'bayonet')):
                    continue
                s = sid2i.get(str(r.get('user_steamid')))
                if s is not None:
                    shots_by[s].append(int(r['tick']))
            for s in shots_by:
                shots_by[s].sort()
            if react_ticks and klist:
                _rr = _bt_rows(react_ticks)
                spot = {(str(sd), int(tk)): (bool(v) if v == v else False)
                        for sd, tk, v in zip(BT['steamid'][_rr], BT['tick'][_rr],
                                             BT['spotted'][_rr])}
                per = _dd(list)
                for (a, v, tk) in klist:
                    tspot, prev = None, None
                    for t in range(max(0, tk - RWIN), tk + 1, 2):
                        cur = spot.get((v, t))
                        if cur is None:
                            continue
                        if prev is False and cur is True:
                            tspot = t
                        prev = cur
                    if tspot is None:
                        continue
                    fsh = next((t for t in shots_by.get(a, []) if tspot <= t <= tk + 8), None)
                    if fsh is None:
                        continue
                    rt = (fsh - tspot) / TICKRATE
                    if 0 <= rt <= 3:
                        per[a].append(rt)
                for a, lst in per.items():
                    if len(lst) >= 3:
                        lst.sort()
                        react[a] = round(lst[len(lst) // 2] * 1000)
    except Exception:
        react = {}

    try:
        stats = _player_stats(evs, sid2i, players, kills, rounds, frames, n_frames, voice, fps, t2f)
        for i, v in react.items():
            if 0 <= i < len(stats):
                stats[i]['react'] = v
    except Exception:
        stats = []

    data = {
        'key': key,
        'map': mapname, 'fps': fps, 'tickrate': TICKRATE,
        'radarSize': RADAR_SIZE, 'hasLower': has_lower, 'scale': cal['scale'],
        'posX': cal['pos_x'], 'posY': cal['pos_y'],
        'startTick': start_tick, 'step': step, 'nFrames': n_frames,
        'players': players, 'rounds': rounds, 'frames': frames,
        'teamA': teamA, 'teamB': teamB, 'teamAName': teamAName, 'teamBName': teamBName,
        'weapons': weapons, 'econ': econ,
        'inv': inv, 'flights': flights,
        'kills': kills, 'smokes': smokes, 'molotovs': molotovs,
        'hes': hes, 'flashes': flashes, 'decoys': decoys, 'bomb': bomb,
        'shots': shots, 'blinds': blinds, 'voice': voice, 'stats': stats,
    }
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'))
    return key, _meta(data)

def _meta(data):
    """Small summary returned to the client on parse (the heavy frames are
    fetched separately)."""
    last = data['rounds'][-1] if data['rounds'] else {}
    sa, sb = int(last.get('sa', 0)), int(last.get('sb', 0))
    return {
        'map': data['map'], 'fps': data['fps'], 'nFrames': data['nFrames'],
        'rounds': len(data['rounds']), 'players': data['players'],
        'hasLower': data['hasLower'],
        'sa': sa, 'sb': sb, 'winner': 'A' if sa > sb else ('B' if sb > sa else ''),
    }
