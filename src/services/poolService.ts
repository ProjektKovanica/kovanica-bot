import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const POOLS = {
    TAP_BASE: 'tap_base',
    NFT_MINT_REWARDS: 'nft_mint_rewards',
    REFERRAL_POOL: 'referral_pool',
    DEX_KVNC_GRAM: 'dex_kvnc_gram',
    DEX_KVNC_USDT: 'dex_kvnc_usdt',
} as const;

export class PoolService {
    static async hasSufficientFunds(poolName: string, amount: number): Promise<boolean> {
        const pool = await prisma.poolTracking.findUnique({
            where: { poolName }
        });
        if (!pool) return false;
        return pool.remaining >= amount;
    }
    
    static async spendFromPool(poolName: string, amount: number): Promise<boolean> {
        const pool = await prisma.poolTracking.findUnique({
            where: { poolName }
        });
        if (!pool) return false;
        if (pool.remaining < amount) return false;
        
        await prisma.poolTracking.update({
            where: { poolName },
            data: {
                spent: { increment: amount },
                remaining: { decrement: amount },
                lastUpdated: new Date()
            }
        });
        return true;
    }
    
    static async getPoolStatus(poolName: string) {
        return await prisma.poolTracking.findUnique({
            where: { poolName }
        });
    }
    
    static async getAllPoolStatus() {
        return await prisma.poolTracking.findMany();
    }
}
