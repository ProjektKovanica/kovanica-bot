import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const QUEST_TYPES = {
    DAILY_CLICKS: { type: 'clicks', target: 500, reward: 50 },
    DAILY_REFERRALS: { type: 'referrals', target: 2, reward: 100 },
    DAILY_NFT: { type: 'nft', target: 1, reward: 200 },
};

function startOfToday(): Date {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}

export class QuestService {
    static async createDailyQuests(telegramId: string) {
        try {
            const user = await prisma.user.findUnique({
                where: { telegramId }
            });
            if (!user) return;

            const questDate = startOfToday();

            for (const quest of Object.values(QUEST_TYPES)) {
                const existing = await prisma.quest.findUnique({
                    where: {
                        userId_type_questDate: {
                            userId: user.id,
                            type: quest.type,
                            questDate,
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
                            questDate,
                        }
                    });
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

            const questDate = startOfToday();

            const quest = await prisma.quest.findUnique({
                where: {
                    userId_type_questDate: {
                        userId: user.id,
                        type,
                        questDate,
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
                    completed,
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

            return await prisma.quest.findMany({
                where: {
                    userId: user.id,
                    questDate: startOfToday(),
                }
            });
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

            return await prisma.quest.findMany({
                where: {
                    userId: user.id,
                    completed: true,
                }
            });
        } catch (error) {
            console.error('❌ Get completed quests error:', error);
            return [];
        }
    }
}
