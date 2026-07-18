import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const POOLS_CONFIG = {
  tap_base: { totalAllocated: 500_000_000 },
  nft_mint_rewards: { totalAllocated: 50_000_000 },
  referral_pool: { totalAllocated: 20_000_000 },
  dex_kvnc_gram: { totalAllocated: 100_000_000 },
  dex_kvnc_usdt: { totalAllocated: 100_000_000 },
  marketing: { totalAllocated: 30_000_000 },
  development: { totalAllocated: 20_000_000 },
  liquidity_rewards: { totalAllocated: 80_000_000 },
  staking_rewards: { totalAllocated: 100_000_000 },
};

async function initPools() {
  console.log('🔄 Inicijaliziram pool-ove...');
  for (const [name, config] of Object.entries(POOLS_CONFIG)) {
    const existing = await prisma.poolTracking.findUnique({ where: { poolName: name } });
    if (!existing) {
      await prisma.poolTracking.create({
        data: {
          poolName: name,
          totalAllocated: config.totalAllocated,
          spent: 0,
          remaining: config.totalAllocated,
        },
      });
      console.log(`✅ Kreiran pool: ${name}`);
    } else {
      console.log(`ℹ️ Pool ${name} već postoji`);
    }
  }
  console.log('🎉 Pool-ovi inicijalizirani!');
}

initPools()
  .then(() => process.exit(0))
  .catch(console.error)
  .finally(() => prisma.$disconnect());
