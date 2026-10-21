import './style.css';
import {auth,gp,db} from './firebase.js';
import {onAuthStateChanged,signInWithPopup,signInWithEmailAndPassword,createUserWithEmailAndPassword,signOut} from 'firebase/auth';
import {collection,doc,setDoc,deleteDoc,onSnapshot} from 'firebase/firestore';
// Data lives in Firestore: users/{uid}/timetable, users/{uid}/subjects, users/{uid}/attendance
const COL={tt:'timetable',subs:'subjects',rec:'attendance'};
let uid=null,authed=false,loaded=0,NAME='Nika',last={tt:{},subs:{},rec:{}},unsubs=[];
const J=o=>JSON.stringify(o,Object.keys(o).sort());
const authErr=e=>{const x=document.getElementById('er');if(x)x.textContent=(e.code||'Something went wrong').replace('auth/','').replaceAll('-',' ')};

const ST={attended:['✅','Attended'],absent:['💔','Absent'],noprof:['🙈','Prof didn’t come']};
const DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const key=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const parse=k=>{const[a,b,c]=k.split('-').map(Number);return new Date(a,b-1,c)};
const add=(k,n)=>{const d=parse(k);d.setDate(d.getDate()+n);return key(d)};
const to12=t=>{const[h,m]=t.split(':').map(Number);return(h%12||12)+':'+String(m).padStart(2,'0')+' '+(h<12?'AM':'PM')};
const pct=(a,b)=>b?Math.round(a/b*100):null;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let S={tt:[],rec:{},subs:[]};

let ui={page:'home',date:key(new Date()),day:Math.max(1,new Date().getDay()),form:null,edit:null};


// Base timetable for that weekday + that day's saved records (records keep their own subject/time)
function lecs(k){
  const day=parse(k).getDay(),m={};
  S.tt.filter(t=>t.day===day).forEach(t=>{const id=k+'_'+t.id;m[id]={id,ttId:t.id,subject:t.subject,start:t.start,end:t.end,status:null,note:'',date:k}});
  Object.values(S.rec).filter(r=>r.date===k).forEach(r=>{m[r.id]={...(m[r.id]||{}),...r}});
  return Object.values(m).sort((a,b)=>a.start.localeCompare(b.start));
}
// Attendance % = attended / (attended + absent). "Prof didn't come" is counted separately.
function stats(){
  const d=new Date();d.setDate(d.getDate()-((d.getDay()+6)%7));const ws=key(d);
  const s={week:0,np:0,a:0,b:0,mo:{}};
  Object.values(S.rec).forEach(r=>{
    if(r.status==='noprof'){s.np++;return}
    if(r.status!=='attended'&&r.status!=='absent')return;
    const m=s.mo[r.date.slice(0,7)]||(s.mo[r.date.slice(0,7)]={a:0,b:0});
    if(r.status==='attended'){s.a++;m.a++;if(r.date>=ws)s.week++}else{s.b++;m.b++}
  });return s;
}
const sk=n=>(n||'').trim().toLowerCase();
const subOf=n=>S.subs.find(u=>sk(u.name)===sk(n));
const subOpts=c=>{const ns=S.subs.map(u=>u.name);if(c&&!ns.includes(c))ns.unshift(c);return ns.map(n=>`<option ${n===c?'selected':''}>${esc(n)}</option>`).join('')};
// Per-subject numbers + "can I skip?" maths. Prof-didn’t-come lectures never count.
// With a total: final % = attended / total, so skippable = lectures left - lectures you must still attend.
function subStats(u){
  const R=Object.values(S.rec).filter(r=>sk(r.subject)===sk(u.name)),n=x=>R.filter(r=>r.status===x).length;
  const a=n('attended'),b=n('absent'),np=n('noprof'),h=a+b,p=u.target,T=u.total||0,cur=pct(a,h),left=T?Math.max(0,T-h):null;
  let skip=null,need=0;
  if(T){need=Math.max(0,Math.ceil(p*T/100-1e-9)-a);skip=need>left?-1:left-need}
  else if(h){if(a*100>=p*h)skip=Math.floor((a*100-p*h)/p+1e-9);else{need=p>=100?999:Math.ceil((p*h-100*a)/(100-p)-1e-9);skip=0}}
  let msg;
  if(skip===null)msg=`🎯 Target ${p}% · mark a few lectures to see your skip room`;
  else if(skip===-1)msg=`😬 Even if you attend every lecture left, you can’t reach ${p}% now`;
  else if(T&&left===0)msg=`🏁 All ${T} lectures done · final ${cur}% (target ${p}%)`;
  else if(T)msg=skip>0?`😎 You can skip ${skip} more. Attend ${need} of the ${left} left to stay at ${p}%`:`⚠️ Don’t skip any — attend all ${left} left to hit ${p}%`;
  else msg=need>0?`🚨 Below target! Attend the next ${need} in a row to reach ${p}%`:skip===0?`⚠️ Right on the line — skipping one drops you below ${p}%`:`😎 You can skip ${skip} more and stay at ${p}%+`;
  return{a,b,np,h,cur,left,skip,need,msg,risk:skip===-1||(!T&&need>0)};
}
const skipLine=name=>{const u=subOf(name);return u?`<div style="font-weight:700;font-size:14px;margin-bottom:8px">${subStats(u).msg}</div>`:''};
function subsCard(){
  const f=ui.sf,rows=S.subs.map(u=>`<div class="item row"><div><b>${esc(u.name)}</b> <span class="chip">${u.type==='Lab'?'🧪 Lab':'📖 Lecture'}</span><div class="sub">Target ${u.target}% · counting ${u.total?u.total+' lectures':'all lectures (no total set)'}</div></div><div><button class="small" data-a="edsub:${u.id}">✏️</button> <button class="small" data-a="delsub:${u.id}">🗑️</button></div></div>`).join('')||'<p class="sub">Add your subjects (and labs) first — each gets its own target % 🎯</p>';
  const form=f?`<div class="item"><input id="u-n" placeholder="Subject name (e.g. Data Structures)" value="${esc(f.name)}"><select id="u-t"><option ${f.type!=='Lab'?'selected':''}>Lecture</option><option ${f.type==='Lab'?'selected':''}>Lab</option></select><div class="g3" style="grid-template-columns:1fr 1fr"><input id="u-p" type="number" min="1" max="100" placeholder="Target %" value="${f.target}"><input id="u-c" type="number" min="0" placeholder="Total lectures to count" value="${f.total||''}"></div><p class="sub" style="margin:0 0 8px">Total = how many lectures of this subject count for attendance this semester (optional).</p><button class="pink full" data-a="savesub">Save subject</button><button class="full" data-a="cancelsub">Cancel</button></div>`:'<button class="small full" data-a="addsub">＋ Add subject / lab</button>';
  return `<div class="card"><h2>Subjects & targets 🎯</h2>${rows}${form}</div>`;
}
function quickPanel(l){return `<div class="item" style="margin-top:-2px">${skipLine(l.subject)}<div class="g3">${Object.entries(ST).map(([s,v])=>`<button class="st s-${s} ${l.status===s?'on':''}" data-a="qs:${l.id}:${s}"><i>${v[0]}</i>${v[1]}</button>`).join('')}</div><button class="small" style="margin-top:8px;width:100%" data-a="more">＋ Add description / edit</button></div>`}
// Visual stats: donut, this-week bars, month-wise and subject-wise bars
function charts(s){
  const R=Object.values(S.rec),d0=new Date();d0.setDate(d0.getDate()-((d0.getDay()+6)%7));
  const wk=[0,1,2,3,4,5].map(i=>{const k=key(new Date(d0.getFullYear(),d0.getMonth(),d0.getDate()+i));const r=R.filter(x=>x.date===k);return{n:DAYS[i+1].slice(0,3),a:r.filter(x=>x.status==='attended').length,b:r.filter(x=>x.status==='absent').length,p:r.filter(x=>x.status==='noprof').length}});
  const mx=Math.max(1,...wk.map(w=>w.a+w.b+w.p));
  const sub={};R.forEach(r=>{if(r.status!=='attended'&&r.status!=='absent')return;const q=sub[r.subject]||(sub[r.subject]={a:0,b:0});r.status==='attended'?q.a++:q.b++});
  const SS=S.subs.map(u=>({u,s:subStats(u)})),typ=t=>{const x=SS.filter(q=>q.u.type===t);return pct(x.reduce((n,q)=>n+q.s.a,0),x.reduce((n,q)=>n+q.s.h,0))};
  const done=R.filter(r=>r.status==='attended'||r.status==='absent').sort((x,y)=>(y.date+y.start).localeCompare(x.date+x.start));let streak=0;for(const r of done){if(r.status==='attended')streak++;else break}
  let pend=0;const first=R.length?R.map(r=>r.date).sort()[0]:null;if(first)for(let i=1;i<=60;i++){const k=add(key(new Date()),-i);if(k>=first)pend+=lecs(k).filter(l=>!l.status).length}
  const nowT=new Date(),hm=String(nowT.getHours()).padStart(2,'0')+':'+String(nowT.getMinutes()).padStart(2,'0'),left=lecs(key(nowT)).filter(l=>l.end>hm).length,risk=SS.filter(q=>q.s.risk).length,pc=v=>v===null?'–':v+'%';
  const tiles=`<div class="g3" style="margin-top:16px">${[[streak,'attended in a row 🔥'],[pend,'past lectures unmarked'],[risk,'subjects at risk ⚠️'],[pc(typ('Lecture')),'lecture attendance'],[pc(typ('Lab')),'lab attendance'],[left,'lectures left today 📚']].map(([n,t])=>`<div class="stat"><b>${n}</b><span>${t}</span></div>`).join('')}</div>`;
  const subCards=SS.map(({u,s:z})=>`<div class="item"><div class="row"><b>${esc(u.name)} <span class="chip">${u.type==='Lab'?'🧪 Lab':'📖 Lecture'}</span></b><b style="${z.cur!==null&&z.cur<u.target?'color:var(--cr)':''}">${pc(z.cur)}</b></div><div class="bar" style="position:relative"><i style="width:${z.cur||0}%"></i><span style="position:absolute;top:0;bottom:0;left:${u.target}%;width:2px;background:var(--text)"></span></div><div class="sub">${z.a} attended · ${z.b} absent · ${z.np} prof didn’t come · target ${u.target}%${u.total?` · ${z.left} of ${u.total} left`:''}</div><div style="font-size:13px;font-weight:700;margin-top:4px">${z.msg}</div></div>`).join('')||'<p class="sub">Add subjects in Timetable Setting to see targets here 🎯</p>';
  const tot=s.a+s.b+s.np,o=pct(s.a,s.a+s.b),d1=tot?s.a/tot*360:0,d2=d1+(tot?s.b/tot*360:0);
  const bar=(t,p,x)=>`<div class="row" style="font-size:14px"><span>${esc(t)}</span><b>${x}</b></div><div class="bar"><i style="width:${p||0}%"></i></div>`;
  const seg=(n,c)=>n?`<div style="height:${n/mx*100}%;background:var(${c})"></div>`:'';
  const mo=Object.entries(s.mo).sort().reverse().map(([m,v])=>bar(new Date(m+'-01').toLocaleDateString('en-IN',{month:'long',year:'numeric'}),pct(v.a,v.a+v.b),v.a+' attended · '+pct(v.a,v.a+v.b)+'%')).join('')||'<p class="sub">Nothing marked yet.</p>';
  const sb=Object.entries(sub).sort((x,y)=>x[0].localeCompare(y[0])).map(([n,v])=>bar(n,pct(v.a,v.a+v.b),pct(v.a,v.a+v.b)+'%')).join('')||'<p class="sub">Nothing marked yet.</p>';
  const mk=Object.keys(s.mo).sort(),mpct=m=>pct(s.mo[m].a,s.mo[m].a+s.mo[m].b),mname=(m,o)=>new Date(m+'-01').toLocaleDateString('en-IN',o);
  let mdet='';
  if(ui.mo&&s.mo[ui.mo]){const g={};R.filter(r=>r.date.slice(0,7)===ui.mo&&(r.status==='attended'||r.status==='absent')).forEach(r=>{const q=g[r.subject]||(g[r.subject]={a:0,b:0});r.status==='attended'?q.a++:q.b++});
    mdet=`<div class="item" style="margin-top:10px"><b>${mname(ui.mo,{month:'long',year:'numeric'})}</b><div style="height:8px"></div>${Object.entries(g).sort((x,y)=>x[0].localeCompare(y[0])).map(([n,w])=>{const p=pct(w.a,w.a+w.b),u=subOf(n);return bar(n+(u&&p<u.target?' ⚠️':''),p,`${w.a}/${w.a+w.b} · ${p}%`)}).join('')}</div>`}
  const mchart=mk.length?`<div style="display:flex;gap:8px;overflow-x:auto">${mk.map(m=>`<button class="mcol" data-a="mo:${m}"><b style="color:var(--text)">${mpct(m)}%</b><div class="mt" style="${ui.mo===m?'outline:2px solid var(--pink)':''}"><i style="height:${mpct(m)}%"></i></div>${mname(m,{month:'short'})}</button>`).join('')}</div>${mdet||'<p class="sub" style="margin:8px 0 0">Tap a bar to see subject-wise attendance 👆</p>'}`:'<p class="sub">Nothing marked yet.</p>';
  return `<div class="row" style="justify-content:flex-start;gap:18px;margin:16px 0 0"><div class="donut" style="background:${tot?`conic-gradient(var(--cg) 0 ${d1}deg,var(--cr) ${d1}deg ${d2}deg,var(--ca) ${d2}deg 360deg)`:'var(--bg)'}"><div>${o===null?'–':o+'%'}</div></div>
  <div style="font-size:14px;line-height:2"><div><span class="dot" style="background:var(--cg)"></span>Attended <b>${s.a}</b></div><div><span class="dot" style="background:var(--cr)"></span>Absent <b>${s.b}</b></div><div><span class="dot" style="background:var(--ca)"></span>Prof didn’t come <b>${s.np}</b></div></div></div>
  ${tiles}<div class="h3">This week</div><div class="wk">${wk.map(w=>`<div><div class="col">${seg(w.a,'--cg')}${seg(w.b,'--cr')}${seg(w.p,'--ca')}</div>${w.n}</div>`).join('')}</div>
  <div class="h3">Month by month</div>${mchart}<div class="h3">By subject (vs your target)</div><p class="sub" style="margin:-4px 0 8px">The black line on each bar is your target %. Bar past the line = you’re safe ✅</p>${subCards}`;
}
function greet(){const h=new Date().getHours();return h<12?'Good morning':h<17?'Good afternoon':h<21?'Good evening':'Good night'}

function render(){
  const A=document.getElementById('app');
  if(!authed||(uid&&loaded<3)){A.innerHTML='<p class="center sub" style="margin-top:80px">Loading your cozy space… 🌸</p>';return}
  if(!uid){A.innerHTML=`<div class="card center" style="margin-top:60px"><div style="font-size:48px">🌸</div><h1>My Attendance</h1><p class="sub">Log in to see your lectures</p>
  <button class="pink full" data-a="glogin">Sign in with Google</button><p class="sub">or use email</p>
  <input id="em" type="email" placeholder="Email"><input id="pw" type="password" placeholder="Password (6+ characters)"><button class="full" data-a="elogin">Sign in with email</button><button class="small" data-a="esignup">New here? Create account</button><p class="sub" id="er" style="color:var(--cr);text-transform:capitalize"></p></div>`;return}
  const head=`<div class="row" style="margin-bottom:14px">${ui.page==='home'?'<b style="color:var(--pink);font-size:18px">My Attendance 💗</b>':'<button class="small" data-a="go:home">← Home</button>'}<button class="small" data-a="logout">Log out</button></div>`;
  A.innerHTML=head+(ui.page==='home'?home():ui.page==='tt'?tt():mark());
}
function home(){
  const t=new Date(),L=lecs(key(t)),s=stats();
  const list=L.length?L.map(l=>`<div class="item row" data-a="quick:${l.id}" style="cursor:pointer"><div><b>${esc(l.subject)}</b><div class="sub">${to12(l.start)} – ${to12(l.end)}</div></div>
   <span class="chip ${l.status?'s-'+l.status+' on':''}">${l.status?ST[l.status][0]+' '+ST[l.status][1]:'Not marked'}</span></div>${ui.quick===l.id?quickPanel(l):''}`).join(''):`<p class="sub">${S.tt.length?'No lectures today 🎉':'Add your timetable to see lectures here 🌷'}</p>`;
  const mo=Object.entries(s.mo).sort().reverse().map(([m,v])=>`<div class="mo"><span>${new Date(m+'-01').toLocaleDateString('en-IN',{month:'long',year:'numeric'})}</span><b>${v.a} attended · ${pct(v.a,v.a+v.b)}%</b></div>`).join('')||'<p class="sub">Nothing marked yet.</p>';
  const o=pct(s.a,s.a+s.b);
  return `<h1>${greet()}, ${NAME} 💗</h1><p class="sub" style="font-weight:700;margin:4px 0 14px">${DAYS[t.getDay()]}, ${t.toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}</p>
  <div class="card"><h2>Today’s lectures</h2><p class="sub" style="margin:-6px 0 8px">Tap a lecture to mark it ⚡</p>${list}</div>
  <div class="card"><h2>Your stats</h2><div class="g3"><div class="stat"><b>${s.week}</b><span>attended this week</span></div><div class="stat"><b>${s.np}</b><span>prof didn’t come</span></div><div class="stat"><b>${o===null?'–':o+'%'}</b><span>overall attendance</span></div></div>
  ${charts(s)}</div>
  <button class="pink full" data-a="go:mark">📝 Attendance Marking</button><button class="full" data-a="go:tt">🗓️ Timetable Setting</button>`;
}
function tt(){
  const list=S.tt.filter(t=>t.day===ui.day).sort((a,b)=>a.start.localeCompare(b.start));
  const f=ui.form;
  return `<h1 style="margin-bottom:12px">Timetable 🗓️</h1>
  ${S.tt.length?'':'<div class="card center">🌷 No timetable yet! Pick a day and add your first lecture.<br><br><button class="small" data-a="sample">Load a sample timetable</button></div>'}
  ${subsCard()}<div class="tabs">${[1,2,3,4,5,6].map(d=>`<button class="${d===ui.day?'on':''}" data-a="day:${d}">${DAYS[d].slice(0,3)}</button>`).join('')}</div>
  <div class="card"><h2>${DAYS[ui.day]}</h2>${list.map(t=>`<div class="item row"><div><b>${esc(t.subject)}</b><div class="sub">${to12(t.start)} – ${to12(t.end)}</div></div><div><button class="small" data-a="edtt:${t.id}">✏️</button> <button class="small" data-a="deltt:${t.id}">🗑️</button></div></div>`).join('')||'<p class="sub">No lectures yet.</p>'}</div>
  ${f?`<div class="card"><h2>${f.id?'Edit lecture':'New lecture'}</h2>${S.subs.length?`<select id="f-s">${subOpts(f.subject)}</select>`:'<p class="sub">Add a subject above first 👆</p><input id="f-s" type="hidden" value="">'}<div class="g3" style="grid-template-columns:1fr 1fr"><input id="f-a" type="time" value="${f.start}"><input id="f-b" type="time" value="${f.end}"></div><button class="pink full" data-a="savett">Save</button><button class="full" data-a="cancel">Cancel</button></div>`
  :'<button class="pink full" data-a="addtt">＋ Add lecture</button>'}`;
}
function mark(){
  const k=ui.date,L=lecs(k);
  return `<h1 style="margin-bottom:12px">Mark attendance 📝</h1><div class="card row"><button data-a="prev">‹</button><div class="center"><b>${DAYS[parse(k).getDay()]}</b><br><input type="date" value="${k}" data-a="date" style="width:auto;margin:4px 0 0;padding:6px"></div><button data-a="next">›</button></div>
  ${L.length?'':'<div class="card center sub">No lectures on this day 🌷 Add an extra one below if needed.</div>'}
  ${L.map(l=>`<div class="card">${ui.edit===l.id?`<input id="e-s" list="sl" value="${esc(l.subject)}"><datalist id="sl">${S.subs.map(u=>`<option value="${esc(u.name)}">`).join('')}</datalist><div class="g3" style="grid-template-columns:1fr 1fr"><input id="e-a" type="time" value="${l.start}"><input id="e-b" type="time" value="${l.end}"></div><button class="pink full" data-a="savelec:${l.id}">Save for this day</button>`
  :`<div class="row" style="margin-bottom:10px"><div><b style="font-size:18px">${esc(l.subject)}</b><div class="sub">${to12(l.start)} – ${to12(l.end)}</div></div><div><button class="small" data-a="edlec:${l.id}">✏️</button>${l.ttId?'':` <button class="small" data-a="dellec:${l.id}">🗑️</button>`}</div></div>`}
  <div class="g3" style="margin-bottom:10px">${Object.entries(ST).map(([s,v])=>`<button class="st s-${s} ${l.status===s?'on':''}" data-a="st:${l.id}:${s}"><i>${v[0]}</i>${v[1]}</button>`).join('')}</div>
  <textarea rows="3" placeholder="What was done in this lecture? ✍️" data-a="note:${l.id}">${esc(l.note||'')}</textarea></div>`).join('')}
  <button class="full" data-a="addx">＋ Add extra lecture</button>`;
}
// Save one lecture's record for one date (base timetable is never changed)
function rec(id,patch,dt){dt=dt||ui.date;
  const l=lecs(dt).find(x=>x.id===id);
  S.rec[id]={date:dt,subject:l.subject,start:l.start,end:l.end,ttId:l.ttId||null,status:l.status||null,note:l.note||'',...(S.rec[id]||{}),id,...patch};persist();
}
const v=id=>document.getElementById(id).value;
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-a]');if(!b||b.tagName==='TEXTAREA'||b.tagName==='INPUT')return;
  const[a,x,y]=b.dataset.a.split(':');
  if(a==='addsub')ui.sf={name:'',type:'Lecture',target:75,total:''};
  else if(a==='edsub')ui.sf={...S.subs.find(u=>u.id===x)};
  else if(a==='cancelsub')ui.sf=null;
  else if(a==='savesub'){const n=v('u-n').trim(),p=+v('u-p');if(!n||!(p>0&&p<=100))return alert('Add a name and a target between 1 and 100');const d={name:n,type:v('u-t'),target:p,total:+v('u-c')||0};
    if(ui.sf.id){const u=S.subs.find(q=>q.id===ui.sf.id),old=u.name;Object.assign(u,d);if(sk(old)!==sk(n)){S.tt.forEach(t=>{if(sk(t.subject)===sk(old))t.subject=n});Object.values(S.rec).forEach(r=>{if(sk(r.subject)===sk(old))r.subject=n})}}else S.subs.push({id:'u'+Date.now(),...d});ui.sf=null}
  else if(a==='delsub'){if(!confirm('Delete this subject? Past attendance stays safe.'))return;S.subs=S.subs.filter(u=>u.id!==x)}
  else if(a==='mo')ui.mo=ui.mo===x?null:x;
  else if(a==='quick')ui.quick=ui.quick===x?null:x;
  else if(a==='qs'){const t=key(new Date()),cur=lecs(t).find(l=>l.id===x).status;rec(x,{status:cur===y?null:y},t);ui.quick=null}
  else if(a==='more'){ui.date=key(new Date());ui.page='mark';ui.quick=null}
  else if(a==='glogin')return signInWithPopup(auth,gp).catch(authErr);
  else if(a==='elogin'||a==='esignup')return (a==='esignup'?createUserWithEmailAndPassword:signInWithEmailAndPassword)(auth,v('em'),v('pw')).catch(authErr);
  else if(a==='logout')return signOut(auth);
  else if(a==='go'){ui.page=x==='tt'?'tt':x==='mark'?'mark':'home';ui.form=null;ui.edit=null}
  else if(a==='sample'){S.subs=[{id:'u1',name:'Data Structures',type:'Lecture',target:75,total:40},{id:'u2',name:'Microprocessors',type:'Lecture',target:75,total:40},{id:'u3',name:'Data Communication',type:'Lecture',target:60,total:30},{id:'u4',name:'DS Lab',type:'Lab',target:80,total:12}];const z=(d,s,a,b)=>({id:'s'+d+a,day:d,subject:s,start:a,end:b});S.tt=[1,2,3,4,5,6].flatMap(d=>[z(d,'Data Structures','09:00','10:00'),z(d,'Microprocessors','10:15','11:15'),z(d,'Data Communication','11:30','12:30')])}
  else if(a==='day'){ui.day=+x;ui.form=null}
  else if(a==='addtt')ui.form={subject:'',start:'09:00',end:'10:00'};
  else if(a==='edtt')ui.form={...S.tt.find(t=>t.id===x)};
  else if(a==='cancel')ui.form=null;
  else if(a==='savett'){if(!v('f-s').trim())return;const d={day:ui.day,subject:v('f-s').trim(),start:v('f-a'),end:v('f-b')};
    if(ui.form.id)Object.assign(S.tt.find(t=>t.id===ui.form.id),d);else S.tt.push({id:'t'+Date.now(),...d});ui.form=null}
  else if(a==='deltt'){if(!confirm('Delete this lecture? Past attendance stays safe.'))return;S.tt=S.tt.filter(t=>t.id!==x)}
  else if(a==='prev')ui.date=add(ui.date,-1);
  else if(a==='next')ui.date=add(ui.date,1);
  else if(a==='st'){const cur=lecs(ui.date).find(l=>l.id===x).status;rec(x,{status:cur===y?null:y})}
  else if(a==='edlec')ui.edit=x;
  else if(a==='savelec'){rec(x,{subject:v('e-s'),start:v('e-a'),end:v('e-b')});ui.edit=null}
  else if(a==='addx'){const id=ui.date+'_x'+Date.now();S.rec[id]={id,date:ui.date,subject:'Extra lecture',start:'09:00',end:'10:00',ttId:null,status:null,note:''};ui.edit=id}
  else if(a==='dellec'){delete S.rec[x]}
  persist();render();
});
document.addEventListener('change',e=>{
  const t=e.target,a=(t.dataset.a||'').split(':');
  if(a[0]==='date'&&t.value){ui.date=t.value;render()}
  if(a[0]==='note'){rec(a[1],{note:t.value})}
});

// Compare local state with what Firestore last gave us and write only what changed
function persist(){
  if(!uid)return;
  const cur={tt:Object.fromEntries(S.tt.map(x=>[x.id,x])),subs:Object.fromEntries(S.subs.map(x=>[x.id,x])),rec:S.rec};
  for(const k in COL){
    for(const id in cur[k]){const j=J(cur[k][id]);if(last[k][id]!==j){last[k][id]=j;const{id:_,...d}=cur[k][id];setDoc(doc(db,'users',uid,COL[k],id),d).catch(console.error)}}
    for(const id in last[k])if(!(id in cur[k])){delete last[k][id];deleteDoc(doc(db,'users',uid,COL[k],id)).catch(console.error)}
  }
}
// Login gate + live listeners on this user's own data only
onAuthStateChanged(auth,u=>{
  unsubs.forEach(f=>f());unsubs=[];S={tt:[],rec:{},subs:[]};last={tt:{},subs:{},rec:{}};loaded=0;authed=true;
  uid=u?u.uid:null;NAME=(u&&u.displayName&&u.displayName.split(' ')[0])||'Nika';
  if(u)for(const k in COL)unsubs.push(onSnapshot(collection(db,'users',uid,COL[k]),snap=>{
    const items=snap.docs.map(d=>({id:d.id,...d.data()}));
    last[k]={};items.forEach(x=>last[k][x.id]=J(x));
    if(k==='rec'){S.rec={};items.forEach(x=>S.rec[x.id]=x)}else S[k]=items;
    loaded++;render();
  }));
  render();
});
