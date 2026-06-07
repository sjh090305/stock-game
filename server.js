const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ─────────────────────────────────────────
// 정적 파일 서빙
// ─────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─────────────────────────────────────────
// 초기 게임 상태
// ─────────────────────────────────────────
const STOCKS = [
  { id: 'khfood',     name: '김해푸드',   color: '#22c55e', startPrice: 30000, type: '안정 성장주' },
  { id: 'miratech',  name: '미래테크',   color: '#3b82f6', startPrice: 50000, type: '고위험 성장주' },
  { id: 'issuegames',name: '이슈게임즈', color: '#f97316', startPrice: 20000, type: '뉴스 연동주' },
  { id: 'bubblecoin',name: '버블코인',   color: '#a855f7', startPrice: 10000, type: '초고위험 코인주' },
];

function createInitialState() {
  const prices = {};
  const priceHistory = {};
  STOCKS.forEach(s => {
    prices[s.id] = s.startPrice;
    priceHistory[s.id] = [s.startPrice];
  });
  return {
    round: 1, maxRound: 5,
    timerSec: 300, timerLeft: 300,
    timerRunning: false, timerStartedAt: null,
    prices, priceHistory,
    teams: {}, nextTeamId: 1,
    freeze: false,
    eventLog: [],
    roundStats: [],
    presets: [],
    broadcast: null,
    minigame: null,
    news: [],
    adminPw: 'admin1234',
  };
}

let gameState = createInitialState();

// ─────────────────────────────────────────
// 타이머
// ─────────────────────────────────────────
let timerInterval = null;

function startTimer() {
  clearInterval(timerInterval);
  gameState.timerStartedAt = Date.now();
  gameState.timerRunning = true;
  timerInterval = setInterval(() => {
    if (!gameState.timerRunning) { clearInterval(timerInterval); return; }
    const elapsed = Math.floor((Date.now() - gameState.timerStartedAt) / 1000);
    const left = Math.max(0, gameState.timerLeft - elapsed);
    if (left <= 0) {
      clearInterval(timerInterval);
      endRound();
    }
    broadcast({ type: 'TIMER', left: Math.max(0, gameState.timerLeft - elapsed), running: true });
  }, 1000);
}

function pauseTimer() {
  const elapsed = Math.floor((Date.now() - gameState.timerStartedAt) / 1000);
  gameState.timerLeft = Math.max(0, gameState.timerLeft - elapsed);
  gameState.timerRunning = false;
  gameState.timerStartedAt = null;
  clearInterval(timerInterval);
  broadcast({ type: 'TIMER', left: gameState.timerLeft, running: false });
}

function endRound() {
  saveRoundStats();
  if (gameState.round >= gameState.maxRound) {
    gameState.timerRunning = false;
    addLog('🏆 게임 종료!');
    broadcastState();
    broadcast({ type: 'GAME_OVER' });
    return;
  }
  gameState.round++;
  gameState.timerLeft = gameState.timerSec;
  gameState.timerRunning = false;
  gameState.timerStartedAt = null;
  addLog(`라운드 ${gameState.round - 1} 종료 → 라운드 ${gameState.round} 시작 대기`);
  broadcastState();
  broadcast({ type: 'ROUND_END', round: gameState.round });
}

function saveRoundStats() {
  const snap = { round: gameState.round, teams: {} };
  Object.entries(gameState.teams).forEach(([id, t]) => {
    snap.teams[id] = { name: t.name, asset: calcAsset(t), cash: t.cash };
  });
  gameState.roundStats.push(snap);
}

// ─────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────
function calcAsset(team) {
  let total = team.cash || 0;
  Object.entries(team.holdings || {}).forEach(([id, qty]) => {
    total += (gameState.prices[id] || 0) * qty;
  });
  return total;
}

function addLog(msg) {
  gameState.eventLog.push({ ts: Date.now(), msg });
  if (gameState.eventLog.length > 100) gameState.eventLog.shift();
}

function changePrice(id, pct, absVal) {
  const st = STOCKS.find(x => x.id === id);
  const old = gameState.prices[id];
  let newp = absVal !== null && absVal !== undefined ? absVal : Math.round(old * (1 + pct / 100));
  newp = Math.max(100, newp);
  gameState.prices[id] = newp;
  if (!gameState.priceHistory[id]) gameState.priceHistory[id] = [];
  gameState.priceHistory[id].push(newp);
  if (gameState.priceHistory[id].length > 60) gameState.priceHistory[id].shift();
  const diff = newp - old;
  const diffPct = ((diff / old) * 100).toFixed(1);
  addLog(`${diff >= 0 ? '📈' : '📉'} ${st.name} ${diff >= 0 ? '+' : ''}${diffPct}% → ${newp.toLocaleString()}원`);
}

// ─────────────────────────────────────────
// WebSocket 브로드캐스트
// ─────────────────────────────────────────
const clients = new Map(); // ws → { role, teamId }

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

function broadcastState() {
  broadcast({ type: 'STATE', state: gameState });
}

function sendTo(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ─────────────────────────────────────────
// WebSocket 핸들러
// ─────────────────────────────────────────
wss.on('connection', (ws) => {
  clients.set(ws, { role: null, teamId: null });

  // 연결 즉시 현재 상태 전송
  sendTo(ws, { type: 'STATE', state: gameState });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const clientInfo = clients.get(ws);

    // ── 인증 ──
    if (msg.type === 'ADMIN_LOGIN') {
      if (msg.pw === gameState.adminPw || msg.pw === 'admin1234') {
        clients.set(ws, { role: 'admin', teamId: null });
        sendTo(ws, { type: 'AUTH_OK', role: 'admin' });
        sendTo(ws, { type: 'STATE', state: gameState });
      } else {
        sendTo(ws, { type: 'AUTH_FAIL', msg: '비밀번호가 틀렸습니다.' });
      }
      return;
    }

    if (msg.type === 'PLAYER_LOGIN') {
      const code = (msg.code || '').toUpperCase();
      const entry = Object.entries(gameState.teams).find(([_, t]) => t.code === code && t.pw === msg.pw);
      if (entry) {
        clients.set(ws, { role: 'player', teamId: entry[0] });
        sendTo(ws, { type: 'AUTH_OK', role: 'player', teamId: entry[0], teamName: entry[1].name });
        sendTo(ws, { type: 'STATE', state: gameState });
      } else {
        sendTo(ws, { type: 'AUTH_FAIL', msg: '코드 또는 비밀번호가 틀렸습니다.' });
      }
      return;
    }

    // ── 관리자 전용 액션 ──
    if (clientInfo.role !== 'admin') return;

    switch (msg.type) {

      case 'CREATE_TEAM': {
        const { name, code, pw, cash } = msg;
        if (!name || !code || !pw) return;
        const c = code.toUpperCase();
        if (Object.values(gameState.teams).some(t => t.code === c)) {
          sendTo(ws, { type: 'ERROR', msg: '이미 사용 중인 코드입니다.' }); return;
        }
        const id = 't' + gameState.nextTeamId++;
        gameState.teams[id] = { id, name, code: c, pw, cash: cash || 1000000, holdings: {}, buyAvg: {}, tradeLog: [] };
        addLog(`팀 생성: ${name} (${c})`);
        broadcastState();
        break;
      }

      case 'DELETE_TEAM': {
        const t = gameState.teams[msg.teamId];
        if (t) { addLog(`팀 삭제: ${t.name}`); delete gameState.teams[msg.teamId]; broadcastState(); }
        break;
      }

      case 'ADJUST_MONEY': {
        const t = gameState.teams[msg.teamId]; if (!t) return;
        if (msg.adjustType === 'add') t.cash += msg.amount;
        else if (msg.adjustType === 'sub') t.cash = Math.max(0, t.cash - msg.amount);
        else t.cash = msg.amount;
        addLog(`💰 ${t.name} 자금 조정: ${t.cash.toLocaleString()}원`);
        broadcastState();
        break;
      }

      case 'CHANGE_PRICE': {
        changePrice(msg.stockId, msg.pct, msg.absVal);
        broadcastState();
        break;
      }

      case 'RANDOM_PRICE': {
        const cfg = msg.config || {};
        STOCKS.forEach(st => {
          const c = cfg[st.id] || { min: -10, max: 10 };
          const pct = c.min + Math.random() * (c.max - c.min);
          changePrice(st.id, pct, null);
        });
        broadcastState();
        break;
      }

      case 'PUBLISH_EVENT': {
        const { title, desc, targets, changeType, value } = msg;
        targets.forEach(id => {
          const old = gameState.prices[id]; let newp;
          if (changeType === 'pct') newp = Math.round(old * (1 + value / 100));
          else if (changeType === 'abs_delta') newp = old + value;
          else newp = value;
          newp = Math.max(100, newp);
          gameState.prices[id] = newp;
          if (!gameState.priceHistory[id]) gameState.priceHistory[id] = [];
          gameState.priceHistory[id].push(newp);
          if (gameState.priceHistory[id].length > 60) gameState.priceHistory[id].shift();
        });
        if (!gameState.news) gameState.news = [];
        gameState.news.unshift({ title, desc, ts: Date.now() });
        if (gameState.news.length > 20) gameState.news.pop();
        addLog(`📢 ${title}: ${targets.join(', ')} ${changeType === 'pct' ? value + '%' : value + '원'}`);
        broadcastState();
        broadcast({ type: 'NEWS', title, desc });
        break;
      }

      case 'TOGGLE_FREEZE': {
        gameState.freeze = !gameState.freeze;
        addLog(gameState.freeze ? '🔒 거래 동결' : '🔓 거래 동결 해제');
        broadcastState();
        break;
      }

      case 'BROADCAST': {
        gameState.broadcast = { title: msg.title, body: msg.body, ts: Date.now() };
        addLog(`📣 공지: ${msg.title}`);
        broadcastState();
        break;
      }

      case 'TIMER_START': {
        if (!gameState.timerRunning) startTimer();
        break;
      }

      case 'TIMER_PAUSE': {
        if (gameState.timerRunning) pauseTimer();
        break;
      }

      case 'TIMER_RESET': {
        clearInterval(timerInterval);
        gameState.timerLeft = gameState.timerSec;
        gameState.timerRunning = false;
        gameState.timerStartedAt = null;
        broadcast({ type: 'TIMER', left: gameState.timerLeft, running: false });
        break;
      }

      case 'TIMER_SET': {
        gameState.timerSec = msg.sec;
        gameState.timerLeft = msg.sec;
        gameState.timerRunning = false;
        gameState.timerStartedAt = null;
        clearInterval(timerInterval);
        broadcastState();
        break;
      }

      case 'FORCE_NEXT_ROUND': {
        clearInterval(timerInterval);
        gameState.timerRunning = false;
        gameState.timerStartedAt = null;
        endRound();
        break;
      }

      case 'SET_MINIGAME': {
        gameState.minigame = { ...msg.config, active: false };
        broadcastState();
        break;
      }

      case 'ACTIVATE_MINIGAME': {
        if (gameState.minigame) { gameState.minigame.active = true; broadcastState(); }
        break;
      }

      case 'DEACTIVATE_MINIGAME': {
        if (gameState.minigame) { gameState.minigame.active = false; broadcastState(); }
        break;
      }

      case 'SAVE_PRESET': {
        if (!gameState.presets) gameState.presets = [];
        gameState.presets.push(msg.preset);
        broadcastState();
        break;
      }

      case 'DELETE_PRESET': {
        gameState.presets.splice(msg.index, 1);
        broadcastState();
        break;
      }

      case 'RESET': {
        clearInterval(timerInterval);
        gameState = createInitialState();
        broadcastState();
        break;
      }
    }
  });

  // ── 플레이어 액션 (별도 처리) ──
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const clientInfo = clients.get(ws);
    if (clientInfo.role !== 'player') return;
    const teamId = clientInfo.teamId;
    const team = gameState.teams[teamId];
    if (!team) return;

    if (msg.type === 'TRADE') {
      if (gameState.freeze) { sendTo(ws, { type: 'ERROR', msg: '거래가 동결되어 있습니다.' }); return; }
      const { mode, stockId, qty } = msg;
      const price = gameState.prices[stockId];
      const total = price * qty;
      if (mode === 'buy') {
        if (team.cash < total) { sendTo(ws, { type: 'ERROR', msg: '현금이 부족합니다.' }); return; }
        team.cash -= total;
        if (!team.holdings) team.holdings = {};
        if (!team.buyAvg) team.buyAvg = {};
        const prevQty = team.holdings[stockId] || 0;
        const prevAvg = team.buyAvg[stockId] || price;
        team.buyAvg[stockId] = ((prevAvg * prevQty) + (price * qty)) / (prevQty + qty);
        team.holdings[stockId] = prevQty + qty;
        if (!team.tradeLog) team.tradeLog = [];
        team.tradeLog.push({ type: 'buy', stock: stockId, qty, price, total, ts: Date.now(), round: gameState.round });
        addLog(`${team.name} ${STOCKS.find(s=>s.id===stockId)?.name} ${qty}주 매수`);
      } else {
        const owned = (team.holdings || {})[stockId] || 0;
        if (owned < qty) { sendTo(ws, { type: 'ERROR', msg: `보유 주식 부족 (보유: ${owned}주)` }); return; }
        team.cash += total;
        team.holdings[stockId] = owned - qty;
        if (team.holdings[stockId] === 0) delete team.holdings[stockId];
        if (!team.tradeLog) team.tradeLog = [];
        team.tradeLog.push({ type: 'sell', stock: stockId, qty, price, total, ts: Date.now(), round: gameState.round });
        addLog(`${team.name} ${STOCKS.find(s=>s.id===stockId)?.name} ${qty}주 매도`);
      }
      broadcastState();
      sendTo(ws, { type: 'TRADE_OK', mode, stockId, qty, price, total });
    }

    if (msg.type === 'SUBMIT_OX') {
      const mg = gameState.minigame;
      if (!mg || mg.type !== 'ox') return;
      if (msg.answer === mg.answer) {
        team.cash += mg.reward || 100000;
        sendTo(ws, { type: 'MG_RESULT', correct: true, reward: mg.reward || 100000 });
        addLog(`🎮 OX 정답: ${team.name} +${mg.reward || 100000}원`);
        broadcastState();
      } else {
        sendTo(ws, { type: 'MG_RESULT', correct: false });
      }
    }

    if (msg.type === 'SUBMIT_PREDICT') {
      const mg = gameState.minigame;
      if (!mg || mg.type !== 'predict') return;
      if (!team.mgPredicts) team.mgPredicts = {};
      team.mgPredicts[mg.stock] = msg.direction;
      sendTo(ws, { type: 'PREDICT_SAVED' });
    }
  });

  ws.on('close', () => { clients.delete(ws); });
});

// ─────────────────────────────────────────
// REST API (관리자 비밀번호 변경 등)
// ─────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, round: gameState.round }));

// ─────────────────────────────────────────
// 서버 시작
// ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ 주식투자 게임 서버 실행 중: http://localhost:${PORT}`);
  console.log(`   관리자: http://localhost:${PORT}/admin.html`);
  console.log(`   플레이어: http://localhost:${PORT}/player.html`);
});
