(function () {

  const STEPS = [
    { tab: 0, sel: null,           titleKey: 'tour.welcome.title',    textKey: 'tour.welcome.text' },
    { tab: 0, sel: '#mapsGrid',    titleKey: 'tour.maps.title',       textKey: 'tour.maps.text',       place: 'bottom' },
    { tab: 0, sel: '#launchBtn',   titleKey: 'tour.launch.title',     textKey: 'tour.launch.text',     place: 'top' },
    { tab: 1, sel: '#steamId',     titleKey: 'tour.steamid.title',    textKey: 'tour.steamid.text',    place: 'bottom' },
    { tab: 1, sel: '#loadSkinsBtn',titleKey: 'tour.skineditor.title', textKey: 'tour.skineditor.text', place: 'top' },
    { tab: 2, sel: '#osSwitch',    titleKey: 'tour.os.title',         textKey: 'tour.os.text',         place: 'bottom' },
    { tab: 2, sel: '#pluginsFnBtn', titleKey: 'tour.plugins.title',   textKey: 'tour.plugins.text',    place: 'bottom' },
    { tab: 3, sel: '#bindsAccordion', titleKey: 'tour.binds.title',   textKey: 'tour.binds.text',      place: 'bottom' },
    { tab: 3, sel: '#bindsSaveBtn', titleKey: 'tour.bindsSave.title', textKey: 'tour.bindsSave.text',  place: 'top' },
    { tab: 4, sel: '#demoDrop',    titleKey: 'tour.demoDrop.title',   textKey: 'tour.demoDrop.text',   place: 'bottom' },
    { tab: 4, sel: '#demoList',    titleKey: 'tour.demoList.title',   textKey: 'tour.demoList.text',   place: 'top' },
    { tab: 5, sel: '#dlServerBtn', titleKey: 'tour.download.title',   textKey: 'tour.download.text',   place: 'bottom' },
    { tab: 7, sel: '#setLangSeg',  titleKey: 'tour.settings.title',   textKey: 'tour.settings.text',   place: 'bottom' },
  ];

  const PAD = 7;   

  let root, ring, tip, idx = 0, active = false;

  function $(s) { return document.querySelector(s); }

  function build() {
    root = document.getElementById('tourOverlay');
    ring = root.querySelector('.tour-ring');
    tip  = root.querySelector('.tour-tip');

    root.querySelector('[data-tour="back"]').addEventListener('click', () => go(idx - 1));
    root.querySelector('[data-tour="next"]').addEventListener('click', () => go(idx + 1));
    root.querySelector('[data-tour="skip"]').addEventListener('click', finish);
    
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', () => { if (active) position(STEPS[idx]); });
    document.addEventListener('langchange', () => { if (active) render(); });
  }

  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape')      { finish(); }
    else if (e.key === 'ArrowRight') { go(idx + 1); }
    else if (e.key === 'ArrowLeft')  { go(idx - 1); }
  }

  function switchTab(tab) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if (btn && !btn.classList.contains('active')) btn.click();
  }

  function go(n) {
    if (n < 0) return;
    if (n >= STEPS.length) { finish(); return; }
    idx = n;
    const step = STEPS[idx];
    const track = document.getElementById('tabsTrack');
    const btn = document.querySelector(`.tab-btn[data-tab="${step.tab}"]`);
    const willSlide = btn && !btn.classList.contains('active');
    switchTab(step.tab);
    render();
    const place = () => { if (active) position(step); };

    if (willSlide && track) {
      let done = false;
      const onEnd = (e) => {
        if (e.target !== track || e.propertyName !== 'transform') return;
        done = true; track.removeEventListener('transitionend', onEnd);
        requestAnimationFrame(place);
      };
      track.addEventListener('transitionend', onEnd);
      setTimeout(() => { if (!done) { track.removeEventListener('transitionend', onEnd); place(); } }, 450);
    } else {
      requestAnimationFrame(() => requestAnimationFrame(place));
    }
  }

  function render() {
    const step = STEPS[idx];
    tip.querySelector('.tour-tip-title').textContent = t(step.titleKey);
    tip.querySelector('.tour-tip-text').textContent  = t(step.textKey);
    tip.querySelector('.tour-step-count').textContent = `${idx + 1} / ${STEPS.length}`;

    const back = root.querySelector('[data-tour="back"]');
    const next = root.querySelector('[data-tour="next"]');
    back.disabled = idx === 0;
    back.textContent = t('tour.back');
    next.textContent = idx === STEPS.length - 1 ? t('tour.done') : t('tour.next');
    root.querySelector('[data-tour="skip"]').textContent = t('tour.skip');
  }

  function position(step) {
    const target = step.sel ? $(step.sel) : null;
    if (target) target.scrollIntoView({ block: 'center', behavior: 'auto' });
    const r = target ? target.getBoundingClientRect() : null;

    if (!target || (r.width === 0 && r.height === 0)) {
      ring.style.opacity = '0';
      ring.style.width = ring.style.height = '0';
      tip.classList.remove('tip-top', 'tip-bottom');
      tip.classList.add('tip-center');
      tip.style.left = '50%';
      tip.style.top  = '50%';
      tip.style.transform = 'translate(-50%, -50%)';
      return;
    }

    ring.style.opacity = '1';
    ring.style.left   = (r.left - PAD) + 'px';
    ring.style.top    = (r.top  - PAD) + 'px';
    ring.style.width  = (r.width  + PAD * 2) + 'px';
    ring.style.height = (r.height + PAD * 2) + 'px';

    tip.classList.remove('tip-center');
    tip.style.transform = 'none';

    const tipW = 320;
    const vw = window.innerWidth, vh = window.innerHeight;
    let place = step.place || 'bottom';
    if (place === 'bottom' && r.bottom + 150 > vh) place = 'top';
    if (place === 'top'    && r.top    - 150 < 0)  place = 'bottom';

    let left = r.left + r.width / 2 - tipW / 2;
    left = Math.max(14, Math.min(left, vw - tipW - 14));
    tip.style.left = left + 'px';

    if (place === 'top') {
      tip.classList.add('tip-top'); tip.classList.remove('tip-bottom');
      tip.style.top = (r.top - PAD - tip.offsetHeight - 12) + 'px';
    } else {
      tip.classList.add('tip-bottom'); tip.classList.remove('tip-top');
      tip.style.top = (r.bottom + PAD + 12) + 'px';
    }

    const arrow = tip.querySelector('.tour-arrow');
    let ax = r.left + r.width / 2 - left;
    ax = Math.max(18, Math.min(ax, tipW - 18));
    arrow.style.left = ax + 'px';
  }

  function start() {
    if (active) return;
    if (!root) build();
    active = true;
    root.hidden = false;
    document.body.classList.add('tour-on');
    go(0);
  }

  function finish() {
    active = false;
    if (root) root.hidden = true;
    document.body.classList.remove('tour-on');
    try { localStorage.setItem('cs2prak_tutorial_done', '1'); } catch (e) {}
  }

  function maybeAutoStart() {
    let done = '0', off = '0';
    try {
      done = localStorage.getItem('cs2prak_tutorial_done') || '0';
      off  = localStorage.getItem('cs2prak_tutorial_off')  || '0';
    } catch (e) {}
    if (done !== '1' && off !== '1') {
      
      setTimeout(start, 600);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { build(); maybeAutoStart(); });
  } else {
    build(); maybeAutoStart();
  }

  window.startTutorial = function () {
    try { localStorage.removeItem('cs2prak_tutorial_done'); } catch (e) {}
    start();
  };
})();
