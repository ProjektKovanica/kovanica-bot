import { PrismaClient } from "@prisma/client";
import { getNFTForClicks, getMintReward, getStakingReward, NFT_COLLECTION } from "../nft/rarity.js";

const prisma = new PrismaClient();

export class NFTService {
    static async checkAndMintNFT(telegramId: string, totalClicks: number) {
        const user = await prisma.user.findUnique({ where: { telegramId }, include: { nfts: true } });
        if (!user) return null;
        const targetNFT = getNFTForClicks(totalClicks);
        if (!targetNFT) return null;
        const hasNFT = user.nfts.some((nft: any) => nft.rarity === targetNFT.rarity);
        if (hasNFT) return null;
        const existingCount = await prisma.nFT.count({ where: { rarity: targetNFT.rarity } });
        if (existingCount >= targetNFT.maxSupply) return null;
        const mintReward = getMintReward(targetNFT.rarity, existingCount);
        await prisma.user.update({ where: { telegramId }, data: { clickBalance: { increment: mintReward } } });
        const newNFT = await prisma.nFT.create({
            data: {
                user: { connect: { telegramId } },
                tokenId: user.nfts.length + 1,
                contractAddress: "pending:" + user.id + "-" + Date.now(),
                rarity: targetNFT.rarity,
                name: targetNFT.name,
                image: targetNFT.image,
                bonusMultiplier: targetNFT.bonusMultiplier,
                mintReward: mintReward,
                requiredClicks: targetNFT.requiredClicks,
                maxSupply: targetNFT.maxSupply,
                stakingReward: getStakingReward(targetNFT.rarity),
            }
        });
        return {
            nft: newNFT,
            reward: mintReward,
            metadata: targetNFT,
            maxSupply: targetNFT.maxSupply,
            remainingSupply: targetNFT.maxSupply - existingCount - 1,
        };
    }

    static async getEquippedNFT(telegramId: string) {
        const user = await prisma.user.findUnique({ where: { telegramId }, include: { nfts: true } });
        if (!user) return null;
        return user.nfts.find((nft: any) => nft.equipped) || null;
    }

    static async equipNFT(telegramId: string, nftId: number) {
        const user = await prisma.user.findUnique({ where: { telegramId }, include: { nfts: true } });
        if (!user) return null;
        const nft = user.nfts.find((n: any) => n.id === nftId);
        if (!nft) return null;
        await prisma.nFT.updateMany({ where: { userId: user.id }, data: { equipped: false } });
        const updated = await prisma.nFT.update({ where: { id: nftId }, data: { equipped: true } });
        return updated;
    }

    static async unequipNFT(telegramId: string, nftId?: number) {
        const user = await prisma.user.findUnique({ where: { telegramId }, include: { nfts: true } });
        if (!user) return null;
        const equipped = user.nfts.find((n: any) => nftId ? n.id === nftId : n.equipped);
        if (!equipped) return null;
        await prisma.nFT.updateMany({ where: { userId: user.id }, data: { equipped: false } });
        return equipped;
    }

    static async stakeNFT(telegramId: string, nftId: number) {
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return false;
        await prisma.nFT.update({ where: { id: nftId }, data: { staked: true, stakeStartDate: new Date() } });
        return true;
    }

    static async unstakeNFT(telegramId: string, nftId: number) {
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return null;
        const nft = await prisma.nFT.findUnique({ where: { id: nftId } });
        if (!nft || !nft.staked || !nft.stakeStartDate) return null;
        const hoursStaked = (Date.now() - new Date(nft.stakeStartDate).getTime()) / 3600000;
        const reward = hoursStaked * getStakingReward(nft.rarity);
        await prisma.user.update({ where: { telegramId }, data: { clickBalance: { increment: reward } } });
        await prisma.nFT.update({ where: { id: nftId }, data: { staked: false, stakeStartDate: null } });
        return { reward, nft };
    }

    static async getUserNFTs(telegramId: string) {
        const user = await prisma.user.findUnique({ where: { telegramId }, include: { nfts: true } });
        if (!user) return [];
        return user.nfts;
    }

    static async getSupplyStatus() {
        const result: Record<string, { minted: number; maxSupply: number; remaining: number }> = {};
        for (const nft of NFT_COLLECTION) {
            const minted = await prisma.nFT.count({ where: { rarity: nft.rarity } });
            result[nft.rarity] = { minted, maxSupply: nft.maxSupply, remaining: nft.maxSupply - minted };
        }
        return result;
    }

    static async getAllNFTs() {
        return await prisma.nFT.findMany({ orderBy: { id: "desc" }, take: 100, include: { user: true } });
    }
}
