import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.ALLOWED_ORIGIN || '*' },
  transports: ['websocket', 'polling'],
});

app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const PORT = process.env.PORT || 3000;
const TICK_RATE = 20;
const COLS = 15;
const ROWS = 13;
const TILE = 40;
const MAX_PLAYERS = 4;
const BOMB_TIMER = 1900;
const BLAST_TIME = 520;
const ROUND_END_DELAY = 2600;

const spawns = [
  { x: 1, y: 1 },
  { x: COLS - 2, y: ROWS - 2 },
  { x: COLS - 2, y: 1 },
  { x: 1, y: ROWS - 2 },
];
const colors = ['#58d7ff', '#ff5c9a', '#ffe15c', '#8cff7a'];
const botNames = ['버블봇', '폭탄봇', '회피봇'];
const rooms = new Map();

function roomCode() {
  let code;
  do code = Math.random().toString(36).slice(2, 6).toUpperCase();
  while (rooms.has(code));
  return code;
}

function makeBoard() {
  const board = [];
  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) {
      if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || (x % 2 === 0 && y % 2 === 0)) row.push('wall');
      else row.push(Math.random() < 0.58 ? 'crate' : 'floor');
    }
    board.push(row);
  }
  for (const s of spawns) {
    for (const [dx, dy] of [[0,0], [1,0], [-1,0], [0,1], [0,-1]]) {
      const x = s.x + dx;
      const y = s.y + dy;
      if (board[y]?.[x] && board[y][x] !== 'wall') board[y][x] = 'floor';
    }
  }
  return board;
}

function createRoom(code = roomCode()) {
  const room = {
    code,
    board: makeBoard(),
    players: new Map(),
    bombs: [],
    blasts: [],
    status: 'waiting',
    winner: null,
    nextRoundAt: 0,
    lastActive: Date.now(),
    solo: false,
  };
  rooms.set(code, room);
  return room;
}

function publicRoom(room) {
  return {
    code: room.code,
    cols: COLS,
    rows: ROWS,
    tile: TILE,
    board: room.board,
    players: [...room.players.values()].map(({ input, ai, ...p }) => p),
    bombs: room.bombs.map(b => ({ x: b.x, y: b.y, ownerId: b.ownerId, explodeAt: b.explodeAt })),
    blasts: room.blasts.map(b => ({ x: b.x, y: b.y, until: b.until })),
    status: room.status,
    winner: room.winner,
    maxPlayers: MAX_PLAYERS,
    solo: room.solo,
  };
}

function tileAtPixel(v) { return Math.floor((v + TILE / 2) / TILE); }
function centerOf(tile) { return tile * TILE + TILE / 2; }
function playerTile(p) { return { x: tileAtPixel(p.px), y: tileAtPixel(p.py) }; }
function isBlocked(room, x, y, ignoreBombForPlayer = null) {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return true;
  if (room.board[y][x] !== 'floor') return true;
  return room.bombs.some(b => b.x === x && b.y === y && ignoreBombForPlayer !== b.ownerId);
}
function canMoveTo(room, px, py, playerId) {
  const margin = 13;
  const points = [
    [px - margin, py - margin], [px + margin, py - margin],
    [px - margin, py + margin], [px + margin, py + margin],
  ];
  return points.every(([x, y]) => !isBlocked(room, Math.floor(x / TILE), Math.floor(y / TILE), playerId));
}
function humanCount(room) { return [...room.players.values()].filter(p => !p.bot).length; }

function addPlayer(room, socket, name) {
  return addPlayerCore(room, socket.id, name || 'Player', false);
}
function addBot(room, index = 0) {
  return addPlayerCore(room, `bot-${room.code}-${Date.now()}-${index}`, botNames[index % botNames.length], true);
}
function addPlayerCore(room, id, name, bot) {
  const used = new Set([...room.players.values()].map(p => p.slot));
  const slot = [0,1,2,3].find(n => !used.has(n));
  if (slot === undefined) return null;
  const s = spawns[slot];
  const player = {
    id,
    name: String(name || 'Player').slice(0, 14),
    bot,
    slot,
    color: colors[slot],
    px: centerOf(s.x),
    py: centerOf(s.y),
    hp: 3,
    alive: true,
    speed: bot ? 2.6 : 3.05,
    range: 2,
    maxBombs: 1,
    input: { up: false, down: false, left: false, right: false },
    lastBombAt: 0,
    ai: bot ? { nextThink: 0, target: s, panicUntil: 0 } : null,
  };
  room.players.set(id, player);
  room.status = room.players.size >= 2 ? 'playing' : 'waiting';
  room.lastActive = Date.now();
  return player;
}
function addSoloBots(room, count = 2) {
  room.solo = true;
  while (room.players.size < Math.min(MAX_PLAYERS, count + 1)) addBot(room, room.players.size);
  room.status = 'playing';
}

function placeBomb(room, player) {
  if (!player?.alive || room.status !== 'playing') return;
  const now = Date.now();
  if (now - player.lastBombAt < 280) return;
  const { x, y } = playerTile(player);
  const active = room.bombs.filter(b => b.ownerId === player.id).length;
  if (active >= player.maxBombs || room.bombs.some(b => b.x === x && b.y === y)) return;
  room.bombs.push({ x, y, ownerId: player.id, range: player.range, explodeAt: now + BOMB_TIMER });
  player.lastBombAt = now;
}

function blastCells(room, bomb) {
  const cells = [{ x: bomb.x, y: bomb.y }];
  for (const [dx, dy] of [[1,0], [-1,0], [0,1], [0,-1]]) {
    for (let i = 1; i <= bomb.range; i++) {
      const x = bomb.x + dx * i;
      const y = bomb.y + dy * i;
      const tile = room.board[y]?.[x];
      if (!tile || tile === 'wall') break;
      cells.push({ x, y });
      if (tile === 'crate') break;
    }
  }
  return cells;
}
function explode(room, bomb) {
  room.bombs = room.bombs.filter(b => b !== bomb);
  const now = Date.now();
  const cells = blastCells(room, bomb);
  for (const cell of cells) {
    if (room.board[cell.y]?.[cell.x] === 'crate') room.board[cell.y][cell.x] = 'floor';
    room.blasts.push({ ...cell, until: now + BLAST_TIME });
  }
  for (const other of [...room.bombs]) {
    if (cells.some(c => c.x === other.x && c.y === other.y)) other.explodeAt = Math.min(other.explodeAt, now + 80);
  }
}

function dangerAt(room, x, y) {
  const now = Date.now();
  if (room.blasts.some(b => b.x === x && b.y === y)) return 999;
  let danger = 0;
  for (const bomb of room.bombs) {
    if (blastCells(room, bomb).some(c => c.x === x && c.y === y)) {
      danger = Math.max(danger, Math.max(1, 4 - Math.floor((bomb.explodeAt - now) / 500)));
    }
  }
  return danger;
}
function hasAdjacentCrate(room, x, y) {
  return [[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dy]) => room.board[y + dy]?.[x + dx] === 'crate');
}
function distance(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
function updateBot(room, bot) {
  const now = Date.now();
  const t = playerTile(bot);
  if (now < bot.ai.nextThink) return;
  bot.ai.nextThink = now + 260 + Math.random() * 420;

  const choices = [[0,-1,'up'], [0,1,'down'], [-1,0,'left'], [1,0,'right']]
    .map(([dx, dy, key]) => ({ x: t.x + dx, y: t.y + dy, key }))
    .filter(c => !isBlocked(room, c.x, c.y, bot.id));
  bot.input = { up: false, down: false, left: false, right: false };
  if (choices.length === 0) return;

  const humans = [...room.players.values()].filter(p => !p.bot && p.alive).map(playerTile);
  const immediateDanger = dangerAt(room, t.x, t.y);
  let target;
  if (immediateDanger) {
    target = choices.sort((a, b) => dangerAt(room, a.x, a.y) - dangerAt(room, b.x, b.y))[0];
  } else if (humans.length && Math.random() < 0.55) {
    const human = humans.sort((a, b) => distance(t, a) - distance(t, b))[0];
    target = choices.sort((a, b) => distance(a, human) - distance(b, human))[0];
  } else {
    target = choices[Math.floor(Math.random() * choices.length)];
  }
  if (target) bot.input[target.key] = true;

  const nearEnemy = [...room.players.values()].some(p => p.id !== bot.id && p.alive && distance(t, playerTile(p)) <= 2);
  if (!immediateDanger && (hasAdjacentCrate(room, t.x, t.y) || nearEnemy) && Math.random() < 0.45) placeBomb(room, bot);
}

function tickRoom(room) {
  const now = Date.now();
  if (humanCount(room) === 0 && now - room.lastActive > 60_000) return rooms.delete(room.code);
  if (room.status === 'roundOver') {
    if (now > room.nextRoundAt) resetRound(room);
    return;
  }

  for (const player of room.players.values()) {
    if (player.bot && player.alive && room.status === 'playing') updateBot(room, player);
    if (!player.alive || room.status !== 'playing') continue;
    const i = player.input;
    let dx = (i.right ? 1 : 0) - (i.left ? 1 : 0);
    let dy = (i.down ? 1 : 0) - (i.up ? 1 : 0);
    if (dx && dy) { dx *= 0.707; dy *= 0.707; }
    const nx = player.px + dx * player.speed;
    const ny = player.py + dy * player.speed;
    if (canMoveTo(room, nx, player.py, player.id)) player.px = nx;
    if (canMoveTo(room, player.px, ny, player.id)) player.py = ny;
  }

  for (const bomb of [...room.bombs]) if (now >= bomb.explodeAt) explode(room, bomb);
  room.blasts = room.blasts.filter(b => now < b.until);

  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const t = playerTile(player);
    if (room.blasts.some(b => b.x === t.x && b.y === t.y)) {
      player.hp -= 1;
      player.alive = player.hp > 0;
      if (player.alive) {
        const s = spawns[player.slot];
        player.px = centerOf(s.x);
        player.py = centerOf(s.y);
      }
    }
  }

  const alive = [...room.players.values()].filter(p => p.alive);
  if (room.status === 'playing' && room.players.size >= 2 && alive.length <= 1) {
    room.status = 'roundOver';
    room.winner = alive[0]?.name || '무승부';
    room.nextRoundAt = now + ROUND_END_DELAY;
  }
}

function resetRound(room) {
  room.board = makeBoard();
  room.bombs = [];
  room.blasts = [];
  room.winner = null;
  for (const player of room.players.values()) {
    const s = spawns[player.slot];
    player.px = centerOf(s.x);
    player.py = centerOf(s.y);
    player.hp = 3;
    player.alive = true;
    player.input = { up: false, down: false, left: false, right: false };
    if (player.bot) player.ai = { nextThink: 0, target: s, panicUntil: 0 };
  }
  room.status = room.players.size >= 2 ? 'playing' : 'waiting';
}

io.on('connection', socket => {
  socket.on('createRoom', ({ name } = {}, cb) => {
    const room = createRoom();
    socket.join(room.code);
    const player = addPlayer(room, socket, name);
    cb?.({ ok: true, room: publicRoom(room), playerId: player.id });
  });

  socket.on('soloRoom', ({ name, bots = 2 } = {}, cb) => {
    const room = createRoom();
    socket.join(room.code);
    const player = addPlayer(room, socket, name);
    addSoloBots(room, Number.isFinite(bots) ? bots : 2);
    cb?.({ ok: true, room: publicRoom(room), playerId: player.id });
  });

  socket.on('joinRoom', ({ code, name } = {}, cb) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) return cb?.({ ok: false, error: '방을 찾을 수 없어요.' });
    if (room.players.size >= MAX_PLAYERS) return cb?.({ ok: false, error: '방이 가득 찼어요.' });
    socket.join(room.code);
    const player = addPlayer(room, socket, name);
    cb?.({ ok: true, room: publicRoom(room), playerId: player.id });
  });

  socket.on('input', input => {
    const room = findRoom(socket.id);
    const player = room?.players.get(socket.id);
    if (player && !player.bot) player.input = { ...player.input, ...input };
  });

  socket.on('bomb', () => {
    const room = findRoom(socket.id);
    if (room) placeBomb(room, room.players.get(socket.id));
  });

  socket.on('disconnect', () => {
    const room = findRoom(socket.id);
    if (!room) return;
    room.players.delete(socket.id);
    room.lastActive = Date.now();
    if (humanCount(room) === 0) room.status = 'waiting';
    else if (room.players.size < 2 && room.status === 'playing') room.status = 'waiting';
  });
});

function findRoom(playerId) {
  for (const room of rooms.values()) if (room.players.has(playerId)) return room;
  return null;
}

setInterval(() => {
  for (const room of rooms.values()) {
    tickRoom(room);
    io.to(room.code).emit('state', publicRoom(room));
  }
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Crazy Bomber Arena running on port ${PORT}`);
});
