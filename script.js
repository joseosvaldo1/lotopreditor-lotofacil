const PRIMOS=[2,3,5,7,11,13,17,19,23];
const LOTOFACIL_API_URL='https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil';
const CORS_PROXIES=[
  'https://api.allorigins.win/raw?url=',
  'https://api.allorigins.win/get?url='
];
const MAX_HISTORY_GAMES=200;
let history=[], generated=[];
const $=id=>document.getElementById(id);

async function fetchJsonWithFallback(url, options={}){
  const attempts=[
    {label:'direct', fn:()=>fetch(url,{...options,headers:{...options.headers}})},
    ...CORS_PROXIES.map(proxy=>({
      label:'proxy',
      fn:()=>fetch(`${proxy}${encodeURIComponent(url)}`, { ...options, headers:{ ...options.headers, Accept:'application/json' } })
    }))
  ];

  for(const attempt of attempts){
    try{
      const response=await attempt.fn();
      if(!response.ok) continue;
      const text=await response.text();
      if(!text) continue;
      const isProxyPayload = attempt.label === 'proxy' && text.startsWith('{') && text.includes('"contents"');
      const payload = isProxyPayload ? JSON.parse(text).contents : text;
      return JSON.parse(payload);
    }catch(error){
      continue;
    }
  }

  throw new Error('Falha ao acessar a API da Lotofácil.');
}

const EXEMPLO=`01 02 03 06 07 08 09 10 13 14 16 18 19 20 23
03 04 05 06 07 09 10 11 12 15 16 19 20 21 24
01 03 04 05 06 08 10 11 12 13 14 18 19 22 24
01 03 04 05 06 08 10 12 13 15 18 19 21 23 24
01 03 07 08 10 11 13 14 15 17 19 20 21 24 25
02 04 06 07 08 10 11 12 14 15 16 20 23 24 25
01 02 04 06 08 09 11 12 13 14 15 16 19 24 25
01 03 04 05 06 07 09 11 14 15 16 17 20 21 25
06 07 08 09 11 12 13 14 15 16 17 18 19 23 25
01 04 05 07 08 09 12 16 17 18 20 21 22 23 24
03 04 06 08 10 11 12 13 15 17 19 20 22 23 24
01 03 06 07 08 09 12 13 14 16 18 21 23 24 25
01 04 07 08 11 12 14 15 17 18 19 22 23 24 25
01 02 08 10 11 12 15 16 18 19 20 21 22 24 25
01 03 04 05 06 12 14 15 16 17 19 22 23 24 25
03 04 05 07 08 11 15 16 17 18 19 20 22 23 25
03 05 06 07 08 09 11 12 13 16 19 21 22 24 25
01 02 03 04 05 06 07 12 15 16 17 19 21 22 23
03 04 05 07 08 10 11 13 14 16 17 19 23 24 25
01 02 03 05 06 08 09 10 13 14 16 17 18 20 22`;

function parseHistory(text){
  const lines=text.split(/\n+/).map(l=>l.trim()).filter(Boolean);
  if(!lines.length) return {error:'Cole ao menos 1 concurso.'};
  const games=[];
  for(const line of lines){
    const nums=line.split(/[\s,;\-–.]+/).filter(Boolean).map(Number);
    if(nums.length!==15) return {error:`Cada linha precisa de 15 números (encontrado ${nums.length}).`};
    if(new Set(nums).size!==15) return {error:'Há números repetidos na mesma linha.'};
    if(nums.some(n=>!Number.isInteger(n)||n<1||n>25)) return {error:'Use apenas inteiros de 1 a 25.'};
    games.push(nums);
  }
  return {games};
}

function normalizeExternalGames(payload){
  const source=Array.isArray(payload)?payload:
    Array.isArray(payload?.resultados)?payload.resultados:
    Array.isArray(payload?.resultado)?payload.resultado:
    Array.isArray(payload?.data)?payload.data:
    Array.isArray(payload?.lista)?payload.lista:
    [];

  const games=[];
  for(const item of source){
    const record=item && typeof item === 'object' ? item : null;
    const rawNumbers=record ? (
      Array.isArray(record.listaDezenas)?record.listaDezenas:
      Array.isArray(record.dezenas)?record.dezenas:
      Array.isArray(record.dezenasSorteadasOrdemSorteio)?record.dezenasSorteadasOrdemSorteio:
      Array.isArray(record.numeros)?record.numeros:
      typeof record.dezenas === 'string' ? record.dezenas.split(/[\s,;]+/).filter(Boolean) :
      Array.isArray(record.resultado)?record.resultado:
      null
    ) : Array.isArray(item)?item:null;

    if(!rawNumbers || rawNumbers.length !== 15) continue;
    const nums=rawNumbers.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
    if(nums.length!==15) continue;
    const concurso=Number(record?.numero ?? record?.concurso ?? record?.id ?? 0);
    games.push({concurso, nums});
  }

  games.sort((a,b)=>(a.concurso||0)-(b.concurso||0));
  return games.map(g=>g.nums);
}

function proxiedApiUrl(rawUrl){
  return `${CORS_PROXIES[0]}${encodeURIComponent(rawUrl)}`;
}

async function fetchContestByNumber(numero){
  const url=`${LOTOFACIL_API_URL}/ultimos-resultados?numero=${numero}`;
  return fetchJsonWithFallback(url, {headers:{Accept:'application/json'}});
}

async function loadOfficialHistory(){
  $('parseError').textContent='Buscando resultados oficiais...';
  try{
    const latestContest = await fetchJsonWithFallback(LOTOFACIL_API_URL, { headers: { Accept: 'application/json' } });
    const latestNumero = Number(latestContest?.numero ?? latestContest?.id ?? 0);
    if(!latestNumero) throw new Error('Não foi possível identificar o número do concurso mais recente.');

    const startNumero = Math.max(1, latestNumero - MAX_HISTORY_GAMES + 1);
    const requests = [];
    for(let numero=startNumero; numero<=latestNumero; numero++){
      requests.push(fetchContestByNumber(numero));
    }

    const results = await Promise.allSettled(requests);
    const apiGames = normalizeExternalGames(results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value));

    if(!apiGames.length) throw new Error('A API não retornou concursos válidos da Lotofácil.');

    history = apiGames.slice(-MAX_HISTORY_GAMES);
    $('historyInput').value = history.map(g => g.map(n => String(n).padStart(2, '0')).join(' ')).join('\n');
    $('parseError').textContent='';
    renderAnalysis();
    $('analysisPanel').classList.remove('hidden');
    $('genPanel').classList.remove('hidden');
  }catch(error){
    console.error(error);
    $('parseError').textContent='Não foi possível carregar os resultados da API. Cole os números manualmente.';
  }
}

function analyzeHistory(games){
  const freq=Array(26).fill(0), delay=Array(26).fill(games.length);
  games.forEach(g=>g.forEach(n=>freq[n]++));
  for(let n=1;n<=25;n++)
    for(let i=games.length-1;i>=0;i--)
      if(games[i].includes(n)){delay[n]=games.length-1-i;break;}
  return {freq,delay,last:games[games.length-1]};
}

function markovScores(games){
  const co={};
  for(let i=0;i<games.length-1;i++){
    const a=games[i], b=new Set(games[i+1]);
    for(const n of a) for(let m=1;m<=25;m++)
      co[n+'_'+m]=(co[n+'_'+m]||0)+(b.has(m)?1:0);
  }
  const last=games[games.length-1], s=Array(26).fill(0);
  for(let m=1;m<=25;m++) for(const n of last) s[m]+=co[n+'_'+m]||0;
  return s;
}

function weightedSample(scores,count=15){
  const pool=[]; for(let n=1;n<=25;n++) pool.push({n,w:Math.max(scores[n],.0001)});
  const picked=[];
  while(picked.length<count){
    const total=pool.reduce((s,p)=>s+p.w,0); let r=Math.random()*total;
    for(let i=0;i<pool.length;i++){ r-=pool[i].w; if(r<=0){picked.push(pool[i].n);pool.splice(i,1);break;} }
  }
  return picked.sort((a,b)=>a-b);
}

function patternScore(game,last){
  const sum=game.reduce((a,b)=>a+b,0);
  const odd=game.filter(n=>n%2).length;
  const primeCt=game.filter(n=>PRIMOS.includes(n)).length;
  const rep=last?game.filter(n=>last.includes(n)).length:9;
  const rows=[0,0,0,0,0]; game.forEach(n=>rows[Math.floor((n-1)/5)]++);
  const g=(x,mu,sig)=>Math.exp(-((x-mu)**2)/(2*sig*sig));
  let s=30*g(sum,195,14)+20*g(odd,7.6,1.1)+25*g(rep,8.9,1.2)+15*g(primeCt,4.9,1.1);
  const pen=rows.reduce((a,c)=>a+(c===0||c===5?4:(c===1||c===4?1:0)),0);
  return {score:Math.round(s+Math.max(0,10-pen)),sum,odd,primeCt,rep};
}

function refine(game,last,iters=60){
  let best=game.slice().sort((a,b)=>a-b), bs=patternScore(best,last).score;
  for(let i=0;i<iters;i++){
    const inSet=new Set(best), out=[];
    for(let n=1;n<=25;n++) if(!inSet.has(n)) out.push(n);
    const cand=best.slice();
    cand.splice(Math.floor(Math.random()*15),1);
    cand.push(out[Math.floor(Math.random()*out.length)]);
    const cs=patternScore(cand,last).score;
    if(cs>bs){best=cand.sort((a,b)=>a-b);bs=cs;}
  }
  return best;
}

function cross(A,B){
  const keep=new Set(A.filter(()=>Math.random()<.5)), child=[...keep];
  for(const n of B) if(child.length<15&&!keep.has(n)) child.push(n);
  while(child.length<15){const n=1+Math.floor(Math.random()*25); if(!child.includes(n)) child.push(n);}
  return child.slice(0,15).sort((a,b)=>a-b);
}
function mutate(g){
  const c=g.slice(), inSet=new Set(c), out=[];
  for(let n=1;n<=25;n++) if(!inSet.has(n)) out.push(n);
  const k=1+Math.floor(Math.random()*3);
  for(let i=0;i<k;i++){ c.splice(Math.floor(Math.random()*c.length),1); c.push(out.splice(Math.floor(Math.random()*out.length),1)[0]); }
  return c.sort((a,b)=>a-b);
}

function genetic(count,games){
  const {freq,delay,last}=analyzeHistory(games);
  const maxF=Math.max(...freq.slice(1)), maxD=Math.max(...delay.slice(1),1);
  const mark=markovScores(games), maxM=Math.max(...mark.slice(1),1);
  const bias=Array(26).fill(.3);
  for(let n=1;n<=25;n++) bias[n]=.3+4*freq[n]/maxF+2.5*delay[n]/maxD+3*mark[n]/maxM;
  const POP=240, ELITE=40, GENS=90;
  let pop=Array.from({length:POP},()=>weightedSample(bias));
  const fit=g=>patternScore(g,last).score;
  for(let gen=0;gen<GENS;gen++){
    const scored=pop.map(g=>({g,f:fit(g)})).sort((a,b)=>b.f-a.f);
    const elite=scored.slice(0,ELITE).map(s=>s.g), next=elite.slice();
    while(next.length<POP){
      const A=elite[Math.floor(Math.random()*elite.length)], B=elite[Math.floor(Math.random()*elite.length)];
      let child=cross(A,B); if(Math.random()<.35) child=mutate(child);
      next.push(child);
    }
    pop=next;
  }
  const uniq=[], seen=new Set();
  pop.map(g=>({g,f:fit(g)})).sort((a,b)=>b.f-a.f).forEach(({g})=>{
    const k=g.join(','); if(!seen.has(k)&&uniq.length<count){seen.add(k);uniq.push(g);}
  });
  let guard=0;
  while(uniq.length<count&&guard++<300){
    const g=refine(weightedSample(bias),last), k=g.join(',');
    if(!seen.has(k)){seen.add(k);uniq.push(g);}
  }
  return uniq;
}

function generate(strat,count){
  if(strat==='genetico') return genetic(count,history);
  const {freq,delay,last}=analyzeHistory(history);
  const maxF=Math.max(...freq.slice(1)), maxD=Math.max(...delay.slice(1),1);
  const mark=markovScores(history), maxM=Math.max(...mark.slice(1),1);
  const scores=Array(26).fill(0);
  for(let n=1;n<=25;n++){
    if(strat==='freq') scores[n]=freq[n]+.3;
    else if(strat==='delay') scores[n]=delay[n]*delay[n]+.3;
    else if(strat==='markov') scores[n]=mark[n]/maxM*10+freq[n]/maxF*2+.3;
    else scores[n]=(freq[n]/maxF)*5+(delay[n]/maxD)*3+(mark[n]/maxM)*2+.3;
  }
  const out=[], seen=new Set(); let guard=0;
  while(out.length<count&&guard++<500){
    const g=refine(weightedSample(scores),last), k=g.join(',');
    if(!seen.has(k)){seen.add(k);out.push(g);}
  }
  return out.sort((a,b)=>patternScore(b,last).score-patternScore(a,last).score);
}

function renderAnalysis(){
  const {freq,delay,last}=analyzeHistory(history);
  const maxF=Math.max(...freq.slice(1));
  const sorted=[...Array(25)].map((_,i)=>i+1);
  const hot=new Set([...sorted].sort((a,b)=>freq[b]-freq[a]).slice(0,6));
  const cold=new Set([...sorted].sort((a,b)=>freq[a]-freq[b]).slice(0,6));
  $('freqChart').innerHTML=sorted.map(n=>{
    const h=6+freq[n]/maxF*90;
    const c=hot.has(n)?'var(--gold)':cold.has(n)?'#5db6ff':'var(--accent)';
    return `<div class="fcol"><div class="fbar" style="height:${h}px;background:${c}" title="Nº ${n}: ${freq[n]}x"></div><div class="fnum">${String(n).padStart(2,'0')}</div></div>`;
  }).join('');
  const late=[...sorted].sort((a,b)=>delay[b]-delay[a]).slice(0,5);
  let reps=[]; for(let i=1;i<history.length;i++){const s=new Set(history[i-1]);reps.push(history[i].filter(n=>s.has(n)).length);}
  const avg=a=>a.length?(a.reduce((x,y)=>x+y,0)/a.length).toFixed(1):'—';
  const sums=history.map(g=>g.reduce((a,b)=>a+b,0)), odds=history.map(g=>g.filter(n=>n%2).length);
  $('analysisStats').innerHTML=`
    <div class="stat">🔥 Mais frequentes<div class="chips">${[...hot].map(n=>`<span class="chip hot">${String(n).padStart(2,'0')} (${freq[n]}x)</span>`).join('')}</div></div>
    <div class="stat">🧊 Menos frequentes<div class="chips">${[...cold].map(n=>`<span class="chip cold">${String(n).padStart(2,'0')} (${freq[n]}x)</span>`).join('')}</div></div>
    <div class="stat">⏰ Mais atrasadas (concursos sem sair)<div class="chips">${late.map(n=>`<span class="chip late">${String(n).padStart(2,'0')} (${delay[n]})</span>`).join('')}</div></div>
    <div class="stat">📊 Soma média: <b>${avg(sums)}</b> · Ímpares médios: <b>${avg(odds)}</b> · Repetidas vs anterior: <b>${avg(reps)}</b></div>`;
}

function renderResults(games){
  generated=games; const {last}=analyzeHistory(history);
  $('results').innerHTML=games.map((g,i)=>{
    const p=patternScore(g,last);
    const balls=Array.from({length:25},(_,k)=>k+1)
      .map(n=>`<div class="ball${g.includes(n)?' on':''}">${String(n).padStart(2,'0')}</div>`).join('');
    return `<div class="game"><b>Jogo ${i+1}</b> — aderência ao padrão: ${p.score}/100
      <div class="bar"><div style="width:${p.score}%"></div></div>
      <div class="grid25">${balls}</div>
      <div class="nums">${g.map(n=>String(n).padStart(2,'0')).join(' ')}</div>
      <div class="meta">Soma ${p.sum} · Ímpares ${p.odd} · Repete ${p.rep} do anterior · Primos ${p.primeCt}</div></div>`;
  }).join('') + `<p class="meta" style="margin-top:10px">⚠️ "Aderência ao padrão" mede semelhança com o histórico — <b>não</b> é probabilidade de acerto. Cada jogo mantém a chance de 1 em 3.268.760.</p>`;
}

$('btnExample').onclick=()=>{$('historyInput').value=EXEMPLO;doAnalyze();};
$('btnLoadApi').onclick=loadOfficialHistory;
$('btnAnalyze').onclick=doAnalyze;
function doAnalyze(){
  const raw=$('historyInput').value.trim();
  if(!raw){
    loadOfficialHistory();
    return;
  }
  const r=parseHistory(raw);
  if(r.error){$('parseError').textContent=r.error;return;}
  $('parseError').textContent=''; history=r.games;
  renderAnalysis();
  $('analysisPanel').classList.remove('hidden');
  $('genPanel').classList.remove('hidden');
}
$('btnGenerate').onclick=()=>{
  const n=Math.min(10,Math.max(1,parseInt($('count').value)||1));
  renderResults(generate($('strategy').value,n));
  $('checkPanel').classList.remove('hidden');
};
$('btnCheck').onclick=()=>{
  const nums=$('checkInput').value.split(/[\s,;\-–.]+/).filter(Boolean).map(Number);
  if(nums.length!==15||new Set(nums).size!==15){$('checkResults').innerHTML='<p class="error">Informe 15 números válidos.</p>';return;}
  const s=new Set(nums);
  $('checkResults').innerHTML=generated.map((g,i)=>{
    const hits=g.filter(n=>s.has(n)).length;
    const msg=hits>=15?'🏆 JACKPOT!':hits>=11?`🎉 Premiado (${hits} acertos)!`:`${hits} acertos`;
    return `<div class="stat" style="margin-top:8px">Jogo ${i+1}: <b>${msg}</b></div>`;
  }).join('');
};

window.addEventListener('DOMContentLoaded', loadOfficialHistory);
