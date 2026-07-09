import { Bot, Context } from "grammy";
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import { NFTService } from './services/nftService.js';
import { PoolService, POOLS } from './services/poolService.js';
import { ReminderService } from './services/reminderService.js';
import { QuestService } from './services/questService.js';
import { PushService } from './services/pushService.js';
import { GameService } from './services/gameService.js';
import { TonPaymentService } from './services/tonPaymentService.js';
import { DexService } from './services/dexService.js';
import { AnalyticsService } from './services/analyticsService.js';
import { AntiBotService } from './services/antiBotService.js';
import { ReferralService } from './services/referralService.js';
import { getNextNFT, getStakingReward } from './nft/rarity.js';
import { VaultService } from "./services/vaultService.js";

dotenv.config();

const prisma = new PrismaClient();
const bot = new Bot(process.env.BOT_TOKEN!);

// === KONSTANTE ===
const INITIAL_REWARD = 1.0;
const DAILY_LIMIT = 10000;
const MIN_WITHDRAWAL = 100000;
const REFERRAL_BONUS_INVITER = 10;
const REFERRAL_BONUS_NEW = 5;
const DAILY_BONUS_MULTIPLIER = 2;

// === SERVISI ===
const analytics = new AnalyticsService(bot);
const antiBot = new AntiBotService();
const referralService = new ReferralService();
const pushService = new PushService(bot);

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

    await QuestService.createDailyQuests(telegramId);

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
        
        await QuestService.updateQuestProgress(telegramId, 'referrals');
        if (referrer) {
            await QuestService.updateQuestProgress(referrer.telegramId, 'referrals');
        }
        
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
        `⚠️ Isplate se za sada obrađuju ručno od strane admina.\n` +
        `🎨 /nfts - Pregled NFT-ova\n` +
        `🔒 /stake - Stake-aj NFT\n` +
        `🔓 /unstake - Prekini staking\n` +
        `📊 /stakeinfo - Pregled stake-anih NFT-ova\n` +
        `🔓 /unequip - Skini opremljeni NFT\n` +
        `💧 /liquidity - DEX Pool-ovi (USDT/GRAM)\n` +
        `🎮 /games - Mini igre\n` +
        `💰 /price - Cijena KVNC\n` +
        `💧 /pools - DEX Pool-ovi\n` +
        `🔄 /swap - Swap link\n` +
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

// ============================================
// /blackjack – Igraj Blackjack
// ============================================
bot.command("blackjack", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const input = ctx.message?.text?.split(" ");
    if (!input || input.length < 2) {
        return ctx.reply("📝 Pošalji: /blackjack IZNOS\nPrimjer: /blackjack 10");
    }

    const bet = parseInt(input[1]);
    if (isNaN(bet) || bet <= 0) {
        return ctx.reply("❌ Unesi pozitivan broj!");
    }

    const result = await GameService.playBlackjack(String(ctx.from.id), bet);
    if (result.error) return ctx.reply(`❌ ${result.error}`);

    await ctx.reply(
        `🃏 **Blackjack** 🃏\n\n` +
        `🎴 Tvoje karte: ${result.playerCards.join(', ')} (${result.playerTotal})\n` +
        `🎴 Dealerove karte: ${result.dealerCards[0]}, ?\n` +
        `${result.result}\n` +
        `💰 Ulog: ${result.bet} KVNC\n` +
        `💵 Neto: ${result.netChange > 0 ? '+' : ''}${result.netChange} KVNC`
    );
});

// ============================================
// /dice – Baci kocku
// ============================================
bot.command("dice", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const input = ctx.message?.text?.split(" ");
    if (!input || input.length < 3) {
        return ctx.reply("📝 Pošalji: /dice IZNOS BROJ\nPrimjer: /dice 10 3");
    }

    const bet = parseInt(input[1]);
    const guess = parseInt(input[2]);
    if (isNaN(bet) || bet <= 0) return ctx.reply("❌ Unesi pozitivan iznos!");
    if (isNaN(guess) || guess < 1 || guess > 6) {
        return ctx.reply("❌ Pogodi broj između 1 i 6!");
    }

    const result = await GameService.playDice(String(ctx.from.id), bet, guess);
    if (result.error) return ctx.reply(`❌ ${result.error}`);

    const emoji = result.win ? '🎉' : '😢';
    await ctx.reply(
        `🎲 **Dice** 🎲\n\n` +
        `${emoji} Tvoj pogodak: ${result.guess}\n` +
        `🎲 Kocka: ${result.roll}\n` +
        `${result.win ? '✅ POGODIO!' : '❌ Nisi pogodio!'}\n` +
        `💰 Ulog: ${result.bet} KVNC\n` +
        `💵 Neto: ${result.netChange > 0 ? '+' : ''}${result.netChange} KVNC`
    );
});

// ============================================
// /wheel – Kotač sreće
// ============================================
bot.command("wheel", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const result = await GameService.playWheel(String(ctx.from.id));
    if (result.error) return ctx.reply(`❌ ${result.error}`);

    await ctx.reply(
        `🎡 **Kotač sreće** 🎡\n\n` +
        `🎯 Segment: ${result.segment}\n` +
        `📊 Multiplier: ${result.multiplier}x\n` +
        `💰 Nagrada: ${result.reward} KVNC\n` +
        `💸 Ulog: ${result.cost} KVNC\n` +
        `💵 Neto: ${result.netChange > 0 ? '+' : ''}${result.netChange} KVNC`
    );
});

// ============================================
// /withdraw – Zatraži isplatu
// ============================================
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

    const MIN_WITHDRAWAL = 100000;
    if (user.clickBalance < MIN_WITHDRAWAL) {
        return ctx.reply(
            `⚠️ Minimalni iznos za isplatu je ${MIN_WITHDRAWAL} KVNC.\n` +
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
        return ctx.reply("⏳ Već imaš jedan zahtjev na čekanju.");
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
        `⏳ Isplata će biti obrađena automatski u roku 15 minuta.`
    );
});

// ============================================
// /processwithdrawals – Ručna obrada (admin)
// ============================================
bot.command("processwithdrawals", async (ctx: Context) => {
    const ownerId = process.env.OWNER_ID;
    if (!ctx.from || String(ctx.from.id) !== ownerId) {
        return ctx.reply("⛔ Samo vlasnik.");
    }

    await ctx.reply("⏳ Pokrećem obradu...");

    try {
        await TonPaymentService.processPendingWithdrawals();
        await ctx.reply("✅ Obrada završena!");
    } catch (error: any) {
        await ctx.reply(`❌ Greška: ${error.message}`);
    }
});

// ============================================
// /checkwithdrawals – Pregled pending (admin)
// ============================================
bot.command("checkwithdrawals", async (ctx: Context) => {
    const ownerId = process.env.OWNER_ID;
    if (!ctx.from || String(ctx.from.id) !== ownerId) {
        return ctx.reply("⛔ Samo vlasnik.");
    }

    const pending = await prisma.withdrawal.findMany({
        where: { status: "pending" },
        include: { user: true }
    });

    if (pending.length === 0) {
        return ctx.reply("✅ Nema pending zahtjeva.");
    }

    let message = "📊 **Pending isplate:**\n\n";
    for (const w of pending) {
        message += `🆔 ${w.id}\n`;
        message += `👤 ${w.user.telegramId}\n`;
        message += `💰 ${w.amount} KVNC\n`;
        message += `📤 \`${w.tonAddress}\`\n`;
        message += `📅 ${w.requestedAt.toLocaleString()}\n\n`;
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
});

bot.command("status", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const telegramId = String(ctx.from.id);
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) return ctx.reply("Klikni /start prvo!");

    const rank = getRank(user.totalClicks);
    const equippedNFT = await NFTService.getEquippedNFT(telegramId);
    
    const quests = await QuestService.getTodayQuests(telegramId);
    const completedQuests = quests.filter(q => q.completed).length;
    const totalQuests = quests.length;
    
    const achievements = await prisma.achievement.count({
        where: { userId: user.id }
    });
    
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
        `📋 Dnevni zadaci: ${completedQuests}/${totalQuests} dovršeno\n` +
        `🏅 Postignuća: ${achievements}\n` +
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
        `⏳ **Isplate se obrađuju ručno od strane admina.**\n` +
        `📅 Bit će obrađen u roku 24-48h.\n` +
        `📢 Hvala na razumijevanju!`
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
               `💡 /unequip - Skini opremljeni NFT\n` +
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

bot.command("unequip", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const input = ctx.message?.text?.split(" ");
    
    const telegramId = String(ctx.from.id);
    const user = await prisma.user.findUnique({
        where: { telegramId },
        include: { nfts: true }
    });
    if (!user) return ctx.reply("Klikni /start prvo!");
    
    let nftId: number | undefined;
    if (input && input.length > 1) {
        nftId = parseInt(input[1]);
        if (isNaN(nftId)) return ctx.reply("❌ NFT ID mora biti broj!");
    }
    
    const result = await NFTService.unequipNFT(telegramId, nftId);
    if (!result) {
        return ctx.reply("❌ Nemaš opremljen NFT za skinuti!");
    }
    
    await ctx.reply(
        `✅ NFT "${result.name}" je skinut! 🔓\n\n` +
        `⭐ Bonus više nije aktivan.\n` +
        `💡 /equip ID - Opremi drugi NFT`
    );
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
    if (nft.equipped) return ctx.reply("❌ Prvo skinut NFT (/unequip)!");
    
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

bot.command("liquidity", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    
    const pools = [
        {
            name: "KVNC-USDT",
            address: "EQCi5WSqkRsvaHNrs3pg6OrIA4C6Zk-inMHoVq0VAgo3svC5",
            icon: "💵",
        },
        {
            name: "KVNC-GRAM",
            address: "EQDaPt-caUdBWLhF2In1P4x2-S7MOw79aganZ58PqMFqxR8S",
            icon: "🪙",
        }
    ];

    let message = "💧 **Provide Liquidity** 💧\n\n";
    message += "Dodaj likvidnost u naše DEX pool-ove i zaradi feejeve!\n\n";
    
    for (const pool of pools) {
        message += `${pool.icon} **${pool.name}**\n`;
        message += `📌 Adresa: \`${pool.address}\`\n`;
        message += `📊 Status: 🟢 Aktivan\n`;
        message += `🔜 Integracija: Uskoro!\n\n`;
    }
    
    message += `\n🔗 **STON.fi linkovi (za ručno dodavanje):**\n`;
    message += `https://app.ston.fi/pools\n\n`;
    message += `💡 *Ova opcija će uskoro omogućiti direktno dodavanje likvidnosti iz bota.*\n`;
    message += `📢 Pratite naše kanale za ažuriranja!`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
});

bot.command("games", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    
    await ctx.reply(
        `🎮 **Mini Igre** 🎮\n\n` +
        `✊ **Kamen-Škare-Papir**\n` +
        `Pobjeda donosi +2 KVNC!\n` +
        `Pošalji: /rps kamen (ili škare, papir)\n\n` +
        `🔢 **Pogodi broj**\n` +
        `Pogodi broj između 1 i 10 za +5 KVNC!\n` +
        `Pošalji: /guess 5\n\n` +
        `🎰 **Slot**\n` +
        `Košta 1 KVNC, dobitak do 100 KVNC!\n` +
        `Pošalji: /slot\n\n` +
        `🧠 **Trivia (Kviz)**\n` +
        `Odgovori na pitanje za +3 KVNC!\n` +
        `Pošalji: /trivia\n\n` +
        `🪙 **Coin Flip**\n` +
        `Baci novčić za duplu zaradu!\n` +
        `Pošalji: /coinflip IZNOS\n\n` +
        `🧠 **Memory**\n` +
        `Zapamti niz brojeva za +2 KVNC!\n` +
        `Pošalji: /memory\n\n` +
        `💡 Sve igre možeš igrati i u Mini Appu!`
    );
});

bot.command("rps", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const input = ctx.message?.text?.split(" ");
    if (!input || input.length < 2) {
        return ctx.reply("📝 Pošalji: /rps kamen (ili škare, papir)");
    }
    
    const choice = input[1].toLowerCase();
    const choices = ['kamen', 'škare', 'papir'];
    if (!choices.includes(choice)) {
        return ctx.reply("Odaberi: kamen, škare ili papir!");
    }
    
    const result = await GameService.playRPS(String(ctx.from.id), choice);
    if (result.error) return ctx.reply(`❌ ${result.error}`);
    
    await ctx.reply(
        `✊ **Kamen-Škare-Papir**\n\n` +
        `Ti: ${result.playerChoice}\n` +
        `Bot: ${result.botChoice}\n` +
        `${result.result}\n` +
        `${result.reward > 0 ? `💰 +${result.reward} KVNC` : ''}`
    );
});

bot.command("guess", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const input = ctx.message?.text?.split(" ");
    if (!input || input.length < 2) {
        return ctx.reply("📝 Pošalji: /guess BROJ (1-10)");
    }
    
    const guess = parseInt(input[1]);
    if (isNaN(guess) || guess < 1 || guess > 10) {
        return ctx.reply("Unesi broj između 1 i 10!");
    }
    
    const result = await GameService.guessNumber(String(ctx.from.id), guess);
    if (result.error) return ctx.reply(`❌ ${result.error}`);
    
    await ctx.reply(
        `🔢 **Pogodi broj**\n\n` +
        `Tvoj broj: ${result.guess}\n` +
        `Cilj: ${result.target}\n` +
        `${result.result}\n` +
        `${result.reward > 0 ? `💰 +${result.reward} KVNC` : ''}`
    );
});

bot.command("slot", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const result = await GameService.playSlot(String(ctx.from.id));
    if (result.error) return ctx.reply(`❌ ${result.error}`);
    
    await ctx.reply(
        `🎰 **Slot**\n\n` +
        `${result.slots.join(' | ')}\n\n` +
        `${result.result}\n` +
        `${result.reward > 0 ? `💰 +${result.reward} KVNC` : '💸 -1 KVNC (ulog)'}`
    );
});

bot.command("trivia", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const result = await GameService.playTrivia(String(ctx.from.id));
    if (result.error) return ctx.reply(`❌ ${result.error}`);

    let message = "🧠 **Trivia Kviz** 🧠\n\n";
    message += `📝 ${result.question}\n\n`;
    for (let i = 0; i < result.options.length; i++) {
        message += `${i + 1}. ${result.options[i]}\n`;
    }
    message += `\n💰 Nagrada: ${result.reward} KVNC\n`;
    message += `📝 Odgovori: /trivia_answer BROJ`;

    await ctx.reply(message);
});

bot.command("trivia_answer", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const input = ctx.message?.text?.split(" ");
    if (!input || input.length < 2) {
        return ctx.reply("📝 Pošalji: /trivia_answer BROJ");
    }

    const answer = parseInt(input[1]) - 1;
    const reward = 3;
    await prisma.user.update({
        where: { telegramId: String(ctx.from.id) },
        data: { clickBalance: { increment: reward } }
    });

    await ctx.reply(`✅ Točan odgovor! +${reward} KVNC`);
});

bot.command("coinflip", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const input = ctx.message?.text?.split(" ");
    if (!input || input.length < 2) {
        return ctx.reply("📝 Pošalji: /coinflip IZNOS\nPrimjer: /coinflip 10");
    }

    const bet = parseInt(input[1]);
    if (isNaN(bet) || bet <= 0) {
        return ctx.reply("❌ Unesi pozitivan broj!");
    }

    const result = await GameService.playCoinFlip(String(ctx.from.id), bet);
    if (result.error) return ctx.reply(`❌ ${result.error}`);

    const emoji = result.win ? '🎉' : '😢';
    await ctx.reply(
        `🪙 **Coin Flip** 🪙\n\n` +
        `${emoji} Rezultat: ${result.result}\n` +
        `${result.win ? '✅ POBJEDA!' : '❌ PORAZ!'}\n` +
        `💰 Ulog: ${result.bet} KVNC\n` +
        `💵 Neto: ${result.netChange > 0 ? '+' : ''}${result.netChange} KVNC`
    );
});

bot.command("memory", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const result = await GameService.playMemory(String(ctx.from.id));
    if (result.error) return ctx.reply(`❌ ${result.error}`);

    await ctx.reply(
        `🧠 **Memorijska igra** 🧠\n\n` +
        `Zapamti niz brojeva:\n` +
        `📊 **${result.sequence}**\n\n` +
        `💰 Nagrada: ${result.reward} KVNC\n` +
        `⏳ Ponovni unos: /memory_answer BROJ1 BROJ2 ...`
    );
});

bot.command("memory_answer", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const input = ctx.message?.text?.split(" ");
    if (!input || input.length < 2) {
        return ctx.reply("📝 Pošalji: /memory_answer BROJ1 BROJ2 ...");
    }

    const reward = 2;
    await prisma.user.update({
        where: { telegramId: String(ctx.from.id) },
        data: { clickBalance: { increment: reward } }
    });

    await ctx.reply(`✅ Točno! +${reward} KVNC`);
});

bot.command("price", async (ctx: Context) => {
    try {
        const price = await DexService.getLivePrice(process.env.KVNC_JETTON_MASTER!);
        
        let message = "💰 **LIVE CIJENA KVNC** 💰\n\n";
        message += `💵 **USDT:** ${price.usdt.toFixed(6)}\n`;
        message += `🪙 **GRAM:** ${price.gram.toFixed(6)}\n`;
        message += `📈 **24h High:** $${price.high24h.toFixed(6)}\n`;
        message += `📉 **24h Low:** $${price.low24h.toFixed(6)}\n`;
        message += `📊 **Promjena 24h:** ${price.change24h > 0 ? '+' : ''}${price.change24h.toFixed(2)}%\n`;
        message += `📈 **Volumen 24h:** $${price.volume24h.toFixed(2)}\n`;
        message += `💧 **Likvidnost:** $${price.liquidity.toFixed(2)}\n`;
        message += `🏦 **Market Cap:** $${price.marketCap.toFixed(2)}\n\n`;
        message += `⏱️ ${new Date().toLocaleString()}\n`;
        message += `📊 Izvor: STON.fi V2`;

        await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error: any) {
        console.error('❌ /price error:', error);
        await ctx.reply(`❌ Greška pri dohvaćanju cijene: ${error.message || 'Nepoznata greška'}`);
    }
});

bot.command("pools", async (ctx: Context) => {
    try {
        const message = await DexService.getPoolDisplay(process.env.KVNC_JETTON_MASTER!);
        await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error: any) {
        console.error('❌ /pools error:', error);
        await ctx.reply(`❌ Greška pri dohvaćanju pool-ova: ${error.message || 'Nepoznata greška'}`);
    }
});

bot.command("swap", async (ctx: Context) => {
    const input = ctx.message?.text?.split(" ");
    
    let message = "🔄 **Swap KVNC** 🔄\n\n";
    message += `1️⃣ /swap GRAM 100 - Swap 100 KVNC za GRAM\n`;
    message += `2️⃣ /swap USDT 100 - Swap 100 KVNC za USDT\n\n`;
    message += `📊 **Trenutna cijena:**\n`;
    
    try {
        const price = await DexService.getLivePrice(process.env.KVNC_JETTON_MASTER!);
        message += `  💵 USDT: ${price.usdt.toFixed(6)}\n`;
        message += `  🪙 GRAM: ${price.gram.toFixed(6)}\n\n`;
    } catch (e) {
        message += `  ⏳ Učitavanje cijene...\n\n`;
    }
    
    message += `🔗 Nakon unosa, dobit ćeš link za swap na STON.fi.`;

    if (input && input.length > 2) {
        const toToken = input[1].toUpperCase();
        const amount = parseFloat(input[2]);
        
        if (isNaN(amount) || amount <= 0) {
            return ctx.reply("❌ Unesi pozitivan iznos!");
        }

        let tokenAddress;
        if (toToken === 'GRAM' || toToken === 'TON') {
            tokenAddress = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
        } else if (toToken === 'USDT') {
            tokenAddress = 'EQCi5WSqkRsvaHNrs3pg6OrIA4C6Zk-inMHoVq0VAgo3svC5';
        } else {
            return ctx.reply("❌ Podržani tokeni: GRAM, USDT");
        }

        const link = DexService.getSwapLink(
            process.env.KVNC_JETTON_MASTER!,
            tokenAddress,
            amount.toString()
        );

        try {
            const simulation = await DexService.simulateSwap(
                process.env.KVNC_JETTON_MASTER!,
                tokenAddress,
                amount
            );

            let simMessage = `\n📊 **Simulacija:**\n`;
            if (simulation) {
                simMessage += `  💰 Output: ${simulation.expectedOutput.toFixed(6)} ${toToken}\n`;
                simMessage += `  📈 Price impact: ${simulation.priceImpact.toFixed(2)}%\n`;
                simMessage += `  💸 Fee: ${simulation.fee.toFixed(4)} TON\n`;
            }

            await ctx.reply(
                `🔄 **Swap KVNC → ${toToken}** 🔄\n\n` +
                `💰 Iznos: ${amount} KVNC\n` +
                `${simMessage}\n` +
                `🔗 Klikni za izvršavanje:\n${link}`
            );
        } catch (error: any) {
            await ctx.reply(
                `🔄 **Swap KVNC → ${toToken}** 🔄\n\n` +
                `💰 Iznos: ${amount} KVNC\n` +
                `🔗 Klikni za izvršavanje:\n${link}\n\n` +
                `⚠️ Greška pri simulaciji: ${error.message || 'Nepoznata greška'}`
            );
        }
        return;
    }

    await ctx.reply(message);
});

bot.command("addliquidity", async (ctx: Context) => {
    const input = ctx.message?.text?.split(" ");
    
    let message = "➕ **Dodaj Likvidnost** ➕\n\n";
    message += `Dodaj likvidnost u DEX pool-ove i zaradi feejeve!\n\n`;
    message += `📊 **Dostupni pool-ovi:**\n`;
    message += `  1️⃣ KVNC-USDT\n`;
    message += `  2️⃣ KVNC-GRAM\n\n`;
    message += `📝 Primjer: /addliquidity USDT 1000\n`;
    message += `📝 Primjer: /addliquidity GRAM 1000\n\n`;
    message += `🔗 Nakon unosa, dobit ćeš link za dodavanje likvidnosti na STON.fi.`;

    if (input && input.length > 2) {
        const token = input[1].toUpperCase();
        const amount = parseFloat(input[2]);
        
        if (isNaN(amount) || amount <= 0) {
            return ctx.reply("❌ Unesi pozitivan iznos!");
        }

        let tokenAddress;
        let poolName;
        if (token === 'USDT') {
            tokenAddress = 'EQCi5WSqkRsvaHNrs3pg6OrIA4C6Zk-inMHoVq0VAgo3svC5';
            poolName = 'KVNC-USDT';
        } else if (token === 'GRAM' || token === 'TON') {
            tokenAddress = 'EQDaPt-caUdBWLhF2In1P4x2-S7MOw79aganZ58PqMFqxR8S';
            poolName = 'KVNC-GRAM';
        } else {
            return ctx.reply("❌ Podržani tokeni: USDT, GRAM");
        }

        const link = DexService.getAddLiquidityLink(
            process.env.KVNC_JETTON_MASTER!,
            tokenAddress
        );

        try {
            const price = await DexService.getLivePrice(process.env.KVNC_JETTON_MASTER!);
            const kvncAmount = token === 'USDT' ? amount / price.usdt : amount / price.gram;

            await ctx.reply(
                `➕ **Dodaj likvidnost: ${poolName}** ➕\n\n` +
                `💰 Iznos ${token}: ${amount}\n` +
                `🪙 KVNC potrebno: ${kvncAmount.toFixed(2)}\n` +
                `📊 Cijena: ${token === 'USDT' ? price.usdt : price.gram}\n\n` +
                `🔗 Klikni za dodavanje likvidnosti:\n${link}\n\n` +
                `💡 Preporučujemo dodavanje u oba tokena (50/50)`
            );
        } catch (error: any) {
            await ctx.reply(
                `➕ **Dodaj likvidnost: ${poolName}** ➕\n\n` +
                `💰 Iznos ${token}: ${amount}\n` +
                `🔗 Klikni za dodavanje likvidnosti:\n${link}\n\n` +
                `⚠️ Greška pri dohvaćanju cijene: ${error.message || 'Nepoznata greška'}`
            );
        }
        return;
    }

    await ctx.reply(message);
});

bot.command("removeliquidity", async (ctx: Context) => {
    const input = ctx.message?.text?.split(" ");
    
    if (input && input.length > 1) {
        const token = input[1].toUpperCase();
        let tokenAddress;
        let poolName;
        if (token === 'USDT') {
            tokenAddress = 'EQCi5WSqkRsvaHNrs3pg6OrIA4C6Zk-inMHoVq0VAgo3svC5';
            poolName = 'KVNC-USDT';
        } else if (token === 'GRAM' || token === 'TON') {
            tokenAddress = 'EQDaPt-caUdBWLhF2In1P4x2-S7MOw79aganZ58PqMFqxR8S';
            poolName = 'KVNC-GRAM';
        } else {
            return ctx.reply("❌ Podržani tokeni: USDT, GRAM");
        }

        const link = DexService.getRemoveLiquidityLink(
            process.env.KVNC_JETTON_MASTER!,
            tokenAddress
        );

        await ctx.reply(
            `➖ **Ukloni likvidnost: ${poolName}** ➖\n\n` +
            `🔗 Klikni za uklanjanje likvidnosti:\n${link}\n\n` +
            `💡 Uklanjanje likvidnosti će ti vratiti tvoje tokene.\n` +
            `⚠️ Provjeri cijenu prije uklanjanja!`
        );
        return;
    }

    await ctx.reply(
        `➖ **Ukloni Likvidnost** ➖\n\n` +
        `📝 Primjer: /removeliquidity USDT\n` +
        `📝 Primjer: /removeliquidity GRAM\n\n` +
        `🔗 Dobit ćeš link za uklanjanje likvidnosti na STON.fi.`
    );
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

bot.command("stats", async (ctx: Context) => {
    const ownerId = process.env.OWNER_ID;
    if (!ctx.from || String(ctx.from.id) !== ownerId) {
        return ctx.reply("⛔ Samo vlasnik.");
    }

    const stats = await analytics.getStats();
    let message = "📊 **STATISTIKE** 📊\n\n";
    message += `👥 Ukupno korisnika: ${stats.totalUsers}\n`;
    message += `✅ Aktivni danas: ${stats.activeToday}\n`;
    message += `👆 Ukupno klikova: ${stats.totalClicks.toLocaleString()}\n`;
    message += `🎨 Iskopano NFT-ova: ${stats.totalNFTs}\n`;
    message += `💸 Pending isplata: ${stats.pendingWithdrawals}\n\n`;
    message += `💧 **Pool-ovi:**\n`;
    for (const pool of stats.pools) {
        message += `  ${pool.name}: ${pool.usedPercent}% potrošeno\n`;
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
});

bot.command("referraltree", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const telegramId = String(ctx.from.id);

    const tree = await referralService.getReferralTree(telegramId);
    if (!tree) return ctx.reply("Nema podataka.");

    await ctx.reply(
        `👥 **Tvoje referral stablo:**\n\n` +
        `📊 Direktni: ${tree.direct}\n` +
        `📊 Indirektni: ${tree.indirect}\n` +
        `📊 Ukupno: ${tree.total}\n\n` +
        `💡 Pozivaj prijatelje za više nagrada!`
    );
});

bot.command("referralleaderboard", async (ctx: Context) => {
    const top = await referralService.getReferralLeaderboard(10);
    
    if (top.length === 0) {
        return ctx.reply("📭 Još nema referala!");
    }

    let message = "🏆 **TOP 10 REFERERA** 🏆\n\n";
    top.forEach((user, index) => {
        const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;
        message += `${medal} ${user.telegramId.slice(0, 12)}... — ${user.referralCount} pozvanih\n`;
    });

    await ctx.reply(message);
});

bot.command("captcha", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const telegramId = String(ctx.from.id);

    const captcha = await antiBot.requestCaptcha(telegramId);
    await ctx.reply(
        `🔒 **CAPTCHA verifikacija** 🔒\n\n` +
        `${captcha}\n\n` +
        `Pošalji odgovor: /captcha_answer BROJ`
    );
});

bot.command("captcha_answer", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const input = ctx.message?.text?.split(" ");
    if (!input || input.length < 2) {
        return ctx.reply("📝 Pošalji: /captcha_answer BROJ");
    }

    const answer = parseInt(input[1]);
    if (isNaN(answer)) return ctx.reply("❌ Unesi broj!");

    const verified = await antiBot.verifyCaptcha(String(ctx.from.id), answer);
    if (verified) {
        await ctx.reply("✅ CAPTCHA točna! Nastavi rudariti.");
    } else {
        await ctx.reply("❌ Netočno! Pokušaj ponovno.");
    }
});

bot.command("backup", async (ctx: Context) => {
    const ownerId = process.env.OWNER_ID;
    if (!ctx.from || String(ctx.from.id) !== ownerId) {
        return ctx.reply("⛔ Samo vlasnik.");
    }

    await ctx.reply("⏳ Kreiranje backup-a...");

    try {
        const { backupDatabase } = await import('./scripts/backupDatabase.js');
        const result = await backupDatabase();

        if (result.success) {
            await ctx.reply(
                `✅ **Backup kreiran!**\n\n` +
                `📁 Datoteka: ${result.filename}\n` +
                `📦 Veličina: ${result.size} MB\n` +
                `📅 ${new Date().toLocaleString()}`
            );
        } else {
            await ctx.reply(`❌ Greška: ${result.error}`);
        }
    } catch (error: any) {
        await ctx.reply(`❌ Greška: ${error.message}`);
    }
});

bot.command("processwithdrawals", async (ctx: Context) => {
    const ownerId = process.env.OWNER_ID;
    if (!ctx.from || String(ctx.from.id) !== ownerId) {
        return ctx.reply("⛔ Samo vlasnik.");
    }

    await ctx.reply("⏳ Pokrećem automatsku obradu isplata...");

    try {
        await TonPaymentService.processPendingWithdrawals();
        await ctx.reply("✅ Automatska obrada isplata završena!");
    } catch (error: any) {
        await ctx.reply(`❌ Greška: ${error.message}`);
    }
});

bot.command("checkwithdrawals", async (ctx: Context) => {
    const ownerId = process.env.OWNER_ID;
    if (!ctx.from || String(ctx.from.id) !== ownerId) {
        return ctx.reply("⛔ Samo vlasnik može vidjeti ove podatke.");
    }

    const pending = await prisma.withdrawal.findMany({
        where: { status: "pending" },
        orderBy: { requestedAt: "asc" },
        include: { user: true }
    });

    if (pending.length === 0) {
        return ctx.reply("✅ Nema pending zahtjeva za isplatu.");
    }

    let message = "📊 **Pending isplate:**\n\n";
    for (const w of pending) {
        message += `🆔 **${w.id}**\n`;
        message += `👤 User: ${w.user.telegramId}\n`;
        message += `💰 Iznos: ${w.amount} KVNC\n`;
        message += `📤 Adresa: \`${w.tonAddress}\`\n`;
        message += `📅 Zatraženo: ${w.requestedAt.toLocaleString()}\n`;
        message += `---\n\n`;
    }

    message += `\n💡 Nakon slanja, označi kao processed:\n`;
    message += `/process ID`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
});

bot.command("process", async (ctx: Context) => {
    const ownerId = process.env.OWNER_ID;
    if (!ctx.from || String(ctx.from.id) !== ownerId) {
        return ctx.reply("⛔ Samo vlasnik.");
    }

    const input = ctx.message?.text?.split(" ");
    if (!input || input.length < 2) {
        return ctx.reply("📝 Pošalji: /process ID_ZAHTJEVA");
    }

    const id = parseInt(input[1]);
    if (isNaN(id)) return ctx.reply("❌ ID mora biti broj!");

    const withdrawal = await prisma.withdrawal.findUnique({
        where: { id },
        include: { user: true }
    });

    if (!withdrawal) return ctx.reply("❌ Zahtjev nije pronađen!");
    if (withdrawal.status !== "pending") {
        return ctx.reply(`✅ Zahtjev već ima status: ${withdrawal.status}`);
    }

    await prisma.withdrawal.update({
        where: { id },
        data: { status: "processed", processedAt: new Date() }
    });

    await ctx.reply(
        `✅ Zahtjev **#${id}** označen kao processed!\n\n` +
        `💰 Iznos: ${withdrawal.amount} KVNC\n` +
        `👤 Korisnik: ${withdrawal.user.telegramId}\n` +
        `📤 Adresa: ${withdrawal.tonAddress}`
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

// === CALLBACK ===
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
        await pushService.notifyDailyBonus(telegramId, reward);
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
    
    await QuestService.updateQuestProgress(telegramId, 'clicks');
    
    const nftResult = await NFTService.checkAndMintNFT(telegramId, updated.totalClicks);
    let nftMessage = '';
    if (nftResult) {
        await QuestService.updateQuestProgress(telegramId, 'nft');
        
        const nft = nftResult.nft;
        nftMessage = `\n\n🎉 **ISKOPAO SI NFT!**\n` +
                     `${nft.name} (${nft.rarity})\n` +
                     `⭐ Bonus: +${nftResult.mintReward} KVNC\n` +
                     `📦 Preostalo: ${nftResult.remainingSupply}/${nftResult.maxSupply}`;
        
        await pushService.notifyNewNFT(telegramId, nft);
        
        try {
            await ctx.replyWithPhoto(nft.image, {
                caption: `🎉 **ISKOPAO SI NFT!** 🎉\n\n` +
                         `**${nft.name}** (${nft.rarity})\n` +
                         `⭐ Bonus: ${nft.bonusMultiplier}x na sve klikove\n` +
                         `💰 Nagrada: +${nftResult.mintReward} KVNC\n` +
                         `📦 Preostalo: ${nftResult.remainingSupply}/${nftResult.maxSupply}\n\n` +
                         `💡 /equip ${nft.id} - Opremi NFT za bonus\n` +
                         `💡 /unequip - Skini opremljeni NFT\n` +
                         `💡 /stake ${nft.id} - Stake-aj NFT za pasivnu zaradu`
            });
        } catch (e) {
            console.log('Greška pri slanju NFT slike:', e);
        }
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

const reminder = new ReminderService(bot);
reminder.start();
console.log('✅ Daily reminder pokrenut!');
console.log('✅ Push service spreman!');

bot.start({
    onStart: (botInfo) => {
        console.log(`Bot ${botInfo.username} je živ!`);
    },
});

bot.catch((err) => {
    console.error("Greška:", err);
});
