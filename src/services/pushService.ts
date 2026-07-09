import { Bot } from 'grammy';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class PushService {
    private bot: Bot;

    constructor(bot: Bot) {
        this.bot = bot;
    }

    async notifyNewNFT(userId: string, nft: any) {
        try {
            await this.bot.api.sendMessage(
                parseInt(userId),
                `🎉 **ISKOPAO SI NFT!** 🎉\n\n` +
                `**${nft.name}** (${nft.rarity})\n` +
                `⭐ Bonus: ${nft.bonusMultiplier}x\n` +
                `💰 Nagrada: +${nft.mintReward} KVNC\n\n` +
                `💡 /equip ${nft.id} - Opremi za bonus\n` +
                `💡 /stake ${nft.id} - Stake-aj za pasivnu zaradu`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('❌ Push notification error:', error);
        }
    }

    async notifyQuestComplete(userId: string, quest: any) {
        try {
            await this.bot.api.sendMessage(
                parseInt(userId),
                `✅ **Quest dovršen!** ✅\n\n` +
                `📋 ${quest.type}\n` +
                `💰 Nagrada: +${quest.reward} KVNC\n\n` +
                `🔥 Nastavi rudariti za više nagrada!`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('❌ Quest notification error:', error);
        }
    }

    async notifyAchievement(userId: string, achievement: any) {
        try {
            await this.bot.api.sendMessage(
                parseInt(userId),
                `🏅 **NOVO POSTIGNUĆE!** 🏅\n\n` +
                `**${achievement.name}**\n` +
                `${achievement.description}\n` +
                `💰 Nagrada: +${achievement.reward} KVNC\n\n` +
                `🎯 Nastavi skupljati sva postignuća!`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('❌ Achievement notification error:', error);
        }
    }

    async notifyDailyBonus(userId: string, bonus: number) {
        try {
            await this.bot.api.sendMessage(
                parseInt(userId),
                `⭐️ **Daily Bonus!** ⭐️\n\n` +
                `💰 +${bonus} KVNC (2x)\n` +
                `🔥 Iskoristi ga dok traje!`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('❌ Daily bonus notification error:', error);
        }
    }

    async notifyWithdrawal(userId: string, amount: number, txHash: string) {
        try {
            await this.bot.api.sendMessage(
                parseInt(userId),
                `💸 **Isplata uspješna!** 💸\n\n` +
                `💰 Iznos: ${amount} KVNC\n` +
                `🆔 TX: ${txHash.slice(0, 20)}...\n\n` +
                `💎 Hvala što rudariš s Kovanicom!`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('❌ Withdrawal notification error:', error);
        }
    }
}
