"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {serializeRoom,deserializeRoom,isEnabled,scheduleRoomSave,cleanUsername,validateAccountInput,passwordDigest}=require("../persistence");

function persistedRoom(){
	return {
		code:"SAVE42",phase:"royal",hostId:"a",game:"royal",deadline:987654,
		players:[{id:"a",token:"secret",name:"A",connected:true,voiceOn:true,score:73,totalXp:900}],
		used:new Set(["LIGHT","TIGER"]),found:new Set([1,3]),guessed:new Set(["b"]),
		royalTokens:{a:[12,4,-1,-1]},dealPersonal:{a:17},strokes:[{color:"#14213d",size:7,points:[[.1,.2],[.3,.4]]}],
		voiceSignals:[{id:9,from:"a",to:"b",type:"offer",payload:{}}],voiceSignalSeq:9
	};
}

test("room persistence preserves authoritative game state and restores Set fields",()=>{
	const source=persistedRoom(),serialized=serializeRoom(source),restored=deserializeRoom(serialized,{now:1000,reconnectGraceMs:45000});
	assert.deepEqual([...restored.used],["LIGHT","TIGER"]);
	assert.deepEqual([...restored.found],[1,3]);
	assert.deepEqual([...restored.guessed],["b"]);
	assert.deepEqual(restored.royalTokens.a,[12,4,-1,-1]);
	assert.equal(restored.dealPersonal.a,17);
	assert.deepEqual(restored.strokes,source.strokes);
	assert.equal(restored.players[0].score,73);
	assert.equal(restored.players[0].totalXp,900);
	assert.equal(restored.players[0].token,"secret");
});

test("restored players enter the reconnect grace period without stale voice sessions",()=>{
	const restored=deserializeRoom(serializeRoom(persistedRoom()),{now:2000,reconnectGraceMs:45000});
	assert.equal(restored.players[0].connected,false);
	assert.equal(restored.players[0].reconnectDeadline,47000);
	assert.equal(restored.players[0].voiceOn,false);
	assert.deepEqual(restored.voiceSignals,[]);
});

test("persistence remains an explicit no-op until DATABASE_URL is configured",()=>{
	assert.equal(isEnabled(),false);
	assert.doesNotThrow(()=>scheduleRoomSave(persistedRoom()));
});
test("account usernames and passcodes are validated before database access",()=>{assert.equal(cleanUsername("  Tee   M  "),"Tee M");assert.match(validateAccountInput("TM","secret1"),/3 characters/);assert.match(validateAccountInput("Tee!","secret1"),/letters/);assert.match(validateAccountInput("Tee M","123"),/6 characters/);assert.equal(validateAccountInput("Tee M","secret1"),"")});
test("account passcodes use salted deterministic scrypt digests",async()=>{const first=await passwordDigest("secret1","salt-a"),same=await passwordDigest("secret1","salt-a"),different=await passwordDigest("secret1","salt-b");assert.equal(first,same);assert.notEqual(first,different);assert.equal(first.length,128)});
