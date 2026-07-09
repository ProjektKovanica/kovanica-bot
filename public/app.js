const tg = window.Telegram.WebApp;
tg.expand();

let userData = null;
let isProcessing = false;

// Inicijalizacija
async function init() {
    try {
        // Dohvati initData i usera
        const initData = tg.initData || '';
        const user = tg.initDataUnsafe?.user || null;
        
        console.log("📤 initData length:", initData.length);
        console.log("📤 User from initDataUnsafe:", user);
        
        // Ako nema initData ali ima usera -> pošalji rawUser
        let body = {};
        if (user) {
            body = { rawUser: user };
        } else if (initData.length > 0) {
            body = { initData };
        } else {
            tg.showAlert('Greška pri povezivanju! Nema korisničkih podataka.');
            return;
        }
        
        const response = await fetch('/api/me', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        userData = data;
        updateUI(data);
    } catch (error) {
        console.error('Init error:', error);
        tg.showAlert('Greška pri učitavanju podataka!');
    }
}

// Update UI
function updateUI(data) {
    document.getElementById('balance').textContent = data.clickBalance.toFixed(4);
    document.getElementById('dailyClicks').textContent = `${data.dailyClicks} / ${data.dailyLimit}`;
    document.getElementById('totalClicks').textContent = data.totalClicks;
    document.getElementById('referralCount').textContent = data.referralCount;
    document.getElementById('rankBadge').textContent = data.rank;
    document.getElementById('rankText').textContent = data.rank.replace(/[⛏️💎🔹🥇🥈🥉]/g, '').trim();
    
    const bonusEl = document.getElementById('bonusStatus');
    if (data.bonusAvailable) {
        bonusEl.textContent = '✅ Aktivan (5x)';
        bonusEl.style.color = '#ffd700';
    } else {
        bonusEl.textContent = '⏳ Iskorišten danas';
        bonusEl.style.color = '#8892b0';
    }
}

// Klik (rudarenje)
document.getElementById('mineBtn').addEventListener('click', async () => {
    if (isProcessing) return;
    isProcessing = true;

    // Animacija pijuka
    const pickaxe = document.getElementById('pickaxe');
    pickaxe.classList.add('hit');
    setTimeout(() => pickaxe.classList.remove('hit'), 150);

    // Pop-up brojač
    const counter = document.getElementById('clickCounter');
    counter.textContent = `+0.${Math.random() > 0.8 ? '5' : '1'}`;
    counter.classList.add('show');
    setTimeout(() => counter.classList.remove('show'), 600);

    try {
        const user = tg.initDataUnsafe?.user || null;
        
        if (!user) {
            tg.showAlert('Greška pri rudarenju! Nema korisničkih podataka.');
            isProcessing = false;
            return;
        }
        
        console.log("📤 Tap - user:", user);
        
        const response = await fetch('/api/tap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawUser: user })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || `HTTP ${response.status}`);
        }
        
        const data = await response.json();
        userData = data;
        updateUI(data);
        tg.HapticFeedback.impactOccurred('medium');
    } catch (error) {
        console.error('Tap error:', error);
        tg.showAlert('Greška pri rudarenju! Pokušaj ponovno.');
    }
    isProcessing = false;
});

// Osvježi podatke
document.getElementById('refreshBtn').addEventListener('click', init);

// Isplata (šalje zahtjev botu)
document.getElementById('withdrawBtn').addEventListener('click', () => {
    tg.showConfirm('Želiš li zatražiti isplatu cijelog balansa?', (confirmed) => {
        if (confirmed) {
            tg.sendData(JSON.stringify({ action: 'withdraw' }));
            tg.close();
        }
    });
});

// Pokreni
init();
