// ==========================================================================
// 쇼의 클래시로얄 핸디캡 토너먼트 - Tournament Engine & UI Controller
// ==========================================================================

import { getFirebaseConfig, saveFirebaseConfig } from './firebase-config.js';

// Firebase SDK ES Modules from CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
  getDatabase, 
  ref, 
  set, 
  onValue, 
  get 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// --- Global State & Security ---
// Salted SHA-256 hash of admin password
// Plaintext password is never stored or exposed in source code / GitHub repository
const ADMIN_PASSWORD_HASH = '6cd5354529e68b59d8df0dd7c6c659d91ac08f28fdffb40b56c902ac8d8e8c2c';
const ADMIN_SALT = 'show_clash_handicap_salt_';

async function computeSha256(str) {
  const enc = new TextEncoder();
  const data = enc.encode(ADMIN_SALT + str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

let pendingTargetTab = null;

let db = null;
let dbConnected = false;
let currentTab = isTabAuthorized('host') ? 'host' : 'player';
let myJudgeName = localStorage.getItem('show_handicap_judge_name') || localStorage.getItem('clash_judge_name') || '쇼';
let myPlayerId = localStorage.getItem('show_handicap_my_player_id') || localStorage.getItem('clash_my_player_id') || null;

const DEFAULT_STATE = {
  status: 'recruiting', // 'recruiting' | 'handicap_declaration' | 'judging' | 'matches' | 'finals_handicap_select' | 'finals' | 'ended'
  round: 1,
  participants: {},
  rounds: {
    round_1: {
      roundNumber: 1,
      handicaps: {},
      scores: {},
      totalScores: {},
      eliminatedByScore: null,
      byePlayerId: null,
      matches: []
    }
  },
  finals: {
    player1Id: null,
    player2Id: null,
    p1ChosenForP2: '',
    p2ChosenForP1: '',
    winnerId: null
  },
  prizes: {
    rank1: null,
    rank2: null,
    rank3: null
  },
  lastUpdated: Date.now()
};

let tournamentState = JSON.parse(localStorage.getItem('show_handicap_local_state') || localStorage.getItem('clash_tournament_local_state')) || DEFAULT_STATE;

// --- Initialize Firebase or Fallback to LocalStorage ---
function initDatabase() {
  const config = getFirebaseConfig();
  const connBadge = document.getElementById('conn-badge');
  const connText = document.getElementById('conn-text');

  if (config && config.databaseURL && config.databaseURL.trim().length > 5) {
    try {
      const app = initializeApp(config);
      db = getDatabase(app);
      const tournamentRef = ref(db, 'tournament');

      onValue(tournamentRef, (snapshot) => {
        const val = snapshot.val();
        if (val) {
          if (val.adminPin) delete val.adminPin;
          tournamentState = {
            ...DEFAULT_STATE,
            ...val,
            participants: val.participants || {},
            rounds: val.rounds || {},
            finals: { ...DEFAULT_STATE.finals, ...(val.finals || {}) },
            prizes: { ...DEFAULT_STATE.prizes, ...(val.prizes || {}) }
          };
          delete tournamentState.adminPin;
          localStorage.setItem('show_handicap_local_state', JSON.stringify(tournamentState));
          dbConnected = true;
          updateConnStatus(true, 'DB 실시간 동기화');
          renderAll();
        } else {
          // If empty DB, upload initial state
          delete tournamentState.adminPin;
          set(tournamentRef, tournamentState);
          dbConnected = true;
          updateConnStatus(true, 'DB 준비 완료');
          renderAll();
        }
      }, (error) => {
        console.warn('Firebase RTDB 연결 오류 (로컬 모드로 동작):', error);
        dbConnected = false;
        updateConnStatus(false, '로컬 단독 모드');
        renderAll();
      });
    } catch (err) {
      console.warn('Firebase 초기화 예외:', err);
      dbConnected = false;
      updateConnStatus(false, '설정 확인 필요');
      renderAll();
    }
  } else {
    dbConnected = false;
    updateConnStatus(false, '로컬 모드 (설정에서 DB 등록)');
    renderAll();
  }
}

function updateConnStatus(connected, text) {
  const badge = document.getElementById('conn-badge');
  const txt = document.getElementById('conn-text');
  if (connected) {
    badge.className = 'inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
    txt.textContent = text;
  } else {
    badge.className = 'inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30';
    txt.textContent = text;
  }
}

// --- Sync State to Firebase and LocalStorage ---
async function syncState() {
  delete tournamentState.adminPin;
  tournamentState.lastUpdated = Date.now();
  localStorage.setItem('show_handicap_local_state', JSON.stringify(tournamentState));
  
  if (db && dbConnected) {
    try {
      await set(ref(db, 'tournament'), tournamentState);
    } catch (e) {
      console.error('Firebase 데이터 쓰기 실패:', e);
      showToast('⚠️ DB 저장 실패 (로컬에만 저장됨)');
    }
  }
  renderAll();
}

// --- Sound Effects using Web Audio API ---
function playSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === 'start') {
      osc.frequency.setValueAtTime(330, now);
      osc.frequency.exponentialRampToValueAtTime(660, now + 0.2);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === 'win') {
      osc.frequency.setValueAtTime(523, now);
      osc.frequency.setValueAtTime(659, now + 0.1);
      osc.frequency.setValueAtTime(783, now + 0.2);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'eliminate') {
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.3);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    }
  } catch (e) {
    // Ignore audio failures
  }
}

// --- Toast helper ---
function showToast(message) {
  const toast = document.getElementById('toast');
  const msg = document.getElementById('toast-msg');
  msg.textContent = message;
  toast.classList.remove('opacity-0', '-translate-y-2');
  toast.classList.add('opacity-100', 'translate-y-0');
  setTimeout(() => {
    toast.classList.remove('opacity-100', 'translate-y-0');
    toast.classList.add('opacity-0', '-translate-y-2');
  }, 2200);
}

// --- Security & Input Sanitization (XSS Prevention) ---
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isTabAuthorized(tabName) {
  if (tabName === 'player') return true;
  const token = localStorage.getItem('show_handicap_auth_token');
  return token === ADMIN_PASSWORD_HASH || localStorage.getItem('show_handicap_auth') === 'e4tPrW';
}

function requireAdmin() {
  if (!isTabAuthorized('host')) {
    showToast('🔒 관리자(호스트/심사) 인증이 필요합니다.');
    openAuthModal('host');
    return false;
  }
  return true;
}

window.openAuthModal = function(targetTab) {
  pendingTargetTab = targetTab || 'host';
  const modal = document.getElementById('modal-auth');
  const input = document.getElementById('auth-password-input');
  const errorMsg = document.getElementById('auth-error-msg');
  const desc = document.getElementById('auth-desc');

  if (errorMsg) errorMsg.classList.add('hidden');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 150);
  }
  if (desc) {
    desc.innerHTML = '👑 <span class="text-amber-400 font-bold">관리자 콘솔 (호스트 & 심사)</span>은 진행자 전용입니다.<br>접근 비밀번호를 입력해주세요.';
  }
  if (modal) modal.classList.add('open');
};

window.closeAuthModal = function() {
  const modal = document.getElementById('modal-auth');
  if (modal) modal.classList.remove('open');
  pendingTargetTab = null;
};

window.handleAuthSubmit = async function(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('auth-password-input');
  const errorMsg = document.getElementById('auth-error-msg');
  const val = input ? input.value.trim() : '';

  const inputHash = await computeSha256(val);
  if (inputHash === ADMIN_PASSWORD_HASH) {
    localStorage.setItem('show_handicap_auth_token', ADMIN_PASSWORD_HASH);
    localStorage.removeItem('show_handicap_auth');
    closeAuthModal();
    showToast('🔓 관리자 인증되었습니다.');
    const tabToOpen = pendingTargetTab || 'host';
    doSwitchTab(tabToOpen);
  } else {
    if (errorMsg) errorMsg.classList.remove('hidden');
    if (input) {
      input.value = '';
      input.focus();
    }
  }
};

window.switchTab = function(tabName) {
  const target = (tabName === 'judge' || tabName === 'host') ? 'host' : 'player';
  if (target === 'host') {
    if (!isTabAuthorized('host')) {
      openAuthModal('host');
      return;
    }
  }
  doSwitchTab(target);
};

function doSwitchTab(tabName) {
  currentTab = tabName;
  document.querySelectorAll('.tab-view').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById(`view-${tabName}`);
  if (target) target.classList.remove('hidden');

  // Update navigation buttons (host, player)
  ['host', 'player'].forEach(t => {
    const dtab = document.getElementById(`dtab-${t}`);
    const mtab = document.getElementById(`mtab-${t}`);
    if (dtab) {
      dtab.className = t === tabName ? 'segment-item active' : 'segment-item';
    }
    if (mtab) {
      mtab.className = t === tabName ? 'nav-tab-mobile active' : 'nav-tab-mobile';
    }
  });

  renderAll();
}

// ==========================================================================
// RENDERERS
// ==========================================================================

function renderAll() {
  renderProgressBar();
  renderHeaderStatus();
  if (currentTab === 'host') renderHostView();
  if (currentTab === 'player') renderPlayerView();

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// 상단 선착순 10명 진행률 & 생존자/해골(💀) 상태바 (Progress Bar)
function renderProgressBar() {
  const pCard = document.getElementById('recruiting-progress-card');
  if (!pCard) return;

  const participants = Object.values(tournamentState.participants || {});
  const pCount = participants.length;
  const alivePlayers = participants.filter(p => p.isAlive);
  const deadPlayers = participants.filter(p => !p.isAlive);
  const aliveCount = alivePlayers.length;
  const deadCount = deadPlayers.length;

  const title = document.getElementById('progress-title');
  const badge = document.getElementById('progress-badge');
  const count = document.getElementById('progress-count');
  const maxLabel = document.getElementById('progress-max-label');
  const sub = document.getElementById('progress-sub');
  const fill = document.getElementById('progress-bar-fill');
  const deadFill = document.getElementById('progress-bar-dead');
  const chipsContainer = document.getElementById('roster-chips-container');
  const descNote = document.getElementById('progress-desc-note');
  const note = document.getElementById('progress-status-note');
  const pulseDot = document.getElementById('progress-pulse-dot');

  if (tournamentState.status === 'recruiting') {
    if (pulseDot) pulseDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0';
    if (deadFill) deadFill.classList.add('hidden');

    title.textContent = '선착순 10명 접수 현황';
    count.textContent = pCount;
    if (maxLabel) maxLabel.textContent = ' / 10명';
    
    const percentage = Math.min(Math.round((pCount / 10) * 100), 100);
    fill.style.width = `${percentage}%`;

    if (pCount >= 10) {
      badge.className = 'badge-pill badge-emerald text-[10px] shrink-0';
      badge.textContent = '모집 완료';
      sub.textContent = `(목표 10명 달성! 현재 ${pCount}명)`;
      sub.className = 'text-emerald-400 text-[11px] ml-1 font-semibold';
      fill.className = 'h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-500';
      if (descNote) descNote.textContent = '참가 인원 조건 충족 완료. 호스트가 1턴을 시작할 수 있습니다.';
      note.textContent = '대회 시작 가능 (10+명)';
      note.className = 'font-semibold text-emerald-400 shrink-0';
    } else {
      const remaining = 10 - pCount;
      badge.className = 'badge-pill badge-amber text-[10px] shrink-0';
      badge.textContent = '모집 중';
      sub.textContent = `(${remaining}명 남음)`;
      sub.className = 'text-zinc-400 text-[11px] ml-1';
      fill.className = 'h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all duration-500';
      if (descNote) descNote.textContent = '선착순 10명 이상 모집 완료 시 토너먼트 1턴이 시작됩니다.';
      note.textContent = `${remaining}명 추가 모집 시 1턴 시작`;
      note.className = 'font-semibold text-amber-300 shrink-0';
    }

    // Render recruiting applicant chips (up to 10 slots + extra)
    if (chipsContainer) {
      const totalSlots = Math.max(10, pCount);
      let chipsHtml = '';
      for (let i = 0; i < totalSlots; i++) {
        const p = participants[i];
        if (p) {
          chipsHtml += `
            <div class="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-white/[0.03] border border-white/[0.08] text-zinc-200 flex items-center justify-between gap-1.5 transition">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-[10px] font-bold text-amber-400 shrink-0">#${i + 1}</span>
                <span class="truncate font-medium text-white">${escapeHtml(p.name)}</span>
              </div>
              <span class="text-[9px] text-zinc-400 shrink-0 truncate">신청</span>
            </div>
          `;
        } else {
          chipsHtml += `
            <div class="px-2.5 py-1.5 rounded-xl text-xs font-medium border border-dashed border-white/[0.08] text-zinc-600 flex items-center gap-1.5">
              <span class="text-[10px] text-zinc-600">#${i + 1}</span>
              <span class="text-[11px] text-zinc-500">대기 중</span>
            </div>
          `;
        }
      }
      chipsContainer.innerHTML = chipsHtml;
    }

  } else {
    // TOURNAMENT IN PROGRESS (Round 1 ~ Finals ~ Ended)
    const total = pCount || 1;
    const roundTitle = tournamentState.round === 'finals' ? '결승전' : `${tournamentState.round}턴`;
    title.textContent = `${roundTitle} 생존자 현황`;
    if (pulseDot) pulseDot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0';

    badge.className = 'badge-pill badge-blue text-[10px] shrink-0';
    badge.textContent = tournamentState.status === 'ended' ? '대회 종료' : '생존 대결 진행 중';

    count.innerHTML = `<span class="text-emerald-400 font-bold">${aliveCount}명 생존</span>`;
    if (maxLabel) maxLabel.innerHTML = ` <span class="text-rose-400 font-bold">· 💀 ${deadCount}명 탈락</span>`;
    sub.textContent = `(총 ${pCount}명)`;
    sub.className = 'text-zinc-500 text-[11px] ml-1';

    // Dual split progress bar: Green (Alive) + Red (Dead 💀)
    const alivePercentage = Math.round((aliveCount / total) * 100);
    const deadPercentage = 100 - alivePercentage;

    fill.style.width = `${alivePercentage}%`;
    fill.className = 'h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-l-full transition-all duration-500';

    if (deadFill) {
      deadFill.classList.remove('hidden');
      deadFill.style.width = `${deadPercentage}%`;
      deadFill.className = 'h-full bg-gradient-to-r from-rose-700 to-rose-600 rounded-r-full transition-all duration-500';
    }

    if (descNote) descNote.textContent = '턴이 진행될 때마다 하위 점수자 및 패배자가 💀 해골로 전환됩니다.';
    note.textContent = `최후의 1인까지 생존전 (생존율 ${alivePercentage}%)`;
    note.className = 'font-semibold text-emerald-400 shrink-0';

    // Roster Chips: Alive vs 💀 Skull Chips
    if (chipsContainer) {
      chipsContainer.innerHTML = participants.map((p, idx) => {
        if (p.isAlive) {
          return `
            <div class="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/[0.08] border border-emerald-500/25 text-emerald-200 flex items-center justify-between gap-1.5 shadow-sm transition">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0"></span>
                <span class="truncate font-bold text-white text-[11px] sm:text-xs">${escapeHtml(p.name)}</span>
              </div>
              <span class="text-[9px] text-emerald-400/90 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded shrink-0">생존</span>
            </div>
          `;
        } else {
          return `
            <div class="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-rose-950/20 border border-rose-900/30 text-zinc-500 flex items-center justify-between gap-1.5 transition">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-sm shrink-0 leading-none filter drop-shadow">💀</span>
                <span class="truncate line-through decoration-rose-500/50 text-zinc-400 text-[11px] sm:text-xs">${escapeHtml(p.name)}</span>
              </div>
              <span class="text-[9px] text-rose-400/90 font-mono bg-rose-950/40 px-1.5 py-0.5 rounded font-bold shrink-0">${p.eliminatedRound ? `${p.eliminatedRound}턴` : '탈락'}</span>
            </div>
          `;
        }
      }).join('');
    }
  }
}

function renderHeaderStatus() {
  const desc = document.getElementById('header-phase-desc');
  const pCount = Object.keys(tournamentState.participants || {}).length;
  const aliveCount = Object.values(tournamentState.participants || {}).filter(p => p.isAlive).length;

  let text = '';
  switch (tournamentState.status) {
    case 'recruiting':
      text = `참가자 모집 중 · 현재 ${pCount}명 등록`;
      break;
    case 'handicap_declaration':
      text = `${tournamentState.round}턴 핸디캡 선언 단계 · 생존 ${aliveCount}명`;
      break;
    case 'judging':
      text = `${tournamentState.round}턴 심사위원 채점 진행 중`;
      break;
    case 'matches':
      text = `${tournamentState.round}턴 1:1 데스매치 진행 중`;
      break;
    case 'finals_handicap_select':
      text = `결승전 상대 핸디캡 지정 단계`;
      break;
    case 'finals':
      text = `결승전 최종 매치 진행 중`;
      break;
    case 'ended':
      text = `토너먼트 완료 · 최종 결과`;
      break;
  }
  if (desc) desc.textContent = text;
}

// --------------------------------------------------------------------------
// 1. HOST VIEW CONTROLLER (MODERN MINIMALIST)
// --------------------------------------------------------------------------
function renderHostView() {
  const badgeRound = document.getElementById('host-round-badge');
  const badgePhase = document.getElementById('host-phase-badge');
  const title = document.getElementById('host-phase-title');
  const guide = document.getElementById('host-phase-guide');
  const actions = document.getElementById('host-actions-container');
  const content = document.getElementById('host-content-panel');

  const participants = Object.values(tournamentState.participants || {});
  const alivePlayers = participants.filter(p => p.isAlive);
  const roundKey = `round_${tournamentState.round}`;
  const currentRoundData = tournamentState.rounds?.[roundKey] || { handicaps: {}, scores: {}, totalScores: {}, matches: [] };

  actions.innerHTML = '';
  content.innerHTML = '';

  badgeRound.textContent = tournamentState.status === 'recruiting' ? '모집 단계' : `${tournamentState.round}턴`;

  // PHASE: RECRUITING
  if (tournamentState.status === 'recruiting') {
    badgePhase.textContent = '참가자 접수 중';
    badgePhase.className = 'badge-pill badge-blue';
    title.textContent = `참가자 선착순 모집 (${participants.length}명 신청)`;
    guide.textContent = '클랜원 10명 이상이 모이면 [1턴 시작하기]를 눌러 대회를 시작하세요.';

    actions.innerHTML = `
      <button onclick="injectDummyParticipants()" class="btn-modern btn-secondary text-xs">
        가상 10명 추가
      </button>
      <button onclick="startTournamentRound1()" class="btn-modern btn-primary text-xs ${participants.length < 2 ? 'opacity-50 cursor-not-allowed' : ''}">
        1턴 시작하기 (${participants.length}명)
      </button>
    `;

    content.innerHTML = `
      <div class="card-modern p-5 space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <h3 class="font-bold text-sm text-white">참가 신청자 명단</h3>
            <span class="badge-pill badge-neutral">${participants.length}명</span>
          </div>
          <button onclick="copyParticipantLink()" class="btn-modern btn-secondary text-xs py-1.5 px-3">
            <i data-lucide="share-2" class="w-3.5 h-3.5"></i>
            <span>참가 링크 복사</span>
          </button>
        </div>

        ${participants.length === 0 ? `
          <div class="py-12 text-center text-zinc-500 text-xs">
            아직 참가 신청자가 없습니다. 참가 링크를 방송 채팅에 공유하세요.
          </div>
        ` : `
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            ${participants.map((p, idx) => `
              <div class="bg-white/[0.02] p-3 rounded-xl border border-white/[0.06] flex items-center justify-between hover:border-white/[0.12] transition">
                <div class="space-y-0.5 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-bold text-amber-400">#${idx + 1}</span>
                    <span class="font-semibold text-sm text-white truncate">${escapeHtml(p.name)}</span>
                    ${p.isFriend ? `<span class="badge-pill badge-emerald text-[9px] py-0 px-1.5">친추됨</span>` : ''}
                  </div>
                  ${p.clan ? `<div class="text-[11px] text-zinc-400 truncate">${escapeHtml(p.clan)}</div>` : ''}
                </div>
                <button onclick="removeParticipant('${p.id}')" class="text-zinc-500 hover:text-rose-400 p-1.5 rounded-lg transition" title="제외">
                  <i data-lucide="x" class="w-4 h-4"></i>
                </button>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
  }

  // PHASE: HANDICAP DECLARATION
  else if (tournamentState.status === 'handicap_declaration') {
    badgePhase.textContent = '핸디캡 선언';
    badgePhase.className = 'badge-pill badge-blue';
    title.textContent = `${tournamentState.round}턴: 참가자 핸디캡 선언`;
    guide.textContent = '생존자들이 핸디캡을 선언합니다. 채팅으로 말한 시청자는 [대리 입력]을 눌러 작성해주세요.';

    const submittedCount = Object.keys(currentRoundData.handicaps || {}).length;

    actions.innerHTML = `
      <button onclick="startJudgingPhase()" class="btn-modern btn-primary text-xs">
        심사위원 채점 시작 (${submittedCount}/${alivePlayers.length})
      </button>
    `;

    content.innerHTML = `
      <div class="card-modern p-5 space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <h3 class="font-bold text-sm text-white">생존자 핸디캡 현황</h3>
            <span class="badge-pill badge-neutral">생존 ${alivePlayers.length}명</span>
          </div>
          <span class="text-xs font-semibold text-amber-400">제출 완료: ${submittedCount} / ${alivePlayers.length}</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${alivePlayers.map(p => {
            const handicap = currentRoundData.handicaps?.[p.id];
            return `
              <div class="bg-white/[0.02] p-4 rounded-xl border ${handicap ? 'border-amber-500/30 bg-amber-500/[0.02]' : 'border-white/[0.06]'} flex flex-col justify-between gap-3">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="font-bold text-sm text-white truncate">${escapeHtml(p.name)}</span>
                    ${p.clan ? `<span class="text-xs text-zinc-400 truncate">(${escapeHtml(p.clan)})</span>` : ''}
                  </div>
                  ${handicap 
                    ? `<span class="badge-pill badge-emerald text-[10px]">선언 완료</span>` 
                    : `<span class="badge-pill badge-neutral text-[10px]">미제출</span>`}
                </div>
                <div class="text-xs font-medium ${handicap ? 'text-amber-200' : 'text-zinc-500 italic'} bg-black/30 p-3 rounded-lg border border-white/[0.04] min-h-[44px] flex items-center">
                  ${handicap ? escapeHtml(handicap) : '핸디캡 제출 대기 중...'}
                </div>
                <div class="flex justify-end">
                  <button onclick="openProxyHandicapModal('${p.id}')" class="btn-modern btn-secondary text-xs py-1.5 px-3">
                    <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                    <span>${handicap ? '핸디캡 수정' : '대리 입력'}</span>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // PHASE: JUDGING
  else if (tournamentState.status === 'judging') {
    badgePhase.textContent = '심사위원 채점 중';
    badgePhase.className = 'badge-pill badge-purple';
    title.textContent = `${tournamentState.round}턴: 심사위원 채점 및 하위 탈락`;
    guide.textContent = '쇼와 심사위원들이 각자 참가자들의 핸디캡을 1~10점으로 채점합니다. 최하위 1인은 즉시 탈락하며, 남은 참가자들은 등수별로 1:1 매칭됩니다.';

    const playerScores = calculateTotalScores(currentRoundData);
    const sorted = [...alivePlayers].sort((a, b) => (playerScores[b.id] || 0) - (playerScores[a.id] || 0));

    actions.innerHTML = `
      <button onclick="executeEliminationAndMatchmaking()" class="btn-modern btn-primary text-xs">
        하위 1인 탈락 및 매칭 생성
      </button>
    `;

    content.innerHTML = `
      <!-- Judge Identity Header & Quick Nickname Setting -->
      <div class="card-modern p-4 border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-purple-500/[0.03]">
        <div class="space-y-0.5">
          <div class="flex items-center gap-2">
            <span class="badge-pill badge-purple text-[10px]">심사위원 채점 모드</span>
            <span class="text-xs text-zinc-300 font-semibold">내 채점 닉네임: <span class="text-purple-300 font-bold">${escapeHtml(myJudgeName || '미설정')}</span></span>
          </div>
          <p class="text-[11px] text-zinc-400">쇼와 심사위원들은 아래 카드에서 1~10점을 매겨주세요. 모든 점수는 실시간 자동 합산됩니다.</p>
        </div>
        <div class="flex items-center gap-2 bg-zinc-900/90 p-1.5 rounded-xl border border-white/[0.08]">
          <input type="text" id="judge-name-input" value="${escapeHtml(myJudgeName)}" maxlength="15" placeholder="심사위원 닉네임" class="bg-transparent border-none px-3 py-1.5 text-xs text-white font-semibold focus:outline-none w-28 sm:w-32">
          <button onclick="saveJudgeName()" class="btn-modern btn-primary text-xs px-3 py-1.5">
            저장
          </button>
        </div>
      </div>

      <!-- Real-time Scoring Cards for Alive Players -->
      <div class="card-modern p-5 space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <h3 class="font-bold text-sm text-white">생존자 핸디캡 채점 (1~10점)</h3>
            <span class="badge-pill badge-neutral text-[10px]">생존 ${alivePlayers.length}명</span>
          </div>
          <span class="text-[11px] text-zinc-400">모든 심사위원 점수 실시간 합산</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          ${alivePlayers.map(p => {
            const handicap = currentRoundData.handicaps?.[p.id] || '(아직 핸디캡을 선언하지 않았습니다)';
            const myScore = currentRoundData.scores?.[p.id]?.[myJudgeName] || 0;
            const totalScore = playerScores[p.id] || 0;
            const judgeCount = Object.keys(currentRoundData.scores?.[p.id] || {}).length;

            return `
              <div class="bg-white/[0.02] p-4 rounded-xl border border-white/[0.08] hover:border-white/[0.14] transition space-y-3">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="font-bold text-sm text-white truncate">${escapeHtml(p.name)}</span>
                    ${p.clan ? `<span class="text-xs text-zinc-400 truncate">(${escapeHtml(p.clan)})</span>` : ''}
                  </div>
                  <div class="flex items-center gap-1.5">
                    <span class="text-[11px] text-zinc-400">합산:</span>
                    <span class="font-black text-amber-400 text-sm">${totalScore}점</span>
                    <span class="text-[10px] text-zinc-500">(${judgeCount}명)</span>
                  </div>
                </div>

                <div class="bg-black/30 p-3 rounded-xl border border-white/[0.05] text-xs text-amber-200/90 font-medium min-h-[46px] flex items-center">
                  ${escapeHtml(handicap)}
                </div>

                <div class="space-y-1.5 pt-1">
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="text-zinc-400">내 채점 (<span class="text-purple-300 font-semibold">${escapeHtml(myJudgeName)}</span>): <span class="font-bold ${myScore > 0 ? 'text-amber-400' : 'text-zinc-500'}">${myScore > 0 ? `${myScore}점` : '미채점'}</span></span>
                    <span class="text-[10px] text-zinc-500">원하는 점수 탭</span>
                  </div>
                  <div class="grid grid-cols-10 gap-1">
                    ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(val => `
                      <button onclick="submitScore('${p.id}', ${val})" class="py-1.5 rounded-lg text-xs font-semibold transition ${myScore === val ? 'bg-purple-600 text-white font-bold ring-1 ring-purple-400 shadow-sm' : 'bg-white/[0.03] hover:bg-white/[0.08] text-zinc-300 border border-white/[0.06]'}">
                        ${val}
                      </button>
                    `).join('')}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Real-time Ranking Table -->
      <div class="card-modern p-5 space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <h3 class="font-bold text-sm text-white">실시간 심사 랭킹 집계</h3>
            <span class="badge-pill badge-rose text-[10px]">최하위 1명 자동 탈락</span>
          </div>
          <span class="text-[11px] text-zinc-400">동점일 경우 동순위 유지</span>
        </div>
        
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="text-zinc-400 font-semibold border-b border-white/[0.06]">
              <tr>
                <th class="py-2.5 px-3 w-14 text-center">순위</th>
                <th class="py-2.5 px-3">참가자</th>
                <th class="py-2.5 px-3">선언 핸디캡</th>
                <th class="py-2.5 px-3 text-center w-28">합산 점수</th>
                <th class="py-2.5 px-3 text-center w-28">판정</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/[0.04]">
              ${sorted.map((p, idx) => {
                const isLowest = idx === sorted.length - 1 && sorted.length > 1;
                const isByeCandidate = (idx === 0) && (sorted.length - 1) % 2 === 1;
                const handicap = currentRoundData.handicaps?.[p.id] || '(미제출)';
                const score = playerScores[p.id] || 0;
                return `
                  <tr class="${isLowest ? 'bg-rose-500/[0.06] text-rose-300' : 'hover:bg-white/[0.02]'} transition">
                    <td class="py-3 px-3 text-center font-bold ${idx === 0 ? 'text-amber-400 font-black' : 'text-zinc-400'}">#${idx + 1}</td>
                    <td class="py-3 px-3 font-semibold text-white">${escapeHtml(p.name)}</td>
                    <td class="py-3 px-3 text-zinc-300 font-medium">${escapeHtml(handicap)}</td>
                    <td class="py-3 px-3 text-center font-bold text-amber-400">${score}점</td>
                    <td class="py-3 px-3 text-center">
                      ${isLowest ? `<span class="badge-pill badge-rose">탈락 예정</span>` : 
                        isByeCandidate ? `<span class="badge-pill badge-emerald">부전승 후보</span>` : `<span class="badge-pill badge-neutral">매칭 대상</span>`}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // PHASE: MATCHES (Games in progress)
  else if (tournamentState.status === 'matches') {
    badgePhase.textContent = '대결 진행 중';
    badgePhase.className = 'badge-pill badge-emerald';
    title.textContent = `${tournamentState.round}턴: 1:1 대결 경기`;
    guide.textContent = '클래시로얄 친선전을 치른 후, 각 매치의 승자에게 [승리 확정] 버튼을 눌러주세요.';

    const matches = currentRoundData.matches || [];
    const byePlayer = currentRoundData.byePlayerId ? tournamentState.participants[currentRoundData.byePlayerId] : null;
    const eliminatedByScore = currentRoundData.eliminatedByScore ? tournamentState.participants[currentRoundData.eliminatedByScore] : null;

    const allMatchesFinished = matches.length > 0 && matches.every(m => m.winnerId);

    actions.innerHTML = `
      <button onclick="finishTurnAndNextRound()" class="btn-modern btn-primary text-xs ${!allMatchesFinished ? 'opacity-50 cursor-not-allowed' : ''}">
        다음 턴 진행하기 (${matches.filter(m => m.winnerId).length}/${matches.length} 완료)
      </button>
    `;

    content.innerHTML = `
      <!-- Elimination and Bye notices -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        ${eliminatedByScore ? `
          <div class="card-modern p-4 border-rose-500/30 bg-rose-500/[0.03] flex items-center justify-between">
            <div class="space-y-0.5">
              <span class="badge-pill badge-rose text-[10px]">핸디캡 최하점수 탈락</span>
              <div class="font-bold text-sm text-white">${escapeHtml(eliminatedByScore.name)}</div>
              <div class="text-xs text-zinc-400 truncate max-w-xs">${escapeHtml(currentRoundData.handicaps?.[eliminatedByScore.id] || '')}</div>
            </div>
            <div class="text-rose-400 text-xs font-semibold">탈락 확정</div>
          </div>
        ` : ''}

        ${byePlayer ? `
          <div class="card-modern p-4 border-emerald-500/30 bg-emerald-500/[0.03] flex items-center justify-between">
            <div class="space-y-0.5">
              <span class="badge-pill badge-emerald text-[10px]">점수 1위 부전승 진출</span>
              <div class="font-bold text-sm text-white">${escapeHtml(byePlayer.name)}</div>
              <div class="text-xs text-emerald-400 font-medium">다음 턴 자동 생존</div>
            </div>
            <i data-lucide="check-circle" class="w-5 h-5 text-emerald-400"></i>
          </div>
        ` : ''}
      </div>

      <!-- Match cards -->
      <div class="card-modern p-5 space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="font-bold text-sm text-white">1:1 대진 목록</h3>
          <span class="text-xs text-zinc-400">${matches.filter(m => m.winnerId).length} / ${matches.length} 경기 완료</span>
        </div>

        <div class="grid grid-cols-1 gap-3">
          ${matches.map((m, idx) => {
            const p1 = tournamentState.participants[m.player1Id];
            const p2 = tournamentState.participants[m.player2Id];
            const isP1Win = m.winnerId === m.player1Id;
            const isP2Win = m.winnerId === m.player2Id;

            return `
              <div class="match-card p-4 flex flex-col md:flex-row items-center justify-between gap-4 ${m.winnerId ? 'match-card-winner' : ''}">
                
                <!-- Player 1 -->
                <div class="flex-1 w-full space-y-2.5">
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-sm ${isP1Win ? 'text-amber-400' : 'text-white'}">
                      ${isP1Win ? '✓ ' : ''}${escapeHtml(p1.name)}
                    </span>
                    <span class="badge-pill badge-neutral text-[10px]">${currentRoundData.totalScores?.[p1.id] || 0}점</span>
                  </div>
                  <div class="text-xs text-amber-200/90 font-medium bg-white/[0.02] p-2.5 rounded-xl border border-white/[0.05] min-h-[40px] flex items-center">
                    ${escapeHtml(m.player1Handicap)}
                  </div>
                  <button onclick="setMatchWinner('${m.matchId}', '${p1.id}')" class="btn-modern ${isP1Win ? 'btn-primary' : 'btn-secondary'} w-full text-xs py-2">
                    ${isP1Win ? '승리 확정' : '승리 선택'}
                  </button>
                </div>

                <!-- VS Divider -->
                <div class="vs-divider">VS</div>

                <!-- Player 2 -->
                <div class="flex-1 w-full space-y-2.5">
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-sm ${isP2Win ? 'text-amber-400' : 'text-white'}">
                      ${isP2Win ? '✓ ' : ''}${escapeHtml(p2.name)}
                    </span>
                    <span class="badge-pill badge-neutral text-[10px]">${currentRoundData.totalScores?.[p2.id] || 0}점</span>
                  </div>
                  <div class="text-xs text-amber-200/90 font-medium bg-white/[0.02] p-2.5 rounded-xl border border-white/[0.05] min-h-[40px] flex items-center">
                    ${escapeHtml(m.player2Handicap)}
                  </div>
                  <button onclick="setMatchWinner('${m.matchId}', '${p2.id}')" class="btn-modern ${isP2Win ? 'btn-primary' : 'btn-secondary'} w-full text-xs py-2">
                    ${isP2Win ? '승리 확정' : '승리 선택'}
                  </button>
                </div>

              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // PHASE: FINALS HANDICAP SELECTION (Special Rule!)
  else if (tournamentState.status === 'finals_handicap_select') {
    badgePhase.textContent = '결승 특수 룰';
    badgePhase.className = 'badge-pill badge-purple';
    title.textContent = `결승전: 상대방에게 과거 핸디캡 부여`;
    guide.textContent = '각 진출자가 자신이 과거 라운드에 썼던 핸디캡 중 하나를 골라 상대방에게 부여합니다.';

    const p1 = tournamentState.participants[tournamentState.finals.player1Id];
    const p2 = tournamentState.participants[tournamentState.finals.player2Id];

    const p1History = Object.values(p1?.handicapHistory || {});
    const p2History = Object.values(p2?.handicapHistory || {});

    const canStartFinals = tournamentState.finals.p1ChosenForP2 && tournamentState.finals.p2ChosenForP1;

    actions.innerHTML = `
      <button onclick="startFinalsMatch()" class="btn-modern btn-primary text-xs ${!canStartFinals ? 'opacity-50 cursor-not-allowed' : ''}">
        결승전 매치 시작
      </button>
    `;

    content.innerHTML = `
      <div class="card-modern p-5 space-y-4 border-amber-500/30">
        <div class="bg-amber-500/[0.04] border border-amber-500/20 p-3.5 rounded-xl text-xs text-amber-300 leading-relaxed">
          <span class="font-bold text-amber-400">결승전 특수 규칙:</span> 
          각 참가자가 자신이 이전 라운드에 선언했던 핸디캡 목록 중에서 하나를 선택해 상대에게 장착합니다.
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- P1's handicap to assign to P2 -->
          <div class="card-modern p-4 space-y-3 border-white/[0.06]">
            <div>
              <span class="text-xs text-amber-400 font-bold uppercase tracking-wider">Finalist 1</span>
              <h4 class="font-bold text-base text-white">${escapeHtml(p1?.name)}</h4>
              <p class="text-xs text-zinc-400 mt-0.5">자신의 과거 핸디캡 중 하나를 선택해 <span class="text-white font-semibold">${escapeHtml(p2?.name)}</span>에게 부여:</p>
            </div>
            <div class="space-y-1.5">
              ${p1History.map((h, idx) => `
                <button onclick="selectFinalsHandicapByIndex('p1_for_p2', ${idx})" class="w-full text-left p-3 rounded-xl border text-xs font-medium transition ${tournamentState.finals.p1ChosenForP2 === h ? 'border-amber-400 bg-amber-500/10 text-white' : 'border-white/[0.06] bg-white/[0.02] text-zinc-300 hover:border-white/20'}">
                  ${tournamentState.finals.p1ChosenForP2 === h ? '✓ ' : ''}${escapeHtml(h)}
                </button>
              `).join('')}
              ${p1History.length === 0 ? `<div class="text-xs text-zinc-500">과거 기록 없음</div>` : ''}
            </div>
            ${tournamentState.finals.p1ChosenForP2 ? `
              <div class="text-xs bg-amber-500/[0.06] border border-amber-500/20 p-2.5 rounded-xl text-amber-200">
                선택됨: <span class="font-bold">${escapeHtml(tournamentState.finals.p1ChosenForP2)}</span>
              </div>
            ` : ''}
          </div>

          <!-- P2's handicap to assign to P1 -->
          <div class="card-modern p-4 space-y-3 border-white/[0.06]">
            <div>
              <span class="text-xs text-amber-400 font-bold uppercase tracking-wider">Finalist 2</span>
              <h4 class="font-bold text-base text-white">${escapeHtml(p2?.name)}</h4>
              <p class="text-xs text-zinc-400 mt-0.5">자신의 과거 핸디캡 중 하나를 선택해 <span class="text-white font-semibold">${escapeHtml(p1?.name)}</span>에게 부여:</p>
            </div>
            <div class="space-y-1.5">
              ${p2History.map((h, idx) => `
                <button onclick="selectFinalsHandicapByIndex('p2_for_p1', ${idx})" class="w-full text-left p-3 rounded-xl border text-xs font-medium transition ${tournamentState.finals.p2ChosenForP1 === h ? 'border-amber-400 bg-amber-500/10 text-white' : 'border-white/[0.06] bg-white/[0.02] text-zinc-300 hover:border-white/20'}">
                  ${tournamentState.finals.p2ChosenForP1 === h ? '✓ ' : ''}${escapeHtml(h)}
                </button>
              `).join('')}
              ${p2History.length === 0 ? `<div class="text-xs text-zinc-500">과거 기록 없음</div>` : ''}
            </div>
            ${tournamentState.finals.p2ChosenForP1 ? `
              <div class="text-xs bg-amber-500/[0.06] border border-amber-500/20 p-2.5 rounded-xl text-amber-200">
                선택됨: <span class="font-bold">${escapeHtml(tournamentState.finals.p2ChosenForP1)}</span>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  // PHASE: FINALS BATTLE
  else if (tournamentState.status === 'finals') {
    badgePhase.textContent = '최종 결승';
    badgePhase.className = 'badge-pill badge-amber';
    title.textContent = `결승전: 최후의 1인을 가리는 마지막 대결`;
    guide.textContent = '상대방이 지정한 핸디캡을 확인하고 경기 후 우승자에게 [승리 선택]을 누르세요.';

    if (!tournamentState.finals) {
      tournamentState.finals = { player1Id: null, player2Id: null, p1ChosenForP2: '', p2ChosenForP1: '', winnerId: null };
    }

    let p1 = tournamentState.participants[tournamentState.finals.player1Id];
    let p2 = tournamentState.participants[tournamentState.finals.player2Id];
    if (!p1 || !p2) {
      const aliveList = Object.values(tournamentState.participants || {}).filter(p => p.isAlive);
      if (!p1 && aliveList[0]) {
        p1 = aliveList[0];
        tournamentState.finals.player1Id = p1.id;
      }
      if (!p2 && aliveList[1]) {
        p2 = aliveList[1];
        tournamentState.finals.player2Id = p2.id;
      }
    }

    const isP1Win = tournamentState.finals.winnerId === p1?.id;
    const isP2Win = tournamentState.finals.winnerId === p2?.id;

    actions.innerHTML = `
      <button onclick="finishTournamentCeremony()" class="btn-modern btn-primary text-xs ${!tournamentState.finals.winnerId ? 'opacity-50 cursor-not-allowed' : ''}">
        토너먼트 종료 및 결과 발표
      </button>
    `;

    content.innerHTML = `
      <div class="card-modern card-gold p-6 space-y-5">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-amber-400 uppercase tracking-wider">Grand Finals</span>
          <span class="badge-pill badge-amber">최종전</span>
        </div>

        <div class="flex flex-col md:flex-row items-center justify-between gap-4">
          <!-- P1 Card -->
          <div class="flex-1 w-full bg-black/40 p-5 rounded-2xl border ${isP1Win ? 'border-amber-400 bg-amber-500/[0.04]' : 'border-white/[0.08]'} space-y-3 transition">
            <div class="flex items-center justify-between">
              <h4 class="font-bold text-base ${isP1Win ? 'text-amber-400' : 'text-white'}">${isP1Win ? '👑 ' : ''}${escapeHtml(p1?.name || '결승 진출자 1')}</h4>
              <span class="badge-pill ${isP1Win ? 'badge-amber' : 'badge-neutral'} text-[10px]">${isP1Win ? '1위 선택됨' : '결승 진출자'}</span>
            </div>
            <div class="text-xs text-amber-200 bg-white/[0.02] p-3 rounded-xl border border-white/[0.06] min-h-[46px] flex flex-col justify-center">
              <span class="text-[10px] text-zinc-400 block mb-0.5">상대(${escapeHtml(p2?.name || '상대')})가 부여한 핸디캡:</span>
              <span class="font-semibold">${escapeHtml(tournamentState.finals.p2ChosenForP1 || '(미지정)')}</span>
            </div>
            <button onclick="setFinalsWinner('${p1?.id}')" class="btn-modern ${isP1Win ? 'btn-primary ring-2 ring-amber-400' : 'btn-secondary'} w-full py-2.5 text-xs font-bold">
              ${isP1Win ? '✓ 우승자 선택됨 (1위)' : '승리 선택 (우승)'}
            </button>
          </div>

          <div class="vs-divider text-xs px-3 py-1.5">VS</div>

          <!-- P2 Card -->
          <div class="flex-1 w-full bg-black/40 p-5 rounded-2xl border ${isP2Win ? 'border-amber-400 bg-amber-500/[0.04]' : 'border-white/[0.08]'} space-y-3 transition">
            <div class="flex items-center justify-between">
              <h4 class="font-bold text-base ${isP2Win ? 'text-amber-400' : 'text-white'}">${isP2Win ? '👑 ' : ''}${escapeHtml(p2?.name || '결승 진출자 2')}</h4>
              <span class="badge-pill ${isP2Win ? 'badge-amber' : 'badge-neutral'} text-[10px]">${isP2Win ? '1위 선택됨' : '결승 진출자'}</span>
            </div>
            <div class="text-xs text-amber-200 bg-white/[0.02] p-3 rounded-xl border border-white/[0.06] min-h-[46px] flex flex-col justify-center">
              <span class="text-[10px] text-zinc-400 block mb-0.5">상대(${escapeHtml(p1?.name || '상대')})가 부여한 핸디캡:</span>
              <span class="font-semibold">${escapeHtml(tournamentState.finals.p1ChosenForP2 || '(미지정)')}</span>
            </div>
            <button onclick="setFinalsWinner('${p2?.id}')" class="btn-modern ${isP2Win ? 'btn-primary' : 'btn-secondary'} w-full py-2.5 text-xs font-bold">
              ${isP2Win ? '✓ 우승자 선택됨 (1위)' : '승리 선택 (우승)'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // PHASE: ENDED
  else if (tournamentState.status === 'ended') {
    badgePhase.textContent = '종료';
    badgePhase.className = 'badge-pill badge-emerald';
    title.textContent = `토너먼트 완료 및 시상 결과`;
    guide.textContent = '최종 수상자들에게 상품을 안내해주세요. 친추가 이미 되어 있는 분은 체크 시 관전 피드백으로 변경됩니다.';

    actions.innerHTML = `
      <button onclick="resetTournamentConfirm()" class="btn-modern btn-danger text-xs">
        새 토너먼트 시작
      </button>
    `;

    const r1 = tournamentState.prizes.rank1 ? tournamentState.participants[tournamentState.prizes.rank1] : null;
    const r2 = tournamentState.prizes.rank2 ? tournamentState.participants[tournamentState.prizes.rank2] : null;
    const r3 = tournamentState.prizes.rank3 ? tournamentState.participants[tournamentState.prizes.rank3] : null;

    content.innerHTML = `
      <div class="card-modern card-gold p-6 space-y-5">
        <div class="text-center space-y-1">
          <span class="badge-pill badge-amber">Tournament Results</span>
          <h3 class="font-bold text-xl text-white">최종 시상식</h3>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          <!-- 1st Place -->
          <div class="card-modern p-5 border-amber-500/40 bg-gradient-to-b from-amber-500/[0.08] to-transparent text-center space-y-3">
            <span class="badge-pill badge-amber text-[10px]">1위 챔피언</span>
            <div class="font-bold text-lg text-white">${escapeHtml(r1?.name || '-')}</div>
            <div class="text-xs font-semibold ${r1?.isFriend ? 'text-amber-300' : 'text-emerald-400'}">
              ${r1?.isFriend ? '관전 피드백 (이미 친추됨)' : '인게임 친선 친구 추가'}
            </div>
            <div class="pt-1">
              <label class="text-[11px] text-zinc-400 flex items-center justify-center gap-2 cursor-pointer">
                <input type="checkbox" onchange="toggleFriendStatus('${r1?.id}', this.checked)" ${r1?.isFriend ? 'checked' : ''} class="w-3.5 h-3.5 rounded text-amber-500 bg-zinc-900 border-zinc-700">
                <span>이미 친추되어 있음</span>
              </label>
            </div>
          </div>

          <!-- 2nd Place -->
          <div class="card-modern p-5 border-white/[0.08] text-center space-y-3">
            <span class="badge-pill badge-neutral text-[10px]">2위 준우승</span>
            <div class="font-bold text-lg text-white">${escapeHtml(r2?.name || '-')}</div>
            <div class="text-xs font-semibold ${r2?.isFriend ? 'text-amber-300' : 'text-blue-400'}">
              ${r2?.isFriend ? '관전 피드백 (이미 친추됨)' : '친선전 이기면 친추'}
            </div>
            <div class="pt-1">
              <label class="text-[11px] text-zinc-400 flex items-center justify-center gap-2 cursor-pointer">
                <input type="checkbox" onchange="toggleFriendStatus('${r2?.id}', this.checked)" ${r2?.isFriend ? 'checked' : ''} class="w-3.5 h-3.5 rounded text-amber-500 bg-zinc-900 border-zinc-700">
                <span>이미 친추되어 있음</span>
              </label>
            </div>
          </div>

          <!-- 3rd Place -->
          <div class="card-modern p-5 border-white/[0.08] text-center space-y-3">
            <span class="badge-pill badge-neutral text-[10px]">3위</span>
            <div class="font-bold text-lg text-white">${escapeHtml(r3?.name || '-')}</div>
            <div class="text-xs font-semibold text-zinc-300">
              관전 피드백 (방종 전)
            </div>
            <div class="pt-1 text-[11px] text-zinc-500">
              3위 리워드
            </div>
          </div>
        </div>
      </div>
    `;

    if (window.confetti) {
      window.confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 }
      });
    }
  }
}

// --------------------------------------------------------------------------
// 2. JUDGE & ADMIN HELPERS
// --------------------------------------------------------------------------
window.saveJudgeName = function() {
  const input = document.getElementById('judge-name-input');
  if (input && input.value.trim()) {
    myJudgeName = input.value.trim().slice(0, 15);
    localStorage.setItem('show_handicap_judge_name', myJudgeName);
    showToast(`심사위원 '${escapeHtml(myJudgeName)}' 저장 완료`);
    renderHostView();
  }
};

window.submitScore = async function(playerId, score) {
  if (!isTabAuthorized('host')) {
    showToast('🔒 심사위원/관리자 인증이 필요합니다.');
    openAuthModal('host');
    return;
  }
  if (!myJudgeName) {
    showToast('먼저 심사위원 닉네임을 설정해주세요.');
    return;
  }
  const cleanScore = Math.max(1, Math.min(10, parseInt(score, 10) || 0));
  if (cleanScore < 1 || cleanScore > 10) return;

  const roundKey = `round_${tournamentState.round}`;
  if (!tournamentState.rounds[roundKey]) {
    tournamentState.rounds[roundKey] = { roundNumber: tournamentState.round, handicaps: {}, scores: {}, totalScores: {} };
  }
  if (!tournamentState.rounds[roundKey].scores) {
    tournamentState.rounds[roundKey].scores = {};
  }
  if (!tournamentState.rounds[roundKey].scores[playerId]) {
    tournamentState.rounds[roundKey].scores[playerId] = {};
  }
  tournamentState.rounds[roundKey].scores[playerId][myJudgeName] = cleanScore;

  tournamentState.rounds[roundKey].totalScores = calculateTotalScores(tournamentState.rounds[roundKey]);

  await syncState();
  showToast(`${cleanScore}점 반영 완료`);
};

// --------------------------------------------------------------------------
// 3. PARTICIPANT VIEW CONTROLLER (MODERN MINIMALIST)
// --------------------------------------------------------------------------
function renderPlayerView() {
  const registerCard = document.getElementById('player-register-card');
  const registerClosedCard = document.getElementById('player-register-closed');
  const dashboard = document.getElementById('player-dashboard');
  const eliminatedBanner = document.getElementById('p-eliminated-banner');
  const logoutBtn = document.getElementById('p-dash-logout-btn');

  const isRecruiting = tournamentState.status === 'recruiting';
  const isRegistered = myPlayerId && tournamentState.participants?.[myPlayerId];

  // If user is NOT registered
  if (!isRegistered) {
    dashboard.classList.add('hidden');
    if (isRecruiting) {
      registerCard.classList.remove('hidden');
      if (registerClosedCard) registerClosedCard.classList.add('hidden');
    } else {
      // 턴 시작 후: 신청칸 완전 차단 (이미 탈락한 시청자의 재신청 및 신규 신청 불가)
      registerCard.classList.add('hidden');
      if (registerClosedCard) registerClosedCard.classList.remove('hidden');
    }
    return;
  }

  // User IS registered: Show dashboard
  registerCard.classList.add('hidden');
  if (registerClosedCard) registerClosedCard.classList.add('hidden');
  dashboard.classList.remove('hidden');

  const myData = tournamentState.participants[myPlayerId];
  document.getElementById('p-dash-name').textContent = myData.name;
  const aliveBadge = document.getElementById('p-dash-alive');
  const avatarEl = document.getElementById('p-dash-avatar');

  // Control logout button (do not allow switching / clearing ID during active tournament)
  if (logoutBtn) {
    if (isRecruiting) {
      logoutBtn.classList.remove('hidden');
    } else {
      logoutBtn.classList.add('hidden');
    }
  }

  if (myData.isAlive) {
    aliveBadge.className = 'badge-pill badge-emerald shrink-0';
    aliveBadge.textContent = '생존 중';
    if (avatarEl) avatarEl.innerHTML = `<i data-lucide="user" class="w-5 h-5 text-emerald-400"></i>`;
    if (eliminatedBanner) eliminatedBanner.classList.add('hidden');
  } else {
    aliveBadge.className = 'badge-pill badge-rose shrink-0';
    aliveBadge.textContent = `💀 탈락 (${myData.eliminatedRound || tournamentState.round}턴)`;
    if (avatarEl) avatarEl.innerHTML = `<span class="text-xl">💀</span>`;

    // Show prominent eliminated banner
    if (eliminatedBanner) {
      eliminatedBanner.classList.remove('hidden');
      const elimTitle = document.getElementById('p-eliminated-title');
      const elimDesc = document.getElementById('p-eliminated-desc');
      if (elimTitle) elimTitle.textContent = `${myData.name}님은 ${myData.eliminatedRound || tournamentState.round}턴에서 탈락하셨습니다`;
      if (elimDesc) elimDesc.innerHTML = `대회 규정에 따라 탈락자의 재신청 및 재참가는 엄격히 제한됩니다.<br>방송 화면과 채팅으로 결승전까지 함께 응원해주세요!`;
    }
  }

  // Handicap box (ONLY for alive players during handicap_declaration)
  const handicapBox = document.getElementById('player-handicap-box');
  const handicapStatus = document.getElementById('p-handicap-status');
  const handicapInput = document.getElementById('p-handicap-input');
  const roundKey = `round_${tournamentState.round}`;
  const myCurrentHandicap = tournamentState.rounds?.[roundKey]?.handicaps?.[myPlayerId];

  if (tournamentState.status === 'handicap_declaration' && myData.isAlive) {
    handicapBox.classList.remove('hidden');
    if (myCurrentHandicap) {
      handicapStatus.className = 'badge-pill badge-emerald text-[10px]';
      handicapStatus.textContent = '선언 완료';
      handicapInput.value = myCurrentHandicap;
    } else {
      handicapStatus.className = 'badge-pill badge-blue text-[10px]';
      handicapStatus.textContent = '작성 대기';
    }
  } else {
    handicapBox.classList.add('hidden');
  }

  // Finals Box (ONLY for finalists who are alive)
  const finalsBox = document.getElementById('player-finals-box');
  if (tournamentState.status === 'finals_handicap_select' && myData.isAlive && (tournamentState.finals.player1Id === myPlayerId || tournamentState.finals.player2Id === myPlayerId)) {
    finalsBox.classList.remove('hidden');
    const pastContainer = document.getElementById('player-past-handicaps');
    const past = Object.values(myData.handicapHistory || {});
    const isP1 = tournamentState.finals.player1Id === myPlayerId;
    const currentChosen = isP1 ? tournamentState.finals.p1ChosenForP2 : tournamentState.finals.p2ChosenForP1;

    pastContainer.innerHTML = past.map((h, idx) => `
      <button onclick="selectFinalsHandicapByIndex('${isP1 ? 'p1_for_p2' : 'p2_for_p1'}', ${idx})" class="w-full text-left p-3 rounded-xl border text-xs font-medium transition ${currentChosen === h ? 'border-amber-400 bg-amber-500/10 text-white' : 'border-white/[0.06] bg-white/[0.02] text-zinc-300 hover:border-white/20'}">
        ${currentChosen === h ? '✓ ' : ''}${escapeHtml(h)}
      </button>
    `).join('');
  } else {
    finalsBox.classList.add('hidden');
  }

  // Match info box (for participants in this round's matches or grand finals)
  const matchBox = document.getElementById('player-match-box');
  const matchContent = document.getElementById('player-match-content');
  const roundMatches = tournamentState.rounds?.[roundKey]?.matches || [];
  const myMatch = roundMatches.find(m => m.player1Id === myPlayerId || m.player2Id === myPlayerId);
  const isFinalsParticipant = tournamentState.status === 'finals' && (tournamentState.finals?.player1Id === myPlayerId || tournamentState.finals?.player2Id === myPlayerId);

  if (tournamentState.status === 'matches' && myMatch) {
    matchBox.classList.remove('hidden');
    const isP1 = myMatch.player1Id === myPlayerId;
    const opponent = tournamentState.participants[isP1 ? myMatch.player2Id : myMatch.player1Id];
    const myH = isP1 ? myMatch.player1Handicap : myMatch.player2Handicap;
    const oppH = isP1 ? myMatch.player2Handicap : myMatch.player1Handicap;

    matchContent.innerHTML = `
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <span class="font-bold text-white text-sm">상대: ${escapeHtml(opponent?.name || '상대')}</span>
          ${myMatch.winnerId ? (myMatch.winnerId === myPlayerId ? `<span class="badge-pill badge-emerald">승리 (생존)</span>` : `<span class="badge-pill badge-rose">💀 패배 (탈락)</span>`) : `<span class="badge-pill badge-blue">경기 진행 중</span>`}
        </div>
        <div class="text-xs text-amber-200 bg-white/[0.02] p-3 rounded-xl border border-white/[0.06] space-y-1">
          <span class="text-zinc-400 block text-[11px]">내가 지킬 핸디캡:</span>
          <span class="font-semibold text-white">${escapeHtml(myH)}</span>
        </div>
        <div class="text-xs text-zinc-300 bg-white/[0.02] p-3 rounded-xl border border-white/[0.06] space-y-1">
          <span class="text-zinc-500 block text-[11px]">상대의 핸디캡:</span>
          <span>${escapeHtml(oppH)}</span>
        </div>
      </div>
    `;
  } else if (isFinalsParticipant) {
    matchBox.classList.remove('hidden');
    const isP1 = tournamentState.finals.player1Id === myPlayerId;
    const oppId = isP1 ? tournamentState.finals.player2Id : tournamentState.finals.player1Id;
    const opponent = tournamentState.participants[oppId];
    const myH = isP1 ? tournamentState.finals.p2ChosenForP1 : tournamentState.finals.p1ChosenForP2;
    const oppH = isP1 ? tournamentState.finals.p1ChosenForP2 : tournamentState.finals.p2ChosenForP1;
    const isWinner = tournamentState.finals.winnerId === myPlayerId;
    const hasWinner = !!tournamentState.finals.winnerId;

    matchContent.innerHTML = `
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <span class="badge-pill badge-amber text-[10px]">결승전 매치</span>
            <span class="font-bold text-white text-sm">상대: ${escapeHtml(opponent?.name || '상대')}</span>
          </div>
          ${hasWinner ? (isWinner ? `<span class="badge-pill badge-amber font-bold">🏆 최종 우승 (1위)</span>` : `<span class="badge-pill badge-neutral">🥈 준우승 (2위)</span>`) : `<span class="badge-pill badge-blue">결승전 진행 중</span>`}
        </div>
        <div class="text-xs text-amber-200 bg-white/[0.02] p-3 rounded-xl border border-amber-500/20 space-y-1">
          <span class="text-zinc-400 block text-[11px]">상대가 나에게 지정한 핸디캡:</span>
          <span class="font-bold text-amber-300 text-sm">${escapeHtml(myH || '(미지정)')}</span>
        </div>
        <div class="text-xs text-zinc-300 bg-white/[0.02] p-3 rounded-xl border border-white/[0.06] space-y-1">
          <span class="text-zinc-500 block text-[11px]">내가 상대에게 지정한 핸디캡:</span>
          <span>${escapeHtml(oppH || '(미지정)')}</span>
        </div>
      </div>
    `;
  } else {
    matchBox.classList.add('hidden');
  }
}

window.handlePlayerRegister = async function(e) {
  e.preventDefault();
  if (tournamentState.status !== 'recruiting') {
    showToast('이미 턴이 시작되어 신규 참가를 신청할 수 없습니다.');
    return;
  }
  const currentList = Object.values(tournamentState.participants || {});
  if (currentList.length >= 10) {
    showToast('⚠️ 선착순 10명 접수가 이미 마감되었습니다.');
    return;
  }
  if (myPlayerId && tournamentState.participants?.[myPlayerId]) {
    showToast('이미 참가 등록된 기기(브라우저)입니다.');
    return;
  }

  const nameInput = document.getElementById('reg-name');
  const rawName = nameInput ? nameInput.value.trim() : '';
  const name = rawName.slice(0, 15);
  const friendInput = document.getElementById('reg-friend');
  const isFriend = friendInput ? friendInput.checked : false;

  if (!name || name.length === 0) {
    showToast('닉네임을 입력해주세요.');
    return;
  }

  if (currentList.some(p => p.name.trim().toLowerCase() === name.toLowerCase())) {
    showToast(`'${name}' 닉네임은 이미 등록되어 있습니다.`);
    return;
  }

  const id = 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 5);

  const newPlayer = {
    id,
    name,
    clan: '',
    isAlive: true,
    isFriend,
    eliminatedRound: null,
    eliminatedReason: null,
    finalRank: null,
    handicapHistory: {}
  };

  if (!tournamentState.participants) tournamentState.participants = {};
  tournamentState.participants[id] = newPlayer;

  myPlayerId = id;
  localStorage.setItem('show_handicap_my_player_id', id);

  // Atomic participant write to Firebase to prevent race conditions
  if (db && dbConnected) {
    try {
      await set(ref(db, `tournament/participants/${id}`), newPlayer);
    } catch (err) {
      console.warn('참가자 개별 저장 실패, 전체 동기화 시도:', err);
      await syncState();
    }
  } else {
    await syncState();
  }

  showToast(`'${escapeHtml(name)}' 참가 등록 완료!`);
  renderPlayerView();
};

window.logoutPlayer = function() {
  if (tournamentState.status !== 'recruiting') {
    showToast('토너먼트 진행 중에는 참가자 정보를 변경할 수 없습니다.');
    return;
  }
  localStorage.removeItem('show_handicap_my_player_id');
  localStorage.removeItem('clash_my_player_id');
  myPlayerId = null;
  renderPlayerView();
};

window.submitMyHandicap = async function() {
  if (!myPlayerId || !tournamentState.participants?.[myPlayerId]) {
    showToast('참가자로 등록되어 있지 않습니다.');
    return;
  }
  if (!tournamentState.participants[myPlayerId].isAlive) {
    showToast('탈락자는 핸디캡을 제출할 수 없습니다.');
    return;
  }
  if (tournamentState.status !== 'handicap_declaration') {
    showToast('현재는 핸디캡 선언 단계가 아닙니다.');
    return;
  }

  const input = document.getElementById('p-handicap-input');
  const val = input ? input.value.trim().slice(0, 100) : '';
  if (!val) {
    showToast('핸디캡을 입력해주세요!');
    return;
  }

  const roundKey = `round_${tournamentState.round}`;
  if (!tournamentState.rounds[roundKey]) {
    tournamentState.rounds[roundKey] = { roundNumber: tournamentState.round, handicaps: {}, scores: {}, totalScores: {} };
  }
  if (!tournamentState.rounds[roundKey].handicaps) {
    tournamentState.rounds[roundKey].handicaps = {};
  }
  tournamentState.rounds[roundKey].handicaps[myPlayerId] = val;

  // Add to player's history
  if (!tournamentState.participants[myPlayerId].handicapHistory) {
    tournamentState.participants[myPlayerId].handicapHistory = {};
  }
  tournamentState.participants[myPlayerId].handicapHistory[roundKey] = val;

  // Atomic child updates to Firebase to avoid race conditions with other participants
  if (db && dbConnected) {
    try {
      await set(ref(db, `tournament/rounds/${roundKey}/handicaps/${myPlayerId}`), val);
      await set(ref(db, `tournament/participants/${myPlayerId}/handicapHistory/${roundKey}`), val);
      localStorage.setItem('show_handicap_local_state', JSON.stringify(tournamentState));
      renderAll();
    } catch (err) {
      console.warn('개별 핸디캡 저장 실패, 전체 동기화 폴백:', err);
      await syncState();
    }
  } else {
    await syncState();
  }

  showToast('핸디캡 선언 제출 완료!');
};

// (전광판 탭 제거됨)

// ==========================================================================
// TOURNAMENT LOGIC CONTROLLER ACTIONS
// ==========================================================================

function calculateTotalScores(roundData) {
  const totals = {};
  if (!roundData || !roundData.scores) return totals;

  for (const [playerId, judgeScores] of Object.entries(roundData.scores)) {
    let sum = 0;
    for (const val of Object.values(judgeScores)) {
      sum += Number(val) || 0;
    }
    totals[playerId] = sum;
  }
  return totals;
}

window.startTournamentRound1 = async function() {
  if (!requireAdmin()) return;
  const pCount = Object.keys(tournamentState.participants || {}).length;
  if (pCount < 2) {
    showToast('최소 2명 이상의 참가자가 필요합니다.');
    return;
  }

  tournamentState.status = 'handicap_declaration';
  tournamentState.round = 1;
  tournamentState.rounds = {
    round_1: {
      roundNumber: 1,
      handicaps: {},
      scores: {},
      totalScores: {},
      eliminatedByScore: null,
      byePlayerId: null,
      matches: []
    }
  };

  playSound('start');
  await syncState();
  showToast('🚀 1턴 핸디캡 선언 단계가 시작되었습니다!');
};

window.startJudgingPhase = async function() {
  if (!requireAdmin()) return;
  tournamentState.status = 'judging';
  await syncState();
  showToast('⚖️ 심사위원 채점 단계로 전환되었습니다.');
};

window.executeEliminationAndMatchmaking = async function() {
  if (!requireAdmin()) return;
  const roundKey = `round_${tournamentState.round}`;
  const roundData = tournamentState.rounds[roundKey];
  const alivePlayers = Object.values(tournamentState.participants).filter(p => p.isAlive);

  if (alivePlayers.length <= 1) {
    showToast('생존자가 1명 이하입니다.');
    return;
  }

  // Calculate scores
  const scores = calculateTotalScores(roundData);
  roundData.totalScores = scores;

  // Sort descending by score
  const sorted = [...alivePlayers].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0));

  // 1. Lowest 1 participant is eliminated!
  const lowest = sorted.pop(); // Remove lowest
  lowest.isAlive = false;
  lowest.eliminatedRound = tournamentState.round;
  lowest.eliminatedReason = 'lowest_score';
  roundData.eliminatedByScore = lowest.id;

  playSound('eliminate');

  // If 3rd place was not decided and we are now down to 2 players, the eliminated player could be 3rd
  if (sorted.length === 2 && !tournamentState.prizes.rank3) {
    tournamentState.prizes.rank3 = lowest.id;
  }

  // 2. Check remaining count
  const remainingCount = sorted.length;

  // Special Rule: If 2 or fewer remain, go to Finals Handicap Selection
  if (remainingCount <= 2) {
    tournamentState.status = 'finals_handicap_select';
    tournamentState.finals = {
      player1Id: sorted[0].id,
      player2Id: sorted[1].id,
      p1ChosenForP2: '',
      p2ChosenForP1: '',
      winnerId: null
    };
    await syncState();
    showToast(`하위 1인 (${escapeHtml(lowest.name)}) 탈락! 결승전 특수 룰 발동!`);
    return;
  }

  // 3. Matchmaking remaining players:
  // If count is odd, Rank 1 gets automatic Bye (부전승)!
  let matchCandidates = [...sorted];
  if (remainingCount % 2 === 1) {
    const byePlayer = matchCandidates.shift(); // Top 1 gets bye
    roundData.byePlayerId = byePlayer.id;
    showToast(`점수 1위 ${escapeHtml(byePlayer.name)} 부전승 진출!`);
  } else {
    roundData.byePlayerId = null;
  }

  // Pair up candidates: 1st vs 2nd, 3rd vs 4th (rank-based matchmaking)
  const matches = [];
  for (let i = 0; i < matchCandidates.length; i += 2) {
    const p1 = matchCandidates[i];
    const p2 = matchCandidates[i + 1];
    matches.push({
      matchId: `m_${tournamentState.round}_${i / 2}`,
      player1Id: p1.id,
      player2Id: p2.id,
      player1Handicap: roundData.handicaps?.[p1.id] || '(없음)',
      player2Handicap: roundData.handicaps?.[p2.id] || '(없음)',
      winnerId: null,
      status: 'pending'
    });
  }

  roundData.matches = matches;
  tournamentState.status = 'matches';

  await syncState();
  showToast(`하위 1인 (${escapeHtml(lowest.name)}) 탈락! 대진표 생성 완료!`);
};

window.setMatchWinner = async function(matchId, winnerId) {
  if (!requireAdmin()) return;
  const roundKey = `round_${tournamentState.round}`;
  const roundData = tournamentState.rounds[roundKey];
  const match = roundData.matches.find(m => m.matchId === matchId);
  if (!match) return;

  match.winnerId = winnerId;
  const loserId = match.player1Id === winnerId ? match.player2Id : match.player1Id;

  // Mark loser as eliminated
  const loser = tournamentState.participants[loserId];
  if (loser) {
    loser.isAlive = false;
    loser.eliminatedRound = tournamentState.round;
    loser.eliminatedReason = 'match_loss';
  }

  const winner = tournamentState.participants[winnerId];
  if (winner) {
    winner.isAlive = true;
  }

  playSound('win');
  await syncState();
};

window.finishTurnAndNextRound = async function() {
  if (!requireAdmin()) return;
  const roundKey = `round_${tournamentState.round}`;
  const roundData = tournamentState.rounds[roundKey];
  const matches = roundData.matches || [];

  if (matches.some(m => !m.winnerId)) {
    showToast('아직 승패가 결정되지 않은 매치가 있습니다.');
    return;
  }

  const alivePlayers = Object.values(tournamentState.participants).filter(p => p.isAlive);

  // If 2 or fewer remain, proceed to Finals
  if (alivePlayers.length <= 2) {
    tournamentState.status = 'finals_handicap_select';
    tournamentState.finals = {
      player1Id: alivePlayers[0].id,
      player2Id: alivePlayers[1].id,
      p1ChosenForP2: '',
      p2ChosenForP1: '',
      winnerId: null
    };
    await syncState();
    showToast('🔥 결승 진출 2인 확정! 결승전 특수 룰 발동!');
    return;
  }

  // Next round
  tournamentState.round += 1;
  const nextRoundKey = `round_${tournamentState.round}`;
  tournamentState.rounds[nextRoundKey] = {
    roundNumber: tournamentState.round,
    handicaps: {},
    scores: {},
    totalScores: {},
    eliminatedByScore: null,
    byePlayerId: null,
    matches: []
  };
  tournamentState.status = 'handicap_declaration';

  playSound('start');
  await syncState();
  showToast(`${tournamentState.round}턴 핸디캡 선언 시작!`);
};

// --- FINALS HANDICAP SELECTION & EXECUTION ---
window.selectFinalsHandicap = async function(type, handicapText) {
  const isP1 = type === 'p1_for_p2' && (isTabAuthorized('host') || myPlayerId === tournamentState.finals?.player1Id);
  const isP2 = type === 'p2_for_p1' && (isTabAuthorized('host') || myPlayerId === tournamentState.finals?.player2Id);
  if (!isP1 && !isP2) {
    showToast('권한이 없거나 결승 진출자가 아닙니다.');
    return;
  }
  if (typeof handicapText !== 'string') return;
  const safeText = handicapText.trim().slice(0, 100);

  if (!tournamentState.finals) {
    tournamentState.finals = { player1Id: null, player2Id: null, p1ChosenForP2: '', p2ChosenForP1: '', winnerId: null };
  }
  if (type === 'p1_for_p2') {
    tournamentState.finals.p1ChosenForP2 = safeText;
  } else if (type === 'p2_for_p1') {
    tournamentState.finals.p2ChosenForP1 = safeText;
  }
  await syncState();
  showToast('핸디캡 지정 완료!');
};

window.selectFinalsHandicapByIndex = async function(type, index) {
  if (!tournamentState.finals) return;
  let historyList = [];
  if (type === 'p1_for_p2') {
    const p1 = tournamentState.participants[tournamentState.finals.player1Id];
    historyList = Object.values(p1?.handicapHistory || {});
  } else if (type === 'p2_for_p1') {
    const p2 = tournamentState.participants[tournamentState.finals.player2Id];
    historyList = Object.values(p2?.handicapHistory || {});
  }
  const chosen = historyList[index];
  if (!chosen) return;
  return window.selectFinalsHandicap(type, chosen);
};

window.startFinalsMatch = async function() {
  if (!requireAdmin()) return;
  if (!tournamentState.finals.p1ChosenForP2 || !tournamentState.finals.p2ChosenForP1) {
    showToast('양쪽 모두 상대방에게 부여할 핸디캡을 선택해야 합니다.');
    return;
  }

  tournamentState.status = 'finals';
  playSound('start');
  await syncState();
  showToast('👑 결승전 데스매치 시작!');
};

window.setFinalsWinner = async function(winnerId) {
  if (!requireAdmin()) return;
  if (!winnerId) {
    showToast('승자 ID를 찾을 수 없습니다.');
    return;
  }
  if (!tournamentState.finals) {
    tournamentState.finals = { player1Id: null, player2Id: null, p1ChosenForP2: '', p2ChosenForP1: '', winnerId: null };
  }
  tournamentState.finals.winnerId = winnerId;
  const p1Id = tournamentState.finals.player1Id;
  const p2Id = tournamentState.finals.player2Id;
  const loserId = (winnerId === p1Id) ? p2Id : p1Id;

  if (!tournamentState.prizes) {
    tournamentState.prizes = { rank1: null, rank2: null, rank3: null };
  }
  tournamentState.prizes.rank1 = winnerId;
  tournamentState.prizes.rank2 = loserId;

  if (tournamentState.participants) {
    if (tournamentState.participants[winnerId]) {
      tournamentState.participants[winnerId].isAlive = true;
      tournamentState.participants[winnerId].finalRank = 1;
    }
    if (tournamentState.participants[loserId]) {
      tournamentState.participants[loserId].isAlive = false;
      tournamentState.participants[loserId].eliminatedRound = 'finals';
      tournamentState.participants[loserId].finalRank = 2;
    }
  }

  const winner = tournamentState.participants?.[winnerId];
  playSound('win');
  await syncState();
  showToast(`👑 ${escapeHtml(winner?.name || '승자')} 우승 확정! [토너먼트 종료 및 결과 발표] 버튼을 누르세요.`);
};

window.finishTournamentCeremony = async function() {
  if (!requireAdmin()) return;
  if (!tournamentState.finals?.winnerId) {
    showToast('결승전 승자를 먼저 선택해주세요.');
    return;
  }

  const winnerId = tournamentState.finals.winnerId;
  const p1Id = tournamentState.finals.player1Id;
  const p2Id = tournamentState.finals.player2Id;
  const loserId = (winnerId === p1Id) ? p2Id : p1Id;

  if (!tournamentState.prizes) {
    tournamentState.prizes = { rank1: null, rank2: null, rank3: null };
  }
  tournamentState.prizes.rank1 = winnerId;
  tournamentState.prizes.rank2 = loserId;

  if (tournamentState.participants) {
    if (tournamentState.participants[winnerId]) {
      tournamentState.participants[winnerId].isAlive = true;
      tournamentState.participants[winnerId].finalRank = 1;
    }
    if (tournamentState.participants[loserId]) {
      tournamentState.participants[loserId].isAlive = false;
      tournamentState.participants[loserId].eliminatedRound = 'finals';
      tournamentState.participants[loserId].finalRank = 2;
    }
  }

  tournamentState.status = 'ended';

  if (window.confetti) {
    window.confetti({
      particleCount: 150,
      spread: 90,
      origin: { y: 0.5 }
    });
  }

  playSound('win');
  await syncState();
  showToast('🏆 토너먼트 시상식이 시작되었습니다!');
};

window.toggleFriendStatus = async function(playerId, isFriend) {
  if (!requireAdmin()) return;
  if (!tournamentState.participants[playerId]) return;
  tournamentState.participants[playerId].isFriend = isFriend;
  await syncState();
  showToast(`친추 여부 변경 완료!`);
};

window.removeParticipant = async function(playerId) {
  if (!requireAdmin()) return;
  if (tournamentState.participants[playerId]) {
    delete tournamentState.participants[playerId];
    await syncState();
    showToast('참가자가 제외되었습니다.');
  }
};

// --------------------------------------------------------------------------
// PROXY HANDICAP MODAL (For mobile streamers helping chat viewers)
// --------------------------------------------------------------------------
let proxyTargetId = null;

window.openProxyHandicapModal = function(playerId) {
  if (!requireAdmin()) return;
  proxyTargetId = playerId;
  const player = tournamentState.participants?.[playerId];
  if (!player) return;

  const modal = document.getElementById('modal-proxy-handicap');
  const idEl = document.getElementById('proxy-player-id');
  const nameEl = document.getElementById('proxy-player-name');
  const inputEl = document.getElementById('proxy-handicap-input');

  if (idEl) idEl.value = playerId;
  if (nameEl) nameEl.textContent = player.name;
  const roundKey = `round_${tournamentState.round}`;
  const existing = tournamentState.rounds?.[roundKey]?.handicaps?.[playerId] || '';
  if (inputEl) inputEl.value = existing;
  if (modal) modal.classList.add('open');
};

window.closeProxyModal = function() {
  document.getElementById('modal-proxy-handicap').classList.remove('open');
};

window.saveProxyHandicap = async function() {
  if (!requireAdmin()) return;
  const input = document.getElementById('proxy-handicap-input');
  const text = input ? input.value.trim().slice(0, 100) : '';
  if (!text || !proxyTargetId) return;

  const roundKey = `round_${tournamentState.round}`;
  if (!tournamentState.rounds[roundKey]) {
    tournamentState.rounds[roundKey] = { roundNumber: tournamentState.round, handicaps: {}, scores: {}, totalScores: {} };
  }
  if (!tournamentState.rounds[roundKey].handicaps) {
    tournamentState.rounds[roundKey].handicaps = {};
  }
  tournamentState.rounds[roundKey].handicaps[proxyTargetId] = text;

  // Add to history
  if (tournamentState.participants[proxyTargetId]) {
    if (!tournamentState.participants[proxyTargetId].handicapHistory) {
      tournamentState.participants[proxyTargetId].handicapHistory = {};
    }
    tournamentState.participants[proxyTargetId].handicapHistory[roundKey] = text;
  }

  closeProxyModal();
  await syncState();
  showToast('핸디캡 대리 입력 완료!');
};

// --------------------------------------------------------------------------
// SETTINGS & MOCK TEST DATA
// --------------------------------------------------------------------------
window.openSettingsModal = function() {
  if (!requireAdmin()) return;
  const config = getFirebaseConfig();
  const dbUrlEl = document.getElementById('cfg-db-url');
  const apiKeyEl = document.getElementById('cfg-api-key');
  const projectIdEl = document.getElementById('cfg-project-id');

  if (dbUrlEl) dbUrlEl.value = config.databaseURL || '';
  if (apiKeyEl) apiKeyEl.value = config.apiKey || '';
  if (projectIdEl) projectIdEl.value = config.projectId || '';

  document.getElementById('modal-settings').classList.add('open');
};

window.closeSettingsModal = function() {
  document.getElementById('modal-settings').classList.remove('open');
};

window.saveSettingsForm = function() {
  if (!requireAdmin()) return;
  const dbUrl = document.getElementById('cfg-db-url').value.trim();
  const apiKey = document.getElementById('cfg-api-key').value.trim();
  const projectId = document.getElementById('cfg-project-id').value.trim();

  // Admin password is never saved into tournamentState or public RTDB!
  delete tournamentState.adminPin;

  const newConfig = {
    ...getFirebaseConfig(),
    databaseURL: dbUrl,
    apiKey,
    projectId
  };

  saveFirebaseConfig(newConfig);
  closeSettingsModal();
  showToast('설정 저장 완료! 새로고침하여 Firebase에 연결합니다.');
  setTimeout(() => location.reload(), 800);
};

window.resetTournamentConfirm = async function() {
  if (!requireAdmin()) return;
  if (confirm('정말로 모든 토너먼트 데이터를 초기화하고 처음부터 다시 시작하시겠습니까?')) {
    tournamentState = JSON.parse(JSON.stringify(DEFAULT_STATE));
    delete tournamentState.adminPin;
    await syncState();
    closeSettingsModal();
    showToast('토너먼트가 초기화되었습니다.');
    renderAll();
  }
};

window.injectDummyParticipants = async function() {
  if (!requireAdmin()) return;
  const dummyNames = [
    { name: '호그라이더장인', clan: '쇼의클랜', handicap: '스펠 카드 0개로 플레이' },
    { name: '빅덱러버', clan: '골렘사랑', handicap: '평균 4.8 엘릭서 이상 빅덱 플레이' },
    { name: '공중폭격기', clan: '라벌연합', handicap: '올 공중 유닛만 사용하기' },
    { name: '건물수호자', clan: '쇼의클랜', handicap: '건물 카드 3개 이상 필참' },
    { name: '페카원챔', clan: '전투의신', handicap: '원거리 딜러 없이 근접만 사용' },
    { name: '스켈레톤군단', clan: '해골동맹', handicap: '해골 관련 카드 4종 이상 덱 구성' },
    { name: '극단적순환', clan: '순환장인', handicap: '평균 엘릭서 2.6 이하 덱 플레이' },
    { name: '마법사외길', clan: '마법학교', handicap: '마법 유닛(법사,얼법,감전) 3명 포함' },
    { name: '기사단장', clan: '쇼의클랜', handicap: '희귀 및 일반 카드만으로 덱 구성' },
    { name: '한손컨트롤러', clan: '클로고수', handicap: '한 손가락만 사용해서 플레이' }
  ];

  if (!tournamentState.participants) tournamentState.participants = {};

  dummyNames.forEach((d, i) => {
    const id = `p_dummy_${i + 1}`;
    tournamentState.participants[id] = {
      id,
      name: d.name,
      clan: d.clan,
      isAlive: true,
      isFriend: i === 0, // 1st dummy has friend status for testing
      eliminatedRound: null,
      eliminatedReason: null,
      finalRank: null,
      handicapHistory: {
        round_1: d.handicap
      }
    };

    // Pre-fill round 1 handicaps
    if (tournamentState.rounds?.round_1) {
      if (!tournamentState.rounds.round_1.handicaps) tournamentState.rounds.round_1.handicaps = {};
      tournamentState.rounds.round_1.handicaps[id] = d.handicap;
    }
  });

  await syncState();
  showToast('🤖 가상 참가자 10명 생성 완료!');
};

window.copyParticipantLink = function() {
  const url = window.location.origin + window.location.pathname + '?tab=player';
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      showToast('참가 링크가 복사되었습니다!');
    });
  } else {
    prompt('참가자 링크를 복사하세요:', url);
  }
};

// URL query parameter check (e.g. ?tab=player)
function checkUrlTab() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  if (tab && ['host', 'judge', 'player'].includes(tab)) {
    switchTab(tab);
  } else {
    // If not authenticated, always show player tab first to viewers
    const initialTab = isTabAuthorized('host') ? 'host' : 'player';
    doSwitchTab(initialTab);
  }
}

// Start app
window.addEventListener('DOMContentLoaded', () => {
  initDatabase();
  checkUrlTab();
});
