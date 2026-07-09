import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const QUEST_TYPES = {
    DAILY_CLICKS: { type: 'clicks', target: 500, reward: 50 },
    DAILY_REFERRALS: { type: 'referrals', target: 2, reward: 100 },
    DAILY_NFT: { type: 'nft', target: 1, reward: 200 },
};

export class QuestService {
    static async createDailyQuests(telegramId: string) {
        const user = await prisma.user.findUnique({
            where: { telegramId }
        });
        if (!user) return;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const [key, quest] of Object.entries(QUEST_TYPES)) {
            const existing = await prisma.quest.findUnique({
                where: {
                    userId_type_date: {
                        userId: user.id,
                        type: quest.type,
                        date: today,
                    }
                }
            });

            if (!existing) {
                await prisma.quest.create({
                    data: {
                        userId: user.id,
                        type: quest.type,
                        target: quest.target,
                        reward: quest.reward,
                        progress: 0,
                        completed: false,
                        date: today,
                    }
                });
            }
        }
    }

    static async updateQuestProgress(telegramId: string, type: string, amount: number = 1) {
        const user = await prisma.user.findUnique({
            where: { telegramId }
        });
        if (!user) return null;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const quest = await prisma.quest.findUnique({
            where: {
                userId_type_date: {
                    userId: user.id,
                    type: type,
                    date: today,
                }
            }
        });

        if (!quest || quest.completed) return null;

        const newProgress = quest.progress + amount;
        const completed = newProgress >= quest.target;

        const updated = await prisma.quest.update({
            where: { id: quest.id },
            data: {
                progress: newProgress,
                completed: completed,
                completedAt: completed ? new Date() : null,
            }
        });

        if (completed) {
            await prisma.user.update({
                where: { telegramId },
                data: {
                    clickBalance: { increment: quest.reward }
                }
            });
        }

        return updated;
    }

    static async getTodayQuests(telegramId: string) {
        const user = await prisma.user.findUnique({
            where: { telegramId }
        });
        if (!user) return [];

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return await prisma.quest.findMany({
            where: {
                userId: user.id,
                date: today,
            }
        });
    }

    static async getCompletedQuests(telegramId: string) {
        const user = await prisma.user.findUnique({
            where: { telegramId }
        });
        if (!user) return [];

        return await prisma.quest.findMany({
            where: {
                userId: user.id,
                completed: true,
            }
        });
    }
}
