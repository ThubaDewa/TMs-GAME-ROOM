"use strict";
const assert=require("node:assert/strict");
const {__test:{ROYAL_COLORS,ROYAL_OFFSETS,ROYAL_SAFE,ROYAL_HOME}}=require("../server");

function randomFactory(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}}
function track(color,progress){return progress>=0&&progress<ROYAL_HOME?(ROYAL_OFFSETS[color]+progress)%52:null}
function simulate(playerCount,games=240){
	const random=randomFactory(0x544d0000+playerCount),wins=Array(playerCount).fill(0),turnTotals=[];
	for(let game=0;game<games;game++){
		const players=Array.from({length:playerCount},(_,index)=>({color:ROYAL_COLORS[index],tokens:[-1,-1,-1,-1],done:false}));
		let active=game%playerCount,turns=0,winner=-1;
		while(winner<0&&turns<12000){
			turns++;const player=players[active],dice=1+Math.floor(random()*6),legal=player.tokens.map((position,index)=>({position,index})).filter(token=>token.position<ROYAL_HOME&&((token.position===-1&&dice===6)||(token.position>=0&&token.position+dice<=ROYAL_HOME)));
			let bonus=dice===6;
			if(legal.length){const choice=legal[Math.floor(random()*legal.length)],old=choice.position,next=old===-1?0:old+dice;player.tokens[choice.index]=next;const square=track(player.color,next);if(square!==null&&!ROYAL_SAFE.has(square))for(let opponent=0;opponent<players.length;opponent++)if(opponent!==active)players[opponent].tokens=players[opponent].tokens.map(position=>track(players[opponent].color,position)===square?(bonus=true,-1):position);if(next===ROYAL_HOME)bonus=true;if(player.tokens.every(position=>position===ROYAL_HOME))winner=active}
			if(!bonus)active=(active+1)%playerCount;
		}
		assert.notEqual(winner,-1,`${playerCount}-player simulation did not finish`);wins[winner]++;turnTotals.push(turns);
	}
	const expected=games/playerCount,spread=(Math.max(...wins)-Math.min(...wins))/expected,average=Math.round(turnTotals.reduce((a,b)=>a+b,0)/games);
	assert.ok(spread<.55,`${playerCount}-player win spread was ${(spread*100).toFixed(1)}%`);
	return {playerCount,games,wins,averageTurns:average,winSpread:`${(spread*100).toFixed(1)}%`};
}

for(const count of [2,3,4])console.log(JSON.stringify(simulate(count)));
console.log("PASS: Royal Race completed 720 deterministic balance simulations.");
