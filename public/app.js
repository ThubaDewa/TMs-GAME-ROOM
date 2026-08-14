const $ = id => document.getElementById(id);
let session = JSON.parse(localStorage.getItem("tmgr-session") || "null");
let source, state, tick;
const show = id => { document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active")); $(id).classList.add("active"); };
const error = (where, message="") => $(where).textContent = message;
async function post(route, extra={}) {
  const response = await fetch(`/api/${route}`, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...session,...extra})});
  const data = await response.json(); if (!response.ok) throw new Error(data.error || "Something went wrong."); return data;
}
function connect() {
  source?.close(); show("room"); $("copy-code").textContent=session.code;
  source = new EventSource(`/events?code=${session.code}`);
  source.onmessage = e => render(JSON.parse(e.data));
  source.onerror = () => error("room-error","Connection interrupted—trying again…");
}
function render(room) {
  state=room; error("room-error"); $("copy-code").textContent=room.code; $("player-count").textContent=`${room.players.length}/8`; $("message").textContent=room.message;
  $("status-pill").textContent=room.phase.toUpperCase(); $("start").classList.toggle("hidden", session.playerId!==room.hostId || room.phase!=="lobby");
  $("restart").classList.toggle("hidden",session.playerId!==room.hostId || room.phase!=="finished"); $("game-stage").classList.toggle("hidden",room.phase!=="playing"); $("survey-stage").classList.toggle("hidden",!["survey","survey-break"].includes(room.phase)); $("survey-form").classList.toggle("hidden",room.phase!=="survey"); $("winner").classList.toggle("hidden",room.phase!=="finished");
  $("share-hint").classList.toggle("hidden",room.phase!=="lobby"); $("game-picker").classList.toggle("hidden",room.phase!=="lobby" || session.playerId!==room.hostId); $("mode-picker").classList.toggle("hidden",room.game!=="survey"); $("team-picker").classList.toggle("hidden",room.phase!=="lobby" || room.game!=="survey" || room.mode!=="teams"); $("next-survey").classList.toggle("hidden",room.phase!=="survey-break" || session.playerId!==room.hostId);
  document.querySelectorAll("[data-game]").forEach(b=>b.classList.toggle("selected",b.dataset.game===room.game)); document.querySelectorAll("[data-mode]").forEach(b=>b.classList.toggle("selected",b.dataset.mode===room.mode));
  if(room.phase==="playing") { $("current-word").textContent=room.currentWord; $("round").textContent=room.round; $("rule-hint").innerHTML=`Your word must begin with <b>${room.currentWord.at(-1)}</b>`; const mine=room.currentPlayerId===session.playerId; $("word").disabled=!mine; $("word").placeholder=mine?`WORD BEGINNING WITH ${room.currentWord.at(-1)}`:"WAIT FOR YOUR TURN"; if(mine) setTimeout(()=>$("word").focus(),50); }
  if(["survey","survey-break"].includes(room.phase)) { $("survey-question").textContent=room.survey.question; $("survey-round").textContent=`${room.survey.index}/${room.survey.total}`; $("survey-board").innerHTML=room.survey.answers.map((a,i)=>`<div class="survey-answer ${a.text?"":"hidden-answer"}"><div class="number">${i+1}</div><div class="text">${escapeHtml(a.text)}</div><div class="points">${a.points||""}</div></div>`).join(""); }
  if(room.phase==="finished") $("winner-name").textContent=room.game==="survey"&&room.mode==="teams"?(room.winnerTeam==="tie"?"TEAM TIE":`${room.winnerTeam.toUpperCase()} TEAM`):(room.players.find(p=>p.id===room.winnerId)?.name || "NO WINNER");
  $("players").innerHTML="";
  room.players.forEach(p=>{ const row=document.createElement("div"); row.className=`player ${p.id===room.currentPlayerId?"turn":""} ${p.eliminated?"out":""}`; const strikes=[0,1,2].map(n=>`<span class="${n<p.strikes?"on":""}">✕</span>`).join(""); const right=room.game==="survey"?`<div class="score">${p.score} PTS</div>`:`<div class="strikes">${strikes}</div>`; row.innerHTML=`<div class="avatar">${p.name[0].toUpperCase()}</div><div class="player-name">${escapeHtml(p.name)} ${p.id===session.playerId?"(YOU)":""}<small>${p.host?"HOST":room.mode==="teams"?`${p.team.toUpperCase()} TEAM`:p.eliminated?"ELIMINATED":p.id===room.currentPlayerId?"PLAYING NOW":"READY"}</small></div>${right}`; if(session.playerId===room.hostId&&!p.host&&room.phase==="lobby"){const b=document.createElement("button");b.className="kick";b.textContent="REMOVE";b.onclick=()=>post("remove",{targetId:p.id}).catch(e=>error("room-error",e.message));row.appendChild(b);} $("players").appendChild(row); });
  const me=room.players.find(p=>p.id===session.playerId);document.querySelectorAll("[data-team]").forEach(b=>b.classList.toggle("selected",b.dataset.team===me?.team));
  clearInterval(tick); if(room.phase==="playing"||room.phase==="survey") tick=setInterval(updateTimer,100);
}
function updateTimer(){ if(!state)return; const left=Math.max(0,state.deadline-Date.now()),isSurvey=state.phase==="survey"; const sec=Math.ceil(left/1000),pct=left/(isSurvey?30000:15000)*100,timer=$(isSurvey?"survey-timer":"timer"); timer.style.setProperty("--progress",`${pct}%`); timer.classList.toggle("urgent",sec<=3); timer.querySelector("span").textContent=sec; }
function escapeHtml(s){return s.replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
$("create").onclick=async()=>{try{error("home-error");session=await post("create",{name:$("name").value});localStorage.setItem("tmgr-session",JSON.stringify(session));connect();}catch(e){error("home-error",e.message)}};
$("join").onclick=async()=>{try{error("home-error");session=await post("join",{name:$("name").value,code:$("code").value.toUpperCase()});localStorage.setItem("tmgr-session",JSON.stringify(session));connect();}catch(e){error("home-error",e.message)}};
$("start").onclick=()=>post("start").catch(e=>error("room-error",e.message)); $("restart").onclick=()=>post("restart").catch(e=>error("room-error",e.message));
document.querySelectorAll("[data-game]").forEach(b=>b.onclick=()=>post("configure",{game:b.dataset.game}).catch(e=>error("room-error",e.message))); document.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>post("configure",{mode:b.dataset.mode}).catch(e=>error("room-error",e.message))); document.querySelectorAll("[data-team]").forEach(b=>b.onclick=()=>post("team",{team:b.dataset.team}).catch(e=>error("room-error",e.message)));
$("word-form").onsubmit=async e=>{e.preventDefault();const word=$("word").value;$("word").value="";try{await post("submit",{word})}catch(x){error("room-error",x.message)}};
$("survey-form").onsubmit=async e=>{e.preventDefault();const answer=$("survey-answer").value;$("survey-answer").value="";try{await post("survey-answer",{answer})}catch(x){error("room-error",x.message)}}; $("next-survey").onclick=()=>post("next-survey").catch(e=>error("room-error",e.message));
$("copy-code").onclick=async()=>{await navigator.clipboard?.writeText(session.code);$("message").textContent="Room code copied!"};
$("leave").onclick=()=>{source?.close();localStorage.removeItem("tmgr-session");session=null;location.reload()};
$("code").oninput=e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"");
if(session?.code) connect();
