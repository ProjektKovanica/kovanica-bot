import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import { createHash, createHmac } from 'crypto';

dotenv.config();

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

console.log("BOT_TOKEN exists:", !!process.env.BOT_TOKEN);

function validateInitData(initData: string): boolean {
    try {
        const BOT_TOKEN = process.env.BOT_TOKEN!;
        const searchParams = new URLSearchParams(initData);
        const hash = searchParams.get('hash');
        if (!hash) return false;
        searchParams.delete('hash');
        const dataCheckString = Array.from(searchParams.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');
        const secretKey = createHash('sha256').update(BOT_TOKEN).digest();
        const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
        return computedHash === hash;
    } catch { return false; }
}

function getRank(totalClicks: number): string {
    if (totalClicks >= 10000) return "💎 Dijamantni rudar";
    if (totalClicks >= 2000) return "🔹 Platinasti rudar";
    if (totalClicks >= 500) return "🥇 Zlatni rudar";
    if (totalClicks >= 100) return "🥈 Srebrni rudar";
    return "🥉 Brončani rudar";
}

function isToday(date: Date): boolean {
    const now = new Date();
    return date.getFullYear() === now.getFullYear() &&
           date.getMonth() === now.getMonth() &&
           date.getDate() === now.getDate();
}

function extractTelegramId(initData: string, rawUser?: any): string | null {
    try {
        if (initData && initData.length > 0) {
            const params = new URLSearchParams(initData);
            const userStr = params.get('user');
            if (userStr) {
                const user = JSON.parse(userStr);
                return String(user.id);
            }
        }
        if (rawUser && rawUser.id) {
            return String(rawUser.id);
        }
        return null;
    } catch { return null; }
}

app.post('/api/me', async (req, res) => {
    try {
        const { initData, rawUser } = req.body;
        console.log("📥 /api/me, initData length:", initData?.length || 0);
        
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });
        
        const dbUser = await prisma.user.upsert({
            where: { telegramId },
            update: {},
            create: { telegramId },
        });
        
        const bonusAvailable = !dbUser.lastBonusDate || !isToday(dbUser.lastBonusDate);
        
        res.json({
            clickBalance: dbUser.clickBalance,
            totalClicks: dbUser.totalClicks,
            dailyClicks: dbUser.dailyClicks,
            dailyLimit: 1000,
            referralCount: dbUser.referralCount,
            rank: getRank(dbUser.totalClicks),
            bonusAvailable,
            baseReward: await getCurrentReward(),
        });
    } catch (error) {
        console.error("❌ /api/me error:", error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/tap', async (req, res) => {
    try {
        const { initData, rawUser } = req.body;
        console.log("📥 /api/tap, initData length:", initData?.length || 0);
        
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });
        
        const dbUser = await prisma.user.findUnique({ where: { telegramId } });
        if (!dbUser) return res.status(404).json({ error: 'User not found' });
        
        const now = new Date();
        let dailyClicks = dbUser.dailyClicks;
        if (!isToday(dbUser.lastClickDate)) dailyClicks = 0;
        
        if (dailyClicks >= 1000) {
            return res.status(400).json({ error: 'Daily limit reached' });
        }
        
        let reward = 1.0;
        
        let bonusAvailable = !dbUser.lastBonusDate || !isToday(dbUser.lastBonusDate);
        if (bonusAvailable) {
            reward = reward * 2;
            await prisma.user.update({
                where: { telegramId },
                data: { lastBonusDate: now },
            });
        }
        
        const nft = await prisma.nFT.findFirst({
            where: { userId: dbUser.id, equipped: true }
        });
        if (nft) {
            reward = reward * nft.bonusMultiplier;
        }
        
        const updated = await prisma.user.update({
            where: { telegramId },
            data: {
                clickBalance: { increment: reward },
                totalClicks: { increment: 1 },
                dailyClicks: dailyClicks + 1,
                lastClickDate: now,
            },
        });
        
        res.json({
            clickBalance: updated.clickBalance,
            totalClicks: updated.totalClicks,
            dailyClicks: updated.dailyClicks,
            dailyLimit: 1000,
            referralCount: updated.referralCount,
            rank: getRank(updated.totalClicks),
            reward: reward,
        });
    } catch (error) {
        console.error("❌ /api/tap error:", error);
        res.status(500).json({ error: 'Server error' });
    }
});


// ── LEADERBOARD ──
app.get('/api/leaderboard', async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            orderBy: { totalClicks: 'desc' },
            take: 10,
            select: { telegramId: true, totalClicks: true, clickBalance: true }
        });
        res.json(users);
    } catch (e) {
        console.error('leaderboard error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/leaderboard/referral', async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            orderBy: { referralCount: 'desc' },
            take: 10,
            select: { telegramId: true, referralCount: true }
        });
        res.json(users);
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── NFT COUNT ──
app.post('/api/nftcount', async (req, res) => {
    try {
        const { initData, rawUser } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });
        const dbUser = await prisma.user.findUnique({
            where: { telegramId },
            include: { nfts: true }
        });
        if (!dbUser) return res.status(404).json({ error: 'User not found' });
        res.json({ count: dbUser.nfts.length, nfts: dbUser.nfts, tonWallet: dbUser.tonWallet || null });
    } catch (e) {
        console.error('nftcount error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// ── EQUIP / UNEQUIP ──
app.post('/api/equip', async (req, res) => {
    try {
        const { initData, rawUser, nftId } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });
        const dbUser = await prisma.user.findUnique({ where: { telegramId } });
        if (!dbUser) return res.status(404).json({ error: 'User not found' });
        await prisma.nFT.updateMany({ where: { userId: dbUser.id }, data: { equipped: false } });
        await prisma.nFT.update({ where: { id: Number(nftId) }, data: { equipped: true } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/unequip', async (req, res) => {
    try {
        const { initData, rawUser } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });
        const dbUser = await prisma.user.findUnique({ where: { telegramId } });
        if (!dbUser) return res.status(404).json({ error: 'User not found' });
        await prisma.nFT.updateMany({ where: { userId: dbUser.id }, data: { equipped: false } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── STAKE ──
app.post('/api/stake', async (req, res) => {
    try {
        const { initData, rawUser, nftId } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });
        const nft = await prisma.nFT.findUnique({ where: { id: Number(nftId) } });
        if (!nft) return res.status(404).json({ error: 'NFT not found' });
        const now = new Date();
        await prisma.nFT.update({
            where: { id: Number(nftId) },
            data: {
                staked: !nft.staked,
                stakeStartDate: !nft.staked ? now : null,
                stakeEndDate: null
            }
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── NFT WITHDRAW ──
app.post('/api/nft/withdraw', async (req, res) => {
    try {
        const { initData, rawUser, nftId } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });
        const dbUser = await prisma.user.findUnique({ where: { telegramId } });
        if (!dbUser) return res.status(404).json({ error: 'User not found' });
        if (!dbUser.tonWallet) return res.status(400).json({ error: 'Nema TON walleta. Poveži wallet prvo.' });
        const nft = await prisma.nFT.findUnique({ where: { id: Number(nftId) } });
        if (!nft || nft.userId !== dbUser.id) return res.status(403).json({ error: 'NFT nije tvoj' });
        await prisma.nFT.update({
            where: { id: Number(nftId) },
            data: { contractAddress: `withdraw:${dbUser.tonWallet}`, equipped: false, staked: false }
        });
        res.json({ success: true, message: 'Zahtjev primljen. Admin šalje u roku 24h.' });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── BOOST (koristi Boost model iz sheme) ──
app.post('/api/boost', async (req, res) => {
    try {
        const { initData, rawUser, action } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });
        const dbUser = await prisma.user.findUnique({ where: { telegramId } });
        if (!dbUser) return res.status(404).json({ error: 'User not found' });

        if (action === 'buy') {
            if (dbUser.clickBalance < 10) {
                return res.status(400).json({ error: 'Nedovoljno KVNC. Treba 10 KVNC.' });
            }
            // Provjeri postoji li aktivan boost
            const existing = await prisma.boost.findFirst({
                where: { userId: dbUser.id, active: true, expiresAt: { gt: new Date() } }
            });
            if (existing) {
                return res.json({ boostActive: true, boostEndsAt: existing.expiresAt, clickBalance: dbUser.clickBalance });
            }
            const boostEndsAt = new Date(Date.now() + 10 * 60 * 1000);
            await prisma.boost.create({
                data: { userId: dbUser.id, type: '2x', expiresAt: boostEndsAt, active: true }
            });
            const updated = await prisma.user.update({
                where: { telegramId },
                data: { clickBalance: { decrement: 10 } }
            });
            res.json({ boostActive: true, boostEndsAt, clickBalance: updated.clickBalance });
        } else {
            res.status(400).json({ error: 'Unknown action' });
        }
    } catch (e) {
        console.error('boost error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// ── WALLET ──
app.post('/api/wallet/connect', async (req, res) => {
    try {
        const { initData, rawUser, address } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });
        await prisma.user.update({ where: { telegramId }, data: { tonWallet: address } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/wallet/disconnect', async (req, res) => {
    try {
        const { initData, rawUser } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });
        await prisma.user.update({ where: { telegramId }, data: { tonWallet: null } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── QUESTS (dnevni, auto-create ako ne postoje) ──
app.get('/api/quests', async (req, res) => {
    try {
        const telegramId = req.query.telegramId as string;
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });
        const dbUser = await prisma.user.findUnique({ where: { telegramId } });
        if (!dbUser) return res.status(404).json({ error: 'User not found' });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Dohvati ili kreiraj dnevne questove
        const DAILY_QUESTS = [
            { type: 'clicks',    target: 100,  reward: 50  },
            { type: 'clicks',    target: 500,  reward: 200 },
            { type: 'referrals', target: 1,    reward: 100 },
        ];

        const quests = await Promise.all(DAILY_QUESTS.map(async (q) => {
            const existing = await prisma.quest.findFirst({
                where: { userId: dbUser.id, type: q.type, date: { gte: today } }
            });
            if (existing) return existing;
            return prisma.quest.create({
                data: { userId: dbUser.id, type: q.type, target: q.target, reward: q.reward, date: today }
            });
        }));

        // Ažuriraj progress za clicks questove
        const updatedQuests = await Promise.all(quests.map(async (q) => {
            if (q.type === 'clicks') {
                const progress = Math.min(dbUser.dailyClicks, q.target);
                const completed = progress >= q.target;
                if (progress !== q.progress || completed !== q.completed) {
                    return prisma.quest.update({
                        where: { id: q.id },
                        data: { progress, completed, completedAt: completed && !q.completed ? new Date() : q.completedAt }
                    });
                }
            }
            return q;
        }));

        res.json(updatedQuests);
    } catch (e) {
        console.error('quests error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});
