import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class AntiBotService {
    private readonly CLICK_THRESHOLD = 500;
    private readonly TIME_WINDOW = 60000;
    private readonly MAX_CLICKS_PER_MINUTE = 30;

    async checkUser(telegramId: string): Promise<{ isBot: boolean; score: number; reason?: string }> {
        const user = await prisma.user.findUnique({
            where: { telegramId }
        });

        if (!user) {
            return { isBot: false, score: 0 };
        }

        let score = 0;
        let reasons: string[] = [];

        const recentClicks = await this.getRecentClicks(telegramId);
        if (recentClicks > this.MAX_CLICKS_PER_MINUTE) {
            score += 30;
            reasons.push(`Prebrzo klikanje: ${recentClicks}/min`);
        }

        if (user.totalClicks > 10000 && user.createdAt > new Date(Date.now() - 24 * 60 * 60 * 1000)) {
            score += 20;
            reasons.push('Previše klikova za novi account');
        }

        if (user.dailyClicks > 5000) {
            score += 10;
            reasons.push('Previše dnevnih klikova');
        }

        const isBot = score >= 30;

        return {
            isBot,
            score,
            reason: reasons.length > 0 ? reasons.join(', ') : undefined
        };
    }

    async getRecentClicks(telegramId: string): Promise<number> {
        const oneMinuteAgo = new Date(Date.now() - this.TIME_WINDOW);
        
        const clicks = await prisma.user.findUnique({
            where: { telegramId },
            select: { totalClicks: true, lastClickDate: true }
        });

        if (!clicks || !clicks.lastClickDate || clicks.lastClickDate < oneMinuteAgo) {
            return 0;
        }

        return 1;
    }

    async requestCaptcha(telegramId: string): Promise<string> {
        const num1 = Math.floor(Math.random() * 10) + 1;
        const num2 = Math.floor(Math.random() * 10) + 1;
        return `Riješi: ${num1} + ${num2} = ?`;
    }

    async verifyCaptcha(telegramId: string, answer: number): Promise<boolean> {
        return true;
    }
}
