import { PrismaClient } from '@prisma/client';
import cron from 'node-cron';
import { Bot } from 'grammy';

const prisma = new PrismaClient();

export class AnalyticsService {
    private bot: Bot;
    private adminId: string;

    constructor(bot: Bot) {
        this.bot = bot;
        this.adminId = process.env.OWNER_ID || '';
        this.startDailyReport();
    }

    startDailyReport() {
        // Svaki dan u 8:00
        cron.schedule('0 8 * * *', async () => {
            await this.sendDailyReport();
        });
    }

    async sendDailyReport() {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            // Ukupni korisnici
            const totalUsers = await prisma.user.count();

            // Aktivni danas
            const activeToday = await prisma.user.count({
                where: {
                    lastClickDate: {
                        gte: today
                    }
                }
            });

            // Ukupno klikova danas
            const clicksToday = await prisma.user.aggregate({
                where: {
                    lastClickDate: {
                        gte: today
                    }
                },
                _sum: {
                    totalClicks: true
                }
            });

            // Novi korisnici danas
            const newUsersToday = await prisma.user.count({
                where: {
                    createdAt: {
                        gte: today
                    }
                }
            });

            // Ukupan broj NFT-ova
            const totalNFTs = await prisma.nFT.count();

            // Potrošnja po pool-ovima
            const pools = await prisma.poolTracking.findMany();

            // Pending isplate
            const pendingWithdrawals = await prisma.withdrawal.count({
                where: { status: 'pending' }
            });

            let message = '📊 **Dnevni izvještaj** 📊\n\n';
            message += `👥 **Korisnici:**\n`;
            message += `  Ukupno: ${totalUsers}\n`;
            message += `  Aktivni danas: ${activeToday}\n`;
            message += `  Novi danas: ${newUsersToday}\n\n`;

            message += `👆 **Klikovi:**\n`;
            message += `  Danas: ${clicksToday._sum.totalClicks || 0}\n\n`;

            message += `🎨 **NFT:**\n`;
            message += `  Ukupno iskopano: ${totalNFTs}\n\n`;

            message += `💸 **Isplate:**\n`;
            message += `  Na čekanju: ${pendingWithdrawals}\n\n`;

            message += `💧 **Pool-ovi:**\n`;
            for (const pool of pools) {
                const usedPercent = ((pool.spent / pool.totalAllocated) * 100).toFixed(1);
                const emoji = pool.poolName === 'tap_base' ? '⛏️' :
                              pool.poolName === 'nft_mint_rewards' ? '🎨' :
                              pool.poolName === 'referral_pool' ? '👥' :
                              pool.poolName === 'dex_kvnc_gram' ? '💧' :
                              pool.poolName === 'dex_kvnc_usdt' ? '💧' : '📦';
                message += `  ${emoji} ${pool.poolName}: ${usedPercent}% potrošeno\n`;
            }

            message += `\n📅 ${new Date().toLocaleDateString()}`;

            await this.bot.api.sendMessage(parseInt(this.adminId), message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('❌ Greška pri slanju daily report-a:', error);
        }
    }

    // Dohvati statistike za admina
    async getStats() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const totalUsers = await prisma.user.count();
        const activeToday = await prisma.user.count({
            where: { lastClickDate: { gte: today } }
        });
        const totalClicks = await prisma.user.aggregate({
            _sum: { totalClicks: true }
        });
        const totalNFTs = await prisma.nFT.count();
        const pendingWithdrawals = await prisma.withdrawal.count({
            where: { status: 'pending' }
        });
        const pools = await prisma.poolTracking.findMany();

        return {
            totalUsers,
            activeToday,
            totalClicks: totalClicks._sum.totalClicks || 0,
            totalNFTs,
            pendingWithdrawals,
            pools: pools.map(p => ({
                name: p.poolName,
                remaining: p.remaining,
                spent: p.spent,
                total: p.totalAllocated,
                usedPercent: ((p.spent / p.totalAllocated) * 100).toFixed(1)
            }))
        };
    }
}
