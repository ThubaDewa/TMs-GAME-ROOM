"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const SURVEYS = require("./survey_data");
const DRAW_WORDS = require("./draw_words");
const DRAW_ALIASES={"aeroplane":["airplane","plane"],"alarm clock":["alarm"],"birthday cake":["cake"],"coffee cup":["coffee mug","mug"],"football":["soccer ball","soccer"],"ice cream":["icecream","ice-cream"],"laptop":["computer","notebook computer"],"palm tree":["palm"],"school bus":["bus"],"sunglasses":["shades"],"telephone":["phone","telephone receiver"],"toothbrush":["tooth brush"],"watermelon":["water melon"]};
const persistence = require("./persistence");
const ROYAL_COLORS=["gold","blue","green","red"],ROYAL_OFFSETS={gold:0,blue:13,green:26,red:39},ROYAL_SAFE=new Set([0,8,13,21,26,34,39,47]);
const DEAL_AMOUNTS=[1,5,10,20,50,100,200,300,500,750,1000,2000,3000,5000,7500,10000,15000,20000,25000,30000,40000,50000,75000,100000,150000,250000];

const PORT = Number(process.env.PORT || 3000);
const ROYAL_TURN_MS = Number(process.env.ROYAL_TURN_MS || 30000);
const ROYAL_HOME = 52;
const ROUND_REVEAL_MS = Number(process.env.ROUND_REVEAL_MS || 5000);
const SURVEY_ROUND_MS = Number(process.env.SURVEY_ROUND_MS || 60000);
const RECONNECT_GRACE_MS = Math.max(30000,Math.min(60000,Number(process.env.RECONNECT_GRACE_MS)||45000));
const PUBLIC = path.join(__dirname, "public");
const rooms = new Map();
const clients = new Map();
const RTC_ICE_SERVERS=[
	{urls:["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302"]},
	...(process.env.TURN_URL?[{urls:process.env.TURN_URL,username:process.env.TURN_USERNAME||"",credential:process.env.TURN_CREDENTIAL||""}]:[])
];
const STARTERS = ["LIGHT", "MUSIC", "DREAM", "OCEAN", "TIGER", "MAGIC", "CROWN", "NIGHT", "APPLE", "RIVER"];

const json = (res, status, body) => {
  const data = JSON.stringify(body);
  res.writeHead(status, {"content-type":"application/json; charset=utf-8", "content-length":Buffer.byteLength(data), "cache-control":"no-store"});
  res.end(data);
};
const readBody = req => new Promise((resolve, reject) => {
  let data = "";
  req.on("data", c => { data += c; if (data.length > 120000) reject(new Error("Request too large")); });
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
const validWordLength = value => cleanWord(value).length >= 4;
const cleanPhrase = value => String(value || "").toLowerCase().replace(/[^a-z0-9 ]/g,"").replace(/\s+/g," ").trim();
const cleanChat = value => String(value||"").replace(/<[^>]*>/g,"").replace(/[<>]/g,"").replace(/\s+/g," ").trim().slice(0,180);
function voiceRecipientAvailable(player,target){return Boolean(target?.connected&&target.id!==player.id)}
function addChatMessage(room,player,textValue,clientIdValue=""){const text=cleanChat(textValue),clientMessageId=String(clientIdValue||"").slice(0,80);if(!text)return null;const existing=clientMessageId&&room.chat.find(m=>m.playerId===player.id&&m.clientMessageId===clientMessageId);if(existing)return existing;const message={id:++room.chatSeq,clientMessageId,playerId:player.id,name:player.name,text,ts:Date.now()};room.chat.push(message);if(room.chat.length>100)room.chat.shift();return message}
function addGameEvent(room,textValue){const text=cleanChat(textValue);if(!text||text===room.lastEventMessage)return null;room.chat||=[];room.chatSeq=(room.chatSeq||0)+1;room.lastEventMessage=text;const message={id:room.chatSeq,playerId:null,name:"GAME",text,ts:Date.now(),type:"event"};room.chat.push(message);if(room.chat.length>100)room.chat.shift();return message}
function canSendChat(room,player,now=Date.now()){if(player.chatMuted)return "The host has muted your room chat.";if(room.chatSlowMode&&player.id!==room.hostId&&now-(player.lastChatAt||0)<5000)return "Slow mode is on. Wait five seconds between messages.";return ""}
const freshStats=()=>({wordlink:{games:0,wins:0,xp:0},survey:{games:0,wins:0,xp:0},draw:{games:0,wins:0,xp:0},royal:{games:0,wins:0,xp:0},deal:{games:0,wins:0,xp:0}});
function similar(a,b){
  if(a===b||a.length>=4&&(a.includes(b)||b.includes(a)))return true;
  const d=Array.from({length:a.length+1},(_,i)=>[i]);for(let j=1;j<=b.length;j++)d[0][j]=j;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return 1-d[a.length][b.length]/Math.max(a.length,b.length)>=.78;
}
function smoothStrokePoints(points){if(points.length<3)return points;const result=[points[0]];for(let i=1;i<points.length-1;i++){const a=points[i-1],b=points[i],c=points[i+1];result.push([a[0]*.18+b[0]*.64+c[0]*.18,a[1]*.18+b[1]*.64+c[1]*.18])}result.push(points.at(-1));return result}
function calculateDrawScore(remainingMs,isFirst=false){const speed=Math.max(0,Math.min(4,Math.ceil(4*remainingMs/60000)));return 5+speed+(isFirst?1:0)}
function drawGuessMatches(guessValue,wordValue){const guess=cleanPhrase(guessValue),word=cleanPhrase(wordValue),accepted=[word,...(DRAW_ALIASES[word]||[]).map(cleanPhrase)];return guess.length>=2&&accepted.some(answer=>similar(guess,answer))}
function undoDrawStroke(room){const last=room.strokes.at(-1)?.strokeId;if(!last)return false;room.strokes=room.strokes.filter(stroke=>stroke.strokeId!==last);return true}
function surveyStem(value){return cleanPhrase(value).split(" ").map(word=>{if(word.length>5&&word.endsWith("ing")){let stem=word.slice(0,-3);if(stem.at(-1)===stem.at(-2))stem=stem.slice(0,-1);return stem}return word.length>4&&word.endsWith("ed")?word.slice(0,-2):word}).join(" ")}
function findSurveyAnswer(question,guessValue,found=new Set()){const guess=cleanPhrase(guessValue),stemmedGuess=surveyStem(guess);if(guess.length<2)return -1;for(let index=0;index<question.answers.length;index++)if(!found.has(index)&&[question.answers[index].text,...question.answers[index].aliases].some(answer=>{const clean=cleanPhrase(answer);return similar(guess,clean)||similar(stemmedGuess,surveyStem(clean))}))return index;return -1}
function surveyDeadlineOpen(room,now=Date.now()){return room.phase==="survey"&&now<room.deadline}
function leaderboard(room,game="all"){return room.players.map(p=>{const stat=game==="all"?null:p.gameStats?.[game];return {id:p.id,name:p.name,xp:stat?.xp??p.totalXp??0,wins:stat?.wins??p.wins??0,games:stat?.games??p.gamesPlayed??0,level:Math.max(1,Math.floor((stat?.xp??p.totalXp??0)/1000)+1)}}).sort((a,b)=>b.xp-a.xp||b.wins-a.wins||a.name.localeCompare(b.name))}
function recordResults(room){if(room.resultsRecorded||room.phase!=="finished")return;let order=room.game==="royal"?[...room.royalPlacements]:[...room.players].sort((a,b)=>b.score-a.score).map(p=>p.id);if(room.winnerId)order=[room.winnerId,...order.filter(id=>id!==room.winnerId)];for(const p of room.players)if(!order.includes(p.id))order.push(p.id);const awards=[600,400,300,220,170,130,100,80],coinAwards=[100,60,40,30,25,20,15,10],results=[];order.forEach((id,rank)=>{const p=room.players.find(x=>x.id===id);if(!p)return;const teamWin=room.game==="survey"&&room.mode==="teams"&&room.winnerTeam===p.team,isWinner=id===room.winnerId||teamWin,performance=room.game==="wordlink"?Math.min(400,p.score):room.game==="deal"?Math.min(400,Math.round(Math.sqrt(Math.max(0,p.score))*1.2)):Math.min(400,Math.round(p.score*.35)),xp=(awards[rank]||60)+performance+(isWinner?100:0),coins=p.accountId?(coinAwards[rank]||10):0;p.totalXp=(p.totalXp||0)+xp;p.gamesPlayed=(p.gamesPlayed||0)+1;if(isWinner)p.wins=(p.wins||0)+1;if(p.accountId)p.coinBalance=(p.coinBalance||0)+coins;const stat=p.gameStats[room.game]||(p.gameStats[room.game]={games:0,wins:0,xp:0});stat.games++;stat.xp+=xp;if(isWinner)stat.wins++;results.push({playerId:id,rank:rank+1,xp,coins,isWinner,score:p.score})});room.lastResults=results;room.resultsRecorded=true;persistence.recordGameResults(room,results)}
function participants(room){return [...room.players,...(room.spectators||[])]}
function promoteSpectators(room){room.spectators||=[];const limit=room.game==="royal"?4:8,slots=Math.max(0,limit-room.players.length),promoted=room.spectators.splice(0,slots);for(const player of promoted){player.spectator=false;player.ready=false;player.away=false;player.score=0;room.players.push(player)}return promoted.length}
const publicRoom = (room,viewerId) => ({
  code: room.code,serverTime:Date.now(), phase: room.phase, hostId: room.hostId, game:room.game, mode:room.mode, matchId:room.matchId||null,drawRounds:room.drawRounds, currentWord: room.currentWord, timerSeconds:room.timerSeconds,returnDeadline:room.returnDeadline||0,rematchVotes:room.rematchVotes||[],
  currentPlayerId: room.players[room.turn]?.id || null, deadline: room.deadline,
  round: room.round, winnerId: room.winnerId, winnerTeam:room.winnerTeam, message: room.message,
  survey: ["survey","survey-break"].includes(room.phase) ? {question:room.surveyQuestions[room.surveyIndex].question,index:room.surveyIndex+1,total:room.surveyQuestions.length,answers:room.surveyQuestions[room.surveyIndex].answers.map((a,i)=>room.found.has(i)||room.phase==="survey-break"?{text:a.text,points:a.points,aliases:room.phase==="survey-break"?(a.aliases||[]):[]}:{text:"",points:0,aliases:[]}),found:room.found.size} : null,
  draw: ["draw","draw-break"].includes(room.phase) ? {turn:room.drawTurn,total:room.drawTotal,drawerId:room.drawerId,isDrawer:viewerId===room.drawerId,word:viewerId===room.drawerId||room.phase==="draw-break"?room.drawWord:"_ ".repeat(room.drawWord.length).trim(),wordLength:room.drawWord.length,strokes:room.strokes,guessed:[...room.guessed],lastGuesses:room.lastGuesses.slice(-8)} : null,
  royal: room.phase === "royal" ? {turnPlayerId:room.royalOrder[room.royalTurn]||null,dice:room.royalDice,legal:room.royalOrder[room.royalTurn]===viewerId?room.royalLegal:[],tokens:room.royalTokens,placements:room.royalPlacements,lastMove:room.royalLastMove} : null,
  deal:room.game==="deal"&&room.dealCases.length?{round:room.dealRound,turnPlayerId:room.dealOrder[room.dealTurn]||null,openRemaining:room.dealOpenRemaining,bankerStage:room.dealBankerStage,offer:room.dealBankerStage==="offer"?(room.dealOffers[viewerId]||null):null,choice:room.dealChoices[viewerId]||null,finalBank:room.dealFinalBank,casesRemaining:dealOfferMetrics(room).casesRemaining,estimatedValue:roundBankOffer(dealOfferMetrics(room).average),offerGenerosity:Math.round(dealOfferMetrics(room).generosity*100),cases:room.dealCases.map(c=>({number:c.number,opened:c.opened,value:c.opened||room.phase==="finished"?c.value:null,ownerId:c.ownerId})),players:room.players.map(p=>({playerId:p.id,caseNumber:room.dealPersonal[p.id]||null,status:p.dealStatus||"playing",payout:p.dealPayout||0,estimatedValue:roundBankOffer(dealOfferMetrics(room).average),casesRemaining:dealOfferMetrics(room).casesRemaining,finalValue:room.phase==="finished"?(room.dealCases.find(c=>c.ownerId===p.id)?.value||0):null}))}:null,
  chat:(room.chat||[]).slice(-60),chatSlowMode:Boolean(room.chatSlowMode),reactions:(room.reactions||[]).slice(-20),voiceSignals:(room.voiceSignals||[]).filter(s=>s.to===viewerId&&s.id>(participants(room).find(p=>p.id===viewerId)?.voiceSignalAck||0)).slice(-80),rtcIceServers:RTC_ICE_SERVERS,leaderboards:{all:leaderboard(room),wordlink:leaderboard(room,"wordlink"),survey:leaderboard(room,"survey"),draw:leaderboard(room,"draw"),royal:leaderboard(room,"royal"),deal:leaderboard(room,"deal")},lastResults:room.lastResults||[],
  players: participants(room).map(({token,accountId, ...p}) => ({...p,registered:Boolean(accountId)}))
});
function broadcast(room) {
  if(room.phase==="finished"&&!room.returnDeadline){room.returnDeadline=Date.now()+20000;room.rematchVotes=[]}
  if(room.phase!=="lobby"&&room.message)addGameEvent(room,room.message);
  persistence.scheduleRoomSave(room);
  for (const client of clients.get(room.code) || []) client.res.write(`data: ${JSON.stringify(publicRoom(room,client.playerId))}\n\n`);
}
function hasLiveConnection(roomCode,playerId){return [...(clients.get(roomCode)||[])].some(client=>client.playerId===playerId)}
function transferHost(room,targetId,{permanent=false}={}){const target=room.players.find(p=>p.id===targetId);if(!target)return false;room.hostId=target.id;if(permanent)room.ownerId=target.id;room.players.forEach(p=>p.host=p.id===target.id);return true}
function markPlayerConnected(room,playerId,now=Date.now()){
		const player=participants(room).find(p=>p.id===playerId);if(!player)return false;
		let changed=!player.connected||player.connectionStatus!=="connected";player.connected=true;player.connectedAt=now;player.disconnectedAt=0;player.reconnectDeadline=0;player.connectionStatus="connected";player.lastPresenceAt=now;room.ownerId||=room.hostId;if(!player.spectator&&player.id===room.ownerId&&room.hostId!==player.id){transferHost(room,player.id);room.message=`${player.name} reconnected and recovered host control.`;changed=true}return changed;
}
function markPlayerDisconnected(room,playerId,now=Date.now()){
		const player=participants(room).find(p=>p.id===playerId);if(!player||!player.connected||hasLiveConnection(room.code,playerId))return false;
		player.connected=false;player.disconnectedAt=now;player.reconnectDeadline=now+RECONNECT_GRACE_MS;player.connectionStatus="reconnecting";if(player.id===room.hostId){const backup=room.players.find(p=>p.id!==player.id&&p.connected);if(backup){transferHost(room,backup.id);room.message=`${player.name} disconnected. ${backup.name} is temporary host until they return.`}}return true;
}
function refreshConnectionStatuses(room,now=Date.now()){
	let changed=false;
		for(const player of participants(room)){let status=player.connectionStatus|| (player.connected?"connected":"reconnecting");if(!player.connected)status=now-(player.disconnectedAt||now)>=10000?"disconnected":"reconnecting";else if(player.lastPresenceAt&&now-player.lastPresenceAt>20000)status="unstable";if(status!==player.connectionStatus){player.connectionStatus=status;changed=true}}
	if(changed)broadcast(room);return changed;
}
function markPlayerActivity(player){if(!player)return;player.afkMisses=0;player.lastActivityAt=Date.now()}
function markAfkMiss(room,player,reason="inactive"){
	if(!player||player.away)return false;player.afkMisses=(player.afkMisses||0)+1;
	if(player.afkMisses<3)return false;removePlayer(room,player.id,`was removed after three ${reason} turns`);return true;
}
function expireDisconnectedPlayers(room,now=Date.now()){
	let removed=0;
		for(const player of [...participants(room)]){
		if(player.connected||!player.reconnectDeadline||now<player.reconnectDeadline)continue;
		if(removePlayer(room,player.id,"did not reconnect in time"))removed++;
			if(!participants(room).length)break;
	}
	return removed;
}
function active(room) { return room.players.filter(p => !p.eliminated); }
function wordTurnSeconds(room){const remaining=active(room).length;return remaining<=2?7:remaining===3?10:15}
function nextTurn(room) {
  if (active(room).length <= 1) {
    room.phase = "finished"; room.winnerId = active(room)[0]?.id || null; room.deadline = 0;
    room.message = room.winnerId ? "We have a Word Link champion!" : "No winner this round.";
    recordResults(room);broadcast(room); return;
  }
  let tries = 0;
  do { room.turn = (room.turn + 1) % room.players.length; tries++; }
  while ((room.players[room.turn].eliminated||room.players[room.turn].away) && tries <= room.players.length);
  room.timerSeconds=wordTurnSeconds(room);room.deadline = Date.now() + room.timerSeconds * 1000;
  if(room.phase==="finished")recordResults(room);broadcast(room);
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
  }else{room.phase="survey-break";room.deadline=Date.now()+ROUND_REVEAL_MS;room.message=`Question ${room.surveyIndex+1} complete. Next survey starts automatically…`;}
  if(room.phase==="finished")recordResults(room);broadcast(room);
}
function startNextSurvey(room){room.surveyIndex++;room.found=new Set();room.surveyActivity=new Set();room.players.forEach(p=>p.surveyBlank=false);room.round=room.surveyIndex+1;room.phase="survey";room.deadline=Date.now()+SURVEY_ROUND_MS;room.message="New 60-second survey—go!";broadcast(room);}
function chooseSurveys(count){const shuffled=[...SURVEYS].sort(()=>Math.random()-.5),chosen=[],groups=new Set();for(const q of shuffled){if(groups.has(q.group))continue;groups.add(q.group);chosen.push(q);if(chosen.length===count)break;}return chosen;}
function makeDrawOrder(players,total){const order=[];while(order.length<total){const cycle=players.map(p=>p.id).sort(()=>Math.random()-.5);for(const id of cycle){if(order.length<total)order.push(id);}}return order;}
function startDrawTurn(room){room.phase="draw";room.drawerId=room.drawOrder[room.drawTurn-1];room.drawWord=DRAW_WORDS[crypto.randomInt(DRAW_WORDS.length)];room.strokes=[];room.drawActivity=false;room.guessed=new Set();room.lastGuesses=[];room.deadline=Date.now()+60000;room.message=`${room.players.find(p=>p.id===room.drawerId)?.name} is drawing!`;broadcast(room);}
function finishDrawTurn(room){if(room.phase!=="draw")return;room.phase="draw-break";room.deadline=Date.now()+ROUND_REVEAL_MS;room.message=`Time! The word was ${room.drawWord.toUpperCase()}. Next artist starts automatically…`;broadcast(room);}
function nextDrawTurn(room){if(room.drawTurn>=room.drawTotal){room.phase="finished";room.deadline=0;room.winnerId=[...room.players].sort((a,b)=>b.score-a.score)[0]?.id||null;room.message="Draw & Guess champion crowned!";recordResults(room);broadcast(room);return;}room.drawTurn++;startDrawTurn(room);}
function removePlayer(room,targetId,reason="left the room"){
	room.dealOrder||=[];room.dealCases||=[];room.dealPersonal||={};room.dealOffers||={};room.dealChoices||={};
	room.spectators||=[];const spectatorIndex=room.spectators.findIndex(p=>p.id===targetId);if(spectatorIndex>=0){const [spectator]=room.spectators.splice(spectatorIndex,1);for(const client of clients.get(room.code)||[])if(client.playerId===targetId){client.res.end();clients.get(room.code)?.delete(client)}room.message=`${spectator.name} ${reason}.`;broadcast(room);return true}
	const targetIndex=room.players.findIndex(p=>p.id===targetId);if(targetIndex<0)return false;
	const target=room.players[targetIndex],wasHost=target.id===room.hostId,wasOwner=target.id===(room.ownerId||room.hostId),wasWordTurn=room.phase==="playing"&&room.players[room.turn]?.id===target.id;
	const wasDrawer=["draw","draw-break"].includes(room.phase)&&room.drawerId===target.id,oldDrawOrder=[...room.drawOrder],oldDrawTurn=room.drawTurn;
	const oldRoyalIndex=room.royalOrder.indexOf(target.id),wasRoyalTurn=room.phase==="royal"&&room.royalOrder[room.royalTurn]===target.id;
	const oldDealIndex=room.dealOrder.indexOf(target.id),wasDealTurn=["deal-pick","deal-open"].includes(room.phase)&&room.dealOrder[room.dealTurn]===target.id,personalCase=room.dealPersonal[target.id];
	room.players.splice(targetIndex,1);room.guessed?.delete(target.id);room.drawOrder=room.drawOrder.filter(id=>id!==target.id);room.royalOrder=room.royalOrder.filter(id=>id!==target.id);room.royalPlacements=room.royalPlacements.filter(id=>id!==target.id);delete room.royalTokens[target.id];room.dealOrder=room.dealOrder.filter(id=>id!==target.id);if(personalCase){const item=room.dealCases.find(c=>c.number===personalCase);if(item)item.ownerId=null}delete room.dealPersonal[target.id];delete room.dealOffers[target.id];delete room.dealChoices[target.id];
	for(const client of clients.get(room.code)||[]){if(client.playerId===target.id){client.res.end();clients.get(room.code)?.delete(client)}}
	if(!room.players.length){rooms.delete(room.code);clients.delete(room.code);persistence.deleteRoom(room.code).catch(error=>console.error("Room deletion failed:",error.message));return true}
	if(wasHost)transferHost(room,(room.players.find(p=>p.connected)||room.players[0]).id,{permanent:wasOwner});else if(wasOwner)room.ownerId=room.hostId;
	room.message=`${target.name} ${reason} and was removed from the game.${wasHost?` ${room.players[0].name} is now host.`:""}`;
	if(room.phase==="lobby"){broadcast(room);return true}
	if(room.phase==="countdown"){room.phase="lobby";room.deadline=0;room.players.forEach(p=>p.ready=false);room.message+=" The countdown was cancelled; everyone must ready up again.";broadcast(room);return true}
	if(room.players.length===1){room.phase="finished";room.deadline=0;room.winnerId=room.players[0].id;room.message+=` ${room.players[0].name} is the remaining player.`;recordResults(room);broadcast(room);return true}
	if(["deal-pick","deal-open","deal-bank"].includes(room.phase)){
		if(oldDealIndex>=0&&oldDealIndex<room.dealTurn)room.dealTurn--;if(wasDealTurn)room.dealTurn=Math.min(oldDealIndex,room.dealOrder.length-1);if(room.phase==="deal-pick"){if(room.players.every(p=>room.dealPersonal[p.id])){room.dealRound=1;room.dealTurnsInCycle=0;startDealOpenTurn(room,false)}else{room.deadline=Date.now()+30000;broadcast(room)}}else if(room.phase==="deal-open"){room.dealOpenRemaining=Math.min(1,dealClosedUnowned(room).length);room.deadline=Date.now()+30000;broadcast(room)}else{broadcast(room);resolveDealBanker(room)}return true
	}
	if(room.phase==="playing"){
		if(targetIndex<room.turn)room.turn--;room.timerSeconds=wordTurnSeconds(room);if(wasWordTurn){room.turn=Math.min(targetIndex,room.players.length-1);let tries=0;while(room.players[room.turn].eliminated&&tries++<room.players.length)room.turn=(room.turn+1)%room.players.length;room.deadline=Date.now()+room.timerSeconds*1000}broadcast(room);return true
	}
	if(["draw","draw-break"].includes(room.phase)){
		const completedRemaining=oldDrawOrder.slice(0,Math.max(0,oldDrawTurn-1)).filter(id=>id!==target.id).length;room.drawTotal=room.drawOrder.length;
		if(wasDrawer&&room.phase==="draw"){room.drawTurn=completedRemaining;room.message+=` Moving to the next artist.`;nextDrawTurn(room)}else{room.drawTurn=Math.min(completedRemaining+1,room.drawTotal);if(room.phase==="draw"&&room.guessed.size>=room.players.length-1)finishDrawTurn(room);else broadcast(room)}return true
	}
	if(room.phase==="royal"){
		if(oldRoyalIndex>=0&&oldRoyalIndex<room.royalTurn)room.royalTurn--;if(wasRoyalTurn){room.royalTurn=Math.min(oldRoyalIndex,room.royalOrder.length-1);room.royalDice=null;room.royalLegal=[];room.deadline=Date.now()+ROYAL_TURN_MS;room.message+=` ${room.players.find(p=>p.id===room.royalOrder[room.royalTurn])?.name}'s turn.`}if(!royalMaybeFinish(room))broadcast(room);return true
	}
	broadcast(room);return true
}
function royalTrack(color,progress){return progress>=0&&progress<52?(ROYAL_OFFSETS[color]+progress)%52:null;}
function royalLegal(room,playerId,dice){const tokens=room.royalTokens[playerId]||[];return tokens.map((p,i)=>({p,i})).filter(x=>x.p<ROYAL_HOME&&((x.p===-1&&dice===6)||(x.p>=0&&x.p+dice<=ROYAL_HOME))).map(x=>x.i);}
function royalMaybeFinish(room){const active=room.royalOrder.filter(id=>{const p=room.players.find(x=>x.id===id);return p&&!p.royalKicked&&!room.royalPlacements.includes(id)});if(active.length>1)return false;if(active.length===1)room.royalPlacements.push(active[0]);room.phase="finished";room.deadline=0;room.winnerId=room.royalPlacements[0]||null;room.message="The Royal Race is complete!";recordResults(room);broadcast(room);return true;}
function royalNext(room){if(royalMaybeFinish(room))return;let tries=0;do{room.royalTurn=(room.royalTurn+1)%room.royalOrder.length;tries++;const p=room.players.find(x=>x.id===room.royalOrder[room.royalTurn]);if(p&&!p.royalKicked&&!room.royalPlacements.includes(p.id))break;}while(tries<=room.royalOrder.length);room.royalDice=null;room.royalLegal=[];room.deadline=Date.now()+ROYAL_TURN_MS;room.message=`${room.players.find(p=>p.id===room.royalOrder[room.royalTurn])?.name}'s turn.`;broadcast(room);}
function royalTimeout(room){const id=room.royalOrder[room.royalTurn],player=room.players.find(p=>p.id===id);if(!player)return royalNext(room);player.royalTimeouts=(player.royalTimeouts||0)+1;room.royalDice=null;room.royalLegal=[];if(player.royalTimeouts>=3){player.royalKicked=true;room.royalTokens[player.id]=[];room.message=`${player.name} missed three timers and was removed from the race.`;}else room.message=`${player.name} ran out of time — timer strike ${player.royalTimeouts}/3.`;broadcast(room);if(!royalMaybeFinish(room))royalNext(room);}
// Royal tokens now enter the crown directly after the 52nd track position.
// This later declaration intentionally replaces the legacy six-square home lane.
function royalMove(room,playerId,tokenIndex){
	if(!room.royalLegal.includes(tokenIndex))return false;
	const player=room.players.find(p=>p.id===playerId),tokens=room.royalTokens[playerId],old=tokens[tokenIndex];
	tokens[tokenIndex]=old===-1?0:old+room.royalDice;
	const reachedHome=old<ROYAL_HOME&&tokens[tokenIndex]===ROYAL_HOME;
	let captured=false;
	const capturedTokens=[],landed=royalTrack(player.royalColor,tokens[tokenIndex]);
	if(landed!==null&&!ROYAL_SAFE.has(landed)){
		for(const opponent of room.players){
			if(opponent.id===playerId||opponent.royalKicked)continue;
			room.royalTokens[opponent.id].forEach((p,i)=>{
				if(royalTrack(opponent.royalColor,p)===landed){
					capturedTokens.push({playerId:opponent.id,tokenIndex:i,fromProgress:p,toProgress:-1});
					room.royalTokens[opponent.id][i]=-1;
					captured=true;
				}
			});
		}
	}
	room.royalLastMove={moveId:++room.royalMoveSeq,playerId,tokenIndex,dice:room.royalDice,fromProgress:old,toProgress:tokens[tokenIndex],captured,capturedTokens,reachedHome};
	room.message=reachedHome?`${player.name} reached the crown!`:captured?`${player.name} captured a token!`:`${player.name} moved token ${tokenIndex+1}.`;
	if(tokens.every(p=>p===ROYAL_HOME)&&!room.royalPlacements.includes(playerId))room.royalPlacements.push(playerId);
	if(royalMaybeFinish(room))return true;
	const bonus=(room.royalDice===6||captured||reachedHome)&&!room.royalPlacements.includes(playerId);
	room.royalDice=null;
	room.royalLegal=[];
	if(bonus){
		room.deadline=Date.now()+ROYAL_TURN_MS;
		room.message+=` ${player.name} gets a bonus roll.`;
		broadcast(room);
	}else royalNext(room);
	return true;
}
function dealActive(room){return room.players.filter(p=>(p.dealStatus||"playing")==="playing")}
function dealClosedUnowned(room){return room.dealCases.filter(c=>!c.opened&&!c.ownerId)}
function dealNextActiveIndex(room,from=room.dealTurn){for(let step=1;step<=room.dealOrder.length;step++){const index=(from+step)%room.dealOrder.length,id=room.dealOrder[index],p=room.players.find(x=>x.id===id);if(p&&(p.dealStatus||"playing")==="playing")return index}return -1}
function roundBankOffer(value){const step=value>=100000?5000:value>=20000?1000:value>=5000?500:value>=1000?100:value>=100?50:10;return Math.max(1,Math.round(value/step)*step)}
function dealOfferMetrics(room){const closed=room.dealCases.filter(c=>!c.opened),average=closed.reduce((sum,c)=>sum+c.value,0)/Math.max(1,closed.length),variance=closed.reduce((sum,c)=>sum+(c.value-average)**2,0)/Math.max(1,closed.length),risk=average?Math.sqrt(variance)/average:0,progress=room.dealCases.filter(c=>c.opened).length/DEAL_AMOUNTS.length,generosity=Math.min(.96,(room.dealFinalBank ? .80 : .32)+progress*(room.dealFinalBank ? .16 : .58)),riskDiscount=Math.min(.14,risk*.035*(1-progress));return {average,risk,progress,generosity,riskDiscount,casesRemaining:dealClosedUnowned(room).length}}
function calculateDealOffer(room,player){const metrics=dealOfferMetrics(room),variation=(94+crypto.randomInt(13))/100,value=metrics.average*Math.max(.18,metrics.generosity-metrics.riskDiscount)*variation;return roundBankOffer(value)}
function finishDealGame(room){for(const p of room.players){const own=room.dealCases.find(c=>c.ownerId===p.id);if((p.dealStatus||"playing")==="playing"){p.dealPayout=own?.value||0;p.dealStatus="case"}p.score=p.dealPayout||0}room.phase="finished";room.deadline=0;room.dealBankerStage="reveal";room.winnerId=[...room.players].sort((a,b)=>b.score-a.score)[0]?.id||null;room.message=`All personal cases are revealed! ${room.players.find(p=>p.id===room.winnerId)?.name||"The winner"} has the highest payout.`;recordResults(room);broadcast(room)}
function startDealOpenTurn(room,advance=false){const active=dealActive(room);if(!active.length||!dealClosedUnowned(room).length){startDealBanker(room,true);return}if(advance){const next=dealNextActiveIndex(room);if(next>=0)room.dealTurn=next}const current=room.players.find(p=>p.id===room.dealOrder[room.dealTurn]);if(!current||(current.dealStatus||"playing")!=="playing"){const next=dealNextActiveIndex(room,room.dealTurn-1);if(next<0)return finishDealGame(room);room.dealTurn=next}room.phase="deal-open";room.dealOpenRemaining=Math.min(1,dealClosedUnowned(room).length);room.dealBankerStage="idle";room.deadline=Date.now()+30000;room.message=`${room.players.find(p=>p.id===room.dealOrder[room.dealTurn])?.name} must open one case.`;broadcast(room)}
function resolveDealBanker(room){if(room.phase!=="deal-bank"||room.dealBankerStage!=="offer")return;const active=dealActive(room);if(active.some(p=>!room.dealChoices[p.id]))return;room.deadline=0;if(!dealActive(room).length||room.dealFinalBank||!dealClosedUnowned(room).length)return finishDealGame(room);room.dealRound++;room.dealTurnsInCycle=0;startDealOpenTurn(room,true)}
function startDealBanker(room,finalBank=false){if(room.phase==="finished")return;const active=dealActive(room);if(!active.length)return finishDealGame(room);room.phase="deal-bank";room.deadline=0;room.dealFinalBank=finalBank;room.dealBankerStage="calling";room.dealOffers={};room.dealChoices={};for(const p of active)room.dealOffers[p.id]=calculateDealOffer(room,p);room.message="The banker is calling…";broadcast(room);setTimeout(()=>{if(room.phase!=="deal-bank"||room.dealBankerStage!=="calling")return;room.dealBankerStage="deciding";room.message="The banker is reviewing the remaining values…";broadcast(room)},1400);setTimeout(()=>{if(room.phase!=="deal-bank"||!['calling','deciding'].includes(room.dealBankerStage))return;room.dealBankerStage="offer";room.deadline=Date.now()+30000;room.message=finalBank?"FINAL OFFERS: Deal or keep your personal case?":"The banker has made individual offers. Deal or No Deal?";broadcast(room)},3200)}
function completeDealOpenTurn(room){room.dealTurnsInCycle++;const activeCount=dealActive(room).length;if(!dealClosedUnowned(room).length)return startDealBanker(room,true);if(room.dealTurnsInCycle>=activeCount)return startDealBanker(room,false);startDealOpenTurn(room,true)}
function openDealCase(room,caseNumber){const item=room.dealCases.find(c=>c.number===caseNumber);if(!item||item.opened||item.ownerId)return false;item.opened=true;room.dealOpenRemaining--;room.message=`Case ${item.number} contained R${item.value.toLocaleString("en-ZA")}.`;if(room.dealOpenRemaining<=0||!dealClosedUnowned(room).length)completeDealOpenTurn(room);else broadcast(room);return true}
function dealTimeout(room){if(room.phase==="deal-pick"){const player=room.players.find(p=>p.id===room.dealOrder[room.dealTurn]);if(markAfkMiss(room,player,"missed"))return;const available=room.dealCases.filter(c=>!c.ownerId),choice=available[crypto.randomInt(available.length)];selectDealCase(room,room.dealOrder[room.dealTurn],choice.number);return}if(room.phase==="deal-open"){const player=room.players.find(p=>p.id===room.dealOrder[room.dealTurn]);if(markAfkMiss(room,player,"missed"))return;const options=dealClosedUnowned(room);while(room.phase==="deal-open"&&room.dealOpenRemaining>0&&options.length){const choice=options.splice(crypto.randomInt(options.length),1)[0];openDealCase(room,choice.number)}return}if(room.phase==="deal-bank"&&room.dealBankerStage==="offer"){for(const p of [...dealActive(room)])if(!room.dealChoices[p.id]){if(markAfkMiss(room,p,"missed"))continue;room.dealChoices[p.id]="no-deal"}room.message="Unanswered offers defaulted to NO DEAL.";broadcast(room);resolveDealBanker(room)}}
function selectDealCase(room,playerId,caseNumber){if(room.phase!=="deal-pick"||room.dealOrder[room.dealTurn]!==playerId)return false;const item=room.dealCases.find(c=>c.number===caseNumber);if(!item||item.ownerId||item.opened)return false;item.ownerId=playerId;room.dealPersonal[playerId]=caseNumber;const player=room.players.find(p=>p.id===playerId);room.message=`${player?.name} locked Case ${caseNumber}.`;if(room.dealTurn>=room.dealOrder.length-1){room.dealRound=1;room.dealTurn=0;room.dealTurnsInCycle=0;startDealOpenTurn(room,false)}else{room.dealTurn++;room.deadline=Date.now()+30000;broadcast(room)}return true}
function readinessError(room){if(room.players.length<2)return "At least two players are required.";if(room.players.some(p=>!p.connected||p.away||!p.ready))return "Every player must be connected, present and READY.";if(room.game==="royal"&&room.players.length>4)return "Royal Race supports a maximum of four players.";if(room.game==="royal"&&new Set(room.players.map(p=>p.royalColor)).size!==room.players.length)return "Every player must choose a different colour.";if(room.game==="survey"&&room.mode==="teams"){const gold=room.players.filter(p=>p.team==="gold").length,blue=room.players.filter(p=>p.team==="blue").length;if(gold<2||blue<2)return "Team mode needs at least two players on Gold Team and two on Blue Team."}return ""}
function beginConfiguredGame(room){
	const problem=readinessError(room);if(problem){room.phase="lobby";room.deadline=0;room.message=`Countdown cancelled: ${problem}`;broadcast(room);return false}
	room.resultsRecorded=false;room.lastResults=[];room.matchId=id();room.players.forEach(p=>{p.ready=false;p.afkMisses=0});
	if(room.game==="deal"){const values=[...DEAL_AMOUNTS];for(let i=values.length-1;i>0;i--){const j=crypto.randomInt(i+1);[values[i],values[j]]=[values[j],values[i]]}room.dealCases=values.map((value,i)=>({number:i+1,value,opened:false,ownerId:null}));room.dealOrder=room.players.map(p=>p.id).sort(()=>Math.random()-.5);room.dealTurn=0;room.dealOpenRemaining=0;room.dealPersonal={};room.dealOffers={};room.dealChoices={};room.dealRound=0;room.dealTurnsInCycle=0;room.dealBankerStage="idle";room.dealFinalBank=false;room.players.forEach(p=>{p.score=0;p.dealStatus="playing";p.dealPayout=0});room.phase="deal-pick";room.deadline=Date.now()+30000;room.winnerId=null;room.message=`${room.players.find(p=>p.id===room.dealOrder[0])?.name}, choose your personal case.`;broadcast(room);return true}
	if(room.game==="royal"){room.players.forEach(p=>{p.score=0;p.royalTimeouts=0;p.royalKicked=false});room.royalOrder=room.players.map(p=>p.id).sort(()=>Math.random()-.5);room.royalTurn=0;room.royalDice=null;room.royalLegal=[];room.royalTokens={};room.players.forEach(p=>room.royalTokens[p.id]=[-1,-1,-1,-1]);room.royalPlacements=[];room.royalLastMove=null;room.royalMoveSeq=0;room.phase="royal";room.deadline=Date.now()+ROYAL_TURN_MS;room.winnerId=null;room.message=`${room.players.find(p=>p.id===room.royalOrder[0])?.name} begins the Royal Race!`;broadcast(room);return true}
	if(room.game==="draw"){room.players.forEach(p=>p.score=0);room.drawTotal=Math.max(room.drawRounds,room.players.length);room.drawOrder=makeDrawOrder(room.players,room.drawTotal);room.drawTurn=1;room.winnerId=null;startDrawTurn(room);return true}
	if(room.game==="survey"){room.players.forEach(p=>{p.score=0;p.surveyBlank=false});room.surveyQuestions=chooseSurveys(5);room.surveyIndex=0;room.found=new Set();room.surveyActivity=new Set();room.phase="survey";room.round=1;room.deadline=Date.now()+SURVEY_ROUND_MS;room.winnerId=null;room.winnerTeam=null;room.message="The 60-second survey is live—submit your best answers!";broadcast(room);return true}
	room.players.forEach(p=>{p.strikes=0;p.eliminated=false;p.score=0});room.phase="playing";room.turn=crypto.randomInt(room.players.length);room.currentWord=STARTERS[crypto.randomInt(STARTERS.length)];room.used=new Set([room.currentWord]);room.round=1;room.winnerId=null;room.timerSeconds=wordTurnSeconds(room);room.deadline=Date.now()+room.timerSeconds*1000;room.message="Game on! Four letters minimum—think fast!";broadcast(room);return true;
}
function returnToLobby(room,reason="Returning to TM’s Game Room."){const promoted=promoteSpectators(room);room.phase="lobby";room.deadline=0;room.returnDeadline=0;room.rematchVotes=[];room.currentWord="";room.winnerId=null;room.winnerTeam=null;room.drawerId=null;room.strokes=[];room.dealCases=[];room.dealPersonal={};room.dealOffers={};room.dealChoices={};room.dealBankerStage="idle";room.players.forEach(p=>{p.ready=false;p.strikes=0;p.eliminated=false;p.score=0;p.afkMisses=0;p.surveyBlank=false;p.royalTimeouts=0;p.royalKicked=false;p.dealStatus="playing";p.dealPayout=0});room.message=`${reason}${promoted?` ${promoted} spectator${promoted===1?" has":"s have"} joined the player seats.`:""} Everyone must ready up.`;broadcast(room);return true}
const timerSweep = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    refreshConnectionStatuses(room,now);
    expireDisconnectedPlayers(room,now);
    if(!rooms.has(room.code))continue;
    if(room.phase==="finished"&&room.returnDeadline&&now>=room.returnDeadline){
      returnToLobby(room);
    } else if(room.phase==="countdown"&&room.deadline&&now>=room.deadline){
      beginConfiguredGame(room);
    } else if (room.phase === "playing" && room.deadline && now >= room.deadline) {
      const player=room.players[room.turn];if(!markAfkMiss(room,player,"missed"))strike(room,player,"time ran out");
    } else if (room.phase === "survey" && room.deadline && now >= room.deadline) {
      for(const player of [...room.players])if(!room.surveyActivity?.has(player.id)){player.surveyBlank=true;markAfkMiss(room,player,"blank Survey")}
      if(room.phase==="survey")finishSurveyQuestion(room);
    } else if (room.phase === "draw" && room.deadline && now >= room.deadline) {
      const drawer=room.players.find(p=>p.id===room.drawerId);if(room.drawActivity||!markAfkMiss(room,drawer,"inactive drawing"))finishDrawTurn(room);
    } else if (room.phase === "survey-break" && room.deadline && now >= room.deadline) {
      startNextSurvey(room);
    } else if (room.phase === "draw-break" && room.deadline && now >= room.deadline) {
      nextDrawTurn(room);
    } else if (room.phase === "royal" && room.deadline && now >= room.deadline) {
      royalTimeout(room);
    } else if (["deal-pick","deal-open","deal-bank"].includes(room.phase) && room.deadline && now >= room.deadline) {
      dealTimeout(room);
    }
  }
}, 250);
timerSweep.unref();

async function api(req, res, route) {
  const body = req.method === "POST" ? await readBody(req) : {};
  if(route==="/api/account/register"&&req.method==="POST"){
    const result=await persistence.registerAccount(body.username,body.password);return json(res,200,result);
  }
  if(route==="/api/account/login"&&req.method==="POST"){
    const result=await persistence.loginAccount(body.username,body.password);return json(res,200,result);
  }
  if(["/api/account/me","/api/account/daily","/api/account/history"].includes(route)&&req.method==="POST"){
    const account=await persistence.authenticateAccount(body.accountToken);if(!account)return json(res,401,{error:"Sign in again to continue."});
    if(route==="/api/account/me")return json(res,200,{profile:account});
    if(route==="/api/account/daily")return json(res,200,await persistence.claimDailyReward(account.id));
    return json(res,200,{history:await persistence.accountHistory(account.id)});
  }
  if(route==="/api/global-leaderboard"&&req.method==="POST")return json(res,200,{entries:await persistence.globalLeaderboard()});
  if (route === "/api/create" && req.method === "POST") {
    const account=body.accountToken?await persistence.authenticateAccount(body.accountToken):null;if(body.accountToken&&!account)return json(res,401,{error:"Your account session expired. Sign in again."});
    const name = cleanName(account?.username||body.name); if (!name) return json(res, 400, {error:"Enter your name."});
    const roomCode = code(), playerId = id(), token = id();
    const player = {id:playerId, token,accountId:account?.id||null,guest:!account,name, strikes:0, eliminated:false,ready:false,away:false,afkMisses:0,connected:true,connectedAt:Date.now(),disconnectedAt:0,reconnectDeadline:0,connectionStatus:"connected",lastPresenceAt:Date.now(),latencyMs:0,host:true,team:"gold",score:0,royalColor:"gold",royalTimeouts:0,royalKicked:false,voiceOn:false,coinBalance:account?.coinBalance||0,totalXp:account?.totalXp||0,wins:account?.wins||0,gamesPlayed:account?.gamesPlayed||0,gameStats:account?.gameStats||freshStats()};
    const room = {code:roomCode, hostId:playerId,ownerId:playerId, phase:"lobby", game:"wordlink",mode:"ffa",players:[player],spectators:[], turn:0, currentWord:"", used:new Set(), deadline:0, timerSeconds:15, round:0, winnerId:null,winnerTeam:null,surveyQuestions:[],surveyIndex:0,found:new Set(),drawRounds:5,drawTurn:0,drawTotal:0,drawOrder:[],drawerId:null,drawWord:"",strokes:[],guessed:new Set(),lastGuesses:[],royalOrder:[],royalTurn:0,royalDice:null,royalLegal:[],royalTokens:{},royalPlacements:[],royalLastMove:null,royalMoveSeq:0,dealCases:[],dealOrder:[],dealTurn:0,dealOpenRemaining:0,dealPersonal:{},dealOffers:{},dealChoices:{},dealRound:0,dealTurnsInCycle:0,dealBankerStage:"idle",dealFinalBank:false,chat:[],chatSeq:0,chatSlowMode:false,reactions:[],reactionSeq:0,lastEventMessage:"",voiceSignals:[],voiceSignalSeq:0,lastResults:[],resultsRecorded:false,message:"Room created. Share the code!", createdAt:Date.now()};
    rooms.set(roomCode, room);persistence.scheduleRoomSave(room);return json(res, 200, {code:roomCode, playerId, token});
  }
  if (route === "/api/join" && req.method === "POST") {
    const room = rooms.get(String(body.code || "").toUpperCase());
    if (!room) return json(res, 404, {error:"Room not found. Check the code."});
    room.spectators||=[];const joiningAsSpectator=room.phase!=="lobby";if(!joiningAsSpectator&&room.players.length>=8)return json(res,409,{error:"This room is full."});if(joiningAsSpectator&&room.spectators.length>=8)return json(res,409,{error:"The spectator gallery is full."});
    const account=body.accountToken?await persistence.authenticateAccount(body.accountToken):null;if(body.accountToken&&!account)return json(res,401,{error:"Your account session expired. Sign in again."});
    const name = cleanName(account?.username||body.name); if (!name) return json(res, 400, {error:"Enter your name."});
    if(account&&participants(room).some(p=>p.accountId===account.id))return json(res,409,{error:"This account is already in the room."});
    if (participants(room).some(p => p.name.toLowerCase() === name.toLowerCase())) return json(res, 409, {error:"That nickname is already in use."});
    const goldCount=room.players.filter(p=>p.team==="gold").length,blueCount=room.players.filter(p=>p.team==="blue").length;
    const usedColors=room.players.map(p=>p.royalColor),availableColor=ROYAL_COLORS.find(c=>!usedColors.includes(c))||ROYAL_COLORS[room.players.length%4];
    const player = {id:id(), token:id(),accountId:account?.id||null,guest:!account,name,spectator:joiningAsSpectator, strikes:0, eliminated:false,ready:false,away:false,afkMisses:0,connected:true,connectedAt:Date.now(),disconnectedAt:0,reconnectDeadline:0,connectionStatus:"connected",lastPresenceAt:Date.now(),latencyMs:0,host:false,team:goldCount<=blueCount?"gold":"blue",score:0,royalColor:availableColor,royalTimeouts:0,royalKicked:false,voiceOn:false,coinBalance:account?.coinBalance||0,totalXp:account?.totalXp||0,wins:account?.wins||0,gamesPlayed:account?.gamesPlayed||0,gameStats:account?.gameStats||freshStats()}; (joiningAsSpectator?room.spectators:room.players).push(player);
    room.message = joiningAsSpectator?`${name} joined as a spectator and will enter the next available seat.`:`${name} joined the room.`; broadcast(room); return json(res, 200, {code:room.code, playerId:player.id, token:player.token,spectator:joiningAsSpectator});
  }
  const room = rooms.get(String(body.code || "").toUpperCase());
  const player = room&&participants(room).find(p => p.id === body.playerId && p.token === body.token);
  if (!room || !player) return json(res, 403, {error:"Your room session is no longer valid."});
  if(player.spectator&&!new Set(["/api/presence","/api/chat","/api/reaction","/api/voice-state","/api/voice-ack","/api/voice-signal","/api/leave"]).has(route))return json(res,403,{error:"You are spectating this match. You will enter the next available seat."});
  if (route === "/api/configure") {
    if (player.id !== room.hostId || room.phase !== "lobby") return json(res,403,{error:"Only the host can configure the lobby."});
    if (["wordlink","survey","draw","royal","deal"].includes(body.game)) room.game=body.game;
    if (["ffa","teams"].includes(body.mode)) room.mode=body.mode;
    if([5,10].includes(Number(body.rounds)))room.drawRounds=Number(body.rounds);
    room.players.forEach(p=>p.ready=false);room.message=room.game==="survey"?"Survey Showdown selected!":room.game==="draw"?"Draw & Guess selected!":room.game==="royal"?"TM's Royal Race selected!":room.game==="deal"?"Deal or No Deal selected!":"Word Link selected!";broadcast(room);return json(res,200,{ok:true});
  }
  if (route === "/api/team") {
    if (room.phase!=="lobby" || !["gold","blue"].includes(body.team)) return json(res,400,{error:"Team cannot be changed now."});
    player.team=body.team;room.players.forEach(p=>p.ready=false);room.message=`${player.name} joined ${body.team === "gold" ? "Gold" : "Blue"} Team.`;broadcast(room);return json(res,200,{ok:true});
  }
  if(route==="/api/royal-color"){
    if(room.phase!=="lobby"||room.game!=="royal"||!ROYAL_COLORS.includes(body.color))return json(res,400,{error:"Colour cannot be changed now."});if(room.players.some(p=>p.id!==player.id&&p.royalColor===body.color))return json(res,409,{error:"That colour is already taken."});player.royalColor=body.color;room.players.forEach(p=>p.ready=false);room.message=`${player.name} chose ${body.color.toUpperCase()}.`;broadcast(room);return json(res,200,{ok:true});
  }
  if(route==="/api/presence"){
    const latency=Math.max(0,Math.min(9999,Number(body.latencyMs)||0)),status=body.unstable||latency>=900?"unstable":"connected",changed=player.connectionStatus!==status||!player.connected;player.connected=true;player.connectionStatus=status;player.lastPresenceAt=Date.now();player.latencyMs=latency;if(changed)broadcast(room);return json(res,200,{ok:true,status,serverTime:Date.now()});
  }
  if(route==="/api/away"){
    player.away=Boolean(body.away);if(player.away)player.ready=false;else markPlayerActivity(player);room.message=player.away?`${player.name} is away. Their active turn will be skipped.`:`${player.name} is back.`;
    if(player.away&&room.phase==="playing"&&room.players[room.turn]?.id===player.id)return nextTurn(room),json(res,200,{ok:true});
    if(player.away&&room.phase==="draw"&&room.drawerId===player.id)return finishDrawTurn(room),json(res,200,{ok:true});
    if(player.away&&room.phase==="royal"&&room.royalOrder[room.royalTurn]===player.id)return royalNext(room),json(res,200,{ok:true});
    if(player.away&&["deal-pick","deal-open"].includes(room.phase)&&room.dealOrder[room.dealTurn]===player.id)return dealTimeout(room),json(res,200,{ok:true});
    broadcast(room);return json(res,200,{ok:true});
  }
  if(route==="/api/ready"){
    if(room.phase!=="lobby")return json(res,409,{error:"Readiness can only change in the lobby."});if(!player.connected||player.away)return json(res,409,{error:"Return from Away before readying up."});player.ready=Boolean(body.ready);room.message=`${player.name} is ${player.ready?"READY":"NOT READY"}.`;broadcast(room);return json(res,200,{ok:true});
  }
  if (route === "/api/start") {
    if (player.id !== room.hostId) return json(res, 403, {error:"Only the host can start."});
    const problem=readinessError(room);if(problem)return json(res,409,{error:problem});room.phase="countdown";room.deadline=Date.now()+4000;room.message=`${room.game==="royal"?"TM’s Royal Race":room.game==="draw"?"Draw & Guess":room.game==="survey"?"Survey Showdown":room.game==="deal"?"Deal or No Deal":"Word Link"} begins in 4…`;broadcast(room);return json(res,200,{ok:true});
  }
  if(route==="/api/royal-roll"){
    if(room.phase!=="royal"||room.royalOrder[room.royalTurn]!==player.id||room.royalDice!==null)return json(res,409,{error:"You cannot roll now."});markPlayerActivity(player);room.royalDice=crypto.randomInt(1,7);const rolled=room.royalDice;room.royalLegal=royalLegal(room,player.id,room.royalDice);room.message=`${player.name} rolled ${room.royalDice}.`;broadcast(room);if(room.royalLegal.length===0)setTimeout(()=>{if(room.phase==="royal"&&room.royalOrder[room.royalTurn]===player.id&&room.royalDice===rolled)royalNext(room)},1000);else if(room.royalLegal.length===1){const only=room.royalLegal[0];setTimeout(()=>{if(room.phase==="royal"&&room.royalOrder[room.royalTurn]===player.id&&room.royalDice===rolled)royalMove(room,player.id,only)},850);}return json(res,200,{ok:true,dice:rolled});
  }
  if(route==="/api/royal-move"){
    if(room.phase!=="royal"||room.royalOrder[room.royalTurn]!==player.id||room.royalDice===null)return json(res,409,{error:"You cannot move now."});markPlayerActivity(player);if(!royalMove(room,player.id,Number(body.tokenIndex)))return json(res,400,{error:"That token cannot move."});return json(res,200,{ok:true});
  }
  if(route==="/api/deal-case"){
    const caseNumber=Number(body.caseNumber);markPlayerActivity(player);if(room.phase==="deal-pick"){if(!selectDealCase(room,player.id,caseNumber))return json(res,400,{error:"That personal case cannot be selected."});return json(res,200,{ok:true})}if(room.phase==="deal-open"){if(room.dealOrder[room.dealTurn]!==player.id)return json(res,409,{error:"Wait for your turn to open cases."});if(!openDealCase(room,caseNumber))return json(res,400,{error:"That case cannot be opened."});return json(res,200,{ok:true})}return json(res,409,{error:"Cases cannot be selected right now."});
  }
  if(route==="/api/deal-decision"){
    if(room.phase!=="deal-bank"||room.dealBankerStage!=="offer"||(player.dealStatus||"playing")!=="playing"||room.dealChoices[player.id])return json(res,409,{error:"You cannot answer the banker now."});markPlayerActivity(player);const decision=body.decision==="deal"?"deal":body.decision==="no-deal"?"no-deal":null;if(!decision)return json(res,400,{error:"Choose DEAL or NO DEAL."});room.dealChoices[player.id]=decision;if(decision==="deal"){player.dealStatus="dealt";player.dealPayout=room.dealOffers[player.id];room.message=`${player.name} accepted R${player.dealPayout.toLocaleString("en-ZA")}!`}else room.message=`${player.name} said NO DEAL!`;broadcast(room);resolveDealBanker(room);return json(res,200,{ok:true});
  }
  if(route==="/api/draw-stroke"){
    if(room.phase!=="draw"||player.id!==room.drawerId)return json(res,403,{error:"Only the current drawer can draw."});
    const color=/^#[0-9a-f]{6}$/i.test(body.color)?body.color:"#14213d",size=Math.max(2,Math.min(30,Number(body.size)||6));
    const rawPoints=Array.isArray(body.points)?body.points.slice(0,30).map(p=>[Math.max(0,Math.min(1,Number(p[0]))),Math.max(0,Math.min(1,Number(p[1])))]):[],points=smoothStrokePoints(rawPoints),strokeId=String(body.strokeId||"").replace(/[^a-z0-9-]/gi,"").slice(0,50)||id();
    if(points.length){markPlayerActivity(player);room.drawActivity=true;room.strokes.push({color,size,points,strokeId});if(room.strokes.length>2500)room.strokes.shift();broadcast(room);}return json(res,200,{ok:true});
  }
  if(route==="/api/undo-drawing"){
    if(room.phase!=="draw"||player.id!==room.drawerId)return json(res,403,{error:"Only the current drawer can undo."});undoDrawStroke(room);markPlayerActivity(player);room.drawActivity=true;broadcast(room);return json(res,200,{ok:true});
  }
  if(route==="/api/clear-drawing"){
    if(room.phase!=="draw"||player.id!==room.drawerId)return json(res,403,{error:"Only the current drawer can clear."});markPlayerActivity(player);room.drawActivity=true;room.strokes=[];broadcast(room);return json(res,200,{ok:true});
  }
  if(route==="/api/draw-guess"){
    if(room.phase!=="draw"||player.id===room.drawerId||room.guessed.has(player.id))return json(res,409,{error:"You cannot guess right now."});
    const guess=cleanPhrase(body.guess);if(!guess)return json(res,400,{error:"Enter a guess."});markPlayerActivity(player);
    if(drawGuessMatches(guess,room.drawWord)){const remaining=Math.max(0,room.deadline-Date.now()),gained=calculateDrawScore(remaining,room.guessed.size===0);player.score=Math.min(100,player.score+gained);room.guessed.add(player.id);const drawer=room.players.find(p=>p.id===room.drawerId);if(drawer)drawer.score=Math.min(100,drawer.score+1);room.lastGuesses.push({name:player.name,text:"GUESSED IT!",correct:true,points:gained});room.message=`${player.name} guessed correctly for ${gained} points!`;if(room.guessed.size>=room.players.length-1)finishDrawTurn(room);else broadcast(room);return json(res,200,{ok:true,points:gained});}
    room.lastGuesses.push({name:player.name,text:String(body.guess).slice(0,28),correct:false});room.message=`${player.name} submitted a guess.`;broadcast(room);return json(res,200,{ok:false});
  }
  if(route==="/api/next-draw"){
    if(player.id!==room.hostId||room.phase!=="draw-break")return json(res,403,{error:"Only the host can continue."});nextDrawTurn(room);return json(res,200,{ok:true});
  }
  if(route==="/api/survey-answer"){
    if(room.phase!=="survey")return json(res,409,{error:"The survey round is not active."});
    if(!surveyDeadlineOpen(room)){finishSurveyQuestion(room);return json(res,409,{error:"Time is up. The server has locked this round."})}
    const guess=cleanPhrase(body.answer);if(guess.length<2)return json(res,400,{error:"Enter a complete answer."});markPlayerActivity(player);room.surveyActivity||=new Set();room.surveyActivity.add(player.id);player.surveyBlank=false;
    const question=room.surveyQuestions[room.surveyIndex],match=findSurveyAnswer(question,guess,room.found);
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
    markPlayerActivity(player);const word = cleanWord(body.word);
    if (!validWordLength(word)) { strike(room, player, "words must contain at least four letters"); return json(res, 200, {ok:false}); }
    if (room.used.has(word)) { strike(room, player, `${word} was already used`); return json(res, 200, {ok:false}); }
    if (word[0] !== room.currentWord.at(-1)) { strike(room, player, `${word} must begin with ${room.currentWord.at(-1)}`); return json(res, 200, {ok:false}); }
    room.currentWord=word; room.used.add(word);player.score+=100; room.round++; room.message=`${player.name} linked ${word}!`; nextTurn(room); return json(res, 200, {ok:true});
  }
  if (route === "/api/restart") {
    if (player.id !== room.hostId) return json(res, 403, {error:"Only the host can restart."});
    returnToLobby(room,"The host returned everyone to TM’s Game Room.");return json(res, 200, {ok:true});
  }
  if(route==="/api/rematch-vote"){
    if(room.phase!=="finished")return json(res,409,{error:"Rematch voting is only available after results."});room.rematchVotes||=[];if(!room.rematchVotes.includes(player.id))room.rematchVotes.push(player.id);const eligible=room.players.filter(p=>p.connected);room.message=`${player.name} voted for a rematch (${room.rematchVotes.length}/${eligible.length}).`;if(eligible.length&&eligible.every(p=>room.rematchVotes.includes(p.id)))returnToLobby(room,"Rematch approved.");else broadcast(room);return json(res,200,{ok:true});
  }
  if (route === "/api/remove") {
    if (player.id !== room.hostId) return json(res, 403, {error:"Only the host can remove players."});
    const target = participants(room).find(p => p.id === body.targetId);
    if (!target || target.host) return json(res, 400, {error:"Player cannot be removed."});
    removePlayer(room,target.id,"was removed by the host");return json(res, 200, {ok:true});
  }
  if(route==="/api/transfer-host"){
    if(player.id!==room.hostId)return json(res,403,{error:"Only the current host can transfer ownership."});const target=room.players.find(p=>p.id===body.targetId&&p.connected);if(!target||target.id===player.id)return json(res,400,{error:"Choose another connected player."});transferHost(room,target.id,{permanent:true});room.message=`${target.name} is now the permanent host.`;broadcast(room);return json(res,200,{ok:true});
  }
  if(route==="/api/leave"){removePlayer(room,player.id);return json(res,200,{ok:true});}
  if(route==="/api/chat"){
    const duplicate=body.clientMessageId&&room.chat.find(m=>m.playerId===player.id&&m.clientMessageId===String(body.clientMessageId).slice(0,80));if(duplicate)return json(res,200,{ok:true,id:duplicate.id});const blocked=canSendChat(room,player);if(blocked)return json(res,429,{error:blocked});const before=room.chat.length,message=addChatMessage(room,player,body.text,body.clientMessageId);if(!message)return json(res,400,{error:"Type a message."});if(room.chat.length!==before){player.lastChatAt=Date.now();broadcast(room)}return json(res,200,{ok:true,id:message.id});
  }
  if(route==="/api/chat-slow"){
    if(player.id!==room.hostId)return json(res,403,{error:"Only the host can change slow mode."});room.chatSlowMode=Boolean(body.enabled);room.message=`Chat slow mode ${room.chatSlowMode?"enabled":"disabled"}.`;broadcast(room);return json(res,200,{ok:true});
  }
  if(route==="/api/chat-mute"){
    if(player.id!==room.hostId)return json(res,403,{error:"Only the host can mute players."});const target=participants(room).find(p=>p.id===body.targetId);if(!target||target.host)return json(res,400,{error:"Player cannot be muted."});target.chatMuted=Boolean(body.muted);broadcast(room);return json(res,200,{ok:true});
  }
  if(route==="/api/reaction"){
    const allowed=["👏","😂","🔥","😮","👑","❤️"],emoji=String(body.emoji||"");if(!allowed.includes(emoji))return json(res,400,{error:"Invalid reaction."});const blocked=canSendChat(room,player);if(blocked)return json(res,429,{error:blocked});if(Date.now()-(player.lastReactionAt||0)<1200)return json(res,429,{error:"Reactions need a short pause."});player.lastReactionAt=Date.now();room.reactions||=[];room.reactionSeq=(room.reactionSeq||0)+1;room.reactions.push({id:room.reactionSeq,playerId:player.id,name:player.name,emoji,ts:Date.now()});if(room.reactions.length>30)room.reactions.shift();broadcast(room);return json(res,200,{ok:true});
  }
  if(route==="/api/voice-state"){
    player.voiceOn=Boolean(body.enabled);room.voiceSignals=room.voiceSignals.filter(s=>s.from!==player.id&&s.to!==player.id);broadcast(room);return json(res,200,{ok:true});
  }
  if(route==="/api/voice-ack"){
    player.voiceSignalAck=Math.max(player.voiceSignalAck||0,Number(body.signalId)||0);room.voiceSignals=room.voiceSignals.filter(s=>s.to!==player.id||s.id>player.voiceSignalAck);return json(res,200,{ok:true});
  }
  if(route==="/api/voice-signal"){
    const target=participants(room).find(p=>p.id===body.to);if(!voiceRecipientAvailable(player,target))return json(res,400,{error:"Voice recipient is unavailable."});if(!["offer","answer","ice"].includes(body.type))return json(res,400,{error:"Invalid voice signal."});room.voiceSignals.push({id:++room.voiceSignalSeq,from:player.id,to:target.id,type:body.type,payload:body.payload});if(room.voiceSignals.length>400)room.voiceSignals.splice(0,room.voiceSignals.length-300);broadcast(room);return json(res,200,{ok:true});
  }
  return json(res, 404, {error:"Unknown action."});
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/events") {
      const room = rooms.get(String(url.searchParams.get("code") || "").toUpperCase());
      const viewer=room&&participants(room).find(p=>p.id===url.searchParams.get("playerId")&&p.token===url.searchParams.get("token"));
      if (!room||!viewer) return json(res, 403, {error:"Room session not found"});
      res.writeHead(200, {"content-type":"text/event-stream", "cache-control":"no-cache", "connection":"keep-alive", "access-control-allow-origin":"*"});
      if (!clients.has(room.code)) clients.set(room.code, new Set()); const client={res,playerId:viewer.id};clients.get(room.code).add(client);
      const reconnected=markPlayerConnected(room,viewer.id);
      res.write(`data: ${JSON.stringify(publicRoom(room,viewer.id))}\n\n`);
      if(reconnected)broadcast(room);
      let closed=false;
      req.on("close", () => {if(closed)return;closed=true;clients.get(room.code)?.delete(client);if(markPlayerDisconnected(room,viewer.id))broadcast(room)}); return;
    }
    if (url.pathname.startsWith("/api/")) return await api(req, res, url.pathname);
    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    file = path.normalize(file).replace(/^(\.\.[/\\])+/, "");
    const full = path.join(PUBLIC, file);
    if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return json(res, 404, {error:"Not found"});
    const types = {".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".svg":"image/svg+xml"};
    res.writeHead(200, {"content-type":types[path.extname(full)] || "application/octet-stream", "cache-control":"no-cache"}); fs.createReadStream(full).pipe(res);
  } catch (error) { json(res, Number(error.status)||500, {error:error.message || "Server error"}); }
});
async function startServer(){
  const database=await persistence.initialize();
  if(database.enabled){
    const restored=await persistence.loadRooms({reconnectGraceMs:RECONNECT_GRACE_MS});
    for(const room of restored)if(room.code&&room.players.length)rooms.set(room.code,room);
    console.log(`PostgreSQL persistence ready; restored ${restored.length} room${restored.length===1?"":"s"}.`);
  }else console.log("DATABASE_URL is not configured; running with temporary in-memory rooms.");
  return new Promise((resolve,reject)=>{server.once("error",reject);server.listen(PORT,"0.0.0.0",()=>{console.log(`TM's GAME ROOM running on http://localhost:${PORT}`);resolve(server)})});
}
async function stopServer(){
  await persistence.flushAll();
  await new Promise(resolve=>server.listening?server.close(resolve):resolve());
  await persistence.close();
}
if (require.main === module) {
  startServer().catch(error=>{console.error("TM's GAME ROOM could not start:",error);process.exitCode=1});
  const shutdown=()=>stopServer().finally(()=>process.exit(0));
  process.once("SIGTERM",shutdown);process.once("SIGINT",shutdown);
}

module.exports = {cleanName, cleanWord, cleanPhrase, similar, server,startServer,stopServer, __test:{SURVEY_ROUND_MS,RECONNECT_GRACE_MS,ROYAL_COLORS,ROYAL_OFFSETS,ROYAL_SAFE,ROYAL_HOME,participants,promoteSpectators,transferHost,returnToLobby,validWordLength,wordTurnSeconds,calculateDrawScore,drawGuessMatches,undoDrawStroke,findSurveyAnswer,surveyDeadlineOpen,royalTrack,royalLegal,royalMove,royalTimeout,removePlayer,markPlayerConnected,markPlayerDisconnected,refreshConnectionStatuses,expireDisconnectedPlayers,markPlayerActivity,markAfkMiss,readinessError,beginConfiguredGame,smoothStrokePoints,cleanChat,addChatMessage,addGameEvent,canSendChat,voiceRecipientAvailable,finishSurveyQuestion,startNextSurvey,finishDrawTurn,nextDrawTurn,leaderboard,recordResults,freshStats,selectDealCase,openDealCase,finishDealGame,dealOfferMetrics,calculateDealOffer}};
