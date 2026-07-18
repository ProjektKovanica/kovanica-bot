import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================
// SPIN NAGRADE
// ============================================
const SPIN_REWARDS = [
    { type: 'kvnc', min: 10, max: 50, weight: 40, label: '💰 10-50 KVNC' },
    { type: 'kvnc', min: 100, max: 500, weight: 20, label: '💰 100-500 KVNC' },
    { type: 'boost', value: 2, duration: 10, weight: 15, label: '⚡ 2x Boost (10 min)' },
    { type: 'boost', value: 5, duration: 30, weight: 10, label: '⚡ 5x Boost (30 min)' },
    { type: 'nft', rarity: 'Common', weight: 8, label: '🎨 Brončani NFT' },
    { type: 'nft', rarity: 'Rare', weight: 4, label: '🎨 Srebrni NFT' },
    { type: 'kvnc', min: 1000, max: 5000, weight: 2, label: '💰 1000-5000 KVNC' },
    { type: 'nothing', weight: 1, label: '😅 Ništa' },
];

function getRandomReward() {
    const totalWeight = SPIN_REWARDS.reduce((s, r) => s + r.weight, 0);
    let rand = Math.random() * totalWeight;
    for (const reward of SPIN_REWARDS) {
        rand -= reward.weight;
        if (rand <= 0) return reward;
    }
    return SPIN_REWARDS[0];
}

// ============================================
// API RUTE ZA SPIN
// ============================================
export function addSpinRoutes(app: any, bot: any, prisma: any) {
    // 1. GET /api/spin/status - provjera može li korisnik spinati
    app.get('/api/spin/status', async (req: any, res: any) => {
        try {
            const { telegramId } = req.query;
            if (!telegramId) return res.status(400).json({ error: 'No telegramId' });

            const user = await prisma.user.findUnique({ where: { telegramId: String(telegramId) } });
            if (!user) return res.status(404).json({ error: 'User not found' });

            const spin = await prisma.spin.findUnique({ where: { userId: user.id } });
            const now = new Date();
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

            if (spin && spin.lastSpin > oneDayAgo) {
                const nextSpin = new Date(spin.lastSpin.getTime() + 24 * 60 * 60 * 1000);
                return res.json({ available: false, nextSpin });
            }

            res.json({ available: true });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // 2. POST /api/spin - izvrši spin
    app.post('/api/spin', async (req: any, res: any) => {
        try {
            const { rawUser, initData } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'No user ID' });

            const user = await prisma.user.findUnique({ where: { telegramId } });
            if (!user) return res.status(404).json({ error: 'User not found' });

            const spin = await prisma.spin.findUnique({ where: { userId: user.id } });
            const now = new Date();
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

            if (spin && spin.lastSpin > oneDayAgo) {
                return res.status(400).json({ error: 'Već si spinovao danas!' });
            }

            // Odaberi nagradu
            const reward = getRandomReward();
            let rewardAmount = 0;
            let rewardType = reward.type;
            let rewardLabel = reward.label;

            // Izvrši nagradu
            if (reward.type === 'kvnc') {
                rewardAmount = Math.floor(Math.random() * (reward.max! - reward.min! + 1)) + reward.min!;
                await prisma.user.update({
                    where: { telegramId },
                    data: { clickBalance: { increment: rewardAmount } }
                });
            } else if (reward.type === 'boost') {
                rewardAmount = reward.value!;
                // Aktiviraj boost
                const expiresAt = new Date(now.getTime() + reward.duration! * 60 * 1000);
                await prisma.boost.create({
                    data: {
                        userId: user.id,
                        type: `${reward.value}x`,
                        expiresAt,
                        active: true
                    }
                });
            } else if (reward.type === 'nft') {
                // Mintaj NFT (jednostavna verzija)
                rewardAmount = 1;
                // Ovdje bi išao NFT mint, ali za sada samo spremi
                await prisma.nFT.create({
                    data: {
                        userId: user.id,
                        tokenId: 999, // placeholder
                        contractAddress: `spin:${Date.now()}`,
                        rarity: reward.rarity!,
                        name: `${reward.rarity} pijuk (Spin)`,
                        image: `https://kovanica.online/nft/${reward.rarity!.toLowerCase()}.png`,
                        bonusMultiplier: reward.rarity === 'Common' ? 1.2 : reward.rarity === 'Rare' ? 1.5 : 1.0,
                        mintReward: 0,
                        requiredClicks: 0,
                        maxSupply: 999,
                        stakingReward: 0.1,
                    }
                });
            }

            // Spremi spin u bazu
            await prisma.spin.upsert({
                where: { userId: user.id },
                update: { lastSpin: now, reward: rewardAmount, rewardType: rewardType },
                create: { userId: user.id, lastSpin: now, reward: rewardAmount, rewardType: rewardType }
            });

            res.json({
                success: true,
                reward: rewardAmount,
                rewardType: rewardType,
                rewardLabel: rewardLabel,
                nextSpin: new Date(now.getTime() + 24 * 60 * 60 * 1000)
            });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // Pomoćna funkcija za extractTelegramId
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

    // Bot komanda /spin
    bot.command("spin", async (ctx: any) => {
        if (!ctx.from) return ctx.reply("Nema korisnika!");
        const telegramId = String(ctx.from.id);
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return ctx.reply("Klikni /start prvo!");

        const spin = await prisma.spin.findUnique({ where: { userId: user.id } });
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        if (spin && spin.lastSpin > oneDayAgo) {
            const nextSpin = new Date(spin.lastSpin.getTime() + 24 * 60 * 60 * 1000);
            const hours = Math.floor((nextSpin.getTime() - now.getTime()) / 3600000);
            const mins = Math.floor(((nextSpin.getTime() - now.getTime()) % 3600000) / 60000);
            return ctx.reply(`⏳ Već si spinovao danas! Sljedeći spin za: ${hours}h ${mins}min`);
        }

        // Generiraj nagradu
        const reward = getRandomReward();
        let rewardAmount = 0;
        let rewardType = reward.type;
        let rewardLabel = reward.label;

        if (reward.type === 'kvnc') {
            rewardAmount = Math.floor(Math.random() * (reward.max! - reward.min! + 1)) + reward.min!;
            await prisma.user.update({
                where: { telegramId },
                data: { clickBalance: { increment: rewardAmount } }
            });
        } else if (reward.type === 'boost') {
            rewardAmount = reward.value!;
            const expiresAt = new Date(now.getTime() + reward.duration! * 60 * 1000);
            await prisma.boost.create({
                data: {
                    userId: user.id,
                    type: `${reward.value}x`,
                    expiresAt,
                    active: true
                }
            });
        } else if (reward.type === 'nft') {
            rewardAmount = 1;
            await prisma.nFT.create({
                data: {
                    userId: user.id,
                    tokenId: 999,
                    contractAddress: `spin:${Date.now()}`,
                    rarity: reward.rarity!,
                    name: `${reward.rarity} pijuk (Spin)`,
                    image: `https://kovanica.online/nft/${reward.rarity!.toLowerCase()}.png`,
                    bonusMultiplier: reward.rarity === 'Common' ? 1.2 : reward.rarity === 'Rare' ? 1.5 : 1.0,
                    mintReward: 0,
                    requiredClicks: 0,
                    maxSupply: 999,
                    stakingReward: 0.1,
                }
            });
        }

        await prisma.spin.upsert({
            where: { userId: user.id },
            update: { lastSpin: now, reward: rewardAmount, rewardType: rewardType },
            create: { userId: user.id, lastSpin: now, reward: rewardAmount, rewardType: rewardType }
        });

        await ctx.reply(
            `🎡 **KOTAČ SREĆE** 🎡\n\n` +
            `🎁 Dobio si: **${rewardLabel}**\n` +
            `${rewardAmount > 0 ? `💰 Nagrada: ${rewardAmount} KVNC` : ''}\n\n` +
            `⏳ Sljedeći spin za 24h!`
        );
    });

    console.log('✅ Daily Spin dodat!');
}
