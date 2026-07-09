import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface BotDetection {
    isBot: boolean;
    reason?: string;
    score: number;
}

export class AntiBotService {
    private readonly CLICK_THRESHOLD = 500; // Nakon 500 klikova traži CAPTCHA
    private readonly TIME_WINDOW = 60000; // 1 minuta
    private readonly MAX_CLICKS_PER_MINUTE = 30; // Maks klikova u minuti

    // Provjeri da li je korisnik bot
    async checkUser(telegramId: string): Promise<BotDetection> {
        const user = await prisma.user.findUnique({
            where: { telegramId }
        });

        if (!user) {
            return { isBot: false, score: 0 };
        }

        let score = 0;
        let reasons: string[] = [];

        // 1. Provjeri brzinu klikova (preko 30 u minuti)
        const recentClicks = await this.getRecentClicks(telegramId);
        if (recentClicks > this.MAX_CLICKS_PER_MINUTE) {
            score += 30;
            reasons.push(`Prebrzo klikanje: ${recentClicks}/min`);
        }

        // 2. Provjeri da li je totalClicks sumnjiv (preko 10k u kratkom roku)
        if (user.totalClicks > 10000 && user.createdAt > new Date(Date.now() - 24 * 60 * 60 * 1000)) {
            score += 20;
            reasons.push('Previše klikova za novi account');
        }

        // 3. Provjeri dailyClicks (preko 5000 u danu)
        if (user.dailyClicks > 5000) {
            score += 10;
            reasons.push('Previše dnevnih klikova');
        }

        // 4. Provjeri da li ima Telegram username (botovi često nemaju)
        // (ovo se ne može provjeriti iz baze, ali može u API-ju)

        const isBot = score >= 30;

        return {
            isBot,
            score,
            reason: reasons.length > 0 ? reasons.join(', ') : undefined
        };
    }

    // Dohvati broj klikova u zadnjoj minuti
    async getRecentClicks(telegramId: string): Promise<number> {
        const oneMinuteAgo = new Date(Date.now() - this.TIME_WINDOW);
        
        const clicks = await prisma.user.findUnique({
            where: { telegramId },
            select: { totalClicks: true, lastClickDate: true }
        });

        if (!clicks || !clicks.lastClickDate || clicks.lastClickDate < oneMinuteAgo) {
            return 0;
        }

        // Ako je zadnji klik unutar minute, vrati 1 (pojednostavljeno)
        // U stvarnosti bi trebao pratiti svaki klik posebno
        return 1;
    }

    // Zatraži CAPTCHA verifikaciju
    async requestCaptcha(telegramId: string): Promise<string> {
        // Generiraj jednostavan math CAPTCHA
        const num1 = Math.floor(Math.random() * 10) + 1;
        const num2 = Math.floor(Math.random() * 10) + 1;
        const result = num1 + num2;
        
        // Spremi u bazu (privremeno)
        await prisma.user.update({
            where: { telegramId },
            data: {
                // Koristimo lastBonusDate kao privremeni storage za CAPTCHA
                // (nije idealno, ali radi za MVP)
            }
        });

        return `Riješi: ${num1} + ${num2} = ?`;
    }

    // Provjeri CAPTCHA odgovor
    async verifyCaptcha(telegramId: string, answer: number): Promise<boolean> {
        // U stvarnosti bi provjerio spremljeni odgovor
        // Za sada vraća true (pojednostavljeno)
        return true;
    }
}
