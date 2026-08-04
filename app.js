import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import {
  getFirestore, collection, doc, setDoc, addDoc, deleteDoc,
  onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js?v=1';

const OWNER_EMAIL = 'mh.makrostore@gmail.com';
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const $ = id => document.getElementById(id);
const r = {
  loading:$('loading'), loginView:$('loginView'), appView:$('appView'),
  loginBtn:$('loginBtn'), logoutBtn:$('logoutBtn'), loginMessage:$('loginMessage'),
  userEmail:$('userEmail'), appTitle:$('appTitle'),
  catalogSearch:$('catalogSearch'), catalogCategory:$('catalogCategory'),
  catalogAvailability:$('catalogAvailability'), exportBtn:$('exportBtn'),
  catalogEmpty:$('catalogEmpty'), catalogGrid:$('catalogGrid'),
  formTitle:$('formTitle'), editingId:$('editingId'), barcode:$('barcode'),
  scanBtn:$('scanBtn'), scannerVideo:$('scannerVideo'), stopScanBtn:$('stopScanBtn'),
  productName:$('productName'), price:$('price'), expiryDate:$('expiryDate'),
  quantity:$('quantity'), location:$('location'), category:$('category'),
  available:$('available'), featured:$('featured'), notes:$('notes'),
  photoInput:$('photoInput'), photoPreview:$('photoPreview'),
  saveBtn:$('saveBtn'), cancelEditBtn:$('cancelEditBtn'), formMessage:$('formMessage'),
  manageSearch:$('manageSearch'), manageList:$('manageList'),
  expiredCount:$('expiredCount'), soonCount:$('soonCount'), goodCount:$('goodCount'),
  totalCount:$('totalCount'), thtSearch:$('thtSearch'), thtStatus:$('thtStatus'),
  thtList:$('thtList'), settingTitle:$('settingTitle'),
  settingSubtitle:$('settingSubtitle'), saveSettingsBtn:$('saveSettingsBtn'),
  settingsMessage:$('settingsMessage')
};

let products = [], photoData = '', stream = null, scanning = false;
let settings = { title:'MSFK Verkoop & THT', subtitle:'Privé productcatalogus' };

function msg(el,text,error=false){ el.textContent=text; el.style.color=error?'#b91c1c':'#15803d'; }
function safe(v){ return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function daysLeft(dateStr){
  if(!dateStr) return null;
  const today=new Date(); today.setHours(0,0,0,0);
  const d=new Date(dateStr+'T00:00:00');
  return Math.ceil((d-today)/86400000);
}
function statusOf(dateStr){
  const d=daysLeft(dateStr);
  if(d===null) return 'nodate';
  if(d<0) return 'expired';
  if(d<=30) return 'soon';
  return 'good';
}
function statusText(dateStr){
  const s=statusOf(dateStr), d=daysLeft(dateStr);
  if(s==='expired') return `Verlopen (${Math.abs(d)} dagen)`;
  if(s==='soon') return `${d} dagen over`;
  if(s==='good') return `${d} dagen over`;
  return 'Geen datum';
}
async function compressImage(file){
  const data=await new Promise((ok,no)=>{const fr=new FileReader();fr.onload=()=>ok(fr.result);fr.onerror=no;fr.readAsDataURL(file);});
  const im=await new Promise((ok,no)=>{const x=new Image();x.onload=()=>ok(x);x.onerror=no;x.src=data;});
  const max=700, scale=Math.min(1,max/Math.max(im.width,im.height));
  const c=document.createElement('canvas'); c.width=Math.round(im.width*scale); c.height=Math.round(im.height*scale);
  c.getContext('2d').drawImage(im,0,0,c.width,c.height);
  return c.toDataURL('image/jpeg',.68);
}
function rebuildCategories(){
  const current=r.catalogCategory.value;
  const cats=[...new Set(products.map(p=>p.category||'Overig'))].sort();
  r.catalogCategory.innerHTML='<option value="all">Alle categorieën</option>'+cats.map(c=>`<option value="${safe(c)}">${safe(c)}</option>`).join('');
  if(cats.includes(current)) r.catalogCategory.value=current;
}
function filteredCatalog(){
  const q=r.catalogSearch.value.toLowerCase(), cat=r.catalogCategory.value, av=r.catalogAvailability.value;
  return products.filter(p=>{
    const text=`${p.name||''} ${p.barcode||''} ${p.category||''} ${p.notes||''}`.toLowerCase();
    if(q&&!text.includes(q)) return false;
    if(cat!=='all'&&(p.category||'Overig')!==cat) return false;
    if(av==='available'&&p.available===false) return false;
    if(av==='soldout'&&p.available!==false) return false;
    return true;
  }).sort((a,b)=>(Number(!!b.featured)-Number(!!a.featured))||String(a.name||'').localeCompare(String(b.name||''),'nl'));
}
function renderCatalog(){
  const list=filteredCatalog(); r.catalogGrid.innerHTML=''; r.catalogEmpty.classList.toggle('hidden',list.length>0);
  for(const p of list){
    const card=document.createElement('article'); card.className='card';
    card.innerHTML=`<div class="photo-wrap">${p.photoData?`<img src="${p.photoData}" alt="${safe(p.name)}">`:'<div class="placeholder">Geen foto</div>'}<span class="badge">${p.available===false?'Uitverkocht':'Beschikbaar'}</span></div><div class="card-body"><div class="category-label">${safe(p.category||'Overig')}</div><h2>${safe(p.name||'Naamloos product')}</h2><div class="meta">${p.barcode?`Barcode: ${safe(p.barcode)}<br>`:''}${p.expiryDate?`THT: ${safe(p.expiryDate)}<br>`:''}Aantal: ${Number(p.quantity||0)} · ${safe(p.location||'')}</div><div class="price">CG ${Number(p.price||0).toFixed(2)}</div></div>`;
    r.catalogGrid.appendChild(card);
  }
}
function renderManage(){
  const q=r.manageSearch.value.toLowerCase(), list=products.filter(p=>`${p.name||''} ${p.barcode||''}`.toLowerCase().includes(q)).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'nl'));
  r.manageList.innerHTML=list.length?'':'<div class="meta">Nog geen producten.</div>';
  for(const p of list){
    const row=document.createElement('div'); row.className='manage-row';
    row.innerHTML=`${p.photoData?`<img src="${p.photoData}" alt="">`:'<div class="row-placeholder">Geen foto</div>'}<div><h3>${safe(p.name)}</h3><div class="meta">CG ${Number(p.price||0).toFixed(2)} · ${safe(p.category||'Overig')}<br>${p.expiryDate?`THT: ${safe(p.expiryDate)} · `:''}Aantal: ${Number(p.quantity||0)}</div></div><div class="actions"><button class="btn light" data-edit="${p.id}">Bewerken</button><button class="btn light" data-delete="${p.id}">Verwijderen</button></div>`;
    r.manageList.appendChild(row);
  }
  r.manageList.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editProduct(b.dataset.edit));
  r.manageList.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(confirm('Product verwijderen?'))await deleteDoc(doc(db,'catalogProducts',b.dataset.delete));});
}
function renderTHT(){
  const counts={expired:0,soon:0,good:0,nodate:0};
  products.forEach(p=>counts[statusOf(p.expiryDate)]++);
  r.expiredCount.textContent=counts.expired; r.soonCount.textContent=counts.soon; r.goodCount.textContent=counts.good; r.totalCount.textContent=products.length;
  const q=r.thtSearch.value.toLowerCase(), filter=r.thtStatus.value;
  const list=products.filter(p=>{
    const text=`${p.name||''} ${p.barcode||''}`.toLowerCase();
    return(!q||text.includes(q))&&(filter==='all'||statusOf(p.expiryDate)===filter);
  }).sort((a,b)=>(a.expiryDate||'9999').localeCompare(b.expiryDate||'9999'));
  r.thtList.innerHTML=list.length?'':'<div class="empty">Geen producten gevonden.</div>';
  for(const p of list){
    const st=statusOf(p.expiryDate), row=document.createElement('div'); row.className='tht-row';
    row.innerHTML=`${p.photoData?`<img src="${p.photoData}" style="width:88px;height:88px;object-fit:cover;border-radius:12px" alt="">`:'<div class="row-placeholder">Geen foto</div>'}<div><h3>${safe(p.name)}</h3><div class="meta">${p.barcode?`Barcode: ${safe(p.barcode)} · `:''}THT: ${safe(p.expiryDate||'Geen datum')}<br>Aantal: ${Number(p.quantity||0)} · ${safe(p.location||'')}</div></div><div class="status ${st}">${statusText(p.expiryDate)}</div>`;
    r.thtList.appendChild(row);
  }
}
function resetForm(){
  r.editingId.value='';r.barcode.value='';r.productName.value='';r.price.value='';r.expiryDate.value='';r.quantity.value='1';r.location.value='Winkel';r.category.value='';r.available.checked=true;r.featured.checked=false;r.notes.value='';r.photoInput.value='';r.photoPreview.src='';r.photoPreview.classList.add('hidden');photoData='';r.formTitle.textContent='Nieuw product';r.cancelEditBtn.classList.add('hidden');
}
function editProduct(id){
  const p=products.find(x=>x.id===id); if(!p)return;
  r.editingId.value=id;r.barcode.value=p.barcode||'';r.productName.value=p.name||'';r.price.value=p.price??'';r.expiryDate.value=p.expiryDate||'';r.quantity.value=p.quantity??1;r.location.value=p.location||'Winkel';r.category.value=p.category||'';r.available.checked=p.available!==false;r.featured.checked=!!p.featured;r.notes.value=p.notes||'';photoData=p.photoData||'';
  if(photoData){r.photoPreview.src=photoData;r.photoPreview.classList.remove('hidden');}
  r.formTitle.textContent='Product aanpassen';r.cancelEditBtn.classList.remove('hidden');document.querySelector('[data-tab="add"]').click();scrollTo({top:100,behavior:'smooth'});
}
async function startScanner(){
  if(!navigator.mediaDevices?.getUserMedia){return msg(r.formMessage,'Camera wordt niet ondersteund.',true);}
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    r.scannerVideo.srcObject=stream; await r.scannerVideo.play(); r.scannerVideo.classList.remove('hidden');r.stopScanBtn.classList.remove('hidden');scanning=true;
    if('BarcodeDetector' in window){
      const detector=new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e','code_128']});
      const loop=async()=>{if(!scanning)return;try{const codes=await detector.detect(r.scannerVideo);if(codes.length){r.barcode.value=codes[0].rawValue;stopScanner();msg(r.formMessage,'Barcode gescand.');return;}}catch{}requestAnimationFrame(loop);};loop();
    }else{msg(r.formMessage,'Automatisch scannen wordt niet ondersteund. Typ de barcode handmatig.',true);}
  }catch(e){msg(r.formMessage,'Camera kon niet worden geopend.',true);}
}
function stopScanner(){scanning=false;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}r.scannerVideo.classList.add('hidden');r.stopScanBtn.classList.add('hidden');}
function exportCSV(){
  const rows=[['Product','Barcode','Prijs CG','THT','Aantal','Locatie','Categorie','Beschikbaar']];
  products.forEach(p=>rows.push([p.name||'',p.barcode||'',Number(p.price||0).toFixed(2),p.expiryDate||'',p.quantity||0,p.location||'',p.category||'',p.available===false?'Nee':'Ja']));
  const csv=rows.map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='MSFK-producten.csv';a.click();URL.revokeObjectURL(a.href);
}
document.querySelectorAll('.tabs button').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.tabs button').forEach(b=>b.classList.remove('active'));document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');document.getElementById(btn.dataset.tab).classList.add('active');});
r.loginBtn.onclick=async()=>{try{await signInWithPopup(auth,provider);}catch(e){if(e.code==='auth/popup-blocked')await signInWithRedirect(auth,provider);else msg(r.loginMessage,'Inloggen mislukt: '+e.message,true);}};
r.logoutBtn.onclick=()=>signOut(auth);r.scanBtn.onclick=startScanner;r.stopScanBtn.onclick=stopScanner;
r.photoInput.onchange=async()=>{const file=r.photoInput.files?.[0];if(!file)return;try{photoData=await compressImage(file);r.photoPreview.src=photoData;r.photoPreview.classList.remove('hidden');msg(r.formMessage,'Foto klaar.');}catch{msg(r.formMessage,'Foto kon niet worden verwerkt.',true);}};
r.saveBtn.onclick=async()=>{const name=r.productName.value.trim(),price=Number(r.price.value);if(!name)return msg(r.formMessage,'Vul productnaam in.',true);if(!Number.isFinite(price))return msg(r.formMessage,'Vul een geldige prijs in.',true);
  const data={barcode:r.barcode.value.trim(),name,price,expiryDate:r.expiryDate.value,quantity:Number(r.quantity.value||0),location:r.location.value,category:r.category.value.trim()||'Overig',available:r.available.checked,featured:r.featured.checked,notes:r.notes.value.trim(),photoData,updatedAt:serverTimestamp()};
  try{if(r.editingId.value)await setDoc(doc(db,'catalogProducts',r.editingId.value),data,{merge:true});else await addDoc(collection(db,'catalogProducts'),{...data,createdAt:serverTimestamp()});msg(r.formMessage,'Product opgeslagen.');resetForm();}catch(e){msg(r.formMessage,'Opslaan mislukt: '+e.message,true);}
};
r.cancelEditBtn.onclick=resetForm;r.exportBtn.onclick=exportCSV;
r.catalogSearch.oninput=renderCatalog;r.catalogCategory.onchange=renderCatalog;r.catalogAvailability.onchange=renderCatalog;r.manageSearch.oninput=renderManage;r.thtSearch.oninput=renderTHT;r.thtStatus.onchange=renderTHT;
r.saveSettingsBtn.onclick=async()=>{try{await setDoc(doc(db,'publicSettings','catalog'),{title:r.settingTitle.value.trim()||'MSFK Verkoop & THT',subtitle:r.settingSubtitle.value.trim(),updatedAt:serverTimestamp()},{merge:true});msg(r.settingsMessage,'Instellingen opgeslagen.');}catch(e){msg(r.settingsMessage,e.message,true);}};
getRedirectResult(auth).catch(e=>msg(r.loginMessage,e.message,true));
onAuthStateChanged(auth,user=>{r.loading.classList.add('hidden');if(!user){r.loginView.classList.remove('hidden');r.appView.classList.add('hidden');return;}if((user.email||'').toLowerCase()!==OWNER_EMAIL){signOut(auth);r.loginView.classList.remove('hidden');msg(r.loginMessage,'Dit account heeft geen toegang.',true);return;}r.loginView.classList.add('hidden');r.appView.classList.remove('hidden');r.userEmail.textContent=user.email;
  onSnapshot(doc(db,'publicSettings','catalog'),snap=>{if(snap.exists())settings={...settings,...snap.data()};r.appTitle.textContent=settings.title;r.settingTitle.value=settings.title;r.settingSubtitle.value=settings.subtitle;document.title=settings.title;});
  onSnapshot(collection(db,'catalogProducts'),snap=>{products=snap.docs.map(d=>({id:d.id,...d.data()}));rebuildCategories();renderCatalog();renderManage();renderTHT();},e=>msg(r.formMessage,e.message,true));
});
