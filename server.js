"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, "public");
const rooms = new Map();
const clients = new Map();
const STARTERS = ["LIGHT", "MUSIC", "DREAM", "OCEAN", "TIGER", "MAGIC", "CROWN", "NIGHT", "APPLE", "RIVER"];

const json = (res, status, body) => {
  const data = JSON.stringify(body);
  res.writeHead(status, {"content-type":"application/json; charset=utf-8", "content-length":Buffer.byteLength(data), "cache-control":"no-store"});
  res.end(data);
};
const readBody = req => new Promise((resolve, reject) => {
  let data = "";
  req.on("data", c => { data += c; if (data.length > 20000) reject(new Error("Request too large")); });
  req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("Invalid JSON")); } });
});
const code = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value;
  do { value = Array.from({length:6}, () => chars[crypto.randomInt(chars.length)]).join(""); } while (rooms.has(value));
  return value;
};
const id = () => crypto.randomBytes(12).toString("hex");
const cleanName = value => String(value || "").replace(/[<>]/g, "").trim().slice(0, 20);
const cleanWord = value => String(value || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 24);
const publicRoom = room => ({
  code: room.code, phase: room.phase, hostId: room.hostId, currentWord: room.currentWord,
  currentPlayerId: room.players[room.turn]?.id || null, deadline: room.deadline,
  round: room.round, winnerId: room.winnerId, message: room.message,
  players: room.players.map(({token, ...p}) => p)
});
function broadcast(room) {
  const payload = `data: ${JSON.stringify(publicRoom(room))}\n\n`;
  for (const res of clients.get(room.code) || []) res.write(payload);
}
function active(room) { return room.players.filter(p => !p.eliminated); }
function nextTurn(room) {
  if (active(room).length <= 1) {
    room.phase = "finished"; room.winnerId = active(room)[0]?.id || null; room.deadline = 0;
    room.message = room.winnerId ? "We have a Word Link champion!" : "No winner this round.";
    broadcast(room); return;
  }
  let tries = 0;
  do { room.turn = (room.turn + 1) % room.players.length; tries++; }
  while (room.players[room.turn].eliminated && tries <= room.players.length);
  room.deadline = Date.now() + room.timerSeconds * 1000;
  broadcast(room);
}
function strike(room, player, reason) {
  player.strikes++;
  if (player.strikes >= 3) player.eliminated = true;
  room.message = `${player.name}: ${reason}${player.eliminated ? " — eliminated!" : ` — strike ${player.strikes}/3`}`;
  nextTurn(room);
}
const timerSweep = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.phase === "playing" && room.deadline && now >= room.deadline) {
      strike(room, room.players[room.turn], "time ran out");
    }
  }
}, 250);
timerSweep.unref();

async function api(req, res, route) {
  const body = req.method === "POST" ? await readBody(req) : {};
  if (route === "/api/create" && req.method === "POST") {
    const name = cleanName(body.name); if (!name) return json(res, 400, {error:"Enter your name."});
    const roomCode = code(), playerId = id(), token = id();
    const player = {id:playerId, token, name, strikes:0, eliminated:false, connected:true, host:true};
    const room = {code:roomCode, hostId:playerId, phase:"lobby", players:[player], turn:0, currentWord:"", used:new Set(), deadline:0, timerSeconds:15, round:0, winnerId:null, message:"Room created. Share the code!", createdAt:Date.now()};
    rooms.set(roomCode, room); return json(res, 200, {code:roomCode, playerId, token});
  }
  if (route === "/api/join" && req.method === "POST") {
    const room = rooms.get(String(body.code || "").toUpperCase());
    if (!room) return json(res, 404, {error:"Room not found. Check the code."});
    if (room.phase !== "lobby") return json(res, 409, {error:"That game has already started."});
    if (room.players.length >= 8) return json(res, 409, {error:"This room is full."});
    const name = cleanName(body.name); if (!name) return json(res, 400, {error:"Enter your name."});
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return json(res, 409, {error:"That nickname is already in use."});
    const player = {id:id(), token:id(), name, strikes:0, eliminated:false, connected:true, host:false}; room.players.push(player);
    room.message = `${name} joined the room.`; broadcast(room); return json(res, 200, {code:room.code, playerId:player.id, token:player.token});
  }
  const room = rooms.get(String(body.code || "").toUpperCase());
  const player = room?.players.find(p => p.id === body.playerId && p.token === body.token);
  if (!room || !player) return json(res, 403, {error:"Your room session is no longer valid."});
  if (route === "/api/start") {
    if (player.id !== room.hostId) return json(res, 403, {error:"Only the host can start."});
    if (room.players.length < 2) return json(res, 409, {error:"At least two players are required."});
    room.players.forEach(p => {p.strikes=0; p.eliminated=false;}); room.phase="playing"; room.turn=crypto.randomInt(room.players.length);
    room.currentWord=STARTERS[crypto.randomInt(STARTERS.length)]; room.used=new Set([room.currentWord]); room.round=1; room.winnerId=null; room.deadline=Date.now()+room.timerSeconds*1000; room.message="Game on! Link a word."; broadcast(room); return json(res, 200, {ok:true});
  }
  if (route === "/api/submit") {
    if (room.phase !== "playing") return json(res, 409, {error:"The game is not active."});
    if (room.players[room.turn].id !== player.id) return json(res, 409, {error:"Wait for your turn."});
    const word = cleanWord(body.word);
    if (word.length < 2) { strike(room, player, "enter a word with at least two letters"); return json(res, 200, {ok:false}); }
    if (room.used.has(word)) { strike(room, player, `${word} was already used`); return json(res, 200, {ok:false}); }
    if (word[0] !== room.currentWord.at(-1)) { strike(room, player, `${word} must begin with ${room.currentWord.at(-1)}`); return json(res, 200, {ok:false}); }
    room.currentWord=word; room.used.add(word); room.round++; room.message=`${player.name} linked ${word}!`; nextTurn(room); return json(res, 200, {ok:true});
  }
  if (route === "/api/restart") {
    if (player.id !== room.hostId) return json(res, 403, {error:"Only the host can restart."});
    room.phase="lobby"; room.deadline=0; room.currentWord=""; room.winnerId=null; room.players.forEach(p => {p.strikes=0;p.eliminated=false;}); room.message="Ready for a rematch."; broadcast(room); return json(res, 200, {ok:true});
  }
  if (route === "/api/remove") {
    if (player.id !== room.hostId) return json(res, 403, {error:"Only the host can remove players."});
    const target = room.players.find(p => p.id === body.targetId);
    if (!target || target.host) return json(res, 400, {error:"Player cannot be removed."});
    room.players = room.players.filter(p => p.id !== target.id); room.message=`${target.name} was removed.`; broadcast(room); return json(res, 200, {ok:true});
  }
  return json(res, 404, {error:"Unknown action."});
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/events") {
      const room = rooms.get(String(url.searchParams.get("code") || "").toUpperCase());
      if (!room) return json(res, 404, {error:"Room not found"});
      res.writeHead(200, {"content-type":"text/event-stream", "cache-control":"no-cache", "connection":"keep-alive", "access-control-allow-origin":"*"});
      if (!clients.has(room.code)) clients.set(room.code, new Set()); clients.get(room.code).add(res);
      res.write(`data: ${JSON.stringify(publicRoom(room))}\n\n`);
      req.on("close", () => clients.get(room.code)?.delete(res)); return;
    }
    if (url.pathname.startsWith("/api/")) return await api(req, res, url.pathname);
    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    file = path.normalize(file).replace(/^(\.\.[/\\])+/, "");
    const full = path.join(PUBLIC, file);
    if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return json(res, 404, {error:"Not found"});
    const types = {".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".svg":"image/svg+xml"};
    res.writeHead(200, {"content-type":types[path.extname(full)] || "application/octet-stream", "cache-control":"no-cache"}); fs.createReadStream(full).pipe(res);
  } catch (error) { json(res, 500, {error:error.message || "Server error"}); }
});
if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => console.log(`TM's GAME ROOM running on http://localhost:${PORT}`));
}

module.exports = {cleanName, cleanWord, server};
