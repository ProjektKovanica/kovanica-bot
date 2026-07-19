const tg = window.Telegram.WebApp;
tg.expand();
tg.setHeaderColor('#0f0f28');
tg.setBackgroundColor('#080818');

// === STATE ===
let userData = null;
let tonConnectUI = null;
let isProcessing = false;
let energy = 1000;
let maxEnergy = 1000;
let boostEndTime = null;
let boostInterval = null;
let energyInterval = null;
let currentTab = 'mine';
let refLink = '';
let soundEnabled = true;
let audioCtx = null;

// === AUDIO ===
function playTapSound() {
    if (!soundEnabled) return;
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.1);
    } catch(e) {}
}

// === RANK CONFIG ===
const RANKS = [
    { name: '🪨 Novi rudar', min: 0, max: 100 },
    { name: '⛏️ Početnik', min: 100, max: 500 },
    { name: '⛏️ Napredni rudar', min: 500, max: 2000 },
    { name: '🥉 Brončani rudar', min: 2000, max: 5000 },
    { name: '🥈 Srebrni rudar', min: 5000, max: 10000 },
    { name: '🥇 Zlatni rudar', min: 10000, max: 20000 },
    { name: '🔹 Platinasti rudar', min: 20000, max: 50000 },
    { name: '💎 Dijamantni rudar', min: 50000, max: 100000 },
    { name: '👑 Kralj rudara', min: 100000, max: Infinity },
];

function getRankInfo(totalClicks) {
    for (let i = RANKS.length - 1; i >= 0; i--) {
        if (totalClicks >= RANKS[i].min) return { ...RANKS[i], index: i };
    }
    return { ...RANKS[0], index: 0 };
}

function getRankProgress(totalClicks) {
    const rank = getRankInfo(totalClicks);
    if (rank.max === Infinity) return 100;
    const progress = ((totalClicks - rank.min) / (rank.max - rank.min)) * 100;
    return Math.min(100, Math.max(0, progress));
}

// === INIT ===
async function init() {
    try {
        const user = tg.initDataUnsafe?.user || null;
        if (!user) {
            tg.showAlert('Greška pri povezivanju s Telegramom!');
            return;
        }

        // Avatar
        const avatarEl = document.getElementById('avatar');
        if (avatarEl) {
            if (user.photo_url) {
                avatarEl.style.backgroundImage = `url(${user.photo_url})`;
                avatarEl.style.backgroundSize = 'cover';
                avatarEl.textContent = '';
            } else {
                avatarEl.textContent = (user.first_name || 'R')[0].toUpperCase();
            }
        }

        // Username
        const usernameEl = document.getElementById('username');
        if (usernameEl) usernameEl.textContent = user.first_name || user.username || 'Rudar';

        // Dohvati podatke korisnika
        const response = await fetch('/api/me', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawUser: user, initData: tg.initData || '' })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        userData = await response.json();

        // /api/me vraća: clickBalance, totalClicks, dailyClicks, dailyLimit,
        // referralCount, rank, bonusAvailable
        // energy i maxEnergy NE vraća — postavljamo default dok ne dođe prvi /tap
        energy = maxEnergy; // puna energija na startu (server će korigirati na prvom tapu)
        maxEnergy = 1000;

        updateUI(userData);
        startEnergyRegen();

        // Referral link
        refLink = `https://t.me/kovanicatapbot?start=ref_${user.id}`;
        const refLinkEl = document.getElementById('refLink');
        if (refLinkEl) refLinkEl.textContent = refLink;

        const refCountEl = document.getElementById('refCount');
        if (refCountEl) refCountEl.textContent = userData.referralCount || 0;
        const refEarnedEl = document.getElementById('refEarned');
        if (refEarnedEl) refEarnedEl.textContent = ((userData.referralCount || 0) * 10).toFixed(0);

        tg.HapticFeedback.impactOccurred('light');
        initTonConnect();
    } catch (error) {
        console.error('Init error:', error);
        tg.showAlert('Greška pri učitavanju. Pokušaj ponovo.');
    }
}

// === TONCONNECT ===
function initTonConnect() {
    if (typeof TON_CONNECT_UI === 'undefined') {
        console.error('TonConnect UI script nije učitan.');
        return;
    }
    tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
        manifestUrl: `${window.location.origin}/tonconnect-manifest.json`,
        buttonRootId: 'tonconnect-button'
    });

    tonConnectUI.onStatusChange(async (wallet) => {
        const statusEl = document.getElementById('walletStatusValue');
        const addressBox = document.getElementById('walletAddressBox');
        const addressEl = document.getElementById('walletAddressValue');

        if (wallet) {
            const address = wallet.account.address;
            if (statusEl) statusEl.textContent = '✅ Povezan';
            if (addressBox) addressBox.style.display = 'block';
            if (addressEl) addressEl.textContent = address;

            try {
                const user = tg.initDataUnsafe?.user || null;
                if (!user) return;
                await fetch('/api/wallet/connect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rawUser: user, initData: tg.initData || '', address })
                });
                tg.HapticFeedback.notificationOccurred('success');
            } catch (e) {
                console.error('Wallet connect sync error:', e);
            }
        } else {
            if (statusEl) statusEl.textContent = 'Nije povezan';
            if (addressBox) addressBox.style.display = 'none';

            try {
                const user = tg.initDataUnsafe?.user || null;
                if (!user) return;
                await fetch('/api/wallet/disconnect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rawUser: user, initData: tg.initData || '' })
                });
            } catch (e) {
                console.error('Wallet disconnect sync error:', e);
            }
        }
    });
}

// === UPDATE UI ===
function updateUI(data) {
    if (!data) return;

    // Balans
    const balanceEl = document.getElementById('balance');
    if (balanceEl) balanceEl.textContent = (data.clickBalance || 0).toFixed(4);

    // Rang — server vraća data.rank kao string
    const totalClicks = data.totalClicks || 0;
    const rankInfo = getRankInfo(totalClicks);
    const rankEl = document.getElementById('rankBadge');
    if (rankEl) rankEl.textContent = data.rank || rankInfo.name;

    // Rank progress bar
    const progress = getRankProgress(totalClicks);
    const progressFill = document.getElementById('rankProgressFill');
    const progressText = document.getElementById('rankProgressText');
    if (progressFill) progressFill.style.width = `${progress}%`;
    if (progressText) {
        if (rankInfo.max === Infinity) {
            progressText.textContent = '👑 MAX RANG';
        } else {
            progressText.textContent = `${totalClicks.toLocaleString()} / ${rankInfo.max.toLocaleString()}`;
        }
    }

    // Stats
    const totalEl = document.getElementById('totalClicks');
    if (totalEl) totalEl.textContent = totalClicks.toLocaleString();

    const dailyEl = document.getElementById('dailyClicks');
    if (dailyEl) dailyEl.textContent = (data.dailyClicks || 0).toLocaleString();

    // Reward — /api/me ne vraća baseReward, default 1.0; /api/tap vraća baseReward
    const baseReward = data.baseReward || data.reward || 1.0;
    const rewardEl = document.getElementById('rewardPerTap');
    if (rewardEl) rewardEl.textContent = `${baseReward.toFixed(4)} KVNC`;

    const rewardSubEl = document.getElementById('rewardSub');
    if (rewardSubEl) rewardSubEl.textContent = `+${baseReward.toFixed(4)} KVNC/klik`;

    // Energy — /api/tap vraća energy i maxEnergy; /api/me ih ne vraća
    if (data.energy !== undefined) energy = data.energy;
    if (data.maxEnergy !== undefined) maxEnergy = data.maxEnergy;
    updateEnergyUI();

    // Boost — vraća boostActive i boostEndsAt samo iz /api/tap i /api/boost
    if (data.boostActive && data.boostEndsAt) {
        startBoostTimer(new Date(data.boostEndsAt).getTime());
    }

    // Gumb
    const mineBtn = document.getElementById('mineBtn');
    if (mineBtn) mineBtn.disabled = energy <= 0;
}

// === ENERGY ===
function updateEnergyUI() {
    const fill = document.getElementById('energyFill');
    const val = document.getElementById('energyVal');
    const pct = maxEnergy > 0 ? Math.min(100, (energy / maxEnergy) * 100) : 0;
    if (fill) fill.style.width = `${pct}%`;
    if (val) val.textContent = `${Math.floor(energy)} / ${maxEnergy}`;

    const countdown = document.getElementById('energyCountdown');
    if (countdown) {
        if (energy >= maxEnergy) {
            countdown.textContent = '⚡ Energija puna!';
            countdown.style.color = 'var(--energy)';
        } else {
            const secsLeft = Math.ceil((maxEnergy - energy) / 2);
            const mins = Math.floor(secsLeft / 60);
            const secs = secsLeft % 60;
            countdown.textContent = `🔋 Puno za: ${mins}m ${secs}s`;
            countdown.style.color = 'var(--muted)';
        }
    }
}

function startEnergyRegen() {
    if (energyInterval) clearInterval(energyInterval);
    energyInterval = setInterval(() => {
        if (energy < maxEnergy) {
            energy = Math.min(maxEnergy, energy + 2);
            updateEnergyUI();
            if (energy > 0) {
                const mineBtn = document.getElementById('mineBtn');
                if (mineBtn && !isProcessing) mineBtn.disabled = false;
            }
        }
    }, 1000);
}

// === BOOST TIMER ===
function startBoostTimer(endTimestamp) {
    const boostBar = document.getElementById('boostBar');
    if (boostBar) boostBar.style.display = 'flex';
    if (boostInterval) clearInterval(boostInterval);
    const totalDuration = 10 * 60 * 1000;
    boostInterval = setInterval(() => {
        const remaining = endTimestamp - Date.now();
        if (remaining <= 0) {
            clearInterval(boostInterval);
            if (boostBar) boostBar.style.display = 'none';
            return;
        }
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        const timeEl = document.getElementById('boostTime');
        if (timeEl) timeEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        const pct = Math.min(100, (remaining / totalDuration) * 100);
        const progressEl = document.getElementById('boostProgress');
        if (progressEl) progressEl.style.width = `${pct}%`;
    }, 1000);
    boostEndTime = endTimestamp;
}

// === PARTICLES ===
function spawnParticles(x, y) {
    const container = document.getElementById('particleContainer');
    if (!container) return;
    const colors = ['#ffd200', '#ff6b35', '#00d4ff', '#ffffff', '#fda085'];
    for (let i = 0; i < 8; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        p.style.cssText = `
            left: ${x}px; top: ${y}px;
            background: ${colors[Math.floor(Math.random() * colors.length)]};
            --dx: ${(Math.random() - 0.5) * 120}px;
            --dy: ${-(Math.random() * 100 + 40)}px;
        `;
        container.appendChild(p);
        setTimeout(() => p.remove(), 700);
    }
}

// === MINE ===
async function handleMine(event) {
    if (isProcessing || energy <= 0) return;
    isProcessing = true;

    const btn = document.getElementById('mineBtn');
    if (btn) btn.disabled = true;

    // Animacija
    const pickaxe = document.getElementById('pickaxe');
    if (pickaxe) {
        pickaxe.classList.add('hit');
        setTimeout(() => pickaxe.classList.remove('hit'), 150);
    }

    // Particles
    if (event && event.clientX) {
        spawnParticles(event.clientX, event.clientY);
    } else {
        const wrapper = document.getElementById('pickaxe');
        if (wrapper) {
            const rect = wrapper.getBoundingClientRect();
            spawnParticles(rect.left + rect.width / 2, rect.top + rect.height / 2);
        }
    }

    // Sound
    playTapSound();

    // Optimistic energy update
    energy = Math.max(0, energy - 1);
    updateEnergyUI();

    tg.HapticFeedback.impactOccurred('medium');

    try {
        const user = tg.initDataUnsafe?.user || null;
        if (!user) throw new Error('No user');

        const response = await fetch('/api/tap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawUser: user, initData: tg.initData || '' })
        });

        if (!response.ok) {
            if (response.status === 429) {
                tg.showAlert('Previše brzo!');
                isProcessing = false;
                if (btn) btn.disabled = false;
                return;
            }
            if (response.status === 400) {
                tg.showAlert('⚡ Nema energije! Pričekaj regeneraciju.');
                isProcessing = false;
                if (btn) btn.disabled = true;
                return;
            }
            throw new Error(`HTTP ${response.status}`);
        }

        // /api/tap vraća: clickBalance, totalClicks, dailyClicks, energy, maxEnergy,
        // reward, baseReward, multiplier, boostActive, boostEndsAt, rank
        const data = await response.json();
        userData = { ...userData, ...data };

        const balanceEl = document.getElementById('balance');
        if (balanceEl) balanceEl.textContent = (data.clickBalance || 0).toFixed(4);

        const totalEl = document.getElementById('totalClicks');
        if (totalEl) totalEl.textContent = (data.totalClicks || 0).toLocaleString();

        const dailyEl = document.getElementById('dailyClicks');
        if (dailyEl) dailyEl.textContent = (data.dailyClicks || 0).toLocaleString();

        // Rank badge i progress
        if (data.rank) {
            const rankEl = document.getElementById('rankBadge');
            if (rankEl) rankEl.textContent = data.rank;
        }
        const progress = getRankProgress(data.totalClicks || 0);
        const progressFill = document.getElementById('rankProgressFill');
        if (progressFill) progressFill.style.width = `${progress}%`;
        const rankInfo = getRankInfo(data.totalClicks || 0);
        const progressText = document.getElementById('rankProgressText');
        if (progressText) {
            progressText.textContent = rankInfo.max === Infinity
                ? '👑 MAX RANG'
                : `${(data.totalClicks || 0).toLocaleString()} / ${rankInfo.max.toLocaleString()}`;
        }

        // Energy iz servera (autoritativno)
        if (data.energy !== undefined) {
            energy = data.energy;
            maxEnergy = data.maxEnergy || maxEnergy;
            updateEnergyUI();
        }

        // Reward prikaz
        const rewardEl = document.getElementById('rewardPerTap');
        if (rewardEl && data.baseReward) rewardEl.textContent = `${data.baseReward.toFixed(4)} KVNC`;
        const rewardSubEl = document.getElementById('rewardSub');
        if (rewardSubEl && data.baseReward) rewardSubEl.textContent = `+${data.baseReward.toFixed(4)} KVNC/klik`;

        // Boost timer
        if (data.boostActive && data.boostEndsAt) {
            startBoostTimer(new Date(data.boostEndsAt).getTime());
        }

        // Floating reward — data.reward je ukupna (s multiplier), data.baseReward je osnovna
        const reward = data.reward || data.baseReward || 1;
        showFloatingCounter(`+${reward.toFixed(4)}`);

        // NFT mint notifikacija (backend sada mint-a NFT-ove i preko Mini App tapa, ne samo bot komande)
        if (data.mintedNFT) {
            tg.HapticFeedback.notificationOccurred('success');
            tg.showAlert(`🎉 Iskopao si NFT: ${data.mintedNFT.name} (${data.mintedNFT.rarity})!`);
        }

    } catch (error) {
        console.error('Tap error:', error);
        energy = Math.min(maxEnergy, energy + 1);
        updateEnergyUI();
    }

    isProcessing = false;
    if (btn) btn.disabled = energy <= 0;
}

function showFloatingCounter(text) {
    const counter = document.getElementById('clickCounter');
    if (!counter) return;
    counter.textContent = text;
    counter.classList.remove('show');
    void counter.offsetWidth;
    counter.classList.add('show');
    setTimeout(() => counter.classList.remove('show'), 600);
}

// === BOOST ===
async function handleBoost() {
    if (boostEndTime && boostEndTime > Date.now()) {
        tg.showAlert('Boost je već aktivan!');
        return;
    }
    try {
        const user = tg.initDataUnsafe?.user || null;
        if (!user) return;

        // Backend /api/boost s action:'buy' troši 10 KVNC i aktivira 2x boost
        const response = await fetch('/api/boost', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawUser: user, initData: tg.initData || '', action: 'buy' })
        });
        const data = await response.json();
        if (data.boostActive && data.boostEndsAt) {
            startBoostTimer(new Date(data.boostEndsAt).getTime());
            tg.HapticFeedback.notificationOccurred('success');
            tg.showAlert('⚡ 2x Boost aktiviran na 10 minuta!');
            // Ažuriraj balans
            if (data.clickBalance !== undefined) {
                const balanceEl = document.getElementById('balance');
                if (balanceEl) balanceEl.textContent = data.clickBalance.toFixed(4);
            }
        } else if (data.error) {
            tg.showAlert(data.error);
        }
    } catch (e) { console.error('Boost error:', e); }
}

// === SOUND TOGGLE ===
function toggleSound() {
    soundEnabled = !soundEnabled;
    const btn = document.getElementById('soundBtn');
    if (btn) btn.textContent = soundEnabled ? '🔊' : '🔇';
    tg.HapticFeedback.selectionChanged();
}

// === TABS ===
function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const tabBtn = document.querySelector(`[data-tab="${tab}"]`);
    if (tabBtn) tabBtn.classList.add('active');
    const tabContent = document.getElementById(`tab-${tab}`);
    if (tabContent) tabContent.classList.add('active');
    tg.HapticFeedback.selectionChanged();
    if (tab === 'leaderboard') loadLeaderboard();
    if (tab === 'nft') loadNFTs();
    if (tab === 'quests') loadQuests();
}

// === LEADERBOARD ===
// Backend /api/leaderboard vraća array direktno (ne { users: [] })
async function loadLeaderboard() {
    const list = document.getElementById('lbList');
    if (!list) return;
    list.innerHTML = '<div class="lb-loading">Učitavanje...</div>';
    try {
        const response = await fetch('/api/leaderboard');
        const data = await response.json();
        // Backend vraća: [ { telegramId, totalClicks, clickBalance }, ... ]
        const users = Array.isArray(data) ? data : (data.users || []);
        if (!users.length) { list.innerHTML = '<div class="lb-loading">Nema podataka</div>'; return; }
        const myId = String(tg.initDataUnsafe?.user?.id || '');
        const medals = ['🥇', '🥈', '🥉'];
        list.innerHTML = users.map((u, i) => {
            const isMe = String(u.telegramId) === myId;
            const medal = medals[i] || `${i + 1}.`;
            return `
                <div class="lb-item ${isMe ? 'me' : ''}">
                    <span class="lb-rank">${medal}</span>
                    <div class="lb-info">
                        <span class="lb-name">${isMe ? '👤 Ti' : `Rudar #${String(u.telegramId).slice(-4)}`}</span>
                        <span class="lb-rank-label">${getRankInfo(u.totalClicks || 0).name}</span>
                    </div>
                    <span class="lb-clicks">${(u.totalClicks || 0).toLocaleString()}</span>
                </div>`;
        }).join('');
        const myRankIdx = users.findIndex(u => String(u.telegramId) === myId);
        const myRankEl = document.getElementById('lbMyRank');
        const myRankNum = document.getElementById('myRankNum');
        if (myRankIdx !== -1 && myRankEl && myRankNum) {
            myRankEl.style.display = 'block';
            myRankNum.textContent = `#${myRankIdx + 1}`;
        }
    } catch (e) { list.innerHTML = '<div class="lb-loading">Greška pri učitavanju</div>'; }
}

// === NFTs ===
// Backend /api/nftcount vraća samo { count } — nedostaje nfts[]
// Koristimo /api/me s includeNFTs ili direktan poziv koji postoji
// NAPOMENA: backend /api/nftcount treba popravak (vidi README uz ovaj fajl)
// Za sada koristimo fallback koji prikazuje count i poziva equip/stake/withdraw
async function loadNFTs() {
    const grid = document.getElementById('nftGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="nft-loading">Učitavanje NFT-ova...</div>';
    try {
        const user = tg.initDataUnsafe?.user || null;
        if (!user) return;

        // /api/nftcount vraća { count, nfts[], tonWallet } — nakon backendskog fixa
        const response = await fetch('/api/nftcount', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawUser: user, initData: tg.initData || '' })
        });
        const data = await response.json();

        // Podrška za stari backend (samo count) i novi (s nfts[])
        const nfts = data.nfts || [];
        const hasWallet = !!data.tonWallet;

        if (!nfts.length) {
            // Backend vraća count ali ne i nfts[] — prikaži info poruku
            if (data.count > 0) {
                grid.innerHTML = `<div class="nft-loading" style="grid-column:1/-1">
                    Imaš ${data.count} NFT-ova.<br>
                    <span style="font-size:11px">Koristi /nfts komandu u botu za pregled.</span>
                </div>`;
            } else {
                grid.innerHTML = `<div class="nft-loading" style="grid-column:1/-1">
                    Nemaš NFT-ova.<br>
                    <span style="font-size:11px">Rudarenjem otključavaš NFT-ove!</span>
                </div>`;
            }
            return;
        }

        // Pronađi opremljeni NFT
        const equippedNFT = nfts.find(n => n.equipped === true);
        const equippedId = equippedNFT ? equippedNFT.id : null;

        // Prikaži opremljeni NFT u header sekciji
        const nftEqEmpty = document.getElementById('nftEqEmpty');
        const nftEqCard = document.getElementById('nftEqCard');
        if (equippedNFT) {
            if (nftEqEmpty) nftEqEmpty.style.display = 'none';
            if (nftEqCard) nftEqCard.style.display = 'flex';
            const eqIconEl = document.getElementById('nftEqIcon');
            if (eqIconEl) eqIconEl.textContent = getNFTIcon(equippedNFT.rarity);
            const eqNameEl = document.getElementById('nftEqName');
            if (eqNameEl) eqNameEl.textContent = equippedNFT.name;
            const eqBonusEl = document.getElementById('nftEqBonus');
            if (eqBonusEl) eqBonusEl.textContent = `${equippedNFT.bonusMultiplier}x bonus`;
        } else {
            if (nftEqEmpty) nftEqEmpty.style.display = 'flex';
            if (nftEqCard) nftEqCard.style.display = 'none';
        }

        // Generiraj kartice NFT-ova
        grid.innerHTML = nfts.map(nft => {
            const isPending = nft.contractAddress && nft.contractAddress.startsWith('withdraw:');
            const isEquipped = nft.id === equippedId;

            let withdrawBtn;
            if (isPending) {
                withdrawBtn = `<button class="nft-action-btn" disabled style="opacity:0.5;cursor:default">⏳ Pending</button>`;
            } else if (!hasWallet) {
                withdrawBtn = `<button class="nft-action-btn" disabled style="opacity:0.5;cursor:default;font-size:9px">🔒 Nema walleta</button>`;
            } else if (nft.staked || isEquipped) {
                withdrawBtn = `<button class="nft-action-btn" disabled style="opacity:0.5;cursor:default">📤 N/A</button>`;
            } else {
                withdrawBtn = `<button class="nft-action-btn" onclick="withdrawNFT(${nft.id})" style="color:var(--boost);border-color:rgba(255,107,53,0.2);background:rgba(255,107,53,0.1)">📤 Withdraw</button>`;
            }

            return `
            <div class="nft-card ${isEquipped ? 'equipped' : ''} ${isPending ? 'nft-pending' : ''}">
                <span class="nft-card-icon">${getNFTIcon(nft.rarity)}</span>
                <span class="nft-card-name">${nft.name}</span>
                <span class="nft-card-bonus">${nft.bonusMultiplier}x bonus</span>
                <span class="nft-card-rarity">${nft.rarity}</span>
                ${isPending ? '<span style="font-size:9px;color:var(--boost);display:block;margin-top:2px">⏳ Withdrawal u obradi</span>' : ''}
                <div class="nft-card-actions">
                    <button class="nft-action-btn" onclick="equipNFT(${nft.id})">${isEquipped ? '✅' : 'Opremi'}</button>
                    <button class="nft-action-btn" onclick="stakeNFT(${nft.id})" style="color:var(--energy);border-color:rgba(0,212,255,0.2);background:rgba(0,212,255,0.1)">${nft.staked ? '🔒 Unstake' : 'Stake'}</button>
                    ${withdrawBtn}
                </div>
            </div>`;
        }).join('');

        if (!hasWallet) {
            grid.innerHTML += '<div style="grid-column:1/-1;text-align:center;font-size:11px;color:var(--boost);padding:8px">⚠️ Dodaj TON wallet s /wallet komandom za withdrawal</div>';
        }
    } catch (e) {
        console.error('NFT load error:', e);
        grid.innerHTML = '<div class="nft-loading">Greška pri učitavanju NFT-ova</div>';
    }
}

function getNFTIcon(rarity) {
    if (!rarity) return '🎨';
    const icons = {
        'bronze': '⛏️', 'common': '⛏️',
        'silver': '🥈', 'rare': '🥈',
        'gold': '🥇', 'epic': '🥇',
        'diamond': '💎', 'legendary': '💎',
        'fire': '🔥', 'mythic': '🔥'
    };
    return icons[rarity.toLowerCase()] || '🎨';
}

async function equipNFT(nftId) {
    try {
        const user = tg.initDataUnsafe?.user || null;
        if (!user) return;
        const res = await fetch('/api/equip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawUser: user, initData: tg.initData || '', nftId })
        });
        const data = await res.json();
        if (res.ok) {
            tg.HapticFeedback.notificationOccurred('success');
            tg.showAlert('✅ NFT opremljen!');
        } else {
            tg.showAlert('❌ ' + (data.error || 'Greška'));
        }
        loadNFTs();
    } catch (e) { tg.showAlert('❌ Greška pri opremanju'); }
}

async function stakeNFT(nftId) {
    try {
        const user = tg.initDataUnsafe?.user || null;
        if (!user) return;
        // Backend /api/stake togglea stanje (stake/unstake)
        await fetch('/api/stake', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawUser: user, initData: tg.initData || '', nftId })
        });
        tg.HapticFeedback.notificationOccurred('success');
        loadNFTs();
    } catch (e) { console.error(e); }
}

async function withdrawNFT(nftId) {
    const user = tg.initDataUnsafe?.user || null;
    if (!user) return;

    tg.showConfirm(
        'Povući NFT na tvoj TON wallet?\nAdmin će ga poslati u roku 24h.',
        async (confirmed) => {
            if (!confirmed) return;
            try {
                const response = await fetch('/api/nft/withdraw', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rawUser: user, initData: tg.initData || '', nftId })
                });
                const data = await response.json();
                if (data.success) {
                    tg.showAlert('✅ ' + data.message);
                    tg.HapticFeedback.notificationOccurred('success');
                    loadNFTs();
                } else {
                    tg.showAlert('❌ ' + (data.error || 'Greška'));
                }
            } catch (e) {
                tg.showAlert('❌ Greška pri withdrawalu');
            }
        }
    );
}

async function handleUnequip() {
    try {
        const user = tg.initDataUnsafe?.user || null;
        if (!user) return;
        await fetch('/api/unequip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawUser: user, initData: tg.initData || '' })
        });
        const nftEqEmpty = document.getElementById('nftEqEmpty');
        const nftEqCard = document.getElementById('nftEqCard');
        if (nftEqEmpty) nftEqEmpty.style.display = 'flex';
        if (nftEqCard) nftEqCard.style.display = 'none';
        tg.HapticFeedback.notificationOccurred('success');
        loadNFTs();
    } catch (e) { console.error(e); }
}

// === QUESTS ===
// Backend QuestService je potpuno implementiran (Quest model + stvarno praćenje progresa).
// /api/me i /api/tap sada vraćaju stvarne questove u userData.quests — koristimo njih direktno.
const QUEST_META = {
    clicks:    { icon: '⛏️', title: 'Rudarski dan',      desc: (t) => `Klikni ${t.toLocaleString()} puta danas` },
    referrals: { icon: '👥', title: 'Pozovi prijatelje', desc: (t) => `Pozovi ${t.toLocaleString()} korisnika danas` },
    nft:       { icon: '🎨', title: 'Iskopaj NFT',       desc: (t) => `Iskopaj ${t.toLocaleString()} NFT danas` },
};

async function loadQuests() {
    const list = document.getElementById('questList');
    if (!list) return;
    list.innerHTML = '<div class="lb-loading">Učitavanje zadataka...</div>';

    // Stvarni questovi s backenda (/api/me → userData.quests, osvježeno nakon svakog /api/tap)
    const quests = userData?.quests || [];

    if (!quests.length) {
        list.innerHTML = '<div class="lb-loading">Nema aktivnih zadataka</div>';
        return;
    }

    list.innerHTML = quests.map(q => {
        const meta = QUEST_META[q.type] || { icon: '📋', title: q.type, desc: (t) => `Cilj: ${t}` };
        const pct = Math.min(100, (q.progress / q.target) * 100);
        return `
            <div class="quest-item ${q.completed ? 'done' : ''}">
                <div class="quest-header">
                    <span class="quest-title">${meta.icon} ${meta.title}</span>
                    <span class="quest-reward">+${q.reward} KVNC</span>
                </div>
                <div class="quest-desc">${meta.desc(q.target)}</div>
                <div class="quest-progress-wrap">
                    <div class="quest-progress-fill" style="width:${pct}%"></div>
                </div>
                <div class="quest-footer">
                    <span class="quest-count">${q.progress.toLocaleString()} / ${q.target.toLocaleString()}</span>
                    ${q.completed ? '<span class="quest-done-badge">✅ Završeno</span>' : ''}
                </div>
            </div>`;
    }).join('');
}

// === REFERRAL ===
function copyRefLink() {
    if (!refLink) return;
    navigator.clipboard?.writeText(refLink).then(() => {
        tg.showAlert('✅ Link kopiran!');
    }).catch(() => tg.showAlert(refLink));
    tg.HapticFeedback.notificationOccurred('success');
}

function shareRefLink() {
    if (!refLink) return;
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('⛏️ Pridruži se Kovanica rudniku i rudari KVNC kripto!')}`);
}

// === START ===
document.addEventListener('DOMContentLoaded', () => {
    const mineBtn = document.getElementById('mineBtn');
    if (mineBtn) mineBtn.addEventListener('click', handleMine);

    const pickaxe = document.getElementById('pickaxe');
    if (pickaxe) pickaxe.addEventListener('click', handleMine);
});

init();
console.log('🚀 Kovanica Mini App v2.3 loaded!');
