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

const APP_VERSION = '1.09';   // ← synchronisé par la CI depuis build.gradle (versionName)
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
const K_HIST  = 'recoInvest:history';
const K_ZB    = 'recoInvest:zonebourse';
const K_ZBID  = 'recoInvest:zbid';
const K_TV    = 'recoInvest:tradingview';
const K_SA    = 'recoInvest:stockanalysis';
const MIN_ANALYSTS = 5;   // consensus retenu seulement si ≥ 5 analystes
const GNEWS = 'https://news.google.com/rss/search?hl=fr&gl=FR&ceid=FR:fr&q=';
const ZONEBOURSE = 'https://www.zonebourse.com';
const TRADINGVIEW = 'https://www.tradingview.com';
const STOCKANALYSIS = 'https://stockanalysis.com';

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

/* ---------- ETF / trackers : nom, alias, ticker Yahoo (tickers vérifiés) ---------- */
const ETFS = [
  ['Amundi MSCI World',['amundi msci world','msci world','actions mondiales'],'CW8.PA'],
  ['Vanguard FTSE All-World',['vanguard ftse all-world','ftse all-world'],'VWCE.DE'],
  ['Amundi PEA S&P 500',['s&p 500','s&p500','wall street'],'PE500.PA'],
  ['SPDR S&P 500 (SPY)',['spdr s&p 500','etf spy'],'SPY'],
  ['Invesco EQQQ Nasdaq-100',['nasdaq-100','nasdaq 100','valeurs technologiques américaines'],'EQQQ.PA'],
  ['Invesco QQQ (Nasdaq)',['invesco qqq','etf qqq'],'QQQ'],
  ['Amundi CAC 40',['cac 40','cac40'],'C40.PA'],
  ['Amundi PEA Émergents',['marchés émergents','pays émergents','msci emerging'],'PAEEM.PA'],
  ['Amundi PEA Asie Émergente',['asie émergente','msci emerging asia'],'PAASI.PA'],
  ['Xtrackers Or physique',['once d\'or','cours de l\'or','matières premières','métaux précieux'],'XAD1.DE'],
];
const byNameETF = Object.fromEntries(ETFS.map(e=>[e[0],e]));

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
let HIST = [];             // historique des changements de reco
let ZB = {};                // nom valeur → {label, note, target, n, ts}  (consensus Zonebourse, France)
let ZBID = {};               // nom valeur → id fiche Zonebourse (cache, évite une recherche à chaque rafraîchissement)
let TV = {};                 // nom valeur → {rating, dir, ts}  (jauge technique TradingView)
let SA = {};                 // nom valeur → {label, target, ts}  (consensus + objectif StockAnalysis.com)

try{ PORT = JSON.parse(localStorage.getItem(K_PORT)||'[]'); }catch(e){ PORT=[]; }
try{ QUOTES = JSON.parse(localStorage.getItem(K_QUOTE)||'{}'); }catch(e){ QUOTES={}; }
try{ TARGETS = JSON.parse(localStorage.getItem(K_TARG)||'{}'); }catch(e){ TARGETS={}; }
try{ CONS = JSON.parse(localStorage.getItem(K_CONS)||'{}'); }catch(e){ CONS={}; }
try{ GN = JSON.parse(localStorage.getItem(K_GNEWS)||'{}'); }catch(e){ GN={}; }
try{ HIST = JSON.parse(localStorage.getItem(K_HIST)||'[]'); }catch(e){ HIST=[]; }
try{ ZB = JSON.parse(localStorage.getItem(K_ZB)||'{}'); }catch(e){ ZB={}; }
try{ ZBID = JSON.parse(localStorage.getItem(K_ZBID)||'{}'); }catch(e){ ZBID={}; }
try{ TV = JSON.parse(localStorage.getItem(K_TV)||'{}'); }catch(e){ TV={}; }
try{ SA = JSON.parse(localStorage.getItem(K_SA)||'{}'); }catch(e){ SA={}; }

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

/* ---------- Consensus Zonebourse (France, groupe MarketScreener) ---------- */
// Recherche la fiche de la valeur, puis lit le bloc #consensusDetail (jauge « Note X/10 »,
// recommandation moyenne, objectif de cours moyen, nb d'analystes). Retenu si n ≥ MIN_ANALYSTS.
async function zbResolveId(name, mnemo){
  if(ZBID[name]) return ZBID[name];
  const url=ZONEBOURSE+'/recherche/?q='+encodeURIComponent(name);
  const get=async u=>{ const r=await fetch(u,{cache:'no-store'}); if(!r.ok) throw new Error(r.status); return r.text(); };
  let html; try{ html=await get(url); }catch(e){ html=await get(PROXY+encodeURIComponent(url)); }
  const doc=new DOMParser().parseFromString(html,'text/html');
  let fallback=null, best=null;
  for(const row of doc.querySelectorAll('tr')){
    const a=row.querySelector('a[href^="/cours/action/"]');
    if(!a) continue;
    const href=a.getAttribute('href');
    if(/\/(actualite|societe)\//.test(href)) continue;
    if(!fallback) fallback=href;
    const mn=row.querySelector('[aria-label="Mnemo"]')?.textContent.trim();
    if(mnemo && mn && mn.toUpperCase()===mnemo.toUpperCase()){ best=href; break; }
  }
  const href=best||fallback;
  if(!href) throw new Error('valeur introuvable sur Zonebourse');
  const id=href.replace(/^\/|\/$/g,'');
  ZBID[name]=id;
  localStorage.setItem(K_ZBID,JSON.stringify(ZBID));
  return id;
}
async function fetchOneZonebourse(name,mnemo){
  const id=await zbResolveId(name,mnemo);
  const url=ZONEBOURSE+'/'+id+'/';
  const get=async u=>{ const r=await fetch(u,{cache:'no-store'}); if(!r.ok) throw new Error(r.status); return r.text(); };
  let html; try{ html=await get(url); }catch(e){ html=await get(PROXY+encodeURIComponent(url)); }
  const doc=new DOMParser().parseFromString(html,'text/html');
  const box=doc.querySelector('#consensusDetail');
  if(!box) throw new Error('bloc consensus indisponible');
  const kv={};
  box.querySelectorAll('.grid').forEach(row=>{
    const cells=row.querySelectorAll(':scope > div');
    if(cells.length>=2) kv[cells[0].textContent.trim()]=cells[1].textContent.trim();
  });
  const gaugeTitle=box.querySelector('.consensus-gauge')?.getAttribute('title')||'';
  const m=gaugeTitle.match(/([\d.,]+)\s*\/\s*10/);
  const note=m?parseFloat(m[1].replace(',','.')):null;
  const n=parseInt((kv["Nombre d'Analystes"]||'').replace(/\D/g,''),10)||0;
  const target=parseFloat((kv['Objectif de cours Moyen']||'').replace(/[^\d,.-]/g,'').replace(',','.'))||null;
  return { label: kv['Recommandation moyenne']||null, note, n, target, ts:Date.now() };
}
async function fetchZonebourse(entities, force, byNameMap=byName){
  const fresh=24*3600*1000;
  const todo=entities.filter(e=>force || !ZB[e.name] || Date.now()-ZB[e.name].ts>fresh).slice(0,15);
  const pool=2;
  for(let i=0;i<todo.length;i+=pool){
    await Promise.all(todo.slice(i,i+pool).map(async e=>{
      const t=byNameMap[e.name], mnemo=t?.[2]?.replace(/\.[A-Z]+$/,'')||null;
      try{ ZB[e.name]=await fetchOneZonebourse(e.name,mnemo); }
      catch(err){ /* garde l'ancien si présent — source parfois protégée anti-bot */ }
    }));
  }
  localStorage.setItem(K_ZB,JSON.stringify(ZB));
}
// Direction Zonebourse : jauge 0 (Vente) → 10 (Achat), normalisée en [-1,1]
function zbView(name){
  const z=ZB[name];
  if(!z || (z.n||0)<MIN_ANALYSTS || z.note==null) return null;
  const dir=clamp((z.note-5)/5,-1,1);
  return {...z, dir};
}

/* ---------- Jauge technique TradingView (Summary : Strong Sell…Strong Buy) ----------
 * Recoupe le signal Technique déjà calculé en interne (même famille : SMA/RSI/MACD…),
 * ce n'est PAS une source indépendante — voir légende. Symbole résolu par une table de
 * correspondance fixe (leur API de recherche est bloquée aux requêtes automatisées). */
const TV_SUFFIX_EXCHANGE = {'.PA':'EURONEXT', '.DE':'XETR', '.HE':'OMXHEX'};
const TV_BARE_EXCHANGE = {AAPL:'NASDAQ', BA:'NYSE', MSFT:'NASDAQ', NVDA:'NASDAQ', QQQ:'NASDAQ', SPY:'AMEX', TSLA:'NASDAQ'};
function tvSymbol(ticker){
  if(!ticker) return null;
  const m=ticker.match(/\.[A-Z]+$/);
  if(m){ const ex=TV_SUFFIX_EXCHANGE[m[0]]; return ex?ex+'-'+ticker.slice(0,-m[0].length):null; }
  const ex=TV_BARE_EXCHANGE[ticker];
  return ex?ex+'-'+ticker:null;
}
const TV_RATING_DIR = {'strong-buy':1,'buy':0.5,'neutral':0,'sell':-0.5,'strong-sell':-1};
async function fetchOneTradingView(ticker){
  const sym=tvSymbol(ticker);
  if(!sym) throw new Error('symbole TradingView non mappé');
  const url=TRADINGVIEW+'/symbols/'+sym+'/technicals/';
  const get=async u=>{ const r=await fetch(u,{cache:'no-store'}); if(!r.ok) throw new Error(r.status); return r.text(); };
  let html; try{ html=await get(url); }catch(e){ html=await get(PROXY+encodeURIComponent(url)); }
  const doc=new DOMParser().parseFromString(html,'text/html');
  let rating=null;
  for(const titleEl of doc.querySelectorAll('[class*="speedometerTitle"]')){
    if(titleEl.textContent.trim()!=='Summary') continue;
    const sib=titleEl.nextElementSibling;
    const cls=sib?[...sib.classList].find(c=>/^container-(strong-buy|strong-sell|buy|sell|neutral)-/.test(c)):null;
    if(cls) rating=cls.match(/^container-(strong-buy|strong-sell|buy|sell|neutral)-/)[1];
    break;
  }
  if(!rating) throw new Error('jauge Summary introuvable');
  return { rating, dir:TV_RATING_DIR[rating]??0, ts:Date.now() };
}
async function fetchTradingView(entities, force, byNameMap=byName){
  const fresh=12*3600*1000;
  const todo=entities.filter(e=>force || !TV[e.name] || Date.now()-TV[e.name].ts>fresh).slice(0,15);
  const pool=2;
  for(let i=0;i<todo.length;i+=pool){
    await Promise.all(todo.slice(i,i+pool).map(async e=>{
      const t=byNameMap[e.name];
      try{ TV[e.name]=await fetchOneTradingView(t?.[2]); }
      catch(err){ /* garde l'ancien si présent — ticker non mappé ou source protégée */ }
    }));
  }
  localStorage.setItem(K_TV,JSON.stringify(TV));
}
function tvView(name){
  const t=TV[name];
  if(!t || t.dir==null) return null;
  return t;
}

/* ---------- StockAnalysis.com (consensus analystes + objectif de cours) ----------
 * Couverture internationale (US via /stocks/, international via /quote/{bourse}/) —
 * gratuit, sans CAPTCHA, sans paywall constaté au moment de l'implémentation. */
const SA_SUFFIX_EXCHANGE = {'.PA':'epa', '.DE':'etr', '.HE':'hel'};
function saPath(ticker){
  if(!ticker) return null;
  const m=ticker.match(/\.[A-Z]+$/);
  if(m){ const ex=SA_SUFFIX_EXCHANGE[m[0]]; return ex?'/quote/'+ex+'/'+ticker.slice(0,-m[0].length)+'/':null; }
  return '/stocks/'+ticker.toLowerCase()+'/';
}
const SA_LABEL_DIR = {'strong buy':1,'buy':0.6,'hold':0,'sell':-0.6,'strong sell':-1};
async function fetchOneStockAnalysis(ticker){
  const path=saPath(ticker);
  if(!path) throw new Error('symbole StockAnalysis non mappé');
  const url=STOCKANALYSIS+path;
  const get=async u=>{ const r=await fetch(u,{cache:'no-store'}); if(!r.ok) throw new Error(r.status); return r.text(); };
  let html; try{ html=await get(url); }catch(e){ html=await get(PROXY+encodeURIComponent(url)); }
  const doc=new DOMParser().parseFromString(html,'text/html');
  let label=null;
  for(const el of doc.querySelectorAll('div')){
    if(el.textContent.trim().startsWith('Analyst Consensus:')){
      label=el.querySelector('span')?.textContent.trim().toLowerCase()||null;
      break;
    }
  }
  if(!label || !(label in SA_LABEL_DIR)) throw new Error('consensus indisponible (probablement un ETF)');
  let target=null;
  for(const el of doc.querySelectorAll('div')){
    if(el.textContent.trim()==='Price Target'){
      const val=el.nextElementSibling?.textContent.replace(/[^\d,.-]/g,'').replace(',','.');
      target=val?parseFloat(val)||null:null;
      break;
    }
  }
  return { label, dir:SA_LABEL_DIR[label], target, ts:Date.now() };
}
async function fetchStockAnalysis(entities, force, byNameMap=byName){
  const fresh=24*3600*1000;
  const todo=entities.filter(e=>force || !SA[e.name] || Date.now()-SA[e.name].ts>fresh).slice(0,15);
  const pool=2;
  for(let i=0;i<todo.length;i+=pool){
    await Promise.all(todo.slice(i,i+pool).map(async e=>{
      const t=byNameMap[e.name];
      try{ SA[e.name]=await fetchOneStockAnalysis(t?.[2]); }
      catch(err){ /* garde l'ancien si présent — pas de couverture (ETF) ou ticker non mappé */ }
    }));
  }
  localStorage.setItem(K_SA,JSON.stringify(SA));
}
function saView(name){
  const s=SA[name];
  if(!s || s.dir==null) return null;
  return s;
}

/* ---------- Presse mondiale (Google News RSS, confirmation, pas point de départ) ---------- */
async function fetchGoogleNews(entities, force, querySuffix='action bourse'){
  const fresh=12*3600*1000;
  const todo=entities.filter(e=>force || !GN[e.name] || Date.now()-GN[e.name].ts>fresh).slice(0,15);
  const get=async u=>{ const r=await fetch(u,{cache:'no-store'}); if(!r.ok) throw new Error(r.status); return r.text(); };
  const pool=3;
  for(let i=0;i<todo.length;i+=pool){
    await Promise.all(todo.slice(i,i+pool).map(async e=>{
      const q=encodeURIComponent(e.name+' '+querySuffix);
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
// Inverse le signe d'un mot du lexique si une négation ("ne...pas", "sans", "aucun"…)
// apparaît juste avant lui dans la même phrase (coupe à la ponctuation forte précédente).
function isNegatedBefore(blob,idx){
  const start=Math.max(0,idx-40);
  const w=blob.slice(start,idx);
  const cut=Math.max(w.lastIndexOf('.'),w.lastIndexOf('!'),w.lastIndexOf('?'),w.lastIndexOf(';'));
  const win=cut>=0?w.slice(cut+1):w;
  return /\b(ne|n['’]|sans|aucun|aucune|jamais|ni)\b/.test(win);
}
function sentiment(t){
  const blob=' '+t.toLowerCase()+' ';
  let s=0;
  for(const w of POS){ const idx=blob.indexOf(w); if(idx!==-1) s+=isNegatedBefore(blob,idx)?-1:1; }
  for(const w of NEG){ const idx=blob.indexOf(w); if(idx!==-1) s+=isNegatedBefore(blob,idx)?1:-1; }
  return s;
}

// includeAll : inclut toutes les valeurs de la liste même sans citation presse
// (nécessaire pour les ETF, rarement cités individuellement par Le Revenu).
function analyseEntities(list=ENTITIES, includeAll=false){
  const map=new Map();
  if(includeAll) for(const [name] of list) map.set(name,{name,news:0,mentions:0,arts:[]});
  for(const it of ITEMS){
    const blob=(it.title+' '+it.desc).toLowerCase();
    const s=sentiment(it.title+' '+it.desc);
    for(const [name,aliases] of list){
      if(aliases.some(a=>blob.includes(a))){
        if(!map.has(name)) map.set(name,{name,news:0,mentions:0,arts:[]});
        const e=map.get(name); e.news+=s; e.mentions++; e.arts.push({title:it.title,link:it.link,s});
      }
    }
  }
  return [...map.values()];
}

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
/* Croise les 5 signaux (ancre = Le Revenu) → direction normalisée [-1,1] chacun,
 * composite pondéré (sur les seuls signaux disponibles) + concordance. */
function computeVerdict(e){
  const sig=[];
  // Le Revenu (point de départ) — poids fort
  sig.push({k:'lr', w:0.22, dir:clamp(e.news/2,-1,1), has:true});
  // Technique (interne : SMA/RSI/MACD/momentum)
  sig.push({k:'tech', w:0.20, dir:e.tech==null?0:clamp(e.tech/4,-1,1), has:e.tech!=null});
  // Jauge technique TradingView — même famille que "tech", poids volontairement réduit
  const tv=tvView(e.name);
  sig.push({k:'tv', w:0.08, dir:tv?tv.dir:0, has:!!tv});
  // Consensus Zonebourse (France, ≥5 analystes)
  const zv=zbView(e.name);
  sig.push({k:'zb', w:0.12, dir:zv?zv.dir:0, has:!!zv});
  // Consensus analystes mondial (≥5)
  const cv=consView(e.ticker);
  sig.push({k:'cons', w:0.16, dir:cv?clamp((3-cv.mean)/1.5,-1,1):0, has:!!cv});
  // Consensus + objectif StockAnalysis.com (couverture internationale)
  const sa=saView(e.name);
  sig.push({k:'sa', w:0.14, dir:sa?sa.dir:0, has:!!sa});
  // Google News (presse monde)
  const gv=gnView(e.name);
  sig.push({k:'gn', w:0.08, dir:gv?clamp(gv.score/3,-1,1):0, has:!!gv});

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
  return {lab,cls,composite,nSig:avail.length,bull,bear,cv,gv,zv,tv,sa};
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
  <p><b>7 sources croisées</b> (🟢 positif · ⚪ neutre · 🔴 négatif), pondérées :</p>
  <ul>
    <li>📰 <b>Le Revenu</b> 22 % — point de départ (valeurs citées + ton des articles)</li>
    <li>📈 <b>Technique</b> 20 % — calculé en interne : SMA 20/50/200, RSI 14, MACD, momentum</li>
    <li>🕯️ <b>TradingView</b> 8 % — jauge technique de leur site (recoupe le signal Technique, pas une source vraiment indépendante)</li>
    <li>🇫🇷 <b>Consensus Zonebourse</b> 12 % — analystes France (retenu si ≥ ${MIN_ANALYSTS})</li>
    <li>🌐 <b>Consensus mondial (Yahoo)</b> 16 % — analystes (retenu si ≥ ${MIN_ANALYSTS})</li>
    <li>📊 <b>StockAnalysis.com</b> 14 % — consensus analystes + objectif, couverture internationale</li>
    <li>🔎 <b>Google News</b> 8 % — sentiment presse monde</li>
  </ul>
  <p><span class="conc ok">✅ concordants</span> = les sources s'accordent au même instant (≥3/7 disponibles alignées).
     <span class="conc mid">⚠️ x/7 sources</span> = moins de 3 sources disponibles pour cette valeur, verdict moins robuste.
     🎯 <b>Objectif</b> = cours cible + <b>potentiel</b> vs cours actuel.
     💰 <b>Boursorama</b> = ouvre la fiche pour passer l'ordre (exécution manuelle).</p>
  <p style="color:#9fb0d4">⚠️ La concordance mesure un accord entre sources à l'instant T, pas une performance réelle.
     Le taux de réussite <b>mesuré</b> sur l'historique des recos passées est visible dans l'onglet <b style="color:#c5d1ec">Historique</b>.
     Zonebourse, TradingView et StockAnalysis.com sont des sites tiers scrapés côté client : leur disponibilité n'est pas garantie
     (blocage anti-robot possible), l'app dégrade proprement sur les sources restantes le cas échéant.</p>
</div>`;

/* ================= Rendu : Action / ETF ================= */
// Moteur commun aux deux onglets valeurs (mêmes 7 sources, même verdict).
// includeAll=true (ETF) : affiche toute la liste même sans citation presse
// (les ETF sont rarement cités individuellement par Le Revenu).
function renderAssetTab(tabId, list, byNameMap, includeAll){
  const el=$('#'+tabId);
  const ents=analyseEntities(list, includeAll);
  if(!ents.length){ el.innerHTML='<div class="empty">Aucune valeur identifiée dans l\'édition en cours.<br>Tire ⟳ pour actualiser.</div>'; return; }
  const scored = ents.map(e=>{
    const t=byNameMap[e.name], q=t?QUOTES[t[2]]:null, ts=techScore(q).score;
    const o={...e, ticker:t?.[2], q, tech:ts}; o.v=computeVerdict(o); return o;
  }).sort((a,b)=>b.v.composite-a.v.composite);

  const dot=d=>d==null?'⚪':d>0.15?'🟢':d<-0.15?'🔴':'⚪';
  let h=`<div class="rc-head">
    <div class="rc-count">🎯 ${scored.length} valeurs · 7 sources</div>
    <button id="legend-btn-${tabId}" class="legend-btn" aria-label="Légende">ⓘ Légende</button>
  </div>
  <div id="legend-${tabId}" class="legend" hidden>${LEGEND_HTML}</div>`;

  for(const e of scored){
    const v=e.v, best=e.arts.length?e.arts.slice().sort((a,b)=>Math.abs(b.s)-Math.abs(a.s))[0]:null, q=e.q;
    const lrDir=clamp(e.news/2,-1,1), techDir=e.tech==null?null:e.tech/4,
          tvDir=v.tv?v.tv.dir:null, zbDir=v.zv?v.zv.dir:null, consDir=v.cv?(3-v.cv.mean)/1.5:null,
          saDir=v.sa?v.sa.dir:null, gDir=v.gv?v.gv.score/3:null;
    // pastilles 7 sources : tap → bulle légende (data-tip) + survol (title)
    const dotSpan=(icon,dir,tip)=>{
      const d=dir==null?'⚫':dot(dir);
      return `<span class="dotitem" data-tip="${esc(tip)}" title="${esc(tip)}">${icon}${d}</span>`;
    };
    const dots=`<div class="rc-dots">
      ${dotSpan('📰',lrDir,`Le Revenu (presse) — 22 % du score. ${lrDir>0.15?'🟢 Positif':lrDir<-0.15?'🔴 Négatif':'⚪ Neutre'}. C'est le point de départ : valeurs citées + ton des articles.`)}
      ${dotSpan('📈',techDir,`Analyse technique (interne) — 20 %. ${techDir==null?'⚫ Cours indisponible':techDir>0.15?'🟢 Haussière':techDir<-0.15?'🔴 Baissière':'⚪ Neutre'}. SMA 20/50/200, RSI 14, MACD, momentum 3M.`)}
      ${dotSpan('🕯️',tvDir,`Jauge technique TradingView — 8 % du score (recoupe le signal Technique, pas indépendant). ${v.tv?(v.tv.dir>0?'🟢':v.tv.dir<0?'🔴':'⚪')+' '+v.tv.rating:'⚫ Indispo (ticker non mappé ou source protégée)'}.`)}
      ${dotSpan('🇫🇷',zbDir,`Consensus Zonebourse (France) — 12 % du score. ${v.zv?(v.zv.dir>0?'🟢':v.zv.dir<0?'🔴':'⚪')+' '+(v.zv.label||'')+' · '+v.zv.n+' analystes'+(v.zv.target?' · objectif moyen '+fmt(v.zv.target)+' €':''):'⚫ Indispo (< '+MIN_ANALYSTS+' analystes ou source protégée)'}.`)}
      ${dotSpan('🌐',consDir,`Consensus analystes mondial (Yahoo) — 16 % du score. ${v.cv?(v.cv.dir>0?'🟢':v.cv.dir<0?'🔴':'⚪')+' '+v.cv.label+' · '+v.cv.n+' analystes'+(v.cv.target?' · objectif moyen '+fmt(v.cv.target)+' €':''):'⚫ Indispo (< '+MIN_ANALYSTS+' analystes ou hors ligne / PWA)'}.`)}
      ${dotSpan('📊',saDir,`Consensus StockAnalysis.com — 14 % du score. ${v.sa?(v.sa.dir>0?'🟢':v.sa.dir<0?'🔴':'⚪')+' '+v.sa.label+(v.sa.target?' · objectif '+fmt(v.sa.target)+' €':''):'⚫ Indispo (souvent le cas pour les ETF)'}.`)}
      ${dotSpan('🔎',gDir,`Google News (presse monde) — 8 % du score. ${gDir==null?'⚫ Indispo':gDir>0.15?'🟢 Positif':gDir<-0.15?'🔴 Négatif':'⚪ Neutre'}. Sentiment agrégé de la presse mondiale.`)}
    </div>`;
    // concordance
    const conc = v.nSig>=3 ? (v.bull>=v.nSig ? `<span class="conc ok" title="Toutes les sources s'alignent">✅ ${v.bull}/${v.nSig}</span>`
      : v.bear>=v.nSig ? `<span class="conc ko">⛔ ${v.bear}/${v.nSig}</span>`
      : v.bull>v.bear ? `<span class="conc mid">↗︎ ${v.bull}/${v.nSig}</span>`
      : v.bear>v.bull ? `<span class="conc mid">↘︎ ${v.bear}/${v.nSig}</span>`
      : `<span class="conc mid">↔︎ partagé</span>`)
      : `<span class="conc mid" title="Peu de sources disponibles pour cette valeur — verdict moins robuste">⚠️ ${v.nSig}/7 sources</span>`;
    // ligne cours
    const priceStr = q?.price!=null ? `<b>${fmt(q.price)} €</b>` : '<span class="muted">cours n/d</span>';
    // objectifs (LR + consensus) en lignes clé-valeur
    let kv='';
    const tg=TARGETS[e.name]?.target;
    if(tg){ const p=q?.price?(tg/q.price-1)*100:null;
      kv+=`<div class="kv"><span>🎯 Objectif Le Revenu</span><b>${fmt(tg)} €${p!=null?` <i class="${p>=0?'up':'down'}">${p>=0?'+':''}${p.toFixed(1)}%</i>`:''}</b></div>`; }
    if(v.zv){ const p=(q?.price&&v.zv.target)?(v.zv.target/q.price-1)*100:null;
      kv+=`<div class="kv"><span>🇫🇷 Zonebourse (${v.zv.n})</span><b>${v.zv.label?esc(v.zv.label):'—'}${v.zv.target?` · ${fmt(v.zv.target)} €`:''}${p!=null?` <i class="${p>=0?'up':'down'}">${p>=0?'+':''}${p.toFixed(1)}%</i>`:''}</b></div>`; }
    if(v.cv){ const p=(q?.price&&v.cv.target)?(v.cv.target/q.price-1)*100:null;
      kv+=`<div class="kv"><span>🌐 Consensus (${v.cv.n})</span><b>${esc(v.cv.label)}${v.cv.target?` · ${fmt(v.cv.target)} €`:''}${p!=null?` <i class="${p>=0?'up':'down'}">${p>=0?'+':''}${p.toFixed(1)}%</i>`:''}</b></div>`; }
    if(v.sa){ const p=(q?.price&&v.sa.target)?(v.sa.target/q.price-1)*100:null;
      kv+=`<div class="kv"><span>📊 StockAnalysis</span><b>${esc(v.sa.label)}${v.sa.target?` · ${fmt(v.sa.target)} €`:''}${p!=null?` <i class="${p>=0?'up':'down'}">${p>=0?'+':''}${p.toFixed(1)}%</i>`:''}</b></div>`; }
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
        ${best?.link?`<a class="btn-src" href="${esc(best.link)}" target="_blank" rel="noopener" title="${esc(best.title)}">📰 Article</a>`:''}
      </div>
    </div>`;
  }
  notifyBuyOpportunities(scored, tabId);
  el.innerHTML=h;
  const lb=el.querySelector('#legend-'+tabId), bt=el.querySelector('#legend-btn-'+tabId);
  bt.onclick=()=>{ lb.hidden=!lb.hidden; bt.classList.toggle('open',!lb.hidden); };
}
function renderRecos(){ renderAssetTab('tab-recos', ENTITIES, byName, false); }
function renderEtf(){ renderAssetTab('tab-etf', ETFS, byNameETF, true); }

/* ================= Historique des recos ================= */
// Enregistre un point à chaque CHANGEMENT de verdict pour une valeur (date, reco, cours).
function recordHistory(list=ENTITIES, byNameMap=byName, includeAll=false){
  const ents=analyseEntities(list, includeAll);
  const today=new Date().toISOString().slice(0,10);
  let changed=false;
  for(const e of ents){
    const t=byNameMap[e.name], q=t?QUOTES[t[2]]:null, ts=techScore(q).score;
    const v=computeVerdict({...e, ticker:t?.[2], q, tech:ts});
    let last=null; for(let i=HIST.length-1;i>=0;i--){ if(HIST[i].name===e.name){ last=HIST[i]; break; } }
    if(!last || last.lab!==v.lab){
      HIST.push({ ts:Date.now(), day:today, name:e.name, ticker:t?.[2]||'',
        lab:v.lab, cls:v.cls, composite:+v.composite.toFixed(2),
        price:q?.price??null, target:TARGETS[e.name]?.target??null });
      changed=true;
    }
  }
  if(HIST.length>400) HIST=HIST.slice(HIST.length-400);
  if(changed) localStorage.setItem(K_HIST,JSON.stringify(HIST));
}

// Fiabilité mesurée sur l'historique réel (≠ concordance des sources, qui n'est qu'un
// accord entre estimations au même instant t). Bull = ACHETER/Renforcer/Accumuler,
// jugé correct si le cours a progressé depuis le changement de reco ; Bear = Alléger/
// VENDRE, jugé correct si le cours a baissé. « Conserver » n'a pas de sens directionnel
// clair et n'est pas noté.
function computeReliability(){
  const bullLabels=new Set(['ACHETER','Renforcer','Accumuler']);
  const bearLabels=new Set(['Alléger','VENDRE']);
  const bull={n:0,ok:0}, bear={n:0,ok:0};
  for(const e of HIST){
    if(e.price==null) continue;
    const cur=e.ticker?QUOTES[e.ticker]?.price:null;
    if(cur==null) continue;
    const up=cur>e.price;
    if(bullLabels.has(e.lab)){ bull.n++; if(up) bull.ok++; }
    else if(bearLabels.has(e.lab)){ bear.n++; if(!up) bear.ok++; }
  }
  return {bull, bear, total:{n:bull.n+bear.n, ok:bull.ok+bear.ok}};
}
function renderHistory(){
  const el=$('#tab-hist');
  if(!HIST.length){ el.innerHTML='<div class="empty">Aucun historique pour l\'instant.<br>Chaque changement de reco s\'enregistre au fil des actualisations.</div>'; return; }
  const rel=computeReliability(), pct=b=>b.n?Math.round(100*b.ok/b.n):null;
  const relHtml = rel.total.n>=5
    ? `<div class="card" style="font-size:12.5px;color:var(--mut);margin-bottom:12px">📊 <b style="color:#c5d1ec">Fiabilité mesurée</b> (performance réelle du cours depuis chaque changement de reco — pas une estimation) : <b style="color:#c5d1ec">${pct(rel.total)}%</b> (${rel.total.ok}/${rel.total.n})${rel.bull.n?` · Achat ${pct(rel.bull)}% (${rel.bull.ok}/${rel.bull.n})`:''}${rel.bear.n?` · Vente ${pct(rel.bear)}% (${rel.bear.ok}/${rel.bear.n})`:''}</div>`
    : `<div class="card" style="font-size:12.5px;color:var(--mut);margin-bottom:12px">📊 Fiabilité mesurée : pas encore assez de données (minimum 5 changements de reco avec cours connu).</div>`;
  let h=`<div class="rc-head"><div class="rc-count">📜 ${HIST.length} changements</div>
    <button id="hist-clear" class="legend-btn">🗑 Vider</button></div>
    ${relHtml}
    <div class="card" style="font-size:12px;color:var(--mut);margin-bottom:12px">Un point est ajouté quand le verdict d'une valeur change. « Depuis » = évolution du cours depuis ce changement.</div>`;
  for(let i=HIST.length-1;i>=0;i--){
    const e=HIST[i];
    const cur=e.ticker?QUOTES[e.ticker]?.price:null;
    let perf=''; if(e.price&&cur){ const p=(cur/e.price-1)*100; perf=` · depuis <i class="${p>=0?'up':'down'}">${p>=0?'+':''}${p.toFixed(1)}%</i>`; }
    const d=new Date(e.ts).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    h+=`<div class="hist">
      <span class="reco-badge ${e.cls}">${e.lab}</span>
      <div class="hist-b"><div class="hist-n">${esc(e.name)}${e.ticker?` <span class="hist-tk">${esc(e.ticker)}</span>`:''}</div>
        <div class="hist-m">${d} · cours ${e.price!=null?fmt(e.price)+' €':'—'}${perf}</div></div>
    </div>`;
  }
  el.innerHTML=h;
  const cb=el.querySelector('#hist-clear');
  if(cb) cb.onclick=()=>{ if(confirm('Vider tout l\'historique des recos ?')){ HIST=[]; localStorage.removeItem(K_HIST); renderHistory(); } };
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
    if(ev.action!=='HOLD') alerts.push({name:p.name,ticker:p.ticker,action:ev.action,reasons:ev.reasons});
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
  if(!ent){ alert('Valeur inconnue. Utilise un nom de la liste Action (ex. Sodexo, Thales, LVMH…).'); return; }
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

/* ================= Notifications (Capacitor natif, repli Web Notification) =================
 * Une notification par valeur (pas un bloc de texte fourre-tout) avec un bouton d'action qui
 * ouvre directement la fiche Boursorama pour passer l'ordre, + une notif "résumé" groupée si
 * plusieurs alertes tombent en même temps (repli Android : les notifs du groupe se replient
 * sous le résumé). Dédupliqué par valeur avec un délai de rappel pour ne pas spammer à chaque
 * ouverture de l'app si rien n'a changé. */
const NOTIF_CHANNEL = 'reco-alerts';
const K_NOTIF_LOG = 'recoInvest:notiflog';
let NOTIF_LOG = {};
try{ NOTIF_LOG = JSON.parse(localStorage.getItem(K_NOTIF_LOG)||'{}'); }catch(e){ NOTIF_LOG={}; }
function shouldNotify(key, cooldownMs){
  const last=NOTIF_LOG[key];
  if(last && Date.now()-last<cooldownMs) return false;
  NOTIF_LOG[key]=Date.now();
  localStorage.setItem(K_NOTIF_LOG, JSON.stringify(NOTIF_LOG));
  return true;
}
function openExternal(url){
  try{ const P=window.Capacitor?.Plugins; if(P?.Browser){ P.Browser.open({url}); return; } }catch(e){}
  try{ window.open(url,'_blank','noopener'); }catch(e){}
}
async function setupNotifications(){
  try{
    const LN=window.Capacitor?.Plugins?.LocalNotifications;
    if(!LN) return;
    try{ await LN.createChannel?.({ id:NOTIF_CHANNEL, name:'Alertes Reco Invest', importance:5, visibility:1, vibration:true }); }catch(e){}
    try{ await LN.registerActionTypes?.({ types:[
      { id:'REC_BUY',  actions:[{ id:'open', title:'💰 Acheter sur Boursorama' }] },
      { id:'REC_SELL', actions:[{ id:'open', title:'💰 Vendre sur Boursorama' }] },
    ]}); }catch(e){}
    LN.addListener?.('localNotificationActionPerformed', ev=>{
      const url=ev?.notification?.extra?.url;
      if(url) openExternal(url);
    });
    try{ await LN.requestPermissions?.(); }catch(e){}
  }catch(e){}
  try{ if('Notification' in window && Notification.permission==='default') Notification.requestPermission(); }catch(e){}
}
let _notifSeq=0;
function nextNotifId(){ return (_notifSeq=(_notifSeq+1)%900000)+100; }
function sendNotification({title, body, url, actionTypeId, group, groupSummary, iconColor}){
  try{
    const LN=window.Capacitor?.Plugins?.LocalNotifications;
    if(LN){
      LN.schedule({notifications:[{
        id: nextNotifId(), title, body,
        channelId: NOTIF_CHANNEL,
        actionTypeId: actionTypeId||undefined,
        extra: url?{url}:undefined,
        group: group||undefined,
        groupSummary: !!groupSummary,
        iconColor: iconColor||undefined,
        autoCancel: true,
      }]});
      return;
    }
  }catch(e){}
  try{
    if('Notification' in window){
      const fire=()=>{ const n=new Notification(title,{body}); if(url) n.onclick=()=>{ try{window.focus();}catch(_){} openExternal(url); n.close(); }; };
      if(Notification.permission==='granted') fire();
      else if(Notification.permission!=='denied') Notification.requestPermission().then(pm=>{ if(pm==='granted') fire(); });
    }
  }catch(e){}
}

const SELL_COOLDOWN = 6*3600*1000;   // une alerte de vente peut se rappeler après 6h si toujours active
function notify(alerts){
  const due = alerts.filter(a=>shouldNotify('sell:'+a.name+':'+a.action, SELL_COOLDOWN));
  if(!due.length) return;
  const group='reco-sell';
  if(due.length>1){
    sendNotification({ title:'🔴 '+due.length+' alertes sur ton portefeuille',
      body: due.map(a=>a.name).join(', '), group, groupSummary:true, iconColor:'#ef4444' });
  }
  for(const a of due){
    sendNotification({
      title:(a.action==='SELL'?'🔴 Vendre ':'🟠 Alléger ')+a.name,
      body: a.reasons[0],
      url: boursoUrl(a.ticker, a.name),
      actionTypeId:'REC_SELL',
      group, iconColor:'#ef4444',
    });
  }
}

/* Notification opportunité d'achat sous un seuil de prix (par défaut 20 €). */
const BUY_PRICE_ALERT = 20;
const BUY_COOLDOWN = 20*3600*1000;   // au plus un rappel par jour tant que l'opportunité reste valide
function notifyBuyOpportunities(scored, tabId){
  const opps = scored.filter(e=>{
    const v=e.v;
    return /green|amber/.test(v.cls) && v.composite>=0.05 && e.q?.price!=null && e.q.price<BUY_PRICE_ALERT;
  }).filter(e=>shouldNotify('buy:'+tabId+':'+e.name+':'+e.v.lab, BUY_COOLDOWN));
  if(!opps.length) return;
  const group='reco-buy-'+tabId;
  if(opps.length>1){
    sendNotification({ title:'🟢 '+opps.length+' opportunités d\'achat < '+BUY_PRICE_ALERT+' €',
      body: opps.map(e=>e.name+' '+fmt(e.q.price)+' €').join(', '), group, groupSummary:true, iconColor:'#22c55e' });
  }
  for(const e of opps){
    const target=e.v.zv?.target||e.v.cv?.target||e.v.sa?.target||TARGETS[e.name]?.target;
    sendNotification({
      title:'🟢 '+e.name+' — '+e.v.lab,
      body: fmt(e.q.price)+' €'+(e.ticker?' · '+e.ticker:'')+(target?' · objectif '+fmt(target)+' €':''),
      url: boursoUrl(e.ticker, e.name),
      actionTypeId:'REC_BUY',
      group, iconColor:'#22c55e',
    });
  }
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
    <div class="card" style="font-size:12.5px;color:var(--mut)">💡 Répartition indicative. Ajuste selon horizon, fiscalité (PEA, assurance-vie) et capacité d'épargne. Croise avec <b style="color:#c5d1ec">Action</b> / <b style="color:#c5d1ec">ETF</b> (choix des valeurs) et <b style="color:#c5d1ec">Portefeuille</b> (règles de revente).</div>`;
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
    <div class="card" style="font-size:12.5px;color:var(--mut)">Action, ETF et Thématiques sont calculés automatiquement à partir du flux gratuit du Revenu.</div>`;
  el.querySelector('#mag-open').onclick=()=>openMag(CAFEYN,'Le Revenu');
}

/* ================= Navigation / chargement ================= */
/* Rendu différé : coalesce les rendus successifs de load() en un seul, et ne
 * remplace jamais le DOM pendant un scroll/geste tactile en cours (sinon
 * innerHTML= coupe le scroll en plein vol sur WebView mobile). */
let scrolling=false, scrollEndTimer=null, renderTimer=null, renderPending=false;
function markScrollActivity(){
  scrolling=true;
  clearTimeout(scrollEndTimer);
  scrollEndTimer=setTimeout(()=>{ scrolling=false; if(renderPending){ renderPending=false; renderAll(); } }, 200);
}
document.addEventListener('touchstart', markScrollActivity, {passive:true, capture:true});
document.addEventListener('touchmove', markScrollActivity, {passive:true, capture:true});
document.addEventListener('scroll', markScrollActivity, {passive:true, capture:true});
function scheduleRenderAll(){
  clearTimeout(renderTimer);
  renderTimer=setTimeout(()=>{
    if(scrolling){ renderPending=true; return; }
    renderAll();
  }, 300);
}
function showTab(name){
  document.querySelectorAll('#tabs .chip').forEach(c=>c.classList.toggle('active',c.dataset.tab===name));
  document.querySelectorAll('.tab').forEach(t=>t.hidden=t.id!=='tab-'+name);
}
function renderAll(){ renderRecos(); renderEtf(); renderThemes(); renderPortfolio(); renderHistory(); renderAlloc(); renderMag(); }

async function load(force){
  const st=$('#status'), btn=$('#refresh'); btn.classList.add('spin');
  if(!force){ try{ const c=JSON.parse(localStorage.getItem(K_ITEMS)||'null'); if(c?.items?.length){ ITEMS=c.items; renderAll(); } }catch(e){} }
  if(!ITEMS.length){ ITEMS=SEED_ITEMS; renderAll(); st.textContent='Édition d\'exemple — actualisation…'; }
  try{
    st.textContent='Analyse de l\'édition Le Revenu…';
    ITEMS = await fetchRss();
    localStorage.setItem(K_ITEMS,JSON.stringify({ts:Date.now(),items:ITEMS}));
    scheduleRenderAll();
    // tickers = valeurs + ETF (toujours suivis) + positions
    const ents    = analyseEntities();
    const etfEnts = analyseEntities(ETFS, true);
    const cited = ents.map(e=>byName[e.name]?.[2]).filter(Boolean);
    const etfTk = ETFS.map(e=>e[2]);
    const held  = PORT.map(p=>p.ticker).filter(Boolean);
    st.textContent='Cours & indicateurs techniques…';
    await loadQuotes([...new Set([...cited,...etfTk,...held])], force);
    scheduleRenderAll();
    st.textContent='Objectifs de cours (Le Revenu)…';
    await fetchTargets(ents, force);
    await fetchTargets(etfEnts, force);
    scheduleRenderAll();
    st.textContent='Consensus analystes mondial…';
    await fetchConsensus([...new Set([...cited,...etfTk,...held])], force);
    scheduleRenderAll();
    st.textContent='Consensus Zonebourse (France)…';
    await fetchZonebourse(ents, force);
    await fetchZonebourse(etfEnts, force, byNameETF);
    scheduleRenderAll();
    st.textContent='Jauge technique TradingView…';
    await fetchTradingView(ents, force);
    await fetchTradingView(etfEnts, force, byNameETF);
    scheduleRenderAll();
    st.textContent='Consensus StockAnalysis.com…';
    await fetchStockAnalysis(ents, force);
    await fetchStockAnalysis(etfEnts, force, byNameETF);
    scheduleRenderAll();
    st.textContent='Presse mondiale (Google News)…';
    await fetchGoogleNews(ents, force);
    await fetchGoogleNews(etfEnts, force, 'ETF');
    recordHistory();                          // valeurs
    recordHistory(ETFS, byNameETF, true);     // ETF
    scheduleRenderAll();
    st.textContent=ITEMS.length+' articles · 7 sources · '+new Date().toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  }catch(e){
    if(!ITEMS.length) st.textContent='⚠️ Hors-ligne et aucun cache.';
    else st.textContent='⚠️ Actualisation partielle — cache affiché.';
    scheduleRenderAll();
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

/* Bulle légende au TAP sur une pastille de source (mobile-friendly, une seule
   bulle partagée, positionnée près du point touché, fermée au tap ailleurs). */
function ensureDotTip(){
  if(window._dotTipBound) return; window._dotTipBound=true;
  let tip=document.getElementById('dot-tip');
  if(!tip){ tip=document.createElement('div'); tip.id='dot-tip'; tip.hidden=true; document.body.appendChild(tip); }
  document.addEventListener('click',ev=>{
    const span=ev.target.closest && ev.target.closest('.dotitem');
    if(span && span.dataset.tip){
      tip.textContent=span.dataset.tip; tip.hidden=false;
      const r=span.getBoundingClientRect(), tw=tip.offsetWidth, th=tip.offsetHeight;
      let left=Math.max(8, Math.min(r.left+r.width/2-tw/2, window.innerWidth-tw-8));
      let top=r.top-th-8; if(top<8) top=r.bottom+8;
      tip.style.left=left+'px'; tip.style.top=top+'px';
    } else {
      tip.hidden=true;
    }
  });
}

document.addEventListener('DOMContentLoaded',()=>{
  $('#app-ver').textContent='v'+APP_VERSION;
  document.querySelectorAll('#tabs .chip').forEach(c=>c.onclick=()=>showTab(c.dataset.tab));
  $('#refresh').onclick=()=>load(true);
  ensureDotTip();
  setupNotifications();
  renderAll();
  load(false);
  setTimeout(checkForUpdate, 2500);
});
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
