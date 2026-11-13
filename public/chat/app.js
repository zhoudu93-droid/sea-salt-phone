/* ================================================================
   山茶信笺 · Camellia Chat —— 核心逻辑 (v2.0)
   ================================================================ */
'use strict';

/* ---------------- 存储键 ---------------- */
const K = {
  accounts: 'pchat_accounts_list_v2',
  curUid:   'pchat_cur_uid_v2',
  personas: 'pchat_personas_v2',
  chats:    'pchat_chats_v2',
  moments:  'pchat_moments_v2',
  miniapps: 'pchat_miniapps_v2',
  wallet:   'pchat_wallet_v2',
  stickers: 'pchat_stickers_v2',
  prefs:    'pchat_prefs_v2',
  cover:    'pchat_cover_v2'
};

/* 桌面【设置中心】里统一管理的 API */
const API_KEYS = {
  primary:   { url:'sea_salt_api_url',   key:'sea_salt_api_key',   model:'sea_salt_api_model'   },
  secondary: { url:'sea_salt_api_url_b', key:'sea_salt_api_key_b', model:'sea_salt_api_model_b' }
};

/* ---------------- 小工具 ---------------- */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');

/* 图片智能压缩：避免巨大 base64 撑爆 localStorage 配额导致背景换不上 */
function compressImage(file, maxSide = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve('');
    const r = new FileReader();
    r.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxSide || h > maxSide) {
          if (w > h) { h = Math.round((h * maxSide) / w); w = maxSide; }
          else { w = Math.round((w * maxSide) / h); h = maxSide; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        try {
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        } catch (err) {
          resolve(e.target.result);
        }
      };
      img.onerror = () => resolve(e.target.result);
      img.src = e.target.result;
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function load(k, d) {
  try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
  catch (e) { return d; }
}
function save(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {
    console.warn('localStorage save warning:', e);
    // 如果是配额超限错误，尝试轻度提示
    if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
      toast('存储空间接近上限，请避免单张过大原图');
    }
  }
}

function fmtClock(ts) {
  const d = new Date(ts);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function fmtRowTime(ts) {
  const d = new Date(ts), n = new Date();
  const sameDay = d.toDateString() === n.toDateString();
  if (sameDay) return fmtClock(ts);
  const diff = (n - d) / 86400000;
  if (diff < 1) return '昨天';
  if (diff < 7) return '星期' + '日一二三四五六'[d.getDay()];
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}
function fmtFull(ts) {
  const d = new Date(ts), n = new Date();
  const t = fmtClock(ts);
  if (d.toDateString() === n.toDateString()) return '今天 ' + t;
  if ((n - d) < 172800000) return '昨天 ' + t;
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + t;
}
function toast(msg, ms) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms || 1800);
}

/* ---------------- API 读取（主 / 副） ---------------- */
function readApi(which) {
  const m = API_KEYS[which];
  const url = (localStorage.getItem(m.url) || '').trim();
  const key = (localStorage.getItem(m.key) || '').trim();
  const model = (localStorage.getItem(m.model) || '').trim();
  return { url, key, model, ready: !!(url && key && model) };
}
function apiSlots() {
  const p = readApi('primary'), s = readApi('secondary');
  return { primary: p, secondary: s, any: p.ready || s.ready };
}

/* ---------------- 状态与多账号体系（账号级彻底数据隔离） ---------------- */
function getInitAccounts() {
  let list = load(K.accounts, null);
  if (!list) {
    const old = load('pchat_account_v1', null);
    if (old && old.nickname) {
      list = [{
        id: 'acc_' + uid(),
        username: old.wxid || 'SY1125',
        password: '',
        nickname: old.nickname,
        avatar: old.avatar || '',
        sign: old.sign || '我们期盼同一个冬',
        masks: [],
        createdAt: old.createdAt || Date.now()
      }];
    } else {
      list = [];
    }
  }
  // 过滤掉历史误写入的纯虚拟面具
  if (Array.isArray(list)) {
    list = list.filter(a => a && a.id && !a.isMaskOnly && (!a.id.startsWith('mask_')));
  }
  // 账号列表为空：保持为空，进入注册页让用户创建自己的账号（不再内置默认账号）
  if (!list || !list.length) {
    list = [];
  }
  return list;
}

const accK = (uid, key) => `pchat_${uid}_${key}`;

const S = {
  accounts: getInitAccounts(),
  curUid:   load(K.curUid, null),
  account:  null,
  personas: null,
  chats:    {},
  moments:  null,
  miniapps: null,
  wallet:   null,
  stickers: [],
  favorites: [],
  prefs:    load(K.prefs,    { theme:'moon' }),
  cover:    load(K.cover,    'camellia_cover.svg'),
  tab:      'chat',
  openId:   null
};

// 永远确保账号安全有效（无内置默认账号：为空时走注册页）
if (!S.accounts || !S.accounts.length) {
  S.accounts = [];
  S.curUid = null;
  S.account = null;
} else {
  if (!S.curUid || !S.accounts.find(a => a.id === S.curUid)) {
    S.curUid = S.accounts[0].id;
  }
  S.account = S.accounts.find(a => a.id === S.curUid) || S.accounts[0];
}

// 载入特定账号专属的聊天记录、人设和朋友圈
function loadAccountData(uid) {
  if (!uid) return;
  // 严格隔离：新账号只能读属于自己的独立数据，绝不继承旧账号聊天与人设
  S.personas = load(accK(uid, 'personas'), null);
  S.chats    = load(accK(uid, 'chats'), {});
  S.moments  = load(accK(uid, 'moments'), null);
  S.wallet   = load(accK(uid, 'wallet'), null);
  const rawStickers = load(accK(uid, 'stickers'), []);
  S.stickers = (Array.isArray(rawStickers) ? rawStickers : []).map((s, idx) => {
    if (typeof s === 'string') return { id: 'st_' + idx + '_' + uid, name: '表情' + (idx + 1), url: s };
    return { id: s.id || ('st_' + idx + '_' + uid), name: s.name || ('表情' + (idx + 1)), url: s.url || '' };
  }).filter(s => s.url);
  S.favorites = load(accK(uid, 'favorites'), []);
  S.miniapps = load(accK(uid, 'miniapps'), null);

  if (S.account) {
    if (!S.account.masks || !S.account.masks.length) {
      const defMid = 'mask_' + uid;
      S.account.masks = [{
        id: defMid,
        name: S.account.nickname || '',
        gender: '',
        birthday: '',
        age: '',
        appearance: '',
        tone: '',
        background: S.account.sign || '',
        avatar: S.account.avatar || ''
      }];
      S.account.currentMaskId = defMid;
    }
    if (!S.account.currentMaskId && S.account.masks.length > 0) {
      S.account.currentMaskId = S.account.masks[0].id;
    }
  }
}

if (S.curUid) {
  loadAccountData(S.curUid);
}

function persist() {
  save(K.accounts, S.accounts);
  save(K.curUid,   S.curUid);
  if (S.curUid) {
    save(accK(S.curUid, 'personas'), S.personas);
    save(accK(S.curUid, 'chats'),    S.chats);
    save(accK(S.curUid, 'moments'),  S.moments);
    save(accK(S.curUid, 'miniapps'), S.miniapps);
    save(accK(S.curUid, 'wallet'),   S.wallet);
    save(accK(S.curUid, 'stickers'), S.stickers);
    save(accK(S.curUid, 'favorites'), S.favorites);
  }
  save(K.prefs, S.prefs);
  save(K.cover, S.cover);
}
function saveChats()     { if (S.curUid) save(accK(S.curUid, 'chats'), S.chats); }
function savePersonas()  { if (S.curUid) save(accK(S.curUid, 'personas'), S.personas); }
function saveMoments()   { if (S.curUid) save(accK(S.curUid, 'moments'), S.moments); }
function saveWallet()    { if (S.curUid) save(accK(S.curUid, 'wallet'), S.wallet); }
function saveStickers()  { if (S.curUid) save(accK(S.curUid, 'stickers'), S.stickers); }
function saveFavorites() { if (S.curUid) save(accK(S.curUid, 'favorites'), S.favorites); }

function getCurrentMask() {
  const acc = S.account;
  if (!acc) return null;
  if (!acc.masks || !acc.masks.length) {
    const defMid = 'mask_' + (acc.id || uid());
    acc.masks = [{
      id: defMid,
      name: acc.nickname || '宋遇',
      gender: '',
      birthday: '',
      age: '',
      appearance: '',
      tone: '',
      background: acc.sign || '我们期盼同一个冬',
      avatar: acc.avatar || ''
    }];
    acc.currentMaskId = defMid;
  }
  return acc.masks.find(m => m.id === acc.currentMaskId) || acc.masks[0];
}

/* ---------------- 头像渲染 ---------------- */
function cleanFirstChar(str) {
  if (!str) return '·';
  const clean = str.replace(/[()（）\[\]【】_\s]/g, '');
  const m = clean.match(/[\u4e00-\u9fa5a-zA-Z0-9]/);
  return m ? m[0] : (clean[0] || '·');
}

function avatarHtml(entity, cls) {
  const c = 'av ' + (cls || '');
  if (entity && entity.avatar) return `<div class="${c}"><img src="${entity.avatar}" alt=""></div>`;
  const name = (entity && (entity.name || entity.nickname)) || '';
  return `<div class="${c}">${esc(cleanFirstChar(name))}</div>`;
}

/* ---------------- 首次初始化：内置一张空白人设 ---------------- */
function ensureSeed() {
  if (!S.personas) {
    S.personas = [{
      id: uid(),
      name: '（空白人设）',
      wxid: 'wxid_blank',
      avatar: '',
      sign: '请继续成为我生命中不可或缺的存在',
      prompt: '',
      greeting: '',
      remark: '',
      pokeSuffix: '的小脸蛋并递上一杯温水',
      temp: 0.85,
      seeded: true,
      createdAt: Date.now()
    }];
  }
  if (!S.moments) S.moments = [];
  if (!S.miniapps) {
    S.miniapps = [
      { id: 'mini_notes', name: '随手心愿贴', desc: '记录彼此的心愿与随笔', icon: 'i-sticker', bg: 'linear-gradient(135deg, #FF9A8B, #FF6A88)' },
      { id: 'mini_tarot', name: '星象塔罗', desc: '今日爱情与运势指引', icon: 'i-heart', bg: 'linear-gradient(135deg, #667eea, #764ba2)' },
      { id: 'mini_capsule', name: '时光胶囊', desc: '写给未来的浪漫情书', icon: 'i-lock', bg: 'linear-gradient(135deg, #4facfe, #00f2fe)' },
      { id: 'mini_music', name: '白山茶电台', desc: '听陈愿轻轻放一首私藏歌', icon: 'i-bubble', bg: 'linear-gradient(135deg, #43e97b, #38f9d7)' }
    ];
  }
  if (!S.wallet) S.wallet = { balance: 520.00, records: [] };
  if (!S.chats) S.chats = {};
  persist();
}

/* ---------------- 启动引导 ---------------- */
function boot() {
  applyTheme();
  if (S.account && S.account.nickname) {
    ensureSeed();
    startApp();
  } else {
    showAuthPage('register');
  }
}
function applyTheme() {
  const t = S.prefs.theme === 'midnight' ? 'midnight' : 'moon';
  document.documentElement.setAttribute('data-theme', t === 'midnight' ? 'midnight' : 'moon');
  const mt = document.querySelector('meta[name="theme-color"]');
  if (mt) mt.setAttribute('content', t === 'midnight' ? '#141922' : '#F4F6F9');
}


/* ---------------- 认证页面（登录 / 注册 · 支持手机号与验证码联动） ---------------- */
let authMode = 'register';
let tempAvatar = '';
let lastSentCode = '';
let smsCountdown = 0;
let smsTimer = null;

function showAuthPage(mode) {
  authMode = mode || 'register';
  $('#app').classList.add('hidden');
  $('#boot').classList.remove('hidden');
  renderAuth();
}

function renderAuth() {
  const isReg = authMode === 'register';

  $('#boot-body').innerHTML = `
    <!-- 邮票信笺卡片外层包裹 (Stamp Envelope) -->
    <div class="stamp-envelope">
      ${S.account ? `
        <!-- 已有账号时的返回键 -->
        <button class="hdr-btn" id="auth-back-btn" title="返回" style="position:absolute;top:16px;left:16px;width:34px;height:34px;z-index:20">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
      ` : ''}

      <!-- 邮票右上角复古邮戳与面值标识 -->
      <div class="stamp-postmark">
        <div class="stamp-badge">
          <span class="stamp-badge-text">AIR MAIL</span>
          <span class="stamp-badge-val">9.25</span>
        </div>
      </div>

      <div class="auth-header">
        <div class="auth-title">${isReg ? '山茶信笺 · 注册' : '山茶信笺 · 登录'}</div>
      </div>

      <!-- 登录 / 注册分段切换 -->
      <div class="auth-segment">
        <div class="auth-seg-item ${!isReg ? 'active' : ''}" id="seg-login">登录</div>
        <div class="auth-seg-item ${isReg ? 'active' : ''}" id="seg-reg">注册</div>
      </div>

      <!-- 表单字段组卡片（注册时头像与网名融为一行） -->
      <div class="auth-card auth-fields-card">
        ${isReg ? `
          <div class="auth-input-row auth-profile-merge-row">
            <div class="auth-mask-avatar" id="auth-avatar-row" title="轻点上传头像">
              <span id="auth-mask-preview" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">
                ${tempAvatar ? `<img src="${tempAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                  <circle cx="12" cy="13" r="4"></circle>
                </svg>`}
              </span>
            </div>
            <input type="file" id="auth-avatar-input" accept="image/*" hidden>
            <div class="auth-merge-right">
              <div class="auth-merge-caption">昵称与头像 · 轻点左圆上传</div>
              <input class="auth-input-field auth-merge-nick" id="auth-nickname" placeholder="输入你的网名…" maxlength="16" value="">
            </div>
          </div>
        ` : ''}

        <!-- 手机号字段（必填或作为账号） -->
        <div class="auth-input-row">
          <div class="auth-input-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="2" width="14" height="20" rx="3"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
          </div>
          <div class="auth-input-label">手机号</div>
          <input class="auth-input-field" id="auth-phone" type="tel" placeholder="请输入手机号" maxlength="11" value="">
        </div>

        <!-- 短信验证码字段 -->
        <div class="auth-input-row">
          <div class="auth-input-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          </div>
          <div class="auth-input-label">验证码</div>
          <input class="auth-input-field" id="auth-code" type="text" placeholder="请输入验证码" maxlength="6">
          <button class="auth-sms-btn" id="auth-get-code-btn" type="button">获取验证码</button>
        </div>

        <div class="auth-input-row">
          <div class="auth-input-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M7 15h10M7 9h4"></path></svg>
          </div>
          <div class="auth-input-label">${isReg ? '微信号' : '或账号'}</div>
          <input class="auth-input-field" id="auth-account" placeholder="${isReg ? '自定义或使用默认' : '微信号 / 手机号'}" maxlength="24" value="">
        </div>

        <div class="auth-input-row">
          <div class="auth-input-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>
          </div>
          <div class="auth-input-label">密码</div>
          <input class="auth-input-field" id="auth-pwd" type="password" placeholder="${isReg ? '请设置密码（可选）' : '请输入密码（可选）'}" maxlength="24">
          <div class="auth-eye-btn" id="auth-eye-toggle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 19.6S4.4 15.3 4.4 10.2A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.6 2.6c0 5.1-7.6 9.4-7.6 9.4Z"></path></svg>
          </div>
        </div>
      </div>

      <!-- 用户协议勾选 -->
      <div class="auth-policy-row">
        <input type="checkbox" id="auth-policy-chk" checked>
        <label for="auth-policy-chk">我已阅读并同意《服务协议》和《隐私政策》</label>
      </div>

      <!-- 主提交按钮 -->
      <button class="auth-submit-btn" id="auth-submit-btn">
        ${isReg ? '盖戳寄出 · 创建账号' : '开启信笺 · 立即登录'}
      </button>

      <!-- 底部切换提示 -->
      <div class="auth-bottom-link" id="auth-switch-link">
        ${isReg ? '已有信笺账号？<b>去登录</b>' : '初次投递？<b>去注册</b>'}
      </div>
    </div>
  `;

  const backBtn = $('#auth-back-btn');
  if (backBtn) {
    backBtn.onclick = () => {
      $('#boot').classList.add('hidden');
      $('#app').classList.remove('hidden');
      renderTab(S.tab);
    };
  }
  $('#seg-login').onclick = () => { authMode = 'login'; renderAuth(); };
  $('#seg-reg').onclick   = () => { authMode = 'register'; renderAuth(); };
  $('#auth-switch-link').onclick = () => { authMode = isReg ? 'login' : 'register'; renderAuth(); };

  // 获取验证码与信息 App 同步管线
  const codeBtn = $('#auth-get-code-btn');
  codeBtn.onclick = () => {
    const phone = $('#auth-phone').value.trim();
    if (!phone || phone.length < 7) { toast('请先输入有效的手机号'); return; }
    
    // 生成 6 位纯数字验证码
    lastSentCode = String(Math.floor(100000 + Math.random() * 900000));
    
    // 1. 发送到系统信息 App (包含桌面横幅通知与短消息储存)
    const smsContent = `【山茶信笺】您的验证码是 ${lastSentCode}，用于登录《海盐白山茶 · 山茶信笺》，5分钟内有效。如非本人操作请忽略。`;
    
    // 写入 localStorage 让小手机桌面及信息 App 都能读到
    try {
      const SMS_KEY = 'sea_salt_sms_threads_v1';
      let threads = JSON.parse(localStorage.getItem(SMS_KEY) || '[]');
      let authThread = threads.find(t => t.id === 'thread_auth');
      if (!authThread) {
        authThread = {
          id: 'thread_auth',
          name: '10690088925',
          title: '验证码服务中心',
          unread: 0,
          avatarBg: 'linear-gradient(135deg, #10b981, #059669)',
          messages: []
        };
        threads.unshift(authThread);
      }
      authThread.unread = (authThread.unread || 0) + 1;
      authThread.messages.push({
        id: 'msg_code_' + Date.now(),
        role: 'them',
        time: Date.now(),
        text: smsContent
      });
      localStorage.setItem(SMS_KEY, JSON.stringify(threads));
    } catch(e) {}

    // 如果运行在 iframe 内，通知父级小手机弹出横幅
    try {
      if (window.parent && window.parent.dispatchSystemSms) {
        window.parent.dispatchSystemSms('验证码服务中心', '10690088925', smsContent);
      }
    } catch(e) {}

    // 自动帮宝宝在 1.5 秒后贴心回填（或直接填入），同时给出 Toast 提示
    toast(`验证码已发往桌面【信息】：${lastSentCode}`, 3200);
    setTimeout(() => {
      const cInput = $('#auth-code');
      if (cInput && !cInput.value) {
        cInput.value = lastSentCode;
        toast(`已自动填入验证码：${lastSentCode}`);
      }
    }, 1200);

    // 倒计时
    smsCountdown = 60;
    codeBtn.classList.add('disabled');
    codeBtn.textContent = `${smsCountdown}s`;
    clearInterval(smsTimer);
    smsTimer = setInterval(() => {
      smsCountdown--;
      if (smsCountdown <= 0) {
        clearInterval(smsTimer);
        codeBtn.classList.remove('disabled');
        codeBtn.textContent = '重新获取';
      } else {
        codeBtn.textContent = `${smsCountdown}s`;
      }
    }, 1000);
  };

  if (isReg) {
    $('#auth-avatar-row').onclick = () => $('#auth-avatar-input').click();
    $('#auth-avatar-input').onchange = e => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        tempAvatar = r.result;
        $('#auth-mask-preview').innerHTML = `<img src="${tempAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
      };
      r.readAsDataURL(f);
    };
  }

  let eyeOpen = false;
  $('#auth-eye-toggle').onclick = () => {
    eyeOpen = !eyeOpen;
    $('#auth-pwd').type = eyeOpen ? 'text' : 'password';
  };

  $('#auth-submit-btn').onclick = () => {
    const chk = $('#auth-policy-chk');
    if (!chk.checked) { toast('请先勾选同意协议'); return; }

    const phone = $('#auth-phone').value.trim();
    const acc = $('#auth-account').value.trim();
    const code = $('#auth-code').value.trim();
    const pwd = $('#auth-pwd').value.trim();

    if (isReg) {
      const nick = $('#auth-nickname').value.trim();
      if (!nick) { toast('请输入网名'); return; }
      if (!phone && !acc) { toast('请输入手机号或账号'); return; }
      if (lastSentCode && code && code !== lastSentCode) {
        toast('验证码不正确');
        return;
      }

      const finalAcc = acc || ('wx_' + (phone ? phone.slice(-6) : uid()));
      const exist = S.accounts.find(a => a.username === finalAcc || (phone && a.phone === phone));
      if (exist) { toast('该账号或手机号已注册，请直接登录'); return; }

      const newAccId = 'acc_' + uid();
      const newAcc = {
        id: newAccId,
        username: finalAcc,
        phone: phone || '',
        password: pwd,
        nickname: nick,
        avatar: tempAvatar || '',
        sign: '这个人很懒，什么都没写~',
        masks: [{
          id: 'mask_' + uid(),
          nickname: nick,
          username: finalAcc,
          avatar: tempAvatar || '',
          sign: '这个人很懒，什么都没写~',
          prompt: ''
        }],
        createdAt: Date.now()
      };
      S.accounts.push(newAcc);
      S.curUid = newAcc.id;
      S.account = newAcc;
      loadAccountData(newAccId);
      ensureSeed();
      persist();
      $('#boot').classList.add('hidden');
      startApp();
    } else {
      // 登录支持手机号、验证码或密码登录
      if (!acc && !phone) { toast('请输入手机号或账号'); return; }

      let target = null;
      if (phone) {
        target = S.accounts.find(a => a.phone === phone || a.username === phone);
      }
      if (!target && acc) {
        target = S.accounts.find(a => a.username === acc || a.phone === acc);
      }

      // 如果有验证码且正确，支持免密快速登录或自动创建
      if (lastSentCode && code && code === lastSentCode) {
        if (!target) {
          // 手机验证码快捷创建登录
          target = {
            id: 'acc_' + uid(),
            username: acc || ('wx_' + phone.slice(-6)),
            phone: phone,
            password: pwd,
            nickname: '山茶旅人',
            avatar: '',
            sign: '这个人很懒，什么都没写~',
            createdAt: Date.now()
          };
          S.accounts.push(target);
          ensureSeed();
        }
      } else {
        if (!target) { toast('账号或手机号不存在，请先注册'); return; }
        if (target.password && pwd && target.password !== pwd) { toast('密码不正确'); return; }
      }

      S.curUid = target.id;
      S.account = target;
      loadAccountData(target.id);
      ensureSeed();
      persist();
      $('#boot').classList.add('hidden');
      startApp();
      toast(`欢迎回来，${target.nickname}`);
    }
  };
}


/* ---------------- 切换账号弹窗（换号=新号，独享聊天记录与人设；支持删除当前账号） ---------------- */
function openSwitchAccountSheet() {
  // 确保账号列表里只有真实的注册/登录账号，不会混入面具
  const realAccounts = S.accounts.filter(a => a && a.id && !a.isMaskOnly && (!a.id.startsWith('mask_')));
  const cardsHtml = realAccounts.map(acc => {
    const isCur = acc.id === S.curUid;
    const curM = (acc.masks && acc.masks.find(m => m.id === acc.currentMaskId)) || (acc.masks && acc.masks[0]);
    const dName = (curM && curM.name) || acc.nickname || '未命名账号';
    const dAv = (curM && curM.avatar) || acc.avatar;
    const dSign = (curM && (curM.background || curM.tone)) || acc.sign || '这个人很懒，什么都没写~';
    return `
      <div class="acc-mask-card ${isCur ? 'is-current' : ''}" data-accid="${acc.id}">
        <div class="acc-mask-av-wrap" data-act="switch-acc" data-accid="${acc.id}">
          ${avatarHtml({ avatar: dAv, nickname: dName }, 'round lg')}
        </div>
        <div class="acc-mask-info" data-act="switch-acc" data-accid="${acc.id}" style="cursor:pointer">
          <div class="acc-mask-row-top">
            <div class="acc-mask-name">${esc(dName)}</div>
            <button class="acc-mask-switch-btn ${isCur ? 'is-active' : ''}">
              ${isCur ? '当前使用' : '切换账号 ⇄'}
            </button>
          </div>
          <div class="acc-mask-no">账号：${esc(acc.username || acc.phone || '未设置')}</div>
          <div class="acc-mask-sign">${esc(dSign)}</div>
        </div>
      </div>
    `;
  }).join('');

  openSheet({
    title: '切换账号',
    sub: '每个账号拥有完全独立的联系人、人设与聊天记录',
    body: `
      <div class="acc-mask-list" style="max-height:55vh;overflow-y:auto;padding:2px 0;">
        ${cardsHtml}
      </div>
      <div class="acc-mask-footer-btns">
        <button class="acc-mask-add-btn" id="acc-login-new-btn">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          登录或注册新账号
        </button>
        <button class="acc-mask-add-btn" id="acc-delete-cur-btn" style="color:var(--warn);border-color:rgba(198,83,83,0.3)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          删除当前账号
        </button>
      </div>
    `,
    after(sheet) {
      // 点击整张账号卡片或按钮均可切换账号
      sheet.querySelectorAll('.acc-mask-card[data-accid]').forEach(card => {
        card.onclick = e => {
          const accId = card.dataset.accid;
          if (accId === S.curUid) { closeSheet(); return; }
          const target = S.accounts.find(a => a.id === accId);
          if (target) {
            if (typeof closeChat === 'function') closeChat();
            S.curUid = target.id;
            S.account = target;
            S.openId = null;
            loadAccountData(target.id);
            ensureSeed();
            persist();
            closeSheet();
            renderTab('me');
            toast(`已切换至账号：${target.nickname}`);
          }
        };
      });

      // 注册/登录新账号
      $('#acc-login-new-btn').onclick = () => {
        closeSheet();
        showAuthPage('register');
      };

      // 删除当前账号并清空该号全部聊天记录与人设
      $('#acc-delete-cur-btn').onclick = () => {
        if (S.accounts.length <= 1) {
          toast('当前为唯一账号，无法删除');
          return;
        }

        const curNick = S.account.nickname || S.account.username;
        const confirmed = confirm(
          `【确定删除当前账号吗？】\n\n账号「${curNick}」一旦删除，该账号下的所有聊天记录与人设资料将被同时永久清空，且无法恢复！`
        );
        if (!confirmed) return;

        const delUid = S.curUid;
        try {
          localStorage.removeItem(accK(delUid, 'personas'));
          localStorage.removeItem(accK(delUid, 'chats'));
          localStorage.removeItem(accK(delUid, 'moments'));
          localStorage.removeItem(accK(delUid, 'wallet'));
          localStorage.removeItem(accK(delUid, 'stickers'));
          localStorage.removeItem(accK(delUid, 'miniapps'));
        } catch (e) {}

        const idx = S.accounts.findIndex(a => a.id === delUid);
        if (idx >= 0) S.accounts.splice(idx, 1);

        S.curUid = S.accounts[0].id;
        S.account = S.accounts[0];
        loadAccountData(S.curUid);
        ensureSeed();
        persist();

        closeSheet();
        renderTab('me');
        toast(`账号已彻底删除，已切换至：${S.account.nickname}`);
      };
    }
  });
}


function startApp() {
  $('#boot').classList.add('hidden');
  $('#app').classList.remove('hidden');
  bindTabs();
  renderTab(S.tab);
}

/* ---------------- 标签栏 ---------------- */
function bindTabs() {
  const bar = $('#tabbar');
  if (bar._bound) return;
  bar._bound = true;
  bar.addEventListener('click', e => {
    const b = e.target.closest('.tab');
    if (!b) return;
    renderTab(b.dataset.tab);
  });
}

const TAB_META = {
  chat:     { title: 'Messages', left: 'back',  right: 'plane' },
  contacts: { title: 'Friends',  left: 'blank', right: 'add'  },
  discover: { title: 'Moments',  left: 'blank', right: 'plus' },
  moments:  { title: 'Feed',     left: 'back',  right: 'cam'  },
  me:       { title: 'Profile',  left: 'blank', right: 'more' }
};

function renderTab(tab) {
  S.tab = tab;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.view').forEach(v => v.classList.toggle('hidden', v.dataset.view !== tab));
  const meta = TAB_META[tab] || { title: 'Messages', left: 'back', right: 'plane' };
  const titleEl = $('#hdr-title');
  titleEl.textContent = meta.title;
  // 信笺页启用大号艺术字排版，其他页恢复正常标题
  titleEl.classList.toggle('ins-art', tab === 'chat');
  // 头部按钮
  const L = $('#hdr-left'), R = $('#hdr-right');
  const icon = (id, color) => `<svg ${color ? `style="color:${color}"` : ''}><use href="#${id}"></use></svg>`;
  L.innerHTML = meta.left === 'back' ? icon('i-back') : '';
  L.style.visibility = meta.left === 'back' ? 'visible' : 'hidden';
  const rmap = { plus:'i-plus', add:'i-plus', cam:'i-cam', more:'i-more', plane:'i-send' };
  R.innerHTML = icon(rmap[meta.right] || 'i-more');
  R.onclick = () => headerAction(tab);
  L.onclick = () => headerLeft(tab);

  const host = $(`.view[data-view="${tab}"]`);
  if (tab === 'chat') renderChatList(host);
  if (tab === 'contacts') renderContacts(host);
  if (tab === 'discover') renderDiscover(host);
  if (tab === 'moments') renderMoments(host);
  if (tab === 'me') renderMe(host);
}

function headerLeft(tab) {
  if (tab === 'moments') {
    renderTab('discover');
    return;
  }
  if (tab === 'chat') {
    // 返回小手机桌面（嵌入时）；独立运行时提示
    if (window.parent && window.parent !== window) window.parent.postMessage({ type:'pchat:exit' }, '*');
    else if (history.length > 1) history.back();
    else toast('这是独立运行的山茶信笺');
  }
}
function headerAction(tab) {
  if (tab === 'chat') {
    openSheet({
      title: '开始一段对话',
      items: [
        { icon:'i-search', text:'按微信号找人', act: () => renderTab('contacts') }
      ]
    });
  } else if (tab === 'contacts') {
    renderTab('contacts');
    setTimeout(() => { const inp = $('#ct-wxid-search'); if (inp) inp.focus(); }, 150);
  } else if (tab === 'discover') {
    promptAddMiniApp();
  } else if (tab === 'moments') {
    composeMoment();
  } else {
    openSheet({
      title: '设置',
      items: [
        { icon:'i-gear', text:'外观主题', act: () => openThemeSheet() }
      ]
    });
  }
}

/* ================================================================
   弹层组件
   ================================================================ */
function openSheet(cfg) {
  const wrap = $('#sheet-wrap'), sheet = $('#sheet');
  const items = (cfg.items || []).map((it, i) =>
    `<div class="sheet-item ${it.danger ? 'danger' : ''}" data-i="${i}">
       ${it.icon ? `<svg><use href="#${it.icon}"></use></svg>` : ''}
       <span>${esc(it.text)}</span>
     </div>`).join('');
  sheet.innerHTML = `
    <div class="sheet-grip"></div>
    ${cfg.title ? `<div class="sheet-hd">
        <div class="sheet-t">${esc(cfg.title)}</div>
        ${cfg.sub ? `<div class="sheet-s">${esc(cfg.sub)}</div>` : ''}
      </div>` : ''}
    <div class="sheet-bd">${cfg.body || ''}</div>
    ${items ? `<div>${items}</div>` : ''}
    ${cfg.footer || ''}
  `;
  wrap.classList.remove('hidden');
  sheet.classList.remove('anim'); void sheet.offsetWidth; sheet.classList.add('anim');
  setTimeout(() => sheet.classList.remove('anim'), 360);
  $('#sheet-mask').onclick = closeSheet;
  sheet.querySelectorAll('.sheet-item').forEach(el => {
    el.onclick = () => {
      const it = cfg.items[+el.dataset.i];
      if (it.act) it.act();
      if (!it.keep) closeSheet();
    };
  });
  if (cfg.after) cfg.after(sheet);
}
function closeSheet() { $('#sheet-wrap').classList.add('hidden'); }

/* ---------------- 全屏独立子页面管理（面具、钱包、收藏、聊天设置等完整单开页面） ---------------- */
function openSubpage({ title, rightBtn, bodyHtml, onMount, onBack, bodyCls }) {
  const wrap = $('#subpane-wrap');
  const pane = $('#subpane');
  if (!wrap || !pane) return;

  // 若当前已在子页面上换页（如 设置 → 改名），保留原滚动位置，换页更丝滑
  const wasOpen = !wrap.classList.contains('hidden');
  const prevScroll = wasOpen && $('#subpane-body') ? $('#subpane-body').scrollTop : 0;
  const prevTitle = wasOpen ? (pane.dataset.pageTitle || '') : '';

  // 取消尚未完成的关闭动画，避免刚打开就被隐藏
  if (wrap._closeTimer) { clearTimeout(wrap._closeTimer); wrap._closeTimer = null; }

  pane.innerHTML = `
    <header class="hdr subpage-hdr">
      <button class="hdr-btn" id="subpane-back" title="返回">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <div class="hdr-title">${esc(title || '')}</div>
      <div class="hdr-right" id="subpane-right-slot">${rightBtn || '<div style="width:36px"></div>'}</div>
    </header>
    <main class="subpage-body ${bodyCls || ''}" id="subpane-body">
      ${bodyHtml || ''}
    </main>
  `;
  pane.dataset.pageTitle = title || '';

  wrap.classList.remove('hidden');
  pane.classList.remove('anim', 'anim-out');

  // 同名页面换页时恢复原滚动位置
  if (wasOpen && prevTitle === (title || '')) {
    const bodyEl = $('#subpane-body');
    if (bodyEl) bodyEl.scrollTop = prevScroll;
  }

  $('#subpane-back').onclick = onBack || closeSubpage;
  if (onMount) onMount(pane);
}

function closeSubpage() {
  const wrap = $('#subpane-wrap');
  const pane = $('#subpane');
  if (!wrap || !pane || wrap.classList.contains('hidden') || wrap._closing) return;
  wrap._closing = true;

  // 直接关闭，无任何动画，零延迟呈现
  if (wrap._closeTimer) { clearTimeout(wrap._closeTimer); wrap._closeTimer = null; }
  wrap.classList.add('hidden');
  pane.classList.remove('anim-out');
  pane.innerHTML = '';
  pane.dataset.pageTitle = '';
  wrap._closing = false;
}

/* ================================================================
   一、微信（会话列表）
   ================================================================ */
function lastMsgOf(pid) {
  const list = S.chats[pid] || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m.role === 'them' || m.role === 'me') return m;
  }
  return null;
}
function previewOf(m) {
  if (!m) return '';
  if (m.type === 'sticker') return m.stickerName ? `[表情: ${m.stickerName}]` : '[表情]';
  if (m.type === 'image') return '[图片]';
  if (m.type === 'transfer') return '[转账]';
  return m.text || '';
}

function renderChatList(host) {
  const items = S.personas
    .filter(p => (S.chats[p.id] || []).length > 0)
    .map(p => ({ p, m: lastMsgOf(p.id) }))
    .sort((a, b) => (b.m ? b.m.time : 0) - (a.m ? a.m.time : 0));

  const curMask = getCurrentMask();
  const meAv = (curMask && curMask.avatar) || (S.account && S.account.avatar) || '';
  const meName = (curMask && curMask.name) || (S.account && S.account.nickname) || '我';
  const meLetter = cleanFirstChar(meName);
  const meMood = (S.account && S.account.sign) || '今天也要好好呼吸';

  let html = `
    <!-- INS 风顶部：我的头像 + 今日心语 + 快拍圈圈 -->
    <div class="ins-header">
      <div class="ins-me-block" id="ins-me-block">
        <div class="ins-story-ring me-ring">
          <div class="av lg">${meAv ? `<img src="${meAv}">` : esc(meLetter)}</div>
          <span class="ins-online-dot"></span>
        </div>
        <div class="ins-me-text">
          <div class="ins-me-name">${esc(meName)}</div>
          <div class="ins-me-mood">${esc(meMood)}</div>
        </div>
      </div>
      <div class="ins-stories">
        ${items.map(({ p }) => {
          const d = displayOf(p);
          const letter = cleanFirstChar(d.name);
          return `
          <div class="ins-story-item" data-pid="${p.id}">
            <div class="ins-story-ring">
              <div class="av">${d.avatar ? `<img src="${d.avatar}">` : esc(letter)}</div>
            </div>
            <span class="ins-story-name">${esc(d.name)}</span>
          </div>`;
        }).join('')}
        <div class="ins-story-item" id="ins-add-story">
          <div class="ins-story-ring add-ring">
            <div class="av" style="background:var(--accent-soft);color:var(--accent)">
              <svg style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round"><use href="#i-plus"></use></svg>
            </div>
          </div>
          <span class="ins-story-name">新建</span>
        </div>
      </div>
    </div>

    <!-- 轻盈搜索药丸 -->
    <div class="searchbar">
      <div class="searchbar-in"><svg><use href="#i-search"></use></svg><span>在记忆与来信中寻找…</span></div>
    </div>`;

  if (!items.length) {
    html += `<div class="empty">
      <svg><use href="#i-bubble"></use></svg>
      <p>还没有任何对话<br>去通讯录里找一个人，说第一句话</p>
      <button class="mini-btn" onclick="renderTab('contacts')">去通讯录</button>
    </div>`;
  } else {
    html += `<div class="ins-chat-card">` + items.map(({ p, m }) => {
      const d = displayOf(p);
      const letter = cleanFirstChar(d.name);
      const unread = 0; // 预留：未读数
      return `
      <div class="ins-chat-row" data-pid="${p.id}">
        <div class="ins-av-wrap">
          <div class="av lg">${d.avatar ? `<img src="${d.avatar}">` : esc(letter)}</div>
          <span class="ins-online-dot"></span>
        </div>
        <div class="row-main">
          <div class="row-top">
            <div class="row-name">${esc(d.name)}</div>
            <div class="row-time">${m ? fmtRowTime(m.time) : ''}</div>
          </div>
          <div class="row-sub">${esc(m && m.role === 'me' ? '我：' + previewOf(m) : previewOf(m))}</div>
        </div>
        ${unread > 0 ? `<span class="ins-unread-pill">♡ ${unread}</span>` : ''}
      </div>`;
    }).join('') + `</div>`;
  }
  host.innerHTML = html;

  host.querySelectorAll('.ins-chat-row[data-pid]').forEach(r => {
    r.onclick = () => openChat(r.dataset.pid);
  });
  host.querySelectorAll('.ins-story-item[data-pid]').forEach(r => {
    r.onclick = () => openChat(r.dataset.pid);
  });
  const meBlock = host.querySelector('#ins-me-block');
  if (meBlock) meBlock.onclick = () => renderTab('me');
  const addStory = host.querySelector('#ins-add-story');
  if (addStory) addStory.onclick = () => { closeSubpage(); headerAction('chat'); };
}

/* 显示名：备注 > 昵称 */
function displayOf(p) {
  return { name: p.remark || p.name, avatar: p.avatar, sign: p.sign, wxid: p.wxid };
}

/* ================================================================
   二、通讯录
   ================================================================ */
function renderContacts(host) {
  // 人设馆实时同步：进入通讯录时从磁盘重读人设（人设馆直接写localStorage，绕过内存会互相覆盖）
  if (S.curUid) {
    const fresh = load(accK(S.curUid, 'personas'), null);
    if (Array.isArray(fresh)) {
      S.personas = fresh;
      // 人设馆新增的人设如果还没有聊天会话，补一个空会话避免历史兼容问题
      fresh.forEach(p => { if (!S.chats[p.id]) S.chats[p.id] = []; });
    }
  }
  const list = S.personas;
  let html = `<div class="searchbar">
      <div class="searchbar-in"><svg><use href="#i-search"></use></svg><input id="ct-wxid-search" class="wxid-search-input" placeholder="输入微信号找人…" maxlength="24" autocomplete="off"></div>
    </div>
    <div id="ct-search-result"></div>`;

  html += `<div class="sec-title">联系人 · ${list.length}</div>`;
  html += list.map(p => `
    <div class="row" data-pid="${p.id}">
      ${avatarHtml(displayOf(p))}
      <div class="row-main">
        <div class="row-top"><div class="row-name">${esc(displayOf(p).name)}</div></div>
        <div class="row-sub">${esc(p.sign || p.wxid || '')}</div>
      </div>
    </div>`).join('');

  html += `<div style="height:12px"></div>`;
  host.innerHTML = html;
  host.querySelectorAll('.row[data-pid]').forEach(r => {
    r.onclick = () => openProfile(r.dataset.pid);
  });

  // 微信号搜索：只查找，不创建。命中 → 进对话；未命中 → 提示
  const searchInput = host.querySelector('#ct-wxid-search');
  const resultBox = host.querySelector('#ct-search-result');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) { resultBox.innerHTML = ''; return; }
    const hit = list.find(p => (p.wxid || '').toLowerCase() === q)
      || list.find(p => (p.wxid || '').toLowerCase().includes(q))
      || list.find(p => (displayOf(p).name || '').toLowerCase().includes(q));
    if (hit) {
      const d = displayOf(hit);
      resultBox.innerHTML = `<div class="sec-title" style="margin-top:10px;">找到 TA</div>
        <div class="row" id="ct-search-hit">
          ${avatarHtml(d)}
          <div class="row-main">
            <div class="row-top"><div class="row-name">${esc(d.name)}</div></div>
            <div class="row-sub">微信号：${esc(hit.wxid || '未设置')}</div>
          </div>
        </div>`;
      resultBox.querySelector('#ct-search-hit').onclick = () => {
        searchInput.value = ''; resultBox.innerHTML = '';
        openProfile(hit.id);
      };
    } else {
      resultBox.innerHTML = `<div class="sec-title" style="margin-top:10px;">没有找到</div>
        <div style="font-size:12px;color:var(--text-4);padding:14px 4px;line-height:1.7;">
          没有人用这个微信号。<br>新建人设请回到桌面，打开「人设馆」。
        </div>`;
    }
  });
}

/* ---------------- 人设：添加 / 编辑 ---------------- */
function blankPersona() {
  return {
    id: uid(), name: '', wxid: 'wxid_' + Math.random().toString(36).slice(2, 10),
    avatar: '', sign: '', prompt: '', greeting: '', remark: '',
    model: '', temp: 0.85, createdAt: Date.now()
  };
}

function addPersona() {
  personaEditor(blankPersona(), true);
}

function personaEditor(p, isNew, backFn) {
  const curTemp = (typeof p.temp === 'number') ? p.temp.toFixed(2) : '0.85';
  let av = p.avatar;

  openSubpage({
    title: isNew ? '添加人设' : '编辑人设',
    onBack: backFn || closeSubpage,
    rightBtn: `
      <button class="hdr-btn" id="pe-save" style="color:var(--accent);font-weight:600;font-size:14px;width:auto;padding:0 6px;">
        保存
      </button>
    `,
    bodyHtml: `
      <div style="font-size:12px;color:var(--text-3);margin-bottom:14px;padding:0 2px;">
        写进他的性格与说话方式，模型在桌面设置中心统一配置。
      </div>
      <div style="display:flex;justify-content:center;margin-bottom:18px">
        <div class="avatar-pick" id="pe-av" style="margin:0">
          ${p.avatar ? `<img src="${p.avatar}" alt="">` : `<svg class="ap-ico"><use href="#i-cam"></use></svg><span>头像</span>`}
        </div>
      </div>
      <input type="file" id="pe-av-input" accept="image/*" hidden>
      <div class="field"><div class="field-label">名字</div>
        <input class="field-input" id="pe-name" maxlength="16" value="${esc(p.name)}" placeholder="他叫什么"></div>
      <div class="field"><div class="field-label">备注（显示在列表里的名字，可留空）</div>
        <input class="field-input" id="pe-remark" maxlength="16" value="${esc(p.remark)}" placeholder="例如：阿愿"></div>
      <div class="field"><div class="field-label">微信号</div>
        <input class="field-input" id="pe-wxid" maxlength="24" value="${esc(p.wxid)}"></div>
      <div class="field"><div class="field-label">个性签名</div>
        <input class="field-input" id="pe-sign" maxlength="40" value="${esc(p.sign)}" placeholder="一句话"></div>
      <div class="field"><div class="field-label">人设 · 他是谁（性格 / 身份 / 说话方式）</div>
        <textarea class="field-input" id="pe-prompt" placeholder="越具体越像他。例如：习惯先把别人的情绪安顿好，话不多，但每一句都认真。">${esc(p.prompt)}</textarea></div>
      <div class="field"><div class="field-label">开场白（第一次打开对话时他说的话，可留空）</div>
        <textarea class="field-input" id="pe-greeting" style="min-height:60px" placeholder="留空则什么都不说，等你先开口">${esc(p.greeting)}</textarea></div>
      <div class="field"><div class="field-label">拍一拍自定义文案后缀</div>
        <input class="field-input" id="pe-pokesuffix" maxlength="30" value="${esc(p.pokeSuffix || '')}" placeholder="例如：的小脑袋 / 的手心"></div>

      <!-- 时间感知开关：开启后模型能感知当前真实时间与季节 -->
      <div class="field" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div style="flex:1;min-width:0;">
          <div class="field-label" style="margin-bottom:2px;">时间感知</div>
          <div style="font-size:11px;color:var(--text-4);line-height:1.4;">开启后 TA 知道现在几点、什么季节，能说出"凌晨了早点睡"这类话</div>
        </div>
        <button type="button" class="tg-switch ${p.timeAware === false ? '' : 'on'}" id="pe-timeaware" aria-label="时间感知开关">
          <span class="tg-knob"></span>
        </button>
      </div>
      
      <!-- 温度调整：平滑滑动条 (0 - 2) -->
      <div class="field">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;padding:0 3px;">
          <div class="field-label" style="margin-bottom:0">温度 · 发散程度</div>
          <div id="pe-temp-val" style="font-size:13px;font-weight:600;color:var(--accent);">${curTemp}</div>
        </div>
        <div class="range-wrap">
          <input type="range" class="temp-slider" id="pe-temp-slider" min="0" max="2" step="0.05" value="${curTemp}">
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--text-4);margin-top:4px;padding:0 2px;">
          <span>严谨稳重 (0.0)</span>
          <span>自然日常 (0.85)</span>
          <span>天马行空 (2.0)</span>
        </div>
      </div>

      ${isNew ? '' : '<button class="btn-ghost" id="pe-del" style="color:var(--warn);border-color:rgba(196,115,92,.3);margin-top:12px;">删除这个人</button>'}
      <div style="height:24px;"></div>
    `,
    onMount() {
      $('#pe-av').onclick = () => $('#pe-av-input').click();
      $('#pe-av-input').onchange = e => {
        const f = e.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => { av = r.result; $('#pe-av').innerHTML = `<img src="${r.result}" alt="">`; };
        r.readAsDataURL(f);
      };

      const slider = $('#pe-temp-slider');
      const valEl  = $('#pe-temp-val');
      if (slider && valEl) {
        slider.oninput = () => { valEl.textContent = parseFloat(slider.value).toFixed(2); };
      }

      // 时间感知开关切换
      const taBtn = $('#pe-timeaware');
      if (taBtn) {
        taBtn.onclick = () => taBtn.classList.toggle('on');
      }

      $('#pe-save').onclick = () => {
        const name = $('#pe-name').value.trim();
        if (!name) { toast('总得有个名字'); return; }
        p.name = name;
        p.remark = $('#pe-remark').value.trim();
        p.wxid = $('#pe-wxid').value.trim() || p.wxid;
        p.sign = $('#pe-sign').value.trim();
        p.prompt = $('#pe-prompt').value.trim();
        p.greeting = $('#pe-greeting').value.trim();
        p.pokeSuffix = $('#pe-pokesuffix').value.trim();
        const taBtn = $('#pe-timeaware');
        p.timeAware = taBtn ? taBtn.classList.contains('on') : true;
        const t = parseFloat(slider ? slider.value : p.temp);
        p.temp = isNaN(t) ? 0.85 : Math.min(2, Math.max(0, t));
        p.avatar = av;
        delete p.seeded;
        delete p.model;
        if (isNew) S.personas.push(p);
        savePersonas(); persist();
        // 同步更新聊天顶栏胶囊与头像
        const pillEl = $('#cp-name-pill');
        if (pillEl && S.openId === p.id) pillEl.textContent = displayOf(p).name;
        const topAvEl = $('#chat-top-av-them');
        if (topAvEl && S.openId === p.id) {
          topAvEl.innerHTML = p.avatar ? `<img src="${p.avatar}">` : `<div class="chat-big-av-fallback">${esc(cleanFirstChar(p.name))}</div>`;
        }
        if (backFn) {
          backFn();
        } else {
          closeSubpage();
        }
        renderTab(S.tab);
        if (S.openId === p.id) renderThread(false);
        toast(isNew ? '已经加进来了 ♡' : '保存好了 ♡');
      };
      const del = $('#pe-del');
      if (del) del.onclick = () => {
        if (!confirm('确定删除这个人设及其对话记录吗？')) return;
        S.personas = S.personas.filter(x => x.id !== p.id);
        delete S.chats[p.id];
        savePersonas(); saveChats(); persist();
        closeSubpage();
        if (S.openId === p.id) closeChat();
        renderTab(S.tab);
        toast('已删除');
      };
    }
  });
}

/* ---------------- 邮票名片页（三款可切换卡片：邮票 / 小册 / 月光卡） ---------------- */
const CARD_STYLES = ['stamp', 'booklet', 'glow'];

function getCardStyle(pid) {
  S.prefs.cardStyles = S.prefs.cardStyles || {};
  return S.prefs.cardStyles[pid] || 'stamp';
}
function setCardStyle(pid, style) {
  S.prefs.cardStyles = S.prefs.cardStyles || {};
  S.prefs.cardStyles[pid] = style;
  persist();
}

function cardStyleName(s) {
  return { stamp: '复古邮票', booklet: '人物小册', glow: '月光卡' }[s] || '复古邮票';
}

/* ---------------- 卡片编辑器（仅卡片展示字段：签名 / 性格 / 喜好 / 心语） ---------------- */
function cardEditor(p, backFn) {
  openSubpage({
    title: '编辑卡片',
    onBack: backFn || closeSubpage,
    rightBtn: `
      <button class="hdr-btn" id="ce-save" style="color:var(--accent);font-weight:600;font-size:14px;width:auto;padding:0 6px;">
        保存
      </button>
    `,
    bodyHtml: `
      <div style="font-size:12px;color:var(--text-3);margin-bottom:14px;padding:0 2px;">
        这里只编辑名片上展示的内容——TA 在卡片上如何自我介绍。性格设定与说话方式请到「编辑人设」里调整。
      </div>
      <div class="field"><div class="field-label">个性签名（卡片上的一句话）</div>
        <input class="field-input" id="ce-sign" maxlength="40" value="${esc(p.sign || '')}" placeholder="一句话介绍 TA"></div>
      <div class="field"><div class="field-label">性格（名片上的性格标签）</div>
        <input class="field-input" id="ce-personality" maxlength="30" value="${esc(p.personality || '')}" placeholder="例如：温柔 / 慢热 / 有点傲娇"></div>
      <div class="field"><div class="field-label">喜好（TA 喜欢什么）</div>
        <input class="field-input" id="ce-likes" maxlength="40" value="${esc(p.likes || '')}" placeholder="例如：拿铁 · 老歌 · 下雨天"></div>
      <div class="field"><div class="field-label">背景心语（聊天页背景上的那句话）</div>
        <input class="field-input" id="ce-korean" maxlength="40" value="${esc(p.koreanQuote || '')}" placeholder="例如：너와 함께 ...! 🤍"></div>
    `,
    onMount() {
      $('#ce-save').onclick = () => {
        p.sign = $('#ce-sign').value.trim();
        p.personality = $('#ce-personality').value.trim();
        p.likes = $('#ce-likes').value.trim();
        p.koreanQuote = $('#ce-korean').value.trim();
        savePersonas(); persist();
        if (backFn) backFn(); else closeSubpage();
        toast('卡片已更新 ♡');
      };
    }
  });
}

function renderCardHTML(style, p, d, rows) {
  const avatarHTML = p.avatar
    ? `<img src="${p.avatar}">`
    : `<div class="stamp-avatar-fallback">${esc(cleanFirstChar(p.name))}</div>`;
  const emptyHint = '<div style="font-size:12px;color:var(--text-4);text-align:center;padding:10px 0;">这张卡片还空着，去「编辑卡片」写下 TA 的故事吧</div>';

  if (style === 'booklet') {
    const tags = [
      p.remark ? '备注 · ' + p.remark : '',
      p.wxid ? p.wxid : '',
      p.likes ? '♡ ' + p.likes : '',
      p.personality ? '✦ ' + p.personality : ''
    ].filter(Boolean);
    return `
      <div class="booklet-card">
        <div class="booklet-head">
          <div class="booklet-avatar">${avatarHTML}</div>
          <div class="booklet-name-block">
            <div class="booklet-cname">${esc(d.name)}</div>
            <div class="booklet-sub">PERSONAL BOOKLET · 山茶信笺</div>
          </div>
        </div>
        ${tags.length ? `<div class="booklet-tags">${tags.map(t => `<span class="booklet-tag">${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="booklet-divider"></div>
        <div class="booklet-body">
          ${p.sign ? `<div class="booklet-quote">「${esc(p.sign)}」</div>` : ''}
          ${p.prompt ? `<div class="booklet-desc">${esc(p.prompt)}</div>` : ''}
          ${(!p.sign && !p.prompt) ? emptyHint : ''}
        </div>
        <div class="booklet-footer">— TA 的专属小册 —</div>
      </div>`;
  }

  if (style === 'glow') {
    return `
      <div class="glow-card">
        <div class="glow-avatar">${avatarHTML}</div>
        <div class="glow-cname">${esc(d.name)}</div>
        <div class="glow-sub">${esc(d.sign || '山茶信笺 · CAMELLIA')}</div>
        <div class="glow-divider">✦ ✦ ✦</div>
        <div class="glow-body">
          ${rows}
          ${!rows ? emptyHint : ''}
        </div>
        <div class="glow-footer">— 月光下也认识 TA —</div>
      </div>`;
  }

  return `
    <div class="stamp-card">
      <div class="stamp-head">
        <div class="stamp-avatar">${avatarHTML}</div>
        <div class="stamp-name-block">
          <div class="stamp-cname">${esc(d.name)}</div>
          <div class="stamp-ename">CAMELLIA · PERSONA STAMP</div>
        </div>
        <div class="stamp-postmark">
          <span>山茶信笺</span>
          <span>${new Date(p.createdAt || Date.now()).toLocaleDateString('zh-CN')}</span>
        </div>
      </div>
      <div class="stamp-divider"></div>
      <div class="stamp-body">
        ${rows || emptyHint}
      </div>
      <div class="stamp-footer">— 一枚关于 TA 的邮票 —</div>
    </div>`;
}

function openProfile(pid, backFn) {
  const p = S.personas.find(x => x.id === pid);
  if (!p) return;
  const d = displayOf(p);

  // 人物介绍信息（去掉温度与拍一拍，新增喜好 / 性格）
  const infoRows = [
    ['微信号', p.wxid || '未设置'],
    p.remark ? ['备注', p.remark] : null,
    p.sign ? ['个性签名', p.sign] : null,
    p.koreanQuote ? ['背景心语', p.koreanQuote] : null,
    p.likes ? ['喜好', p.likes] : null,
    p.personality ? ['性格', p.personality] : null
  ].filter(Boolean);

  let rows = '';
  infoRows.forEach(([k, v]) => rows += `
    <div class="stamp-info-row">
      <span class="stamp-info-key">${esc(k)}</span>
      <span class="stamp-info-val">${esc(v)}</span>
    </div>
  `);
  if (p.prompt) rows += `
    <div class="stamp-info-row stamp-info-block">
      <span class="stamp-info-key">人设</span>
      <span class="stamp-info-val stamp-pre">${esc(p.prompt)}</span>
    </div>
  `;

  const style = getCardStyle(pid);
  const dots = CARD_STYLES.map(s =>
    `<button class="card-style-dot ${s === style ? 'active' : ''}" data-style="${s}" title="${cardStyleName(s)}"></button>`
  ).join('');

  openSubpage({
    title: '邮票名片',
    onBack: backFn || closeSubpage,
    bodyHtml: `
      <div id="pf-card-mount">${renderCardHTML(style, p, d, rows)}</div>

      <!-- 卡片款式切换圆点 -->
      <div class="card-style-picker">
        ${dots}
        <span class="card-style-name" id="pf-style-name">${cardStyleName(style)}</span>
      </div>

      <div style="display:flex;gap:10px;margin-top:12px;">
        <button class="wal-act" id="pf-chat" style="flex:1;">发消息</button>
        <button class="wal-act" id="pf-edit" style="flex:1;">编辑卡片</button>
      </div>
    `,
    onMount() {
      $('#pf-chat').onclick = () => { closeSubpage(); openChat(pid); };
      $('#pf-edit').onclick = () => { cardEditor(p, () => openProfile(pid, backFn)); };

      // 款式切换
      document.querySelectorAll('.card-style-dot').forEach(btn => {
        btn.onclick = () => {
          const s = btn.dataset.style;
          setCardStyle(pid, s);
          document.querySelectorAll('.card-style-dot').forEach(b => b.classList.toggle('active', b === btn));
          $('#pf-style-name').textContent = cardStyleName(s);
          $('#pf-card-mount').innerHTML = renderCardHTML(s, p, d, rows);
        };
      });
    }
  });
}

/* ---------------- 世界书绑定（只读桌面灵魂秘卷数据 + 局部绑定选择） ----------------
   桌面（海盐白山茶）灵魂秘卷的存储：
   - sea_salt_wb_global    全局世界书条目（自动绑定所有对话，只读）
   - sea_salt_wb_character 局部世界书条目池（按人设选择绑定）
   p.worldbookIds 存【局部条目的 title 列表】（桌面端条目以 title 唯一标识）
---------------------------------------------------------------- */
function getDesktopGlobalWB() {
  try { return JSON.parse(localStorage.getItem('sea_salt_wb_global')) || []; } catch (e) { return []; }
}
function getDesktopLocalWB() {
  try { return JSON.parse(localStorage.getItem('sea_salt_wb_character')) || []; } catch (e) { return []; }
}
function getBoundLocalTitles(p) { return p.worldbookIds || []; }
function saveBoundLocalTitles(p, arr) { p.worldbookIds = arr; savePersonas(); persist(); }

function wbCountLabel(p) {
  const g = getDesktopGlobalWB().length;
  const bound = getDesktopLocalWB().filter(e => getBoundLocalTitles(p).includes(e.title)).length;
  const all = getDesktopLocalWB().length;
  return `全局${g} · 绑定${bound}/${all}`;
}

/* 收集某个人设当前生效的世界书条目（桌面数据：全局全带 + 局部按绑定标题） */
function collectWorldbookEntries(p, recentText) {
  const out = [];
  const push = (entry) => {
    const kw = (entry.keyword || '').trim();
    const content = (entry.content || '').trim();
    if (!content) return;
    // 无关键词视为常驻；有关键词则命中最近对话才注入
    const hit = !kw || recentText.includes(kw);
    if (hit) out.push({ bookName: kw ? kw : '常驻', content });
  };
  getDesktopGlobalWB().forEach(push);
  const bound = getBoundLocalTitles(p);
  getDesktopLocalWB().forEach(e => { if (bound.includes(e.title)) push(e); });
  return out;
}

/* 世界书绑定页（只读展示 + 局部条目勾选，一次性保存绑定） */
function openWorldbookPage(p, backFn) {
  const backTo = backFn || (() => openChatSettingsPage(p));
  const globalList = getDesktopGlobalWB();
  const localList = getDesktopLocalWB();
  const boundInit = getBoundLocalTitles(p);
  let pendingBound = boundInit.slice();   // 勾选暂存，点保存才生效

  const rowHTML = (e, selectable, checked) => `
    <div class="profile-menu-item wb-item" style="cursor:default;">
      <div class="profile-menu-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19V5a2 2 0 0 1 2-2h13.5v16H6a2 2 0 0 0-2 2Z"/><path d="M4 19a2 2 0 0 0 2 2h13.5"/></svg>
      </div>
      <div class="profile-menu-label" style="flex-direction:column;align-items:flex-start;gap:2px;display:flex;min-width:0;">
        <span style="width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(e.title || '未命名条目')}</span>
        <span style="font-size:10.5px;color:var(--text-4);width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc((e.content || '').slice(0, 40) || '暂无内容')}</span>
      </div>
      ${selectable
        ? `<button type="button" class="tg-switch ${checked ? 'on' : ''} wb-bind-switch" data-title="${esc(e.title)}" aria-label="绑定开关"><span class="tg-knob"></span></button>`
        : `<span style="font-size:11px;color:var(--accent-2);font-weight:600;flex-shrink:0;">自动绑定</span>`}
    </div>`;

  openSubpage({
    title: '世界书',
    onBack: backTo,
    bodyHtml: `
      <div style="font-size:12px;color:var(--text-3);margin-bottom:14px;padding:0 2px;line-height:1.6;">
        世界书数据来自桌面<b>「灵魂秘卷」</b>：全局条目对 ${esc(displayOf(p).name)} 自动生效；局部条目在这里勾选绑定。<br>添加与编辑请在桌面的灵魂秘卷里完成，这边只做绑定。
      </div>

      <div class="sec-title" style="padding-left:2px;">全局世界书（自动绑定 · 只读）</div>
      <div class="profile-menu-card" style="margin:0 0 14px 0;">
        ${globalList.length ? globalList.map(e => rowHTML(e, false, false)).join('')
          : '<div style="font-size:12px;color:var(--text-4);text-align:center;padding:16px 0;">桌面灵魂秘卷里还没有全局条目</div>'}
      </div>

      <div class="sec-title" style="padding-left:2px;">局部世界书（勾选绑给 TA · 一次性保存）</div>
      <div class="profile-menu-card" style="margin:0;">
        ${localList.length ? localList.map(e => rowHTML(e, true, pendingBound.includes(e.title))).join('')
          : '<div style="font-size:12px;color:var(--text-4);text-align:center;padding:16px 0;">桌面灵魂秘卷里还没有局部条目</div>'}
      </div>

      <div style="height:16px;"></div>
      <button class="btn-main" id="wb-save-bind" style="width:100%;">保存绑定</button>
      <div style="height:12px;"></div>
    `,
    onMount() {
      // 勾选只改暂存
      document.querySelectorAll('.wb-bind-switch').forEach(sw => {
        sw.onclick = (e) => {
          e.stopPropagation();
          const t = sw.dataset.title;
          sw.classList.toggle('on');
          const idx = pendingBound.indexOf(t);
          if (idx >= 0) pendingBound.splice(idx, 1); else pendingBound.push(t);
        };
      });
      // 一次性保存
      $('#wb-save-bind').onclick = () => {
        saveBoundLocalTitles(p, pendingBound);
        $('#cs-wb-count') && ($('#cs-wb-count').textContent = wbCountLabel(p));
        toast(`绑定已保存：局部 ${pendingBound.length} 条生效 ♡`);
      };
    }
  });
}

/* ---------------- 主题 ---------------- */
function openThemeSheet() {
  openSheet({
    title: '外观',
    items: [
      { icon:'i-moments', text:'月白（默认）', act: () => setTheme('moon') },
      { icon:'i-moments', text:'星夜（深色）', act: () => setTheme('midnight') }
    ]
  });
}
function setTheme(t) {
  S.prefs.theme = t; persist(); applyTheme();
  toast(t === 'moon' ? '已切换为月白' : '已切换为星夜');
}

/* ================================================================



/* ================================================================
   三、聊天详情与互动引擎
   ================================================================ */
let currentQuoteMsg = null;
let isSelectMode = false;
let selectedMsgIds = new Set();
let paneEl = null;


/* 快捷修改拍一拍文案（单开独立全屏页面：TA 的 + 自己的） */
function editPokeSuffixSheet(p, backFn) {
  const curThem = p.pokeSuffix || '的小脸蛋并递上一杯温水';
  const curMask = getCurrentMask();
  const curMe = (curMask && curMask.pokeSuffix) || (S.account && S.account.pokeSuffix) || '';
  openSubpage({
    title: '设置拍一拍',
    onBack: backFn || closeSubpage,
    rightBtn: `
      <button class="hdr-btn" id="ps-save-btn" style="color:var(--accent);font-weight:600;font-size:14px;width:auto;padding:0 6px;">
        保存
      </button>
    `,
    bodyHtml: `
      <div style="font-size:12px;color:var(--text-3);margin-bottom:14px;padding:0 2px;">
        双击头像拍一拍时显示，例如填「的小脸蛋并递上一杯温水」→ 你 拍了拍 ${esc(displayOf(p).name)} 的小脸蛋...
      </div>
      <div class="field">
        <div class="field-label">拍 ${esc(displayOf(p).name)} 时</div>
        <input class="field-input" id="ps-suffix-input" maxlength="28" value="${esc(curThem)}" placeholder="例如：的小脸蛋、的小脑瓜">
      </div>
      <div class="field">
        <div class="field-label">拍自己时（留空则用默认）</div>
        <input class="field-input" id="ps-me-input" maxlength="28" value="${esc(curMe)}" placeholder="例如：的小脑袋并轻轻叹了口气">
      </div>
    `,
    onMount() {
      $('#ps-save-btn').onclick = () => {
        p.pokeSuffix = $('#ps-suffix-input').value.trim() || '的小脸蛋并递上一杯温水';
        const meVal = $('#ps-me-input').value.trim();
        // 自己的拍一拍存在当前面具上（跟随身份），没有面具则存账号
        if (curMask) curMask.pokeSuffix = meVal;
        else if (S.account) S.account.pokeSuffix = meVal;
        savePersonas(); persist();
        if (backFn) backFn(); else closeSubpage();
        toast('拍一拍文案已保存 ♡');
      };
    }
  });
}

/* 快捷修改背景韩文心语（单开独立全屏页面） */
function editKoreanQuoteSheet(p, backFn) {
  const cur = p.koreanQuote || '너와 함께 ...! 🤍🤍';
  openSubpage({
    title: '修改背景心语',
    onBack: backFn || closeSubpage,
    rightBtn: `
      <button class="hdr-btn" id="kq-save-btn" style="color:var(--accent);font-weight:600;font-size:14px;width:auto;padding:0 6px;">
        保存
      </button>
    `,
    bodyHtml: `
      <div style="font-size:12px;color:var(--text-3);margin-bottom:14px;padding:0 2px;">
        显示在聊天顶部大背景图左下角的浪漫心语词条
      </div>
      <div class="field">
        <div class="field-label">心语文案</div>
        <input class="field-input" id="kq-quote-input" maxlength="32" value="${esc(cur)}" placeholder="例如：너와 함께 ...! 🤍🤍">
      </div>
    `,
    onMount() {
      $('#kq-save-btn').onclick = () => {
        p.koreanQuote = $('#kq-quote-input').value.trim() || '너와 함께 ...! 🤍🤍';
        savePersonas(); persist();
        const korBtn = $('#chat-hero-korean-btn');
        if (korBtn) korBtn.textContent = p.koreanQuote;
        if (backFn) backFn(); else closeSubpage();
        toast('背景心语已更新 ♡');
      };
    }
  });
}

/* 聊天右上角三个点：单开独立全屏设置页（告别下半栏弹窗） */
function openChatSettingsPage(p) {
  const d = displayOf(p);
  const curMask = getCurrentMask();
  const myName = (curMask && curMask.name) || (S.account && S.account.nickname) || '我';
  const myAv = (curMask && curMask.avatar) || (S.account && S.account.avatar) || '';

  openSubpage({
    title: d.name || '聊天设置',
    bodyHtml: `
      <!-- 顶部双人头像重叠版角色卡片（独立居中布局，绝不被聊天顶栏样式覆盖） -->
      <div class="acc-mask-card cs-duo-card" id="cs-profile-card" style="cursor:pointer;margin-bottom:14px;flex-direction:column;align-items:center;padding:18px 14px 14px;">
        <div class="cs-duo-avatars duo-deco" style="position:relative;margin-bottom:10px;">
          <div class="chat-big-av" style="width:62px;height:62px;">
            ${p.avatar ? `<img src="${p.avatar}">` : `<div class="chat-big-av-fallback">${esc(cleanFirstChar(p.name))}</div>`}
          </div>
          <div class="chat-big-av" style="width:62px;height:62px;">
            ${myAv ? `<img src="${myAv}">` : `<div class="chat-big-av-fallback">${esc(cleanFirstChar(myName))}</div>`}
          </div>
          <div class="duo-heart-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21s-7.5-4.6-9.6-9.2C.7 8.3 2.6 4.5 6.4 4.5c2.2 0 3.9 1.2 5.6 3.4 1.7-2.2 3.4-3.4 5.6-3.4 3.8 0 5.7 3.8 4 7.3C19.5 16.4 12 21 12 21z"/></svg>
          </div>
          <div class="duo-petals" aria-hidden="true">
            <span class="duo-petal d1">❀</span>
            <span class="duo-petal d2">❀</span>
            <span class="duo-petal d3">❀</span>
            <span class="duo-star s1">✦</span>
            <span class="duo-star s2">✦</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;justify-content:center;">
          <span style="font-size:16px;font-weight:700;color:var(--text);">${esc(d.name)}</span>
          <span style="font-size:12px;color:var(--accent);">♡</span>
          <span style="font-size:16px;font-weight:700;color:var(--text);">${esc(myName)}</span>
        </div>
        <div style="font-size:11px;color:var(--text-4);margin-top:4px;">点此查看 TA 的邮票名片</div>
      </div>

      <!-- 视觉与互动定制组 -->
      <div class="profile-menu-card" style="margin:0 0 14px 0;">
        <div class="profile-menu-item" id="cs-change-bg">
          <div class="profile-menu-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.4" y="4.6" width="17.2" height="14.8" rx="3"/><circle cx="8.9" cy="9.9" r="1.5"/><path d="M4.2 16.4l4.3-3.9 3.1 2.6 3.4-3.4 4.7 4.5"/></svg>
          </div>
          <div class="profile-menu-label">更换顶部背景图</div>
          <div class="profile-menu-extra">${p.topBg ? '已自定义' : '默认山茶'}</div>
          <div class="profile-menu-arrow">›</div>
        </div>

        ${p.topBg ? `
        <div class="profile-menu-item" id="cs-reset-bg">
          <div class="profile-menu-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
          </div>
          <div class="profile-menu-label">恢复默认背景图</div>
          <div class="profile-menu-arrow">›</div>
        </div>
        ` : ''}

        <div class="profile-menu-item" id="cs-edit-korean">
          <div class="profile-menu-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 11.8c0 4-3.6 7.2-8 7.2-1 0-2-.16-2.9-.45L5 20.2l1.2-3.3A6.9 6.9 0 0 1 4 11.8C4 7.8 7.6 4.6 12 4.6s8 3.2 8 7.2Z"/></svg>
          </div>
          <div class="profile-menu-label">修改背景韩文心语</div>
          <div class="profile-menu-extra" style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.koreanQuote || '너와 함께 ...! 🤍🤍')}</div>
          <div class="profile-menu-arrow">›</div>
        </div>

      </div>

      <!-- 人设资料组 -->
      <div class="profile-menu-card" style="margin:0 0 14px 0;">
        <div class="profile-menu-item" id="cs-timeaware">
          <div class="profile-menu-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.4"/><path d="M12 7.6v4.4l3 1.8"/></svg>
          </div>
          <div class="profile-menu-label">时间感知</div>
          <div class="profile-menu-extra" id="cs-ta-state">${p.timeAware === false ? '关闭' : '开启'}</div>
          <button type="button" class="tg-switch ${p.timeAware === false ? '' : 'on'}" id="cs-ta-switch" aria-label="时间感知开关">
            <span class="tg-knob"></span>
          </button>
        </div>

        <div class="profile-menu-item" id="cs-worldbook">
          <div class="profile-menu-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.4"/><path d="M4 12h16M12 3.6c2.4 2.3 3.6 5.1 3.6 8.4s-1.2 6.1-3.6 8.4c-2.4-2.3-3.6-5.1-3.6-8.4s1.2-6.1 3.6-8.4Z"/></svg>
          </div>
          <div class="profile-menu-label">世界书</div>
          <div class="profile-menu-extra" id="cs-wb-count">${wbCountLabel(p)}</div>
          <div class="profile-menu-arrow">›</div>
        </div>

        <div class="profile-menu-item" id="cs-view-card">
          <div class="profile-menu-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="6" width="16" height="12.5" rx="2.4"/><rect x="8.2" y="9.4" width="7.6" height="5.8" rx="1.2"/><circle cx="12" cy="12.3" r="0.7" fill="currentColor" stroke="none"/></svg>
          </div>
          <div class="profile-menu-label">查看邮票名片</div>
          <div class="profile-menu-arrow">›</div>
        </div>

        <div class="profile-menu-item" id="cs-edit-poke2">
          <div class="profile-menu-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 19.6S4.4 15.3 4.4 10.2A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.6 2.6c0 5.1-7.6 9.4-7.6 9.4Z"/></svg>
          </div>
          <div class="profile-menu-label">设置拍一拍</div>
          <div class="profile-menu-extra" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">TA：${esc(p.pokeSuffix || '的小脸蛋...')}</div>
          <div class="profile-menu-arrow">›</div>
        </div>
      </div>

      <!-- 危险操作组 -->
      <div class="profile-menu-card" style="margin:0;">
        <div class="profile-menu-item" id="cs-clear-chat">
          <div class="profile-menu-icon" style="color:var(--warn);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </div>
          <div class="profile-menu-label" style="color:var(--warn);">清空全部对话</div>
          <div class="profile-menu-arrow">›</div>
        </div>
      </div>
    `,
    onMount() {
      const backToThis = () => openChatSettingsPage(p);
      $('#cs-profile-card').onclick = () => openProfile(p.id, backToThis);
      $('#cs-view-card').onclick = () => openProfile(p.id, backToThis);
      $('#cs-edit-poke2').onclick = () => editPokeSuffixSheet(p, backToThis);

      // 时间感知开关（与编辑完整人设里的开关共用同一状态）
      const taSwitch = $('#cs-ta-switch');
      if (taSwitch) {
        taSwitch.onclick = (e) => {
          e.stopPropagation();
          taSwitch.classList.toggle('on');
          p.timeAware = taSwitch.classList.contains('on');
          savePersonas(); persist();
          const stateEl = $('#cs-ta-state');
          if (stateEl) stateEl.textContent = p.timeAware ? '开启' : '关闭';
          toast(p.timeAware ? '时间感知已开启，TA 知道现在几点了' : '时间感知已关闭');
        };
      }
      $('#cs-edit-korean').onclick = () => editKoreanQuoteSheet(p, backToThis);
      $('#cs-worldbook').onclick = () => openWorldbookPage(p, backToThis);

      $('#cs-change-bg').onclick = () => {
        closeSubpage();
        const bgInput = $('#cp-top-bg-input');
        if (bgInput) bgInput.click();
      };

      const resetBg = $('#cs-reset-bg');
      if (resetBg) {
        resetBg.onclick = () => {
          delete p.topBg; savePersonas(); persist();
          const heroCard = $('#chat-hero-bg-card');
          if (heroCard) heroCard.style.backgroundImage = `url("camellia_cover.svg")`;
          openChatSettingsPage(p);
          toast('已恢复默认背景');
        };
      }

      $('#cs-clear-chat').onclick = () => {
        if (confirm('确定清空该角色的所有对话记录吗？')) {
          S.chats[p.id] = [];
          saveChats();
          renderThread();
          renderTab('chat');
          closeSubpage();
          toast('对话记录已清空');
        }
      };
    }
  });
}

/* 快捷修改人设名片下方台词 */
function editPersonaSignSheet(p) {
  const cur = (p.sign || '').trim() || '请继续成为我生命中不可或缺的存在';
  openSheet({
    title: '修改专属台词',
    sub: '显示在名片姓名下方的浪漫誓言与台词',
    body: `
      <div class="field">
        <div class="field-label">专属台词文案</div>
        <input class="field-input" id="ps-sign-input" maxlength="48" value="${esc(cur)}" placeholder="例如：请继续成为我生命中不可或缺的存在">
      </div>
    `,
    footer: `
      <div style="padding:10px 20px 4px">
        <button class="btn-main" id="ps-sign-save-btn">保存台词</button>
      </div>
    `,
    after() {
      $('#ps-sign-save-btn').onclick = () => {
        p.sign = $('#ps-sign-input').value.trim() || '请继续成为我生命中不可或缺的存在';
        savePersonas(); persist();
        closeSheet();
        renderThread();
        toast('台词已更新 ♡');
      };
    }
  });
}

function openChat(pid) {
  const p = S.personas.find(x => x.id === pid);
  if (!p) return;
  S.openId = pid;
  if (!S.chats[pid]) S.chats[pid] = [];

  const wrap = $('#pane-wrap');
  const pane = $('#pane');
  const me = S.account;
  const curMask = getCurrentMask();
  const myDisplay = {
    avatar: (curMask && curMask.avatar) || me.avatar,
    name: (curMask && curMask.name) || me.nickname
  };

  currentQuoteMsg = null;
  isSelectMode = false;
  selectedMsgIds.clear();

  const bgUrl = p.topBg || 'camellia_cover.svg';
  const koreanText = p.koreanQuote || '너와 함께 ...! 🤍🤍';
  const themLetter = cleanFirstChar(p.name);
  const meLetter = cleanFirstChar(myDisplay.name);

  // 将背景图、心电图与双大圆头像固定置顶，绝不跟随聊天记录向上滚动截断
  // 面板底色同步铺上背景图：顶栏圆角外露出的角落在白色纸后面透出背景，不再是白色直角
  pane.style.background = `#1F2733 url('${bgUrl}') center top / cover no-repeat`;
  pane.innerHTML = `
    <!-- 固定置顶区域：顶部圆角邮票孔背景、心电图、双头像悬浮重叠与左侧胶囊名字 -->
    <div class="chat-pinned-top" id="cp-pinned-top">
      <!-- 极简悬浮顶栏：左侧返回 + 同款人设名字胶囊，右侧更多设置 -->
      <div class="chat-ins-nav-bar">
        <div class="chat-ins-nav-left">
          <button class="chat-ins-nav-btn" id="cp-back" title="返回">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div class="chat-ins-name-pill" id="cp-name-pill" title="点击编辑人设">${esc(displayOf(p).name)}</div>
        </div>
        <div class="chat-ins-nav-right">
          <button class="chat-ins-nav-btn" id="cp-more" title="更多设置">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
          </button>
        </div>
        <input type="file" id="cp-top-bg-input" accept="image/*" hidden>
      </div>

      <!-- 顶部邮票质感圆角大背景图（底边向下延伸盖过心电图与双头像腰线） -->
      <div class="chat-hero-banner" id="chat-hero-bg-card" style="background-image:url('${bgUrl}')" title="轻点更换背景图">
        <div class="chat-hero-korean-text" id="chat-hero-korean-btn" title="轻点修改心语">
          ${esc(koreanText)}
        </div>

        <!-- 完全显示在背景图上方、穿过双头像背后的心电图脉冲线条 -->
        <div class="chat-ecg-track">
          <svg class="chat-ecg-svg" viewBox="0 0 320 40" fill="none">
            <path d="M0 20 H30 Q36 20 38 18 Q40 16 42 20 H48 L51 17 L55 33 L62 4 L68 28 L72 17 L76 20 H82 Q88 20 92 14 Q96 20 102 20 H218 Q224 20 228 14 Q232 20 238 20 H244 L248 17 L252 28 L258 4 L265 33 L269 17 L272 20 H278 Q280 16 282 18 Q284 20 290 20 H320" stroke="rgba(165, 205, 240, 0.45)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M0 20 H30 Q36 20 38 18 Q40 16 42 20 H48 L51 17 L55 33 L62 4 L68 28 L72 17 L76 20 H82 Q88 20 92 14 Q96 20 102 20 H218 Q224 20 228 14 Q232 20 238 20 H244 L248 17 L252 28 L258 4 L265 33 L269 17 L272 20 H278 Q280 16 282 18 Q284 20 290 20 H320" stroke="#9FC7EB" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>
    </div>

    <!-- 悬挂在背景图与圆角白卡交界边缘的双圆大头像 (移出 pinned-top 成为 pane 直接子元素) -->
    <div class="chat-hero-avatars">
      <div class="chat-big-av" id="chat-top-av-them" title="单击查看未言心声">
        ${p.avatar ? `<img src="${p.avatar}">` : `<div class="chat-big-av-fallback">${esc(themLetter)}</div>`}
      </div>
      <div class="chat-big-av" id="chat-top-av-me" title="${esc(myDisplay.name)}">
        ${myDisplay.avatar ? `<img src="${myDisplay.avatar}">` : `<div class="chat-big-av-fallback">${esc(meLetter)}</div>`}
      </div>
    </div>

    <!-- 纯净聊天信息流（仅消息顺滑滚动） -->
    <div class="chat-body" id="cp-body"></div>

    <!-- 引用条容器 -->
    <div id="cp-quote-container" class="hidden"></div>

    <!-- 底部悬浮输入栏 -->
    <div class="chat-input" id="cp-input">
      <button class="ci-btn" id="cp-plus" title="更多功能"><svg><use href="#i-plus"></use></svg></button>
      <div class="ci-field" id="cp-field" contenteditable="true" data-ph="说点什么"></div>
      
      <!-- 专属回复按键（随时点一下让 TA 回复你） -->
      <button class="ci-reply-btn" id="cp-reply-trigger" title="让 TA 回复你">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 17 4 12 9 7"></polyline>
          <path d="M20 18v-2a4 4 0 0 0-4-4H4"></path>
        </svg>
        <span>回复</span>
      </button>

      <!-- 发送按键 -->
      <button class="ci-send off" id="cp-send" title="发送消息"><svg><use href="#i-send"></use></svg></button>
    </div>

    <!-- 多选操作栏 (支持全选与批量删除) -->
    <div class="chat-select-bar hidden" id="cp-select-bar">
      <button class="csb-btn" id="csb-cancel">取消</button>
      <button class="csb-btn" id="csb-select-all">全选</button>
      <span id="csb-count" style="font-size:12px;color:var(--text-3)">已选 0 条</span>
      <button class="csb-btn danger" id="csb-delete">删除所选</button>
    </div>

    <div class="drawer hidden" id="cp-drawer"></div>
  `;

  wrap.classList.remove('hidden');
  pane.classList.remove('anim'); void pane.offsetWidth; pane.classList.add('anim');
  setTimeout(() => pane.classList.remove('anim'), 360);
  paneEl = pane;

  $('#cp-back').onclick = closeChat;

  // 单击对方大头像：居中弹出心声邮票卡片
  const topThemAv = $('#chat-top-av-them');
  if (topThemAv) {
    topThemAv.onclick = (e) => {
      e.stopPropagation();
      showWhisperStampModal(p);
    };
  }

  // 更换顶部专属大背景图（智能高保真压缩 + 原地热更新，绝不跳底）
  $('#cp-top-bg-input').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      toast('正在处理背景图…');
      const compressed = await compressImage(f, 1280, 0.85);
      p.topBg = compressed;
      if (S.personas) {
        const found = S.personas.find(x => x.id === p.id);
        if (found) found.topBg = compressed;
      }
      savePersonas(); persist();
      
      const heroCard = $('#chat-hero-bg-card');
      if (heroCard) {
        heroCard.style.backgroundImage = `url("${compressed}")`;
      }
      toast('顶部背景图已更换 ♡');
    } catch (err) {
      toast('背景图更换失败：' + (err.message || '请换一张图片试试'));
    }
    e.target.value = '';
  };

  // 点击背景图非按键区域触发更换
  const heroBgCard = $('#chat-hero-bg-card');
  if (heroBgCard) {
    heroBgCard.onclick = e => {
      if (e.target.closest('.chat-big-av') || e.target.closest('#chat-hero-korean-btn')) return;
      $('#cp-top-bg-input').click();
    };
  }

  // 点击韩文心语修改
  const heroKorBtn = $('#chat-hero-korean-btn');
  if (heroKorBtn) {
    heroKorBtn.onclick = e => {
      e.stopPropagation();
      editKoreanQuoteSheet(p);
    };
  }

  // 点击返回键旁边的名字胶囊：保持纯文字展示，不做任何跳转
  const namePillBtn = $('#cp-name-pill');
  if (namePillBtn) {
    namePillBtn.onclick = null;
    namePillBtn.style.cursor = 'default';
  }

  // 点击右上角三个点：单开独立全屏聊天设置页，绝不弹半栏
  $('#cp-more').onclick = () => openChatSettingsPage(p);

  const field = $('#cp-field');
  const sendBtn = $('#cp-send');
  field.addEventListener('input', () => {
    const has = field.innerText.trim().length > 0;
    sendBtn.classList.toggle('off', !has);
  });
  sendBtn.onclick = () => sendFromField();
  field.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFromField(); }
  });

  $('#cp-reply-trigger').onclick = () => {
    toast('正在连接回复…');
    reply(pid);
  };

  $('#cp-plus').onclick = () => toggleDrawer();

  // 多选与全选操作（仅针对可见消息，过滤隐藏的 whisper）
  $('#csb-cancel').onclick = () => exitSelectMode();
  $('#csb-select-all').onclick = () => {
    const list = S.chats[pid] || [];
    const allIds = list.filter(m => m.type !== 'whisper').map(m => m.id);
    if (selectedMsgIds.size >= allIds.length && allIds.length > 0) {
      selectedMsgIds.clear();
    } else {
      allIds.forEach(id => selectedMsgIds.add(id));
    }
    updateSelectBar();
    renderThread(false);
  };
  $('#csb-delete').onclick = () => {
    if (!selectedMsgIds.size) return;
    if (confirm(`确定删除勾选的 ${selectedMsgIds.size} 条内容吗？`)) {
      S.chats[pid] = S.chats[pid].filter(m => !selectedMsgIds.has(m.id));
      saveChats();
      exitSelectMode();
      renderThread();
      toast('所选内容已删除');
    }
  };

  renderThread();

  // 首次开场白
  if (!S.chats[pid].length && p.greeting) {
    setTimeout(() => {
      pushMsg(pid, { id: 'm_' + uid(), role: 'them', type: 'text', text: p.greeting, time: Date.now() });
      renderThread();
    }, 450);
  }
}

function closeChat() {
  const wrap = $('#pane-wrap');
  wrap.classList.add('hidden');
  $('#pane').innerHTML = '';
  S.openId = null;
  renderTab(S.tab);
}

function exitSelectMode() {
  isSelectMode = false;
  selectedMsgIds.clear();
  const b = $('#cp-body');
  if (b) b.classList.remove('is-select-mode');
  $('#cp-select-bar').classList.add('hidden');
  $('#cp-input').classList.remove('hidden');
  renderThread();
}

function enterSelectMode(initialMsgId) {
  isSelectMode = true;
  selectedMsgIds.clear();
  if (initialMsgId) selectedMsgIds.add(initialMsgId);
  const b = $('#cp-body');
  if (b) b.classList.add('is-select-mode');
  $('#cp-select-bar').classList.remove('hidden');
  $('#cp-input').classList.add('hidden');
  updateSelectBar();
  renderThread();
}

function updateSelectBar() {
  const cnt = $('#csb-count');
  if (cnt) cnt.textContent = `已选 ${selectedMsgIds.size} 条`;
}

/* 判断两条消息是否属于同一发送人、同一分钟的连续分组（非拍一拍/撤回/心声） */
function isSameMsgGroup(a, b) {
  if (!a || !b) return false;
  if (a.type === 'whisper' || b.type === 'whisper') return false;
  if (a.type === 'poke' || b.type === 'poke') return false;
  if (a.recalled || b.recalled) return false;
  if (a.role !== b.role) return false;
  const da = new Date(a.time || 0);
  const db = new Date(b.time || 0);
  if (da.toDateString() !== db.toDateString()) return false;
  return fmtClock(a.time) === fmtClock(b.time);
}

function renderThread(autoScroll = true) {
  const body = $('#cp-body');
  if (!body) return;
  const currentScrollTop = body.scrollTop;
  const pid = S.openId;
  if (!pid || !S.personas) return;
  let p = S.personas.find(x => x.id === pid);
  if (!p) {
    if (S.personas.length > 0) {
      p = S.personas[0];
      S.openId = p.id;
    } else {
      closeChat();
      return;
    }
  }
  const list = S.chats[p.id] || [];

  // 过滤掉不在消息流展示的潜台词心声
  const visibleList = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (!m.id) m.id = 'm_' + i + '_' + m.time;
    if (m.type !== 'whisper') visibleList.push(m);
  }

  // 纯净消息流渲染：同一分钟连发消息仅首条显示头像与 @Me/@You，仅末条显示底部时间戳与已读/未读
  let html = '';
  let lastDay = '';
  for (let i = 0; i < visibleList.length; i++) {
    const m = visibleList[i];
    const prev = visibleList[i - 1];
    const next = visibleList[i + 1];

    const d = new Date(m.time).toDateString();
    if (d !== lastDay) {
      lastDay = d;
      html += `<div class="msg-day">${fmtFull(m.time)}</div>`;
    }

    const isMe = m.role === 'me';
    const groupedWithPrev = isSameMsgGroup(prev, m);
    const groupedWithNext = isSameMsgGroup(m, next);

    const showAvatar = !groupedWithPrev;
    const showBottomMeta = !groupedWithNext;

    html += msgHtml(m, p, isMe, { showAvatar, showBottomMeta, groupedWithNext });
  }

  body.innerHTML = html;
  bindChatEvents(body, p);
  if (autoScroll) {
    scrollBottom();
  } else {
    body.scrollTop = currentScrollTop;
  }
}

function bindChatEvents(body, p) {
  // 线下纪念信封：点开查看当时的约会对话
  body.querySelectorAll('[data-env-mid]').forEach(env => {
    const mid = env.dataset.envMid;
    const msg = (S.chats[p.id] || []).find(m => m.id === mid);
    env.onclick = () => {
      if (isSelectMode) return;
      openOfflineMemoryViewer(p, msg || { sessionLog: [] });
    };
  });

  // 线下邀请小邮票：接受 → 进入线下模式；婉拒 → 留一句回应
  body.querySelectorAll('.of-invite-stamp').forEach(stamp => {
    const mid = stamp.closest('.msg')?.dataset.mid;
    const msg = (S.chats[p.id] || []).find(m => m.id === mid);
    stamp.querySelector('[data-act="accept-offline"]').onclick = (e) => {
      e.stopPropagation();
      if (isSelectMode) return;
      acceptOfflineInvite(p, msg || {});
    };
    const decline = stamp.querySelector('[data-act="decline-offline"]');
    if (decline) decline.onclick = (e) => {
      e.stopPropagation();
      if (isSelectMode) return;
      toast('已婉拒这次邀约');
      stamp.classList.add('is-declined');
    };
  });

  // 绑定对话列表里的头像双击拍一拍（双击对方头像拍对方，双击自己头像拍自己，防止单击误触）
  body.querySelectorAll('.msg-avatar-slot[data-act="poke-avatar"]').forEach(avSlot => {
    let clickTimer = null;
    let clickCount = 0;
    avSlot.onclick = (e) => {
      if (isSelectMode) return;
      e.stopPropagation();
      clickCount++;
      if (clickCount === 1) {
        clickTimer = setTimeout(() => {
          clickCount = 0;
        }, 300);
      } else if (clickCount >= 2) {
        clearTimeout(clickTimer);
        clickCount = 0;
        const role = avSlot.dataset.role;
        triggerPoke(p, role === 'me' ? 'me' : 'them');
      }
    };
  });

  // 绑定拍一拍与撤回提示条的长按菜单与多选勾选
  body.querySelectorAll('.msg-sys-actionable[data-mid]').forEach(sysEl => {
    const mid = sysEl.dataset.mid;

    if (isSelectMode) {
      sysEl.onclick = () => {
        if (selectedMsgIds.has(mid)) {
          selectedMsgIds.delete(mid);
          sysEl.classList.remove('is-selected');
        } else {
          selectedMsgIds.add(mid);
          sysEl.classList.add('is-selected');
        }
        updateSelectBar();
      };
      return;
    }

    let pressTimer = null;
    const startPress = (e) => {
      pressTimer = setTimeout(() => {
        openSysMsgActionMenu(e, mid, p);
      }, 450);
    };
    const cancelPress = () => {
      if (pressTimer) clearTimeout(pressTimer);
    };

    sysEl.addEventListener('touchstart', startPress, { passive: true });
    sysEl.addEventListener('touchend', cancelPress);
    sysEl.addEventListener('touchmove', cancelPress);
    sysEl.addEventListener('mousedown', startPress);
    sysEl.addEventListener('mouseup', cancelPress);
    sysEl.addEventListener('mouseleave', cancelPress);
    sysEl.addEventListener('contextmenu', e => { e.preventDefault(); openSysMsgActionMenu(e, mid, p); });
  });

  // 绑定气泡的长按菜单和点击勾选
  body.querySelectorAll('.msg[data-mid]').forEach(msgEl => {
    const mid = msgEl.dataset.mid;
    const bubble = msgEl.querySelector('.msg-bubble') || msgEl.querySelector('.tr-bubble') || msgEl.querySelector('.msg-content-wrap');

    if (isSelectMode) {
      msgEl.onclick = () => {
        if (selectedMsgIds.has(mid)) {
          selectedMsgIds.delete(mid);
          msgEl.classList.remove('is-selected');
        } else {
          selectedMsgIds.add(mid);
          msgEl.classList.add('is-selected');
        }
        updateSelectBar();
      };
      return;
    }

    // 移动端长按判定
    let pressTimer = null;
    const startPress = (e) => {
      pressTimer = setTimeout(() => {
        openMsgActionMenu(e, mid, p);
      }, 450);
    };
    const cancelPress = () => {
      if (pressTimer) clearTimeout(pressTimer);
    };

    if (bubble) {
      bubble.addEventListener('touchstart', startPress, { passive: true });
      bubble.addEventListener('touchend', cancelPress);
      bubble.addEventListener('touchmove', cancelPress);
      bubble.addEventListener('mousedown', startPress);
      bubble.addEventListener('mouseup', cancelPress);
      bubble.addEventListener('mouseleave', cancelPress);
      bubble.addEventListener('contextmenu', e => { e.preventDefault(); openMsgActionMenu(e, mid, p); });
    }
  });
}

/* 系统消息（拍一拍、撤回提示条）长按菜单：支持多选与单条删除 */
function openSysMsgActionMenu(e, mid, p) {
  closeMsgActionMenu();
  const list = S.chats[p.id] || [];
  const m = list.find(x => x.id === mid);
  if (!m) return;

  const menu = document.createElement('div');
  menu.className = 'msg-pop-menu';
  menu.id = 'msg-action-popover';
  menu.innerHTML = `
    <div class="msg-pop-item" data-act="select">多选</div>
    <div class="msg-pop-item danger" data-act="del">删除</div>
  `;
  document.body.appendChild(menu);

  const rect = (e.touches && e.touches[0]) 
    ? { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }
    : { clientX: e.clientX, clientY: e.clientY };

  const x = Math.min(window.innerWidth - 130, Math.max(16, rect.clientX - 60));
  const y = Math.max(70, rect.clientY - 44);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  menu.onclick = ev => {
    ev.stopPropagation();
    const act = ev.target.closest('[data-act]') ? ev.target.closest('[data-act]').dataset.act : null;
    closeMsgActionMenu();
    if (!act) return;

    if (act === 'select') {
      enterSelectMode(mid);
    } else if (act === 'del') {
      S.chats[p.id] = S.chats[p.id].filter(x => x.id !== mid);
      saveChats();
      renderThread();
      toast('已删除');
    }
  };

  const closeDoc = () => { closeMsgActionMenu(); document.removeEventListener('click', closeDoc); };
  setTimeout(() => document.addEventListener('click', closeDoc), 50);
}

/* 消息长按浮动菜单 (Action Pill) —— 对方发来的消息加入【收藏】选项 */
function openMsgActionMenu(e, mid, p) {
  closeMsgActionMenu();
  const list = S.chats[p.id] || [];
  const m = list.find(x => x.id === mid);
  if (!m || m.recalled) return;

  const isThem = (m.role === 'them');
  const menu = document.createElement('div');
  menu.className = 'msg-pop-menu';
  menu.id = 'msg-action-popover';

  menu.innerHTML = `
    ${m.role === 'me' ? `<div class="msg-pop-item" data-act="recall">撤回</div>` : ''}
    ${isThem ? `<div class="msg-pop-item" data-act="fav">收藏</div>` : ''}
    <div class="msg-pop-item" data-act="quote">引用</div>
    <div class="msg-pop-item" data-act="select">多选</div>
    <div class="msg-pop-item danger" data-act="del">删除</div>
  `;

  document.body.appendChild(menu);

  const rect = (e.touches && e.touches[0]) 
    ? { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }
    : { clientX: e.clientX, clientY: e.clientY };

  const x = Math.min(window.innerWidth - 210, Math.max(16, rect.clientX - 105));
  const y = Math.max(70, rect.clientY - 48);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  menu.onclick = ev => {
    ev.stopPropagation();
    const act = ev.target.closest('[data-act]') ? ev.target.closest('[data-act]').dataset.act : null;
    closeMsgActionMenu();
    if (!act) return;

    if (act === 'recall') {
      m.recalled = true;
      saveChats();
      renderThread();
      toast('已撤回消息');
    } else if (act === 'fav') {
      if (!S.favorites) S.favorites = [];
      const favItem = {
        id: 'fav_' + uid(),
        personaId: p.id,
        authorName: displayOf(p).name,
        avatar: p.avatar,
        text: m.text || '[多媒体/卡片]',
        type: m.type,
        time: m.time || Date.now(),
        favTime: Date.now()
      };
      S.favorites.unshift(favItem);
      saveFavorites(); persist();
      toast('已加入收藏 ♡');
    } else if (act === 'quote') {
      setQuoteMsg(m, p);
    } else if (act === 'select') {
      enterSelectMode(mid);
    } else if (act === 'del') {
      S.chats[p.id] = S.chats[p.id].filter(x => x.id !== mid);
      saveChats();
      renderThread();
      toast('消息已删除');
    }
  };

  const closeDoc = () => { closeMsgActionMenu(); document.removeEventListener('click', closeDoc); };
  setTimeout(() => document.addEventListener('click', closeDoc), 50);
}

function closeMsgActionMenu() {
  const el = $('#msg-action-popover');
  if (el) el.remove();
}

/* 引用回复条机制 */
function setQuoteMsg(m, p) {
  currentQuoteMsg = m;
  const c = $('#cp-quote-container');
  if (!c) return;
  const quoteFrom = m.role === 'me' ? '我' : displayOf(p).name;
  c.className = 'chat-reply-banner';
  c.innerHTML = `
    <span>回复 ${quoteFrom}：${esc(m.text || '[卡片/表情]')}</span>
    <span class="chat-reply-close" id="cp-quote-close">✕</span>
  `;
  $('#cp-quote-close').onclick = () => {
    currentQuoteMsg = null;
    c.className = 'hidden';
    c.innerHTML = '';
  };
  $('#cp-field').focus();
}

/* 单击角色头像触发：在屏幕正中间弹出一张拟真复古心声邮票卡片 */
function showWhisperStampModal(p) {
  const existing = $('#whisper-stamp-modal');
  if (existing) existing.remove();

  // 如果聊天记录里还没有产生过心声（未调用过API回复），默认显示「暂时还没有心声」
  const list = S.chats[p.id] || [];
  const whispers = list.filter(m => m.type === 'whisper');
  const hasWhisper = whispers.length > 0;
  const contentText = hasWhisper ? whispers[whispers.length - 1].text : '暂时还没有心声';
  const timeStr = hasWhisper ? fmtClock(whispers[whispers.length - 1].time) : fmtClock(Date.now());

  const modal = document.createElement('div');
  modal.className = 'whisper-modal-mask';
  modal.id = 'whisper-stamp-modal';
  modal.innerHTML = `
    <div class="whisper-stamp-card" id="whisper-stamp-card">
      <div class="wsc-hdr">
        <span class="wsc-badge">SECRET HEARTBEAT · 心声邮票</span>
        <span class="wsc-date">${timeStr}</span>
      </div>
      <div class="wsc-content">
        "${esc(contentText)}"
      </div>
      <div class="wsc-ftr">
        <span>来自：${esc(displayOf(p).name)}</span>
        <span>仅你可见的心声</span>
      </div>
      <button class="wsc-close-btn" id="wsc-close-btn">收下心声</button>
    </div>
  `;

  document.body.appendChild(modal);

  const closeIt = () => modal.remove();
  modal.onclick = e => {
    if (e.target === modal || e.target.id === 'wsc-close-btn') closeIt();
  };
}

/* 双击头像触发：拍一拍 */
function triggerPoke(p, target = 'them') {
  const me = S.account;
  const curMask = getCurrentMask();
  const myName = (curMask && curMask.name) || me.nickname || '你';
  const themName = displayOf(p).name;
  const suffix = p.pokeSuffix || '的小脸蛋并递上一杯温水';

  let text = '';
  if (target === 'me') {
    const mySuffix = (curMask && curMask.pokeSuffix) || (me && me.pokeSuffix) || '的小脑袋并轻轻叹了口气';
    text = `${myName} 拍了拍 自己${mySuffix}`;
  } else {
    text = `${myName} 拍了拍 ${themName} ${suffix}`;
  }

  pushMsg(p.id, { id: 'm_' + uid(), role: 'me', type: 'poke', text, time: Date.now() });
  renderThread();
  toast(target === 'me' ? '拍了拍自己' : `已拍了拍 ${themName}`);
}

function msgHtml(m, p, isMe, opts = {}) {
  // 心声仅用于点击头像弹出查看，不渲染在聊天信息流中
  if (m.type === 'whisper') return '';

  const isSelected = selectedMsgIds.has(m.id);

  // 如果是被撤回的消息：渲染居中轻提示，支持长按与多选勾选
  if (m.recalled) {
    return `
      <div class="msg-recalled-hint msg-sys-actionable ${isSelected ? 'is-selected' : ''}" data-mid="${m.id}">
        <div class="msg-check-box"></div>
        <span class="msg-recalled-text">${isMe ? '你撤回了一条消息' : `${displayOf(p).name} 撤回了一条消息`}</span>
      </div>
    `;
  }

  const showAvatar = opts.showAvatar !== false;
  const showBottomMeta = opts.showBottomMeta !== false;
  const groupedWithNext = !!opts.groupedWithNext;
  const timeStr = fmtClock(m.time);
  const curMask = getCurrentMask();
  const myDisplay = {
    avatar: (curMask && curMask.avatar) || S.account.avatar,
    name: (curMask && curMask.name) || S.account.nickname
  };

  if (m.type === 'poke') {
    return `
      <div class="msg-poke-center msg-sys-actionable ${isSelected ? 'is-selected' : ''}" data-mid="${m.id}">
        <div class="msg-check-box"></div>
        <span class="msg-poke-chip">${esc(m.text)}</span>
      </div>
    `;
  }

  // 线下邀请小邮票：人设主动发来的约会邀请卡
  if (m.type === 'offline_invite') {
    return `
      <div class="msg offline-invite-msg" data-mid="${m.id}">
        <div class="msg-avatar-slot" data-act="poke-avatar" data-role="them">${avatarHtml(displayOf(p), 'sm')}</div>
        <div class="msg-content-wrap">
          <div class="msg-tag-row"><span>@You</span></div>
          <div class="of-invite-stamp">
            <div class="of-invite-perf"></div>
            <div class="of-invite-body">
              <div class="of-invite-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 8.5 12 3l9 5.5v7L12 21l-9-5.5Z"/><path d="M3 8.5 12 14l9-5.5M12 14v7"/></svg>
              </div>
              <div class="of-invite-title">线下之约 · 邀请小邮票</div>
              <div class="of-invite-text">${esc(m.text || `${displayOf(p).name} 想约你出去走走，点开这枚邮票赴约…`)}</div>
              <div class="of-invite-btn" data-act="accept-offline">接受邀请 · 赴约</div>
            </div>
            <div class="of-invite-cancel" data-act="decline-offline">婉拒</div>
          </div>
        </div>
      </div>`;
  }

  // 线下纪念卡：约会结束后留在聊天里的回忆（信封样式，内联样式防缓存丢失）
  if (m.type === 'offline_memory') {
    const envS = 'position:relative;margin:16px auto 8px;width:78%;max-width:300px;background:linear-gradient(160deg,#FFF6F1 0%,#FBEAEE 70%,#F6DFE8 100%);border:1px solid rgba(210,140,165,.3);border-radius:14px;overflow:hidden;box-shadow:0 8px 22px -10px rgba(190,110,140,.4);text-align:center;';
    const flapS = 'position:absolute;top:0;left:0;right:0;height:44%;background:linear-gradient(180deg,rgba(232,138,165,.16),transparent);clip-path:polygon(0 0,100% 0,50% 100%);pointer-events:none;';
    const heartS = 'font-size:20px;line-height:1;color:#D8829E;';
    const titleS = 'position:relative;font-size:14px;font-weight:700;color:#C4698A;margin-top:6px;letter-spacing:.06em;';
    const textS = 'position:relative;font-size:12px;color:#7c6f77;margin-top:5px;';
    const footS = 'position:relative;font-size:9.5px;color:#b9a6ae;margin-top:10px;letter-spacing:.18em;';
    const stampS = 'position:absolute;top:8px;right:8px;width:30px;height:36px;border:1.5px dashed rgba(216,130,158,.5);border-radius:4px;font-size:9px;color:#D8829E;line-height:36px;';
    return `
      <div style="${envS}cursor:pointer;" data-env-mid="${m.id}">
        <div style="${flapS}"></div>
        <div style="position:relative;padding:20px 18px 14px;">
          <div style="${heartS}">♡</div>
          <div style="${titleS}">${esc(m.personaName || displayOf(p).name)} · 线下之约</div>
          <div style="${textS}">${esc(m.sceneName && m.sceneName !== '线下之约' ? m.sceneName + ' · ' : '')}你们交换了 ${m.turns || 0} 段时光</div>
          <div style="${footS}">—— 这段回忆已被收进信笺 ——</div>
        </div>
        <div style="${stampS}">♡</div>
      </div>
    `;
  }

  const avHtml = showAvatar
    ? (isMe ? avatarHtml(myDisplay, 'round sm') : avatarHtml(displayOf(p), 'sm'))
    : '';

  let bubbleInner = '';
  // 如果有引用回复内容
  if (m.quote) {
    bubbleInner += `<div class="msg-quote-card">“${esc(m.quote.text)}”</div>`;
  }

  if (m.type === 'sticker') {
    bubbleInner += `<img class="msg-sticker" src="${m.text}" alt="${esc(m.stickerName || '表情')}" title="${esc(m.stickerName || '')}">`;
  } else if (m.type === 'image') {
    bubbleInner += `<div class="msg-img"><img src="${m.text}" alt=""></div>`;
  } else if (m.type === 'transfer') {
    // 转账卡片状态根据人设回复判定：pending（待处理/已发起）、accepted（已收款）、refunded（已退回）
    let trTitle = '';
    if (m.status === 'accepted') {
      trTitle = isMe ? '对方已收款' : '你已收款';
    } else if (m.status === 'refunded') {
      trTitle = isMe ? '对方已退还转账' : '已退还转账';
    } else {
      trTitle = isMe ? '你已转账' : '给你转账';
    }

    bubbleInner += `
      <div class="tr-bubble ${m.status ? 'is-' + m.status : ''}">
        <div class="tr-card-body">
          <div class="tr-card-icon">
            <svg viewBox="0 0 24 24"><use href="#i-wallet"></use></svg>
          </div>
          <div>
            <div class="tr-card-title">${trTitle}</div>
            <div class="tr-card-amt">¥ ${esc(m.amount || '')}</div>
          </div>
        </div>
        ${m.text ? `<div class="tr-card-note">${esc(m.text)}</div>` : ''}
      </div>
    `;
  } else {
    bubbleInner += `<div class="msg-bubble">${esc(m.text)}</div>`;
  }

  // 状态判定：发出去默认是「未读」，点回复触发后更新为「已读」
  const isUnread = (isMe && m.unread !== false);
  const tagClass = isUnread ? 'is-unread' : 'is-read';
  const tagText = isUnread ? '未读' : '已读';

  return `
    <div class="msg ${isMe ? 'me' : ''} ${groupedWithNext ? 'has-next-grouped' : ''} ${isSelected ? 'is-selected' : ''}" data-mid="${m.id}">
      <!-- 多选勾选圆圈 -->
      <div class="msg-check-box"></div>

      <div class="msg-avatar-slot ${showAvatar ? '' : 'is-ghost-av'}" data-act="poke-avatar" data-role="${isMe ? 'me' : 'them'}">${avHtml}</div>
      <div class="msg-content-wrap">
        <!-- 气泡顶部的 @Me / @You 精致微标：仅在该分钟分组的第一条展示 -->
        ${showAvatar ? `
          <div class="msg-tag-row">
            <span>${isMe ? '@Me' : '@You'}</span>
          </div>
        ` : ''}

        ${bubbleInner}

        ${showBottomMeta ? `
          <div class="msg-meta-bottom">
            <span class="msg-time-txt">${timeStr}</span>
            ${isMe ? `<span class="msg-read-tag ${tagClass}">${tagText}</span>` : ''}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function scrollBottom() {
  const body = $('#cp-body');
  if (body) body.scrollTop = body.scrollHeight;
}
function pushMsg(pid, m) {
  if (!S.chats[pid]) S.chats[pid] = [];
  if (!m.id) m.id = 'm_' + uid();
  S.chats[pid].push(m);
  saveChats();
}

/* ---------------- 发送消息（不自动秒回，支持附带引用） ---------------- */
function sendFromField() {
  const field = $('#cp-field');
  const text = field.innerText.replace(/\u00a0/g, ' ').trim();
  if (!text) return;
  field.innerHTML = '';
  $('#cp-send').classList.add('off');
  const pid = S.openId;

  const newM = {
    id: 'm_' + uid(),
    role: 'me',
    type: 'text',
    text,
    time: Date.now(),
    unread: true
  };

  if (currentQuoteMsg) {
    newM.quote = {
      id: currentQuoteMsg.id,
      text: currentQuoteMsg.text || '[多媒体/卡片]'
    };
    currentQuoteMsg = null;
    const c = $('#cp-quote-container');
    if (c) { c.className = 'hidden'; c.innerHTML = ''; }
  }

  pushMsg(pid, newM);
  renderThread();
  closeDrawer();
}

function sendSticker(url, name) {
  const pid = S.openId;
  pushMsg(pid, {
    id: 'm_' + uid(),
    role: 'me',
    type: 'sticker',
    text: url,
    stickerName: name || '表情',
    time: Date.now(),
    unread: true
  });
  renderThread();
  closeDrawer();
}

/* ---------------- 输入区抽屉 ---------------- */
function toggleDrawer() { $('#cp-drawer').classList.toggle('hidden'); if (!$('#cp-drawer').classList.contains('hidden')) renderDrawer(); }
function closeDrawer() { const d = $('#cp-drawer'); if (d) d.classList.add('hidden'); }

function renderDrawer() {
  const d = $('#cp-drawer');
  // 彻底去掉默认 emoji 图标，仅展示用户自己添加的专属表情包 + 添加入口
  const custom = (S.stickers || []).map((s, idx) => {
    const u = typeof s === 'string' ? s : s.url;
    const nm = typeof s === 'string' ? ('表情' + (idx + 1)) : (s.name || ('表情' + (idx + 1)));
    return `
      <div class="dr-sticker-cell" data-sidx="${idx}" title="${esc(nm)}">
        <img src="${esc(u)}" alt="${esc(nm)}">
        <span>${esc(nm)}</span>
      </div>
    `;
  }).join('');

  const addCell = `
    <div class="dr-sticker-add" id="dr-sticker-manage" title="添加/管理表情包">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><use href="#i-plus"></use></svg>
      <span>添加表情</span>
    </div>
  `;

  d.innerHTML = `
    <div class="dr-item" id="dr-emoji"><div class="dr-ico"><svg><use href="#i-sticker"></use></svg></div><span>表情</span></div>
    <div class="dr-item" id="dr-img"><div class="dr-ico"><svg><use href="#i-img"></use></svg></div><span>图片</span></div>
    <div class="dr-item" id="dr-money"><div class="dr-ico"><svg><use href="#i-wallet"></use></svg></div><span>转账</span></div>
    <div class="dr-item" id="dr-poke"><div class="dr-ico"><svg><use href="#i-heart"></use></svg></div><span>拍一拍</span></div>
    <div class="dr-item" id="dr-offline"><div class="dr-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 8.5 12 3l9 5.5v7L12 21l-9-5.5Z"/><path d="M3 8.5 12 14l9-5.5M12 14v7"/></svg></div><span>线下之约</span></div>
    <div class="dr-item" id="dr-retry"><div class="dr-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg></div><span>重新生成</span></div>
    <input type="file" id="dr-img-input" accept="image/*" hidden>
    <div class="sticker-grid hidden" id="dr-grid">${custom}${addCell}</div>
  `;
  $('#dr-emoji').onclick = () => $('#dr-grid').classList.toggle('hidden');
  $('#dr-img').onclick = () => $('#dr-img-input').click();
  $('#dr-img-input').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      pushMsg(S.openId, { id: 'm_' + uid(), role: 'me', type: 'image', text: r.result, time: Date.now(), unread: true });
      closeDrawer();
      renderThread();
    };
    r.readAsDataURL(f);
  };
  $('#dr-money').onclick = () => { closeDrawer(); transferFlow(); };
  $('#dr-offline').onclick = () => {
    closeDrawer();
    const p = S.personas.find(x => x.id === S.openId);
    if (p) openOfflineInviteSheet(p);
  };
  $('#dr-retry').onclick = () => {
    closeDrawer();
    chatRegenerateLast();
  };
  $('#dr-poke').onclick = () => {
    closeDrawer();
    const p = S.personas.find(x => x.id === S.openId);
    if (p) triggerPoke(p);
  };
  const manageBtn = $('#dr-sticker-manage');
  if (manageBtn) {
    manageBtn.onclick = () => {
      closeDrawer();
      openStickers();
    };
  }
  d.querySelectorAll('.dr-sticker-cell').forEach(el => {
    el.onclick = () => {
      const idx = parseInt(el.dataset.sidx, 10);
      const item = S.stickers[idx];
      if (!item) return;
      const u = typeof item === 'string' ? item : item.url;
      const nm = typeof item === 'string' ? ('表情' + (idx + 1)) : (item.name || '表情');
      sendSticker(u, nm);
    };
  });
}

/* 聊天重新生成：弹出意见卡（可写希望怎么改），或直接重试 */
function chatRegenerateLast() {
  const pid = S.openId;
  const p = S.personas.find(x => x.id === pid);
  if (!p) return;
  const list = S.chats[pid] || [];
  const hasMsg = list.some(m => m.role === 'them' && !m.recalled);
  if (!hasMsg) { toast('还没有 TA 的消息可以重新生成'); return; }

  const card = document.createElement('div');
  card.className = 'of-exit-card';
  card.innerHTML = `
    <div class="of-exit-card-inner">
      <div class="of-exit-title">重新生成这条回复</div>
      <div class="of-exit-sub">写下你希望怎么改（可留空直接重试）</div>
      <div style="display:flex;flex-wrap:wrap;gap:7px;justify-content:center;margin-top:12px;">
        <button class="of-opt-chip" data-hint="语气太凶了，温柔一点">语气太凶了</button>
        <button class="of-opt-chip" data-hint="刚才的回复 OOC 了，请贴合人设">OOC 了</button>
        <button class="of-opt-chip" data-hint="太主动了，收着一点">太主动了</button>
        <button class="of-opt-chip" data-hint="太冷淡了，热情一点">太冷淡了</button>
      </div>
      <input id="retry-hint-input" placeholder="或者自己写：希望 TA 怎么回…" maxlength="60" style="width:100%;box-sizing:border-box;margin-top:12px;border:1.5px solid rgba(232,168,190,.45);border-radius:12px;padding:10px 13px;font-size:13px;background:#fff;color:var(--text);outline:none;">
      <div class="of-exit-btns">
        <button class="of-exit-btn end" id="retry-go">重新生成</button>
        <button class="of-exit-btn cancel" id="retry-cancel">算了</button>
      </div>
    </div>`;
  document.body.appendChild(card);
  const close = () => card.remove();
  card.onclick = (e) => { if (e.target === card) close(); };
  card.querySelector('#retry-cancel').onclick = close;
  card.querySelectorAll('[data-hint]').forEach(chip => {
    chip.onclick = () => { card.querySelector('#retry-hint-input').value = chip.dataset.hint; };
  });
  card.querySelector('#retry-go').onclick = () => {
    const hint = card.querySelector('#retry-hint-input').value.trim();
    close();
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === 'them' && !list[i].recalled) { list.splice(i, 1); break; }
    }
    saveChats(); renderThread();
    reply(pid, hint || null);
  };
}

function sendStickerText(t) {
  const pid = S.openId;
  pushMsg(pid, { id: 'm_' + uid(), role: 'me', type: 'text', text: t, time: Date.now(), unread: true });
  renderThread();
}

function transferFlow() {
  openSheet({
    title: '转账',
    sub: `零钱余额 ¥${S.wallet.balance.toFixed(2)}`,
    body: `<div class="field"><div class="field-label">金额</div>
      <input class="field-input" id="tf-amt" type="number" inputmode="decimal" placeholder="0.00"></div>
      <div class="field"><div class="field-label">留言（可留空）</div>
      <input class="field-input" id="tf-note" maxlength="20" placeholder="买杯热咖啡"></div>`,
    footer: `<div style="padding:10px 20px 4px"><button class="btn-main" id="tf-go">确认转账</button></div>`,
    after() {
      $('#tf-go').onclick = () => {
        const amt = parseFloat($('#tf-amt').value);
        if (!amt || amt <= 0) { toast('金额不对'); return; }
        if (amt > S.wallet.balance) { toast('零钱不够了'); return; }
        S.wallet.balance -= amt;
        S.wallet.records.unshift({ t: '转账给 ' + displayOf(S.personas.find(x => x.id === S.openId)).name, a: -amt, time: Date.now() });
        saveWallet(); persist();
        const note = $('#tf-note').value.trim();
        pushMsg(S.openId, { id: 'm_' + uid(), role: 'me', type: 'transfer', amount: amt.toFixed(2), text: note, time: Date.now(), unread: true, status: '' });
        closeSheet();
        renderThread();
      };
    }
  });
}

/* ================================================================
   四、对话引擎（活人感底座与转账智能响应机制）
   ================================================================ */
const SOUL_BASE = `你正在用手机和一个很亲近的人聊天。不是写小说，不是扮演，你本来就是这个人。

【怎么说话】
- 每条消息都是你用拇指敲出来的。想到什么就发什么，不要先在脑子里写完整段。
- 一次只发一到两句，短句连发。想多说，就分成好几条短消息一条条发出去。
- 用换行来分条：你想说的每一小句之间，换行。系统会把每一行变成一条独立的消息。
- 句尾通常不打句号。句号是冷淡、赌气的信号，只有真不高兴才用。
- 大部分时候只是在陈述。不要每句话都以问号结尾，连续追问会让人窒息。
- 偶尔打错字，然后在下一行改口。偶尔只回两个字。懒得回的时候，就真的很短。

【特别规则：对待转账】
- 如果对方给你转账了，请结合你的人设性格、两人的亲密程度、以及当前聊的话题来决定你的态度和反应。
- 如果你要【收款】：请在你的消息开头或其中某一行单独输出标记 [收款]（例如：[收款] 笨蛋，怎么又给我转账 / 买咖啡的钱我收下了）。
- 如果你要【退回】：请在你的消息开头或其中某一行单独输出标记 [退回]（例如：[退回] 拿回去，我不要你的钱 / 别闹，我怎么能收这个）。
- 如果你既不明确收也不明确退，或者只是调侃，就正常回应。

【特别规则：潜台词心声】
- 请在输出消息的第一行，单独写下一句你此刻真实的心声潜台词（即你最在乎、但表面上敲打键盘时没有直接对TA说出口的想法），格式为：[心声: 你的内心独白]（例如：[心声: 嘴上说着嫌麻烦，其实一整天都在等你的消息]）。这句话会被系统单独存入心声邮票中，只有TA轻点你的头像才能看到。
- 在第二行开始，正常输出你要发给TA的聊天消息。
- 【硬性要求】心声之后必须至少再输出一行发给TA的正文消息，绝不允许整条回复只有[心声:]一行。心声是潜台词，聊天消息才是真正的回复，两者缺一不可。

【特别规则：头像更换】
- 如果对方发来一张图片并希望（或暗示）你用它换头像，而你确实愿意换：请单独输出一行 [换头像]（例如：[换头像] 好，这张做我的新头像）。系统会自动把该图片设为你的新头像。若你不想换，正常回应即可，不要输出该标记。

【特别规则：线下之约】
- 当你们聊到想见面、想出去走走、约饭、约会这类话题，而你真心想去时，可以在消息中单独输出一行标记：[线下邀请: 你想对TA说的话]（例如：[线下邀请: 周末的海边栈道，陪我走走好不好]）。系统会把这句话变成一枚"线下邀请小邮票"寄给TA，TA点击就能和你进入线下约会。
- 不要频繁使用：只有聊天气氛真的到了、你也很想去的时候才发。如果对方没接话或婉拒了，不要重复邀请。
- 进入线下约会后，你们会以文字文游的方式"见面"，那里由另一位叙述者负责描写。

{STICKERS_RULE}

【绝对不能做】
- 禁止使用括号 () （） [] 书名号 破折号 引号 来描述动作、表情、神态、环境。你不发旁白，只发敲出来的字（除特种标记外）。
- 禁止写"（笑了笑）""（沉默几秒）""*别开视线*"这类东西。
- 禁止说教、禁止总结、禁止解释自己为什么这么说。
- 禁止复读对方的话，禁止用同样的句式镜像对方刚说的内容。
- 不要每句话都热情洋溢。人会累，会走神，会突然安静。

【当前时间】{TIME}
【对话对象】{USER}

【你的人设】
{PERSONA}

现在开始聊天。只输出你要发的内容本身，不要有任何小说旁白或无关格式标记。`;

function seasonOf(d) {
  const m = d.getMonth() + 1;
  if (m >= 3 && m <= 5) return '春';
  if (m >= 6 && m <= 8) return '夏';
  if (m >= 9 && m <= 11) return '秋';
  return '冬';
}

/* 判断指定模型是否具备视觉识图 (Vision) 能力 */
function isVisionModel(modelName) {
  const s = (modelName || '').toLowerCase();
  if (!s) return false;
  if (/reasoner|r1|v3|deepseek-chat|o1-mini|o3-mini|text-|embedding/.test(s)) return false;
  return /gpt-4o|gpt-4-turbo|gpt-4\.1|gpt-4\.5|claude-3|claude-sonnet|claude-opus|claude-haiku|gemini|qwen.*vl|vl|vision|pixtral|llava|yi-vision|glm-4v|step-1v|doubao.*vision|moonshot.*vision/.test(s);
}

/* 根据表情名称或序号匹配自定义表情包 */
function findStickerByToken(token) {
  const clean = (token || '').trim();
  if (!clean || !S.stickers || !S.stickers.length) return null;
  const list = S.stickers.map((s, idx) => (typeof s === 'string' ? { name: '表情' + (idx + 1), url: s } : s));
  let hit = list.find(s => (s.name || '').trim() === clean);
  if (hit) return hit;
  hit = list.find(s => (s.name || '').toLowerCase() === clean.toLowerCase());
  if (hit) return hit;
  hit = list.find(s => (s.name || '').includes(clean) || clean.includes(s.name || ''));
  return hit || null;
}

function buildMessages(p, useVision = false) {
  const list = (S.chats[p.id] || []).slice(-30);
  const curM = getCurrentMask();
  const userName = (curM && curM.name) || S.account.nickname || '你';
  const userSign = (curM && (curM.background || curM.tone)) || S.account.sign || '';

  const stickerItems = (S.stickers || []).map((s, idx) => (typeof s === 'string' ? { name: '表情' + (idx + 1), url: s } : s)).filter(s => s && s.url);
  const stickerNames = stickerItems.map(s => s.name || '表情');
  const stickersRule = stickerNames.length
    ? `【特别规则：专属表情包】\n- 你们的共享表情包库里有这些表情：${stickerNames.map(n => `「${n}」`).join('、')}。\n- 当对方发来表情包时，如果能看到画面请结合画面与文字含义回应；如果看不到画面，请根据表情包的名字和当前聊天氛围自然回应。\n- 你在聊天时也可以根据聊天气氛和情绪，主动发送表情包库里的表情！想要发表情包时，请单独起一行输出：[表情: 表情名字]（例如：[表情: ${stickerNames[0]}]，名字必须从上面的表情包库里选，适度自然使用，不要每句都发）。`
    : '';

  const timeAware = p.timeAware !== false;
  const sys = SOUL_BASE
    .replace('{STICKERS_RULE}', stickersRule)
    .replace('{TIME}', timeAware
      ? (new Date().toLocaleString('zh-CN', { hour12: false }) + '（' + seasonOf(new Date()) + '）')
      : '（时间感知已关闭，你不知道现在几点，请不要提具体时间、日期或季节）')
    .replace('{USER}', `${userName}（账号 ${S.account.username || 'SY1125'}）` + (userSign ? `，签名：${userSign}` : ''))
    .replace('{PERSONA}', p.prompt || `名字：${p.name}。${p.sign || ''}（人设还没写，请自然、温柔地回应。）`);
  const msgs = [{ role: 'system', content: sys }];

  // 世界书注入：全局自动绑定 + 局部按人设绑定，关键词命中最近对话时注入设定
  const recentTextForWB = list.slice(-30).map(m => m.text || '').join('\n');
  const wbEntries = collectWorldbookEntries(p, recentTextForWB);
  if (wbEntries.length) {
    const wbBlock = wbEntries.map(en => `- ${en.content}`).join('\n');
    msgs[0].content += `\n\n【世界书 · 背景设定（以下是你们共同世界的设定，请在回应中自然遵循，不要复述）】\n${wbBlock}`;
  }
  // 找出最后 2 条图片/表情消息，在识图模式下附带真实图像，避免历史图片过多撑爆请求体积
  const visionTargetIds = new Set();
  if (useVision) {
    const imgMsgs = list.filter(m => !m.recalled && (m.type === 'sticker' || m.type === 'image') && m.text);
    imgMsgs.slice(-2).forEach(m => visionTargetIds.add(m.id));
  }

  list.forEach(m => {
    if (m.recalled) return; // 撤回的消息不参与上下文
    if (m.type === 'poke') { msgs.push({ role: 'user', content: `[${m.text}]` }); return; }
    if (m.type === 'transfer') {
      const trStatus = m.status === 'accepted' ? '（已收款）' : (m.status === 'refunded' ? '（已退回）' : '（待处理）');
      msgs.push({
        role: m.role === 'me' ? 'user' : 'assistant',
        content: `[转账 ¥${m.amount}${m.text ? ' 留言：' + m.text : ''} ${trStatus}]`
      });
      return;
    }
    if (m.type === 'sticker') {
      let sName = m.stickerName || '';
      if (!sName && m.text) {
        const matched = stickerItems.find(s => s.url === m.text);
        if (matched) sName = matched.name;
      }
      const role = m.role === 'me' ? 'user' : 'assistant';
      const label = `[表情: ${sName || '自定义表情'}]`;
      if (useVision && role === 'user' && visionTargetIds.has(m.id) && m.text) {
        msgs.push({
          role: 'user',
          content: [
            { type: 'text', text: `对方发来了一个表情包 ${label}，请结合画面内容、表情含义与上下文自然回应：` },
            { type: 'image_url', image_url: { url: m.text } }
          ]
        });
      } else {
        msgs.push({ role, content: label });
      }
      return;
    }
    if (m.type === 'image') {
      const role = m.role === 'me' ? 'user' : 'assistant';
      if (useVision && role === 'user' && visionTargetIds.has(m.id) && m.text) {
        msgs.push({
          role: 'user',
          content: [
            { type: 'text', text: '对方发来了一张图片：' },
            { type: 'image_url', image_url: { url: m.text } }
          ]
        });
      } else {
        msgs.push({ role, content: '[图片]' });
      }
      return;
    }
    if (m.type === 'whisper') return; // 心声是私密的，不放入对话历史
    if (m.text) msgs.push({ role: m.role === 'me' ? 'user' : 'assistant', content: m.text });
  });
  return msgs;
}

async function streamChat(api, messages, temperature, onDelta) {
  const url = api.url.replace(/\/+$/, '');
  const endpoint = /\/chat\/completions$/.test(url) ? url : url + '/chat/completions';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.key },
    body: JSON.stringify({ model: api.model, messages, temperature, stream: true })
  });
  if (!res.ok) {
    let t = '';
    try { t = (await res.text()).slice(0, 160); } catch (e) {}
    throw new Error('HTTP ' + res.status + ' ' + t);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const ln of lines) {
      const s = ln.trim();
      if (!s || s[0] !== 'd') continue;
      if (!s.startsWith('data:')) continue;
      const d = s.slice(5).trim();
      if (d === '[DONE]') continue;
      try {
        const j = JSON.parse(d);
        const delta = (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || '';
        if (delta) { full += delta; onDelta && onDelta(delta, full); }
      } catch (e) {}
    }
  }
  return full;
}

/* ================================================================
   对话引擎：一次调用解析心声邮票卡片与常规气泡
   ================================================================ */
async function reply(pid, regenHint) {
  const p = S.personas.find(x => x.id === pid);
  if (!p) return;
  const body = $('#cp-body');
  if (!body) return;

  // 用户按下回复时：把该对话下所有发出去的未读消息状态更新为已读
  if (S.chats[pid] && S.chats[pid].length) {
    let changed = false;
    S.chats[pid].forEach(m => {
      if (m.role === 'me' && m.unread) {
        m.unread = false;
        changed = true;
      }
    });
    if (changed) {
      saveChats();
      renderThread();
    }
  }

  const cfg = apiSlots();
  const order = [];
  if (cfg.primary.ready) order.push(cfg.primary);
  if (cfg.secondary.ready) order.push(cfg.secondary);

  if (!order.length) {
    toast('⚠️ 请先到小手机桌面【设置】填好大模型 API');
    return;
  }

  // 正在输入动效
  const typing = document.createElement('div');
  typing.className = 'msg';
  typing.id = 'cp-typing';
  typing.innerHTML = `${avatarHtml(displayOf(p), 'sm')}<div class="typing"><i></i><i></i><i></i></div>`;
  body.appendChild(typing);
  scrollBottom();

  const temp = typeof p.temp === 'number' ? p.temp : 0.85;

  let text = '', err = null;
  for (const api of order) {
    const useVis = isVisionModel(api.model);
    try {
      const msgs = buildMessages(p, useVis);
      if (regenHint) msgs[0].content += `\n\n【重新生成要求】用户对上一条回复不满意，这次请按这个要求调整：${regenHint}`;
      text = await streamChat(api, msgs, temp, null);
      err = null;
      break;
    } catch (e) {
      // 若识图模式因网关或模型不支持 image_url 报错，自动降级为纯文字模式重试一次
      if (useVis) {
        try {
          const fallbackMsgs = buildMessages(p, false);
          text = await streamChat(api, fallbackMsgs, temp, null);
          err = null;
          break;
        } catch (e2) { err = e2; }
      } else {
        err = e;
      }
    }
  }

  typing.remove();
  if (err || !text.trim()) {
    toast('⚠️ 消息未发出：' + (err ? err.message.slice(0, 50) : '未获取到回复'));
    return;
  }

  // 解析模型输出：提取未说出口心声卡片 [心声: ...]、转账处理意图 [收款] / [退回]、头像更换 [换头像] 以及表情包 [表情: 名字]
  let whisperText = '';
  let transferAction = null; // 'accepted' | 'refunded'
  let avatarChangeRequested = false;
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const msgItems = []; // { type: 'text'|'sticker', text, stickerName }

  for (let l of lines) {
    const mMatch = l.match(/^\[心声[:：]\s*([^\]]+)\]/);
    if (mMatch && !whisperText) {
      whisperText = mMatch[1].trim();
      continue;
    }
    // 检测头像更换意图 [换头像]：自主采用用户最近发来的图片作为新头像
    if (/\[换头像\]|\[更换头像\]/i.test(l)) {
      avatarChangeRequested = true;
      l = l.replace(/\[(?:更换)?换头像\]/ig, '').trim();
    }
    // 检测线下之约邀请 [线下邀请: 场景]：人设主动发一枚线下邀请小邮票
    const ofMatch = l.match(/\[线下邀请[:：]\s*([^\]]+)\]/);
    if (ofMatch) {
      l = l.replace(/\[线下邀请[:：][^\]]*\]/g, '').trim();
    }
    // 检测是否包含 [收款] 或 [退回] 意图
    if (/\[(收款|收下|确认收款)\]/i.test(l)) {
      transferAction = 'accepted';
      l = l.replace(/\[(收款|收下|确认收款)\]/ig, '').trim();
    } else if (/\[(退回|退还|拒收|退钱)\]/i.test(l)) {
      transferAction = 'refunded';
      l = l.replace(/\[(退回|退还|拒收|退钱)\]/ig, '').trim();
    }
    // 过滤任何残留的心声标签
    l = l.replace(/^\[心声[:：].*?\]/, '').trim();
    if (!l) continue;

    // 检测是否包含 [表情: xxx] 标记（支持整行或行内混合）
    const stRegex = /\[(?:表情|表情包)[:：]\s*([^\]]+)\]/g;
    let match;
    let lastIdx = 0;
    let hasTag = false;
    while ((match = stRegex.exec(l)) !== null) {
      hasTag = true;
      const before = l.slice(lastIdx, match.index).trim();
      if (before) msgItems.push({ type: 'text', text: before });
      const stToken = match[1].trim();
      const foundSt = findStickerByToken(stToken);
      if (foundSt) {
        msgItems.push({ type: 'sticker', text: foundSt.url, stickerName: foundSt.name });
      }
      lastIdx = stRegex.lastIndex;
    }
    if (hasTag) {
      const after = l.slice(lastIdx).trim();
      if (after) msgItems.push({ type: 'text', text: after });
    } else {
      msgItems.push({ type: 'text', text: l });
    }
  }

  // 如果模型给出了收款或退还意图，并且当前聊天记录中有待处理的转账卡片，则更新该转账卡片状态
  const curChatList = S.chats[pid] || [];
  const pendingTransfer = curChatList.slice().reverse().find(m => m.type === 'transfer' && !m.status);
  if (pendingTransfer && transferAction) {
    pendingTransfer.status = transferAction;
    if (transferAction === 'refunded') {
      // 退回时把钱原路退回到零钱余额
      const amt = parseFloat(pendingTransfer.amount) || 0;
      if (amt > 0) {
        S.wallet.balance += amt;
        S.wallet.records.unshift({ t: displayOf(p).name + ' 退还转账', a: amt, time: Date.now() });
        saveWallet();
      }
    }
    saveChats(); persist();
  }

  // 如果模型同意换头像 [换头像]：自动采用用户最近发来的那张图片作为新头像
  if (avatarChangeRequested) {
    const lastImg = curChatList.slice().reverse().find(m => m.role === 'me' && (m.type === 'image') && m.text);
    if (lastImg) {
      p.avatar = lastImg.text;
      savePersonas(); persist();
      // 顶栏大头像原地热更新
      const topAvEl = $('#chat-top-av-them');
      if (topAvEl) topAvEl.innerHTML = `<img src="${p.avatar}">`;
      toast(`${displayOf(p).name} 已换上你发来的头像 ♡`);
    } else {
      toast('TA 想换头像，但还没找到你发过的图片');
    }
  }

  // 如果提取到了心声，存入聊天记录（供点击头像查看），且不在普通聊天气泡流中重复插入打扰
  if (whisperText) {
    pushMsg(pid, { id: 'm_' + uid(), role: 'them', type: 'whisper', text: whisperText, time: Date.now() });
  }

  // 线下之约：模型发起 [线下邀请: 想说的话] → 紧跟一条线下邀请小邮票卡片
  if (ofMatch && !offlineStateOf(p).active) {
    setTimeout(() => {
      pushMsg(pid, {
        id: 'm_' + uid(), role: 'them', type: 'offline_invite', time: Date.now(),
        text: ofMatch[1].trim() || `${displayOf(p).name} 想约你出去走走`,
        scene: 'seaside'
      });
      renderThread();
      toast(`${displayOf(p).name} 寄来一枚线下邀请小邮票`);
    }, 500);
  }

  // 依次弹出真实回复短气泡与表情包
  // 兜底修复：候选行必须剔除心声/表情/线下/转账/换头像等指令标签行，防止把标签原文当正文推出后被渲染层过滤导致"回复不显示"
  if (!msgItems.length && lines.length) {
    const isCmdLine = (l) => /^\s*\[(心声|表情|表情包|线下邀请|收款|收下|确认收款|退回|退还|拒收|退钱|换头像|更换头像)[:：\]]/.test(l);
    const contentLines = lines.filter(l => !isCmdLine(l));
    if (contentLines.length) {
      msgItems.push({ type: 'text', text: contentLines[contentLines.length - 1] });
    }
    // 整条回复只有指令标签（如仅心声）时不推气泡：心声卡片本身就是这次的回复
  }

  msgItems.forEach((item, i) => {
    setTimeout(() => {
      if (item.type === 'sticker') {
        pushMsg(pid, { id: 'm_' + uid(), role: 'them', type: 'sticker', text: item.text, stickerName: item.stickerName, time: Date.now() });
      } else {
        pushMsg(pid, { id: 'm_' + uid(), role: 'them', type: 'text', text: item.text, time: Date.now() });
      }
      renderThread();
    }, (i + 1) * 380);
  });

  if (S.tab !== 'chat') renderTab('chat');
}

/* ================================================================
   四、发现（Discover · 包含朋友圈独立入口与添加小程序功能）
   ================================================================ */
function renderDiscover(host) {
  const apps = S.miniapps || [];
  const latestMo = (S.moments || []).slice().sort((a, b) => b.time - a.time)[0];
  const latestAuthor = latestMo ? authorOf(latestMo) : null;

  let html = `
    <div class="discover-wrap">
      <!-- 发现首选核心行：朋友圈独立入口 -->
      <div class="discover-group">
        <div class="discover-item" id="disc-go-moments">
          <div class="discover-icon" style="background:linear-gradient(135deg, #10b981, #059669);">
            <svg viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>
          </div>
          <div class="discover-info">
            <div class="discover-title">朋友圈</div>
            <div class="discover-desc">${latestMo ? `${esc(latestAuthor ? latestAuthor.name : '有人')}：${esc(latestMo.text || '[图片]')}` : '记录此刻美好生活与心动瞬间'}</div>
          </div>
          ${latestMo && latestAuthor && latestAuthor.avatar ? `
            <img src="${latestAuthor.avatar}" style="width:30px;height:30px;border-radius:6px;object-fit:cover;margin-right:4px;">
          ` : ''}
          <div class="discover-arrow">›</div>
        </div>
      </div>

      <!-- 专属小程序分组 -->
      <div class="discover-sec-hdr">
        <span>小程序 & 服务</span>
        <div class="discover-add-btn" id="disc-add-miniapp">
          <svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"></path></svg>
          <span>添加小程序</span>
        </div>
      </div>

      <div class="discover-group">
        <div class="miniapp-grid">
          ${apps.map((app, idx) => `
            <div class="miniapp-item" data-idx="${idx}">
              <div class="miniapp-icon" style="background:${app.bg || '#34527c'};">
                <svg><use href="#${app.icon || 'i-miniapp'}"></use></svg>
              </div>
              <div class="miniapp-name">${esc(app.name)}</div>
            </div>
          `).join('')}
          <div class="miniapp-item" id="disc-grid-add">
            <div class="miniapp-icon" style="background:var(--line-soft);border:1.5px dashed var(--silver);color:var(--text-3);">
              <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"></path></svg>
            </div>
            <div class="miniapp-name" style="color:var(--text-3)">添加</div>
          </div>
        </div>
      </div>

      <!-- 浪漫生活小组件 -->
      <div class="discover-group">
        <div class="discover-item" id="disc-camellia-fm">
          <div class="discover-icon" style="background:linear-gradient(135deg, #3b82f6, #1d4ed8);">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"></polygon></svg>
          </div>
          <div class="discover-info">
            <div class="discover-title">山茶听听 · 浪漫电台</div>
            <div class="discover-desc">海风微抚与白山茶的午后絮语</div>
          </div>
          <div class="discover-arrow">›</div>
        </div>
        <div class="discover-item" id="disc-capsule">
          <div class="discover-icon" style="background:linear-gradient(135deg, #f59e0b, #d97706);">
            <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>
          </div>
          <div class="discover-info">
            <div class="discover-title">漂流瓶 · 寄给未来的信</div>
            <div class="discover-desc">投递一枚在心底埋藏已久的心事</div>
          </div>
          <div class="discover-arrow">›</div>
        </div>
      </div>
    </div>
  `;
  host.innerHTML = html;

  // 绑定事件
  $('#disc-go-moments').onclick = () => renderTab('moments');
  $('#disc-add-miniapp').onclick = promptAddMiniApp;
  $('#disc-grid-add').onclick = promptAddMiniApp;

  $('#disc-camellia-fm').onclick = () => {
    toast('正在播放：《海盐与白山茶 · 0.8倍速微风》♡');
  };
  $('#disc-capsule').onclick = () => {
    openSheet({
      title: '漂流瓶 · 寄给未来的信',
      body: `
        <div class="field"><textarea class="field-input" id="capsule-text" placeholder="写一句悄悄话装进瓶子里，扔向海盐海浪..."></textarea></div>
      `,
      footer: `<div style="padding:10px 20px 4px"><button class="btn-main" id="capsule-send">扔向大海</button></div>`,
      after() {
        $('#capsule-send').onclick = () => {
          const t = $('#capsule-text').value.trim();
          if (!t) { toast('请写下想说的心事'); return; }
          closeSheet();
          toast('瓶子乘着晚风漂向远方，也许阿愿待会就能捡到...');
        };
      }
    });
  };

  host.querySelectorAll('.miniapp-item[data-idx]').forEach(el => {
    el.onclick = () => {
      const idx = +el.dataset.idx;
      const app = (S.miniapps || [])[idx];
      if (!app) return;
      openMiniApp(app, idx);
    };
  });
}

function promptAddMiniApp() {
  const iconOptions = [
    { id: 'i-sticker', label: '便签/贴纸' },
    { id: 'i-heart',   label: '浪漫爱心' },
    { id: 'i-lock',    label: '秘密日记' },
    { id: 'i-bubble',  label: '聊天灵感' },
    { id: 'i-wallet',  label: '恋爱记账' },
    { id: 'i-cam',     label: '胶卷相机' }
  ];
  let curIcon = 'i-heart';

  openSheet({
    title: '添加新小程序',
    body: `
      <div class="field">
        <div class="field-label">小程序名称</div>
        <input class="field-input" id="new-app-name" placeholder="例如：恋爱清单 / 记账 / 每日占卜" maxlength="12">
      </div>
      <div class="field">
        <div class="field-label">功能简介</div>
        <input class="field-input" id="new-app-desc" placeholder="简短的一句描述" maxlength="24">
      </div>
      <div class="field">
        <div class="field-label">选择图标</div>
        <div style="display:flex;gap:10px;margin-top:6px;flex-wrap:wrap;">
          ${iconOptions.map(opt => `
            <div class="sheet-icon-pick ${opt.id === curIcon ? 'active' : ''}" data-icon="${opt.id}" style="padding:8px 12px;border-radius:12px;background:var(--line-soft);display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;">
              <svg style="width:16px;height:16px;"><use href="#${opt.id}"></use></svg>
              <span>${opt.label}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `,
    footer: `<div style="padding:10px 20px 4px"><button class="btn-main" id="new-app-submit">确认添加</button></div>`,
    after(sheet) {
      sheet.querySelectorAll('.sheet-icon-pick').forEach(el => {
        el.onclick = () => {
          sheet.querySelectorAll('.sheet-icon-pick').forEach(x => x.classList.remove('active'));
          el.classList.add('active');
          curIcon = el.dataset.icon;
        };
      });

      $('#new-app-submit').onclick = () => {
        const name = $('#new-app-name').value.trim();
        const desc = $('#new-app-desc').value.trim() || '随手记录与专属生活服务';
        if (!name) { toast('请填写小程序名称'); return; }

        const gradients = [
          'linear-gradient(135deg, #fa709a, #fee140)',
          'linear-gradient(135deg, #a18cd1, #fbc2eb)',
          'linear-gradient(135deg, #84fab0, #8fd3f4)',
          'linear-gradient(135deg, #f093fb, #f5576c)',
          'linear-gradient(135deg, #4facfe, #00f2fe)'
        ];
        const randomBg = gradients[Math.floor(Math.random() * gradients.length)];

        if (!S.miniapps) S.miniapps = [];
        S.miniapps.push({
          id: 'mini_' + uid(),
          name,
          desc,
          icon: curIcon,
          bg: randomBg
        });
        persist();
        closeSheet();
        renderTab('discover');
        toast(`小程序「${name}」已添加`);
      };
    }
  });
}

function openMiniApp(app, idx) {
  openSheet({
    title: app.name,
    sub: app.desc,
    body: `
      <div style="text-align:center;padding:26px 14px;">
        <div style="width:68px;height:68px;border-radius:20px;background:${app.bg};margin:0 auto 16px;display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.15);">
          <svg style="width:34px;height:34px;fill:none;stroke:currentColor;stroke-width:1.8;"><use href="#${app.icon || 'i-miniapp'}"></use></svg>
        </div>
        <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:6px;">${esc(app.name)}</div>
        <div style="font-size:13px;color:var(--text-3);line-height:1.6;margin-bottom:20px;">${esc(app.desc)}<br>该小程序运行在《海盐白山茶》生态轻量沙盒中。</div>
        <button class="btn-ghost" id="miniapp-delete" style="color:var(--warn);border-color:rgba(220,53,69,.25);">移除此小程序</button>
      </div>
    `,
    after() {
      $('#miniapp-delete').onclick = () => {
        S.miniapps.splice(idx, 1);
        persist();
        closeSheet();
        renderTab('discover');
        toast(`已移除小程序「${app.name}」`);
      };
    }
  });
}

/* ================================================================
   五、朋友圈（支持更换背景图与头像、白山茶默认封面）
   ================================================================ */
function renderMoments(host) {
  const me = S.account;
  const list = S.moments.slice().sort((a, b) => b.time - a.time);
  const coverUrl = S.cover || 'camellia_cover.svg';

  let html = `
    <div class="mo-cover" id="mo-cover-bg" title="轻点更换朋友圈背景">
      <img src="${coverUrl}" id="mo-cover-img" alt="">
      <div class="mo-me">
        <div class="mo-me-name">${esc(me.nickname)}</div>
        <div class="mo-me-av-wrap" id="mo-me-av-trigger" title="轻点更换头像">
          ${avatarHtml(me, 'lg round')}
          <div class="mo-me-av-cam">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
          </div>
        </div>
      </div>
    </div>
    <input type="file" id="mo-cover-input" accept="image/*" hidden>
    <input type="file" id="mo-avatar-input" accept="image/*" hidden>
    <div class="mo-feed">`;

  if (!list.length) {
    html += `<div class="empty" style="padding:56px 40px">
      <svg><use href="#i-moments"></use></svg>
      <p>朋友圈还是空的<br>发点什么，或者让某个他先说一句</p>
      <button class="mini-btn" id="mo-first">发第一条</button>
    </div>`;
  } else {
    list.forEach(m => { html += momentHtml(m); });
  }
  html += `</div>`;
  host.innerHTML = html;

  // 绑定更换背景与头像
  $('#mo-cover-bg').onclick = e => {
    if (e.target.closest('#mo-me-av-trigger')) return;
    changeCoverPhoto();
  };
  $('#mo-cover-input').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      S.cover = r.result;
      persist();
      renderTab('moments');
      toast('朋友圈背景已更新 ♡');
    };
    r.readAsDataURL(f);
  };

  $('#mo-me-av-trigger').onclick = () => $('#mo-avatar-input').click();
  $('#mo-avatar-input').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      S.account.avatar = r.result;
      const target = S.accounts.find(a => a.id === S.curUid);
      if (target) target.avatar = r.result;
      persist();
      renderTab('moments');
      toast('头像已更新 ♡');
    };
    r.readAsDataURL(f);
  };

  if ($('#mo-first')) $('#mo-first').onclick = composeMoment;
  host.querySelectorAll('.mo-act[data-act]').forEach(el => {
    el.onclick = () => {
      const id = el.dataset.mid;
      if (el.dataset.act === 'like') toggleLike(id);
      if (el.dataset.act === 'cmt') commentMoment(id);
    };
  });
}

function changeCoverPhoto() {
  openSheet({
    title: '朋友圈封面',
    items: [
      { icon:'i-cam', text:'从手机相册自选照片', act: () => $('#mo-cover-input').click() },
      { icon:'i-moments', text:'恢复经典白山茶封面', act: () => {
          S.cover = 'camellia_cover.svg';
          persist();
          renderTab('moments');
          toast('已恢复为白山茶封面 ♡');
        } }
    ]
  });
}

function authorOf(m) {
  if (m.author === 'me') return S.account;
  const p = S.personas.find(x => x.id === m.author);
  return p ? displayOf(p) : { name: '某人', avatar: '' };
}

function momentHtml(m) {
  const a = authorOf(m);
  const liked = (m.likes || []).includes('me');
  const imgs = (m.images || []).slice(0, 9);
  const imgsHtml = imgs.length
    ? `<div class="mo-imgs ${imgs.length === 1 ? 'one' : ''}">${imgs.map(u => `<img src="${u}" alt="">`).join('')}</div>`
    : '';
  const cmts = (m.comments || []).length
    ? `<div class="mo-cmts">${m.comments.map(c => `<div class="mo-cmt"><b>${esc(c.by)}</b>：${esc(c.text)}</div>`).join('')}</div>`
    : '';
  return `<div class="mo">
    ${avatarHtml(a)}
    <div class="mo-main">
      <div class="mo-name">${esc(a.name)}</div>
      ${m.text ? `<div class="mo-text">${esc(m.text)}</div>` : ''}
      ${imgsHtml}
      <div class="mo-bar">
        <div class="mo-act ${liked ? 'on' : ''}" data-act="like" data-mid="${m.id}">
          <svg><use href="#i-heart"></use></svg><span>${(m.likes || []).length || '赞'}</span>
        </div>
        <div class="mo-act" data-act="cmt" data-mid="${m.id}">
          <svg><use href="#i-bubble"></use></svg><span>评论</span>
        </div>
      </div>
      <div class="mo-time">${fmtRowTime(m.time)}</div>
      ${cmts}
    </div>
  </div>`;
}

function toggleLike(id) {
  const m = S.moments.find(x => x.id === id);
  if (!m) return;
  m.likes = m.likes || [];
  const i = m.likes.indexOf('me');
  if (i >= 0) m.likes.splice(i, 1); else m.likes.push('me');
  saveMoments(); renderTab('moments');
}
function commentMoment(id) {
  openSheet({
    title: '评论',
    body: `<div class="field"><input class="field-input" id="cm-t" maxlength="60" placeholder="说点什么"></div>`,
    footer: `<div style="padding:10px 20px 4px"><button class="btn-main" id="cm-go">发送</button></div>`,
    after() {
      $('#cm-go').onclick = () => {
        const t = $('#cm-t').value.trim();
        if (!t) return;
        const m = S.moments.find(x => x.id === id);
        m.comments = m.comments || [];
        m.comments.push({ by: S.account.nickname, text: t });
        saveMoments(); closeSheet(); renderTab('moments');
      };
    }
  });
}

function composeMoment() {
  let imgs = [];
  const per = S.personas.map(p => `<div class="sheet-item" data-as="${p.id}">
      ${avatarHtml(displayOf(p), 'sm')}<span style="flex:1">以「${esc(displayOf(p).name)}」的身份发一条</span></div>`).join('');
  openSheet({
    title: '发朋友圈',
    body: `
      <div class="field"><textarea class="field-input" id="mc-t" placeholder="此刻在想什么"></textarea></div>
      <div id="mc-imgs" style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:14px"></div>
      <input type="file" id="mc-file" accept="image/*" multiple hidden>
      <button class="btn-ghost" id="mc-add" style="margin-top:0">＋ 添加图片</button>
      ${per ? `<div class="sec-title" style="padding-left:0">让谁说</div>${per}` : ''}
    `,
    footer: `<div style="padding:10px 20px 4px"><button class="btn-main" id="mc-go">发布</button></div>`,
    after() {
      const draw = () => {
        $('#mc-imgs').innerHTML = imgs.map((u, i) =>
          `<div style="position:relative"><img src="${u}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:9px">
           <div data-rm="${i}" style="position:absolute;top:-5px;right:-5px;width:19px;height:19px;border-radius:50%;background:rgba(40,48,60,.82);color:#fff;font-size:12px;line-height:19px;text-align:center">×</div></div>`).join('');
        $$('#mc-imgs [data-rm]').forEach(el => el.onclick = () => { imgs.splice(+el.dataset.rm, 1); draw(); });
      };
      $('#mc-add').onclick = () => $('#mc-file').click();
      $('#mc-file').onchange = e => {
        Array.from(e.target.files).slice(0, 9 - imgs.length).forEach(f => {
          const r = new FileReader();
          r.onload = () => { imgs.push(r.result); draw(); };
          r.readAsDataURL(f);
        });
        e.target.value = '';
      };
      $('#mc-go').onclick = () => {
        const t = $('#mc-t').value.trim();
        if (!t && !imgs.length) { toast('写点什么吧'); return; }
        S.moments.push({ id: uid(), author: 'me', text: t, images: imgs, likes: [], comments: [], time: Date.now() });
        saveMoments(); closeSheet(); renderTab('moments'); toast('发出去了');
      };
      $$('#sheet [data-as]').forEach(el => {
        el.onclick = () => { closeSheet(); personaMoment(el.dataset.as); };
      });
    }
  });
}

async function personaMoment(pid) {
  const p = S.personas.find(x => x.id === pid);
  if (!p) return;
  const cfg = apiSlots();
  const api = cfg.primary.ready ? cfg.primary : (cfg.secondary.ready ? cfg.secondary : null);
  if (!api) { toast('请先在小手机桌面设置好大模型 API'); return; }
  toast('他在想…');
  const sys = `你是${p.name}。${p.prompt || ''}
现在你要发一条朋友圈。内容是你此刻真实的生活片段：可能是一件小事、一个念头、看到的东西。
要求：1 到 2 句话，口语，可以有情绪。不要写成文章，不要用括号旁白，不要书名号引号破折号，不要 emoji 堆砌。只输出正文本身。`;
  try {
    const txt = await streamChat(api,
      [{ role: 'system', content: sys }, { role: 'user', content: '发一条朋友圈。' }], 0.95, null);
    const clean = txt.trim().split('\n').filter(Boolean).join(' ');
    if (!clean) throw new Error('空');
    S.moments.push({ id: uid(), author: pid, text: clean, images: [], likes: [], comments: [], time: Date.now() });
    saveMoments(); renderTab('moments');
    toast('他更新了朋友圈 ♡');
  } catch (e) {
    toast('没发出来：' + e.message.slice(0, 40));
  }
}

/* ================================================================
   六、Profile（我）—— 1:1 参考图卡片设计
   ================================================================ */
function renderMe(host) {
  if (!host) return;
  if (!S.account) {
    if (S.accounts && S.accounts.length) {
      S.account = S.accounts[0];
      S.curUid = S.account.id;
    } else {
      S.account = { id: 'acc_def', nickname: '宋遇', username: 'user_def', sign: '我们期盼同一个冬', masks: [] };
    }
  }
  const a = S.account;
  const curMask = getCurrentMask();
  const displayName = (curMask && curMask.name) || a.nickname || '未命名面具';
  const displayAv = (curMask && curMask.avatar) || a.avatar;
  const maskTags = curMask ? [
    curMask.gender && curMask.gender !== '保密' ? curMask.gender : '',
    curMask.age && curMask.age !== '保密' ? `${curMask.age}岁` : '',
    curMask.birthday ? curMask.birthday : ''
  ].filter(Boolean).join(' · ') : '';
  const displayDesc = (curMask && (curMask.background || curMask.tone)) || a.sign || '我们期盼同一个冬';

  host.innerHTML = `
    <!-- 顶部极简名片卡（无大 Profile 标题，参考图样式） -->
    <div style="height: 6px;"></div>
    <div class="profile-card-island">
      <div class="acc-mask-card is-current" style="margin-bottom:0">
        <div class="acc-mask-av-wrap" id="me-avatar-btn" title="轻点更换面具头像" style="cursor:pointer">
          ${avatarHtml({ avatar: displayAv, nickname: displayName }, 'round lg')}
          <div class="profile-cam-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
          </div>
        </div>
        <input type="file" id="me-avatar-file" accept="image/*" hidden>

        <div class="acc-mask-info">
          <div class="acc-mask-row-top">
            <div class="acc-mask-name">${esc(displayName)}</div>
            <button class="acc-mask-switch-btn" id="me-top-switch-btn">
              切换账号 ⇄
            </button>
          </div>
          <div class="acc-mask-no" style="font-size:11.5px;color:var(--text-sub);margin-top:2px">${esc(maskTags ? '面具 · ' + maskTags : '账号：' + (a.username || '已登录'))}</div>
          <div class="acc-mask-sign" style="font-size:12px;margin-top:3px">${esc(displayDesc)}</div>
        </div>

        <div class="acc-mask-arrow-btn" id="me-top-edit-arrow" title="管理当前账号的面具人设">›</div>
      </div>
    </div>

    <div style="height: 14px;"></div>

    <!-- 花瓣特效开关 -->
    <div class="profile-menu-card" style="margin:0 0 14px 0;">
      <div class="profile-menu-item" id="me-petal-toggle" style="cursor:default;">
        <div class="profile-menu-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2.5C16.5 5.5 19 9.5 19 13.5 19 18 15.8 21.5 12 21.5 8.2 21.5 5 18 5 13.5 5 9.5 7.5 5.5 12 2.5Z"></path></svg>
        </div>
        <div class="profile-menu-label">飘落花瓣</div>
        <div class="profile-menu-extra" id="me-petal-state">${S.prefs.petals === false ? '关闭' : '开启'}</div>
        <div class="tg-switch ${S.prefs.petals === false ? '' : 'on'}" id="me-petal-switch" style="flex:0 0 auto;">
          <div class="tg-knob"></div>
        </div>
      </div>
    </div>

    <!-- 菜单列表组（钱包、面具库、表情包、收藏、设置） -->
    <div class="profile-menu-card" style="margin:0">
      <div class="profile-menu-item" id="me-wallet">
        <div class="profile-menu-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="18" height="13" rx="2.5"></rect><path d="M16 12.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0z"></path></svg>
        </div>
        <div class="profile-menu-label">钱包</div>
        <div class="profile-menu-extra">¥ ${S.wallet ? S.wallet.balance.toFixed(2) : '520.00'}</div>
        <div class="profile-menu-arrow">›</div>
      </div>

      <div class="profile-menu-item" id="me-mask">
        <div class="profile-menu-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
        </div>
        <div class="profile-menu-label">面具库</div>
        <div class="profile-menu-extra">${(a.masks || []).length || 1} 个面具</div>
        <div class="profile-menu-arrow">›</div>
      </div>

      <div class="profile-menu-item" id="me-sticker">
        <div class="profile-menu-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"></path></svg>
        </div>
        <div class="profile-menu-label">表情包</div>
        <div class="profile-menu-extra">${S.stickers.length ? S.stickers.length + ' 个' : ''}</div>
        <div class="profile-menu-arrow">›</div>
      </div>

      <div class="profile-menu-item" id="me-fav">
        <div class="profile-menu-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
        </div>
        <div class="profile-menu-label">收藏</div>
        <div class="profile-menu-arrow">›</div>
      </div>

      <div class="profile-menu-item" id="me-settings">
        <div class="profile-menu-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
        </div>
        <div class="profile-menu-label">设置</div>
        <div class="profile-menu-extra">${apiLabel()}</div>
        <div class="profile-menu-arrow">›</div>
      </div>
    </div>
    <div style="height: 26px;"></div>
  `;

  // 点击左侧大头像更换头像
  $('#me-avatar-btn').onclick = () => $('#me-avatar-file').click();
  $('#me-avatar-file').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const curM = getCurrentMask();
      if (curM) curM.avatar = r.result;
      S.account.avatar = r.result;
      const target = S.accounts.find(x => x.id === S.curUid);
      if (target) target.avatar = r.result;
      persist();
      renderTab('me');
      toast('面具头像已更新 ♡');
    };
    r.readAsDataURL(f);
  };

  // 点击名字旁边的【切换账号 ⇄】
  $('#me-top-switch-btn').onclick = openSwitchAccountSheet;

  // 点击最右边的小箭头：直接编辑当前面具人设（不再打开列表切换）
  $('#me-top-edit-arrow').onclick = () => {
    const curM = getCurrentMask();
    if (curM) {
      openSingleMaskEditor(curM, false);
    } else {
      openAccountMaskManager();
    }
  };

  // 菜单事件绑定
  $('#me-wallet').onclick = openWallet;
  $('#me-mask').onclick = openAccountMaskManager;
  $('#me-sticker').onclick = openStickers;
  $('#me-fav').onclick = openFavorites;
  $('#me-settings').onclick = showApiStatus;

  // 花瓣特效开关
  const petalSwitch = $('#me-petal-switch');
  petalSwitch.onclick = () => {
    petalSwitch.classList.toggle('on');
    const on = petalSwitch.classList.contains('on');
    S.prefs.petals = on;
    persist();
    $('#me-petal-state').textContent = on ? '开启' : '关闭';
    const layer = document.getElementById('petal-bg-layer');
    if (layer) layer.style.opacity = on ? '1' : '0';
    if (window.__petalSetEnabled) window.__petalSetEnabled(on);
    toast(on ? '花瓣已飘起 ♡' : '花瓣已收起');
  };
}

/* ---------------- 面具库管理（单开独立全屏页面，绝不弹半栏） ---------------- */
function openAccountMaskManager() {
  const acc = S.account;
  if (!acc.masks || !acc.masks.length) {
    const defMid = 'mask_' + (acc.id || uid());
    acc.masks = [{
      id: defMid,
      name: acc.nickname || '',
      gender: '',
      birthday: '',
      age: '',
      appearance: '',
      tone: '',
      background: acc.sign || '',
      avatar: acc.avatar || ''
    }];
    acc.currentMaskId = defMid;
    persist();
  }
  if (!acc.currentMaskId && acc.masks.length > 0) {
    acc.currentMaskId = acc.masks[0].id;
  }

  const maskListHtml = acc.masks.map(m => {
    const isCurMask = (acc.currentMaskId === m.id);
    const tags = [
      m.gender,
      m.age ? `${m.age}岁` : '',
      m.birthday
    ].filter(Boolean).join(' · ');

    return `
      <div class="acc-mask-card ${isCurMask ? 'is-current' : ''}" style="margin-bottom:12px">
        <div class="acc-mask-av-wrap" data-act="wear-mask" data-mid="${m.id}" style="cursor:pointer">
          ${avatarHtml({ avatar: m.avatar, nickname: m.name || '面具' }, 'round lg')}
        </div>
        <div class="acc-mask-info" data-act="wear-mask" data-mid="${m.id}" style="cursor:pointer">
          <div class="acc-mask-row-top">
            <div class="acc-mask-name">${esc(m.name || '未命名面具')}</div>
            <button class="acc-mask-switch-btn ${isCurMask ? 'is-active' : ''}">
              ${isCurMask ? '使用中' : '戴上面具'}
            </button>
          </div>
          <div class="acc-mask-no" style="font-size:11.5px;color:var(--text-sub);margin-top:2px">
            ${esc(tags || '点击右侧编辑完善人设')}
          </div>
          <div class="acc-mask-sign" style="font-size:12px;color:var(--text-main);margin-top:4px">
            ${esc(m.background || m.tone || '暂无人设背景描述')}
          </div>
        </div>
        <div class="acc-mask-arrow-btn" title="编辑该面具" data-act="edit-mask" data-mid="${m.id}">›</div>
      </div>
    `;
  }).join('');

  openSubpage({
    title: '我的面具库',
    rightBtn: `
      <button class="hdr-btn" id="subpane-add-mask-btn" title="添加面具">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>
      </button>
    `,
    bodyHtml: `
      <div style="font-size:12.5px;color:var(--text-3);margin-bottom:14px;padding:0 2px;">
        当前账号专属身份库。轻触面具卡片即可佩戴切换，点右侧箭头定制细节。
      </div>
      <div id="subpane-mask-list">
        ${maskListHtml}
      </div>
    `,
    onMount(pane) {
      pane.querySelectorAll('[data-act="wear-mask"]').forEach(el => {
        el.onclick = () => {
          const mid = el.dataset.mid;
          const target = acc.masks.find(m => m.id === mid);
          if (target) {
            acc.currentMaskId = target.id;
            acc.nickname = target.name || acc.nickname;
            if (target.avatar) acc.avatar = target.avatar;
            persist();
            renderTab(S.tab);
            toast(`已戴上面具：${target.name || '未命名面具'}`);
            openAccountMaskManager();
          }
        };
      });

      pane.querySelectorAll('[data-act="edit-mask"]').forEach(el => {
        el.onclick = e => {
          e.stopPropagation();
          const mid = el.dataset.mid;
          const target = acc.masks.find(m => m.id === mid);
          if (target) openSingleMaskEditor(target, false);
        };
      });

      const addBtn = $('#subpane-add-mask-btn');
      if (addBtn) {
        addBtn.onclick = () => {
          const newM = {
            id: 'mask_' + uid(),
            name: '',
            gender: '',
            birthday: '',
            age: '',
            appearance: '',
            tone: '',
            background: '',
            avatar: ''
          };
          openSingleMaskEditor(newM, true);
        };
      }
    }
  });
}

/* 编辑单独面具（单开独立全屏页面） */
function openSingleMaskEditor(mask, isNew = false) {
  let tempAv = mask.avatar || '';
  openSubpage({
    title: isNew ? '创建新面具' : '编辑面具人设',
    rightBtn: `
      <button class="hdr-btn" id="subpane-save-mask-btn" style="color:var(--accent);font-weight:600;font-size:14px;width:auto;padding:0 6px;">
        保存
      </button>
    `,
    bodyHtml: `
      <div style="display:flex;justify-content:center;margin:10px 0 20px">
        <div class="avatar-pick" id="sm-av-pick" style="margin:0" title="点击更换面具头像">
          ${tempAv ? `<img src="${tempAv}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : `<svg class="ap-ico"><use href="#i-cam"></use></svg><span>面具头像</span>`}
        </div>
      </div>
      <input type="file" id="sm-file-input" accept="image/*" hidden>

      <div class="field">
        <div class="field-label">面具名称</div>
        <input class="field-input" id="sm-name-in" maxlength="16" value="${esc(mask.name || '')}" placeholder="输入面具名称，例如：宋遇、祈语隐喻">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="field">
          <div class="field-label">性别</div>
          <input class="field-input" id="sm-gender-in" maxlength="8" value="${esc(mask.gender || '')}" placeholder="例如：女 / 男">
        </div>
        <div class="field">
          <div class="field-label">年龄</div>
          <input class="field-input" id="sm-age-in" maxlength="8" value="${esc(mask.age || '')}" placeholder="例如：20">
        </div>
      </div>

      <div class="field">
        <div class="field-label">生日</div>
        <input class="field-input" id="sm-birth-in" maxlength="16" value="${esc(mask.birthday || '')}" placeholder="例如：11月25日">
      </div>

      <div class="field">
        <div class="field-label">外貌特征描述</div>
        <textarea class="field-input" id="sm-appear-in" rows="2" placeholder="发型、穿搭、眼神等视觉细节">${esc(mask.appearance || '')}</textarea>
      </div>

      <div class="field">
        <div class="field-label">说话口吻与语气</div>
        <textarea class="field-input" id="sm-tone-in" rows="2" placeholder="温和轻快、偶尔傲娇、寡言等">${esc(mask.tone || '')}</textarea>
      </div>

      <div class="field">
        <div class="field-label">专属身世背景</div>
        <textarea class="field-input" id="sm-bg-in" rows="3" placeholder="人设经历、日常状态与相遇故事">${esc(mask.background || '')}</textarea>
      </div>

      ${!isNew && S.account.masks && S.account.masks.length > 1 ? `
        <button class="btn-ghost" id="sm-del-mask-btn" style="color:var(--warn);border-color:rgba(224,82,82,.25);margin-top:14px">
          删除该面具
        </button>
      ` : ''}
    `,
    onMount(pane) {
      $('#sm-av-pick').onclick = () => $('#sm-file-input').click();
      $('#sm-file-input').onchange = e => {
        const f = e.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => {
          tempAv = r.result;
          $('#sm-av-pick').innerHTML = `<img src="${tempAv}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
        };
        r.readAsDataURL(f);
      };

      $('#subpane-save-mask-btn').onclick = () => {
        const inputName = $('#sm-name-in').value.trim();
        mask.name = inputName || mask.name || '未命名面具';
        mask.gender = $('#sm-gender-in').value.trim();
        mask.age = $('#sm-age-in').value.trim();
        mask.birthday = $('#sm-birth-in').value.trim();
        mask.appearance = $('#sm-appear-in').value.trim();
        mask.tone = $('#sm-tone-in').value.trim();
        mask.background = $('#sm-bg-in').value.trim();
        mask.avatar = tempAv;

        if (isNew) {
          if (!S.account.masks) S.account.masks = [];
          S.account.masks.push(mask);
        }

        if (S.account.currentMaskId === mask.id || isNew) {
          S.account.currentMaskId = mask.id;
          S.account.nickname = mask.name;
          if (mask.avatar) S.account.avatar = mask.avatar;
        }

        persist();
        renderTab(S.tab);
        openAccountMaskManager();
        toast(isNew ? '新面具已创建并佩戴 ♡' : '面具人设已保存 ♡');
      };

      const del = $('#sm-del-mask-btn');
      if (del) {
        del.onclick = () => {
          if (confirm('确定删除该面具吗？')) {
            const idx = S.account.masks.findIndex(m => m.id === mask.id);
            if (idx >= 0) {
              S.account.masks.splice(idx, 1);
              if (S.account.currentMaskId === mask.id) {
                S.account.currentMaskId = S.account.masks[0].id;
                S.account.nickname = S.account.masks[0].name;
                if (S.account.masks[0].avatar) S.account.avatar = S.account.masks[0].avatar;
              }
              persist();
            }
            renderTab(S.tab);
            openAccountMaskManager();
            toast('面具已删除');
          }
        };
      }
    }
  });
}

function apiLabel() {
  const c = apiSlots();
  if (c.primary.ready && c.secondary.ready) return '主 · 副 就绪';
  if (c.primary.ready) return '主 API 就绪';
  if (c.secondary.ready) return '副 API 就绪';
  return '未配置';
}

function showApiStatus() {
  const c = apiSlots();
  const line = (t, s) => `<div class="bill"><div class="bill-main">
      <div class="bill-t">${t}</div>
      <div class="bill-d">${s.ready ? esc(s.model + ' · ' + s.url.replace(/^https?:\/\//, '').slice(0, 32)) : '未配置'}</div>
    </div><div class="bill-v ${s.ready ? 'in' : 'out'}">${s.ready ? '就绪' : '空'}</div></div>`;
  openSheet({
    title: '系统接口状态',
    sub: '大模型统一在小手机桌面的【设置】维护，这里自动共享。',
    body: line('主 API 线路', c.primary) + line('副 API 线路', c.secondary),
    items: [
      { icon:'i-gear', text:'外观主题切换', act: openThemeSheet },
      { icon:'i-me',   text:'切换或登录其他账号', act: openSwitchAccountSheet }
    ]
  });
}

function editAccount() {
  let av = S.account.avatar;
  openSheet({
    title: '编辑资料',
    body: `
      <div style="display:flex;justify-content:center;margin-bottom:18px">
        <div class="avatar-pick" id="ac-av" style="margin:0">
          ${av ? `<img src="${av}" alt="">` : `<svg class="ap-ico"><use href="#i-cam"></use></svg><span>头像</span>`}
        </div>
      </div>
      <input type="file" id="ac-file" accept="image/*" hidden>
      <div class="field"><div class="field-label">网名</div>
        <input class="field-input" id="ac-name" maxlength="16" value="${esc(S.account.nickname)}"></div>
      <div class="field"><div class="field-label">个性签名</div>
        <input class="field-input" id="ac-sign" maxlength="40" value="${esc(S.account.sign || '')}"></div>
    `,
    footer: `<div style="padding:10px 20px 4px"><button class="btn-main" id="ac-save">保存</button></div>`,
    after() {
      $('#ac-av').onclick = () => $('#ac-file').click();
      $('#ac-file').onchange = e => {
        const f = e.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => { av = r.result; $('#ac-av').innerHTML = `<img src="${av}" alt="">`; };
        r.readAsDataURL(f);
      };
      $('#ac-save').onclick = () => {
        S.account.nickname = $('#ac-name').value.trim() || S.account.nickname;
        S.account.sign = $('#ac-sign').value.trim();
        S.account.avatar = av;
        const target = S.accounts.find(x => x.id === S.curUid);
        if (target) {
          target.nickname = S.account.nickname;
          target.sign = S.account.sign;
          target.avatar = av;
        }
        persist(); closeSheet(); renderTab('me'); toast('资料已保存 ♡');
      };
    }
  });
}

/* ---------------- 钱包（单开独立全屏页面，告别半栏弹层） ---------------- */
function openWallet() {
  const rs = S.wallet.records || [];
  const bills = rs.length ? rs.map(r => `
    <div class="bill"><div class="bill-main">
      <div class="bill-t">${esc(r.t)}</div>
      <div class="bill-d">${fmtFull(r.time)}</div>
    </div><div class="bill-v ${r.a >= 0 ? 'in' : 'out'}">${r.a >= 0 ? '+' : '−'} ${Math.abs(r.a).toFixed(2)}</div></div>`).join('')
    : `<div class="empty" style="padding:36px 20px"><p>还没有流水记录</p></div>`;

  openSubpage({
    title: '我的钱包',
    bodyHtml: `
      <div class="wal-card" style="margin:4px 0 16px">
        <div class="wal-label">零钱余额</div>
        <div class="wal-amt"><small>¥</small>${S.wallet.balance.toFixed(2)}</div>
        <div class="wal-sub">端侧模拟 · 真实转账联动扣减与退还</div>
      </div>
      <div class="wal-acts" style="padding:0 0 16px">
        <div class="wal-act" id="wl-in">存入零钱</div>
        <div class="wal-act" id="wl-out">取出零钱</div>
      </div>
      <div class="sec-title" style="padding-left:0;margin-bottom:8px">零钱明细</div>
      <div style="background:var(--card);border-radius:18px;overflow:hidden;border:1px solid var(--line);padding:0 14px;">
        ${bills}
      </div>
    `,
    onMount(pane) {
      const move = sign => {
        const amtStr = prompt(sign > 0 ? '请输入存入金额：' : '请输入取出金额：', '100');
        if (!amtStr) return;
        const v = parseFloat(amtStr);
        if (!v || v <= 0) { toast('金额不对'); return; }
        if (sign < 0 && v > S.wallet.balance) { toast('零钱余额不足'); return; }
        S.wallet.balance += sign * v;
        S.wallet.records.unshift({ t: sign > 0 ? '存入零钱' : '取出零钱', a: sign * v, time: Date.now() });
        saveWallet(); persist();
        renderTab('me');
        openWallet();
        toast(sign > 0 ? '已成功存入零钱' : '已成功取出零钱');
      };
      $('#wl-in').onclick = () => move(1);
      $('#wl-out').onclick = () => move(-1);
    }
  });
}

/* ---------------- 收藏（单开独立全屏页面，展示长按收藏的消息） ---------------- */
function openFavorites() {
  const favs = S.favorites || [];
  let bodyHtml = '';

  if (!favs.length) {
    bodyHtml = `
      <div class="empty" style="padding:60px 20px">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".4"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
        <p>还没有收藏任何内容<br>在聊天中长按 TA 发来的消息，即可选择「收藏」</p>
      </div>
    `;
  } else {
    bodyHtml = `
      <div style="font-size:12px;color:var(--text-3);margin-bottom:12px;padding:0 2px;">
        共收藏了 ${favs.length} 条心动切片与对话
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        ${favs.map((f, idx) => `
          <div class="fav-card" style="background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px 16px;box-shadow:var(--shadow-sm);position:relative;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <div style="display:flex;align-items:center;gap:8px;">
                ${f.avatar ? `<img src="${f.avatar}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;">` : `<div style="width:24px;height:24px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;">${esc(cleanFirstChar(f.authorName))}</div>`}
                <span style="font-size:13px;font-weight:600;color:var(--text);">${esc(f.authorName || '心上人')}</span>
              </div>
              <span style="font-size:11px;color:var(--text-4);">${fmtFull(f.favTime || f.time)}</span>
            </div>
            <div style="font-size:14px;line-height:1.55;color:var(--text);word-break:break-word;padding:4px 0 8px;">
              ${esc(f.text)}
            </div>
            <div style="display:flex;justify-content:flex-end;border-top:1px solid var(--line-soft);padding-top:8px;">
              <button class="csb-btn danger" data-act="del-fav" data-fidx="${idx}" style="font-size:11.5px;padding:3px 8px;">取消收藏</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  openSubpage({
    title: '我的收藏',
    bodyHtml,
    onMount(pane) {
      pane.querySelectorAll('[data-act="del-fav"]').forEach(btn => {
        btn.onclick = () => {
          const idx = parseInt(btn.dataset.fidx, 10);
          if (!isNaN(idx)) {
            S.favorites.splice(idx, 1);
            saveFavorites(); persist();
            openFavorites();
            toast('已移出收藏');
          }
        };
      });
    }
  });
}

/* ---------------- 表情包管理与添加（单开独立全屏页面，支持链接/相册添加与命名） ---------------- */
function openStickers() {
  const list = (S.stickers || []).map((s, idx) => (
    typeof s === 'string'
      ? { id: 'st_' + idx, name: '表情' + (idx + 1), url: s }
      : { id: s.id || ('st_' + idx), name: s.name || ('表情' + (idx + 1)), url: s.url || '' }
  )).filter(s => s.url);
  S.stickers = list;

  const gridHtml = list.length ? `
    <div class="st-mgr-grid">
      ${list.map((s, i) => `
        <div class="st-mgr-card" data-idx="${i}">
          <div class="st-mgr-img-wrap" data-edit="${i}" title="点击修改表情名字">
            <img src="${esc(s.url)}" alt="${esc(s.name)}">
          </div>
          <div class="st-mgr-name" data-edit="${i}" title="点击修改表情名字">${esc(s.name)}</div>
          <button class="st-mgr-del" data-rm="${i}" title="删除">×</button>
        </div>
      `).join('')}
    </div>
  ` : `
    <div style="background:var(--card);border:1px dashed var(--line-strong);border-radius:18px;padding:28px 16px;text-align:center;color:var(--text-3);font-size:12.5px;margin-bottom:18px;">
      还没有添加任何表情包<br>在下方用「图片链接」或「手机相册」添加并起个名字，AI 聊天时也能看懂并用起来 ♡
    </div>
  `;

  openSubpage({
    title: '专属表情包',
    bodyHtml: `
      <div style="font-size:12px;color:var(--text-3);margin-bottom:12px;padding:0 2px;line-height:1.5;">
        给每个表情包起个名字（如：委屈猫猫、贴贴、叹气）。支持识图的模型会直接看表情画面，不支持识图的模型也能根据名字懂你的意思，并在聊天中主动发给你。
      </div>

      <!-- 添加新表情包卡片（支持链接添加 & 本地相册上传） -->
      <div style="background:var(--card);border:1px solid var(--line);border-radius:20px;padding:16px;box-shadow:var(--shadow-sm);margin-bottom:18px;">
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px;">+ 添加新表情包</div>

        <div class="field" style="margin-bottom:10px;">
          <div class="field-label">表情包名字（必填，供 AI 识别与调用）</div>
          <input class="field-input" id="st-new-name" maxlength="18" placeholder="例如：猫猫探头 / 抱抱 / 盯你">
        </div>

        <div class="field" style="margin-bottom:12px;">
          <div class="field-label">方式一：图片链接 URL（粘贴图片直链或 Base64）</div>
          <input class="field-input" id="st-new-url" placeholder="https://example.com/sticker.gif">
        </div>

        <!-- 实时预览区 -->
        <div id="st-new-preview-wrap" class="hidden" style="display:none;align-items:center;gap:12px;padding:10px 12px;background:var(--bg-subtle);border-radius:14px;margin-bottom:12px;">
          <img id="st-new-preview-img" src="" alt="" style="width:56px;height:56px;object-fit:contain;border-radius:10px;background:var(--card);border:1px solid var(--line);padding:4px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:600;color:var(--text);" id="st-new-preview-label">已选择图片</div>
            <div style="font-size:11px;color:var(--text-3);margin-top:2px;">确认名字后点击下方「保存添加」即可</div>
          </div>
          <button class="csb-btn danger" id="st-new-clear-btn" style="font-size:11.5px;padding:4px 8px;">清除</button>
        </div>

        <input type="file" id="st-file-input" accept="image/*" hidden>

        <div style="display:flex;gap:10px;">
          <button class="wal-act" id="st-pick-album-btn" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><use href="#i-img"></use></svg>
            <span>从相册选图</span>
          </button>
          <button class="btn-main" id="st-confirm-add-btn" style="flex:1.2;margin:0;padding:10px 0;">
            保存添加
          </button>
        </div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:0 2px;">
        <span style="font-size:13px;font-weight:600;color:var(--text-2);">已添加的表情 (${list.length})</span>
        ${list.length ? `<span style="font-size:11px;color:var(--text-4);">轻点表情可改名 · 点右上角 × 删除</span>` : ''}
      </div>

      ${gridHtml}
      <div style="height:28px;"></div>
    `,
    onMount(pane) {
      let pickedDataUrl = '';

      const nameIn = $('#st-new-name');
      const urlIn = $('#st-new-url');
      const prevWrap = $('#st-new-preview-wrap');
      const prevImg = $('#st-new-preview-img');
      const prevLabel = $('#st-new-preview-label');

      const updatePreview = (src, labelTxt) => {
        if (src) {
          prevImg.src = src;
          prevLabel.textContent = labelTxt || '图片预览';
          prevWrap.style.display = 'flex';
          prevWrap.classList.remove('hidden');
        } else {
          prevImg.src = '';
          prevWrap.style.display = 'none';
          prevWrap.classList.add('hidden');
        }
      };

      urlIn.oninput = () => {
        const v = urlIn.value.trim();
        if (v) {
          pickedDataUrl = '';
          updatePreview(v, '链接图片预览');
        } else if (!pickedDataUrl) {
          updatePreview('', '');
        }
      };

      $('#st-pick-album-btn').onclick = () => $('#st-file-input').click();

      $('#st-file-input').onchange = async e => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          // 若是 GIF 则保留原动图 DataURL，否则适度压缩省空间
          if (/gif/i.test(f.type)) {
            const r = new FileReader();
            r.onload = () => {
              pickedDataUrl = r.result;
              urlIn.value = '';
              updatePreview(pickedDataUrl, '已选相册动图：' + f.name);
              if (!nameIn.value.trim()) {
                nameIn.value = f.name.replace(/\.[^.]+$/, '').slice(0, 12);
              }
            };
            r.readAsDataURL(f);
          } else {
            const compressed = await compressImage(f, 360, 0.85);
            pickedDataUrl = compressed;
            urlIn.value = '';
            updatePreview(pickedDataUrl, '已选相册图片：' + f.name);
            if (!nameIn.value.trim()) {
              nameIn.value = f.name.replace(/\.[^.]+$/, '').slice(0, 12);
            }
          }
        } catch (err) {
          toast('图片读取失败，请重试');
        }
        e.target.value = '';
      };

      $('#st-new-clear-btn').onclick = () => {
        pickedDataUrl = '';
        urlIn.value = '';
        updatePreview('', '');
      };

      $('#st-confirm-add-btn').onclick = () => {
        const finalUrl = pickedDataUrl || urlIn.value.trim();
        const finalName = nameIn.value.trim();
        if (!finalUrl) {
          toast('请先填写图片链接或从相册选一张图');
          return;
        }
        if (!finalName) {
          toast('请给这个表情包起个名字，方便 AI 识别');
          nameIn.focus();
          return;
        }
        S.stickers.push({
          id: 'st_' + uid(),
          name: finalName,
          url: finalUrl
        });
        saveStickers(); persist();
        if (S.tab === 'me') renderTab('me');
        openStickers();
        toast(`已添加表情「${finalName}」♡`);
      };

      // 点击改名
      pane.querySelectorAll('[data-edit]').forEach(el => {
        el.onclick = () => {
          const idx = parseInt(el.dataset.edit, 10);
          const item = S.stickers[idx];
          if (!item) return;
          openStickerRenamePage(item, idx);
        };
      });

      // 点击删除
      pane.querySelectorAll('[data-rm]').forEach(el => {
        el.onclick = e => {
          e.stopPropagation();
          const idx = parseInt(el.dataset.rm, 10);
          if (!isNaN(idx)) {
            S.stickers.splice(idx, 1);
            saveStickers(); persist();
            if (S.tab === 'me') renderTab('me');
            openStickers();
            toast('表情包已删除');
          }
        };
      });
    }
  });
}

/* 修改单个表情包名字（单开子页面） */
function openStickerRenamePage(item, idx) {
  openSubpage({
    title: '修改表情包名字',
    onBack: () => openStickers(),
    rightBtn: `
      <button class="hdr-btn" id="st-rename-save" style="color:var(--accent);font-weight:600;font-size:14px;width:auto;padding:0 6px;">
        保存
      </button>
    `,
    bodyHtml: `
      <div style="display:flex;justify-content:center;margin:12px 0 18px;">
        <img src="${esc(item.url)}" alt="" style="width:96px;height:96px;object-fit:contain;border-radius:18px;background:var(--card);border:1px solid var(--line);padding:8px;box-shadow:var(--shadow-sm);">
      </div>
      <div class="field">
        <div class="field-label">表情包名字（AI 会根据该名字理解表情含义并在聊天中发送）</div>
        <input class="field-input" id="st-rename-input" maxlength="18" value="${esc(item.name || '')}" placeholder="输入表情包名字">
      </div>
    `,
    onMount() {
      $('#st-rename-save').onclick = () => {
        const v = $('#st-rename-input').value.trim();
        if (!v) { toast('名字不能为空'); return; }
        if (S.stickers[idx]) {
          S.stickers[idx].name = v;
          saveStickers(); persist();
        }
        openStickers();
        toast('表情名字已更新 ♡');
      };
    }
  });
}

/* ================================================================
   执行启动
   ================================================================ */
boot();


/* ================================================================
   线下之约 · Offline Date Mode（文游式第三人称约会）
   —— 双通道进入：① ＋面板「线下之约」直接发起；② 人设主动发「线下邀请小邮票」卡片点入
   —— 文游叙述：AI 以第三人称描写场景与 TA 的动作神态，你输入行动/台词
   —— 退出留纪念卡进聊天；剧情可续（p.offlineState）
   ================================================================ */

const OFFLINE_SCENES = [
  { id: 'seaside',  name: '海边的栈道',   desc: '晚风、浪声与远处的灯火',       hint: '海边的木质栈道，傍晚，橘色晚霞铺在海面上，远处灯塔亮起' },
  { id: 'cafe',     name: '转角咖啡店',   desc: '雨天窗边的一杯热拿铁',         hint: '下着小雨的午后，咖啡店窗边，暖气混着咖啡豆香' },
  { id: 'nightfair',name: '深夜小吃街',   desc: '烟火气与并肩的人潮',           hint: '热闹的夜市小吃街，灯光暖黄，人潮并肩' },
  { id: 'home',     name: 'TA 的家',      desc: '毛毯、电影与安静陪伴',         hint: 'TA 的家，客厅沙发，电视开着电影，窗外夜色' },
  { id: 'custom',   name: '自定义场景',   desc: '写一个你们想去的地方',         hint: '' }
];

function offlineStateOf(p) {
  if (!p.offlineState) p.offlineState = { active: false, scene: '', sceneName: '', log: [], startedAt: 0 };
  return p.offlineState;
}

/* —— 入口一：＋面板「线下之约」—— */
/* —— 入口一：＋面板「线下之约」—— */
function openOfflineInviteSheet(p) {
  // 有进行中的约会 → 直接继续；否则直接开场（场景交给 AI 根据线上记忆自行安排）
  const st = offlineStateOf(p);
  if (st.active && st.log.length) {
    openOfflineMode(p);
    return;
  }
  startOfflineDate(p, null);
}

function openOfflineScenePicker(p) {
  const items = OFFLINE_SCENES.map(s => ({
    icon: 'i-img',
    text: `${s.name} · ${s.desc}`,
    act: () => {
      closeSheet();
      if (s.id === 'custom') {
        openOfflineCustomScene(p);
      } else {
        startOfflineDate(p, s);
      }
    }
  }));
  openSheet({ title: `和 ${displayOf(p).name} 去哪？`, items });
}

function openOfflineCustomScene(p) {
  openSubpage({
    title: '自定义场景',
    onBack: closeSubpage,
    rightBtn: `<button class="hdr-btn" id="ofs-go" style="color:var(--accent);font-weight:600;font-size:14px;width:auto;padding:0 6px;">出发</button>`,
    bodyHtml: `
      <div style="font-size:12px;color:var(--text-3);margin-bottom:12px;padding:0 2px;">
        写下你们要去的地方与氛围，AI 会以此展开叙述。
      </div>
      <div class="field">
        <div class="field-label">场景名字</div>
        <input class="field-input" id="ofs-name" maxlength="12" placeholder="例如：老城区的天台">
      </div>
      <div class="field">
        <div class="field-label">场景描述（时间 / 地点 / 氛围）</div>
        <textarea class="field-input" id="ofs-desc" style="min-height:88px;" placeholder="例如：夏夜，老城区的天台，能看见整片城市的灯，风很轻"></textarea>
      </div>
    `,
    onMount() {
      $('#ofs-go').onclick = () => {
        const name = $('#ofs-name').value.trim() || '未知的约会';
        const desc = $('#ofs-desc').value.trim();
        if (!desc) { toast('写点场景描述吧'); return; }
        closeSubpage();
        startOfflineDate(p, { id: 'custom', name, hint: desc });
      };
    }
  });
}

/* —— 开始一段线下约会 —— */
function startOfflineDate(p, scene) {
  const st = offlineStateOf(p);
  st.active = true;
  st.scene = scene ? scene.id : '';
  st.sceneName = scene ? scene.name : '线下之约';
  st.sceneHint = scene ? scene.hint : '';
  st.log = [];
  st.startedAt = Date.now();
  savePersonas(); persist();
  openOfflineMode(p);
  toast(`与 ${displayOf(p).name} 的线下之约开始了`);
}

/* 线下设置（右上角 ⋯）：整页设置，点选后即改即存 */
function openOfflineSettings(p) {
  const st = offlineStateOf(p);
  const LEN_OPTS = [120, 250, 400, 600];
  const lenVal = st.outLen || 250;
  const person = st.person || 'third';
  const personName = { third: '第三人称（TA 的名字）', second: '第二人称（你）', first: 'TA 的第一人称（我）' }[person];
  const tempo = st.tempo || 'normal';
  const tempoName = { slow: '慢热 · 铺垫多一点', normal: '自然 · 均匀推进', fast: '明快 · 事件感强' }[tempo];
  const showMind = st.showMind !== false;   // 是否在叙述后附 TA 的内心一句
  const envOn = st.envDetail !== false;     // 环境细节描写

  openSubpage({
    title: '线下模式 · 设置',
    onBack: () => openOfflineMode(p),
    bodyHtml: `
      <div style="font-size:12px;color:var(--text-3);margin-bottom:14px;padding:0 2px;line-height:1.6;">
        线下文游的写作偏好，改完立刻生效，下一轮叙述就按新的来。
      </div>

      <div class="sec-title" style="padding-left:2px;">叙述风格</div>
      <div class="profile-menu-card" style="margin:0 0 14px 0;">
        <div class="profile-menu-item of-opt-row" data-of="len">
          <div class="profile-menu-label" style="flex-direction:column;align-items:flex-start;gap:3px;display:flex;">
            <span>单次输出长度</span>
            <span style="font-size:10.5px;color:var(--text-4);">每次叙述大约写多少字</span>
          </div>
          <div class="profile-menu-extra" id="ofs-len-val" style="color:var(--accent);font-weight:600;">约 ${lenVal} 字</div>
        </div>
        <div class="of-opt-bubble" id="of-bubble-len"></div>
        <div class="profile-menu-item of-opt-row" data-of="person">
          <div class="profile-menu-label" style="flex-direction:column;align-items:flex-start;gap:3px;display:flex;">
            <span>叙述人称</span>
            <span style="font-size:10.5px;color:var(--text-4);">故事用什么视角讲</span>
          </div>
          <div class="profile-menu-extra" id="ofs-person-val" style="color:var(--accent);font-weight:600;">${esc(personName)}</div>
        </div>
        <div class="of-opt-bubble" id="of-bubble-person"></div>
        <div class="profile-menu-item of-opt-row" data-of="tempo">
          <div class="profile-menu-label" style="flex-direction:column;align-items:flex-start;gap:3px;display:flex;">
            <span>节奏</span>
            <span style="font-size:10.5px;color:var(--text-4);">剧情推进的快慢</span>
          </div>
          <div class="profile-menu-extra" id="ofs-tempo-val" style="color:var(--accent);font-weight:600;">${esc(tempoName)}</div>
        </div>
        <div class="of-opt-bubble" id="of-bubble-tempo"></div>
      </div>

      <div class="sec-title" style="padding-left:2px;">细节</div>
      <div class="profile-menu-card" style="margin:0 0 14px 0;">
        <div class="profile-menu-item">
          <div class="profile-menu-label" style="flex-direction:column;align-items:flex-start;gap:3px;display:flex;">
            <span>TA 的内心一句</span>
            <span style="font-size:10.5px;color:var(--text-4);">每段叙述末尾附一句 TA 没说出口的心里话</span>
          </div>
          <button type="button" class="tg-switch ${showMind ? 'on' : ''}" id="ofs-mind" aria-label="内心一句开关"><span class="tg-knob"></span></button>
        </div>
        <div class="profile-menu-item">
          <div class="profile-menu-label" style="flex-direction:column;align-items:flex-start;gap:3px;display:flex;">
            <span>环境细节</span>
            <span style="font-size:10.5px;color:var(--text-4);">光线、声音、气味这些氛围描写</span>
          </div>
          <button type="button" class="tg-switch ${envOn ? 'on' : ''}" id="ofs-env" aria-label="环境细节开关"><span class="tg-knob"></span></button>
        </div>
      </div>

      <div class="sec-title" style="padding-left:2px;">场景（可选）</div>
      <div class="profile-menu-card" style="margin:0;">
        <div class="profile-menu-item" id="ofs-scene-row">
          <div class="profile-menu-label" style="flex-direction:column;align-items:flex-start;gap:3px;display:flex;">
            <span>指定地点</span>
            <span style="font-size:10.5px;color:var(--text-4);">留空则由 AI 根据线上记忆自动安排</span>
          </div>
          <div class="profile-menu-extra" id="ofs-scene-val">${st.sceneName && st.sceneName !== '线下之约' ? esc(st.sceneName) : '自动安排'}</div>
        </div>
      </div>
      <div style="height:20px;"></div>
    `,
    onMount() {
      const save = () => { savePersonas(); persist(); };
      const closeBubbles = () => document.querySelectorAll('.of-opt-bubble.open').forEach(b => b.classList.remove('open'));

      // 行下气泡选择器
      function bubbleFor(key, opts, isOn, onPick) {
        const box = document.getElementById('of-bubble-' + key);
        box.innerHTML = opts.map(o =>
          `<button class="of-opt-chip ${isOn(o) ? 'is-on' : ''}" data-v="${o.v}">${esc(o.label)}</button>`
        ).join('');
        box.querySelectorAll('.of-opt-chip').forEach(chip => {
          chip.onclick = () => { onPick(chip.dataset.v); closeBubbles(); };
        });
        box.classList.add('open');
      }

      const LEN_OPTS = [120, 250, 400, 600, 800, 1000];
      const PERSON_OPTS = [
        { v: 'third', label: '第三人称' },
        { v: 'second', label: '第二人称' },
        { v: 'first', label: 'TA 的第一人称' }
      ];
      const TEMPO_OPTS = [
        { v: 'slow', label: '慢热' },
        { v: 'normal', label: '自然' },
        { v: 'fast', label: '明快' }
      ];

      document.querySelectorAll('.of-opt-row').forEach(row => {
        row.onclick = () => {
          const key = row.dataset.of;
          const wasOpen = document.getElementById('of-bubble-' + key).classList.contains('open');
          closeBubbles();
          if (wasOpen) return;
          if (key === 'len') {
            bubbleFor('len', LEN_OPTS.map(v => ({ v, label: v + ' 字' })), o => (st.outLen || 250) === o.v, v => {
              st.outLen = parseInt(v, 10);
              $('#ofs-len-val').textContent = `约 ${st.outLen} 字`;
              save(); toast(`已设为约 ${st.outLen} 字`);
            });
          } else if (key === 'person') {
            bubbleFor('person', PERSON_OPTS, o => (st.person || 'third') === o.v, v => {
              st.person = v;
              $('#ofs-person-val').textContent = { third: '第三人称（TA 的名字）', second: '第二人称（你）', first: 'TA 的第一人称（我）' }[v];
              save();
            });
          } else if (key === 'tempo') {
            bubbleFor('tempo', TEMPO_OPTS, o => (st.tempo || 'normal') === o.v, v => {
              st.tempo = v;
              $('#ofs-tempo-val').textContent = { slow: '慢热 · 铺垫多一点', normal: '自然 · 均匀推进', fast: '明快 · 事件感强' }[v];
              save();
            });
          }
        };
      });

      // 开关
      $('#ofs-mind').onclick = () => { st.showMind = !(st.showMind !== false); $('#ofs-mind').classList.toggle('on', st.showMind); save(); };
      $('#ofs-env').onclick = () => { st.envDetail = !(st.envDetail !== false); $('#ofs-env').classList.toggle('on', st.envDetail); save(); };
      // 指定地点：改名字（简单输入）
      $('#ofs-scene-row').onclick = () => {
        openSubpage({
          title: '指定地点',
          onBack: () => openOfflineSettings(p),
          rightBtn: `<button class="hdr-btn" id="ofs-scene-save" style="color:var(--accent);font-weight:600;font-size:14px;width:auto;padding:0 6px;">保存</button>`,
          bodyHtml: `
            <div class="field">
              <div class="field-label">地点（留空 = 自动安排）</div>
              <input class="field-input" id="ofs-scene-input" maxlength="16" value="${esc(st.sceneName && st.sceneName !== '线下之约' ? st.sceneName : '')}" placeholder="例如：海边栈道 / 老城区的天台">
            </div>
            <div class="field">
              <div class="field-label">场景补充（可选）</div>
              <textarea class="field-input" id="ofs-scene-hint" style="min-height:72px;" placeholder="时间、氛围、正在做什么…">${esc(st.sceneHint || '')}</textarea>
            </div>
          `,
          onMount() {
            $('#ofs-scene-save').onclick = () => {
              const name = $('#ofs-scene-input').value.trim();
              const hint = $('#ofs-scene-hint').value.trim();
              st.sceneName = name || '线下之约';
              st.sceneHint = hint;
              savePersonas(); persist();
              toast('场景已保存');
              openOfflineSettings(p);
            };
          }
        });
      };
    }
  });
}

/* —— 线下模式主页面（全屏文游） —— */
function openOfflineMode(p) {
  const st = offlineStateOf(p);
  const backToChat = () => {
    // 线下页浮在聊天层之上：聊天 DOM 一直都在，只需关闭浮层；仅当当前打开的会话变了才重建，避免闪跳
    closeSubpage();
    if (S.openId !== p.id) { openChat(p.id); }
    else { renderThread(); }
  };

  openSubpage({
    title: `线下 · ${displayOf(p).name}`,
    onBack: () => offlineExitConfirm(p, backToChat),
    rightBtn: `
      <button class="hdr-btn" id="of-settings" aria-label="线下设置">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>
      </button>
    `,
    bodyCls: 'offline-body',
    bodyHtml: `
      <div id="of-log" class="of-log"></div>
      <div class="of-plus-menu hidden" id="of-plus-menu"></div>
      <div class="of-input-wrap">
        <button class="of-plus" id="of-plus" aria-label="更多">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <input class="of-input" id="of-input" placeholder="写下你的行动或台词…" maxlength="200" autocomplete="off">
        <button class="of-send" id="of-send" aria-label="发送">
          <svg viewBox="0 0 24 24"><use href="#i-send"></use></svg>
        </button>
      </div>
    `,
    onMount() {
      renderOfflineLog(p);
      const send = () => {
        const inp = $('#of-input');
        const t = inp.value.trim();
        if (!t) return;
        inp.value = '';
        offlineTurn(p, t);
      };
      $('#of-send').onclick = send;
      $('#of-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
      $('#of-settings').onclick = () => openOfflineSettings(p);

      // 长按对话流：多选 / 删除 / 全选
      let pressTimer = null;
      const logBox = $('#of-log');
      const startPress = (e) => {
        const turn = e.target.closest('.of-turn');
        if (!turn) return;
        pressTimer = setTimeout(() => {
          if (!ofSelectMode) {
            ofSelectMode = true;
            ofSelIds = [turn.dataset.oidx];
            renderOfflineLog(p);
            if (navigator.vibrate) navigator.vibrate(30);
          }
        }, 450);
      };
      const cancelPress = () => { if (pressTimer) clearTimeout(pressTimer); };
      logBox.addEventListener('touchstart', startPress, { passive: true });
      logBox.addEventListener('touchend', cancelPress);
      logBox.addEventListener('touchmove', cancelPress);
      logBox.addEventListener('mousedown', startPress);
      logBox.addEventListener('mouseup', cancelPress);
      logBox.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const turn = e.target.closest('.of-turn');
        if (turn && !ofSelectMode) {
          ofSelectMode = true;
          ofSelIds = [turn.dataset.oidx];
          renderOfflineLog(p);
        }
      });
      logBox.addEventListener('click', (e) => {
        if (!ofSelectMode) return;
        const turn = e.target.closest('.of-turn');
        if (!turn || turn.dataset.oidx === undefined) return;
        const idx = turn.dataset.oidx;
        const i = ofSelIds.indexOf(idx);
        if (i >= 0) { ofSelIds.splice(i, 1); turn.classList.remove('is-selected'); }
        else { ofSelIds.push(idx); turn.classList.add('is-selected'); }
        const cntBtn = document.getElementById('of-sel-del');
        if (cntBtn) cntBtn.textContent = `删除（${ofSelIds.length}）`;
      });

      // ＋菜单：与聊天＋面板同款方形格子
      const plusMenu = $('#of-plus-menu');
      $('#of-plus').onclick = () => {
        const st2 = offlineStateOf(p);
        const canRetry = (st2.log || []).some(t => t.role === 'ai');
        plusMenu.innerHTML = `
          <div class="of-drawer-grid">
            <div class="of-drawer-item" id="of-menu-retry" style="${canRetry ? '' : 'opacity:.4;'}">
              <div class="dr-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg></div>
              <span>重新生成</span>
            </div>
          </div>`;
        plusMenu.classList.remove('hidden');
        document.getElementById('of-menu-retry').onclick = () => {
          plusMenu.classList.add('hidden');
          if (canRetry) offlineRetryLast(p);
          else toast('先写一句你的行动吧');
        };
      };

      const logEl = $('#of-log');
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
    }
  });
}

/* 返回/退出时询问：保留继续 or 结束并总结（居中小卡片） */
function offlineExitConfirm(p, backToChat) {
  const st = offlineStateOf(p);
  if (!st.active || !st.log.length) { backToChat(); return; }
  const card = document.createElement('div');
  card.className = 'of-exit-card';
  card.innerHTML = `
    <div class="of-exit-card-inner">
      <div class="of-exit-title">这次线下之约…</div>
      <div class="of-exit-sub">可以直接退出去忙别的，也可以把这次收进纪念</div>
      <div class="of-exit-btns">
        <button class="of-exit-btn keep">先保留，下次接着这里继续</button>
        <button class="of-exit-btn end">结束并总结，留一张纪念卡</button>
        <button class="of-exit-btn cancel">再玩一会儿</button>
      </div>
    </div>`;
  document.body.appendChild(card);
  const close = () => card.remove();
  card.querySelector('.keep').onclick = () => { close(); backToChat(); };
  card.querySelector('.end').onclick = () => { close(); endOfflineDate(p, backToChat); };
  card.querySelector('.cancel').onclick = close;
  card.onclick = (e) => { if (e.target === card) close(); };
}

let ofSelectMode = false;
let ofSelIds = [];

function renderOfflineLog(p) {
  const st = offlineStateOf(p);
  const log = $('#of-log');
  if (!log) return;
  log.innerHTML = st.log.map((turn, idx) => {
    if (turn.silent) return '';
    const selCls = (ofSelectMode && ofSelIds.includes(String(idx))) ? ' is-selected' : '';
    const chk = ofSelectMode ? `<span class="of-check"></span>` : '';
    if (turn.role === 'user') {
      return `<div class="of-turn of-turn-me${selCls}" data-oidx="${idx}" data-oid="${turn.oid || ''}">${chk}<span class="of-act">${esc(turn.text)}</span></div>`;
    }
    // AI 叙述段：按段落拆开渲染；【内心】行渲染为粉色斜体
    const paras = (turn.text || '').split(/\n+/).filter(Boolean);
    return `<div class="of-turn of-turn-ai${selCls}" data-oidx="${idx}" data-oid="${turn.oid || ''}">${chk}${paras.map(t => {
      const mMind = t.match(/^【内心】\s*(.+)$/);
      if (mMind) return `<p class="of-mind">「${esc(mMind[1])}」</p>`;
      return `<p class="of-narr">${esc(t)}</p>`;
    }).join('')}</div>`;
  }).join('') || '';
  // 选择模式提示条
  let bar = document.getElementById('of-select-bar');
  if (ofSelectMode) {
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'of-select-bar';
      bar.style.cssText = 'display:flex;align-items:center;justify-content:space-around;gap:8px;padding:9px 14px;background:rgba(255,255,255,.96);border-top:1px solid var(--line);';
      const inputWrap = document.querySelector('.of-input-wrap');
      if (inputWrap && inputWrap.parentNode) inputWrap.parentNode.insertBefore(bar, inputWrap);
    }
    bar.innerHTML = `
      <button class="of-sel-btn" id="of-sel-all">全选</button>
      <button class="of-sel-btn" id="of-sel-del" style="color:#C4698A;font-weight:700;">删除（${ofSelIds.length}）</button>
      <button class="of-sel-btn" id="of-sel-cancel">取消</button>`;
    document.getElementById('of-sel-all').onclick = () => {
      ofSelIds = st.log.map((t, i) => (t.silent ? null : String(i))).filter(Boolean);
      renderOfflineLog(p);
    };
    document.getElementById('of-sel-del').onclick = () => {
      if (!ofSelIds.length) { toast('先选几段吧'); return; }
      st.log = st.log.filter((t, i) => !ofSelIds.includes(String(i)));
      ofSelIds = [];
      ofSelectMode = false;
      const bar2 = document.getElementById('of-select-bar');
      if (bar2) bar2.remove();
      savePersonas(); persist();
      renderOfflineLog(p);
      toast('已删除');
    };
    document.getElementById('of-sel-cancel').onclick = () => {
      ofSelectMode = false; ofSelIds = [];
      const bar2 = document.getElementById('of-select-bar');
      if (bar2) bar2.remove();
      renderOfflineLog(p);
    };
  } else if (bar) {
    bar.remove();
  }
  log.scrollTop = log.scrollHeight;
}

/* —— 一轮文游：你的行动 → AI 叙述世界与 TA 的反应 —— */
async function offlineTurn(p, userAction) {
  const st = offlineStateOf(p);
  st.log.push({ role: 'user', text: userAction, oid: uid(), time: Date.now() });
  savePersonas();
  renderOfflineLog(p);

  // typing 提示
  const log = $('#of-log');
  const typing = document.createElement('div');
  typing.className = 'of-turn of-turn-ai of-typing';
  typing.innerHTML = '<p class="of-narr">…</p>';
  if (log) { log.appendChild(typing); log.scrollTop = log.scrollHeight; }

  const cfg = apiSlots();
  const order = [];
  if (cfg.primary.ready) order.push(cfg.primary);
  if (cfg.secondary.ready) order.push(cfg.secondary);
  if (!order.length) {
    if (typing.parentNode) typing.remove();
    toast('请先到桌面【设置中心】填好大模型 API');
    return;
  }

  const curM = getCurrentMask();
  const userName = (curM && curM.name) || S.account.nickname || '你';
  const history = st.log.slice(-16).map(t =>
    t.role === 'user' ? `${userName} 的行动/台词：${t.text}` : `叙述：${t.text}`
  ).join('\n\n');

  // 线上记忆：取最近聊天内容作为约会底色（去哪里、聊什么，由它决定）
  const chatMemory = (S.chats[p.id] || [])
    .filter(m => !m.recalled && m.text && m.type !== 'whisper')
    .slice(-24)
    .map(m => `${m.role === 'me' ? userName : displayOf(p).name}：${m.type === 'sticker' ? ('[表情' + (m.stickerName ? '：' + m.stickerName : '') + ']') : (m.type === 'transfer' ? '[转账]' : m.text)}`)
    .join('\n');

  const outLen = st.outLen || 250;
  const person = st.person || 'third';
  const tempo = st.tempo || 'normal';
  const tempoRule = tempo === 'slow'
    ? '节奏慢热：多铺垫氛围与情绪，事件推进克制'
    : tempo === 'fast'
      ? '节奏明快：事件推进快一点，多让事情发生'
      : '节奏自然：均匀推进，不赶不拖';
  const mindRule = st.showMind !== false
    ? '- 每次叙述的最后，单独另起一行输出 TA 此刻没说出口的内心一句，格式：【内心】xxx。'
    : '- 不要输出内心独白标注。';
  const envRule = st.envDetail !== false
    ? '- 适当穿插环境细节（光线/声音/气味/温度），但不要堆砌。'
    : '- 少写环境描写，聚焦人物动作与对话。';
  const personRule = person === 'second'
    ? '以第二人称叙述：把用户称为「你」'
    : person === 'first'
      ? `以 ${displayOf(p).name} 的第一人称「我」叙述内心与所见，用户用名字称呼`
      : `以第三人称叙述，用「${displayOf(p).name}」称呼 TA，用「${userName}」称呼用户`;

  const sys = `你是一位温柔的文游叙述者，正在与用户进行「线下约会」文字扮演。

【世界观】用户（${userName}）正与「${displayOf(p).name}」在现实世界里线下见面约会——这是线上聊天的延续。
【人设】${p.prompt || p.sign || displayOf(p).name + '（人设未详写，请自然温柔地扮演）'}
【线上记忆（约会的底色）】你们的近期聊天如下，约会的地点、话题、氛围请自然从这里生长出来（例如最近聊过想吃什么、想去哪、最近的心情），不要凭空另起炉灶：
${chatMemory || '（暂无线上记录，请安排一个温柔自然的开场）'}
${st.sceneName && st.sceneName !== '线下之约' ? `【指定地点】${st.sceneName}${st.sceneHint ? '：' + st.sceneHint : ''}（约会围绕这里展开）` : ''}
【叙事起点】这是刚刚见面的时刻，除非叙述已经推进到别处。
【你的任务】
- ${personRule}。
- ${tempoRule}
- 描写场景、氛围、${displayOf(p).name}的动作、神态与台词。
- ${envRule}
- ${userName} 的输入是 TA 的行动或台词，你要承接它推进剧情，不要替 ${userName} 做决定或说话。
- 对话形式：叙述段落 + ${displayOf(p).name} 的台词（用「」包裹）。分 2~3 个自然段，总共约 ${outLen} 字（可在 ±30% 内浮动）。
${mindRule}
- 保持文风细腻克制，像散文，像文游。不要出现"你扮演""作为AI"等出戏字样。`;

  let text = '';
  for (const api of order) {
    try {
      text = await streamChat(api, [
        { role: 'system', content: sys },
        { role: 'user', content: history + `\n\n${userName} 的行动/台词：${userAction}` }
      ], 0.9, null);
      break;
    } catch (e) { text = ''; }
  }
  if (typing.parentNode) typing.remove();
  if (!text) text = '（风停了一瞬，好像有什么没接上……再试一次？）';
  st.log.push({ role: 'ai', text, oid: uid(), time: Date.now() });
  savePersonas();
  renderOfflineLog(p);
}

/* 重新生成上一段叙述：撤掉最后一条 AI 叙述，用同样的用户行动重跑 */
function offlineRetryLast(p) {
  const st = offlineStateOf(p);
  const log = st.log || [];
  // 找最后一条 AI 叙述，去掉它（保留其前面的用户行动）
  let lastAi = -1;
  for (let i = log.length - 1; i >= 0; i--) { if (log[i].role === 'ai') { lastAi = i; break; } }
  if (lastAi < 0) { toast('还没有可以重新生成的叙述'); return; }
  const lastUser = log[lastAi - 1] && log[lastAi - 1].role === 'user' ? log[lastAi - 1].text : null;
  log.splice(lastAi);
  savePersonas(); persist();
  renderOfflineLog(p);
  if (lastUser) {
    // 复用原行动重新生成（不重复压入用户气泡）
    st.log.push({ role: 'user', text: lastUser, oid: uid(), time: Date.now(), silent: true });
    savePersonas(); persist();
    // 静默压入：渲染时不重复显示用户气泡 → 直接调 offlineTurn 但跳过 push
    offlineRegenerate(p, lastUser);
  } else {
    toast('再写一句你的行动吧');
  }
}

/* 与 offlineTurn 相同流程，但不新增用户气泡（用于重新生成） */
async function offlineRegenerate(p, userAction) {
  const st = offlineStateOf(p);
  const logEl = $('#of-log');
  const typing = document.createElement('div');
  typing.className = 'of-turn of-turn-ai of-typing';
  typing.innerHTML = '<p class="of-narr">…</p>';
  if (logEl) { logEl.appendChild(typing); logEl.scrollTop = logEl.scrollHeight; }

  const cfg = apiSlots();
  const order = [];
  if (cfg.primary.ready) order.push(cfg.primary);
  if (cfg.secondary.ready) order.push(cfg.secondary);
  if (!order.length) {
    if (typing.parentNode) typing.remove();
    toast('请先到桌面【设置中心】填好大模型 API');
    return;
  }

  const curM = getCurrentMask();
  const userName = (curM && curM.name) || S.account.nickname || '你';
  const history = st.log.slice(-16).map(t =>
    t.role === 'user' ? `${userName} 的行动/台词：${t.text}` : `叙述：${t.text}`
  ).join('\n\n');

  const chatMemory = (S.chats[p.id] || [])
    .filter(m => !m.recalled && m.text && m.type !== 'whisper')
    .slice(-24)
    .map(m => `${m.role === 'me' ? userName : displayOf(p).name}：${m.type === 'sticker' ? ('[表情' + (m.stickerName ? '：' + m.stickerName : '') + ']') : (m.type === 'transfer' ? '[转账]' : m.text)}`)
    .join('\n');

  const outLen = st.outLen || 250;
  const person = st.person || 'third';
  const tempo = st.tempo || 'normal';
  const tempoRule = tempo === 'slow' ? '节奏慢热：多铺垫氛围与情绪，事件推进克制'
    : tempo === 'fast' ? '节奏明快：事件推进快一点，多让事情发生'
    : '节奏自然：均匀推进，不赶不拖';
  const mindRule = st.showMind !== false
    ? '- 每次叙述的最后，单独另起一行输出 TA 此刻没说出口的内心一句，格式：【内心】xxx。'
    : '- 不要输出内心独白标注。';
  const envRule = st.envDetail !== false
    ? '- 适当穿插环境细节（光线/声音/气味/温度），但不要堆砌。'
    : '- 少写环境描写，聚焦人物动作与对话。';
  const personRule = person === 'second' ? '以第二人称叙述：把用户称为「你」'
    : person === 'first' ? `以 ${displayOf(p).name} 的第一人称「我」叙述内心与所见，用户用名字称呼`
    : `以第三人称叙述，用「${displayOf(p).name}」称呼 TA，用「${userName}」称呼用户`;

  const sys = `你是一位温柔的文游叙述者，正在与用户进行「线下约会」文字扮演。

【世界观】用户（${userName}）正与「${displayOf(p).name}」在现实世界里线下见面约会——这是线上聊天的延续。
【人设】${p.prompt || p.sign || displayOf(p).name + '（人设未详写，请自然温柔地扮演）'}
【线上记忆（约会的底色）】你们的近期聊天如下，约会的地点、话题、氛围请自然从这里生长出来：
${chatMemory || '（暂无线上记录，请安排一个温柔自然的开场）'}
${st.sceneName && st.sceneName !== '线下之约' ? `【指定地点】${st.sceneName}${st.sceneHint ? '：' + st.sceneHint : ''}（约会围绕这里展开）` : ''}
【你的任务】
- ${personRule}。
- ${tempoRule}
- 描写场景、氛围、${displayOf(p).name}的动作、神态与台词。
- ${envRule}
- ${userName} 的输入是 TA 的行动或台词，你要承接它推进剧情，不要替 ${userName} 做决定或说话。
- 对话形式：叙述段落 + ${displayOf(p).name} 的台词（用「」包裹）。分 2~3 个自然段，总共约 ${outLen} 字（可在 ±30% 内浮动）。
${mindRule}
- 保持文风细腻克制，像散文，像文游。不要出现"你扮演""作为AI"等出戏字样。`;

  let text = '';
  for (const api of order) {
    try {
      text = await streamChat(api, [
        { role: 'system', content: sys },
        { role: 'user', content: history + `\n\n${userName} 的行动/台词：${userAction}` }
      ], 0.9, null);
      break;
    } catch (e) { text = ''; }
  }
  if (typing.parentNode) typing.remove();
  if (!text) text = '（风停了一瞬，好像有什么没接上……再试一次？）';
  st.log.push({ role: 'ai', text, oid: uid(), time: Date.now() });
  savePersonas();
  renderOfflineLog(p);
}

/* —— 结束约会：留纪念卡进聊天 —— */
function endOfflineDate(p, backToChat) {
  const st = offlineStateOf(p);
  const hadLog = st.active && st.log.length;
  const sceneName = st.sceneName;
  // 段数 = 用户实际行动的次数
  const turns = st.log.filter(t => t.role === 'user' && !t.silent).length;
  const sessionLog = st.log.filter(t => !t.silent).map(t => ({ role: t.role, text: t.text }));
  st.active = false;
  st.log = [];
  savePersonas(); persist();
  if (hadLog) {
    pushMsg(p.id, {
      id: 'm_' + uid(), role: 'them', type: 'offline_memory', time: Date.now(),
      sceneName, turns, personaName: displayOf(p).name, sessionLog
    });
    renderTab('chat');
  }
  toast('约会结束了，纪念信封已放进聊天 ♡');
  backToChat && backToChat();
}


/* 查看线下约会的对话记录（点纪念信封） */
function openOfflineMemoryViewer(p, msg) {
  const log = msg.sessionLog || [];
  openSubpage({
    title: `线下 · ${displayOf(p).name}`,
    onBack: () => closeSubpage(),
    bodyCls: 'offline-body',
    bodyHtml: `
      <div style="font-size:11.5px;color:var(--text-4);text-align:center;margin-bottom:10px;">
        ${new Date(msg.time || Date.now()).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · 共 ${msg.turns || 0} 段时光
      </div>
      <div id="of-log" class="of-log"></div>
      <div style="height:calc(16px + var(--safe-b));"></div>
    `,
    onMount() {
      const logEl = $('#of-log');
      logEl.innerHTML = log.map(turn => {
        if (turn.role === 'user') {
          return `<div class="of-turn of-turn-me"><span class="of-act">${esc(turn.text)}</span></div>`;
        }
        const paras = (turn.text || '').split(/\n+/).filter(Boolean);
        return `<div class="of-turn of-turn-ai">${paras.map(t => {
          const mMind = t.match(/^【内心】\s*(.+)$/);
          if (mMind) return `<p class="of-mind">「${esc(mMind[1])}」</p>`;
          return `<p class="of-narr">${esc(t)}</p>`;
        }).join('')}</div>`;
      }).join('') || '<p class="of-narr of-narr-empty">这次约会没有留下对话记录</p>';
      logEl.scrollTop = logEl.scrollHeight;
    }
  });
}

/* —— 入口二：人设主动发的「线下邀请小邮票」—— */
/* 渲染：msgHtml 中 type === 'offline_invite'；点击 → 接受邀请进入线下模式 */
function acceptOfflineInvite(p, msg) {
  const scene = OFFLINE_SCENES.find(s => s.id === (msg.scene || 'seaside')) || OFFLINE_SCENES[0];
  pushMsg(p.id, { id: 'm_' + uid(), role: 'me', type: 'text', text: '（接受了线下之约的邀请 ♡）', time: Date.now(), unread: true });
  closeSubpage();
  startOfflineDate(p, scene);
}
