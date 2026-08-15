"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const SURVEYS = require("./survey_data");
const DRAW_WORDS = require("./draw_words");
const ROYAL_COLORS=["gold","blue","green","red"],ROYAL_OFFSETS={gold:0,blue:13,green:26,red:39},ROYAL_SAFE=new Set([0,8,13,21,26,34,39,47]);

const PORT = Number(process.env.PORT || 3000);
const ROYAL_TURN_MS = Number(process.env.ROYAL_TURN_MS || 30000);
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
const cleanPhrase = value => String(value || "").toLowerCase().replace(/[^a-z0-9 ]/g,"").replace(/\s+/g," ").trim();
function similar(a,b){
  if(a===b||a.length>=4&&(a.includes(b)||b.includes(a)))return true;
  const d=Array.from({length:a.length+1},(_,i)=>[i]);for(let j=1;j<=b.length;j++)d[0][j]=j;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return 1-d[a.length][b.length]/Math.max(a.length,b.length)>=.78;
}
const publicRoom = (room,viewerId) => ({
  code: room.code, phase: room.phase, hostId: room.hostId, game:room.game, mode:room.mode, drawRounds:room.drawRounds, currentWord: room.currentWord,
  currentPlayerId: room.players[room.turn]?.id || null, deadline: room.deadline,
  round: room.round, winnerId: room.winnerId, winnerTeam:room.winnerTeam, message: room.message,
  survey: ["survey","survey-break"].includes(room.phase) ? {question:room.surveyQuestions[room.surveyIndex].question,index:room.surveyIndex+1,total:room.surveyQuestions.length,answers:room.surveyQuestions[room.surveyIndex].answers.map((a,i)=>room.found.has(i)||room.phase==="survey-break"?{text:a.text,points:a.points}:{text:"",points:0}),found:room.found.size} : null,
  draw: ["draw","draw-break"].includes(room.phase) ? {turn:room.drawTurn,total:room.drawTotal,drawerId:room.drawerId,isDrawer:viewerId===room.drawerId,word:viewerId===room.drawerId||room.phase==="draw-break"?room.drawWord:"_ ".repeat(room.drawWord.length).trim(),wordLength:room.drawWord.length,strokes:room.strokes,guessed:[...room.guessed],lastGuesses:room.lastGuesses.slice(-8)} : null,
  royal: room.phase === "royal" ? {turnPlayerId:room.royalOrder[room.royalTurn]||null,dice:room.royalDice,legal:room.royalOrder[room.royalTurn]===viewerId?room.royalLegal:[],tokens:room.royalTokens,placements:room.royalPlacements,lastMove:room.royalLastMove} : null,
  players: room.players.map(({token, ...p}) => p)
});
function broadcast(room) {
  for (const client of clients.get(room.code) || []) client.res.write(`data: ${JSON.stringify(publicRoom(room,client.playerId))}\n\n`);
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
function finishSurveyQuestion(room){
  room.deadline=0;
  if(room.surveyIndex>=room.surveyQuestions.length-1){
    room.phase="finished";
    if(room.mode==="teams"){
      const gold=Math.max(0,...room.players.filter(p=>p.team==="gold").map(p=>p.score));
      const blue=Math.max(0,...room.players.filter(p=>p.team==="blue").map(p=>p.score));
      room.winnerTeam=gold===blue?"tie":gold>blue?"gold":"blue";room.message=room.winnerTeam==="tie"?"The teams finished level!":`${room.winnerTeam==="gold"?"Gold":"Blue"} Team wins Survey Showdown!`;
    }else{
      const sorted=[...room.players].sort((a,b)=>b.score-a.score);room.winnerId=sorted[0]?.id||null;room.message="Survey Showdown champion crowned!";
    }
  }else{room.phase="survey-break";room.message=`Question ${room.surveyIndex+1} complete. Host, reveal the next survey!`;}
  broadcast(room);
}
function startNextSurvey(room){room.surveyIndex++;room.found=new Set();room.round=room.surveyIndex+1;room.phase="survey";room.deadline=Date.now()+30000;room.message="New survey—go!";broadcast(room);}
function chooseSurveys(count){const shuffled=[...SURVEYS].sort(()=>Math.random()-.5),chosen=[],groups=new Set();for(const q of shuffled){if(groups.has(q.group))continue;groups.add(q.group);chosen.push(q);if(chosen.length===count)break;}return chosen;}
function makeDrawOrder(players,total){const order=[];while(order.length<total){const cycle=players.map(p=>p.id).sort(()=>Math.random()-.5);for(const id of cycle){if(order.length<total)order.push(id);}}return order;}
function startDrawTurn(room){room.phase="draw";room.drawerId=room.drawOrder[room.drawTurn-1];room.drawWord=DRAW_WORDS[crypto.randomInt(DRAW_WORDS.length)];room.strokes=[];room.guessed=new Set();room.lastGuesses=[];room.deadline=Date.now()+60000;room.message=`${room.players.find(p=>p.id===room.drawerId)?.name} is drawing!`;broadcast(room);}
function finishDrawTurn(room){if(room.phase!=="draw")return;room.deadline=0;room.phase="draw-break";room.message=`Time! The word was ${room.drawWord.toUpperCase()}.`;broadcast(room);}
function nextDrawTurn(room){if(room.drawTurn>=room.drawTotal){room.phase="finished";room.deadline=0;room.winnerId=[...room.players].sort((a,b)=>b.score-a.score)[0]?.id||null;room.message="Draw & Guess champion crowned!";broadcast(room);return;}room.drawTurn++;startDrawTurn(room);}
function royalTrack(color,progress){return progress>=0&&progress<52?(ROYAL_OFFSETS[color]+progress)%52:null;}
function royalLegal(room,playerId,dice){const tokens=room.royalTokens[playerId]||[];return tokens.map((p,i)=>({p,i})).filter(x=>x.p<58&&((x.p===-1&&dice===6)||(x.p>=0&&x.p+dice<=58))).map(x=>x.i);}
function royalMaybeFinish(room){const active=room.royalOrder.filter(id=>{const p=room.players.find(x=>x.id===id);return p&&!p.royalKicked&&!room.royalPlacements.includes(id)});if(active.length>1)return false;if(active.length===1)room.royalPlacements.push(active[0]);room.phase="finished";room.deadline=0;room.winnerId=room.royalPlacements[0]||null;room.message="The Royal Race is complete!";broadcast(room);return true;}
function royalNext(room){if(royalMaybeFinish(room))return;let tries=0;do{room.royalTurn=(room.royalTurn+1)%room.royalOrder.length;tries++;const p=room.players.find(x=>x.id===room.royalOrder[room.royalTurn]);if(p&&!p.royalKicked&&!room.royalPlacements.includes(p.id))break;}while(tries<=room.royalOrder.length);room.royalDice=null;room.royalLegal=[];room.deadline=Date.now()+ROYAL_TURN_MS;room.message=`${room.players.find(p=>p.id===room.royalOrder[room.royalTurn])?.name}'s turn.`;broadcast(room);}
function royalTimeout(room){const id=room.royalOrder[room.royalTurn],player=room.players.find(p=>p.id===id);if(!player)return royalNext(room);player.royalTimeouts=(player.royalTimeouts||0)+1;room.royalDice=null;room.royalLegal=[];if(player.royalTimeouts>=3){player.royalKicked=true;room.royalTokens[player.id]=[];room.message=`${player.name} missed three timers and was removed from the race.`;}else room.message=`${player.name} ran out of time — timer strike ${player.royalTimeouts}/3.`;broadcast(room);if(!royalMaybeFinish(room))royalNext(room);}
function royalMove(room,playerId,tokenIndex){if(!room.royalLegal.includes(tokenIndex))return false;const player=room.players.find(p=>p.id===playerId),tokens=room.royalTokens[playerId],old=tokens[tokenIndex];tokens[tokenIndex]=old===-1?0:old+room.royalDice;const reachedHome=old<58&&tokens[tokenIndex]===58;let captured=false;const capturedTokens=[],landed=royalTrack(player.royalColor,tokens[tokenIndex]);if(landed!==null&&!ROYAL_SAFE.has(landed)){for(const opponent of room.players){if(opponent.id===playerId||opponent.royalKicked)continue;room.royalTokens[opponent.id].forEach((p,i)=>{if(royalTrack(opponent.royalColor,p)===landed){capturedTokens.push({playerId:opponent.id,tokenIndex:i,fromProgress:p,toProgress:-1});room.royalTokens[opponent.id][i]=-1;captured=true;}})}}room.royalLastMove={moveId:++room.royalMoveSeq,playerId,tokenIndex,dice:room.royalDice,fromProgress:old,toProgress:tokens[tokenIndex],captured,capturedTokens,reachedHome};room.message=reachedHome?`${player.name} brought a token home!`:captured?`${player.name} captured a token!`:`${player.name} moved token ${tokenIndex+1}.`;if(tokens.every(p=>p===58)&&!room.royalPlacements.includes(playerId))room.royalPlacements.push(playerId);if(royalMaybeFinish(room))return true;const bonus=(room.royalDice===6||captured||reachedHome)&&!room.royalPlacements.includes(playerId);room.royalDice=null;room.royalLegal=[];if(bonus){room.deadline=Date.now()+ROYAL_TURN_MS;room.message+=` ${player.name} gets a bonus roll.`;broadcast(room);}else royalNext(room);return true;}
const timerSweep = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.phase === "playing" && room.deadline && now >= room.deadline) {
      strike(room, room.players[room.turn], "time ran out");
    } else if (room.phase === "survey" && room.deadline && now >= room.deadline) {
      finishSurveyQuestion(room);
    } else if (room.phase === "draw" && room.deadline && now >= room.deadline) {
      finishDrawTurn(room);
    } else if (room.phase === "royal" && room.deadline && now >= room.deadline) {
      royalTimeout(room);
    }
  }
}, 250);
timerSweep.unref();

async function api(req, res, route) {
  const body = req.method === "POST" ? await readBody(req) : {};
  if (route === "/api/create" && req.method === "POST") {
    const name = cleanName(body.name); if (!name) return json(res, 400, {error:"Enter your name."});
    const roomCode = code(), playerId = id(), token = id();
    const player = {id:playerId, token, name, strikes:0, eliminated:false, connected:true, host:true,team:"gold",score:0,royalColor:"gold",royalTimeouts:0,royalKicked:false};
    const room = {code:roomCode, hostId:playerId, phase:"lobby", game:"wordlink",mode:"ffa",players:[player], turn:0, currentWord:"", used:new Set(), deadline:0, timerSeconds:15, round:0, winnerId:null,winnerTeam:null,surveyQuestions:[],surveyIndex:0,found:new Set(),drawRounds:5,drawTurn:0,drawTotal:0,drawOrder:[],drawerId:null,drawWord:"",strokes:[],guessed:new Set(),lastGuesses:[],royalOrder:[],royalTurn:0,royalDice:null,royalLegal:[],royalTokens:{},royalPlacements:[],royalLastMove:null,royalMoveSeq:0, message:"Room created. Share the code!", createdAt:Date.now()};
    rooms.set(roomCode, room); return json(res, 200, {code:roomCode, playerId, token});
  }
  if (route === "/api/join" && req.method === "POST") {
    const room = rooms.get(String(body.code || "").toUpperCase());
    if (!room) return json(res, 404, {error:"Room not found. Check the code."});
    if (room.phase !== "lobby") return json(res, 409, {error:"That game has already started."});
    if (room.players.length >= 8) return json(res, 409, {error:"This room is full."});
    const name = cleanName(body.name); if (!name) return json(res, 400, {error:"Enter your name."});
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return json(res, 409, {error:"That nickname is already in use."});
    const goldCount=room.players.filter(p=>p.team==="gold").length,blueCount=room.players.filter(p=>p.team==="blue").length;
    const usedColors=room.players.map(p=>p.royalColor),availableColor=ROYAL_COLORS.find(c=>!usedColors.includes(c))||ROYAL_COLORS[room.players.length%4];
    const player = {id:id(), token:id(), name, strikes:0, eliminated:false, connected:true, host:false,team:goldCount<=blueCount?"gold":"blue",score:0,royalColor:availableColor,royalTimeouts:0,royalKicked:false}; room.players.push(player);
    room.message = `${name} joined the room.`; broadcast(room); return json(res, 200, {code:room.code, playerId:player.id, token:player.token});
  }
  const room = rooms.get(String(body.code || "").toUpperCase());
  const player = room?.players.find(p => p.id === body.playerId && p.token === body.token);
  if (!room || !player) return json(res, 403, {error:"Your room session is no longer valid."});
  if (route === "/api/configure") {
    if (player.id !== room.hostId || room.phase !== "lobby") return json(res,403,{error:"Only the host can configure the lobby."});
    if (["wordlink","survey","draw","royal"].includes(body.game)) room.game=body.game;
    if (["ffa","teams"].includes(body.mode)) room.mode=body.mode;
    if([5,10].includes(Number(body.rounds)))room.drawRounds=Number(body.rounds);
    room.message=room.game==="survey"?"Survey Showdown selected!":room.game==="draw"?"Draw & Guess selected!":room.game==="royal"?"TM's Royal Race selected!":"Word Link selected!";broadcast(room);return json(res,200,{ok:true});
  }
  if (route === "/api/team") {
    if (room.phase!=="lobby" || !["gold","blue"].includes(body.team)) return json(res,400,{error:"Team cannot be changed now."});
    player.team=body.team;room.message=`${player.name} joined ${body.team === "gold" ? "Gold" : "Blue"} Team.`;broadcast(room);return json(res,200,{ok:true});
  }
  if(route==="/api/royal-color"){
    if(room.phase!=="lobby"||room.game!=="royal"||!ROYAL_COLORS.includes(body.color))return json(res,400,{error:"Colour cannot be changed now."});if(room.players.some(p=>p.id!==player.id&&p.royalColor===body.color))return json(res,409,{error:"That colour is already taken."});player.royalColor=body.color;room.message=`${player.name} chose ${body.color.toUpperCase()}.`;broadcast(room);return json(res,200,{ok:true});
  }
  if (route === "/api/start") {
    if (player.id !== room.hostId) return json(res, 403, {error:"Only the host can start."});
    if (room.players.length < 2) return json(res, 409, {error:"At least two players are required."});
    if(room.game==="royal"){
      if(room.players.length>4)return json(res,409,{error:"Royal Race supports a maximum of four players."});if(new Set(room.players.map(p=>p.royalColor)).size!==room.players.length)return json(res,409,{error:"Every player must choose a different colour."});room.players.forEach(p=>{p.score=0;p.royalTimeouts=0;p.royalKicked=false});room.royalOrder=room.players.map(p=>p.id).sort(()=>Math.random()-.5);room.royalTurn=0;room.royalDice=null;room.royalLegal=[];room.royalTokens={};room.players.forEach(p=>room.royalTokens[p.id]=[-1,-1,-1,-1]);room.royalPlacements=[];room.royalLastMove=null;room.royalMoveSeq=0;room.phase="royal";room.deadline=Date.now()+ROYAL_TURN_MS;room.winnerId=null;room.message=`${room.players.find(p=>p.id===room.royalOrder[0])?.name} begins the Royal Race!`;broadcast(room);return json(res,200,{ok:true});
    }
    if(room.game==="draw"){
      room.players.forEach(p=>p.score=0);room.drawTotal=Math.max(room.drawRounds,room.players.length);room.drawOrder=makeDrawOrder(room.players,room.drawTotal);room.drawTurn=1;room.winnerId=null;startDrawTurn(room);return json(res,200,{ok:true});
    }
    if(room.game==="survey"){
      if(room.mode==="teams"){
        const gold=room.players.filter(p=>p.team==="gold").length,blue=room.players.filter(p=>p.team==="blue").length;
        if(gold<2||blue<2)return json(res,409,{error:"Team mode needs at least two players on Gold Team and two on Blue Team."});
      }
      room.players.forEach(p=>p.score=0);room.surveyQuestions=chooseSurveys(5);room.surveyIndex=0;room.found=new Set();room.phase="survey";room.round=1;room.deadline=Date.now()+30000;room.winnerId=null;room.winnerTeam=null;room.message="Survey is live—submit your best answers!";broadcast(room);return json(res,200,{ok:true});
    }
    room.players.forEach(p => {p.strikes=0; p.eliminated=false;p.score=0;}); room.phase="playing"; room.turn=crypto.randomInt(room.players.length);
    room.currentWord=STARTERS[crypto.randomInt(STARTERS.length)]; room.used=new Set([room.currentWord]); room.round=1; room.winnerId=null; room.deadline=Date.now()+room.timerSeconds*1000; room.message="Game on! Link a word."; broadcast(room); return json(res, 200, {ok:true});
  }
  if(route==="/api/royal-roll"){
    if(room.phase!=="royal"||room.royalOrder[room.royalTurn]!==player.id||room.royalDice!==null)return json(res,409,{error:"You cannot roll now."});room.royalDice=crypto.randomInt(1,7);const rolled=room.royalDice;room.royalLegal=royalLegal(room,player.id,room.royalDice);room.message=`${player.name} rolled ${room.royalDice}.`;broadcast(room);if(room.royalLegal.length===0)setTimeout(()=>{if(room.phase==="royal"&&room.royalOrder[room.royalTurn]===player.id&&room.royalDice===rolled)royalNext(room)},1000);else if(room.royalLegal.length===1){const only=room.royalLegal[0];setTimeout(()=>{if(room.phase==="royal"&&room.royalOrder[room.royalTurn]===player.id&&room.royalDice===rolled)royalMove(room,player.id,only)},850);}return json(res,200,{ok:true,dice:rolled});
  }
  if(route==="/api/royal-move"){
    if(room.phase!=="royal"||room.royalOrder[room.royalTurn]!==player.id||room.royalDice===null)return json(res,409,{error:"You cannot move now."});if(!royalMove(room,player.id,Number(body.tokenIndex)))return json(res,400,{error:"That token cannot move."});return json(res,200,{ok:true});
  }
  if(route==="/api/draw-stroke"){
    if(room.phase!=="draw"||player.id!==room.drawerId)return json(res,403,{error:"Only the current drawer can draw."});
    const color=/^#[0-9a-f]{6}$/i.test(body.color)?body.color:"#14213d",size=Math.max(2,Math.min(30,Number(body.size)||6));
    const points=Array.isArray(body.points)?body.points.slice(0,30).map(p=>[Math.max(0,Math.min(1,Number(p[0]))),Math.max(0,Math.min(1,Number(p[1])))]):[];
    if(points.length){room.strokes.push({color,size,points});if(room.strokes.length>2500)room.strokes.shift();broadcast(room);}return json(res,200,{ok:true});
  }
  if(route==="/api/clear-drawing"){
    if(room.phase!=="draw"||player.id!==room.drawerId)return json(res,403,{error:"Only the current drawer can clear."});room.strokes=[];broadcast(room);return json(res,200,{ok:true});
  }
  if(route==="/api/draw-guess"){
    if(room.phase!=="draw"||player.id===room.drawerId||room.guessed.has(player.id))return json(res,409,{error:"You cannot guess right now."});
    const guess=cleanPhrase(body.guess);if(!guess)return json(res,400,{error:"Enter a guess."});
    if(similar(guess,cleanPhrase(room.drawWord))){const remaining=Math.max(0,room.deadline-Date.now()),base=100,speed=Math.round(400*remaining/60000),first=room.guessed.size===0?100:0,gained=base+speed+first;player.score+=gained;room.guessed.add(player.id);const drawer=room.players.find(p=>p.id===room.drawerId);if(drawer)drawer.score+=50;room.lastGuesses.push({name:player.name,text:"GUESSED IT!",correct:true});room.message=`${player.name} guessed correctly for ${gained} points!`;if(room.guessed.size>=room.players.length-1)finishDrawTurn(room);else broadcast(room);return json(res,200,{ok:true,points:gained});}
    room.lastGuesses.push({name:player.name,text:String(body.guess).slice(0,28),correct:false});room.message=`${player.name} submitted a guess.`;broadcast(room);return json(res,200,{ok:false});
  }
  if(route==="/api/next-draw"){
    if(player.id!==room.hostId||room.phase!=="draw-break")return json(res,403,{error:"Only the host can continue."});nextDrawTurn(room);return json(res,200,{ok:true});
  }
  if(route==="/api/survey-answer"){
    if(room.phase!=="survey")return json(res,409,{error:"The survey round is not active."});
    const guess=cleanPhrase(body.answer);if(guess.length<2)return json(res,400,{error:"Enter a complete answer."});
    const question=room.surveyQuestions[room.surveyIndex];let match=-1;
    for(let i=0;i<question.answers.length;i++)if(!room.found.has(i)&&[question.answers[i].text,...question.answers[i].aliases].some(x=>similar(guess,cleanPhrase(x)))){match=i;break;}
    if(match<0){room.message=`${player.name} tried “${String(body.answer).slice(0,24)}”—not on the board.`;broadcast(room);return json(res,200,{ok:false});}
    const answer=question.answers[match];room.found.add(match);
    if(room.mode==="teams")room.players.filter(p=>p.team===player.team).forEach(p=>p.score+=answer.points);
    else player.score+=answer.points;
    room.message=`${player.name} revealed ${answer.text} for ${answer.points} points!`;
    if(room.found.size===question.answers.length)finishSurveyQuestion(room);else broadcast(room);return json(res,200,{ok:true});
  }
  if(route==="/api/next-survey"){
    if(player.id!==room.hostId||room.phase!=="survey-break")return json(res,403,{error:"Only the host can continue."});
    startNextSurvey(room);return json(res,200,{ok:true});
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
    room.phase="lobby"; room.deadline=0; room.currentWord=""; room.winnerId=null;room.winnerTeam=null;room.drawerId=null;room.strokes=[]; room.players.forEach(p => {p.strikes=0;p.eliminated=false;p.score=0;p.royalTimeouts=0;p.royalKicked=false;}); room.message="Ready for a rematch."; broadcast(room); return json(res, 200, {ok:true});
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
      const viewer=room?.players.find(p=>p.id===url.searchParams.get("playerId")&&p.token===url.searchParams.get("token"));
      if (!room||!viewer) return json(res, 403, {error:"Room session not found"});
      res.writeHead(200, {"content-type":"text/event-stream", "cache-control":"no-cache", "connection":"keep-alive", "access-control-allow-origin":"*"});
      if (!clients.has(room.code)) clients.set(room.code, new Set()); const client={res,playerId:viewer.id};clients.get(room.code).add(client);
      res.write(`data: ${JSON.stringify(publicRoom(room,viewer.id))}\n\n`);
      req.on("close", () => clients.get(room.code)?.delete(client)); return;
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

module.exports = {cleanName, cleanWord, cleanPhrase, similar, server, __test:{royalMove,royalTimeout}};
