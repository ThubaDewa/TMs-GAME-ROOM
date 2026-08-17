const test = require("node:test");
const assert = require("node:assert/strict");
const {cleanName, cleanWord, cleanPhrase, similar, __test} = require("../server");
test("normalizes game words", () => assert.equal(cleanWord(" tiger! "), "TIGER"));
test("removes markup from names", () => assert.equal(cleanName("<TM>"), "TM"));
test("normalizes survey phrases", () => assert.equal(cleanPhrase("  Sun-Cream! "), "suncream"));
test("accepts close survey variants", () => assert.equal(similar("towels", "towel"), true));
test("records captured Royal Race tokens for the return animation", () => {
	const room = {
		players:[
			{id:"a",name:"A",royalColor:"gold",royalKicked:false},
			{id:"b",name:"B",royalColor:"blue",royalKicked:false}
		],
		phase:"royal",royalOrder:["a","b"],royalTurn:0,royalLegal:[0],royalDice:1,
		royalTokens:{a:[0,-1,-1,-1],b:[40,-1,-1,-1]},royalPlacements:[],royalMoveSeq:0
	};
	assert.equal(__test.royalMove(room,"a",0),true);
	assert.equal(room.royalTokens.b[0],-1);
	assert.deepEqual(room.royalLastMove.capturedTokens,[{playerId:"b",tokenIndex:0,fromProgress:40,toProgress:-1}]);
});
test("Royal Race goes directly from the final track square to the crown",()=>{
	const room={players:[{id:"a",name:"A",royalColor:"gold",royalKicked:false},{id:"b",name:"B",royalColor:"blue",royalKicked:false}],phase:"royal",royalOrder:["a","b"],royalTurn:0,royalLegal:[0],royalDice:1,royalTokens:{a:[51,-1,-1,-1],b:[-1,-1,-1,-1]},royalPlacements:[],royalMoveSeq:0};
	assert.deepEqual(__test.royalLegal(room,"a",1),[0]);
	assert.deepEqual(__test.royalLegal(room,"a",2),[]);
	assert.equal(__test.royalMove(room,"a",0),true);
	assert.equal(room.royalTokens.a[0],52);
	assert.equal(room.royalLastMove.reachedHome,true);
});
function leaveRoom(phase="lobby"){
	const players=[{id:"a",name:"A",host:true,score:0,eliminated:false,royalKicked:false},{id:"b",name:"B",host:false,score:0,eliminated:false,royalKicked:false},{id:"c",name:"C",host:false,score:0,eliminated:false,royalKicked:false}];
	return {code:"TEST",phase,hostId:"a",players,turn:0,timerSeconds:15,deadline:1,winnerId:null,guessed:new Set(),drawOrder:["a","b","c"],drawTurn:2,drawTotal:3,drawerId:"b",drawWord:"crown",strokes:[],lastGuesses:[],royalOrder:["a","b","c"],royalTurn:1,royalDice:null,royalLegal:[],royalTokens:{a:[-1,-1,-1,-1],b:[-1,-1,-1,-1],c:[-1,-1,-1,-1]},royalPlacements:[]};
}
test("leaving the lobby removes the player and transfers host",()=>{const room=leaveRoom();assert.equal(__test.removePlayer(room,"a"),true);assert.deepEqual(room.players.map(p=>p.id),["b","c"]);assert.equal(room.hostId,"b");assert.equal(room.players[0].host,true)});
test("a departing Draw & Guess artist is removed and the next artist starts",()=>{const room=leaveRoom("draw");__test.removePlayer(room,"b");assert.deepEqual(room.players.map(p=>p.id),["a","c"]);assert.equal(room.drawerId,"c");assert.equal(room.drawTurn,2)});
test("a departing Royal Race player is removed without skipping the next turn",()=>{const room=leaveRoom("royal");__test.removePlayer(room,"b");assert.deepEqual(room.royalOrder,["a","c"]);assert.equal(room.royalOrder[room.royalTurn],"c");assert.equal(room.royalTokens.b,undefined)});
test("automatic drawing assist reduces stroke wobble while preserving endpoints",()=>{const input=[[0,0],[.25,.28],[.5,.47],[.75,.78],[1,1]],output=__test.smoothStrokePoints(input);assert.deepEqual(output[0],[0,0]);assert.deepEqual(output.at(-1),[1,1]);assert.ok(Math.abs(output[1][1]-.25)<Math.abs(input[1][1]-.25));assert.equal(output.length,input.length)});
test("room chat strips markup and limits message length",()=>{assert.equal(__test.cleanChat("  <b>Hello</b>   room  "),"Hello room");assert.equal(__test.cleanChat("x".repeat(300)).length,180)});
test("room chat confirms retries without duplicating a message",()=>{const room={chat:[],chatSeq:0},player={id:"a",name:"A"};const first=__test.addChatMessage(room,player,"Hello","message-1"),retry=__test.addChatMessage(room,player,"Hello","message-1");assert.equal(first.id,retry.id);assert.equal(room.chat.length,1)});
test("completed games compile normalized XP into the Champions Board",()=>{const players=[{id:"a",name:"A",score:900,totalXp:0,wins:0,gamesPlayed:0,gameStats:__test.freshStats()},{id:"b",name:"B",score:300,totalXp:0,wins:0,gamesPlayed:0,gameStats:__test.freshStats()}],room={phase:"finished",game:"draw",mode:"ffa",winnerId:"a",players,royalPlacements:[],resultsRecorded:false};__test.recordResults(room);assert.equal(players[0].wins,1);assert.ok(players[0].totalXp>players[1].totalXp);assert.equal(__test.leaderboard(room)[0].id,"a");assert.equal(room.resultsRecorded,true)});
function dealRoom(){const players=[{id:"a",name:"A",score:0,dealStatus:"playing",dealPayout:0,totalXp:0,wins:0,gamesPlayed:0,gameStats:__test.freshStats()},{id:"b",name:"B",score:0,dealStatus:"playing",dealPayout:0,totalXp:0,wins:0,gamesPlayed:0,gameStats:__test.freshStats()}];return {code:"DEAL",game:"deal",mode:"ffa",phase:"deal-pick",players,dealCases:Array.from({length:26},(_,i)=>({number:i+1,value:i+1,opened:false,ownerId:null})),dealOrder:["a","b"],dealTurn:0,dealOpenRemaining:0,dealPersonal:{},dealOffers:{},dealChoices:{},dealRound:0,dealTurnsInCycle:0,dealBankerStage:"idle",dealFinalBank:false,royalPlacements:[],resultsRecorded:false,deadline:0,message:""}}
test("Deal or No Deal locks one personal case per player then starts opening",()=>{const room=dealRoom();assert.equal(__test.selectDealCase(room,"a",10),true);assert.equal(room.dealCases[9].ownerId,"a");assert.equal(room.dealTurn,1);assert.equal(__test.selectDealCase(room,"b",20),true);assert.equal(room.phase,"deal-open");assert.equal(room.dealOpenRemaining,2);assert.equal(room.dealOrder[room.dealTurn],"a")});
test("Deal or No Deal rotates after two opened cases",()=>{const room=dealRoom();__test.selectDealCase(room,"a",10);__test.selectDealCase(room,"b",20);assert.equal(__test.openDealCase(room,1),true);assert.equal(room.dealOpenRemaining,1);assert.equal(__test.openDealCase(room,2),true);assert.equal(room.dealOrder[room.dealTurn],"b");assert.equal(room.dealOpenRemaining,2)});
test("Deal or No Deal final reveal pays deals or personal case values",()=>{const room=dealRoom();room.phase="deal-open";room.dealCases[9].ownerId="a";room.dealPersonal.a=10;room.dealCases[19].ownerId="b";room.dealPersonal.b=20;room.players[1].dealStatus="dealt";room.players[1].dealPayout=500;room.dealCases[9].value=250000;__test.finishDealGame(room);assert.equal(room.phase,"finished");assert.equal(room.players[0].score,250000);assert.equal(room.players[1].score,500);assert.equal(room.winnerId,"a")});
