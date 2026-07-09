import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const AIRDROP_AMOUNT = 100;
const MAX_USERS = 1000;

async function runAirdrop() {
    console.log('🎁 Pokrećem Airdrop...');
    
    const users = await prisma.user.findMany({
        orderBy: { createdAt: 'asc' },
        take: MAX_USERS,
        select: { id: true, telegramId: true, clickBalance: true }
    });
    
    console.log(`📊 Pronađeno ${users.length} korisnika za airdrop`);
    
    let totalSent = 0;
    
    for (const user of users) {
        try {
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    clickBalance: { increment: AIRDROP_AMOUNT }
                }
            });
            totalSent += AIRDROP_AMOUNT;
            
            if (users.indexOf(user) % 100 === 0) {
                console.log(`✅ Obrađeno ${users.indexOf(user) + 1} korisnika`);
            }
        } catch (error) {
            console.error(`❌ Greška za korisnika ${user.id}:`, error);
        }
    }
    
    console.log(`🎉 Airdrop završen!`);
    console.log(`💰 Ukupno poslano: ${totalSent} KVNC`);
    console.log(`👥 Broj korisnika: ${users.length}`);
}

runAirdrop()
    .then(() => console.log('✅ Airdrop uspješan!'))
    .catch(console.error)
    .finally(() => prisma.$disconnect());
