/* ================================================================
   白山茶花瓣飘落背景 (Camellia Petals Falling)
   月白主题：淡粉/淡蓝花瓣 + 小爱心，缓慢旋转飘落
   星夜主题：暗色花瓣微光
   极轻量 DOM 动画，数量少、优雅不抢戏
   ================================================================ */

(function () {
  if (window.__petalBg) return;
  window.__petalBg = true;

  const CONTAINER_ID = 'petal-bg-layer';

  function ensureLayer() {
    let layer = document.getElementById(CONTAINER_ID);
    if (!layer) {
      layer = document.createElement('div');
      layer.id = CONTAINER_ID;
      layer.style.cssText = [
        'position:fixed', 'inset:0', 'width:100vw', 'height:100vh',
        'pointer-events:none', 'z-index:0', 'overflow:hidden',
        'transition:opacity .6s ease', 'opacity:0'
      ].join(';');
      document.body.appendChild(layer);
    }
    return layer;
  }

  // 花瓣样式（用内联 SVG 保证任何字体环境下都是花瓣形）
  function petalSVG(color) {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
        <path d="M12 2.5 C16.5 5.5 19 9.5 19 13.5 C19 18 15.8 21.5 12 21.5 C8.2 21.5 5 18 5 13.5 C5 9.5 7.5 5.5 12 2.5 Z"
              fill="${color}" opacity="0.9"/>
        <path d="M12 4 C14.8 7 16.5 10.5 16.5 14" stroke="rgba(255,255,255,0.5)" stroke-width="0.8" fill="none"/>
      </svg>`
    );
  }

  function heartSVG() {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12">
        <path d="M12 20.5S4.8 16.5 4.8 11.5A4 4 0 0 1 12 9.2a4 4 0 0 1 7.2 2.3c0 5-7.2 9-7.2 9Z" fill="#F3B9C8" opacity="0.75"/>
      </svg>`
    );
  }

  const PETAL_COLORS_MOON = ['#F6C7D4', '#FBE3EB', '#CFE0F3', '#E4EDF9', '#F8D9C8'];
  const PETAL_COLORS_MID = ['#3A4A5E', '#2E3B4E', '#44546B'];

  function currentColors() {
    return document.documentElement.getAttribute('data-theme') === 'midnight'
      ? PETAL_COLORS_MID : PETAL_COLORS_MOON;
  }

  function spawn(layer, isInitial) {
    const colors = currentColors();
    const isHeart = Math.random() < 0.18;   // 少量爱心点缀
    const el = document.createElement('div');
    const size = (isHeart ? 9 : 11) + Math.random() * (isHeart ? 4 : 9);
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = [
      'position:absolute', 'top:-24px',
      'left:' + (Math.random() * 100) + 'vw',
      'width:' + size + 'px', 'height:' + size + 'px',
      'will-change:transform',
      'background:' + (isHeart ? `url("${heartSVG()}")` : `url("${petalSVG(color)}")`) + ' center/contain no-repeat'
    ].join(';');

    const duration = 11 + Math.random() * 9;              // 11~20s 缓落
    const sway = 30 + Math.random() * 50;                 // 横向摆幅 px
    const spin = (Math.random() - 0.5) * 480;             // 旋转角度
    const startTop = isInitial ? Math.random() * window.innerHeight : -24;

    layer.appendChild(el);

    const anim = el.animate([
      { transform: `translate(0px, ${startTop}px) rotate(0deg)`, opacity: 0 },
      { opacity: isHeart ? 0.5 : 0.75, offset: 0.08 },
      { opacity: 0.65, offset: 0.85 },
      { transform: `translate(${sway}px, ${window.innerHeight + 40}px) rotate(${spin}deg)`, opacity: 0 }
    ], { duration: duration * 1000, easing: 'linear', fill: 'forwards' });

    anim.onfinish = () => el.remove();
  }

  // 主循环：每 1.6~2.8s 落一瓣，最多同时 ~12 个
  let petalEnabled = true;
  window.__petalSetEnabled = (on) => {
    petalEnabled = on;
    const layer = document.getElementById(CONTAINER_ID);
    if (layer) layer.style.opacity = on ? '1' : '0';
  };

  function startLoop(layer) {
    const tick = () => {
      if (petalEnabled) {
        const app = document.getElementById('app');
        if (app && !app.classList.contains('hidden')) {
          if (layer.childElementCount < 12) spawn(layer, false);
        }
      }
      setTimeout(tick, 1600 + Math.random() * 1200);
    };
    // 初始撒 5 片在半空中，避免开场空荡荡
    for (let i = 0; i < 5; i++) spawn(layer, true);
    setTimeout(tick, 1800);
  }

  // 主题切换时清空重来（颜色跟着主题换）
  const themeObserver = new MutationObserver(() => {
    const layer = document.getElementById(CONTAINER_ID);
    if (layer) layer.innerHTML = '';
    for (let i = 0; i < 4; i++) spawn(ensureLayer(), true);
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // 主界面可见性控制（尊重用户开关）
  function syncVisibility() {
    const layer = ensureLayer();
    const app = document.querySelector('#app');
    layer.style.opacity = (app && !app.classList.contains('hidden') && petalEnabled) ? '1' : '0';
  }
  const appEl = document.querySelector('#app');
  if (appEl) {
    new MutationObserver(syncVisibility).observe(appEl, { attributes: true, attributeFilter: ['class'] });
  }

  startLoop(ensureLayer());
  syncVisibility();
})();
