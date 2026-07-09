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

app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});
