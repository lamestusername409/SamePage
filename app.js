import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, collection, setDoc, addDoc, deleteDoc, onSnapshot, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { READERS, QUESTIONS } from "./config.js";

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

const SLOTS = { andrea:{name:"Andrea",cls:"andrea"}, allie:{name:"Allie",cls:"allie"} };
let me = null;
let state = { book:null, progress:{andrea:0,allie:0}, comments:[] };
let unsubs = [];
const $ = id => document.getElementById(id);

function toast(t){ const el=$("toast"); el.textContent=t; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),1800); }
function show(id){ for(const s of ["signin","notyou","loading","app"]) $(s).hidden = s!==id; }
function cap(s){ return s[0].toUpperCase()+s.slice(1); }
function esc(s){ return String(s).replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch])); }
function fmt(iso){ try{ return new Date(iso).toLocaleDateString(undefined,{month:"short",day:"numeric"}); }catch(e){ return ""; } }
function lsGet(k){ try{return localStorage.getItem(k)}catch(e){return null} }
function lsSet(k,v){ try{localStorage.setItem(k,v)}catch(e){} }

/* ---------- auth ---------- */
const provider = new GoogleAuthProvider();
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
$("googleBtn").onclick = async ()=>{
  $("signinErr").textContent="";
  try{
    await setPersistence(auth, browserLocalPersistence);
    if(standalone) await signInWithRedirect(auth, provider);
    else await signInWithPopup(auth, provider);
  }catch(e){
    try{ await signInWithRedirect(auth, provider); }
    catch(e2){ $("signinErr").textContent = "Sign-in didn't work: "+(e2.message||e2.code); }
  }
};
function emailPass(){
  const email=$("emailIn").value.trim().toLowerCase(), pass=$("passIn").value;
  $("signinErr").textContent="";
  if(!email){ $("signinErr").textContent="Type your email first."; return null; }
  return {email,pass};
}
const friendly = e => ({
  "auth/invalid-credential":"Wrong email or password.",
  "auth/wrong-password":"Wrong password.",
  "auth/user-not-found":"No account yet — tap Create account.",
  "auth/email-already-in-use":"That account exists — tap Sign in.",
  "auth/weak-password":"Password needs at least 6 characters.",
  "auth/invalid-email":"That email doesn't look right.",
}[e.code] || (e.message||e.code));
$("emailBtn").onclick = async ()=>{ const v=emailPass(); if(!v) return;
  try{ await setPersistence(auth, browserLocalPersistence); await signInWithEmailAndPassword(auth,v.email,v.pass); }catch(e){ $("signinErr").textContent=friendly(e); } };
$("createBtn").onclick = async ()=>{ const v=emailPass(); if(!v) return;
  if(!READERS[v.email]){ $("signinErr").textContent="That email isn't one of the two readers."; return; }
  try{ await setPersistence(auth, browserLocalPersistence); await createUserWithEmailAndPassword(auth,v.email,v.pass); }catch(e){ $("signinErr").textContent=friendly(e); } };
$("resetBtn").onclick = async ()=>{ const v=emailPass(); if(!v) return;
  try{ await sendPasswordResetEmail(auth,v.email); $("signinErr").textContent="Reset email sent to "+v.email+"."; }catch(e){ $("signinErr").textContent=friendly(e); } };
$("signout").onclick = $("signout2").onclick = ()=>signOut(auth);
getRedirectResult(auth).catch(e=>{ $("signinErr").textContent="Sign-in didn't finish: "+(e.message||e.code); });

onAuthStateChanged(auth, user=>{
  stopListening();
  if(!user){ me=null; show("signin"); return; }
  const email=(user.email||"").toLowerCase();
  const slot=READERS[email];
  if(!slot){ $("notyouEmail").textContent="("+email+")"; show("notyou"); return; }
  me=slot;
  for (const id of ["meAv","meAv2"]) $(id).className="av sm "+SLOTS[slot].cls;
  $("meName").textContent=SLOTS[slot].name;
  show("app"); render(); startListening();
});

/* ---------- live data ---------- */
function stopListening(){ for(const u of unsubs) u(); unsubs=[]; }
function startListening(){
  unsubs.push(onSnapshot(doc(db,"club","book"), s=>{ state.book=s.exists()?s.data():null; renderBook(); }, e=>toast("Book sync stopped")));
  for(const slot of ["andrea","allie"]){
    unsubs.push(onSnapshot(doc(db,"readers",slot), s=>{
      if(slot===me && s.metadata.hasPendingWrites) return;
      state.progress[slot]=s.exists()?Number(s.data().pct)||0:0;
      if(slot===me) setPctUI(state.progress[slot]);
      renderSpine(); renderThread();
    }, e=>{}));
  }
  const seen = new Set();
  let first = true;
  unsubs.push(onSnapshot(collection(db,"comments"), s=>{
    state.comments=s.docs.map(d=>Object.assign({id:d.id},d.data())).filter(c=>SLOTS[c.slot]);
    if(!first){
      for(const ch of s.docChanges()){
        const c=ch.doc.data();
        if(ch.type==="added" && c.slot!==me && !seen.has(ch.doc.id)){ seen.add(ch.doc.id); notifyNew(c); }
      }
    } else { for(const d of s.docs) seen.add(d.id); }
    first=false;
    renderSpine(); renderThread();
  }, e=>toast("Notes sync stopped: "+e.code)));
}

function notifyNew(c){
  const who=SLOTS[c.slot].name;
  if(c.parentId) toast(who+" replied"); else toast(who+" pinned a note at "+c.pct+"%");
  if("Notification" in window && Notification.permission==="granted" && document.hidden){
    try{ new Notification("Same Page", { body: c.parentId ? who+" replied to a note." : who+" left a note at "+c.pct+"%.", icon:"icon-192.png" }); }catch(e){}
  }
}
if("Notification" in window && Notification.permission==="default"){
  document.addEventListener("click", ()=>{ if(Notification.permission==="default") Notification.requestPermission().catch(()=>{}); }, {once:true});
}

/* ---------- progress ---------- */
function myPct(){ return me ? (state.progress[me]||0) : 0; }
let pctTimer=null, savingPct=Promise.resolve();
function setPctUI(v){ $("pctRange").value=v; $("pctNum").value=v; $("composeAt").textContent=v+"%"; }
function onPctInput(v){
  v=Math.max(0,Math.min(100,Math.round(Number(v)||0)));
  setPctUI(v); state.progress[me]=v; renderSpine(); renderThread();
  clearTimeout(pctTimer); pctTimer=setTimeout(()=>saveProgress(v),500);
}
$("pctRange").addEventListener("input", e=>onPctInput(e.target.value));
$("pctNum").addEventListener("change", e=>onPctInput(e.target.value));
function saveProgress(v){
  savingPct=savingPct.then(()=>setDoc(doc(db,"readers",me),{pct:v,updatedAt:new Date().toISOString()})).catch(e=>toast("Couldn't save progress"));
}

/* ---------- book ---------- */
$("editBook").onclick=()=>{ $("inTitle").value=state.book?.title||""; $("inAuthor").value=state.book?.author||""; $("book").classList.add("editing"); $("inTitle").focus(); };
$("cancelBook").onclick=()=>$("book").classList.remove("editing");
$("saveBook").onclick=async ()=>{
  const title=$("inTitle").value.trim(), author=$("inAuthor").value.trim(); if(!title) return;
  $("book").classList.remove("editing");
  try{ await setDoc(doc(db,"club","book"),{title,author,startedAt:new Date().toISOString()}); toast("New book on the shelf"); }catch(e){ toast("Couldn't save the book"); }
};

/* ---------- comments ---------- */
$("deal").onclick=()=>{ const q=QUESTIONS[Math.floor(Math.random()*QUESTIONS.length)]; $("text").value="❓ "+q; $("text").focus(); };
$("post").onclick=async ()=>{
  const text=$("text").value.trim(); if(!text||!me) return;
  const c={slot:me,pct:myPct(),text,isQ:text.startsWith("❓"),parentId:null,createdAt:new Date().toISOString()};
  $("text").value="";
  try{ await addDoc(collection(db,"comments"),c); toast("Pinned at "+c.pct+"%"); }catch(e){ toast("Couldn't post: "+e.code); $("text").value=text; }
};
async function reply(parent,text){
  const c={slot:me,pct:parent.pct,text,isQ:false,parentId:parent.id,createdAt:new Date().toISOString()};
  try{ await addDoc(collection(db,"comments"),c); }catch(e){ toast("Couldn't reply"); }
}
async function remove(c){
  try{
    await deleteDoc(doc(db,"comments",c.id));
    const rs=await getDocs(query(collection(db,"comments"),where("parentId","==",c.id)));
    for(const r of rs.docs) await deleteDoc(r.ref);
  }catch(e){ toast("Couldn't delete"); }
}
function canSee(c){ return c.slot===me || myPct()>=c.pct; }

/* ---------- render ---------- */
function render(){ renderBook(); renderSpine(); renderThread(); setPctUI(myPct()); }
function renderBook(){
  $("bookTitle").textContent=state.book?.title||"No book yet — tap change";
  $("bookAuthor").textContent=state.book?.author||"";
}
function renderSpine(){
  for(const s of ["andrea","allie"]){
    const p=state.progress[s]||0;
    $("fill"+cap(s)).style.width=p+"%";
    const mk=$("mk"+cap(s)); mk.style.left=p+"%"; mk.querySelector(".pct").textContent=p+"%";
  }
  const pins=$("pins"); pins.innerHTML="";
  for(const c of state.comments.filter(c=>!c.parentId)){
    const d=document.createElement("button"); d.type="button"; d.className="pin"+(canSee(c)?" open":""); d.style.left=c.pct+"%";
    d.title=(canSee(c)?SLOTS[c.slot].name+" at ":"Locked until ")+c.pct+"%"; d.setAttribute("aria-label",d.title);
    d.onclick=()=>{ const el=document.querySelector('[data-id="'+c.id+'"]'); if(el) el.scrollIntoView({behavior:"smooth",block:"center"}); };
    pins.appendChild(d);
  }
}
const seenKey="samepage.seen."+(me||"");
function renderThread(){
  const t=$("thread"); t.innerHTML="";
  const roots=state.comments.filter(c=>!c.parentId).sort((a,b)=>a.pct-b.pct||String(a.createdAt).localeCompare(String(b.createdAt)));
  if(!roots.length){ t.innerHTML='<div class="empty">Nothing in the margin yet. Pin the first note — or deal a question.</div>'; return; }
  for(const c of roots){
    const open=canSee(c);
    const el=document.createElement("div"); el.className="c "+SLOTS[c.slot].cls+(open?"":" locked"); el.dataset.id=c.id;
    const who=SLOTS[c.slot].name;
    let html='<span class="av sm '+SLOTS[c.slot].cls+'">A</span><div class="bub"><div class="meta"><b>'+who+'</b><span class="at">'+c.pct+'%</span><span>'+fmt(c.createdAt)+'</span></div>';
    if(open){
      html+='<div class="txt'+(c.isQ?" q":"")+'">'+esc(c.text.replace(/^❓\s*/,""))+'</div>';
      if(c.slot===me) html+='<div class="actions"><button type="button" data-del>delete</button></div>';
    } else {
      html+='<div class="txt">'+who+' left something here. Keep reading — it unlocks at '+c.pct+'%.</div>';
    }
    html+='</div>';
    el.innerHTML=html;
    if(open){
      const replies=state.comments.filter(r=>r.parentId===c.id).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
      if(replies.length){
        const rw=document.createElement("div"); rw.className="replies";
        for(const r of replies){
          const re=document.createElement("div"); re.className="c "+SLOTS[r.slot].cls;
          re.innerHTML='<span class="av sm '+SLOTS[r.slot].cls+'">A</span><div class="bub"><div class="meta"><b>'+SLOTS[r.slot].name+'</b><span>'+fmt(r.createdAt)+'</span></div><div class="txt">'+esc(r.text)+'</div></div>';
          rw.appendChild(re);
        }
        el.appendChild(rw);
      }
      const rb=document.createElement("div"); rb.className="reply-box";
      const inp=document.createElement("input"); inp.placeholder="Reply to "+who+"…"; inp.id="r-"+c.id; inp.setAttribute("aria-label","Reply");
      const btn=document.createElement("button"); btn.type="button"; btn.textContent="Reply";
      const send=()=>{ const v=inp.value.trim(); if(!v) return; inp.value=""; reply(c,v); };
      btn.onclick=send; inp.addEventListener("keydown",e=>{ if(e.key==="Enter") send(); });
      rb.append(inp,btn); el.appendChild(rb);
      const del=el.querySelector("[data-del]");
      if(del) del.onclick=()=>{ if(del.dataset.armed){ remove(c); } else { del.dataset.armed="1"; del.textContent="really delete?"; setTimeout(()=>{del.dataset.armed="";del.textContent="delete";},2500);} };
    }
    t.appendChild(el);
  }
}

/* ---------- PWA ---------- */
if("serviceWorker" in navigator){ navigator.serviceWorker.register("sw.js").catch(()=>{}); }
