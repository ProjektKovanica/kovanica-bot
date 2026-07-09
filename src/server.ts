import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import { createHash, createHmac } from 'crypto';
import { QuestService } from './services/questService.js';
import { WebSocketService } from './services/websocketService.js';
import { GameService } from './services/gameService.js';
import { DexService } from './services/dexService.js';
import { createServer } from 'http';

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
    if (totalClicks >= 100000) return "👑 Kralj rudara";
    if (totalClicks >= 50000) return "💎 Dijamantni rudar";
    if (totalClicks >= 20000) return "🔹 Platinasti rudar";
    if (totalClicks >= 10000) return "🥇 Zlatni rudar";
    if (totalClicks >= 5000) return "🥈 Srebrni rudar";
    if (totalClicks >= 2000) return "🥉 Brončani rudar";
    if (totalClicks >= 500) return "⛏️ Napredni rudar";
    if (totalClicks >= 100) return "⛏️ Početnik";
    return "🪨 Novi rudar";
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

// === API ENDPOINTI ===

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
            dailyLimit: 10000,
            referralCount: dbUser.referralCount,
            rank: getRank(dbUser.totalClicks),
            bonusAvailable,
        });
    } catch (error) {
        console.error("❌ /api/me error:", error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================
// ADMIN API
// ============================================

app.get('/api/admin/stats', async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [totalUsers, activeToday, totalClicks, pendingWithdrawals, totalNFTs, totalBalance] = await Promise.all([
            prisma.user.count(),
            prisma.user.count({ where: { lastClickDate: { gte: today } } }),
            prisma.user.aggregate({ _sum: { totalClicks: true } }),
            prisma.withdrawal.count({ where: { status: 'pending' } }),
            prisma.nFT.count(),
            prisma.user.aggregate({ _sum: { clickBalance: true } }),
        ]);

        res.json({
            totalUsers,
            activeToday,
            totalClicks: totalClicks._sum.totalClicks || 0,
            pendingWithdrawals,
            totalNFTs,
            totalBalance: totalBalance._sum.clickBalance || 0,
        });
    } catch (error) {
        console.error('❌ Admin stats error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/withdrawals', async (req, res) => {
    try {
        const withdrawals = await prisma.withdrawal.findMany({
            take: 20,
            orderBy: { requestedAt: 'desc' },
            include: { user: true }
        });
        res.json(withdrawals);
    } catch (error) {
        console.error('❌ Admin withdrawals error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/leaderboard', async (req, res) => {
    try {
        const top = await prisma.user.findMany({
            orderBy: { totalClicks: 'desc' },
            take: 10,
            select: {
                telegramId: true,
                totalClicks: true,
            }
        });
        res.json(top);
    } catch (error) {
        console.error('❌ Admin leaderboard error:', error);
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
        
        if (dailyClicks >= 10000) {
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
        
        await QuestService.updateQuestProgress(telegramId, 'clicks');
        
        res.json({
            clickBalance: updated.clickBalance,
            totalClicks: updated.totalClicks,
            dailyClicks: updated.dailyClicks,
            dailyLimit: 10000,
            referralCount: updated.referralCount,
            rank: getRank(updated.totalClicks),
            reward: reward,
        });
    } catch (error) {
        console.error("❌ /api/tap error:", error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/nftcount', async (req, res) => {
    try {
        const { initData, rawUser } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });

        const user = await prisma.user.findUnique({
            where: { telegramId },
            include: { nfts: true }
        });
        if (!user) return res.json({ count: 0 });

        res.json({ count: user.nfts.length });
    } catch (error) {
        console.error('❌ /api/nftcount error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        const totalUsers = await prisma.user.count();
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const activeUsers = await prisma.user.count({
            where: {
                lastClickDate: {
                    gte: today
                }
            }
        });
        
        const totalClicks = await prisma.user.aggregate({
            _sum: {
                totalClicks: true
            }
        });
        
        const totalBalance = await prisma.user.aggregate({
            _sum: {
                clickBalance: true
            }
        });
        
        const pools = await prisma.poolTracking.findMany();
        
        res.json({
            totalUsers,
            activeUsers,
            totalClicks: totalClicks._sum.totalClicks || 0,
            totalBalance: totalBalance._sum.clickBalance || 0,
            pools: pools.map(p => ({
                name: p.poolName,
                remaining: p.remaining,
                spent: p.spent,
                total: p.totalAllocated,
                usedPercent: ((p.spent / p.totalAllocated) * 100).toFixed(1)
            }))
        });
    } catch (error) {
        console.error('❌ /api/stats error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const topUsers = await prisma.user.findMany({
            orderBy: { totalClicks: "desc" },
            take: 10,
            select: {
                telegramId: true,
                totalClicks: true,
                clickBalance: true,
            }
        });
        
        res.json(topUsers);
    } catch (error) {
        console.error('❌ /api/leaderboard error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/quests', async (req, res) => {
    try {
        const { initData, rawUser } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });
        
        await QuestService.createDailyQuests(telegramId);
        const quests = await QuestService.getTodayQuests(telegramId);
        
        res.json(quests);
    } catch (error) {
        console.error('❌ /api/quests error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/achievements', async (req, res) => {
    try {
        const { initData, rawUser } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });

        const user = await prisma.user.findUnique({
            where: { telegramId },
            include: { nfts: true }
        });
        if (!user) return res.json([]);

        const achievements = [
            { type: 'clicks_100', name: '100 klikova', desc: 'Prvih 100 klikova', reward: 10, check: user.totalClicks >= 100 },
            { type: 'clicks_1000', name: '1000 klikova', desc: 'Tisuću klikova', reward: 50, check: user.totalClicks >= 1000 },
            { type: 'clicks_10000', name: '10000 klikova', desc: 'Deset tisuća klikova', reward: 200, check: user.totalClicks >= 10000 },
            { type: 'nft_first', name: 'Prvi NFT', desc: 'Iskopaj svoj prvi NFT', reward: 25, check: user.nfts.length >= 1 },
            { type: 'nft_5', name: '5 NFT-ova', desc: 'Iskopaj 5 NFT-ova', reward: 100, check: user.nfts.length >= 5 },
            { type: 'nft_all', name: 'Sve rijetkosti', desc: 'Iskopaj sve 5 rarity', reward: 500, check: new Set(user.nfts.map(n => n.rarity)).size >= 5 },
            { type: 'referral_5', name: '5 pozvanih', desc: 'Pozovi 5 prijatelja', reward: 75, check: user.referralCount >= 5 },
            { type: 'referral_20', name: '20 pozvanih', desc: 'Pozovi 20 prijatelja', reward: 300, check: user.referralCount >= 20 },
        ];

        const unlocked = await prisma.achievement.findMany({
            where: { userId: user.id }
        });
        const unlockedTypes = new Set(unlocked.map(a => a.type));

        const result = achievements.map(ach => ({
            ...ach,
            unlocked: unlockedTypes.has(ach.type)
        }));

        res.json(result);
    } catch (error) {
        console.error('❌ /api/achievements error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/spin', async (req, res) => {
    try {
        const { initData, rawUser } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });

        const user = await prisma.user.findUnique({
            where: { telegramId }
        });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const spin = await prisma.spin.findUnique({
            where: { userId: user.id }
        });

        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        if (spin && spin.lastSpin > oneDayAgo) {
            return res.json({
                available: false,
                nextSpin: new Date(spin.lastSpin.getTime() + 24 * 60 * 60 * 1000)
            });
        }

        const rewards = [
            { type: 'kvnc', min: 10, max: 100, weight: 60 },
            { type: 'kvnc', min: 200, max: 500, weight: 20 },
            { type: 'boost', value: 2, weight: 10 },
            { type: 'boost', value: 5, weight: 5 },
            { type: 'nft', value: 1, weight: 4 },
            { type: 'kvnc', min: 1000, max: 5000, weight: 1 },
        ];

        const totalWeight = rewards.reduce((s, r) => s + r.weight, 0);
        let rand = Math.random() * totalWeight;
        let chosen: any = rewards[0];
        for (const r of rewards) {
            rand -= r.weight;
            if (rand <= 0) { chosen = r; break; }
        }

        let rewardAmount = 0;
        let rewardType = chosen.type;

        if (chosen.type === 'kvnc' && chosen.min !== undefined && chosen.max !== undefined) {
            rewardAmount = Math.floor(Math.random() * (chosen.max - chosen.min + 1)) + chosen.min;
            await prisma.user.update({
                where: { telegramId },
                data: { clickBalance: { increment: rewardAmount } }
            });
        } else if (chosen.type === 'boost' && chosen.value !== undefined) {
            await prisma.boost.create({
                data: {
                    userId: user.id,
                    type: `${chosen.value}x`,
                    expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
                    active: true
                }
            });
            rewardAmount = chosen.value;
        } else if (chosen.type === 'nft') {
            rewardAmount = 1;
        }

        await prisma.spin.upsert({
            where: { userId: user.id },
            update: { lastSpin: now, reward: rewardAmount, rewardType: rewardType },
            create: { userId: user.id, lastSpin: now, reward: rewardAmount, rewardType: rewardType }
        });

        res.json({
            available: false,
            nextSpin: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            reward: rewardAmount,
            rewardType: rewardType
        });
    } catch (error) {
        console.error('❌ /api/spin error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/boost', async (req, res) => {
    try {
        const { initData, rawUser, action } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });

        const user = await prisma.user.findUnique({
            where: { telegramId }
        });
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (action === 'buy') {
            const cost = 10;
            if (user.clickBalance < cost) {
                return res.json({ error: `Nedovoljno KVNC. Treba ${cost} KVNC.` });
            }

            const existing = await prisma.boost.findFirst({
                where: {
                    userId: user.id,
                    active: true,
                    expiresAt: { gt: new Date() }
                }
            });
            if (existing) {
                return res.json({ error: 'Već imaš aktivan boost!' });
            }

            await prisma.$transaction([
                prisma.user.update({
                    where: { telegramId },
                    data: { clickBalance: { decrement: cost } }
                }),
                prisma.boost.create({
                    data: {
                        userId: user.id,
                        type: '2x',
                        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
                        active: true
                    }
                })
            ]);

            return res.json({ success: true, type: '2x' });
        }

        const boost = await prisma.boost.findFirst({
            where: {
                userId: user.id,
                active: true,
                expiresAt: { gt: new Date() }
            },
            orderBy: { expiresAt: 'desc' }
        });

        if (boost) {
            res.json({ active: true, type: boost.type, expiresAt: boost.expiresAt.getTime() });
        } else {
            res.json({ active: false });
        }
    } catch (error) {
        console.error('❌ /api/boost error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/vip', async (req, res) => {
    try {
        const { initData, rawUser } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });

        const user = await prisma.user.findUnique({
            where: { telegramId }
        });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const vip = await prisma.vIP.findFirst({
            where: {
                userId: user.id,
                active: true,
                expiresAt: { gt: new Date() }
            }
        });

        if (vip) {
            res.json({ active: true, level: vip.level, expiresAt: vip.expiresAt });
        } else {
            res.json({ active: false });
        }
    } catch (error) {
        console.error('❌ /api/vip error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// === GAME API ===

app.post('/api/game/rps', async (req, res) => {
    try {
        const { initData, rawUser, choice } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });

        const result = await GameService.playRPS(telegramId, choice);
        res.json(result);
    } catch (error) {
        console.error('❌ /api/game/rps error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/game/guess', async (req, res) => {
    try {
        const { initData, rawUser, guess } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });

        const result = await GameService.guessNumber(telegramId, guess);
        res.json(result);
    } catch (error) {
        console.error('❌ /api/game/guess error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/game/slot', async (req, res) => {
    try {
        const { initData, rawUser } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });

        const result = await GameService.playSlot(telegramId);
        res.json(result);
    } catch (error) {
        console.error('❌ /api/game/slot error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/game/trivia', async (req, res) => {
    try {
        const { initData, rawUser } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });

        const result = await GameService.playTrivia(telegramId);
        res.json(result);
    } catch (error) {
        console.error('❌ /api/game/trivia error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/game/coinflip', async (req, res) => {
    try {
        const { initData, rawUser, bet } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });

        const result = await GameService.playCoinFlip(telegramId, bet || 1);
        res.json(result);
    } catch (error) {
        console.error('❌ /api/game/coinflip error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/game/memory', async (req, res) => {
    try {
        const { initData, rawUser } = req.body;
        const telegramId = extractTelegramId(initData, rawUser);
        if (!telegramId) return res.status(401).json({ error: 'No user ID' });

        const result = await GameService.playMemory(telegramId);
        res.json(result);
    } catch (error) {
        console.error('❌ /api/game/memory error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// === DEX API ===

app.get('/api/price', async (req, res) => {
    try {
        const price = await DexService.getLivePrice(process.env.KVNC_JETTON_MASTER!);
        res.json(price);
    } catch (error) {
        console.error('❌ /api/price error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/pools', async (req, res) => {
    try {
        const pools = await DexService.getPools(process.env.KVNC_JETTON_MASTER!);
        res.json(pools);
    } catch (error) {
        console.error('❌ /api/pools error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/swap-link', async (req, res) => {
    try {
        const { to } = req.query;
        const link = DexService.getSwapLink(
            process.env.KVNC_JETTON_MASTER!,
            to as string || 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c'
        );
        res.json({ link });
    } catch (error) {
        console.error('❌ /api/swap-link error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// === WEB SOCKET ===
const server = createServer(app);
const wsService = new WebSocketService(server);

server.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`✅ WebSocket running on ws://localhost:${PORT}/ws`);
});
