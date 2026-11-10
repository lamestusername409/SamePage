import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, collection, setDoc, addDoc, deleteDoc, onSnapshot, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { READERS, SPICY, MILD } from "./config.js?v=2";

const firebaseConfig = {
  apiKey: "AIzaSyD7nll8bl4fY6A0EquPryurWx02skWqNIM",
  authDomain: "same-page-a-book-club-app.firebaseapp.com",
  projectId: "same-page-a-book-club-app",
  storageBucket: "same-page-a-book-club-app.firebasestorage.app",
  messagingSenderId: "625225310966",
  appId: "1:625225310966:web:9403b85bdda335c7d482d7"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const SLOTS = { andrea:{name:"Andrea",cls:"andrea"}, allie:{name:"Alli",cls:"allie"} };
let me=null, her=null;
let state = { book:null, progress:{andrea:0,allie:0}, updated:{}, comments:[] };
let draftPct=0, lockAt=0, currentQ=null;
let unsubs=[];
const $ = id => document.getElementById(id);

function toast(t){ const el=$("toast"); el.textContent=t; el.classList.add("show"); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove("show"),2200); }
function show(id){ for(const s of ["signin","notyou","loading","app"]) $(s).hidden = s!==id; }
function esc(s){ return String(s).replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch])); }
function when(iso){
  try{ const d=new Date(iso); if(isNaN(d)) return ""; const now=new Date();
    const diff=(now-d)/60000; if(diff<1) return "Just now"; if(diff<60) return Math.round(diff)+" min ago";
    const t=d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
    const sameDay=d.toDateString()===now.toDateString(); const y=new Date(now); y.setDate(now.getDate()-1);
    if(sameDay) return "Today, "+t; if(d.toDateString()===y.toDateString()) return "Yesterday, "+t;
    return d.toLocaleDateString(undefined,{month:"short",day:"numeric"})+", "+t; }catch(e){ return ""; }
}
function lsGet(k){ try{return localStorage.getItem(k)}catch(e){return null} }
function lsSet(k,v){ try{localStorage.setItem(k,v)}catch(e){} }

/* ---------- auth ---------- */
const provider = new GoogleAuthProvider();
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const authErr = e => ({
  "auth/unauthorized-domain":"This address isn't authorized in Firebase yet. Add lamestusername409.github.io under Authentication → Settings → Authorized domains.",
  "auth/popup-blocked":"The sign-in window was blocked. Try again, or use email and password below.",
  "auth/popup-closed-by-user":"The sign-in window was closed before finishing.",
  "auth/cancelled-popup-request":"",
  "auth/network-request-failed":"No connection — check Wi-Fi and try again.",
}[e.code] ?? ("Google sign-in didn't work ("+(e.code||e.message)+"). Email and password below always works."));
$("googleBtn").onclick = async ()=>{
  $("signinErr").textContent="";
  try{ await setPersistence(auth, browserLocalPersistence); }catch(e){}
  try{ await signInWithPopup(auth, provider); return; }
  catch(e){
    if(e.code==="auth/unauthorized-domain"||e.code==="auth/popup-closed-by-user"){ $("signinErr").textContent=authErr(e); return; }
  }
  try{ await signInWithRedirect(auth, provider); }
  catch(e2){ $("signinErr").textContent=authErr(e2); }
};
if(standalone){ $("standaloneNote").hidden=false; }
function emailPass(){
  const email=$("emailIn").value.trim().toLowerCase(), pass=$("passIn").value;
  $("signinErr").textContent="";
  if(!email){ $("signinErr").textContent="Type your email first."; return null; }
  return {email,pass};
}
const friendly = e => ({
  "auth/invalid-credential":"Wrong email or password.", "auth/wrong-password":"Wrong password.",
  "auth/user-not-found":"No account yet — tap Create account.", "auth/email-already-in-use":"That account exists — tap Sign in.",
  "auth/weak-password":"Password needs at least 6 characters.", "auth/invalid-email":"That email doesn't look right.",
  "auth/operation-not-allowed":"Email sign-in isn't switched on in Firebase yet.",
}[e.code] || (e.message||e.code));
$("emailBtn").onclick = async ()=>{ const v=emailPass(); if(!v) return; try{ await setPersistence(auth, browserLocalPersistence); await signInWithEmailAndPassword(auth,v.email,v.pass); }catch(e){ $("signinErr").textContent=friendly(e); } };
$("createBtn").onclick = async ()=>{ const v=emailPass(); if(!v) return;
  if(!READERS[v.email]){ $("signinErr").textContent="That email isn't one of the two readers."; return; }
  try{ await setPersistence(auth, browserLocalPersistence); await createUserWithEmailAndPassword(auth,v.email,v.pass); }catch(e){ $("signinErr").textContent=friendly(e); } };
$("resetBtn").onclick = async ()=>{ const v=emailPass(); if(!v) return; try{ await sendPasswordResetEmail(auth,v.email); $("signinErr").textContent="Reset email sent to "+v.email+"."; }catch(e){ $("signinErr").textContent=friendly(e); } };
$("signout").onclick = $("signout2").onclick = ()=>signOut(auth);
getRedirectResult(auth).catch(e=>{ $("signinErr").textContent="Sign-in didn't finish: "+(e.message||e.code); });

onAuthStateChanged(auth, user=>{
  stopListening();
  if(!user){ me=null; show("signin"); return; }
  const email=(user.email||"").toLowerCase();
  const slot=READERS[email];
  if(!slot){ $("notyouEmail").textContent="("+email+")"; show("notyou"); return; }
  me=slot; her= slot==="andrea"?"allie":"andrea";
  $("meParen").textContent="("+SLOTS[me].name+")"; $("herParen").textContent="("+SLOTS[her].name+")";
  $("shareBtn").textContent="⧉ Share with "+SLOTS[her].name;
  show("app"); render(); startListening();
});

/* ---------- live data ---------- */
function stopListening(){ for(const u of unsubs) u(); unsubs=[]; }
function startListening(){
  unsubs.push(onSnapshot(doc(db,"club","book"), s=>{ state.book=s.exists()?s.data():null; renderBook(); }, e=>toast("Book sync stopped")));
  for(const slot of ["andrea","allie"]){
    unsubs.push(onSnapshot(doc(db,"readers",slot), s=>{
      if(slot===me && s.metadata.hasPendingWrites) return;
      const d=s.exists()?s.data():{};
      state.progress[slot]=Number(d.pct)||0; state.updated[slot]=d.updatedAt||null;
      if(slot===me && !dragging){ draftPct=state.progress[me]; lockAt=draftPct; syncSlider(); }
      renderProgress(); renderThread(); renderFeed();
    }, e=>{}));
  }
  const seen=new Set(); let first=true;
  unsubs.push(onSnapshot(collection(db,"comments"), s=>{
    state.comments=s.docs.map(d=>Object.assign({id:d.id},d.data())).filter(c=>SLOTS[c.slot]);
    if(!first){ for(const ch of s.docChanges()){ const c=ch.doc.data(); if(ch.type==="added"&&c.slot!==me&&!seen.has(ch.doc.id)){ seen.add(ch.doc.id); notifyNew(c); } } }
    else for(const d of s.docs) seen.add(d.id);
    first=false; renderThread(); renderFeed();
  }, e=>toast("Notes sync stopped: "+e.code)));
}
function notifyNew(c){
  const who=SLOTS[c.slot].name;
  toast(c.parentId ? who+" replied" : (myPct()>=c.pct ? who+" left you a note at "+c.pct+"%" : who+" locked a note at "+c.pct+"% — keep reading"));
  if("Notification" in window && Notification.permission==="granted" && document.hidden){
    try{ new Notification("Same Page",{ body: c.parentId ? who+" replied to a note." : who+" left a note at "+c.pct+"%.", icon:"icon-192.png" }); }catch(e){}
  }
}
if("Notification" in window && Notification.permission==="default"){
  document.addEventListener("click",()=>{ if(Notification.permission==="default") Notification.requestPermission().catch(()=>{}); },{once:true});
}

/* ---------- progress ---------- */
function myPct(){ return me ? (state.progress[me]||0) : 0; }
let dragging=false;
function syncSlider(){ $("pctRange").value=draftPct; $("sliderPct").innerHTML=draftPct+"<small>%</small>"; $("savePctLbl").textContent=draftPct+"%"; $("savePct").disabled = draftPct===myPct(); renderLock(); }
$("pctRange").addEventListener("input", e=>{ dragging=true; draftPct=Number(e.target.value); lockAt=draftPct; syncSlider(); });
$("pctRange").addEventListener("change", ()=>{ dragging=false; });
$("savePct").onclick = async ()=>{
  try{ await setDoc(doc(db,"readers",me),{pct:draftPct,updatedAt:new Date().toISOString()}); state.progress[me]=draftPct; renderProgress(); renderThread(); syncSlider(); toast("Progress saved — "+draftPct+"%"); }
  catch(e){ toast("Couldn't save progress"); }
};
function renderProgress(){
  const m=myPct(), h=state.progress[her]||0;
  $("mePct").innerHTML=m+"<small>%</small>"; $("herPct").innerHTML=h+"<small>%</small>";
  $("meFill").style.width=m+"%"; $("herFill").style.width=h+"%";
  const H=SLOTS[her].name, gap=m-h;
  $("gapNote").textContent = gap>0 ? `You're ${gap}% ahead of ${H}. She'll unlock your notes as she catches up.` : gap<0 ? `${H} is ${-gap}% ahead of you. Her notes unlock as you catch up.` : `You're both at ${m}% — perfectly in step.`;
  $("savePct").disabled = draftPct===m;
}

/* ---------- book ---------- */
let armed=false;
$("saveBook").onclick = async ()=>{
  const title=$("inTitle").value.trim(), author=$("inAuthor").value.trim();
  if(!title){ toast("Type a title first"); return; }
  const hasNotes=state.comments.length>0;
  if(hasNotes && !armed){ armed=true; $("saveBook").textContent="Really? Clears all notes"; setTimeout(()=>{armed=false;$("saveBook").textContent="Change book";},4000); return; }
  armed=false; $("saveBook").textContent="Change book";
  try{
    const b=writeBatch(db);
    b.set(doc(db,"club","book"),{title,author,startedAt:new Date().toISOString()});
    for(const c of state.comments) b.delete(doc(db,"comments",c.id));
    for(const s of ["andrea","allie"]) b.set(doc(db,"readers",s),{pct:0,updatedAt:new Date().toISOString()});
    await b.commit(); toast("New book on the shelf — fresh start");
  }catch(e){ toast("Couldn't change the book: "+e.code); }
};
$("shareBtn").onclick = async ()=>{
  const url=location.origin+location.pathname;
  try{ if(navigator.share){ await navigator.share({title:"Same Page",text:"Our book club, just us.",url}); return; } }catch(e){ if(e.name==="AbortError") return; }
  try{ await navigator.clipboard.writeText(url); toast("Link copied — send it to "+SLOTS[her].name); }catch(e){ toast(url); }
};
function renderBook(){
  const t=state.book?.title||"", a=state.book?.author||"";
  $("cvTitle").textContent=t||"Your next book"; $("cvAuthor").textContent=a?a+"✨":"";
  if(document.activeElement!==$("inTitle")) $("inTitle").value=t;
  if(document.activeElement!==$("inAuthor")) $("inAuthor").value=a;
}

/* ---------- notes ---------- */
function renderLock(){ $("lockVal").textContent=lockAt+"%"; $("postPct").textContent=lockAt+"%"; $("lockHint").textContent=`Defaults to your current progress (${draftPct}%). Use − / + in 1% steps.`; }
$("lockMinus").onclick=()=>{ lockAt=Math.max(0,lockAt-1); renderLock(); };
$("lockPlus").onclick=()=>{ lockAt=Math.min(100,lockAt+1); renderLock(); };
$("post").onclick = ()=>postNote($("text").value.trim(), false);
async function postNote(text,isQ){
  if(!text||!me) return;
  const c={slot:me,pct:lockAt,text,isQ,parentId:null,createdAt:new Date().toISOString()};
  try{ await addDoc(collection(db,"comments"),c); if(!isQ) $("text").value=""; toast("Locked at "+c.pct+"% — "+SLOTS[her].name+" will find it there"); }
  catch(e){ toast("Couldn't post: "+e.code); }
}
async function reply(parent,text){
  try{ await addDoc(collection(db,"comments"),{slot:me,pct:parent.pct,text,isQ:false,parentId:parent.id,createdAt:new Date().toISOString()}); }catch(e){ toast("Couldn't reply"); }
}
async function remove(c){
  try{ const b=writeBatch(db); b.delete(doc(db,"comments",c.id)); for(const r of state.comments.filter(x=>x.parentId===c.id)) b.delete(doc(db,"comments",r.id)); await b.commit(); }catch(e){ toast("Couldn't delete"); }
}
function unlockedForMe(c){ return c.slot===me || myPct()>=c.pct; }
function seenKey(){ return "samepage.seen."+me; }
function seenSet(){ try{ return new Set(JSON.parse(lsGet(seenKey())||"[]")); }catch(e){ return new Set(); } }
function markSeen(ids){ const s=seenSet(); ids.forEach(i=>s.add(i)); lsSet(seenKey(),JSON.stringify([...s])); }

function renderThread(){
  const t=$("thread"); t.innerHTML="";
  const roots=state.comments.filter(c=>!c.parentId).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  if(!roots.length){ t.innerHTML='<div class="empty">No notes yet. The margin is all yours.</div>'; $("bellCount").hidden=true; return; }
  const seen=seenSet(); let fresh=0;
  for(const c of roots){
    const mine=c.slot===me, open=unlockedForMe(c), who=mine?`You (${SLOTS[me].name})`:`Bestie (${SLOTS[her].name})`;
    const isFresh=!mine&&open&&!seen.has(c.id); if(isFresh) fresh++;
    const el=document.createElement("div"); el.className="note"+(open?"":" locked")+(isFresh?" fresh":""); el.dataset.id=c.id;
    let html=`<div class="note-head"><span class="av ${SLOTS[c.slot].cls}">A</span><div class="note-who"><b>${who}</b><span>${when(c.createdAt)}</span></div><span class="at ${mine?"me":(open?"sky":"her")}">at ${c.pct}%</span></div>`;
    html+=`<div class="note-txt${c.isQ?" q":""}${open?"":" blur"}">${open?esc(c.text):"Something scandalous is waiting here for you, but not yet. Keep reading."}</div>`;
    if(mine){
      const hp=state.progress[her]||0;
      html+= hp>=c.pct ? `<div class="status ok">✓ Unlocked for ${SLOTS[her].name} — she reached ${c.pct}%</div>` : `<div class="status waiting">🔒 Locked for ${SLOTS[her].name} — she's at ${hp}%, needs ${c.pct}%</div>`;
    } else if(open){
      html+=`<div class="status ok">✓ Unlocked — you reached ${c.pct}%</div>`;
    } else {
      html+=`<div class="status lock">🔒 Locked until you reach ${c.pct}% — you're at ${myPct()}%</div><div class="hint">Keep reading to unlock. 🔒</div>`;
    }
    el.innerHTML=html;
    if(open){
      const replies=state.comments.filter(r=>r.parentId===c.id).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
      if(replies.length){
        const rw=document.createElement("div"); rw.className="replies";
        for(const r of replies){ const re=document.createElement("div"); re.className="reply"; re.innerHTML=`<span class="av ${SLOTS[r.slot].cls}">A</span><div><b>${SLOTS[r.slot].name}</b> <span class="muted" style="font-size:12px">${when(r.createdAt)}</span><div>${esc(r.text)}</div></div>`; rw.appendChild(re); }
        el.appendChild(rw);
      }
      const rb=document.createElement("div"); rb.className="reply-box";
      const inp=document.createElement("input"); inp.id="r-"+c.id; inp.placeholder=mine?"Add to this…":"Reply to "+SLOTS[her].name+"…"; inp.setAttribute("aria-label","Reply");
      const btn=document.createElement("button"); btn.type="button"; btn.className="btn green"; btn.textContent="Reply";
      const send=()=>{ const v=inp.value.trim(); if(!v) return; inp.value=""; reply(c,v); };
      btn.onclick=send; inp.addEventListener("keydown",e=>{ if(e.key==="Enter") send(); });
      rb.append(inp,btn); el.appendChild(rb);
      if(mine){ const del=document.createElement("button"); del.type="button"; del.className="link"; del.textContent="delete note";
        del.onclick=()=>{ if(del.dataset.armed){ remove(c); } else { del.dataset.armed="1"; del.textContent="really delete?"; setTimeout(()=>{del.dataset.armed="";del.textContent="delete note";},2500);} };
        el.appendChild(del); }
    }
    t.appendChild(el);
  }
  $("bellCount").textContent=fresh; $("bellCount").hidden=fresh===0;
}
$("bell").onclick=()=>{
  const f=document.querySelector(".note.fresh");
  if(f){ f.scrollIntoView({behavior:"smooth",block:"center"}); markSeen(state.comments.filter(c=>!c.parentId&&c.slot!==me&&unlockedForMe(c)).map(c=>c.id)); setTimeout(renderThread,1500); setTimeout(renderFeed,1500); }
  else toast("Nothing new unlocked — keep reading!");
};

/* ---------- stir the pot ---------- */
$("spicy").addEventListener("change",()=>{ $("spicyHint").textContent=$("spicy").checked?"On: flirty, betrayal & moral-dilemma energy.":"Off: thoughtful, still a little nosy."; });
$("deal").onclick=()=>{
  const deck=$("spicy").checked?SPICY:MILD;
  let q; do{ q=deck[Math.floor(Math.random()*deck.length)]; }while(q===currentQ&&deck.length>1);
  currentQ=q; const pot=$("pot"); pot.textContent=q; pot.className="pot q"; $("pinQ").hidden=false;
};
$("pinQ").onclick=async ()=>{ if(!currentQ) return; await postNote(currentQ,true); $("pinQ").hidden=true; $("pot").textContent="Pinned at "+lockAt+"%. Stir again?"; $("pot").className="pot"; currentQ=null; };

/* ---------- activity ---------- */
function renderFeed(){
  const f=$("feed"); const items=[]; const seen=seenSet();
  for(const s of ["andrea","allie"]){ if(state.updated[s]) items.push({t:(s===me?"You":SLOTS[s].name)+" updated progress to "+state.progress[s]+"%", at:state.updated[s]}); }
  for(const c of state.comments){
    const who=c.slot===me?"You":SLOTS[c.slot].name;
    if(c.parentId){ items.push({t:who+" replied to a note at "+c.pct+"%", at:c.createdAt}); continue; }
    if(c.slot===me) items.push({t:(c.isQ?"You stirred the pot at ":"You left a note at ")+c.pct+"%", at:c.createdAt});
    else if(unlockedForMe(c)) items.push({t:"A note from "+who+" at "+c.pct+"% unlocked for you", at:c.createdAt, tag:!seen.has(c.id)?"NEW":null, sub:"🔓 Unlock"});
    else items.push({t:who+" locked a note at "+c.pct+"%", at:c.createdAt, sub:"🔒 Keep reading"});
  }
  items.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
  f.innerHTML = items.length ? items.slice(0,12).map(i=>`<div class="fi"><span class="dot${i.tag?" new":""}"></span><div><div class="t">${esc(i.t)}</div><div class="w">${when(i.at)}${i.sub?" • "+i.sub:""}</div></div>${i.tag?`<span class="tag">${i.tag}</span>`:"<span></span>"}</div>`).join("") : '<div class="empty">Quiet so far. Save your progress or leave a note to get things going.</div>';
}

function render(){ renderBook(); renderProgress(); syncSlider(); renderThread(); renderFeed(); }
if("serviceWorker" in navigator){ navigator.serviceWorker.register("sw.js").catch(()=>{}); }
