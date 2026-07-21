/**
 * KOVANICA $KVNC — app.js v7
 * Logo kovanica kao mine button · NFT slike iz baze · Glassmorphism
 */

// ── TELEGRAM ──
const tg = window.Telegram?.WebApp;
if (tg) {
    tg.expand();
    tg.setHeaderColor?.('#0D0D1C');
    tg.setBackgroundColor?.('#07070F');
}

// ── I18N ──
const LANG = (tg?.initDataUnsafe?.user?.language_code || navigator.language || 'hr').startsWith('hr') ? 'hr' : 'en';
const T = {
    hr: {
        no_energy:'⚡ Nema energije! Pričekaj regeneraciju.',
        boost_already:'Boost je već aktivan!', boost_ok:'⚡ 2× Boost aktiviran na 10 minuta!',
        nft_equipped:'✅ NFT opremljen!', nft_equip_err:'❌ Greška pri opremanju',
        nft_none:'Nemaš NFT-ova.\nRudarenjem otključavaš NFT-ove!',
        nft_count:'Imaš {n} NFT-ova.\nKoristi /nfts u botu za pregled.',
        withdraw_confirm:'Povući NFT na tvoj TON wallet?\nAdmin šalje u roku 24h.',
        withdraw_ok:'✅ Zahtjev primljen!', withdraw_err:'❌ Greška pri withdrawalu',
        link_copied:'✅ Link kopiran!',
        share_text:'⛏️ Pridruži se Kovanica rudniku i rudari $KVNC kripto!',
        max_rank:'👑 MAX RANG', progress_to:'do sljedećeg ranga',
        energy_full:'Puna', energy_regen:'za {t}',
        wallet_connected:'✅ Povezan', wallet_disconnected:'Nije povezan',
        no_miners:'Još nema rudara!', no_quests:'Nema aktivnih zadataka',
        lb_you:'👤 Ti', lb_miner:'Rudar #{id}',
        game_win:'🎉 +{r} KVNC', game_lose:'😔 Poraz...', game_draw:'🤝 Neriješeno',
        game_play_again:'Igraj ponovo', game_close:'Zatvori',
        cf_choose:'Odaberi stranu:', rps_choose:'Odaberi potez:',
        guess_prompt:'Mislim na broj od 1 do 10.',
        guess_higher:'📈 Više!', guess_lower:'📉 Niže!', guess_exact:'🎯 Točno!',
        guess_lost:'😔 Bio je {n}.', guess_try:'Pokušaj {n}/3',
        mem_moves:'Potezi: {n}', mem_win:'🎉 Riješeno za {n} poteza!',
        q_clicks:'Rudarski Dan', q_clicks_d:'Klikni {t} puta danas',
        q_refs:'Pozovi Prijatelje', q_refs_d:'Pozovi {t} korisnika',
        q_nft:'Iskopaj NFT', q_nft_d:'Iskopaj {t} NFT',
    },
    en: {
        no_energy:'⚡ No energy! Wait for regen.',
        boost_already:'Boost already active!', boost_ok:'⚡ 2× Boost activated for 10 min!',
        nft_equipped:'✅ NFT equipped!', nft_equip_err:'❌ Equip error',
        nft_none:'No NFTs yet.\nMine to unlock NFTs!',
        nft_count:'You have {n} NFTs.\nUse /nfts in bot.',
        withdraw_confirm:'Withdraw NFT to your TON wallet?\nAdmin sends within 24h.',
        withdraw_ok:'✅ Request received!', withdraw_err:'❌ Withdrawal error',
        link_copied:'✅ Link copied!',
        share_text:'⛏️ Join Kovanica mine and earn $KVNC crypto!',
        max_rank:'👑 MAX RANK', progress_to:'to next rank',
        energy_full:'Full', energy_regen:'in {t}',
        wallet_connected:'✅ Connected', wallet_disconnected:'Not connected',
        no_miners:'No miners yet!', no_quests:'No active quests',
        lb_you:'👤 You', lb_miner:'Miner #{id}',
        game_win:'🎉 +{r} KVNC', game_lose:'😔 Loss...', game_draw:'🤝 Draw',
        game_play_again:'Play again', game_close:'Close',
        cf_choose:'Choose side:', rps_choose:'Choose:',
        guess_prompt:"I'm thinking of a number 1-10.",
        guess_higher:'📈 Higher!', guess_lower:'📉 Lower!', guess_exact:'🎯 Exact!',
        guess_lost:'😔 It was {n}.', guess_try:'Attempt {n}/3',
        mem_moves:'Moves: {n}', mem_win:'🎉 Solved in {n} moves!',
        q_clicks:'Mining Day', q_clicks_d:'Click {t} times today',
        q_refs:'Invite Friends', q_refs_d:'Invite {t} users',
        q_nft:'Mine NFT', q_nft_d:'Mine {t} NFT',
    }
};
function tr(k, v={}) {
    let s = T[LANG]?.[k] || T.hr[k] || k;
    for (const [key,val] of Object.entries(v)) s = s.replace(`{${key}}`, val);
    return s;
}

// ── STATE ──
let userData=null, tonConnectUI=null;
let energy=1000, maxEnergy=1000;
let boostEndTime=null, boostInterval=null, energyInterval=null;
let currentTab='mine', refLink='', soundEnabled=true, audioCtx=null;
let tapQueue=0, tapFlushTimer=null;

// ── RANKS ──
const RANKS=[
    {name:'🪨 Novi rudar',min:0,max:100},
    {name:'⛏️ Početnik',min:100,max:500},
    {name:'⛏️ Napredni rudar',min:500,max:2000},
    {name:'🥉 Brončani rudar',min:2000,max:5000},
    {name:'🥈 Srebrni rudar',min:5000,max:10000},
    {name:'🥇 Zlatni rudar',min:10000,max:20000},
    {name:'🔹 Platinasti rudar',min:20000,max:50000},
    {name:'💎 Dijamantni rudar',min:50000,max:100000},
    {name:'👑 Kralj rudara',min:100000,max:Infinity},
];
function getRank(tc){for(let i=RANKS.length-1;i>=0;i--)if(tc>=RANKS[i].min)return{...RANKS[i],index:i};return{...RANKS[0],index:0};}
function getRankPct(tc){const r=getRank(tc);if(r.max===Infinity)return 100;return Math.min(100,Math.max(0,((tc-r.min)/(r.max-r.min))*100));}

// ── AUDIO ──
function playSound(freq=800){
    if(!soundEnabled)return;
    try{
        if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();
        const o=audioCtx.createOscillator(),g=audioCtx.createGain();
        o.connect(g);g.connect(audioCtx.destination);
        o.frequency.setValueAtTime(freq,audioCtx.currentTime);
        o.frequency.exponentialRampToValueAtTime(freq*.5,audioCtx.currentTime+.08);
        g.gain.setValueAtTime(.2,audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+.08);
        o.start();o.stop(audioCtx.currentTime+.08);
    }catch(e){}
}
function playWin(){playSound(880);setTimeout(()=>playSound(1100),110);}
function playLose(){playSound(280);}
function toggleSound(){
    soundEnabled=!soundEnabled;
    const b=document.getElementById('soundBtn');
    if(b)b.textContent=soundEnabled?'🔊':'🔇';
    tg?.HapticFeedback?.selectionChanged();
}

// ── BG CANVAS ──
function initBG(){
    const c=document.getElementById('bgCanvas');if(!c)return;
    const ctx=c.getContext('2d');
    let W,H,pts=[];
    function resize(){W=c.width=window.innerWidth;H=c.height=window.innerHeight;}
    resize();window.addEventListener('resize',resize);
    for(let i=0;i<30;i++)pts.push({x:Math.random()*1000,y:Math.random()*1000,r:Math.random()*1.5+.4,vx:(Math.random()-.5)*.18,vy:-Math.random()*.2-.04,a:Math.random(),c:Math.random()>.5?'#FFD700':'#22D3EE'});
    (function frame(){
        ctx.clearRect(0,0,W,H);
        pts.forEach(p=>{
            p.x+=p.vx;p.y+=p.vy;p.a+=.004;
            if(p.y<-10){p.y=H+10;p.x=Math.random()*W;}
            if(p.x<-10||p.x>W+10)p.vx*=-1;
            ctx.globalAlpha=Math.sin(p.a)*.3+.35;
            ctx.fillStyle=p.c;
            ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();
        });
        ctx.globalAlpha=1;
        requestAnimationFrame(frame);
    })();
}

// ── TOAST ──
let toastT;
function toast(msg,type='',dur=2400){
    const el=document.getElementById('toast');if(!el)return;
    el.textContent=msg;el.className='toast show'+(type?' '+type:'');
    clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),dur);
}

// ── PARTICLES ──
function spawnParticles(x,y){
    const c=document.getElementById('particleContainer');if(!c)return;
    const cols=['#FFD700','#FFE566','#F97316','#22D3EE','#fff'];
    for(let i=0;i<12;i++){
        const p=document.createElement('div');p.className='particle';
        const sz=Math.random()*5+3;
        p.style.cssText=`left:${x}px;top:${y}px;width:${sz}px;height:${sz}px;background:${cols[Math.floor(Math.random()*cols.length)]};--dx:${(Math.random()-.5)*140}px;--dy:${-(Math.random()*120+40)}px;`;
        c.appendChild(p);setTimeout(()=>p.remove(),750);
    }
}

// ── HELPERS ──
function setEl(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
function getUser(){return tg?.initDataUnsafe?.user||null;}

// ── INIT ──
async function init(){
    initBG();
    try{
        const user=getUser();
        if(!user){toast('Otvori kroz Telegram!','error');return;}

        const av=document.getElementById('avatar');
        if(av){
            if(user.photo_url){av.style.backgroundImage=`url(${user.photo_url})`;av.style.backgroundSize='cover';av.textContent='';}
            else av.textContent=(user.first_name||'R')[0].toUpperCase();
        }
        setEl('username',user.first_name||user.username||'Rudar');

        const resp=await fetch('/api/me',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rawUser:user,initData:tg?.initData||''})});
        if(!resp.ok)throw new Error(`HTTP ${resp.status}`);
        userData=await resp.json();

        energy=maxEnergy=1000;
        updateUI(userData);
        startEnergyRegen();

        refLink=`https://t.me/kovanicatapbot?start=ref_${user.id}`;
        setEl('refLink',refLink);
        setEl('refCount',userData.referralCount||0);
        setEl('refEarned',((userData.referralCount||0)*10).toFixed(0));

        tg?.HapticFeedback?.impactOccurred('light');
        initTonConnect();
    }catch(e){
        console.error('Init error:',e);
        toast('Greška pri učitavanju','error');
    }
}

// ── UPDATE UI ──
function updateUI(data){
    if(!data)return;
    const tc=data.totalClicks||0;
    const rank=getRank(tc);
    const pct=getRankPct(tc);
    const base=data.baseReward||data.reward||1;

    setEl('balance',(data.clickBalance||0).toFixed(4));
    setEl('rankBadge',data.rank||rank.name);
    setEl('totalClicks',tc.toLocaleString());
    setEl('dailyClicks',(data.dailyClicks||0).toLocaleString());
    setEl('rewardPerTap',base.toFixed(4));
    setEl('rewardSub',`+${base.toFixed(4)} KVNC po kliku · tapni kovanicu`);

    const fill=document.getElementById('rankProgressFill');
    if(fill)fill.style.width=`${pct}%`;
    if(rank.max===Infinity)setEl('rankProgressText',tr('max_rank'));
    else setEl('rankProgressText',`${tc.toLocaleString()} / ${rank.max.toLocaleString()}`);

    if(data.energy!==undefined)energy=data.energy;
    if(data.maxEnergy!==undefined)maxEnergy=data.maxEnergy;
    updateEnergyUI();

    if(data.boostActive&&data.boostEndsAt)startBoostTimer(new Date(data.boostEndsAt).getTime());
    const btn=document.getElementById('mineBtn');
    if(btn)btn.disabled=energy<=0;
}

// ── ENERGY ──
function updateEnergyUI(){
    const pct=maxEnergy>0?Math.min(100,(energy/maxEnergy)*100):0;
    const fill=document.getElementById('energyFill');
    if(fill)fill.style.width=`${pct}%`;
    setEl('energyVal',`${Math.floor(energy)}/${maxEnergy}`);
    const eta=document.getElementById('energyCountdown');
    if(!eta)return;
    if(energy>=maxEnergy){eta.textContent=tr('energy_full');eta.style.color='var(--cyan)';}
    else{const s=Math.ceil((maxEnergy-energy)/2),m=Math.floor(s/60),sec=s%60;eta.textContent=tr('energy_regen',{t:`${m}m ${sec}s`});eta.style.color='var(--txt-faint)';}
}
function startEnergyRegen(){
    if(energyInterval)clearInterval(energyInterval);
    energyInterval=setInterval(()=>{
        if(energy<maxEnergy){energy=Math.min(maxEnergy,energy+2);updateEnergyUI();
            if(energy>0){const b=document.getElementById('mineBtn');if(b)b.disabled=false;}}
    },1000);
}

// ── BOOST TIMER ──
function startBoostTimer(endTs){
    const bar=document.getElementById('boostBar');if(bar)bar.style.display='flex';
    if(boostInterval)clearInterval(boostInterval);
    const total=10*60*1000;
    boostInterval=setInterval(()=>{
        const rem=endTs-Date.now();
        if(rem<=0){clearInterval(boostInterval);if(bar)bar.style.display='none';return;}
        const m=Math.floor(rem/60000),s=Math.floor((rem%60000)/1000);
        setEl('boostTime',`${m}:${s.toString().padStart(2,'0')}`);
        const p=document.getElementById('boostProgress');
        if(p)p.style.width=`${Math.min(100,(rem/total)*100)}%`;
    },1000);
    boostEndTime=endTs;
}

// ── MINE (BATCH TAP) ──
function handleMine(e){
    if(energy<=0){toast(tr('no_energy'),'error');return;}
    energy=Math.max(0,energy-1);
    tapQueue++;

    // Coin animation
    const img=document.getElementById('coinImg');
    if(img){img.classList.remove('tap');void img.offsetWidth;img.classList.add('tap');}

    // Float reward
    const base=userData?.baseReward||1;
    const fc=document.getElementById('clickCounter');
    if(fc){fc.textContent=`+${base.toFixed(4)}`;fc.classList.remove('show');void fc.offsetWidth;fc.classList.add('show');setTimeout(()=>fc.classList.remove('show'),700);}

    // Particles
    const coords=e?.clientX?{x:e.clientX,y:e.clientY}:(()=>{const r=document.getElementById('coinImg')?.getBoundingClientRect();return r?{x:r.left+r.width/2,y:r.top+r.height/2}:{x:200,y:300};})();
    spawnParticles(coords.x,coords.y);
    playSound(800+Math.random()*200);
    tg?.HapticFeedback?.impactOccurred('medium');

    // Optimistic balance
    const balEl=document.getElementById('balance');
    if(balEl)balEl.textContent=(parseFloat(balEl.textContent||'0')+base).toFixed(4);
    const tcEl=document.getElementById('totalClicks');
    if(tcEl)tcEl.textContent=(parseInt(tcEl.textContent?.replace(/\D/g,'')||'0')+1).toLocaleString();
    const dcEl=document.getElementById('dailyClicks');
    if(dcEl)dcEl.textContent=(parseInt(dcEl.textContent?.replace(/\D/g,'')||'0')+1).toLocaleString();
    updateEnergyUI();

    if(energy<=0){const b=document.getElementById('mineBtn');if(b)b.disabled=true;}
    if(tapFlushTimer)clearTimeout(tapFlushTimer);
    tapFlushTimer=setTimeout(flushTaps,500);
}

async function flushTaps(){
    if(!tapQueue)return;
    const batch=tapQueue;tapQueue=0;tapFlushTimer=null;
    const user=getUser();if(!user)return;
    try{
        const resp=await fetch('/api/tap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rawUser:user,initData:tg?.initData||'',count:batch})});
        if(!resp.ok){
            if(resp.status===429)toast('Previše brzo!','error');
            if(resp.status===400)toast(tr('no_energy'),'error');
            energy=Math.min(maxEnergy,energy+batch);updateEnergyUI();return;
        }
        const data=await resp.json();
        userData={...userData,...data};
        if(data.clickBalance!==undefined)setEl('balance',data.clickBalance.toFixed(4));
        if(data.totalClicks!==undefined)setEl('totalClicks',data.totalClicks.toLocaleString());
        if(data.dailyClicks!==undefined)setEl('dailyClicks',data.dailyClicks.toLocaleString());
        if(data.energy!==undefined){energy=data.energy;maxEnergy=data.maxEnergy||maxEnergy;updateEnergyUI();}
        if(data.rank){
            setEl('rankBadge',data.rank);
            const fill=document.getElementById('rankProgressFill');
            if(fill)fill.style.width=`${getRankPct(data.totalClicks||0)}%`;
            const ri=getRank(data.totalClicks||0);
            setEl('rankProgressText',ri.max===Infinity?tr('max_rank'):`${(data.totalClicks||0).toLocaleString()} / ${ri.max.toLocaleString()}`);
        }
        if(data.boostActive&&data.boostEndsAt)startBoostTimer(new Date(data.boostEndsAt).getTime());
        if(data.mintedNFT){tg?.HapticFeedback?.notificationOccurred('success');toast(`🎉 NFT: ${data.mintedNFT.name}!`,'gold',4000);}
        const b=document.getElementById('mineBtn');if(b)b.disabled=energy<=0;
    }catch(e){
        console.error('Flush error:',e);
        energy=Math.min(maxEnergy,energy+batch);updateEnergyUI();
    }
}

// ── BOOST ──
async function handleBoost(){
    if(boostEndTime&&boostEndTime>Date.now()){toast(tr('boost_already'),'error');return;}
    const user=getUser();if(!user)return;
    try{
        const resp=await fetch('/api/boost',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rawUser:user,initData:tg?.initData||'',action:'buy'})});
        const data=await resp.json();
        if(data.boostActive&&data.boostEndsAt){
            startBoostTimer(new Date(data.boostEndsAt).getTime());
            tg?.HapticFeedback?.notificationOccurred('success');
            toast(tr('boost_ok'),'gold');
            if(data.clickBalance!==undefined)setEl('balance',data.clickBalance.toFixed(4));
        }else if(data.error)toast('❌ '+data.error,'error');
    }catch(e){toast('Greška','error');}
}

// ── TONCONNECT ──
function initTonConnect(){
    if(typeof TON_CONNECT_UI==='undefined')return;
    tonConnectUI=new TON_CONNECT_UI.TonConnectUI({manifestUrl:`${window.location.origin}/tonconnect-manifest.json`,buttonRootId:'tonconnect-button'});
    tonConnectUI.onStatusChange(async(wallet)=>{
        const user=getUser();if(!user)return;
        if(wallet){
            const addr=wallet.account.address;
            setEl('walletStatusValue',tr('wallet_connected'));
            const box=document.getElementById('walletAddressBox');if(box)box.style.display='flex';
            setEl('walletAddressValue',addr);
            await fetch('/api/wallet/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rawUser:user,initData:tg?.initData||'',address:addr})}).catch(()=>{});
            tg?.HapticFeedback?.notificationOccurred('success');
        }else{
            setEl('walletStatusValue',tr('wallet_disconnected'));
            const box=document.getElementById('walletAddressBox');if(box)box.style.display='none';
            await fetch('/api/wallet/disconnect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rawUser:user,initData:tg?.initData||''})}).catch(()=>{});
        }
    });
}

// ── TABS ──
function switchTab(tab){
    currentTab=tab;
    document.querySelectorAll('.tn-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(c=>c.classList.remove('active'));
    const btn=document.querySelector(`[data-tab="${tab}"]`);if(btn)btn.classList.add('active');
    const pane=document.getElementById(`tab-${tab}`);if(pane)pane.classList.add('active');
    tg?.HapticFeedback?.selectionChanged();
    if(tab==='leaderboard')loadLeaderboard();
    if(tab==='nft')loadNFTs();
    if(tab==='quests')loadQuests();
    if(tab==='referral')loadRefLB();
}

// ── LEADERBOARD ──
async function loadLeaderboard(){
    const list=document.getElementById('lbList');if(!list)return;
    list.innerHTML='<div class="load-state"><div class="spin-ring"></div></div>';
    try{
        const resp=await fetch('/api/leaderboard');
        const data=await resp.json();
        const users=Array.isArray(data)?data:(data.users||[]);
        if(!users.length){list.innerHTML=`<div class="empty-msg"><span class="empty-icon">🏆</span>${tr('no_miners')}</div>`;return;}
        const myId=String(getUser()?.id||'');
        const medals=['🥇','🥈','🥉'];
        list.innerHTML=users.map((u,i)=>{
            const isMe=String(u.telegramId)===myId;
            const name=isMe?tr('lb_you'):tr('lb_miner',{id:String(u.telegramId).slice(-4)});
            return`<div class="lb-item ${isMe?'me':''}">
                <span class="lb-medal">${medals[i]||`#${i+1}`}</span>
                <div class="lb-info">
                    <span class="lb-uname">${name}</span>
                    <span class="lb-ulabel">${getRank(u.totalClicks||0).name}</span>
                </div>
                <span class="lb-score">${(u.totalClicks||0).toLocaleString()}</span>
            </div>`;
        }).join('');
        const myIdx=users.findIndex(u=>String(u.telegramId)===myId);
        const myRankEl=document.getElementById('lbMyRank');
        if(myIdx!==-1&&myRankEl){myRankEl.style.display='block';setEl('myRankNum',`#${myIdx+1}`);}
    }catch(e){list.innerHTML=`<div class="empty-msg">❌ Greška</div>`;}
}

// ── NFTs — s pravim slikama ──
function rarityClass(r){const map={common:'common',rare:'rare',epic:'epic',legendary:'legendary',mythic:'mythic'};return map[(r||'').toLowerCase()]||'common';}
function rarityBadgeClass(r){const map={common:'badge-common',rare:'badge-rare',epic:'badge-epic',legendary:'badge-legendary',mythic:'badge-mythic'};return map[(r||'').toLowerCase()]||'badge-common';}

async function loadNFTs(){
    const grid=document.getElementById('nftGrid');if(!grid)return;
    grid.innerHTML='<div class="skeleton-card"></div><div class="skeleton-card"></div>';
    try{
        const user=getUser();if(!user)return;
        const resp=await fetch('/api/nftcount',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rawUser:user,initData:tg?.initData||''})});
        const data=await resp.json();
        const nfts=data.nfts||[];
        const hasWallet=!!data.tonWallet;

        if(!nfts.length){
            grid.innerHTML=`<div class="nft-empty-state"><span class="empty-icon">${data.count>0?'📦':'🎨'}</span>${data.count>0?tr('nft_count',{n:data.count}):tr('nft_none')}</div>`;
            return;
        }

        // Opremljeni NFT u headeru
        const equipped=nfts.find(n=>n.equipped);
        const eqEmpty=document.getElementById('nftEqEmpty');
        const eqCard=document.getElementById('nftEqCard');
        if(equipped){
            if(eqEmpty)eqEmpty.style.display='none';
            if(eqCard)eqCard.style.display='flex';
            const eqImg=document.getElementById('nftEqImg');
            if(eqImg){eqImg.src=equipped.image||'kvnc-logo.png';eqImg.alt=equipped.name;}
            setEl('nftEqName',equipped.name);
            setEl('nftEqRarity',equipped.rarity);
            setEl('nftEqBonus',`${equipped.bonusMultiplier}× bonus`);
        }else{
            if(eqEmpty)eqEmpty.style.display='flex';
            if(eqCard)eqCard.style.display='none';
        }

        // Grid kartica s pravim slikama
        grid.innerHTML=nfts.map(nft=>{
            const isPending=nft.contractAddress?.startsWith('withdraw:')||nft.contractAddress?.startsWith('pending:');
            const isEquipped=nft.equipped;
            const isStaked=nft.staked;
            const rc=rarityClass(nft.rarity);
            const bc=rarityBadgeClass(nft.rarity);
            const imgSrc=nft.image||'kvnc-logo.png';

            const equipBtn=`<button class="ncb ncb-equip" onclick="equipNFT(${nft.id})">${isEquipped?'✅':'Opremi'}</button>`;
            const stakeBtn=`<button class="ncb ncb-stake" onclick="stakeNFT(${nft.id})">${isStaked?'🔓 Unstake':'🔒 Stake'}</button>`;
            let withdrawBtn;
            if(isPending)          withdrawBtn=`<button class="ncb ncb-disabled" disabled>⏳ Pending</button>`;
            else if(!hasWallet)    withdrawBtn=`<button class="ncb ncb-disabled" disabled title="Poveži wallet">🔒</button>`;
            else if(isStaked||isEquipped) withdrawBtn=`<button class="ncb ncb-disabled" disabled>📤</button>`;
            else                   withdrawBtn=`<button class="ncb ncb-withdraw" onclick="withdrawNFT(${nft.id})">📤</button>`;

            return`<div class="nft-card ${isEquipped?'equipped':''} ${isStaked?'staked':''}">
                <div class="nft-card-img-wrap">
                    <img class="nft-card-img" src="${imgSrc}" alt="${nft.name}" loading="lazy" onerror="this.src='kvnc-logo.png'" />
                    <span class="nft-card-rarity-badge ${bc}">${nft.rarity}</span>
                    ${isEquipped?'<span class="nft-equipped-badge">✅</span>':''}
                </div>
                <div class="nft-card-body">
                    <span class="nft-card-name">${nft.name}</span>
                    <span class="nft-card-bonus">${nft.bonusMultiplier}× bonus</span>
                    <div class="nft-card-btns">${equipBtn}${stakeBtn}${withdrawBtn}</div>
                </div>
            </div>`;
        }).join('');

        if(!hasWallet){
            grid.innerHTML+=`<div class="nft-wallet-warn">⚠️ Poveži TON wallet za NFT withdrawal</div>`;
        }
    }catch(e){
        console.error('NFT error:',e);
        grid.innerHTML=`<div class="nft-empty-state">❌ Greška pri učitavanju</div>`;
    }
}

async function equipNFT(id){
    const user=getUser();if(!user)return;
    try{
        const res=await fetch('/api/equip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rawUser:user,initData:tg?.initData||'',nftId:id})});
        const data=await res.json();
        if(res.ok){tg?.HapticFeedback?.notificationOccurred('success');toast(tr('nft_equipped'),'success');}
        else toast('❌ '+(data.error||'Greška'),'error');
        loadNFTs();
    }catch(e){toast(tr('nft_equip_err'),'error');}
}
async function stakeNFT(id){
    const user=getUser();if(!user)return;
    try{
        await fetch('/api/stake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rawUser:user,initData:tg?.initData||'',nftId:id})});
        tg?.HapticFeedback?.notificationOccurred('success');
        loadNFTs();
    }catch(e){}
}
async function withdrawNFT(id){
    const user=getUser();if(!user)return;
    tg?.showConfirm?.(tr('withdraw_confirm'),async(ok)=>{
        if(!ok)return;
        try{
            const resp=await fetch('/api/nft/withdraw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rawUser:user,initData:tg?.initData||'',nftId:id})});
            const data=await resp.json();
            if(data.success){toast(tr('withdraw_ok'),'success');tg?.HapticFeedback?.notificationOccurred('success');loadNFTs();}
            else toast('❌ '+(data.error||'Greška'),'error');
        }catch(e){toast(tr('withdraw_err'),'error');}
    });
}
async function handleUnequip(){
    const user=getUser();if(!user)return;
    try{
        await fetch('/api/unequip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rawUser:user,initData:tg?.initData||''})});
        tg?.HapticFeedback?.notificationOccurred('success');
        loadNFTs();
    }catch(e){}
}

// ── QUESTS ──
const QMETA={
    clicks:  {icon:'⛏️',tk:'q_clicks', dk:'q_clicks_d'},
    referrals:{icon:'👥',tk:'q_refs',   dk:'q_refs_d'},
    nft:     {icon:'🎨',tk:'q_nft',    dk:'q_nft_d'},
};
async function loadQuests(){
    const list=document.getElementById('questList');if(!list)return;
    list.innerHTML='<div class="skeleton-row"></div><div class="skeleton-row"></div>';
    const quests=userData?.quests||[];
    if(!quests.length){
        // pokušaj dohvatiti s API-ja
        try{
            const user=getUser();
            if(user){
                const resp=await fetch(`/api/quests?telegramId=${user.id}`);
                if(resp.ok){const data=await resp.json();if(Array.isArray(data)&&data.length){renderQuests(list,data);return;}}
            }
        }catch(e){}
        list.innerHTML=`<div class="empty-msg"><span class="empty-icon">📋</span>${tr('no_quests')}</div>`;
        return;
    }
    renderQuests(list,quests);
}
function renderQuests(list,quests){
    list.innerHTML=quests.map(q=>{
        const m=QMETA[q.type]||{icon:'📋',tk:'no_quests',dk:'no_quests'};
        const pct=Math.min(100,(q.progress/q.target)*100);
        return`<div class="quest-item ${q.completed?'done':''}">
            <div class="qi-head">
                <span class="qi-title">${m.icon} ${tr(m.tk)}</span>
                <span class="qi-reward">+${q.reward} KVNC</span>
            </div>
            <div class="qi-desc">${tr(m.dk,{t:q.target.toLocaleString()})}</div>
            <div class="qi-bar-bg"><div class="qi-bar-fill" style="width:${pct}%"></div></div>
            <div class="qi-foot">
                <span class="qi-count">${q.progress.toLocaleString()} / ${q.target.toLocaleString()}</span>
                ${q.completed?'<span class="qi-done">✅ Završeno</span>':''}
            </div>
        </div>`;
    }).join('');
}

// ── REFERRAL ──
function copyRefLink(){
    if(!refLink)return;
    navigator.clipboard?.writeText(refLink).then(()=>toast(tr('link_copied'),'success')).catch(()=>toast(refLink));
    tg?.HapticFeedback?.notificationOccurred('success');
}
function shareRefLink(){
    if(!refLink)return;
    tg?.openTelegramLink?.(`https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(tr('share_text'))}`);
}
async function loadRefLB(){
    const list=document.getElementById('refLbList');if(!list)return;
    try{
        const resp=await fetch('/api/leaderboard/referral');
        if(!resp.ok){list.innerHTML='';return;}
        const data=await resp.json();
        const users=Array.isArray(data)?data:(data.users||[]);
        if(!users.length){list.innerHTML='';return;}
        const myId=String(getUser()?.id||'');
        const medals=['🥇','🥈','🥉'];
        list.innerHTML=users.map((u,i)=>{
            const isMe=String(u.telegramId)===myId;
            return`<div class="lb-item ${isMe?'me':''}">
                <span class="lb-medal">${medals[i]||`#${i+1}`}</span>
                <div class="lb-info"><span class="lb-uname">${isMe?tr('lb_you'):tr('lb_miner',{id:String(u.telegramId).slice(-4)})}</span></div>
                <span class="lb-score">${u.referralCount||0} ref</span>
            </div>`;
        }).join('');
    }catch(e){list.innerHTML='';}
}

// ═══════════ MINI IGRE ═══════════
function openGame(type){
    const ov=document.getElementById('gameOverlay');
    const c=document.getElementById('gameContainer');
    if(!ov||!c)return;
    ov.style.display='flex';
    tg?.HapticFeedback?.impactOccurred('light');
    if(type==='coinflip')gameCoinFlip(c);
    else if(type==='rps')gameRPS(c);
    else if(type==='guess')gameGuess(c);
    else if(type==='memory')gameMemory(c);
}
function closeGame(){const ov=document.getElementById('gameOverlay');if(ov)ov.style.display='none';}
function giveReward(amt){
    const balEl=document.getElementById('balance');
    if(balEl)balEl.textContent=(parseFloat(balEl.textContent||'0')+amt).toFixed(4);
    if(userData)userData.clickBalance=(userData.clickBalance||0)+amt;
    toast(tr('game_win',{r:amt}),'gold');
    playWin();tg?.HapticFeedback?.notificationOccurred('success');
}

/* COINFLIP */
function gameCoinFlip(c){
    let choice=null,busy=false;
    c.innerHTML=`
    <div class="gm-header"><span class="gm-title">🪙 Coin Flip</span><button class="gm-close" onclick="closeGame()">${tr('game_close')}</button></div>
    <div class="gm-body">
        <div style="font-size:12px;color:var(--txt-dim);margin-bottom:12px">${tr('cf_choose')}</div>
        <div class="cf-choices">
            <button class="cf-choice" id="cf-h" onclick="cfPick('heads')">🌕 Glava</button>
            <button class="cf-choice" id="cf-t" onclick="cfPick('tails')">💿 Pismo</button>
        </div>
        <span class="cf-coin" id="cfCoin">🪙</span>
        <div class="gm-result" id="cfRes"></div>
        <button class="gm-btn" id="cfGo" onclick="cfFlip()" disabled>Baci novčić</button>
    </div>`;
    window.cfPick=s=>{if(busy)return;choice=s;document.getElementById('cf-h').classList.toggle('chosen',s==='heads');document.getElementById('cf-t').classList.toggle('chosen',s==='tails');document.getElementById('cfGo').disabled=false;tg?.HapticFeedback?.selectionChanged();};
    window.cfFlip=()=>{
        if(!choice||busy)return;busy=true;
        document.getElementById('cfGo').disabled=true;
        const coin=document.getElementById('cfCoin'),res=document.getElementById('cfRes');
        res.textContent='';let f=0;
        const anim=setInterval(()=>{coin.textContent=['🪙','⭕','🪙','⭕'][f%4];f++;if(f>14){
            clearInterval(anim);
            const out=Math.random()<.5?'heads':'tails';
            coin.textContent=out==='heads'?'🌕':'💿';
            const win=out===choice;
            res.textContent=win?tr('game_win',{r:50}):tr('game_lose');
            res.className='gm-result '+(win?'win':'lose');
            if(win)giveReward(50);else playLose();
            busy=false;
            const go=document.getElementById('cfGo');
            go.textContent=tr('game_play_again');go.disabled=false;go.onclick=()=>gameCoinFlip(c);
        }},90);
    };
}

/* RPS */
function gameRPS(c){
    const opts=[['✊','rock'],['✌️','scissors'],['🖐️','paper']];
    const beats={rock:'scissors',scissors:'paper',paper:'rock'};
    c.innerHTML=`
    <div class="gm-header"><span class="gm-title">✊ Kam-Šk-Pap</span><button class="gm-close" onclick="closeGame()">${tr('game_close')}</button></div>
    <div class="gm-body">
        <div style="font-size:12px;color:var(--txt-dim);margin-bottom:12px">${tr('rps_choose')}</div>
        <div class="rps-picks">
            ${opts.map(([e,k])=>`<button class="rps-pick" onclick="rpsPlay('${k}')">${e}</button>`).join('')}
        </div>
        <div class="rps-vs-display" id="rpsVis" style="display:none"></div>
        <div class="gm-result" id="rpsRes"></div>
        <button class="gm-btn-sec" id="rpsReplay" style="display:none" onclick="gameRPS(document.getElementById('gameContainer'))">${tr('game_play_again')}</button>
    </div>`;
    window.rpsPlay=choice=>{
        const ai=opts[Math.floor(Math.random()*3)];
        const myE=opts.find(o=>o[1]===choice)[0];
        const vis=document.getElementById('rpsVis'),res=document.getElementById('rpsRes');
        vis.style.display='flex';vis.innerHTML=`<span style="font-size:42px">${myE}</span><span class="rps-vs-label">VS</span><span style="font-size:42px">${ai[0]}</span>`;
        let result,cls;
        if(choice===ai[1]){result=tr('game_draw');cls='draw';}
        else if(beats[choice]===ai[1]){result=tr('game_win',{r:30});cls='win';giveReward(30);}
        else{result=tr('game_lose');cls='lose';playLose();}
        res.textContent=result;res.className='gm-result '+cls;
        document.getElementById('rpsReplay').style.display='block';
        tg?.HapticFeedback?.impactOccurred(cls==='win'?'heavy':'light');
    };
}

/* GUESS */
function gameGuess(c){
    const secret=Math.floor(Math.random()*10)+1;let tries=0;
    c.innerHTML=`
    <div class="gm-header"><span class="gm-title">🔢 Pogodi Broj</span><button class="gm-close" onclick="closeGame()">${tr('game_close')}</button></div>
    <div class="gm-body">
        <div style="font-size:13px;color:var(--txt-dim);margin-bottom:12px">${tr('guess_prompt')}</div>
        <div class="guess-row">
            <input type="number" min="1" max="10" class="guess-input" id="gIn" placeholder="?" />
            <button class="guess-go" onclick="gGuess()">OK</button>
        </div>
        <div class="guess-hint" id="gHint"></div>
        <div class="guess-tries" id="gTries">${tr('guess_try',{n:1})}</div>
        <div class="gm-result" id="gRes"></div>
        <button class="gm-btn" id="gReplay" style="display:none" onclick="gameGuess(document.getElementById('gameContainer'))">${tr('game_play_again')}</button>
    </div>`;
    window.gGuess=()=>{
        const v=parseInt(document.getElementById('gIn').value);
        if(!v||v<1||v>10)return;tries++;
        const hint=document.getElementById('gHint'),res=document.getElementById('gRes'),tr_el=document.getElementById('gTries'),inp=document.getElementById('gIn');
        if(v===secret){
            const reward=tries===1?200:tries===2?150:100;
            hint.textContent=tr('guess_exact');res.textContent=tr('game_win',{r:reward});res.className='gm-result win';
            giveReward(reward);inp.disabled=true;document.getElementById('gReplay').style.display='block';
        }else if(tries>=3){
            hint.textContent=tr('guess_lost',{n:secret});res.textContent=tr('game_lose');res.className='gm-result lose';
            playLose();inp.disabled=true;document.getElementById('gReplay').style.display='block';
        }else{
            hint.textContent=v<secret?tr('guess_higher'):tr('guess_lower');
            tr_el.textContent=tr('guess_try',{n:tries+1});
            inp.value='';inp.focus();tg?.HapticFeedback?.impactOccurred('light');
        }
    };
    document.getElementById('gIn')?.addEventListener('keydown',e=>{if(e.key==='Enter')window.gGuess();});
}

/* MEMORY */
function gameMemory(c){
    const emojis=['⛏️','💎','🥇','🔥','🪙','💰','🪨','🏔️'];
    const cards=[...emojis,...emojis].sort(()=>Math.random()-.5);
    let flipped=[],matched=new Set(),moves=0,locked=false;
    c.innerHTML=`
    <div class="gm-header"><span class="gm-title">🧠 Memory</span><button class="gm-close" onclick="closeGame()">${tr('game_close')}</button></div>
    <div class="gm-body">
        <div class="mem-stats"><span id="mMoves">${tr('mem_moves',{n:0})}</span><span style="color:var(--gold)" id="mPairs">0/8</span></div>
        <div class="mem-grid" id="mGrid"></div>
        <div class="gm-result" id="mRes"></div>
        <button class="gm-btn" id="mReplay" style="display:none" onclick="gameMemory(document.getElementById('gameContainer'))">${tr('game_play_again')}</button>
    </div>`;
    const grid=document.getElementById('mGrid');
    cards.forEach((emoji,i)=>{
        const el=document.createElement('div');el.className='mem-card';el.textContent='❓';
        el.onclick=()=>{
            if(locked||flipped.includes(i)||matched.has(i))return;
            el.textContent=emoji;el.classList.add('flipped');flipped.push(i);
            tg?.HapticFeedback?.selectionChanged();
            if(flipped.length===2){
                locked=true;moves++;
                setEl('mMoves',tr('mem_moves',{n:moves}));
                const[a,b]=flipped;
                if(cards[a]===cards[b]){
                    matched.add(a);matched.add(b);
                    grid.children[a].classList.add('matched');grid.children[b].classList.add('matched');
                    flipped=[];locked=false;
                    setEl('mPairs',`${matched.size/2}/8`);
                    if(matched.size===cards.length){
                        const reward=Math.max(50,300-moves*10);
                        setEl('mRes',tr('mem_win',{n:moves}));
                        document.getElementById('mRes').className='gm-result win';
                        document.getElementById('mReplay').style.display='block';
                        giveReward(reward);
                    }
                }else{
                    setTimeout(()=>{
                        grid.children[a].textContent='❓';grid.children[b].textContent='❓';
                        grid.children[a].classList.remove('flipped');grid.children[b].classList.remove('flipped');
                        flipped=[];locked=false;
                    },850);
                }
            }
        };
        grid.appendChild(el);
    });
}

// ── START ──
document.addEventListener('DOMContentLoaded',init);
console.log('🪙 Kovanica $KVNC v7 — '+LANG.toUpperCase());
