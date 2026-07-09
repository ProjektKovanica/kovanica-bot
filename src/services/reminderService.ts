import cron from 'node-cron';
import { Bot } from 'grammy';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class ReminderService {
    private bot: Bot;
    
    constructor(bot: Bot) {
        this.bot = bot;
    }
    
    start() {
        // Svaki dan u 9:00
        cron.schedule('0 9 * * *', async () => {
            console.log('⏰ Šaljem daily reminder...');
            await this.sendDailyReminder();
        });
        
        // Svaki dan u 18:00
        cron.schedule('0 18 * * *', async () => {
            console.log('⏰ Šaljem afternoon reminder...');
            await this.sendAfternoonReminder();
        });
    }
    
    async sendDailyReminder() {
        try {
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            
            const users = await prisma.user.findMany({
                where: {
                    lastClickDate: {
                        gte: weekAgo
                    }
                }
            });
            
            console.log(`📤 Šaljem reminder za ${users.length} korisnika`);
            
            for (const user of users) {
                try {
                    await this.bot.api.sendMessage(
                        parseInt(user.telegramId),
                        `⛏️ **Vrijeme je za rudarenje!** ⛏️\n\n` +
                        `💰 Trenutni balans: ${user.clickBalance} KVNC\n` +
                        `👆 Dnevni limit: 1000 klikova\n` +
                        `⭐ Prvi klik danas donosi 2x nagradu!\n\n` +
                        `🔽 Klikni ovdje: /start`
                    );
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (e) {
                    // preskoči
                }
            }
        } catch (error) {
            console.error('❌ Greška pri slanju reminder-a:', error);
        }
    }
    
    async sendAfternoonReminder() {
        try {
            const users = await prisma.user.findMany({
                where: {
                    dailyClicks: {
                        lt: 500
                    },
                    lastClickDate: {
                        gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
                    }
                }
            });
            
            for (const user of users) {
                try {
                    await this.bot.api.sendMessage(
                        parseInt(user.telegramId),
                        `⛏️ **Popodnevni rudarski poziv!** ⛏️\n\n` +
                        `Danas si iskoristio ${user.dailyClicks} od 1000 klikova.\n` +
                        `Iskoristi preostalih ${1000 - user.dailyClicks} klikova!\n\n` +
                        `🔥 Prvi klik danas donosi 2x nagradu!\n` +
                        `🔽 /start`
                    );
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (e) {
                    // preskoči
                }
            }
        } catch (error) {
            console.error('❌ Greška pri slanju afternoon reminder-a:', error);
        }
    }
}
