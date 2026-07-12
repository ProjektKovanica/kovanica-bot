const tg = window.Telegram.WebApp;
tg.expand();

let userData = null;
let isProcessing = false;

async function init() {
    try {
        const user = tg.initDataUnsafe?.user || null;
        if (!user) {
            tg.showAlert('Greška pri povezivanju!');
            return;
        }

        console.log('📱 Telegram User:', user);

        const response = await fetch('/api/me', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                rawUser: user,
                initData: tg.initData || ''
            })
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('❌ API Error:', error);
            throw new Error(`HTTP ${response.status}`);
        }

        userData = await response.json();
        console.log('✅ User Data:', userData);
        
        updateUI(userData);
        tg.HapticFeedback.impactOccurred('light');
    } catch (error) {
        console.error('❌ Init error:', error);
        tg.showAlert('Greška pri učitavanju podataka!');
    }
}

function updateUI(data) {
    const balanceEl = document.getElementById('balance');
    if (balanceEl) {
        balanceEl.textContent = data.clickBalance?.toFixed(4) || '0.0000';
    }
    
    const clicksEl = document.getElementById('totalClicks');
    if (clicksEl) {
        clicksEl.textContent = data.totalClicks || 0;
    }
    
    const dailyEl = document.getElementById('dailyClicks');
    if (dailyEl) {
        dailyEl.textContent = `${data.dailyClicks || 0} / ${data.dailyLimit || 10000}`;
    }
    
    const rankEl = document.getElementById('rankBadge');
    if (rankEl) {
        rankEl.textContent = data.rank || 'Novi rudar';
    }
}

async function handleMine() {
    if (isProcessing) return;
    isProcessing = true;

    const btn = document.getElementById('mineBtn');
    btn.textContent = '⛏️ RUDARI...';
    btn.disabled = true;

    try {
        const user = tg.initDataUnsafe?.user || null;
        if (!user) {
            tg.showAlert('Greška pri rudarenju!');
            isProcessing = false;
            btn.textContent = '⛏️ RUDARI!';
            btn.disabled = false;
            return;
        }

        const response = await fetch('/api/tap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                rawUser: user,
                initData: tg.initData || ''
            })
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('❌ Tap Error:', error);
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        userData = data;
        updateUI(data);
        
        tg.HapticFeedback.impactOccurred('medium');
        
        const counter = document.getElementById('clickCounter');
        if (counter) {
            counter.textContent = `+${data.reward?.toFixed(1) || 1}`;
            counter.classList.add('show');
            setTimeout(() => counter.classList.remove('show'), 500);
        }
        
        const pickaxe = document.getElementById('pickaxe');
        if (pickaxe) {
            pickaxe.classList.add('hit');
            setTimeout(() => pickaxe.classList.remove('hit'), 150);
        }
        
    } catch (error) {
        console.error('❌ Tap error:', error);
        tg.showAlert('Greška pri rudarenju!');
    }

    isProcessing = false;
    btn.textContent = '⛏️ RUDARI!';
    btn.disabled = false;
}

document.addEventListener('DOMContentLoaded', () => {
    const mineBtn = document.getElementById('mineBtn');
    if (mineBtn) {
        mineBtn.addEventListener('click', handleMine);
    }
});

init();
console.log('🚀 Kovanica Mini App loaded!');
