/* Reco Invest — recommandations d'investissement.
 * Sources :
 *   1) Sentiment : flux RSS du magazine Le Revenu (titres + chapôs).
 *   2) Quant : cours réels Yahoo Finance → indicateurs techniques répandus
 *      (SMA 20/50/200, RSI 14, MACD 12-26-9, momentum, volatilité).
 * Reco = combinaison sentiment presse + signal technique.
 * Portefeuille saisi à la main + règles de revente semi-auto (alertes) :
 *   stop-loss, take-profit, RSI de surachat, objectif de cours.
 *   L'app décide/alacte quand vendre ; l'exécution reste manuelle chez le courtier
 *   (Boursorama n'expose aucune API de passage d'ordres).
 * 100 % côté client, cache localStorage. Voir disclaimer : aucun conseil.
 */
'use strict';

const APP_VERSION = '1.05';   // ← synchronisé par la CI depuis build.gradle (versionName)
window.APP_VERSION = APP_VERSION;   // source unique pour update-check.js (bannière MAJ)
const PROXY  = 'https://api.allorigins.win/raw?url=';
const RSS    = 'https://www.lerevenu.com/rss.xml';
const CAFEYN = 'https://www.cafeyn.co/fr/magazines/le-revenu-2';
const YF     = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const K_ITEMS = 'recoInvest:items';
const K_QUOTE = 'recoInvest:quotes';
const K_PORT  = 'recoInvest:portfolio';
const K_TARG  = 'recoInvest:targets';
const K_CONS  = 'recoInvest:consensus';
const K_GNEWS = 'recoInvest:gnews';
const MIN_ANALYSTS = 5;   // consensus retenu seulement si ≥ 5 analystes
const GNEWS = 'https://news.google.com/rss/search?hl=fr&gl=FR&ceid=FR:fr&q=';

/* ---------- Lexique de sentiment (fr) ---------- */
const POS = ['bondit','bondissent','rebond','rebondit','relève','relèvent','surperform','hausse',
  'record','dividende','augmente','progresse','progression','dépasse','meilleur que prévu','croissance',
  'à l\'achat','recommande d\'acheter','objectif relevé','gagne','accélère','succès','tabac','boost',
  'renforce','renforcé','partenariat','contrat','commande','entrée en bourse','réussit','optimiste',
  'soutenu','favorable','bénéfice'];
const NEG = ['chute','chutent','décroche','décrochage','profit warning','avertissement','abaisse',
  'abaissent','recul','recule','perd du terrain','sous pression','correction','alerte','baisse',
  'difficulté','menace','menacé','menacent','grève','rejette','rejeter','ralentissement','incertitude',
  'tensions','risque','déficit','crise','plonge','sanction','condamné','perte'];

/* ---------- Valeurs cotées : nom, alias, ticker Yahoo ---------- */
const ENTITIES = [
  ['Sodexo',['sodexo'],'SW.PA'],['Thales',['thales'],'HO.PA'],['Airbus',['airbus'],'AIR.PA'],
  ['Amundi',['amundi'],'AMUN.PA'],['Ipsen',['ipsen'],'IPN.PA'],['Renault',['renault'],'RNO.PA'],
  ['Stellantis',['stellantis'],'STLAP.PA'],['LVMH',['lvmh'],'MC.PA'],['Hermès',['hermès','hermes'],'RMS.PA'],
  ['Kering',['kering'],'KER.PA'],['L\'Oréal',['oréal','l\'oreal'],'OR.PA'],['TotalEnergies',['totalenergies'],'TTE.PA'],
  ['Sanofi',['sanofi'],'SAN.PA'],['BNP Paribas',['bnp paribas'],'BNP.PA'],['Société Générale',['société générale'],'GLE.PA'],
  ['Crédit Agricole',['crédit agricole'],'ACA.PA'],['Air Liquide',['air liquide'],'AI.PA'],['Schneider Electric',['schneider'],'SU.PA'],
  ['Vinci',['vinci'],'DG.PA'],['Orange',['orange sa'],'ORA.PA'],['Danone',['danone'],'BN.PA'],
  ['Pernod Ricard',['pernod'],'RI.PA'],['Saint-Gobain',['saint-gobain'],'SGO.PA'],['Michelin',['michelin'],'ML.PA'],
  ['Capgemini',['capgemini'],'CAP.PA'],['Engie',['engie'],'ENGI.PA'],['Veolia',['veolia'],'VIE.PA'],
  ['Publicis',['publicis'],'PUB.PA'],['STMicroelectronics',['stmicro','stmicroelectronics'],'STMPA.PA'],
  ['Legrand',['legrand'],'LR.PA'],['Safran',['safran'],'SAF.PA'],['Carrefour',['carrefour'],'CA.PA'],
  ['Alstom',['alstom'],'ALO.PA'],['Worldline',['worldline'],'WLN.PA'],['Accor',['accor'],'AC.PA'],
  ['Teleperformance',['teleperformance'],'TEP.PA'],['Bureau Veritas',['bureau veritas'],'BVI.PA'],
  ['Edenred',['edenred'],'EDEN.PA'],['EssilorLuxottica',['essilor'],'EL.PA'],['Bouygues',['bouygues'],'EN.PA'],
  ['Nexity',['nexity'],'NXI.PA'],['Dassault Systèmes',['dassault systèmes','dassault systemes'],'DSY.PA'],
  ['Volkswagen',['volkswagen'],'VOW3.DE'],['Mercedes-Benz',['mercedes'],'MBG.DE'],['Hugo Boss',['hugo boss'],'BOSS.DE'],
  ['Nordex',['nordex'],'NDX1.DE'],['Nokia',['nokia'],'NOKIA.HE'],['Nvidia',['nvidia'],'NVDA'],
  ['Apple',['apple'],'AAPL'],['Microsoft',['microsoft'],'MSFT'],['Tesla',['tesla'],'TSLA'],['Boeing',['boeing'],'BA']
];
const byName = Object.fromEntries(ENTITIES.map(e=>[e[0],e]));

/* ---------- Thématiques ---------- */
const THEMES = [
  ['SCPI / Immobilier','🏢',['scpi','immobilier','pierre-papier','logement','promoteur','foncière']],
  ['ETF / Trackers','📈',['etf','tracker','indice','msci','cac 40','cac40','s&p','nasdaq']],
  ['Assurance-vie','🛡️',['assurance-vie','fonds euros','fonds en euros','unités de compte']],
  ['Livrets / Épargne','💶',['livret','lep','livret a','pel','épargne réglementée']],
  ['Obligations / Taux','📉',['obligation','dette','taux','bce','fed','rendement obligataire','emprunt']],
  ['Or / Matières prem.','🥇',['or ','métaux précieux','pétrole','gaz','baril','matières premières']],
  ['Crypto / Actifs num.','₿',['crypto','bitcoin','ethereum','blockchain','quantique']],
  ['Défense / Aéro','🛰️',['défense','militaire','armement','aviation','aérospatial']],
  ['IA / Tech','🤖',['intelligence artificielle',' ia ','ia,','semi-conducteur','data center']]
];

/* ---------- Allocation par profil ---------- */
const ALLOC = {
  prudent:{label:'Prudent',rows:[['Fonds euros / AV',35,'#38bdf8'],['Livrets (LEP 3,5 %)',25,'#22c55e'],['SCPI / Immobilier',20,'#f59e0b'],['ETF actions World',15,'#818cf8'],['Or / diversif.',5,'#eab308']],
    note:'Capital protégé prioritaire. Livrets réglementés et fonds euros sécurisés, exposition actions minimale via ETF World.'},
  equilibre:{label:'Équilibré',rows:[['ETF actions World',40,'#818cf8'],['AV fonds euros',25,'#38bdf8'],['SCPI / Immobilier',20,'#f59e0b'],['Obligations / Taux',10,'#22c55e'],['Or / diversif.',5,'#eab308']],
    note:'Équilibre rendement/risque. Cœur ETF World, poche SCPI pour le revenu, coussin obligataire et fonds euros.'},
  dynamique:{label:'Dynamique',rows:[['ETF World + thématiques',60,'#818cf8'],['Actions en direct',15,'#38bdf8'],['SCPI / Immobilier',12,'#f59e0b'],['Or / diversif.',8,'#eab308'],['Crypto (spéculatif)',5,'#ef4444']],
    note:'Performance long terme, tolérance à la volatilité. Forte expo actions + stock-picking sur les signaux, poche crypto limitée.'}
};

/* ---------- Template de départ (affiché au 1er lancement / hors-ligne) ---------- */
const SEED_ITEMS = [
  {title:"Pourquoi l'action Sodexo bondit en bourse après des résultats trimestriels qui surprennent les analystes", desc:"Sodexo relève ses objectifs annuels après un troisième trimestre meilleur que prévu. L'action bondit.", link:"https://www.lerevenu.com/bourse"},
  {title:"Thales : plus de capacité de production pour répondre à la hausse des besoins en équipements militaires en Europe", desc:"Thales augmente ses capacités, porté par la demande de défense en Europe.", link:"https://www.lerevenu.com/bourse"},
  {title:"Les éoliennes allemandes Nordex font un tabac aux États-Unis", desc:"Nordex enregistre un succès commercial croissant aux États-Unis.", link:"https://www.lerevenu.com/bourse"},
  {title:"Nokia accélère dans l'IA de défense avec un partenariat renforcé avec NestAI", desc:"Nokia renforce un partenariat stratégique dans l'intelligence artificielle de défense.", link:"https://www.lerevenu.com/bourse"},
  {title:"Airbus réduit ses perspectives de demande mondiale d'avions commerciaux", desc:"Airbus abaisse ses prévisions de demande, prudence sur le marché aérien.", link:"https://www.lerevenu.com/bourse"},
  {title:"Automobile : Mercedes-Benz perd du terrain face aux constructeurs chinois sur le marché premium", desc:"Mercedes-Benz recule au deuxième trimestre sous la pression de la concurrence chinoise.", link:"https://www.lerevenu.com/bourse"},
  {title:"L'avenir de Volkswagen se joue dans la douleur et la difficulté", desc:"Volkswagen traverse une période de difficulté et de restructuration.", link:"https://www.lerevenu.com/bourse"},
  {title:"Revolut franchit les 8 millions de clients en France et prépare son offensive sur le crédit immobilier", desc:"Revolut accélère sa croissance et vise le crédit immobilier.", link:"https://www.lerevenu.com/bourse"},
  {title:"Classement des promoteurs : Nexity, Altarea et Bouygues Immobilier restent en tête malgré la crise", desc:"L'immobilier reste sous pression mais les leaders conservent leurs positions.", link:"https://www.lerevenu.com/immobilier"},
  {title:"Bulle de l'IA en Bourse : le FMI alerte sur un risque de correction", desc:"Le FMI abaisse sa croissance mondiale et alerte sur un risque de correction de la bulle de l'IA en Bourse.", link:"https://www.lerevenu.com/bourse"},
];

/* ================= State ================= */
let ITEMS = [];            // articles Le Revenu
let QUOTES = {};           // ticker → {price, sma20,sma50,sma200, rsi, macd, sig, m1,m3,m6, vol, ts}
let PORT = [];             // positions
let TARGETS = {};          // nom valeur → {target, link, ts}  (objectif de cours Le Revenu)
let CONS = {};             // ticker → {key, mean, target, n, ts}  (consensus analystes mondial)
let GN = {};               // nom valeur → {score, n, ts}  (sentiment presse mondiale Google News)

try{ PORT = JSON.parse(localStorage.getItem(K_PORT)||'[]'); }catch(e){ PORT=[]; }
try{ QUOTES = JSON.parse(localStorage.getItem(K_QUOTE)||'{}'); }catch(e){ QUOTES={}; }
try{ TARGETS = JSON.parse(localStorage.getItem(K_TARG)||'{}'); }catch(e){ TARGETS={}; }
try{ CONS = JSON.parse(localStorage.getItem(K_CONS)||'{}'); }catch(e){ CONS={}; }
try{ GN = JSON.parse(localStorage.getItem(K_GNEWS)||'{}'); }catch(e){ GN={}; }

/* ================= Utils ================= */
const $ = s=>document.querySelector(s);
const esc = s=>(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const stripTags = s=>(s||'').replace(/<[^>]+>/g,'').replace(/&[a-z]+;/gi,' ').trim();
const fmt = n=>n==null?'—':n.toLocaleString('fr-FR',{maximumFractionDigits:2});
const savePort = ()=>localStorage.setItem(K_PORT,JSON.stringify(PORT));

/* ================= RSS ================= */
async function fetchRss(){
  const get = async u=>{ const r=await fetch(u,{cache:'no-store'}); if(!r.ok) throw new Error(r.status); return r.text(); };
  let xml;
  try{ xml = await get(RSS); } catch(e){ xml = await get(PROXY+encodeURIComponent(RSS)); }
  const doc = new DOMParser().parseFromString(xml,'text/xml');
  const items = [...doc.querySelectorAll('item')].map(it=>({
    title: stripTags(it.querySelector('title')?.textContent).replace(/>$/,''),
    desc:  stripTags(it.querySelector('description')?.textContent),
    link:  it.querySelector('link')?.textContent?.trim()||'',
  })).filter(i=>i.title);
  if(!items.length) throw new Error('flux vide');
  return items;
}

/* ---------- Objectifs de cours (scraping éditorial gratuit lerevenu.com) ---------- */
// Le corps des articles conseils/avis est server-rendered → extraction d'un objectif chiffré.
function parseTarget(txt){
  const pats=[
    /objectif de cours\s*:?\s*(?:port[ée]e?\s*[àa]\s*)?([\d  .]+(?:,\d+)?)\s*(?:euros?|€)/i,
    /objectif\s*(?:de cours)?\s*(?:port[ée]e?\s*)?[àa:]\s*([\d  .]+(?:,\d+)?)\s*(?:euros?|€)/i,
    /cours cible\s*(?:de\s*)?[:]?\s*([\d  .]+(?:,\d+)?)\s*(?:euros?|€)/i,
    /valoris[ee]\s+(?:l['e]?\s*\w+\s+)?[àa]\s*([\d  .]+(?:,\d+)?)\s*(?:euros?|€)/i,
  ];
  for(const re of pats){
    const m=txt.match(re);
    if(m){ const n=parseFloat(m[1].replace(/[  .\s]/g,'').replace(',','.')); if(n>0&&n<100000) return n; }
  }
  return null;
}

async function fetchArticleText(link){
  const get=async u=>{ const r=await fetch(u,{cache:'no-store'}); if(!r.ok) throw new Error(r.status); return r.text(); };
  let html; try{ html=await get(link); }catch(e){ html=await get(PROXY+encodeURIComponent(link)); }
  return html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ')
             .replace(/<[^>]+>/g,' ').replace(/&[a-z]+;/gi,' ');
}

/* Récupère les objectifs de cours des valeurs citées (articles conseils/avis en priorité). */
async function fetchTargets(entities, force){
  const fresh=24*3600*1000;
  // 1 lien par valeur : privilégie conseils-bourse / avis-des-pros
  const jobs=[];
  for(const e of entities){
    if(!force && TARGETS[e.name] && Date.now()-TARGETS[e.name].ts<fresh) continue;
    const arts=e.arts.filter(a=>a.link && /^https?:/.test(a.link));
    const pref=arts.find(a=>/conseils-bourse|avis-des-pros|coeur-operations/.test(a.link))||arts[0];
    if(pref) jobs.push({name:e.name,link:pref.link});
  }
  const pool=3, todo=jobs.slice(0,15);
  for(let i=0;i<todo.length;i+=pool){
    await Promise.all(todo.slice(i,i+pool).map(async j=>{
      try{
        const txt=await fetchArticleText(j.link);
        const target=parseTarget(txt);
        TARGETS[j.name]={target:target||null, link:j.link, ts:Date.now()};
      }catch(e){ TARGETS[j.name]={target:TARGETS[j.name]?.target||null, link:j.link, ts:Date.now()}; }
    }));
  }
  localStorage.setItem(K_TARG,JSON.stringify(TARGETS));
}

/* ================= Indicateurs quantitatifs ================= */
const sma = (a,n)=>a.length<n?null:a.slice(-n).reduce((x,y)=>x+y,0)/n;
function ema(a,n){ if(a.length<n) return null; const k=2/(n+1); let e=a.slice(0,n).reduce((x,y)=>x+y,0)/n; for(let i=n;i<a.length;i++) e=a[i]*k+e*(1-k); return e; }
function emaSeries(a,n){ const k=2/(n+1); const out=[]; let e=a[0]; for(let i=0;i<a.length;i++){ e=i===0?a[0]:a[i]*k+e*(1-k); out.push(e); } return out; }
function rsi(a,n=14){ if(a.length<n+1) return null; let g=0,l=0;
  for(let i=a.length-n;i<a.length;i++){ const d=a[i]-a[i-1]; if(d>=0) g+=d; else l-=d; }
  g/=n; l/=n; if(l===0) return 100; const rs=g/l; return 100-100/(1+rs); }
function macd(a){ if(a.length<35) return {macd:null,sig:null};
  const e12=emaSeries(a,12), e26=emaSeries(a,26); const line=a.map((_,i)=>e12[i]-e26[i]);
  const sig=emaSeries(line,9); return {macd:line[line.length-1], sig:sig[sig.length-1]}; }
function perf(a,k){ return a.length>k ? (a[a.length-1]/a[a.length-1-k]-1)*100 : null; }
function volatility(a,n=21){ if(a.length<n+1) return null; const r=[]; for(let i=a.length-n;i<a.length;i++) r.push(Math.log(a[i]/a[i-1]));
  const m=r.reduce((x,y)=>x+y,0)/r.length; const v=r.reduce((s,x)=>s+(x-m)**2,0)/r.length; return Math.sqrt(v)*Math.sqrt(252)*100; }

function computeQuote(closes){
  const price = closes[closes.length-1];
  const m = macd(closes);
  return { price,
    sma20:sma(closes,20), sma50:sma(closes,50), sma200:sma(closes,200),
    rsi:rsi(closes,14), macd:m.macd, sig:m.sig,
    m1:perf(closes,21), m3:perf(closes,63), m6:perf(closes,126),
    vol:volatility(closes,21), ts:Date.now() };
}

async function fetchQuote(ticker){
  const url = YF+encodeURIComponent(ticker)+'?range=1y&interval=1d';
  const get = async u=>{ const r=await fetch(u,{cache:'no-store'}); if(!r.ok) throw new Error(r.status); return r.json(); };
  let j;
  try{ j = await get(url); } catch(e){ j = await get(PROXY+encodeURIComponent(url)); }
  const res = j?.chart?.result?.[0];
  const closes = (res?.indicators?.quote?.[0]?.close||[]).filter(x=>x!=null);
  if(closes.length<30) throw new Error('série courte');
  return computeQuote(closes);
}

/* Récupère les cours des tickers demandés (concurrence limitée + cache). */
async function loadQuotes(tickers, force){
  const fresh = 3*3600*1000;
  const todo = tickers.filter(t=>t && (force || !QUOTES[t] || Date.now()-QUOTES[t].ts>fresh));
  const pool = 3;
  for(let i=0;i<todo.length;i+=pool){
    await Promise.all(todo.slice(i,i+pool).map(async t=>{
      try{ QUOTES[t] = await fetchQuote(t); }catch(e){ /* garde l'ancien si présent */ }
    }));
  }
  localStorage.setItem(K_QUOTE,JSON.stringify(QUOTES));
}

/* ---------- Consensus analystes mondial (Yahoo quoteSummary, crumb requis) ---------- */
// Agrège les grands analystes sell-side (recommendationMean 1=achat fort … 5=vente),
// objectif moyen (targetMeanPrice) et nombre d'analystes. Retenu si n ≥ MIN_ANALYSTS.
let _crumb=null;
async function yahooCrumb(){
  if(_crumb) return _crumb;
  try{ await fetch('https://fc.yahoo.com',{cache:'no-store'}); }catch(e){}
  const r=await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb',{cache:'no-store'});
  _crumb=(await r.text()).trim();
  if(!_crumb || _crumb.length>32) throw new Error('crumb ko');
  return _crumb;
}
async function fetchOneConsensus(ticker,crumb){
  const url=`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=financialData&crumb=${encodeURIComponent(crumb)}`;
  const r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error(r.status);
  const fd=(await r.json())?.quoteSummary?.result?.[0]?.financialData;
  if(!fd) throw new Error('no data');
  return {
    key: fd.recommendationKey||null,
    mean: fd.recommendationMean?.raw ?? null,
    target: fd.targetMeanPrice?.raw ?? null,
    n: fd.numberOfAnalystOpinions?.raw ?? 0,
    ts: Date.now()
  };
}
async function fetchConsensus(tickers, force){
  const fresh=24*3600*1000;
  const todo=[...new Set(tickers.filter(Boolean))].filter(t=>force || !CONS[t] || Date.now()-CONS[t].ts>fresh);
  if(!todo.length) return;
  let crumb; try{ crumb=await yahooCrumb(); }catch(e){ return; }   // PWA/CORS : consensus indispo
  const pool=3;
  for(let i=0;i<todo.length;i+=pool){
    await Promise.all(todo.slice(i,i+pool).map(async t=>{
      try{ CONS[t]=await fetchOneConsensus(t,crumb); }catch(e){}
    }));
  }
  localStorage.setItem(K_CONS,JSON.stringify(CONS));
}
// Direction consensus : bull / bear / neutral (null si non fiable, < MIN_ANALYSTS)
function consView(ticker){
  const c=CONS[ticker];
  if(!c || (c.n||0)<MIN_ANALYSTS || c.mean==null) return null;
  const dir = c.mean<=2.4?1 : c.mean>=3.4?-1 : 0;
  const label = c.mean<=1.5?'Achat fort' : c.mean<=2.4?'Achat' : c.mean<=2.9?'Accumuler' : c.mean<=3.4?'Conserver' : c.mean<=4?'Alléger':'Vendre';
  return {...c, dir, label};
}

/* ---------- Presse mondiale (Google News RSS, confirmation, pas point de départ) ---------- */
async function fetchGoogleNews(entities, force){
  const fresh=12*3600*1000;
  const todo=entities.filter(e=>force || !GN[e.name] || Date.now()-GN[e.name].ts>fresh).slice(0,15);
  const get=async u=>{ const r=await fetch(u,{cache:'no-store'}); if(!r.ok) throw new Error(r.status); return r.text(); };
  const pool=3;
  for(let i=0;i<todo.length;i+=pool){
    await Promise.all(todo.slice(i,i+pool).map(async e=>{
      const q=encodeURIComponent(e.name+' action bourse');
      const url=GNEWS+q;
      try{
        let xml; try{ xml=await get(url); }catch(_){ xml=await get(PROXY+encodeURIComponent(url)); }
        const doc=new DOMParser().parseFromString(xml,'text/xml');
        const titles=[...doc.querySelectorAll('item title')].slice(0,12).map(t=>t.textContent||'');
        let score=0; for(const t of titles) score+=sentiment(t);
        GN[e.name]={score, n:titles.length, ts:Date.now()};
      }catch(err){}
    }));
  }
  localStorage.setItem(K_GNEWS,JSON.stringify(GN));
}
function gnView(name){ const g=GN[name]; if(!g||!g.n) return null; return {...g, dir: g.score>0?1:g.score<0?-1:0}; }

/* Score technique composite ∈ [-4..+4] */
function techScore(q){
  if(!q) return {score:null};
  let s=0;
  if(q.sma50!=null) s += q.price>q.sma50?1:-1;
  if(q.sma200!=null) s += q.price>q.sma200?1:-1;
  if(q.sma50!=null&&q.sma200!=null) s += q.sma50>q.sma200?1:-1;   // golden/death cross
  if(q.macd!=null&&q.sig!=null) s += q.macd>q.sig?1:-1;
  if(q.rsi!=null){ if(q.rsi>70) s-=1; else if(q.rsi<30) s+=1; }    // surachat/survente
  if(q.m3!=null) s += q.m3>0?1:-1;
  return {score:Math.max(-4,Math.min(4,s))};
}

/* ================= Sentiment ================= */
function sentiment(t){ t=' '+t.toLowerCase()+' '; let s=0; for(const w of POS) if(t.includes(w)) s++; for(const w of NEG) if(t.includes(w)) s--; return s; }

function analyseEntities(){
  const map=new Map();
  for(const it of ITEMS){
    const blob=(it.title+' '+it.desc).toLowerCase();
    const s=sentiment(it.title+' '+it.desc);
    for(const [name,aliases] of ENTITIES){
      if(aliases.some(a=>blob.includes(a))){
        if(!map.has(name)) map.set(name,{name,news:0,mentions:0,arts:[]});
        const e=map.get(name); e.news+=s; e.mentions++; e.arts.push({title:it.title,link:it.link,s});
      }
    }
  }
  return [...map.values()];
}

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
/* Croise les 4 signaux (ancre = Le Revenu) → direction normalisée [-1,1] chacun,
 * composite pondéré (sur les seuls signaux disponibles) + concordance. */
function computeVerdict(e){
  const sig=[];
  // Le Revenu (point de départ) — poids fort
  sig.push({k:'lr', w:0.32, dir:clamp(e.news/2,-1,1), has:true});
  // Technique
  sig.push({k:'tech', w:0.30, dir:e.tech==null?0:clamp(e.tech/4,-1,1), has:e.tech!=null});
  // Consensus analystes mondial (≥5)
  const cv=consView(e.ticker);
  sig.push({k:'cons', w:0.26, dir:cv?clamp((3-cv.mean)/1.5,-1,1):0, has:!!cv});
  // Google News (presse monde)
  const gv=gnView(e.name);
  sig.push({k:'gn', w:0.12, dir:gv?clamp(gv.score/3,-1,1):0, has:!!gv});

  const avail=sig.filter(s=>s.has);
  const wsum=avail.reduce((a,s)=>a+s.w,0)||1;
  const composite=avail.reduce((a,s)=>a+s.dir*s.w,0)/wsum;
  // concordance : bull/bear avec zone morte
  const disc=d=>d>0.15?1:d<-0.15?-1:0;
  const dirs=avail.map(s=>disc(s.dir));
  const bull=dirs.filter(d=>d>0).length, bear=dirs.filter(d=>d<0).length;
  let lab,cls;
  if(composite>=0.5){lab='ACHETER';cls='b-green';}
  else if(composite>=0.2){lab='Renforcer';cls='b-green';}
  else if(composite>=0.05){lab='Accumuler';cls='b-amber';}
  else if(composite>-0.05){lab='Conserver';cls='b-gray';}
  else if(composite>-0.4){lab='Alléger';cls='b-amber';}
  else{lab='VENDRE';cls='b-red';}
  return {lab,cls,composite,nSig:avail.length,bull,bear,cv,gv};
}

/* Lien Boursorama : page cours (où l'utilisateur connecté passe l'ordre). */
function boursoUrl(ticker,name){
  if(ticker && /\.PA$/.test(ticker)) return 'https://www.boursorama.com/cours/1rP'+ticker.replace('.PA','')+'/';
  return 'https://www.boursorama.com/recherche/?query='+encodeURIComponent(ticker?ticker.replace(/\.[A-Z]+$/,''):name);
}

const LEGEND_HTML = `<div class="legend-body">
  <div class="lg-h">Comment lire une carte</div>
  <p><b>Reco</b> (pastille) : verdict global, du plus positif au plus négatif —
     <span class="tag b-green">ACHETER</span> <span class="tag b-green">Renforcer</span>
     <span class="tag b-amber">Accumuler</span> <span class="tag b-gray">Conserver</span>
     <span class="tag b-amber">Alléger</span> <span class="tag b-red">VENDRE</span>.</p>
  <p><b>4 sources croisées</b> (🟢 positif · ⚪ neutre · 🔴 négatif), pondérées :</p>
  <ul>
    <li>📰 <b>Le Revenu</b> 32 % — point de départ (valeurs citées + ton des articles)</li>
    <li>📈 <b>Technique</b> 30 % — SMA 20/50/200, RSI 14, MACD, momentum</li>
    <li>🌐 <b>Consensus mondial</b> 26 % — analystes (retenu si ≥ ${MIN_ANALYSTS})</li>
    <li>🔎 <b>Google News</b> 12 % — sentiment presse monde</li>
  </ul>
  <p><span class="conc ok">✅ concordants</span> = les sources s'alignent (confiance élevée).
     🎯 <b>Objectif</b> = cours cible + <b>potentiel</b> vs cours actuel.
     💰 <b>Boursorama</b> = ouvre la fiche pour passer l'ordre (exécution manuelle).</p>
</div>`;

/* ================= Rendu : Signaux ================= */
function renderRecos(){
  const el=$('#tab-recos');
  const ents=analyseEntities();
  if(!ents.length){ el.innerHTML='<div class="empty">Aucune valeur identifiée dans l\'édition en cours.<br>Tire ⟳ pour actualiser.</div>'; return; }
  const scored = ents.map(e=>{
    const t=byName[e.name], q=t?QUOTES[t[2]]:null, ts=techScore(q).score;
    const o={...e, ticker:t?.[2], q, tech:ts}; o.v=computeVerdict(o); return o;
  }).sort((a,b)=>b.v.composite-a.v.composite);

  const dot=d=>d==null?'⚪':d>0.15?'🟢':d<-0.15?'🔴':'⚪';
  let h=`<div class="rc-head">
    <div class="rc-count">🎯 ${scored.length} valeurs · 4 sources</div>
    <button id="legend-btn" class="legend-btn" aria-label="Légende">ⓘ Légende</button>
  </div>
  <div id="legend" class="legend" hidden>${LEGEND_HTML}</div>`;

  for(const e of scored){
    const v=e.v, best=e.arts.slice().sort((a,b)=>Math.abs(b.s)-Math.abs(a.s))[0], q=e.q;
    const lrDir=clamp(e.news/2,-1,1), techDir=e.tech==null?null:e.tech/4,
          consDir=v.cv?(3-v.cv.mean)/1.5:null, gDir=v.gv?v.gv.score/3:null;
    // pastilles 4 sources avec info-bulle (title)
    const dots=`<div class="rc-dots">
      <span title="Le Revenu (presse) — ${lrDir>0.15?'positif':lrDir<-0.15?'négatif':'neutre'}">📰${dot(lrDir)}</span>
      <span title="Analyse technique — ${techDir==null?'indispo':techDir>0.15?'haussière':techDir<-0.15?'baissière':'neutre'}">📈${techDir==null?'⚫':dot(techDir)}</span>
      <span title="Consensus analystes mondial — ${v.cv?v.cv.label+' ('+v.cv.n+' analystes)':'indispo (< '+MIN_ANALYSTS+' ou hors ligne)'}">🌐${consDir==null?'⚫':dot(consDir)}</span>
      <span title="Google News (presse monde) — ${gDir==null?'indispo':gDir>0.15?'positif':gDir<-0.15?'négatif':'neutre'}">🔎${gDir==null?'⚫':dot(gDir)}</span>
    </div>`;
    // concordance
    const conc = v.nSig>=2 ? (v.bull>=v.nSig && v.bull>=3 ? `<span class="conc ok" title="Toutes les sources s'alignent">✅ ${v.bull}/${v.nSig}</span>`
      : v.bear>=v.nSig && v.bear>=3 ? `<span class="conc ko">⛔ ${v.bear}/${v.nSig}</span>`
      : v.bull>v.bear ? `<span class="conc mid">↗︎ ${v.bull}/${v.nSig}</span>`
      : v.bear>v.bull ? `<span class="conc mid">↘︎ ${v.bear}/${v.nSig}</span>`
      : `<span class="conc mid">↔︎ partagé</span>`) : '';
    // ligne cours
    const priceStr = q?.price!=null ? `<b>${fmt(q.price)} €</b>` : '<span class="muted">cours n/d</span>';
    // objectifs (LR + consensus) en lignes clé-valeur
    let kv='';
    const tg=TARGETS[e.name]?.target;
    if(tg){ const p=q?.price?(tg/q.price-1)*100:null;
      kv+=`<div class="kv"><span>🎯 Objectif Le Revenu</span><b>${fmt(tg)} €${p!=null?` <i class="${p>=0?'up':'down'}">${p>=0?'+':''}${p.toFixed(1)}%</i>`:''}</b></div>`; }
    if(v.cv){ const p=(q?.price&&v.cv.target)?(v.cv.target/q.price-1)*100:null;
      kv+=`<div class="kv"><span>🌐 Consensus (${v.cv.n})</span><b>${esc(v.cv.label)}${v.cv.target?` · ${fmt(v.cv.target)} €`:''}${p!=null?` <i class="${p>=0?'up':'down'}">${p>=0?'+':''}${p.toFixed(1)}%</i>`:''}</b></div>`; }
    // indicateurs techniques compacts
    let tech='';
    if(q){
      const trend=q.sma200!=null?(q.price>q.sma50&&q.price>q.sma200?'📈':q.price<q.sma50&&q.price<q.sma200?'📉':'↔️'):'';
      tech=`<div class="rc-quant">
        <span title="Tendance vs moyennes mobiles">${trend||'—'}</span>
        <span title="RSI 14 (>70 surachat, <30 survente)">RSI ${q.rsi==null?'—':Math.round(q.rsi)}</span>
        <span title="MACD 12-26-9">MACD ${q.macd!=null?(q.macd>q.sig?'▲':'▼'):'—'}</span>
        <span title="Performance 3 mois">3M ${q.m3==null?'—':(q.m3>0?'+':'')+q.m3.toFixed(0)+'%'}</span>
      </div>`;
    }
    const bUrl=boursoUrl(e.ticker,e.name);
    const buyLab = /green|amber/.test(v.cls)&&v.composite>=0.05 ? '💰 Acheter' : '💰 Boursorama';
    h+=`<div class="rc rc-${v.cls}">
      <div class="rc-top">
        <div class="rc-id"><div class="rc-name">${esc(e.name)}</div>
          <div class="rc-sub">${e.ticker?esc(e.ticker)+' · ':''}${priceStr}</div></div>
        <div class="rc-verdict"><div class="reco-badge ${v.cls}">${v.lab}</div>${conc}</div>
      </div>
      ${dots}
      ${kv?`<div class="rc-kv">${kv}</div>`:''}
      ${tech}
      <div class="rc-actions">
        <a class="btn-buy" href="${esc(bUrl)}" target="_blank" rel="noopener">${buyLab}</a>
        ${best.link?`<a class="btn-src" href="${esc(best.link)}" target="_blank" rel="noopener" title="${esc(best.title)}">📰 Article</a>`:''}
      </div>
    </div>`;
  }
  el.innerHTML=h;
  const lb=el.querySelector('#legend'), bt=el.querySelector('#legend-btn');
  bt.onclick=()=>{ lb.hidden=!lb.hidden; bt.classList.toggle('open',!lb.hidden); };
}

/* ================= Rendu : Thématiques ================= */
function analyseThemes(){
  return THEMES.map(([name,ico,kw])=>{
    let score=0,hits=0,latest='';
    for(const it of ITEMS){ const blob=' '+(it.title+' '+it.desc).toLowerCase()+' ';
      if(kw.some(k=>blob.includes(k))){ hits++; score+=sentiment(it.title+' '+it.desc); if(!latest) latest=it.title; } }
    return {name,ico,score,hits,latest};
  }).filter(t=>t.hits>0).sort((a,b)=>b.hits-a.hits);
}
function themeStance(s){ if(s>=1) return ['Favorable','var(--greend)','#5ef08a']; if(s===0) return ['Neutre','#1c2740','#9fb0d4']; if(s===-1) return ['Prudence','var(--amberd)','#fbbf5b']; return ['Sous pression','var(--redd)','#ff7a7a']; }
function renderThemes(){
  const el=$('#tab-themes'); const ts=analyseThemes();
  if(!ts.length){ el.innerHTML='<div class="empty">Aucune thématique détectée.</div>'; return; }
  let h='<div class="card"><div class="sec-h">🧭 Tendance par classe d\'actifs</div>';
  for(const t of ts){ const [st,bg,col]=themeStance(t.score);
    h+=`<div class="theme"><div class="theme-ico">${t.ico}</div>
      <div class="theme-b"><div class="theme-n">${esc(t.name)}</div>
      <div class="theme-s">${t.hits} mention${t.hits>1?'s':''} · ${esc(t.latest).slice(0,50)}…</div></div>
      <div class="pill" style="background:${bg};color:${col}">${st}</div></div>`; }
  el.innerHTML=h+'</div>';
}

/* ================= Portefeuille + règles de revente ================= */
function evalRules(p,q){
  // renvoie {action, reasons[]} — SELL prioritaire
  const r=[]; if(!q) return {action:null,reasons:['cours indisponible']};
  const price=q.price, pl=(price/p.buy-1)*100;
  if(p.sl && pl<=-Math.abs(p.sl)) r.push(['SELL',`Stop-loss atteint (${pl.toFixed(1)}% ≤ -${p.sl}%)`]);
  if(p.tp && pl>=Math.abs(p.tp)) r.push(['SELL',`Take-profit atteint (+${pl.toFixed(1)}% ≥ +${p.tp}%)`]);
  if(p.target && price>=p.target) r.push(['SELL',`Objectif de cours atteint (${fmt(price)} ≥ ${fmt(p.target)})`]);
  if(p.rsi && q.rsi!=null && q.rsi>=p.rsi) r.push(['TRIM',`RSI en surachat (${Math.round(q.rsi)} ≥ ${p.rsi})`]);
  const action = r.some(x=>x[0]==='SELL')?'SELL':r.length?'TRIM':'HOLD';
  return {action, reasons:r.map(x=>x[1])};
}

function renderPortfolio(){
  const el=$('#tab-port');
  let alerts=[], h='';
  if(!PORT.length){
    h+='<div class="empty">Aucune position.<br>Ajoute une ligne pour activer les alertes de revente.</div>';
  }
  h+='<div style="text-align:center;margin:6px 0 14px"><button class="mag-btn" id="add-pos" style="background:linear-gradient(135deg,#1e3a5f,#0f2038);padding:14px">➕ Ajouter une position</button></div>';
  for(let i=0;i<PORT.length;i++){
    const p=PORT[i]; const t=byName[p.name]||ENTITIES.find(e=>e[2]===p.ticker); const q=QUOTES[p.ticker];
    const pl = q ? (q.price/p.buy-1)*100 : null;
    const val = q ? q.price*p.qty : null;
    const ev = evalRules(p,q);
    const badge = ev.action==='SELL'?['🔴 VENDRE','b-red']:ev.action==='TRIM'?['🟠 ALLÉGER','b-amber']:['🟢 CONSERVER','b-green'];
    if(ev.action!=='HOLD') alerts.push({name:p.name,action:ev.action,reasons:ev.reasons});
    const rules=[]; if(p.sl) rules.push(`SL -${p.sl}%`); if(p.tp) rules.push(`TP +${p.tp}%`); if(p.target) rules.push(`Obj ${fmt(p.target)}`); if(p.rsi) rules.push(`RSI ${p.rsi}`);
    h+=`<div class="card">
      <div class="pos-head">
        <div><div class="reco-name">${esc(p.name)}</div>
          <div class="reco-meta">${p.qty} × PRU ${fmt(p.buy)} ${p.ticker?'· '+esc(p.ticker):''}</div></div>
        <div class="reco-badge ${badge[1]}" style="min-width:104px">${badge[0]}</div>
      </div>
      <div class="quant">
        <span>Cours <b>${q?fmt(q.price):'—'}</b></span>
        <span>P/L ${pl==null?'—':`<b style="color:${pl>=0?'#5ef08a':'#ff7a7a'}">${pl>=0?'+':''}${pl.toFixed(1)}%</b>`}</span>
        <span>Valeur ${val==null?'—':fmt(val)+' €'}</span>
        ${q&&q.rsi!=null?`<span>RSI ${Math.round(q.rsi)}</span>`:''}
      </div>
      ${ev.reasons.length?`<div class="pos-reason">⚠️ ${ev.reasons.map(esc).join(' · ')}</div>`:`<div class="pos-rules">Règles : ${rules.length?rules.join(' · '):'aucune'}</div>`}
      <div class="pos-actions"><button data-edit="${i}">✎ Modifier</button><button data-del="${i}">🗑 Retirer</button></div>
    </div>`;
  }
  // bandeau alertes en tête
  if(alerts.length){
    const top = alerts.map(a=>`<div class="al-line"><b>${a.action==='SELL'?'🔴 Vendre':'🟠 Alléger'} ${esc(a.name)}</b> — ${esc(a.reasons[0])}</div>`).join('');
    h = `<div class="card alerts">${top}<div class="al-note">Passe l'ordre dans ton app Boursorama (exécution manuelle).</div></div>`+h;
    notify(alerts);
  }
  el.innerHTML=h;
  el.querySelector('#add-pos').onclick=()=>editPosition(-1);
  el.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editPosition(+b.dataset.edit));
  el.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{ PORT.splice(+b.dataset.del,1); savePort(); renderPortfolio(); });
}

function editPosition(idx){
  const p = idx>=0 ? PORT[idx] : {name:'',qty:0,buy:0,sl:'',tp:'',target:'',rsi:''};
  const names = ENTITIES.map(e=>e[0]);
  const name = prompt('Valeur (nom exact, ex. '+names.slice(0,4).join(', ')+'…) :', p.name);
  if(name==null) return;
  const ent = byName[name] || ENTITIES.find(e=>e[0].toLowerCase()===name.trim().toLowerCase());
  if(!ent){ alert('Valeur inconnue. Utilise un nom de la liste des Signaux (ex. Sodexo, Thales, LVMH…).'); return; }
  const qty=parseFloat(prompt('Quantité :',p.qty||'')||'0');
  const buy=parseFloat(prompt('Prix de revient unitaire (PRU) € :',p.buy||'')||'0');
  const sl=prompt('Stop-loss % (perte max, vide=off) :',p.sl||'');
  const tp=prompt('Take-profit % (gain cible, vide=off) :',p.tp||'');
  const target=prompt('Objectif de cours € (vide=off) :',p.target||'');
  const rsi=prompt('Seuil RSI de surachat (ex. 75, vide=off) :',p.rsi||'');
  const np={ name:ent[0], ticker:ent[2], qty, buy,
    sl:parseFloat(sl)||0, tp:parseFloat(tp)||0, target:parseFloat(target)||0, rsi:parseFloat(rsi)||0 };
  if(idx>=0) PORT[idx]=np; else PORT.push(np);
  savePort();
  loadQuotes([np.ticker],true).then(renderPortfolio).catch(renderPortfolio);
  renderPortfolio();
}

/* Notification (Capacitor si dispo, sinon Web Notifications, sinon rien) */
let lastNotifKey='';
function notify(alerts){
  const key = alerts.map(a=>a.action+a.name).join('|');
  if(key===lastNotifKey) return; lastNotifKey=key;
  const body = alerts.map(a=>(a.action==='SELL'?'Vendre ':'Alléger ')+a.name).join(', ');
  try{
    const LN=window.Capacitor?.Plugins?.LocalNotifications;
    if(LN){ LN.schedule({notifications:[{id:Date.now()%100000,title:'Reco Invest — alerte revente',body}]}); return; }
  }catch(e){}
  try{
    if('Notification' in window){
      if(Notification.permission==='granted') new Notification('Reco Invest — alerte revente',{body});
      else if(Notification.permission!=='denied') Notification.requestPermission().then(pm=>{ if(pm==='granted') new Notification('Reco Invest — alerte revente',{body}); });
    }
  }catch(e){}
}

/* ================= Allocation ================= */
let curProfile='equilibre';
function renderAlloc(){
  const el=$('#tab-alloc');
  const chips=Object.keys(ALLOC).map(k=>`<button class="chip ${k===curProfile?'active':''}" data-prof="${k}">${ALLOC[k].label}</button>`).join('');
  const a=ALLOC[curProfile];
  const bars=a.rows.map(([lab,pct,col])=>`<div class="alloc-row"><div class="alloc-lab">${esc(lab)}</div><div class="alloc-bar"><div class="alloc-fill" style="width:${pct}%;background:${col}"></div></div><div class="alloc-pct">${pct}%</div></div>`).join('');
  el.innerHTML=`<div class="profiles">${chips}</div>
    <div class="card"><div class="sec-h">📊 Allocation cible · ${esc(a.label)}</div>${bars}<div class="alloc-note">${esc(a.note)}</div></div>
    <div class="card" style="font-size:12.5px;color:var(--mut)">💡 Répartition indicative. Ajuste selon horizon, fiscalité (PEA, assurance-vie) et capacité d'épargne. Croise avec <b style="color:#c5d1ec">Signaux</b> (choix des valeurs) et <b style="color:#c5d1ec">Portefeuille</b> (règles de revente).</div>`;
  el.querySelectorAll('[data-prof]').forEach(b=>b.onclick=()=>{ curProfile=b.dataset.prof; renderAlloc(); });
}

/* ================= Magazine ================= */
function openMag(url,title){
  try{
    const P = window.Capacitor?.Plugins;
    // WebView in-app (garde la session Cafeyn + login mémorisé, plugin natif)
    if(P?.UpdatePlugin?.openInAppWebView){ P.UpdatePlugin.openInAppWebView({url,title,barColor:'#7B3F00'}); return; }
    if(P?.Browser){ P.Browser.open({url}); return; }
  }catch(e){}
  window.open(url,'_blank','noopener');
}
function renderMag(){
  const el=$('#tab-mag');
  el.innerHTML=`<button class="mag-btn" id="mag-open">📖 Lire Le Revenu<small>Cafeyn (abonnement requis)</small></button>
    <div class="card mag-links">
      <a href="https://www.lerevenu.com/bourse" target="_blank" rel="noopener">Actus Bourse — lerevenu.com <span>▸</span></a>
      <a href="https://www.lerevenu.com/placements" target="_blank" rel="noopener">Placements <span>▸</span></a>
      <a href="https://www.lerevenu.com/immobilier" target="_blank" rel="noopener">Immobilier <span>▸</span></a>
      <a href="https://www.lerevenu.com/impots" target="_blank" rel="noopener">Impôts & fiscalité <span>▸</span></a>
    </div>
    <div class="card" style="font-size:12.5px;color:var(--mut)">Signaux et Thématiques sont calculés automatiquement à partir du flux gratuit du Revenu.</div>`;
  el.querySelector('#mag-open').onclick=()=>openMag(CAFEYN,'Le Revenu');
}

/* ================= Navigation / chargement ================= */
function showTab(name){
  document.querySelectorAll('#tabs .chip').forEach(c=>c.classList.toggle('active',c.dataset.tab===name));
  document.querySelectorAll('.tab').forEach(t=>t.hidden=t.id!=='tab-'+name);
}
function renderAll(){ renderRecos(); renderThemes(); renderPortfolio(); renderAlloc(); renderMag(); }

async function load(force){
  const st=$('#status'), btn=$('#refresh'); btn.classList.add('spin');
  if(!force){ try{ const c=JSON.parse(localStorage.getItem(K_ITEMS)||'null'); if(c?.items?.length){ ITEMS=c.items; renderAll(); } }catch(e){} }
  if(!ITEMS.length){ ITEMS=SEED_ITEMS; renderAll(); st.textContent='Édition d\'exemple — actualisation…'; }
  try{
    st.textContent='Analyse de l\'édition Le Revenu…';
    ITEMS = await fetchRss();
    localStorage.setItem(K_ITEMS,JSON.stringify({ts:Date.now(),items:ITEMS}));
    renderRecos(); renderThemes();
    // tickers = valeurs citées + positions
    const ents  = analyseEntities();
    const cited = ents.map(e=>byName[e.name]?.[2]).filter(Boolean);
    const held  = PORT.map(p=>p.ticker).filter(Boolean);
    st.textContent='Cours & indicateurs techniques…';
    await loadQuotes([...new Set([...cited,...held])], force);
    renderAll();
    st.textContent='Objectifs de cours (Le Revenu)…';
    await fetchTargets(ents, force);
    renderAll();
    st.textContent='Consensus analystes mondial…';
    await fetchConsensus([...new Set([...cited,...held])], force);
    renderAll();
    st.textContent='Presse mondiale (Google News)…';
    await fetchGoogleNews(ents, force);
    renderAll();
    st.textContent=ITEMS.length+' articles · 4 sources · '+new Date().toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  }catch(e){
    if(!ITEMS.length) st.textContent='⚠️ Hors-ligne et aucun cache.';
    else st.textContent='⚠️ Actualisation partielle — cache affiché.';
    renderAll();
  }finally{ btn.classList.remove('spin'); }
}

/* ================= Mise à jour auto (calqué sur flux-rss) ================= */
const GH_REPO='laurentsar/reco-invest';
const isNative = !!(window.Capacitor && (window.Capacitor.isNativePlatform?.() || window.Capacitor.Plugins?.UpdatePlugin));
function versionGt(tag,cur){
  const p=v=>String(v).replace(/^v/,'').split('.').map(n=>parseInt(n,10)||0);
  const [la,lb=0,lc=0]=p(tag), [ca,cb=0,cc=0]=p(cur);
  return la>ca || (la===ca&&(lb>cb || (lb===cb&&lc>cc)));
}
function showUpdateBanner(tag, apkUrl){
  const ex=document.getElementById('update-banner'); if(ex) ex.remove();
  const el=document.createElement('div'); el.id='update-banner';
  el.innerHTML=`<span class="upd-msg">🆕 Version <b>${esc(tag)}</b> disponible</span>`+
    `<button class="upd-btn" id="btn-update">⬇ Installer</button>`+
    `<button class="upd-x" id="btn-dismiss-update" aria-label="Ignorer">✕</button>`;
  document.body.appendChild(el);
  el.querySelector('#btn-dismiss-update').onclick=()=>{ localStorage.setItem('dismissedUpdate',tag); el.remove(); };
  el.querySelector('#btn-update').onclick=async()=>{
    const btn=el.querySelector('#btn-update'); btn.textContent='⏳…'; btn.disabled=true;
    try{
      const UP=window.Capacitor?.Plugins?.UpdatePlugin;
      if(UP?.downloadAndInstall){ await UP.downloadAndInstall({url:apkUrl}); }
      else window.open(apkUrl,'_blank','noopener');
    }catch(e){
      btn.textContent='⬇ Installer'; btn.disabled=false;
      if(String(e?.message||e).includes('permission')) alert('Autorise l\'installation d\'apps depuis cette source dans les paramètres Android, puis réessaie.');
      else alert('Erreur MAJ : '+(e?.message||e));
    }
  };
}
async function checkForUpdate(){
  try{
    const r=await fetch(`https://api.github.com/repos/${GH_REPO}/releases/latest?_=${Date.now()}`,{cache:'no-store',headers:{Accept:'application/vnd.github+json'}});
    if(!r.ok) return;
    const d=await r.json(); const tag=d.tag_name||'';
    if(!tag || !versionGt(tag,APP_VERSION)) return;
    if(localStorage.getItem('dismissedUpdate')===tag) return;
    const asset=(d.assets||[]).find(a=>a.name && a.name.endsWith('.apk'));
    showUpdateBanner(tag, asset?asset.browser_download_url:d.html_url);
  }catch(e){ /* réseau/API indispo — silencieux */ }
}

document.addEventListener('DOMContentLoaded',()=>{
  $('#app-ver').textContent='v'+APP_VERSION;
  document.querySelectorAll('#tabs .chip').forEach(c=>c.onclick=()=>showTab(c.dataset.tab));
  $('#refresh').onclick=()=>load(true);
  renderAll();
  load(false);
  setTimeout(checkForUpdate, 2500);
});
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
