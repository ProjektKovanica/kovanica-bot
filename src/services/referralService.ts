import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class ReferralService {
    // Nagrade po nivou
    private readonly REWARDS = {
        LEVEL_1: 10,  // Direktan referral
        LEVEL_2: 5,   // Referral od referrala
        LEVEL_3: 2,   // Treći nivo
    };

    // Dodaj novog korisnika i dodijeli nagrade svim nivovima
    async addReferral(newUserId: number, referrerId: number) {
        const referrer = await prisma.user.findUnique({
            where: { id: referrerId },
            include: { referredByUser: true }
        });

        if (!referrer) return;

        // LEVEL 1: Direktan referral
        await prisma.user.update({
            where: { id: referrerId },
            data: {
                clickBalance: { increment: this.REWARDS.LEVEL_1 },
                referralCount: { increment: 1 }
            }
        });

        // LEVEL 2: Referrerov referrer
        if (referrer.referredBy) {
            const level2Referrer = await prisma.user.findUnique({
                where: { id: referrer.referredBy }
            });
            if (level2Referrer) {
                await prisma.user.update({
                    where: { id: level2Referrer.id },
                    data: {
                        clickBalance: { increment: this.REWARDS.LEVEL_2 }
                    }
                });
            }

            // LEVEL 3: Referrerov referrerov referrer
            if (level2Referrer?.referredBy) {
                const level3Referrer = await prisma.user.findUnique({
                    where: { id: level2Referrer.referredBy }
                });
                if (level3Referrer) {
                    await prisma.user.update({
                        where: { id: level3Referrer.id },
                        data: {
                            clickBalance: { increment: this.REWARDS.LEVEL_3 }
                        }
                    });
                }
            }
        }
    }

    // Dohvati referral tree za korisnika
    async getReferralTree(telegramId: string) {
        const user = await prisma.user.findUnique({
            where: { telegramId },
            include: {
                referrals: {
                    include: {
                        referrals: {
                            include: {
                                referrals: true
                            }
                        }
                    }
                }
            }
        });

        if (!user) return null;

        return {
            direct: user.referrals.length,
            indirect: user.referrals.reduce((acc, r) => acc + r.referrals.length, 0),
            total: user.referralCount
        };
    }

    // Dohvati leaderboard za referale
    async getReferralLeaderboard(limit: number = 10) {
        return await prisma.user.findMany({
            orderBy: { referralCount: 'desc' },
            take: limit,
            select: {
                telegramId: true,
                referralCount: true,
                clickBalance: true
            }
        });
    }
}
