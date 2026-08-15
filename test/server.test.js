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
