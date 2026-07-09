export interface NFTMetadata {
    rarity: string;
    name: string;
    image: string;
    bonusMultiplier: number;
    requiredClicks: number;
    maxSupply: number;
    color: string;
    emoji: string;
    mintRewards: {
        phase1: number;
        phase2: number;
        phase3: number;
    };
    stakingReward: number;
    priceGRAM: number;
}

export const NFT_COLLECTION: NFTMetadata[] = [
    {
        rarity: 'Common',
        name: 'Brončani pijuk',
        image: 'https://github.com/ProjektKovanica/kovanica/raw/main/common.png',
        bonusMultiplier: 1.2,
        requiredClicks: 100,
        maxSupply: 1000,
        color: '#CD7F32',
        emoji: '⛏️',
        mintRewards: { phase1: 40000, phase2: 16000, phase3: 5333 },
        stakingReward: 0.5,
        priceGRAM: 0.5,
    },
    {
        rarity: 'Rare',
        name: 'Srebrni pijuk',
        image: 'https://github.com/ProjektKovanica/kovanica/raw/main/rare.png',
        bonusMultiplier: 1.5,
        requiredClicks: 500,
        maxSupply: 500,
        color: '#C0C0C0',
        emoji: '🥈',
        mintRewards: { phase1: 80000, phase2: 32000, phase3: 10667 },
        stakingReward: 1.5,
        priceGRAM: 2,
    },
    {
        rarity: 'Epic',
        name: 'Zlatni pijuk',
        image: 'https://github.com/ProjektKovanica/kovanica/raw/main/epic.png',
        bonusMultiplier: 2.0,
        requiredClicks: 2000,
        maxSupply: 300,
        color: '#FFD700',
        emoji: '🥇',
        mintRewards: { phase1: 120000, phase2: 48000, phase3: 16000 },
        stakingReward: 4.0,
        priceGRAM: 10,
    },
    {
        rarity: 'Legendary',
        name: 'Dijamantni pijuk',
        image: 'https://github.com/ProjektKovanica/kovanica/raw/main/legendary.png',
        bonusMultiplier: 3.0,
        requiredClicks: 10000,
        maxSupply: 150,
        color: '#B9F2FF',
        emoji: '💎',
        mintRewards: { phase1: 240000, phase2: 96000, phase3: 32000 },
        stakingReward: 10.0,
        priceGRAM: 50,
    },
    {
        rarity: 'Mythic',
        name: 'Vatreni pijuk',
        image: 'https://github.com/ProjektKovanica/kovanica/raw/main/mythic.png',
        bonusMultiplier: 5.0,
        requiredClicks: 50000,
        maxSupply: 50,
        color: '#FF4500',
        emoji: '🔥',
        mintRewards: { phase1: 400000, phase2: 160000, phase3: 53333 },
        stakingReward: 25.0,
        priceGRAM: 50,
    }
];

export function getNFTForClicks(clicks: number): NFTMetadata | null {
    let unlocked: NFTMetadata | null = null;
    for (const nft of NFT_COLLECTION) {
        if (clicks >= nft.requiredClicks) {
            unlocked = nft;
        }
    }
    return unlocked;
}

export function getNextNFT(clicks: number): NFTMetadata | null {
    for (const nft of NFT_COLLECTION) {
        if (clicks < nft.requiredClicks) {
            return nft;
        }
    }
    return null;
}

export function getMintPhase(totalMinted: number, maxSupply: number): number {
    const percentage = totalMinted / maxSupply;
    if (percentage < 0.3) return 1;
    if (percentage < 0.7) return 2;
    return 3;
}

export function getMintReward(rarity: string, totalMinted: number): number {
    const nft = NFT_COLLECTION.find(n => n.rarity === rarity);
    if (!nft) return 0;
    const phase = getMintPhase(totalMinted, nft.maxSupply);
    if (phase === 1) return nft.mintRewards.phase1;
    if (phase === 2) return nft.mintRewards.phase2;
    return nft.mintRewards.phase3;
}

export function getNFTPrice(rarity: string): number {
    const nft = NFT_COLLECTION.find(n => n.rarity === rarity);
    return nft?.priceGRAM || 0;
}

export function getStakingReward(rarity: string): number {
    const nft = NFT_COLLECTION.find(n => n.rarity === rarity);
    return nft?.stakingReward || 0.1;
}
