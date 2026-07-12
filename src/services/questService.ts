import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const QUEST_TYPES = {
    DAILY_CLICKS: { type: 'clicks', target: 500, reward: 50 },
    DAILY_REFERRALS: { type: 'referrals', target: 2, reward: 100 },
    DAILY_NFT: { type: 'nft', target: 1, reward: 200 },
};

export class QuestService {
    static async createDailyQuests(telegramId: string) {
        try {
            const user = await prisma.user.findUnique({
                where: { telegramId }
            });
            if (!user) return;

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            for (const [key, quest] of Object.entries(QUEST_TYPES)) {
                const existing = await prisma.$queryRaw`
                    SELECT * FROM quests 
                    WHERE user_id = ${user.id} 
                    AND type = ${quest.type} 
                    AND quest_date = ${today}
                    LIMIT 1
                `;

                if (!existing || (Array.isArray(existing) && existing.length === 0)) {
                    await prisma.$executeRaw`
                        INSERT INTO quests (user_id, type, target, reward, progress, completed, quest_date)
                        VALUES (${user.id}, ${quest.type}, ${quest.target}, ${quest.reward}, 0, false, ${today})
                    `;
                }
            }
        } catch (error) {
            console.error('❌ Quest creation error:', error);
        }
    }

    static async updateQuestProgress(telegramId: string, type: string, amount: number = 1) {
        try {
            const user = await prisma.user.findUnique({
                where: { telegramId }
            });
            if (!user) return null;

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const quest = await prisma.$queryRaw<any[]>`
                SELECT * FROM quests 
                WHERE user_id = ${user.id} 
                AND type = ${type} 
                AND quest_date = ${today}
                LIMIT 1
            `;

            if (!quest || quest.length === 0 || quest[0].completed) return null;

            const q = quest[0];
            const newProgress = q.progress + amount;
            const completed = newProgress >= q.target;

            await prisma.$executeRaw`
                UPDATE quests 
                SET progress = ${newProgress}, 
                    completed = ${completed},
                    completed_at = ${completed ? new Date() : null}
                WHERE id = ${q.id}
            `;

            if (completed) {
                await prisma.user.update({
                    where: { telegramId },
                    data: {
                        clickBalance: { increment: q.reward }
                    }
                });
            }

            return { ...q, progress: newProgress, completed };
        } catch (error) {
            console.error('❌ Quest update error:', error);
            return null;
        }
    }

    static async getTodayQuests(telegramId: string) {
        try {
            const user = await prisma.user.findUnique({
                where: { telegramId }
            });
            if (!user) return [];

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const quests = await prisma.$queryRaw<any[]>`
                SELECT * FROM quests 
                WHERE user_id = ${user.id} 
                AND quest_date = ${today}
            `;

            return quests || [];
        } catch (error) {
            console.error('❌ Get quests error:', error);
            return [];
        }
    }

    static async getCompletedQuests(telegramId: string) {
        try {
            const user = await prisma.user.findUnique({
                where: { telegramId }
            });
            if (!user) return [];

            const quests = await prisma.$queryRaw<any[]>`
                SELECT * FROM quests 
                WHERE user_id = ${user.id} 
                AND completed = true
            `;

            return quests || [];
        } catch (error) {
            console.error('❌ Get completed quests error:', error);
            return [];
        }
    }
}
