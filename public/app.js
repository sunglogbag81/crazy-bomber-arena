const socket = io();
const $ = (id) => document.getElementById(id);
const lobby = $('lobby');
const game = $('game');
const canvas = $('arena');
const ctx = canvas.getContext('2d');
const keys = { up: false, down: false, left: false, right: false };
let state = null;
let myId = null;

const keyMap = {
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
};

$('create').onclick = () => socket.emit('createRoom', { name: nameValue() }, enterRoom);
$('join').onclick = () => socket.emit('joinRoom', { code: $('code').value.trim(), name: nameValue() }, enterRoom);
$('roomCode').onclick = async () => {
  if (!state?.code) return;
  await navigator.clipboard?.writeText(state.code).catch(() => {});
  $('roomCode').textContent = '복사됨';
  setTimeout(() => $('roomCode').textContent = state.code, 800);
};
$('mobileBomb').onclick = () => socket.emit('bomb');

function nameValue() {
  return $('name').value.trim() || `Player${Math.floor(Math.random() * 90 + 10)}`;
}
function enterRoom(res) {
  if (!res?.ok) return alert(res?.error || '입장 실패');
  state = res.room;
  myId = res.playerId;
  lobby.classList.add('hidden');
  game.classList.remove('hidden');
  $('roomCode').textContent = state.code;
  render();
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); socket.emit('bomb'); return; }
  const k = keyMap[e.key];
  if (!k || keys[k]) return;
  keys[k] = true;
  socket.emit('input', keys);
});
window.addEventListener('keyup', (e) => {
  const k = keyMap[e.key];
  if (!k) return;
  keys[k] = false;
  socket.emit('input', keys);
});

document.querySelectorAll('[data-key]').forEach((button) => {
  const k = button.dataset.key;
  const set = (v) => { keys[k] = v; socket.emit('input', keys); };
  button.addEventListener('pointerdown', (e) => { e.preventDefault(); set(true); });
  button.addEventListener('pointerup', () => set(false));
  button.addEventListener('pointerleave', () => set(false));
  button.addEventListener('pointercancel', () => set(false));
});

socket.on('state', (next) => {
  state = next;
  if (state?.code) $('roomCode').textContent = state.code;
  render();
});

function render() {
  if (!state) return;
  const { tile, cols, rows } = state;
  canvas.width = cols * tile;
  canvas.height = rows * tile;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawBoard();
  drawBombs();
  drawBlasts();
  drawPlayers();
  drawOverlay();
  renderHud();
}

function drawBoard() {
  const { board, tile } = state;
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board[y].length; x++) {
      const px = x * tile;
      const py = y * tile;
      ctx.fillStyle = (x + y) % 2 ? '#24375c' : '#1f3153';
      ctx.fillRect(px, py, tile, tile);
      if (board[y][x] === 'wall') {
        ctx.fillStyle = '#6c7899';
        roundRect(px + 4, py + 4, tile - 8, tile - 8, 8, true);
        ctx.fillStyle = 'rgba(255,255,255,.16)';
        ctx.fillRect(px + 8, py + 8, tile - 16, 5);
      }
      if (board[y][x] === 'crate') {
        ctx.fillStyle = '#b8793a';
        roundRect(px + 5, py + 5, tile - 10, tile - 10, 7, true);
        ctx.strokeStyle = 'rgba(70,30,10,.5)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(px + 10, py + 10); ctx.lineTo(px + tile - 10, py + tile - 10); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px + tile - 10, py + 10); ctx.lineTo(px + 10, py + tile - 10); ctx.stroke();
      }
    }
  }
}
function drawBombs() {
  const now = Date.now();
  for (const b of state.bombs) {
    const cx = b.x * state.tile + state.tile / 2;
    const cy = b.y * state.tile + state.tile / 2;
    const pulse = 1 + Math.sin(now / 90) * 0.08;
    ctx.fillStyle = '#101018';
    ctx.beginPath(); ctx.arc(cx, cy, 13 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffed75';
    ctx.fillRect(cx + 8, cy - 17, 8, 5);
  }
}
function drawBlasts() {
  for (const b of state.blasts) {
    const x = b.x * state.tile;
    const y = b.y * state.tile;
    const grad = ctx.createRadialGradient(x + 20, y + 20, 2, x + 20, y + 20, 24);
    grad.addColorStop(0, '#fff6a6');
    grad.addColorStop(.45, '#ff9d3c');
    grad.addColorStop(1, 'rgba(255,92,122,.16)');
    ctx.fillStyle = grad;
    roundRect(x + 3, y + 3, state.tile - 6, state.tile - 6, 12, true);
  }
}
function drawPlayers() {
  for (const p of state.players) {
    ctx.globalAlpha = p.alive ? 1 : .35;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.px, p.py, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#10121f';
    ctx.beginPath(); ctx.arc(p.px - 5, p.py - 4, 2.3, 0, Math.PI * 2); ctx.arc(p.px + 5, p.py - 4, 2.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = '700 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, p.px, p.py - 21);
    if (p.id === myId) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.px, p.py, 19, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
function drawOverlay() {
  if (state.status === 'waiting') centeredText('친구가 들어오면 게임 시작!', '방 코드를 공유하세요');
  if (state.status === 'roundOver') centeredText(`${state.winner} 승리!`, '잠시 후 다음 라운드');
}
function centeredText(title, sub) {
  ctx.fillStyle = 'rgba(10,12,24,.68)';
  roundRect(80, canvas.height / 2 - 62, canvas.width - 160, 124, 24, true);
  ctx.fillStyle = 'white'; ctx.textAlign = 'center';
  ctx.font = '900 34px system-ui'; ctx.fillText(title, canvas.width / 2, canvas.height / 2 - 8);
  ctx.font = '700 17px system-ui'; ctx.fillStyle = '#c9eaff'; ctx.fillText(sub, canvas.width / 2, canvas.height / 2 + 28);
}
function renderHud() {
  const alive = state.players.filter(p => p.alive).length;
  $('status').textContent = state.status === 'playing' ? `전투 중 · 생존 ${alive}` : state.status === 'roundOver' ? `${state.winner} 승리` : `대기 중 · ${state.players.length}/${state.maxPlayers}`;
  $('players').innerHTML = state.players.map(p => `
    <div class="player-card ${p.alive ? '' : 'dead'}">
      <span><span style="color:${p.color}">●</span> ${escapeHtml(p.name)}${p.id === myId ? ' (나)' : ''}</span>
      <strong>${'❤'.repeat(Math.max(0, p.hp))}</strong>
    </div>`).join('');
}
function escapeHtml(str) {
  return str.replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}
function roundRect(x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  if (fill) ctx.fill(); else ctx.stroke();
}
