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
function leaveRoom(phase="lobby"){
	const players=[{id:"a",name:"A",host:true,score:0,eliminated:false,royalKicked:false},{id:"b",name:"B",host:false,score:0,eliminated:false,royalKicked:false},{id:"c",name:"C",host:false,score:0,eliminated:false,royalKicked:false}];
	return {code:"TEST",phase,hostId:"a",players,turn:0,timerSeconds:15,deadline:1,winnerId:null,guessed:new Set(),drawOrder:["a","b","c"],drawTurn:2,drawTotal:3,drawerId:"b",drawWord:"crown",strokes:[],lastGuesses:[],royalOrder:["a","b","c"],royalTurn:1,royalDice:null,royalLegal:[],royalTokens:{a:[-1,-1,-1,-1],b:[-1,-1,-1,-1],c:[-1,-1,-1,-1]},royalPlacements:[]};
}
test("leaving the lobby removes the player and transfers host",()=>{const room=leaveRoom();assert.equal(__test.removePlayer(room,"a"),true);assert.deepEqual(room.players.map(p=>p.id),["b","c"]);assert.equal(room.hostId,"b");assert.equal(room.players[0].host,true)});
test("a departing Draw & Guess artist is removed and the next artist starts",()=>{const room=leaveRoom("draw");__test.removePlayer(room,"b");assert.deepEqual(room.players.map(p=>p.id),["a","c"]);assert.equal(room.drawerId,"c");assert.equal(room.drawTurn,2)});
test("a departing Royal Race player is removed without skipping the next turn",()=>{const room=leaveRoom("royal");__test.removePlayer(room,"b");assert.deepEqual(room.royalOrder,["a","c"]);assert.equal(room.royalOrder[room.royalTurn],"c");assert.equal(room.royalTokens.b,undefined)});
test("automatic drawing assist reduces stroke wobble while preserving endpoints",()=>{const input=[[0,0],[.25,.28],[.5,.47],[.75,.78],[1,1]],output=__test.smoothStrokePoints(input);assert.deepEqual(output[0],[0,0]);assert.deepEqual(output.at(-1),[1,1]);assert.ok(Math.abs(output[1][1]-.25)<Math.abs(input[1][1]-.25));assert.equal(output.length,input.length)});
