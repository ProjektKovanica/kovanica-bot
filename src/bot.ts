import { Bot, Context } from "grammy";
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import { NFTService } from './services/nftService.js';
import { PoolService, POOLS } from './services/poolService.js';
import { ReminderService } from './services/reminderService.js';
import { getNextNFT, getStakingReward } from './nft/rarity.js';

dotenv.config();

const prisma = new PrismaClient();
const bot = new Bot(process.env.BOT_TOKEN!);

const INITIAL_REWARD = 1.0;
const DAILY_LIMIT = 1000;
const MIN_WITHDRAWAL = 100000;
const REFERRAL_BONUS_INVITER = 10;
const REFERRAL_BONUS_NEW = 5;
const DAILY_BONUS_MULTIPLIER = 2;

// === RANGOVI ===
function getRank(totalClicks: number): string {
    if (totalClicks >= 100000) return "👑 Kralj rudara";
    if (totalClicks >= 50000) return "💎 Dijamantni rudar";
    if (totalClicks >= 20000) return "🔹 Platinasti rudar";
    if (totalClicks >= 10000) return "🥇 Zlatni rudar";
    if (totalClicks >= 5000) return "🥈 Srebrni rudar";
    if (totalClicks >= 2000) return "🥉 Brončani rudar";
    if (totalClicks >= 500) return "⛏️ Napredni rudar";
    if (totalClicks >= 100) return "⛏️ Početnik";
    return "🪨 Novi rudar";
}

function isToday(date: Date): boolean {
    const now = new Date();
    return date.getFullYear() === now.getFullYear() &&
           date.getMonth() === now.getMonth() &&
           date.getDate() === now.getDate();
}

// === KOMANDE ===

bot.command("start", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const telegramId = String(ctx.from.id);

    const payload = ctx.message?.text?.split(" ");
    let referrerId: number | null = null;
    if (payload && payload.length > 1 && payload[1].startsWith("ref_")) {
        const refTelegramId = payload[1].replace("ref_", "");
        const referrer = await prisma.user.findUnique({
            where: { telegramId: refTelegramId },
        });
        if (referrer && referrer.telegramId !== telegramId) {
            referrerId = referrer.id;
        }
    }

    const user = await prisma.user.upsert({
        where: { telegramId },
        update: {},
        create: {
            telegramId,
            referredBy: referrerId,
        },
    });

    if (referrerId && user.referredBy === referrerId) {
        const referrer = await prisma.user.findUnique({
            where: { id: referrerId }
        });
        
        await prisma.user.update({
            where: { id: referrerId },
            data: {
                clickBalance: { increment: REFERRAL_BONUS_INVITER },
                referralCount: { increment: 1 },
            },
        });
        await prisma.user.update({
            where: { id: user.id },
            data: { clickBalance: { increment: REFERRAL_BONUS_NEW } },
        });
        
        await ctx.reply(
            `🎉 Dobrodošao! Dobio si ${REFERRAL_BONUS_NEW} KVNC bonus!\n` +
            `Tvoj pozivatelj je dobio ${REFERRAL_BONUS_INVITER} KVNC bonus.`
        );
    }

    const rank = getRank(user.totalClicks);
    await ctx.reply(
        `🪙 Kovanica (KVNC) Tap Miner\n\n` +
        `👑 Rang: ${rank}\n` +
        `💰 Balans: ${user.clickBalance} KVNC\n` +
        `👆 Klikni za rudarenje! (Limit: ${DAILY_LIMIT} klikova/dan)\n` +
        `⭐️ Nagrada po kliku: ${INITIAL_REWARD} KVNC\n` +
        `🔥 Prvi klik danas: ${INITIAL_REWARD * DAILY_BONUS_MULTIPLIER} KVNC (2x)\n\n` +
        `📊 /status - Tvoj profil\n` +
        `🏆 /leaderboard - Top rudari\n` +
        `👥 /referral - Pozovi prijatelje\n` +
        `💳 /wallet - Spremi GRAM adresu\n` +
        `💸 /withdraw - Zatraži isplatu (min ${MIN_WITHDRAWAL} KVNC)\n` +
        `🎨 /nfts - Pregled NFT-ova\n` +
        `🔒 /stake - Stake-aj NFT\n` +
        `🔓 /unstake - Prekini staking\n` +
        `📊 /stakeinfo - Pregled stake-anih NFT-ova\n` +
        `🚀 /mine - Otvori rudnik (Mini App)`,
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🔨 Klikni za rudarenje", callback_data: "tap" }]
                ]
            }
        }
    );
});

bot.command("status", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const telegramId = String(ctx.from.id);
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) return ctx.reply("Klikni /start prvo!");

    const rank = getRank(user.totalClicks);
    const equippedNFT = await NFTService.getEquippedNFT(telegramId);
    
    let bonusText = '';
    if (equippedNFT) {
        bonusText = `\n⭐ NFT bonus: ${equippedNFT.bonusMultiplier}x (${equippedNFT.name})`;
    }

    await ctx.reply(
        `📊 Tvoj rudarski profil:\n\n` +
        `👑 Rang: ${rank}\n` +
        `💰 Balans: ${user.clickBalance} KVNC\n` +
        `👆 Ukupno klikova: ${user.totalClicks}\n` +
        `📅 Današnjih klikova: ${user.dailyClicks}/${DAILY_LIMIT}\n` +
        `📊 Nagrada po kliku: ${INITIAL_REWARD} KVNC${bonusText}\n` +
        `👥 Pozvanih korisnika: ${user.referralCount}\n` +
        `⭐️ Daily bonus: ${user.lastBonusDate && isToday(user.lastBonusDate) ? "✅ Iskorišten danas" : "✅ Dostupan (2x)"}\n` +
        `📅 Zadnji klik: ${user.lastClickDate.toLocaleString()}`
    );
});

bot.command("leaderboard", async (ctx: Context) => {
    const topUsers = await prisma.user.findMany({
        orderBy: { totalClicks: "desc" },
        take: 10,
    });

    if (topUsers.length === 0) {
        return ctx.reply("⛏️ Još nema rudara! Budi prvi!");
    }

    let message = "🏆 **TOP 10 RUDARA** 🏆\n\n";
    topUsers.forEach((user, index) => {
        const rank = getRank(user.totalClicks);
        const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;
        message += `${medal} ${user.telegramId} — ${user.totalClicks} klikova (${rank})\n`;
    });

    await ctx.reply(message);
});

bot.command("referral", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const telegramId = String(ctx.from.id);
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) return ctx.reply("Klikni /start prvo!");

    const link = `https://t.me/${bot.botInfo.username}?start=ref_${telegramId}`;
    await ctx.reply(
        `👥 Tvoj referral link:\n${link}\n\n` +
        `🔗 Podijeli ovaj link s prijateljima!\n` +
        `🎁 Za svakog novog korisnika dobit ćeš ${REFERRAL_BONUS_INVITER} KVNC bonus!\n` +
        `👤 Tvoj pozvati: ${user.referralCount} korisnika`
    );
});

bot.command("wallet", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const input = ctx.message?.text?.split(" ");
    if (!input || input.length < 2) {
        return ctx.reply("Pošalji: /wallet GRAM_ADRESA (npr. EQD...)");
    }
    const address = input[1];
    const telegramId = String(ctx.from.id);
    await prisma.user.update({
        where: { telegramId },
        data: { tonWallet: address },
    });
    await ctx.reply("✅ GRAM adresa spremljena!");
});

bot.command("withdraw", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const telegramId = String(ctx.from.id);
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) return ctx.reply("Klikni /start prvo!");

    if (!user.tonWallet) {
        return ctx.reply(
            "⚠️ Prvo spremi svoju GRAM adresu:\n" +
            "/wallet EQD_... (tvoja GRAM adresa)"
        );
    }

    if (user.clickBalance < MIN_WITHDRAWAL) {
        return ctx.reply(
            `⚠️ Minimalni iznos za isplatu je ${MIN_WITHDRAWAL} KVNC.\n` +
            `Tvoj trenutni balans: ${user.clickBalance} KVNC\n` +
            `💰 Potrebno još: ${(MIN_WITHDRAWAL - user.clickBalance).toFixed(2)} KVNC`
        );
    }

    const pending = await prisma.withdrawal.findFirst({
        where: {
            userId: user.id,
            status: "pending",
        },
    });
    if (pending) {
        return ctx.reply("⏳ Već imaš jedan zahtjev na čekanju. Obradit ćemo ga uskoro.");
    }

    const withdrawal = await prisma.withdrawal.create({
        data: {
            userId: user.id,
            amount: user.clickBalance,
            tonAddress: user.tonWallet,
            status: "pending",
        },
    });

    await ctx.reply(
        `✅ Zahtjev za isplatu zaprimljen!\n\n` +
        `💰 Iznos: ${user.clickBalance} KVNC\n` +
        `📤 GRAM adresa: ${user.tonWallet}\n` +
        `🆔 ID zahtjeva: ${withdrawal.id}\n\n` +
        `⏳ Bit će obrađen u roku 24h.`
    );
});

bot.command("nfts", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const telegramId = String(ctx.from.id);
    const user = await prisma.user.findUnique({
        where: { telegramId },
        include: { nfts: true }
    });
    if (!user) return ctx.reply("Klikni /start prvo!");
    
    if (user.nfts.length === 0) {
        const nextNFT = getNextNFT(user.totalClicks);
        return ctx.reply(
            `🎨 Još nemaš NFT-ova!\n\n` +
            `⛏️ Iskopaj ih klikovima:\n` +
            `🔹 100 klikova → Brončani pijuk (1.2x, +do 40.000 KVNC)\n` +
            `🔹 500 klikova → Srebrni pijuk (1.5x, +do 80.000 KVNC)\n` +
            `🔹 2000 klikova → Zlatni pijuk (2.0x, +do 120.000 KVNC)\n` +
            `🔹 10000 klikova → Dijamantni pijuk (3.0x, +do 240.000 KVNC)\n` +
            `🔹 50000 klikova → Vatreni pijuk (5.0x, +do 400.000 KVNC)\n\n` +
            `📊 Trenutno klikova: ${user.totalClicks}\n` +
            (nextNFT ? `🎯 Sljedeći: ${nextNFT.requiredClicks - user.totalClicks} klikova do ${nextNFT.name}` : '🏆 Sve NFT-ove si iskopao!')
        );
    }
    
    let message = "🎨 **Tvoji NFT-ovi:**\n\n";
    for (const nft of user.nfts) {
        const equipped = nft.equipped ? " ✅ **OPREMLJEN**" : "";
        const staked = nft.staked ? " 🔒 **STAKE-AN**" : "";
        const emoji = nft.rarity === 'Mythic' ? '🔥' : 
                      nft.rarity === 'Legendary' ? '💎' : 
                      nft.rarity === 'Epic' ? '🥇' : 
                      nft.rarity === 'Rare' ? '🥈' : '⛏️';
        message += `${emoji} ${nft.name} (${nft.rarity})${equipped}${staked}\n`;
        message += `  ⭐ Bonus: ${nft.bonusMultiplier}x | Nagrada: ${nft.mintReward} KVNC\n`;
        message += `  📅 Staking: ${nft.stakingReward} KVNC/dan\n`;
        message += `  📦 Supply: ${nft.totalMinted}/${nft.maxSupply} | 🆔 ID: ${nft.id}\n\n`;
    }
    
    const supplyStatus = await NFTService.getSupplyStatus();
    message += `📊 **Supply status:**\n`;
    for (const [rarity, data] of Object.entries(supplyStatus) as [string, any][]) {
        const emoji = rarity === 'Mythic' ? '🔥' : 
                      rarity === 'Legendary' ? '💎' : 
                      rarity === 'Epic' ? '🥇' : 
                      rarity === 'Rare' ? '🥈' : '⛏️';
        message += `  ${emoji} ${rarity}: ${data.minted}/${data.maxSupply} (${data.remaining} preostalo)\n`;
    }
    
    message += `\n💡 /equip ID - Opremi NFT za bonus\n` +
               `💡 /stake ID - Stake-aj NFT za pasivnu zaradu`;
    await ctx.reply(message);
});

bot.command("equip", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const input = ctx.message?.text?.split(" ");
    if (!input || input.length < 2) {
        return ctx.reply("📝 Pošalji: /equip NFT_ID\nPrimjer: /equip 5");
    }
    
    const nftId = parseInt(input[1]);
    if (isNaN(nftId)) return ctx.reply("❌ NFT ID mora biti broj!");
    
    const telegramId = String(ctx.from.id);
    const result = await NFTService.equipNFT(telegramId, nftId);
    
    if (result) {
        await ctx.reply(`✅ NFT "${result.name}" je opremljen!\n⭐ Bonus: ${result.bonusMultiplier}x na sve klikove!`);
    } else {
        await ctx.reply("❌ NFT nije pronađen, nije tvoj ili je stake-an!");
    }
});

bot.command("stake", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const input = ctx.message?.text?.split(" ");
    if (!input || input.length < 2) {
        return ctx.reply("📝 Pošalji: /stake NFT_ID\nPrimjer: /stake 5");
    }
    
    const nftId = parseInt(input[1]);
    if (isNaN(nftId)) return ctx.reply("❌ NFT ID mora biti broj!");
    
    const telegramId = String(ctx.from.id);
    const user = await prisma.user.findUnique({
        where: { telegramId },
        include: { nfts: true }
    });
    if (!user) return ctx.reply("Klikni /start prvo!");
    
    const nft = user.nfts.find(n => n.id === nftId);
    if (!nft) return ctx.reply("❌ NFT nije pronađen ili nije tvoj!");
    if (nft.staked) return ctx.reply("❌ NFT je već stake-an!");
    if (nft.equipped) return ctx.reply("❌ Prvo de-equipaj NFT (/equip 0)!");
    
    const dailyReward = nft.stakingReward || 0.1;
    
    await prisma.nFT.update({
        where: { id: nftId },
        data: {
            staked: true,
            stakeStartDate: new Date(),
            equipped: false,
        }
    });
    
    await ctx.reply(
        `✅ NFT "${nft.name}" je stake-an! 🔒\n\n` +
        `⭐ Dnevna nagrada: ${dailyReward} KVNC/dan\n` +
        `📅 Počelo: ${new Date().toLocaleDateString()}\n\n` +
        `💡 /unstake ID - Prekini staking i primi nagradu`
    );
});

bot.command("unstake", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const input = ctx.message?.text?.split(" ");
    if (!input || input.length < 2) {
        return ctx.reply("📝 Pošalji: /unstake NFT_ID");
    }
    
    const nftId = parseInt(input[1]);
    if (isNaN(nftId)) return ctx.reply("❌ NFT ID mora biti broj!");
    
    const telegramId = String(ctx.from.id);
    const user = await prisma.user.findUnique({
        where: { telegramId },
        include: { nfts: true }
    });
    if (!user) return ctx.reply("Klikni /start prvo!");
    
    const nft = user.nfts.find(n => n.id === nftId);
    if (!nft) return ctx.reply("❌ NFT nije pronađen!");
    if (!nft.staked) return ctx.reply("❌ NFT nije stake-an!");
    
    const startDate = new Date(nft.stakeStartDate!);
    const now = new Date();
    const daysStaked = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    
    const dailyReward = nft.stakingReward || 0.1;
    const totalReward = daysStaked * dailyReward;
    
    await prisma.$transaction([
        prisma.nFT.update({
            where: { id: nftId },
            data: {
                staked: false,
                stakeStartDate: null,
                stakeEndDate: new Date(),
            }
        }),
        prisma.user.update({
            where: { telegramId },
            data: {
                clickBalance: { increment: totalReward }
            }
        })
    ]);
    
    await ctx.reply(
        `✅ NFT "${nft.name}" je unstake-an! 🔓\n\n` +
        `📅 Stake-an: ${daysStaked} dana\n` +
        `💰 Nagrada: +${totalReward.toFixed(2)} KVNC`
    );
});

bot.command("stakeinfo", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const telegramId = String(ctx.from.id);
    const user = await prisma.user.findUnique({
        where: { telegramId },
        include: { nfts: true }
    });
    if (!user) return ctx.reply("Klikni /start prvo!");
    
    const stakedNFTs = user.nfts.filter(n => n.staked);
    
    if (stakedNFTs.length === 0) {
        return ctx.reply("🔒 Nemaš stake-anih NFT-ova.");
    }
    
    let message = "🔒 **Stake-ani NFT-ovi:**\n\n";
    for (const nft of stakedNFTs) {
        const startDate = new Date(nft.stakeStartDate!);
        const daysStaked = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const earned = daysStaked * (nft.stakingReward || 0.1);
        const emoji = nft.rarity === 'Mythic' ? '🔥' : 
                      nft.rarity === 'Legendary' ? '💎' : 
                      nft.rarity === 'Epic' ? '🥇' : 
                      nft.rarity === 'Rare' ? '🥈' : '⛏️';
        message += `${emoji} ${nft.name}\n`;
        message += `  📅 Stake-an: ${daysStaked} dana\n`;
        message += `  💰 Zarađeno: ${earned.toFixed(2)} KVNC\n`;
        message += `  🆔 ID: ${nft.id}\n\n`;
    }
    
    await ctx.reply(message);
});

bot.command("mine", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const telegramId = String(ctx.from.id);
    await prisma.user.upsert({
        where: { telegramId },
        update: {},
        create: { telegramId },
    });

    const url = `https://app.kovanica.online`;
    await ctx.reply(
        `🪙 Otvori rudnik i kreni s rudarenjem!\n\n` +
        `Klikni na gumb ispod za pristup naprednom sučelju.`,
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🚀 Otvori rudnik", web_app: { url } }]
                ]
            }
        }
    );
});

bot.command("poolstatus", async (ctx: Context) => {
    const ownerId = process.env.OWNER_ID;
    if (!ctx.from || String(ctx.from.id) !== ownerId) {
        return ctx.reply("⛔ Samo vlasnik može vidjeti ove podatke.");
    }
    
    const pools = await PoolService.getAllPoolStatus();
    let message = "📊 **Stanje pool-ova:**\n\n";
    
    for (const pool of pools) {
        const usedPercent = ((pool.spent / pool.totalAllocated) * 100).toFixed(1);
        const emoji = pool.poolName === 'tap_base' ? '⛏️' :
                      pool.poolName === 'nft_mint_rewards' ? '🎨' :
                      pool.poolName === 'referral_pool' ? '👥' :
                      pool.poolName === 'dex_kvnc_gram' ? '💧' :
                      pool.poolName === 'dex_kvnc_usdt' ? '💧' : '📦';
        message += `${emoji} **${pool.poolName}**\n`;
        message += `  💰 Preostalo: ${pool.remaining.toLocaleString()} KVNC\n`;
        message += `  📊 Potrošeno: ${pool.spent.toLocaleString()} KVNC (${usedPercent}%)\n\n`;
    }
    
    await ctx.reply(message);
});

// === CALLBACK ZA KLIK ===
bot.callbackQuery("tap", async (ctx: Context) => {
    if (!ctx.from) {
        await ctx.answerCallbackQuery("Nema korisnika!");
        return;
    }
    const telegramId = String(ctx.from.id);
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
        await ctx.answerCallbackQuery("Prvo stisni /start!");
        return;
    }

    const now = new Date();
    let dailyClicks = user.dailyClicks;
    if (!isToday(user.lastClickDate)) {
        dailyClicks = 0;
    }

    if (dailyClicks >= DAILY_LIMIT) {
        await ctx.answerCallbackQuery(`⛔ Dosegnuo si dnevni limit od ${DAILY_LIMIT} klikova!`);
        return;
    }

    let reward = INITIAL_REWARD;
    let bonusMessage = "";
    
    const lastBonus = user.lastBonusDate;
    if (!lastBonus || !isToday(lastBonus)) {
        reward = reward * DAILY_BONUS_MULTIPLIER;
        bonusMessage = `⭐️ Daily bonus! +${reward} KVNC (2x)`;
        await prisma.user.update({
            where: { telegramId },
            data: { lastBonusDate: now },
        });
    } else {
        bonusMessage = `+${reward} KVNC`;
    }
    
    const equippedNFT = await NFTService.getEquippedNFT(telegramId);
    let nftBonus = 1;
    let nftText = '';
    if (equippedNFT) {
        nftBonus = equippedNFT.bonusMultiplier;
        nftText = ` (${equippedNFT.bonusMultiplier}x NFT)`;
    }
    
    const finalReward = reward * nftBonus;

    const hasFunds = await PoolService.hasSufficientFunds(POOLS.TAP_BASE, finalReward);
    if (!hasFunds) {
        await ctx.answerCallbackQuery("⛔ Pool je prazan! Pokušaj kasnije.");
        return;
    }
    
    await PoolService.spendFromPool(POOLS.TAP_BASE, finalReward);

    const updated = await prisma.user.update({
        where: { telegramId },
        data: {
            clickBalance: { increment: finalReward },
            totalClicks: { increment: 1 },
            dailyClicks: dailyClicks + 1,
            lastClickDate: now,
        },
    });

    const rank = getRank(updated.totalClicks);
    
    const nftResult = await NFTService.checkAndMintNFT(telegramId, updated.totalClicks);
    let nftMessage = '';
    if (nftResult) {
        nftMessage = `\n\n🎉 **ISKOPAO SI NFT!**\n` +
                     `${nftResult.nft.name} (${nftResult.rarity})\n` +
                     `⭐ Bonus: +${nftResult.mintReward} KVNC\n` +
                     `📦 Preostalo: ${nftResult.remainingSupply}/${nftResult.maxSupply}`;
    }

    await ctx.answerCallbackQuery(bonusMessage + nftText);
    await ctx.editMessageText(
        `👆 Klik uspješan!\n` +
        `💰 +${finalReward} KVNC\n` +
        `💎 Novo stanje: ${updated.clickBalance.toFixed(2)} KVNC\n` +
        `📊 Današnji klikovi: ${updated.dailyClicks}/${DAILY_LIMIT}\n` +
        `👑 Rang: ${rank}${nftMessage}\n\n` +
        `🔽 Klikni opet za još rudarenja!`,
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🔨 Još jedan klik", callback_data: "tap" }]
                ]
            }
        }
    );
});

// === POKRETANJE ===

// Pokreni daily reminder
const reminder = new ReminderService(bot);
reminder.start();
console.log('✅ Daily reminder pokrenut!');

bot.start({
    onStart: (botInfo) => {
        console.log(`Bot ${botInfo.username} je živ!`);
    },
});

bot.catch((err) => {
    console.error("Greška:", err);
});
