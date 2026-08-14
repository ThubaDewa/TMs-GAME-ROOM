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
  $("restart").classList.toggle("hidden",session.playerId!==room.hostId || room.phase!=="finished"); $("game-stage").classList.toggle("hidden",room.phase!=="playing"); $("winner").classList.toggle("hidden",room.phase!=="finished");
  $("share-hint").classList.toggle("hidden",room.phase!=="lobby");
  if(room.phase==="playing") { $("current-word").textContent=room.currentWord; $("round").textContent=room.round; $("rule-hint").innerHTML=`Your word must begin with <b>${room.currentWord.at(-1)}</b>`; const mine=room.currentPlayerId===session.playerId; $("word").disabled=!mine; $("word").placeholder=mine?`WORD BEGINNING WITH ${room.currentWord.at(-1)}`:"WAIT FOR YOUR TURN"; if(mine) setTimeout(()=>$("word").focus(),50); }
  if(room.phase==="finished") $("winner-name").textContent=room.players.find(p=>p.id===room.winnerId)?.name || "NO WINNER";
  $("players").innerHTML="";
  room.players.forEach((p,i)=>{ const row=document.createElement("div"); row.className=`player ${p.id===room.currentPlayerId?"turn":""} ${p.eliminated?"out":""}`; const strikes=[0,1,2].map(n=>`<span class="${n<p.strikes?"on":""}">✕</span>`).join(""); row.innerHTML=`<div class="avatar">${p.name[0].toUpperCase()}</div><div class="player-name">${escapeHtml(p.name)} ${p.id===session.playerId?"(YOU)":""}<small>${p.host?"HOST":p.eliminated?"ELIMINATED":p.id===room.currentPlayerId?"PLAYING NOW":"READY"}</small></div><div class="strikes">${strikes}</div>`; if(session.playerId===room.hostId&&!p.host&&room.phase==="lobby"){const b=document.createElement("button");b.className="kick";b.textContent="REMOVE";b.onclick=()=>post("remove",{targetId:p.id}).catch(e=>error("room-error",e.message));row.appendChild(b);} $("players").appendChild(row); });
  clearInterval(tick); if(room.phase==="playing") tick=setInterval(updateTimer,100);
}
function updateTimer(){ if(!state)return; const left=Math.max(0,state.deadline-Date.now()); const sec=Math.ceil(left/1000),pct=left/15000*100; $("timer").style.setProperty("--progress",`${pct}%`); $("timer").classList.toggle("urgent",sec<=3); $("timer").querySelector("span").textContent=sec; }
function escapeHtml(s){return s.replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
$("create").onclick=async()=>{try{error("home-error");session=await post("create",{name:$("name").value});localStorage.setItem("tmgr-session",JSON.stringify(session));connect();}catch(e){error("home-error",e.message)}};
$("join").onclick=async()=>{try{error("home-error");session=await post("join",{name:$("name").value,code:$("code").value.toUpperCase()});localStorage.setItem("tmgr-session",JSON.stringify(session));connect();}catch(e){error("home-error",e.message)}};
$("start").onclick=()=>post("start").catch(e=>error("room-error",e.message)); $("restart").onclick=()=>post("restart").catch(e=>error("room-error",e.message));
$("word-form").onsubmit=async e=>{e.preventDefault();const word=$("word").value;$("word").value="";try{await post("submit",{word})}catch(x){error("room-error",x.message)}};
$("copy-code").onclick=async()=>{await navigator.clipboard?.writeText(session.code);$("message").textContent="Room code copied!"};
$("leave").onclick=()=>{source?.close();localStorage.removeItem("tmgr-session");session=null;location.reload()};
$("code").oninput=e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"");
if(session?.code) connect();
