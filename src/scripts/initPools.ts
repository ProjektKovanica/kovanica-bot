import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const POOLS = [
    { poolName: 'tap_base', totalAllocated: 350_000_000 },
    { poolName: 'nft_mint_rewards', totalAllocated: 100_000_000 },
    { poolName: 'referral_pool', totalAllocated: 50_000_000 },
    { poolName: 'dex_kvnc_gram', totalAllocated: 200_000_000 },
    { poolName: 'dex_kvnc_usdt', totalAllocated: 200_000_000 },
];

async function initPools() {
    console.log('🚀 Inicijalizacija pool-ova...');
    for (const pool of POOLS) {
        await prisma.poolTracking.upsert({
            where: { poolName: pool.poolName },
            update: {},
            create: {
                poolName: pool.poolName,
                totalAllocated: pool.totalAllocated,
                remaining: pool.totalAllocated,
            }
        });
        console.log(`✅ ${pool.poolName}: ${pool.totalAllocated.toLocaleString()} KVNC`);
    }
    console.log('✅ Svi pool-ovi su inicijalizirani!');
}

initPools()
    .then(() => console.log('✅ Inicijalizacija završena!'))
    .catch(console.error)
    .finally(() => prisma.$disconnect());
