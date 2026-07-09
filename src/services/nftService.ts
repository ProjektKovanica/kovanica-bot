import { PrismaClient } from '@prisma/client';
import { getNFTForClicks, getMintReward, getStakingReward, NFT_COLLECTION } from '../nft/rarity.js';
import { PoolService, POOLS } from './poolService.js';

const prisma = new PrismaClient();

export class NFTService {
    static async checkAndMintNFT(telegramId: string, totalClicks: number) {
        const user = await prisma.user.findUnique({
            where: { telegramId },
            include: { nfts: true }
        });
        if (!user) return null;

        const targetNFT = getNFTForClicks(totalClicks);
        if (!targetNFT) return null;

        const hasNFT = user.nfts.some(nft => nft.rarity === targetNFT.rarity);
        if (hasNFT) return null;

        const existingCount = await prisma.nFT.count({
            where: { rarity: targetNFT.rarity }
        });
        if (existingCount >= targetNFT.maxSupply) return null;

        const mintReward = getMintReward(targetNFT.rarity, existingCount);
        const stakingReward = getStakingReward(targetNFT.rarity);

        const hasFunds = await PoolService.hasSufficientFunds(
            POOLS.NFT_MINT_REWARDS,
            mintReward
        );
        if (!hasFunds) {
            console.log(`⚠️ NFT Mint pool nema dovoljno sredstava! Potrebno: ${mintReward}`);
            return null;
        }

        await PoolService.spendFromPool(POOLS.NFT_MINT_REWARDS, mintReward);

        const updatedUser = await prisma.user.update({
            where: { telegramId },
            data: { clickBalance: { increment: mintReward } }
        });

        const newNFT = await prisma.nFT.create({
            data: {
                userId: user.id,
                tokenId: user.nfts.length + 1,
                contractAddress: `0:${Buffer.from(`${user.id}-${Date.now()}`).toString('hex')}`,
                rarity: targetNFT.rarity,
                name: targetNFT.name,
                image: targetNFT.image,
                bonusMultiplier: targetNFT.bonusMultiplier,
                mintReward: mintReward,
                requiredClicks: targetNFT.requiredClicks,
                maxSupply: targetNFT.maxSupply,
                totalMinted: existingCount + 1,
                equipped: false,
                staked: false,
                stakingReward: stakingReward,
            }
        });

        return {
            nft: newNFT,
            mintReward,
            totalBalance: updatedUser.clickBalance,
            totalMinted: existingCount + 1,
            maxSupply: targetNFT.maxSupply,
            remainingSupply: targetNFT.maxSupply - existingCount - 1,
            rarity: targetNFT.rarity,
        };
    }

    static async equipNFT(telegramId: string, nftId: number) {
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return null;

        const nft = await prisma.nFT.findUnique({
            where: { id: nftId, userId: user.id }
        });
        if (!nft) return null;
        if (nft.staked) return null;

        await prisma.nFT.updateMany({
            where: { userId: user.id },
            data: { equipped: false }
        });

        return await prisma.nFT.update({
            where: { id: nftId },
            data: { equipped: true }
        });
    }

    static async unequipNFT(telegramId: string, nftId?: number) {
        const user = await prisma.user.findUnique({
            where: { telegramId },
            include: { nfts: true }
        });
        if (!user) return null;

        let nft;
        if (nftId) {
            nft = user.nfts.find(n => n.id === nftId);
            if (!nft) return null;
            if (!nft.equipped) return null;
        } else {
            nft = user.nfts.find(n => n.equipped);
            if (!nft) return null;
        }

        await prisma.nFT.update({
            where: { id: nft.id },
            data: { equipped: false }
        });

        return nft;
    }

    static async getEquippedNFT(telegramId: string) {
        const user = await prisma.user.findUnique({
            where: { telegramId },
            include: { nfts: true }
        });
        if (!user) return null;
        return user.nfts.find(nft => nft.equipped) || null;
    }

    static async getUserNFTs(telegramId: string) {
        const user = await prisma.user.findUnique({
            where: { telegramId },
            include: { nfts: true }
        });
        return user?.nfts || [];
    }

    static async getSupplyStatus() {
        const nfts = await prisma.nFT.groupBy({
            by: ['rarity'],
            _count: { rarity: true }
        });

        const status: any = {};
        for (const nft of NFT_COLLECTION) {
            const minted = nfts.find(n => n.rarity === nft.rarity)?._count.rarity || 0;
            status[nft.rarity] = {
                minted,
                maxSupply: nft.maxSupply,
                remaining: nft.maxSupply - minted
            };
        }
        return status;
    }
}
