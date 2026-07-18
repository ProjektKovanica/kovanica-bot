import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export function spinRoutes(router: any, bot: any, extractTelegramId: any) {

    // GET /api/spin/status
    router.get('/api/spin/status', async (req: any, res: any) => {
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

    // POST /api/spin
    router.post('/api/spin', async (req: any, res: any) => {
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

            const rewards = [
                { type: 'kvnc', min: 10, max: 50, weight: 40, label: '💰 10-50 KVNC' },
                { type: 'kvnc', min: 100, max: 500, weight: 20, label: '💰 100-500 KVNC' },
                { type: 'boost', value: 2, duration: 10, weight: 15, label: '⚡ 2x Boost (10 min)' },
                { type: 'boost', value: 5, duration: 30, weight: 10, label: '⚡ 5x Boost (30 min)' },
                { type: 'nft', rarity: 'Common', weight: 8, label: '🎨 Brončani NFT' },
                { type: 'nft', rarity: 'Rare', weight: 4, label: '🎨 Srebrni NFT' },
                { type: 'kvnc', min: 1000, max: 5000, weight: 2, label: '💰 1000-5000 KVNC' },
                { type: 'nothing', weight: 1, label: '😅 Ništa' },
            ];

            const totalWeight = rewards.reduce((s, r) => s + r.weight, 0);
            let rand = Math.random() * totalWeight;
            let chosen = rewards[0];
            for (const r of rewards) {
                rand -= r.weight;
                if (rand <= 0) { chosen = r; break; }
            }

            let rewardAmount = 0;
            let rewardType = chosen.type;
            let rewardLabel = chosen.label;

            if (chosen.type === 'kvnc' && chosen.min && chosen.max) {
                rewardAmount = Math.floor(Math.random() * (chosen.max - chosen.min + 1)) + chosen.min;
                await prisma.user.update({
                    where: { telegramId },
                    data: { clickBalance: { increment: rewardAmount } }
                });
            } else if (chosen.type === 'boost' && chosen.value) {
                rewardAmount = chosen.value;
                const expiresAt = new Date(now.getTime() + (chosen.duration || 10) * 60 * 1000);
                await prisma.boost.create({
                    data: {
                        userId: user.id,
                        type: `${chosen.value}x`,
                        expiresAt: expiresAt,
                        active: true
                    }
                });
            } else if (chosen.type === 'nft' && chosen.rarity) {
                rewardAmount = 1;
                const bonus = chosen.rarity === 'Common' ? 1.2 : chosen.rarity === 'Rare' ? 1.5 : 1.0;
                await prisma.nFT.create({
                    data: {
                        userId: user.id,
                        tokenId: 999 + Math.floor(Math.random() * 1000),
                        contractAddress: 'spin:' + Date.now(),
                        rarity: chosen.rarity,
                        name: chosen.rarity + ' pijuk (Spin)',
                        image: 'https://kovanica.online/nft/' + chosen.rarity.toLowerCase() + '.png',
                        bonusMultiplier: bonus,
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

    // Bot komanda /spin
    bot.command("spin", async (ctx: any) => {
        if (!ctx.from) {
            await ctx.reply("Nema korisnika!");
            return;
        }
        const telegramId = String(ctx.from.id);
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) {
            await ctx.reply("Klikni /start prvo!");
            return;
        }

        const spin = await prisma.spin.findUnique({ where: { userId: user.id } });
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        if (spin && spin.lastSpin > oneDayAgo) {
            const nextSpin = new Date(spin.lastSpin.getTime() + 24 * 60 * 60 * 1000);
            const hours = Math.floor((nextSpin.getTime() - now.getTime()) / 3600000);
            const mins = Math.floor(((nextSpin.getTime() - now.getTime()) % 3600000) / 60000);
            await ctx.reply(`⏳ Već si spinovao danas! Sljedeći spin za: ${hours}h ${mins}min`);
            return;
        }

        const rewards = [
            { type: 'kvnc', min: 10, max: 50, weight: 40, label: '💰 10-50 KVNC' },
            { type: 'kvnc', min: 100, max: 500, weight: 20, label: '💰 100-500 KVNC' },
            { type: 'boost', value: 2, duration: 10, weight: 15, label: '⚡ 2x Boost (10 min)' },
            { type: 'boost', value: 5, duration: 30, weight: 10, label: '⚡ 5x Boost (30 min)' },
            { type: 'nft', rarity: 'Common', weight: 8, label: '🎨 Brončani NFT' },
            { type: 'nft', rarity: 'Rare', weight: 4, label: '🎨 Srebrni NFT' },
            { type: 'kvnc', min: 1000, max: 5000, weight: 2, label: '💰 1000-5000 KVNC' },
            { type: 'nothing', weight: 1, label: '😅 Ništa' },
        ];

        const totalWeight = rewards.reduce((s, r) => s + r.weight, 0);
        let rand = Math.random() * totalWeight;
        let chosen = rewards[0];
        for (const r of rewards) {
            rand -= r.weight;
            if (rand <= 0) { chosen = r; break; }
        }

        let rewardAmount = 0;
        let rewardLabel = chosen.label;

        if (chosen.type === 'kvnc' && chosen.min && chosen.max) {
            rewardAmount = Math.floor(Math.random() * (chosen.max - chosen.min + 1)) + chosen.min;
            await prisma.user.update({
                where: { telegramId },
                data: { clickBalance: { increment: rewardAmount } }
            });
        } else if (chosen.type === 'boost' && chosen.value) {
            rewardAmount = chosen.value;
            const expiresAt = new Date(now.getTime() + (chosen.duration || 10) * 60 * 1000);
            await prisma.boost.create({
                data: {
                    userId: user.id,
                    type: `${chosen.value}x`,
                    expiresAt: expiresAt,
                    active: true
                }
            });
        } else if (chosen.type === 'nft' && chosen.rarity) {
            rewardAmount = 1;
            const bonus = chosen.rarity === 'Common' ? 1.2 : chosen.rarity === 'Rare' ? 1.5 : 1.0;
            await prisma.nFT.create({
                data: {
                    userId: user.id,
                    tokenId: 999 + Math.floor(Math.random() * 1000),
                    contractAddress: 'spin:' + Date.now(),
                    rarity: chosen.rarity,
                    name: chosen.rarity + ' pijuk (Spin)',
                    image: 'https://kovanica.online/nft/' + chosen.rarity.toLowerCase() + '.png',
                    bonusMultiplier: bonus,
                    mintReward: 0,
                    requiredClicks: 0,
                    maxSupply: 999,
                    stakingReward: 0.1,
                }
            });
        }

        await prisma.spin.upsert({
            where: { userId: user.id },
            update: { lastSpin: now, reward: rewardAmount, rewardType: chosen.type },
            create: { userId: user.id, lastSpin: now, reward: rewardAmount, rewardType: chosen.type }
        });

        await ctx.reply(
            `🎡 **KOTAČ SREĆE** 🎡\n\n` +
            `🎁 Dobio si: **${rewardLabel}**\n` +
            `${rewardAmount > 0 ? `💰 Nagrada: ${rewardAmount} KVNC` : ''}\n\n` +
            `⏳ Sljedeći spin za 24h!`
        );
    });

    console.log('✅ Spin rute registrirane!');
}
