"use strict";

const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const {promisify}=require("node:util");
const scrypt=promisify(crypto.scrypt);

let pool=null;
let enabled=false;
const pendingRooms=new Map();
const saveTimers=new Map();
const pendingWrites=new Set();
const SAVE_DEBOUNCE_MS=200;
const GAMES=["wordlink","survey","draw","royal","deal"];

function accountError(message,status=400){const error=new Error(message);error.status=status;return error}
function cleanUsername(value){return String(value||"").trim().replace(/\s+/g," ").slice(0,20)}
function usernameKey(value){return cleanUsername(value).toLowerCase()}
function validateAccountInput(username,password){const name=cleanUsername(username);if(name.length<3)return "Username must contain at least 3 characters.";if(!/^[A-Za-z0-9_ ]+$/.test(name))return "Use only letters, numbers, spaces or underscores in the username.";if(String(password||"").length<6)return "Passcode must contain at least 6 characters.";if(String(password||"").length>72)return "Passcode is too long.";return ""}
async function passwordDigest(password,salt){return (await scrypt(String(password),salt,64)).toString("hex")}
const tokenDigest=token=>crypto.createHash("sha256").update(String(token||"")).digest("hex");
const createId=()=>crypto.randomBytes(16).toString("hex");
function trackWrite(promise){pendingWrites.add(promise);promise.finally(()=>pendingWrites.delete(promise));return promise}

function serializeRoom(room){
	return JSON.stringify({...room,used:[...(room.used||[])],found:[...(room.found||[])],guessed:[...(room.guessed||[])],voiceSignals:[]});
}

function deserializeRoom(value,{now=Date.now(),reconnectGraceMs=45000}={}){
	const room=typeof value==="string"?JSON.parse(value):structuredClone(value);
	room.used=new Set(room.used||[]);
	room.found=new Set(room.found||[]);
	room.guessed=new Set(room.guessed||[]);
	room.voiceSignals=[];
	room.voiceSignalSeq=Number(room.voiceSignalSeq)||0;
	room.players=(room.players||[]).map(player=>({...player,connected:false,connectedAt:0,disconnectedAt:now,reconnectDeadline:now+reconnectGraceMs,connectionStatus:"reconnecting",lastPresenceAt:0,latencyMs:0,voiceOn:false,voiceSignalAck:0}));
	room.spectators=(room.spectators||[]).map(player=>({...player,spectator:true,connected:false,connectedAt:0,disconnectedAt:now,reconnectDeadline:now+reconnectGraceMs,connectionStatus:"reconnecting",lastPresenceAt:0,latencyMs:0,voiceOn:false,voiceSignalAck:0}));
	return room;
}

async function initialize(){
	if(!process.env.DATABASE_URL)return {enabled:false,reason:"DATABASE_URL is not configured"};
	const {Pool}=require("pg");
	pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="false"?false:{rejectUnauthorized:false},max:Number(process.env.DATABASE_POOL_SIZE)||5,idleTimeoutMillis:30000,connectionTimeoutMillis:10000});
	const migration=fs.readFileSync(path.join(__dirname,"db","migrations","001_room_state.sql"),"utf8");
	const accountsMigration=fs.readFileSync(path.join(__dirname,"db","migrations","002_accounts.sql"),"utf8");
	await pool.query(migration);await pool.query(accountsMigration);
	await pool.query("DELETE FROM tm_game_rooms WHERE expires_at <= NOW()");
	enabled=true;
	return {enabled:true};
}

async function loadRooms(options={}){
	if(!enabled)return [];
	const result=await pool.query("SELECT state FROM tm_game_rooms WHERE expires_at > NOW() ORDER BY updated_at");
	return result.rows.map(row=>deserializeRoom(row.state,options));
}

async function saveSerializedRoom(code,serialized){
	if(!enabled)return false;
	const state=JSON.parse(serialized);
	await pool.query("INSERT INTO tm_game_rooms (code,phase,state,updated_at,expires_at) VALUES ($1,$2,$3::jsonb,NOW(),NOW()+INTERVAL '24 hours') ON CONFLICT (code) DO UPDATE SET phase=EXCLUDED.phase,state=EXCLUDED.state,updated_at=NOW(),expires_at=NOW()+INTERVAL '24 hours'",[code,state.phase,serialized]);
	return true;
}

async function accountProfile(accountId){
	if(!enabled)return null;
	const result=await pool.query("SELECT id,username,coin_balance,total_xp,wins,games_played,last_daily_claim,cosmetics,achievements,created_at,(SELECT COUNT(*)+1 FROM tm_accounts ranked WHERE ranked.total_xp>a.total_xp OR (ranked.total_xp=a.total_xp AND ranked.wins>a.wins))::int AS leaderboard_position FROM tm_accounts a WHERE id=$1",[accountId]);
	if(!result.rows[0])return null;
	const stats=await pool.query("SELECT game,games,wins,xp FROM tm_account_game_stats WHERE account_id=$1",[accountId]),gameStats=Object.fromEntries(GAMES.map(game=>[game,{games:0,wins:0,xp:0}]));
	for(const row of stats.rows)gameStats[row.game]={games:Number(row.games),wins:Number(row.wins),xp:Number(row.xp)};
	const row=result.rows[0];return {id:row.id,username:row.username,coinBalance:Number(row.coin_balance),totalXp:Number(row.total_xp),wins:Number(row.wins),gamesPlayed:Number(row.games_played),level:Math.max(1,Math.floor(Number(row.total_xp)/1000)+1),leaderboardPosition:Number(row.leaderboard_position),lastDailyClaim:row.last_daily_claim,cosmetics:row.cosmetics||{},achievements:row.achievements||{},gameStats};
}

async function registerAccount(username,password){
	if(!enabled)throw accountError("Permanent accounts require DATABASE_URL to be configured.",503);
	const validation=validateAccountInput(username,password);if(validation)throw accountError(validation);
	const name=cleanUsername(username),salt=crypto.randomBytes(16).toString("hex"),passwordHash=await passwordDigest(password,salt),token=crypto.randomBytes(32).toString("hex"),accountId=createId();
	try{await pool.query("INSERT INTO tm_accounts (id,username,username_key,password_salt,password_hash,session_hash) VALUES ($1,$2,$3,$4,$5,$6)",[accountId,name,usernameKey(name),salt,passwordHash,tokenDigest(token)])}catch(error){if(error.code==="23505")throw accountError("That username is already registered.",409);throw error}
	return {token,profile:await accountProfile(accountId)};
}

async function loginAccount(username,password){
	if(!enabled)throw accountError("Permanent accounts require DATABASE_URL to be configured.",503);
	const result=await pool.query("SELECT id,password_salt,password_hash FROM tm_accounts WHERE username_key=$1",[usernameKey(username)]),account=result.rows[0];
	if(!account)throw accountError("Username or passcode is incorrect.",401);
	const actual=Buffer.from(await passwordDigest(password,account.password_salt),"hex"),expected=Buffer.from(account.password_hash,"hex");
	if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))throw accountError("Username or passcode is incorrect.",401);
	const token=crypto.randomBytes(32).toString("hex");await pool.query("UPDATE tm_accounts SET session_hash=$1,updated_at=NOW() WHERE id=$2",[tokenDigest(token),account.id]);return {token,profile:await accountProfile(account.id)};
}

async function authenticateAccount(token){
	if(!enabled||!token)return null;
	const result=await pool.query("SELECT id FROM tm_accounts WHERE session_hash=$1",[tokenDigest(token)]);return result.rows[0]?accountProfile(result.rows[0].id):null;
}

async function claimDailyReward(accountId){
	if(!enabled)throw accountError("Permanent accounts are unavailable.",503);
	const result=await pool.query("UPDATE tm_accounts SET coin_balance=coin_balance+25,last_daily_claim=CURRENT_DATE,updated_at=NOW() WHERE id=$1 AND (last_daily_claim IS NULL OR last_daily_claim<CURRENT_DATE) RETURNING id",[accountId]);
	return {claimed:Boolean(result.rows[0]),reward:result.rows[0]?25:0,profile:await accountProfile(accountId)};
}

async function accountHistory(accountId){
	if(!enabled)return [];
	const result=await pool.query("SELECT game,mode,score,rank,xp,coins,is_winner,played_at FROM tm_match_history WHERE account_id=$1 ORDER BY played_at DESC LIMIT 20",[accountId]);return result.rows.map(row=>({game:row.game,mode:row.mode,score:Number(row.score),rank:row.rank,xp:row.xp,coins:row.coins,isWinner:row.is_winner,playedAt:row.played_at}));
}

async function globalLeaderboard(){
	if(!enabled)return [];
	const result=await pool.query("SELECT id,username,total_xp,wins,games_played,coin_balance FROM tm_accounts ORDER BY total_xp DESC,wins DESC,username LIMIT 50");return result.rows.map((row,index)=>({id:row.id,name:row.username,xp:Number(row.total_xp),wins:row.wins,games:row.games_played,coins:Number(row.coin_balance),level:Math.max(1,Math.floor(Number(row.total_xp)/1000)+1),rank:index+1}));
}

async function writeGameResults(room,results){
	if(!enabled)return false;
	const client=await pool.connect();
	try{await client.query("BEGIN");for(const result of results){const player=room.players.find(item=>item.id===result.playerId);if(!player?.accountId)continue;const inserted=await client.query("INSERT INTO tm_match_history (match_id,room_code,account_id,game,mode,score,rank,xp,coins,is_winner) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (match_id,account_id) DO NOTHING RETURNING id",[room.matchId||`${room.code}-${room.createdAt}`,room.code,player.accountId,room.game,room.mode,result.score,result.rank,result.xp,result.coins||0,result.isWinner]);if(!inserted.rows[0])continue;await client.query("UPDATE tm_accounts SET total_xp=total_xp+$1,wins=wins+$2,games_played=games_played+1,coin_balance=coin_balance+$3,achievements=achievements || CASE WHEN wins+$2>=1 THEN '{\"first_win\":true}'::jsonb ELSE '{}'::jsonb END || CASE WHEN games_played+1>=10 THEN '{\"ten_games\":true}'::jsonb ELSE '{}'::jsonb END,updated_at=NOW() WHERE id=$4",[result.xp,result.isWinner?1:0,result.coins||0,player.accountId]);await client.query("INSERT INTO tm_account_game_stats (account_id,game,games,wins,xp) VALUES ($1,$2,1,$3,$4) ON CONFLICT (account_id,game) DO UPDATE SET games=tm_account_game_stats.games+1,wins=tm_account_game_stats.wins+EXCLUDED.wins,xp=tm_account_game_stats.xp+EXCLUDED.xp",[player.accountId,room.game,result.isWinner?1:0,result.xp])}await client.query("COMMIT");return true}catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
}
function recordGameResults(room,results){return trackWrite(writeGameResults(room,results).catch(error=>{console.error("Account result persistence failed:",error.message);return false}))}

async function flushRoom(code){
	clearTimeout(saveTimers.get(code));saveTimers.delete(code);
	const serialized=pendingRooms.get(code);pendingRooms.delete(code);
	if(!serialized)return false;
	try{return await saveSerializedRoom(code,serialized)}catch(error){console.error(`Room persistence failed for ${code}:`,error.message);return false}
}

function scheduleRoomSave(room){
	if(!enabled||!room?.code)return;
	pendingRooms.set(room.code,serializeRoom(room));
	clearTimeout(saveTimers.get(room.code));
	const timer=setTimeout(()=>flushRoom(room.code),SAVE_DEBOUNCE_MS);timer.unref?.();saveTimers.set(room.code,timer);
}

async function deleteRoom(code){
	clearTimeout(saveTimers.get(code));saveTimers.delete(code);pendingRooms.delete(code);
	if(!enabled)return false;
	await pool.query("DELETE FROM tm_game_rooms WHERE code=$1",[code]);return true;
}

async function flushAll(){await Promise.all([...pendingRooms.keys()].map(flushRoom));await Promise.all([...pendingWrites])}
async function close(){await flushAll();if(pool)await pool.end();pool=null;enabled=false}
function isEnabled(){return enabled}

module.exports={serializeRoom,deserializeRoom,initialize,loadRooms,scheduleRoomSave,deleteRoom,flushAll,close,isEnabled,cleanUsername,validateAccountInput,passwordDigest,registerAccount,loginAccount,authenticateAccount,claimDailyReward,accountHistory,globalLeaderboard,recordGameResults};
