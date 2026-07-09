const tg = window.Telegram.WebApp;
tg.expand();

let userData = null;
let isProcessing = false;
let chart = null;
let priceChart = null;
let priceHistory = [];
const MAX_PRICE_POINTS = 30;
let ws = null;
let gameResultEl = null;
let selectedSwapTo = 'GRAM';

// === JEZICI ===
let currentLang = 'hr';
let translations = {};

async function loadTranslations(lang) {
    try {
        const response = await fetch(`/locales/${lang}.json`);
        translations = await response.json();
        currentLang = lang;
        applyTranslations();
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.lang === lang);
        });
        tg.HapticFeedback.impactOccurred('light');
    } catch (error) {
        console.error('Translation error:', error);
    }
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (translations[key]) {
            el.textContent = translations[key];
        }
    });
}

// === INICIJALIZACIJA ===
async function init() {
    try {
        // Detektiraj jezik iz Telegrama
        const userLang = tg.initDataUnsafe?.user?.language_code || 'hr';
        const lang = userLang.startsWith('en') ? 'en' : 'hr';
        await loadTranslations(lang);

        const user = tg.initDataUnsafe?.user || null;
        if (!user) {
            tg.showAlert(translations.error || 'Greška pri povezivanju!');
            return;
        }

        const response = await fetch('/api/me', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawUser: user })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        userData = await response.json();
        
        const nftResponse = await fetch('/api/nftcount', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawUser: user })
        });
        if (nftResponse.ok) {
            const nftData = await nftResponse.json();
            userData.nfts = nftData.count || 0;
        } else {
            userData.nfts = 0;
        }
        
        updateUI(userData);
        loadStats();
        loadLeaderboard();
        loadQuests({ rawUser: user });
        loadAchievements({ rawUser: user });
        loadVIPStatus({ rawUser: user });
        loadBoostStatus({ rawUser: user });
        loadSpinStatus({ rawUser: user });
        loadPriceChart();
        loadPriceTicker();
        
        connectWebSocket(user.id);
        gameResultEl = document.getElementById('gameResult');
        
        if (userData.tonWallet) {
            document.getElementById('walletInput').value = userData.tonWallet;
            document.getElementById('walletStatus').textContent = translations.wallet_saved || '✅ Spremljeno';
        }
        
        setInterval(loadPriceTicker, 30000);
        setInterval(loadPriceChart, 30000);
    } catch (error) {
        console.error('Init error:', error);
        tg.showAlert(translations.error || 'Greška pri učitavanju podataka!');
    }
}

// === JEZIČKI SELECTOR ===
document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        loadTranslations(btn.dataset.lang);
    });
});

// === WEBSOCKET ===
function connectWebSocket(userId) {
    try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws?userId=${userId}`;
        
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('🔌 WebSocket connected');
        };
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'notification') {
                    tg.showAlert(data.data.message || '🔔 Nova obavijest!');
                } else if (data.type === 'user_update') {
                    updateUI(data.data);
                }
            } catch (e) {
                console.error('WebSocket message error:', e);
            }
        };
        
        ws.onclose = () => {
            console.log('🔌 WebSocket disconnected');
            setTimeout(() => connectWebSocket(userId), 5000);
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    } catch (error) {
        console.error('WebSocket init error:', error);
    }
}

// === UPDATE UI ===
function updateUI(data) {
    const balanceEl = document.getElementById('balance');
    const oldBalance = parseFloat(balanceEl.textContent) || 0;
    const newBalance = data.clickBalance;
    balanceEl.textContent = newBalance.toFixed(4);
    
    const changeEl = document.getElementById('balanceChange');
    if (oldBalance !== newBalance) {
        const diff = (newBalance - oldBalance).toFixed(4);
        if (diff > 0) {
            changeEl.textContent = `+${diff} KVNC`;
            changeEl.className = 'balance-change';
        } else if (diff < 0) {
            changeEl.textContent = `${diff} KVNC`;
            changeEl.className = 'balance-change negative';
        }
        setTimeout(() => { changeEl.textContent = ''; }, 3000);
    }
    
    document.getElementById('dailyClicks').textContent = `${data.dailyClicks} / 10000`;
    document.getElementById('totalClicks').textContent = data.totalClicks;
    document.getElementById('referralCount').textContent = data.referralCount || 0;
    document.getElementById('nftCount').textContent = data.nfts || 0;
    document.getElementById('rankBadge').textContent = data.rank;
    document.getElementById('rankText').textContent = data.rank.replace(/[⛏️💎🔹🥇🥈🥉]/g, '').trim();

    const bonusEl = document.getElementById('bonusStatus');
    if (data.bonusAvailable) {
        bonusEl.textContent = '✅ ' + (translations.active || 'Aktivan');
        bonusEl.style.color = '#ffd700';
    } else {
        bonusEl.textContent = '⏳ ' + (translations.used || 'Iskorišten');
        bonusEl.style.color = '#8892b0';
    }

    updateRankProgress(data.totalClicks);
}

// === PROGRESS BAR ===
function updateRankProgress(clicks) {
    const ranks = [
        { name: 'Novi rudar', min: 0, max: 99 },
        { name: 'Početnik', min: 100, max: 499 },
        { name: 'Napredni rudar', min: 500, max: 1999 },
        { name: 'Brončani rudar', min: 2000, max: 4999 },
        { name: 'Srebrni rudar', min: 5000, max: 9999 },
        { name: 'Zlatni rudar', min: 10000, max: 19999 },
        { name: 'Platinasti rudar', min: 20000, max: 49999 },
        { name: 'Dijamantni rudar', min: 50000, max: 99999 },
        { name: 'Kralj rudara', min: 100000, max: Infinity }
    ];

    let currentRank = ranks.find(r => clicks >= r.min && clicks <= r.max);
    if (!currentRank) currentRank = ranks[ranks.length - 1];

    const nextRankIndex = ranks.indexOf(currentRank) + 1;
    if (nextRankIndex < ranks.length) {
        const nextRank = ranks[nextRankIndex];
        const progress = (clicks - currentRank.min) / (nextRank.min - currentRank.min) * 100;
        document.getElementById('rankProgress').style.width = Math.min(progress, 100) + '%';
        document.getElementById('progressText').textContent = `${clicks} / ${nextRank.min}`;
    } else {
        document.getElementById('rankProgress').style.width = '100%';
        document.getElementById('progressText').textContent = '🏆 ' + (translations.max_rank || 'Maksimalni rang!');
    }
}

// === PARTICLES ===
function createParticles() {
    const container = document.getElementById('particles');
    const count = 12;
    for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        const angle = Math.random() * Math.PI * 2;
        const distance = 40 + Math.random() * 60;
        particle.style.setProperty('--tx', `${Math.cos(angle) * distance}px`);
        particle.style.setProperty('--ty', `${Math.sin(angle) * distance - 20}px`);
        const colors = ['#ffd700', '#f7971e', '#ff6b00', '#ffdd00', '#ffaa00'];
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];
        const size = 4 + Math.random() * 6;
        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;
        particle.style.borderRadius = '50%';
        container.appendChild(particle);
        setTimeout(() => particle.remove(), 600);
    }
}

// === LOAD FUNKCIJE ===
async function loadStats() {
    try {
        const response = await fetch('/api/stats');
        const stats = await response.json();
        document.getElementById('statUsers').textContent = stats.totalUsers.toLocaleString();
        document.getElementById('statActive').textContent = stats.activeUsers.toLocaleString();
        document.getElementById('statClicks').textContent = stats.totalClicks.toLocaleString();
        document.getElementById('statBalance').textContent = stats.totalBalance.toFixed(2);
    } catch (error) {
        console.error('Stats error:', error);
    }
}

async function loadLeaderboard() {
    try {
        const response = await fetch('/api/leaderboard');
        const users = await response.json();
        const list = document.getElementById('leaderboardList');
        list.innerHTML = '';

        if (users.length === 0) {
            list.innerHTML = `<div style="text-align:center;color:#8892b0;padding:8px;font-size:12px;">${translations.no_miners || 'Još nema rudara!'}</div>`;
            return;
        }

        users.forEach((user, index) => {
            const item = document.createElement('div');
            item.className = 'leaderboard-item';
            let rankClass = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
            item.innerHTML = `
                <span class="rank ${rankClass}">${medal}</span>
                <span class="name">${user.telegramId.slice(0, 12)}...</span>
                <span class="clicks">${user.totalClicks.toLocaleString()}</span>
            `;
            list.appendChild(item);
        });
    } catch (error) {
        console.error('Leaderboard error:', error);
    }
}

async function loadQuests(body) {
    try {
        const response = await fetch('/api/quests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const quests = await response.json();
        const list = document.getElementById('questsList');
        list.innerHTML = '';

        if (quests.length === 0) {
            list.innerHTML = `<div style="text-align:center;color:#8892b0;padding:8px;font-size:12px;">${translations.no_quests || 'Nema aktivnih zadataka'}</div>`;
            return;
        }

        quests.forEach(quest => {
            const item = document.createElement('div');
            item.className = 'quest-item';
            const icons = { clicks: '👆', referrals: '👥', nft: '🎨' };
            const names = {
                clicks: `Klikni ${quest.target} puta`,
                referrals: `Pozovi ${quest.target} prijatelja`,
                nft: `Iskopaj ${quest.target} NFT`
            };
            const progressPercent = Math.min((quest.progress / quest.target) * 100, 100);
            const status = quest.completed ? '✅' : '⏳';
            const statusColor = quest.completed ? '#4ade80' : '#8892b0';
            item.innerHTML = `
                <span class="quest-icon">${icons[quest.type] || '📋'}</span>
                <div class="quest-info">
                    <div class="quest-name">${names[quest.type] || quest.type}</div>
                    <div class="quest-progress">${quest.progress}/${quest.target}</div>
                    <div class="progress-bar" style="height:3px;margin-top:2px;">
                        <div class="progress-fill" style="width:${progressPercent}%;height:3px;"></div>
                    </div>
                </div>
                <span class="quest-reward">+${quest.reward}</span>
                <span class="quest-status" style="color:${statusColor}">${status}</span>
            `;
            list.appendChild(item);
        });
    } catch (error) {
        console.error('Quests error:', error);
    }
}

async function loadAchievements(body) {
    try {
        const response = await fetch('/api/achievements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const achievements = await response.json();
        const list = document.getElementById('achievementList');
        list.innerHTML = '';

        const total = achievements.length;
        const unlocked = achievements.filter(a => a.unlocked).length;
        document.getElementById('achCount').textContent = `${unlocked}/${total}`;

        if (achievements.length === 0) {
            list.innerHTML = `<div style="text-align:center;color:#8892b0;padding:8px;font-size:12px;">${translations.no_achievements || 'Još nema postignuća'}</div>`;
            return;
        }

        achievements.forEach(ach => {
            const item = document.createElement('div');
            item.className = `achievement-item${ach.unlocked ? ' unlocked' : ''}`;
            item.innerHTML = `
                <span class="ach-icon">${ach.unlocked ? '🏅' : '🔒'}</span>
                <div class="ach-info">
                    <div class="ach-name">${ach.name}</div>
                    <div class="ach-desc">${ach.description}</div>
                </div>
                <span class="ach-reward">+${ach.reward}</span>
                <span class="ach-status">${ach.unlocked ? '✅' : '⏳'}</span>
            `;
            list.appendChild(item);
        });
    } catch (error) {
        console.error('Achievements error:', error);
    }
}

async function loadVIPStatus(body) {
    try {
        const response = await fetch('/api/vip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const vip = await response.json();
        const badge = document.getElementById('vipBadge');
        if (vip.active) {
            badge.style.display = 'inline-block';
            badge.textContent = `👑 ${vip.level.toUpperCase()} VIP`;
        } else {
            badge.style.display = 'none';
        }
    } catch (error) {
        console.error('VIP error:', error);
    }
}

async function loadBoostStatus(body) {
    try {
        const response = await fetch('/api/boost', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const boost = await response.json();
        const el = document.getElementById('boostStatus');
        if (boost.active) {
            const minsLeft = Math.max(0, Math.round((boost.expiresAt - Date.now()) / 60000));
            el.textContent = `✅ ${boost.type}x (${minsLeft} min)`;
            el.style.color = '#ffd700';
            document.getElementById('rewardSub').textContent = `+${boost.type} KVNC`;
        } else {
            el.textContent = '❌ ' + (translations.inactive || 'Neaktivan');
            el.style.color = '#8892b0';
            document.getElementById('rewardSub').textContent = '+1 KVNC';
        }
    } catch (error) {
        console.error('Boost error:', error);
    }
}

async function loadSpinStatus(body) {
    try {
        const response = await fetch('/api/spin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const spin = await response.json();
        const btn = document.getElementById('spinBtn');
        if (spin.available !== undefined && !spin.available) {
            const hours = Math.ceil((spin.nextSpin - Date.now()) / (1000 * 60 * 60));
            btn.textContent = `🎡 ${translations.spin || 'Spin'} (${hours}h)`;
            btn.style.opacity = '0.5';
        } else {
            btn.textContent = `🎡 ${translations.spin || 'Spin'} (${translations.available || 'dostupan'})`;
            btn.style.opacity = '1';
        }
    } catch (error) {
        console.error('Spin error:', error);
    }
}

// === PRICE TICKER ===
async function loadPriceTicker() {
    try {
        const response = await fetch('/api/price');
        const price = await response.json();
        
        document.getElementById('tickerPrice').textContent = `${price.usdt.toFixed(6)} USDT`;
        
        const changeEl = document.getElementById('tickerChange');
        const change = price.change24h || 0;
        changeEl.textContent = `${change > 0 ? '+' : ''}${change.toFixed(2)}%`;
        changeEl.className = `ticker-change ${change >= 0 ? 'positive' : 'negative'}`;
    } catch (error) {
        console.error('Price ticker error:', error);
    }
}

// === PRICE CHART ===
async function loadPriceChart() {
    try {
        const response = await fetch('/api/price');
        const price = await response.json();
        
        const now = new Date();
        priceHistory.push({ time: now, price: price.usdt });
        if (priceHistory.length > MAX_PRICE_POINTS) {
            priceHistory.shift();
        }
        
        const ctx = document.getElementById('priceChart').getContext('2d');
        
        if (priceChart) {
            priceChart.destroy();
        }
        
        const labels = priceHistory.map(p => p.time.toLocaleTimeString());
        const data = priceHistory.map(p => p.price);
        
        priceChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'KVNC/USDT',
                    data: data,
                    borderColor: '#f7971e',
                    backgroundColor: 'rgba(247, 151, 30, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 1,
                    pointBackgroundColor: '#ffd700',
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#8892b0', font: { size: 9 } },
                        grid: { color: 'rgba(255,255,255,0.04)' }
                    },
                    x: {
                        ticks: { color: '#8892b0', font: { size: 8 }, maxTicksLimit: 6 },
                        grid: { display: false }
                    }
                }
            }
        });
        
        document.getElementById('chartPrice').textContent = price.usdt.toFixed(6);
        document.getElementById('chartVolume').textContent = price.volume24h.toFixed(2);
        
    } catch (error) {
        console.error('Price chart error:', error);
    }
}

// === SWAP ===
document.querySelectorAll('.swap-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.swap-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedSwapTo = btn.dataset.to;
    });
});

document.getElementById('swapExecute').addEventListener('click', async () => {
    const amount = document.getElementById('swapAmount').value;
    if (!amount || parseFloat(amount) <= 0) {
        document.getElementById('swapResult').textContent = translations.swap_error || '❌ Unesi pozitivan iznos!';
        return;
    }
    
    const user = tg.initDataUnsafe?.user || null;
    if (!user) {
        document.getElementById('swapResult').textContent = '❌ ' + (translations.error || 'Greška pri autentifikaciji!');
        return;
    }
    
    document.getElementById('swapResult').textContent = '⏳ ' + (translations.loading || 'Učitavanje...');
    
    try {
        const response = await fetch('/api/swap-link', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        
        const link = data.link || `https://app.ston.fi/swap?from=${process.env.KVNC_JETTON_MASTER}&to=${selectedSwapTo === 'GRAM' ? 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c' : 'EQCi5WSqkRsvaHNrs3pg6OrIA4C6Zk-inMHoVq0VAgo3svC5'}&amount=${amount}`;
        
        document.getElementById('swapResult').innerHTML = `✅ ${translations.swap_result || 'Link generiran:'} <a href="${link}" target="_blank">${translations.swap_execute || 'Klikni za swap'}</a>`;
        tg.HapticFeedback.impactOccurred('light');
    } catch (error) {
        document.getElementById('swapResult').textContent = '❌ ' + (translations.error || 'Greška pri generiranju linka!');
        console.error('Swap error:', error);
    }
});

// === WALLET ===
document.getElementById('walletSaveBtn').addEventListener('click', async () => {
    const address = document.getElementById('walletInput').value.trim();
    if (!address || !address.startsWith('EQD') && !address.startsWith('UQ')) {
        document.getElementById('walletStatus').textContent = '❌ ' + (translations.invalid_address || 'Neispravna adresa!');
        return;
    }
    
    const user = tg.initDataUnsafe?.user || null;
    if (!user) {
        document.getElementById('walletStatus').textContent = '❌ ' + (translations.error || 'Greška pri autentifikaciji!');
        return;
    }
    
    try {
        const response = await fetch('/api/wallet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawUser: user, address: address })
        });
        
        if (response.ok) {
            document.getElementById('walletStatus').textContent = '✅ ' + (translations.wallet_saved || 'Wallet spremljen!');
            tg.HapticFeedback.impactOccurred('light');
        } else {
            document.getElementById('walletStatus').textContent = '❌ ' + (translations.error || 'Greška pri spremanju!');
        }
    } catch (error) {
        document.getElementById('walletStatus').textContent = '❌ ' + (translations.error || 'Greška!');
        console.error('Wallet save error:', error);
    }
});

// === GAME FUNKCIJE ===
async function playGame(endpoint, body = {}) {
    try {
        const user = tg.initDataUnsafe?.user || null;
        if (!user) {
            tg.showAlert(translations.error || 'Greška!');
            return;
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawUser: user, ...body })
        });

        const result = await response.json();

        if (result.error) {
            tg.showAlert(result.error);
            return;
        }

        let message = '';
        let emoji = '';
        if (result.game === 'kamen-škare-papir') {
            emoji = result.reward > 0 ? '🎉' : '😢';
            message = `${emoji} Ti: ${result.playerChoice} | Bot: ${result.botChoice}\n${result.result}\n💰 +${result.reward} KVNC`;
        } else if (result.game === 'pogodi-broj') {
            emoji = result.reward > 0 ? '🎉' : '😢';
            message = `${emoji} Tvoj broj: ${result.guess} | Cilj: ${result.target}\n${result.result}\n💰 +${result.reward} KVNC`;
        } else if (result.game === 'slot') {
            emoji = result.reward > 0 ? '🎉' : '😢';
            message = `${emoji} ${result.slots.join(' | ')}\n${result.result}\n💰 +${result.reward} KVNC`;
        }

        if (gameResultEl) {
            gameResultEl.textContent = message;
            gameResultEl.style.background = result.reward > 0 ? 'rgba(74, 222, 128, 0.08)' : 'rgba(248, 113, 113, 0.08)';
            gameResultEl.style.borderRadius = '8px';
            gameResultEl.style.padding = '8px';
            setTimeout(() => {
                gameResultEl.style.background = 'transparent';
            }, 3000);
        }
        
        tg.HapticFeedback.impactOccurred('light');
        
        loadStats();
        const refreshResponse = await fetch('/api/me', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawUser: user })
        });
        if (refreshResponse.ok) {
            userData = await refreshResponse.json();
            const nftResponse = await fetch('/api/nftcount', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rawUser: user })
            });
            if (nftResponse.ok) {
                const nftData = await nftResponse.json();
                userData.nfts = nftData.count || 0;
            }
            updateUI(userData);
        }
    } catch (error) {
        console.error('Game error:', error);
        tg.showAlert(translations.error || 'Greška pri igri!');
    }
}

// === GUMBI ===
document.getElementById('ctaBtn').addEventListener('click', () => {
    document.getElementById('mineBtn').click();
    tg.HapticFeedback.impactOccurred('light');
});

document.getElementById('mineBtn').addEventListener('click', async () => {
    if (isProcessing) return;
    isProcessing = true;

    const pickaxe = document.getElementById('pickaxe');
    pickaxe.classList.add('hit');
    setTimeout(() => pickaxe.classList.remove('hit'), 150);
    
    createParticles();

    const counter = document.getElementById('clickCounter');
    counter.textContent = `+1`;
    counter.classList.add('show');
    setTimeout(() => counter.classList.remove('show'), 500);

    try {
        const user = tg.initDataUnsafe?.user || null;
        if (!user) {
            tg.showAlert(translations.error || 'Greška pri rudarenju!');
            isProcessing = false;
            return;
        }

        const response = await fetch('/api/tap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawUser: user })
        });

        if (!response.ok) throw new Error('Greška pri rudarenju');

        const data = await response.json();
        userData = data;
        
        const nftResponse = await fetch('/api/nftcount', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawUser: user })
        });
        if (nftResponse.ok) {
            const nftData = await nftResponse.json();
            userData.nfts = nftData.count || 0;
        }
        
        updateUI(userData);
        loadStats();
        loadQuests({ rawUser: user });
        loadAchievements({ rawUser: user });
        loadBoostStatus({ rawUser: user });
        loadSpinStatus({ rawUser: user });

        tg.HapticFeedback.impactOccurred('medium');
    } catch (error) {
        console.error('Tap error:', error);
        tg.showAlert(translations.error || 'Greška pri rudarenju!');
    }
    isProcessing = false;
});

document.getElementById('spinBtn').addEventListener('click', async () => {
    try {
        const user = tg.initDataUnsafe?.user || null;
        if (!user) return;

        const response = await fetch('/api/spin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawUser: user })
        });

        const result = await response.json();
        if (result.error) {
            tg.showAlert(result.error);
            return;
        }

        if (!result.available) {
            const hours = Math.ceil((result.nextSpin - Date.now()) / (1000 * 60 * 60));
            tg.showAlert((translations.spin_unavailable || 'Spin dostupan za {hours} sati.').replace('{hours}', hours));
            return;
        }

        const emoji = result.rewardType === 'kvnc' ? '💰' : result.rewardType === 'boost' ? '⚡' : '🎨';
        tg.showAlert(`🎡 Dobio si: ${emoji} ${result.reward} ${result.rewardType}!`);
        loadSpinStatus({ rawUser: user });
        loadStats();
        
        const refreshResponse = await fetch('/api/me', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawUser: user })
        });
        if (refreshResponse.ok) {
            userData = await refreshResponse.json();
            const nftResponse = await fetch('/api/nftcount', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rawUser: user })
            });
            if (nftResponse.ok) {
                const nftData = await nftResponse.json();
                userData.nfts = nftData.count || 0;
            }
            updateUI(userData);
        }
    } catch (error) {
        console.error('Spin error:', error);
        tg.showAlert(translations.error || 'Greška pri spinu!');
    }
});

document.getElementById('boostBtn').addEventListener('click', async () => {
    try {
        const user = tg.initDataUnsafe?.user || null;
        if (!user) return;

        tg.showConfirm(translations.boost_buy || 'Želiš li kupiti 2x Boost za 10 KVNC na 10 minuta?', async (confirmed) => {
            if (!confirmed) return;

            const response = await fetch('/api/boost', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rawUser: user, action: 'buy' })
            });

            const result = await response.json();
            if (result.error) {
                tg.showAlert(result.error);
                return;
            }

            tg.showAlert((translations.boost_activated || '⚡ Boost aktiviran! {type}x na 10 minuta!').replace('{type}', result.type));
            loadBoostStatus({ rawUser: user });
            loadStats();
            
            const refreshResponse = await fetch('/api/me', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rawUser: user })
            });
            if (refreshResponse.ok) {
                userData = await refreshResponse.json();
                const nftResponse = await fetch('/api/nftcount', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rawUser: user })
                });
                if (nftResponse.ok) {
                    const nftData = await nftResponse.json();
                    userData.nfts = nftData.count || 0;
                }
                updateUI(userData);
            }
        });
    } catch (error) {
        console.error('Boost error:', error);
        tg.showAlert(translations.error || 'Greška pri kupnji boosta!');
    }
});

document.getElementById('liquidityBtn').addEventListener('click', () => {
    const message = 
        `💧 **Provide Liquidity** 💧\n\n` +
        `Dodaj likvidnost u naše DEX pool-ove i zaradi feejeve!\n\n` +
        `**KVNC-USDT Pool**\n` +
        `📌 Adresa: \`EQCi5WSqkRsvaHNrs3pg6OrIA4C6Zk-inMHoVq0VAgo3svC5\`\n` +
        `📊 Status: 🟢 Aktivan\n\n` +
        `**KVNC-GRAM Pool**\n` +
        `📌 Adresa: \`EQDaPt-caUdBWLhF2In1P4x2-S7MOw79aganZ58PqMFqxR8S\`\n` +
        `📊 Status: 🟢 Aktivan\n\n` +
        `🔜 **Direktna integracija dolazi uskoro!**\n` +
        `Za sada možeš ručno dodati likvidnost na STON.fi.\n` +
        `🔗 https://app.ston.fi/pools`;
    
    tg.showAlert(message);
});

document.getElementById('gameRPS').addEventListener('click', () => {
    const choices = ['kamen', 'škare', 'papir'];
    const choice = prompt('Odaberi: kamen, škare, papir');
    if (choice && choices.includes(choice.toLowerCase())) {
        playGame('/api/game/rps', { choice: choice.toLowerCase() });
    } else if (choice !== null) {
        tg.showAlert('Odaberi kamen, škare ili papir!');
    }
});

document.getElementById('gameGuess').addEventListener('click', () => {
    const guess = prompt('Pogodi broj između 1 i 10');
    if (guess && !isNaN(guess) && guess >= 1 && guess <= 10) {
        playGame('/api/game/guess', { guess: parseInt(guess) });
    } else if (guess !== null) {
        tg.showAlert('Unesi broj između 1 i 10!');
    }
});

document.getElementById('gameSlot').addEventListener('click', () => {
    playGame('/api/game/slot');
});

document.getElementById('gameTrivia').addEventListener('click', () => {
    playGame('/api/game/trivia');
});

document.getElementById('gameCoinFlip').addEventListener('click', () => {
    const bet = prompt('Unesi iznos za ulog:');
    if (bet && !isNaN(bet) && parseInt(bet) > 0) {
        playGame('/api/game/coinflip', { bet: parseInt(bet) });
    } else if (bet !== null) {
        tg.showAlert('Unesi pozitivan broj!');
    }
});

document.getElementById('gameMemory').addEventListener('click', () => {
    playGame('/api/game/memory');
});

document.getElementById('refreshBtn').addEventListener('click', init);

document.getElementById('withdrawBtn').addEventListener('click', () => {
    tg.showConfirm(
        (translations.withdraw_confirm || 'Želiš li zatražiti isplatu cijelog balansa?') + '\n\n' +
        (translations.withdraw_manual || 'Isplate se obrađuju ručno od strane admina.\nObrada traje 24-48h.'),
        (confirmed) => {
            if (confirmed) {
                tg.sendData(JSON.stringify({ action: 'withdraw' }));
                tg.close();
            }
        }
    );
});

init();
