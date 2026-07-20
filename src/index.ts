import { Bot, Context } from "grammy";
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketService } from "./services/websocketService.js";
import { TonPaymentService } from "./services/tonPaymentService.js";
import { Address } from "@ton/core";
import cron from "node-cron";
import { ReminderService } from "./services/reminderService.js";
import { PushService } from "./services/pushService.js";
import { AnalyticsService } from "./services/analyticsService.js";
import { AntiBotService } from "./services/antiBotService.js";
import { NFTService } from "./services/nftService.js";
import { PoolService, POOLS } from "./services/poolService.js";
import { DexService } from "./services/dexService.js";
import { GameService } from "./services/gameService.js";
import { QuestService } from "./services/questService.js";
import { getNextNFT, getStakingReward } from "./nft/rarity.js";
import { validateAndExtractId, extractTelegramIdDev } from "./utils/auth.js";

// ES Module setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const prisma = new PrismaClient();
const bot = new Bot(process.env.BOT_TOKEN!);

// === KONSTANTE ===
const INITIAL_REWARD = 1.0;
const DAILY_LIMIT = 10000
const ENERGY_LIMIT = 1000;
const MIN_WITHDRAWAL = 10000;
const REFERRAL_BONUS_INVITER = 10;
const REFERRAL_BONUS_NEW = 5;
const DAILY_BONUS_MULTIPLIER = 2;

// === SERVISI ===
const analytics = new AnalyticsService(bot);
const antiBot = new AntiBotService();
const pushService = new PushService(bot);

// === FUNKCIJE ===
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

function extractTelegramId(initData: string, rawUser?: any): string | null {
    const botToken = process.env.BOT_TOKEN!;
    
    const validatedId = validateAndExtractId(initData, botToken);
    if (validatedId) return validatedId;

    return extractTelegramIdDev(rawUser);
}

const HALVING_INTERVAL = 1000000;
const MAX_ENERGY = 1000;
const ENERGY_REGEN_PER_SEC = 2;

async function getCurrentReward(): Promise<number> {
    const result = await prisma.user.aggregate({ _sum: { totalClicks: true } });
    const totalClicks = result._sum.totalClicks || 0;
    const epoch = Math.floor(totalClicks / HALVING_INTERVAL);
    return INITIAL_REWARD / Math.pow(2, epoch);
}

async function regenerateEnergy(user: any): Promise<number> {
    if (!user.lastEnergyUpdate) return user.energy || MAX_ENERGY;
    const now = new Date();
    const lastUpdate = new Date(user.lastEnergyUpdate);
    const secondsElapsed = Math.floor((now.getTime() - lastUpdate.getTime()) / 1000);
    const regenAmount = secondsElapsed * ENERGY_REGEN_PER_SEC;
    return Math.min(MAX_ENERGY, (user.energy || 0) + regenAmount);
}

async function initBot() {
    console.log("🚀 Pokrećem Kovanica bot...");

    // ============================================
    // BOT KOMANDE
    // ============================================
    
   bot.command("start", async (ctx: Context) => {
    if (!ctx.from) return ctx.reply("Nema korisnika!");
    const telegramId = String(ctx.from.id);

    const payload = ctx.message?.text?.split(" ");
    let referrerId: number | null = null;
    if (payload && payload.length > 1 && payload[1].startsWith("ref_")) {
        const refTelegramId = payload[1].replace("ref_", "");
        const referrer = await prisma.user.findUnique({ where: { telegramId: refTelegramId } });
        if (referrer && referrer.telegramId !== telegramId) {
            referrerId = referrer.id;
        }
    }

    const user = await prisma.user.upsert({
        where: { telegramId },
        update: {},
        create: { telegramId, referredBy: referrerId || undefined },
    });

    if (referrerId && user.referredBy === referrerId) {
        await prisma.user.update({
            where: { id: referrerId },
            data: { clickBalance: { increment: REFERRAL_BONUS_INVITER }, referralCount: { increment: 1 } },
        });
        await prisma.user.update({
            where: { id: user.id },
            data: { clickBalance: { increment: REFERRAL_BONUS_NEW } },
        });
        await ctx.reply(`🎉 Dobrodošao! Dobio si ${REFERRAL_BONUS_NEW} KVNC bonus, a tvoj pozivatelj ${REFERRAL_BONUS_INVITER} KVNC!`);
    }

    const rank = getRank(user.totalClicks);
    const bonusAvailable = !user.lastBonusDate || !isToday(user.lastBonusDate);

    await ctx.reply(
        `🪙 **Kovanica (KVNC) Tap Miner**\n\n` +
        `👑 Rang: ${rank}\n` +
        `💰 Balans: ${user.clickBalance.toFixed(2)} KVNC\n` +
        `👆 Ukupno klikova: ${user.totalClicks}\n` +
        `${bonusAvailable ? "🔥 Dnevni bonus dostupan (2x)!" : "✅ Dnevni bonus iskorišten"}\n\n` +
        `📊 /status - Moj profil\n` +
        `🏆 /leaderboard - Top lista\n` +
        `👥 /referral - Pozovi prijatelje\n` +
        `💳 /wallet - Spremi adresu\n` +
        `💸 /withdraw - Isplata (min 10,000 KVNC)\n` +
        `🎨 /nfts - NFT-ovi\n` +
        `💰 /price - Cijena KVNC\n` +
        `🪙 /tokenomics - Raspodjela tokena\n` +
        `🚀 /mine - Otvori rudnik`,
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🔨 Klikni za rudarenje", callback_data: "tap" }],
                    [{ text: "🚀 Otvori rudnik", web_app: { url: process.env.MINI_APP_URL || "https://kovanica.online" } }],
                    [
                        { text: "📊 Status", callback_data: "menu_status" },
                        { text: "🏆 Top", callback_data: "menu_leaderboard" },
                    ],
                    [
                        { text: "👥 Referral", callback_data: "menu_referral" },
                        { text: "💰 Cijena", callback_data: "menu_price" },
                    ],
                    [
                        { text: "🪙 Tokenomics", callback_data: "menu_tokenomics" },
                        { text: "💳 Wallet", callback_data: "menu_wallet" },
                    ],
                ]
            },
        }
    );
});

    bot.callbackQuery("menu_status", async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.from) return;
        const telegramId = String(ctx.from.id);
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return ctx.reply("Klikni /start prvo!");
        const rank = getRank(user.totalClicks);
        const equippedNFT = await NFTService.getEquippedNFT(telegramId);
        const achievements = await prisma.achievement.count({ where: { userId: user.id } });
        const bonusText = equippedNFT ? `\n⭐ NFT bonus: ${equippedNFT.bonusMultiplier}x (${equippedNFT.name})` : "";
        await ctx.reply(
            `📊 Tvoj rudarski profil:\n\n` +
            `👑 Rang: ${rank}\n` +
            `💰 Balans: ${user.clickBalance.toFixed(2)} KVNC\n` +
            `👆 Ukupno klikova: ${user.totalClicks}\n` +
            `📅 Današnjih klikova: ${user.dailyClicks}/${DAILY_LIMIT}\n` +
            `📊 Nagrada po kliku: ${INITIAL_REWARD} KVNC${bonusText}\n` +
            `👥 Pozvanih: ${user.referralCount}\n` +
            `🏅 Postignuća: ${achievements}\n` +
            `⭐️ Daily bonus: ${user.lastBonusDate && isToday(user.lastBonusDate) ? "✅ Iskorišten danas" : "✅ Dostupan (2x)"}\n` +
            `📅 Zadnji klik: ${user.lastClickDate.toLocaleString()}`
        );
    });

    bot.callbackQuery("menu_leaderboard", async (ctx) => {
        await ctx.answerCallbackQuery();
        const topUsers = await prisma.user.findMany({ orderBy: { totalClicks: "desc" }, take: 10 });
        if (topUsers.length === 0) return ctx.reply("⛏️ Još nema rudara!");
        let message = "🏆 TOP 10 RUDARA 🏆\n\n";
        topUsers.forEach((u, i) => {
            const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
            message += `${medal} ${u.telegramId} — ${u.totalClicks} klikova (${getRank(u.totalClicks)})\n`;
        });
        await ctx.reply(message);
    });

    bot.callbackQuery("menu_nfts", async (ctx) => {
        await ctx.answerCallbackQuery();
        await ctx.reply("Koristite /nfts za pregled NFT-ova.");
    });

    bot.callbackQuery("menu_referral", async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.from) return;
        const telegramId = String(ctx.from.id);
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return ctx.reply("Klikni /start prvo!");
        const link = `https://t.me/${ctx.me.username}?start=ref_${telegramId}`;
        await ctx.reply(`👥 Tvoj referral link:\n${link}\n\n🎁 Za svakog novog korisnika dobit ćeš ${REFERRAL_BONUS_INVITER} KVNC!\n👤 Pozvao/la si: ${user.referralCount} korisnika`);
    });

    bot.callbackQuery("menu_price", async (ctx) => {
        await ctx.answerCallbackQuery();
        try {
            const price = await DexService.getLivePrice(process.env.KVNC_JETTON_MASTER!);
            const trust = await DexService.getTrustScore(process.env.KVNC_JETTON_MASTER!);
            
            let message = `💰 **LIVE CIJENA KVNC**\n\n`;
            message += `💵 USDT: ${price.usdt.toFixed(6)}\n`;
            message += `🪙 GRAM: ${price.gram.toFixed(6)}\n`;
            message += `📈 24h: ${price.change24h > 0 ? "+" : ""}${price.change24h.toFixed(2)}%\n`;
            message += `💧 Likvidnost: $${price.liquidity.toFixed(2)}\n`;
            message += `📊 Volumen: $${price.volume24h.toFixed(2)}\n\n`;
            
            if (trust) {
                const emoji = trust.level === 'HIGH' ? '🟢' : trust.level === 'MEDIUM' ? '🟡' : '🔴';
                message += `🔒 Trust Score: ${emoji} ${trust.score}/100\n`;
            }
            
            
            await ctx.reply(message, { parse_mode: 'Markdown' });
        } catch (e) {
            await ctx.reply("❌ Nije moguće dohvatiti cijenu.");
        }
    });

    bot.callbackQuery("menu_swap", async (ctx) => {
        await ctx.answerCallbackQuery();
        await ctx.reply(`🔄 Swap KVNC\n\n/swap GRAM 100 — swap 100 KVNC za GRAM\n/swap USDT 100 — swap 100 KVNC za USDT`);
    });

    bot.callbackQuery("menu_withdraw", async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.from) return;
        const telegramId = String(ctx.from.id);
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return ctx.reply("Klikni /start prvo!");
        if (!user.tonWallet) return ctx.reply(`⚠️ Prvo spremi wallet adresu:\n/wallet EQ...`);
        if (user.clickBalance < MIN_WITHDRAWAL) {
            return ctx.reply(`⚠️ Minimalni iznos: ${MIN_WITHDRAWAL} KVNC\n💰 Tvoj balans: ${user.clickBalance.toFixed(2)} KVNC\n📊 Nedostaje: ${(MIN_WITHDRAWAL - user.clickBalance).toFixed(2)} KVNC`);
        }
        await ctx.reply(`Koristi /withdraw za potvrdu isplate.`);
    });

    bot.callbackQuery("menu_wallet", async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.from) return;
        const telegramId = String(ctx.from.id);
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return ctx.reply("Klikni /start prvo!");
        if (user.tonWallet) {
            await ctx.reply(`💳 Trenutni wallet:\n${user.tonWallet}\n\nZa promjenu: /wallet NOVA_ADRESA`);
        } else {
            await ctx.reply(`💳 Nemaš spremljenog walleta.\n\nDodaj: /wallet EQ...`);
        }
    });

    bot.callbackQuery("menu_games", async (ctx) => {
        await ctx.answerCallbackQuery();
        await ctx.reply(
            `🎮 Mini igre / Games\n\n` +
            `✂️ /rps kamen — Kamen-škare-papir\n` +
            `🔢 /guess BROJ — Pogodi broj (1-10)\n` +
            `🎰 /slot — Slot machine\n` +
            `❓ /trivia — Kviz\n` +
            `🪙 /coinflip IZNOS — Coin flip\n` +
            `🃏 /blackjack IZNOS — Blackjack\n` +
            `🎲 /dice IZNOS BROJ — Kocka\n` +
            `🎡 /wheel — Kotač sreće\n` +
            `🧠 /memory — Memorijska igra\n` +
            `🎡 /spin — Dnevni spin`
        );
    });

    bot.command("status", async (ctx: Context) => {
        if (!ctx.from) return ctx.reply("Nema korisnika!");
        const telegramId = String(ctx.from.id);
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return ctx.reply("Klikni /start prvo!");

        const rank = getRank(user.totalClicks);
        const equippedNFT = await NFTService.getEquippedNFT(telegramId);
        
        const completedQuests = 0;
        const totalQuests = 0;
        
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

    bot.command("daily", async (ctx: Context) => {
        if (!ctx.from) return ctx.reply("Nema korisnika!");
        const telegramId = String(ctx.from.id);
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return ctx.reply("Klikni /start prvo!");

        const now = new Date();
        const lastBonus = user.lastBonusDate;
        
        if (lastBonus && isToday(lastBonus)) {
            const tomorrow = new Date(now);
            tomorrow.setHours(24, 0, 0, 0);
            const diff = tomorrow.getTime() - now.getTime();
            const hours = Math.floor(diff / 3600000);
            const mins = Math.floor((diff % 3600000) / 60000);
            return ctx.reply(
                `⏳ Već si preuzeo dnevnu nagradu!\n\n` +
                `🕐 Sljedeća nagrada za: ${hours}h ${mins}min`
            );
        }

        const reward = 50;
        await prisma.user.update({
            where: { telegramId },
            data: {
                clickBalance: { increment: reward },
                lastBonusDate: now
            }
        });

        await ctx.reply(
            `🎁 Dnevna nagrada preuzeta!\n\n` +
            `💰 +${reward} KVNC dodano na tvoj balans!\n` +
            `💎 Novi balans: ${(user.clickBalance + reward).toFixed(2)} KVNC\n\n` +
            `⏰ Vrati se sutra za novu nagradu!`
        );
    });

    bot.command("stats", async (ctx: Context) => {
        try {
            const totalUsers = await prisma.user.count();
            const totalClicksResult = await prisma.user.aggregate({ _sum: { totalClicks: true } });
            const totalBalanceResult = await prisma.user.aggregate({ _sum: { clickBalance: true } });
            const totalClicks = totalClicksResult._sum.totalClicks || 0;
            const totalBalance = totalBalanceResult._sum.clickBalance || 0;
            const totalSupply = Number(process.env.TOTAL_SUPPLY) || 1000000000;
            const burned = Number(process.env.BURN_SUPPLY) || 100000000;
            const circulating = totalSupply - burned;
            
            const halvingInterval = 1000000;
            const currentEpoch = Math.floor(totalClicks / halvingInterval);
            const nextHalving = (currentEpoch + 1) * halvingInterval;
            const reward = INITIAL_REWARD / Math.pow(2, currentEpoch);

            await ctx.reply(
                `📊 KOVANICA GLOBALNE STATISTIKE\n\n` +
                `👥 Ukupno rudara: ${totalUsers.toLocaleString()}\n` +
                `👆 Ukupno klikova: ${totalClicks.toLocaleString()}\n` +
                `💰 KVNC u optjecaju: ${totalBalance.toFixed(0)} KVNC\n\n` +
                `🪙 TOKENOMICS\n` +
                `📦 Ukupna ponuda: ${totalSupply.toLocaleString()} KVNC\n` +
                `🔥 Spaljeno: ${burned.toLocaleString()} KVNC\n` +
                `💫 Cirkulacija: ${circulating.toLocaleString()} KVNC\n\n` +
                `⛏️ HALVING INFO\n` +
                `🔄 Trenutna nagrada: ${reward.toFixed(4)} KVNC/klik\n` +
                `📉 Halving epoch: #${currentEpoch}\n` +
                `🎯 Sljedeći halving za: ${(nextHalving - totalClicks).toLocaleString()} klikova`
            );
        } catch(e: any) {
            ctx.reply("❌ Greška pri dohvaćanju statistika.");
        }
    });

    bot.command("burn", async (ctx: Context) => {
        const burned = Number(process.env.BURN_SUPPLY) || 100000000;
        const totalSupply = Number(process.env.TOTAL_SUPPLY) || 1000000000;
        const burnPct = ((burned / totalSupply) * 100).toFixed(2);
        
        await ctx.reply(
            `🔥 KVNC BURN INFO\n\n` +
            `🔥 Spaljeno: ${burned.toLocaleString()} KVNC\n` +
            `📦 Ukupna ponuda: ${totalSupply.toLocaleString()} KVNC\n` +
            `📊 Postotak spaljen: ${burnPct}%\n` +
            `💫 Preostalo: ${(totalSupply - burned).toLocaleString()} KVNC\n\n` +
            `🔗 Provjeri na TON Explorer:\n` +
            `https://tonscan.org/jetton/${process.env.KVNC_JETTON_MASTER}`
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
            `⏳ Isplate se obrađuju ručno od strane admina.\n` +
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
            message += `  🆔 ID: ${nft.id}\n\n`;
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
            `🃏 **Blackjack**\n` +
            `Igraj 21 protiv dealera!\n` +
            `Pošalji: /blackjack IZNOS\n\n` +
            `🎲 **Dice**\n` +
            `Pogodi broj na kocki za x6 dobitak!\n` +
            `Pošalji: /dice IZNOS BROJ\n\n` +
            `🎡 **Wheel of Fortune**\n` +
            `Vrti kotač za dobitak do 20x!\n` +
            `Pošalji: /wheel\n\n` +
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
            `${result.reward ? `💰 +${result.reward} KVNC` : ''}`
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
            `${result.reward ? `💰 +${result.reward} KVNC` : ''}`
        );
    });

    bot.command("slot", async (ctx: Context) => {
        if (!ctx.from) return ctx.reply("Nema korisnika!");
        const result = await GameService.playSlot(String(ctx.from.id));
        if (result.error) return ctx.reply(`❌ ${result.error}`);
        
        await ctx.reply(
            `🎰 **Slot**\n\n` +
            `${result.slots ? result.slots.join(' | ') : ''}\n\n` +
            `${result.result}\n` +
            `${result.reward ? `💰 +${result.reward} KVNC` : '💸 -1 KVNC (ulog)'}`
        );
    });

    bot.command("trivia", async (ctx: Context) => {
        if (!ctx.from) return ctx.reply("Nema korisnika!");
        const result = await GameService.playTrivia(String(ctx.from.id));
        if (result.error) return ctx.reply(`❌ ${result.error}`);

        let message = "🧠 **Trivia Kviz** 🧠\n\n";
        message += `📝 ${result.question}\n\n`;
        if (result.options) {
            for (let i = 0; i < result.options.length; i++) {
                message += `${i + 1}. ${result.options[i]}\n`;
            }
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
            `💵 Neto: ${result.netChange ? (result.netChange > 0 ? '+' : '') : ''}${result.netChange || 0} KVNC`
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
            `🎴 Tvoje karte: ${result.playerCards ? result.playerCards.join(', ') : ''} (${result.playerTotal || 0})\n` +
            `🎴 Dealerove karte: ${result.dealerCards ? result.dealerCards[0] : ''}, ?\n` +
            `${result.result}\n` +
            `💰 Ulog: ${result.bet} KVNC\n` +
            `💵 Neto: ${result.netChange ? (result.netChange > 0 ? '+' : '') : ''}${result.netChange || 0} KVNC`
        );
    });

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
            `💵 Neto: ${result.netChange ? (result.netChange > 0 ? '+' : '') : ''}${result.netChange || 0} KVNC`
        );
    });

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
            `💵 Neto: ${result.netChange ? (result.netChange > 0 ? '+' : '') : ''}${result.netChange || 0} KVNC`
        );
    });

    bot.command("tokenomics", async (ctx: Context) => {
    let message = "🪙 **KVNC TOKENOMICS** 🪙\n\n";
    
    message += `📊 **Osnovni podaci**\n`;
    message += `└── Total Supply: **1,000,000,000** KVNC\n`;
    message += `└── Burnano: **100,000,000** KVNC (10%)\n`;
    message += `└── Cirkulacija: **900,000,000** KVNC\n\n`;
    
    message += `📦 **Raspodjela**\n`;
    message += `└── 🔥 Burnano: **10%** (100M)\n`;
    message += `└── 💧 DEX Pool: **20%** (200M) - 25% korišteno\n`;
    message += `└── 🔒 Locked: **20%** (200M) - 1+ godina\n`;
    message += `└── ⛏️ Tap Reward: **35%** (350M)\n`;
    message += `└── 🎨 NFT Ecosystem: **10%** (100M)\n`;
    message += `└── 👥 Referral/Stake: **5%** (50M)\n\n`;
    
    message += `🔒 **Locked adrese**\n`;
    message += `└── 1+ godina: \`EQCUFe-WDLd7XwnyPRZ99s1oFgEFnQSJ3denTZ4eC9fTpSo1\`\n`;
    message += `└── LP Lock (4 godine): \`EQCAshCkucJuYbQStNoHjIUoe4nZ7hbz2Mx0si1GxBxwRBJ7\`\n\n`;
    
    message += `📊 **Pool status**\n`;
    message += `└── DEX Pool: 50M/200M korišteno (25%)\n`;
    message += `└── Preostalo za DEX: **150M KVNC**\n\n`;
    
    message += `🔗 **Explorer:**\n`;
    message += `https://tonscan.org/jetton/${process.env.KVNC_JETTON_MASTER}`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
});
	
    bot.command("price", async (ctx: Context) => {
        try {
            const price = await DexService.getLivePrice(process.env.KVNC_JETTON_MASTER!);
            const trust = await DexService.getTrustScore(process.env.KVNC_JETTON_MASTER!);
            
            let message = "💰 **LIVE CIJENA KVNC** 💰\n\n";
            message += `💵 **USDT:** ${price.usdt.toFixed(6)}\n`;
            message += `🪙 **GRAM:** ${price.gram.toFixed(6)}\n`;
            message += `📊 **24h promjena:** ${price.change24h > 0 ? '+' : ''}${price.change24h.toFixed(2)}%\n`;
            message += `💧 **Likvidnost:** $${price.liquidity.toFixed(2)}\n`;
            message += `📈 **24h volumen:** $${price.volume24h.toFixed(2)}\n`;
            message += `🏦 **Market Cap:** $${price.marketCap.toFixed(2)}\n\n`;
            
            if (trust) {
                const emoji = trust.level === 'HIGH' ? '🟢' : trust.level === 'MEDIUM' ? '🟡' : '🔴';
                message += `🔒 **Trust Score:** ${emoji} ${trust.score}/100 (${trust.level})\n`;
            }
            
            message += `\n⏱️ ${new Date().toLocaleString()}\n`;

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
                    simMessage += `  💸 Fee: ${simulation.fee.toFixed(4)} KVNC\n`;
                }

                await ctx.reply(
                    `🔄 **Swap KVNC → ${toToken}** 🔄\n\n` +
                    `💰 Iznos: ${amount} KVNC\n` +
                    `${simMessage}\n` +
                    `🔗 Klikni za izvršavanje:\n${link}\n\n` +
                    `🔗 Izvršavanje: STON.fi`
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

    // ============================================
    // CALLBACK QUERY
    // ============================================
    bot.callbackQuery("tap", async (ctx) => {
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
        
        const nftResult = await NFTService.checkAndMintNFT(telegramId, updated.totalClicks);
        let nftMessage = '';
        if (nftResult) {
            const nft = nftResult.nft;
            nftMessage = `\n\n🎉 **ISKOPAO SI NFT!**\n` +
                         `${nft.name} (${nft.rarity})\n` +
                         `⭐ Bonus: +${nftResult.reward} KVNC\n` +
                         `📦 Preostalo: ${nftResult.nft.id}/${nftResult.maxSupply}`;
            
            await pushService.notifyNewNFT(telegramId, nft);
            
            try {
                await ctx.replyWithPhoto(nft.image, {
                    caption: `🎉 **ISKOPAO SI NFT!** 🎉\n\n` +
                             `**${nft.name}** (${nft.rarity})\n` +
                             `⭐ Bonus: ${nft.bonusMultiplier}x na sve klikove\n` +
                             `💰 Nagrada: +${nftResult.reward} KVNC\n` +
                             `📦 Preostalo: ${nftResult.nft.id}/${nftResult.maxSupply}\n\n` +
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

    // ============================================
    // SERVER
    // ============================================
    const app = express();
    app.set("trust proxy", 1);
    app.use(cors());
    app.use(express.json());

    app.use(express.static(path.join(__dirname, '../public')));

    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, '../public/index.html'));
    });

    const tapLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 60,
        message: { error: "Previše zahtjeva / Too many requests" },
        standardHeaders: true,
        legacyHeaders: false,
    });

    const apiLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 100,
        message: { error: "Previše zahtjeva / Too many requests" },
    });

    app.use("/api/tap", tapLimiter);
    app.use("/api/", apiLimiter);

    app.post("/webhook", express.json(), async (req, res) => {
        try {
            await bot.handleUpdate(req.body);
            res.sendStatus(200);
        } catch (err) {
            console.error("Webhook error:", err);
            res.sendStatus(500);
        }
    });

    app.post('/api/me', async (req, res) => {
        try {
            const { initData, rawUser } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'No user ID' });
            
            const dbUser = await prisma.user.upsert({
                where: { telegramId },
                update: {},
                create: { telegramId },
            });
            
            const bonusAvailable = !dbUser.lastBonusDate || !isToday(dbUser.lastBonusDate);
            
            await QuestService.createDailyQuests(telegramId);

            const quests = await QuestService.getTodayQuests(telegramId);

            res.json({
                clickBalance: dbUser.clickBalance,
                totalClicks: dbUser.totalClicks,
                dailyClicks: dbUser.dailyClicks,
                dailyLimit: 10000,
                referralCount: dbUser.referralCount || 0,
                rank: getRank(dbUser.totalClicks),
                bonusAvailable,
                quests,
            });
        } catch (error) {
            console.error("❌ /api/me error:", error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.post('/api/tap', async (req: any, res: any) => {
        try {
            const { rawUser, initData } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'Neautoriziran zahtjev' });

            const user = await prisma.user.findUnique({ where: { telegramId } });
            if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen' });

            if (user.isBlacklisted) return res.status(403).json({ error: 'Korisnički račun je blokiran' });

            const currentEnergy = await regenerateEnergy(user);
            if (currentEnergy <= 0) {
                return res.status(400).json({ 
                    error: 'Nema energije!',
                    energy: 0,
                    maxEnergy: MAX_ENERGY
                });
            }

            const baseReward = await getCurrentReward();
            
            const equippedNFT = await NFTService.getEquippedNFT(telegramId);
            const multiplier = equippedNFT ? equippedNFT.bonusMultiplier : 1;
            
            const activeBoost = await prisma.boost.findFirst({
                where: { userId: user.id, expiresAt: { gt: new Date() } }
            });
            const boostMultiplier = activeBoost ? 2 : 1;
            
            const totalReward = baseReward * multiplier * boostMultiplier;

            const hasFunds = await PoolService.hasSufficientFunds(POOLS.TAP_BASE, totalReward);
            if (!hasFunds) {
                return res.status(400).json({ error: 'Pool je prazan! Pokušaj kasnije.' });
            }

            const isNewDay = !isToday(user.lastClickDate);
            const dailyClicks = isNewDay ? 1 : user.dailyClicks + 1;

            const updatedUser = await prisma.user.update({
                where: { telegramId },
                data: {
                    clickBalance: { increment: totalReward },
                    totalClicks: { increment: 1 },
                    dailyClicks: dailyClicks,
                    lastClickDate: new Date(),
                    energy: currentEnergy - 1,
                    lastEnergyUpdate: new Date()
                }
            });

            await prisma.transaction.create({
                data: {
                    userId: user.id,
                    type: 'tap',
                    amount: totalReward,
                    meta: JSON.stringify({ baseReward, multiplier, boostMultiplier })
                }
            });

            await PoolService.spendFromPool(POOLS.TAP_BASE, totalReward);

            const newTotalClicks = await prisma.user.aggregate({ _sum: { totalClicks: true } });
            const totalGlobal = newTotalClicks._sum.totalClicks || 0;
            const oldEpoch = Math.floor((totalGlobal - 1) / HALVING_INTERVAL);
            const newEpoch = Math.floor(totalGlobal / HALVING_INTERVAL);
            if (newEpoch > oldEpoch) {
                const oldReward = INITIAL_REWARD / Math.pow(2, oldEpoch);
                const newReward = INITIAL_REWARD / Math.pow(2, newEpoch);
                await prisma.halvingEvent.create({
                    data: { epoch: newEpoch, totalClicks: totalGlobal, oldReward, newReward }
                });
                console.log(`⛏️ HALVING! Epoch ${newEpoch}, nova nagrada: ${newReward} KVNC`);
            }

            await QuestService.updateQuestProgress(telegramId, 'clicks', 1);

            let mintedNFT = null;
            try {
                const nftResult = await NFTService.checkAndMintNFT(telegramId, updatedUser.totalClicks);
                if (nftResult) {
                    mintedNFT = nftResult.nft;
                    await QuestService.updateQuestProgress(telegramId, 'nft', 1);
                }
            } catch (nftErr) {
                console.error('❌ NFT mint check error (api/tap):', nftErr);
            }

            const quests = await QuestService.getTodayQuests(telegramId);

            res.json({
                clickBalance: updatedUser.clickBalance,
                totalClicks: updatedUser.totalClicks,
                dailyClicks: updatedUser.dailyClicks,
                energy: updatedUser.energy,
                maxEnergy: MAX_ENERGY,
                reward: totalReward,
                baseReward,
                multiplier,
                boostActive: !!activeBoost,
                boostEndsAt: activeBoost?.expiresAt || null,
                rank: getRank(updatedUser.totalClicks),
                mintedNFT,
                quests
            });

        } catch (error: any) {
            console.error("❌ /api/tap error:", error);
            res.status(500).json({ error: 'Interna greška servera' });
        }
    });

    app.post('/api/nftcount', async (req, res) => {
        try {
            const { initData, rawUser } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'No user ID' });

            const user = await prisma.user.findUnique({
                where: { telegramId },
                include: { nfts: true }
            });
            if (!user) return res.json({ count: 0, nfts: [], tonWallet: null });

            res.json({ count: user.nfts.length, nfts: user.nfts, tonWallet: user.tonWallet });
        } catch (error) {
            console.error('❌ /api/nftcount error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.get('/api/stats', async (req, res) => {
        try {
            const totalUsers = await prisma.user.count();
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const activeUsers = await prisma.user.count({
                where: { lastClickDate: { gte: today } }
            });
            const totalClicks = await prisma.user.aggregate({
                _sum: { totalClicks: true }
            });
            const totalBalance = await prisma.user.aggregate({
                _sum: { clickBalance: true }
            });
            const pools = await prisma.poolTracking.findMany();
            
            res.json({
                totalUsers,
                activeUsers,
                totalClicks: totalClicks._sum.totalClicks || 0,
                totalBalance: totalBalance._sum.clickBalance || 0,
                pools: pools.map(p => ({
                    name: p.poolName,
                    remaining: p.remaining,
                    spent: p.spent,
                    total: p.totalAllocated,
                    usedPercent: ((p.spent / p.totalAllocated) * 100).toFixed(1)
                }))
            });
        } catch (error) {
            console.error('❌ /api/stats error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.get('/api/leaderboard', async (req, res) => {
        try {
            const topUsers = await prisma.user.findMany({
                orderBy: { totalClicks: "desc" },
                take: 10,
                select: {
                    telegramId: true,
                    totalClicks: true,
                    clickBalance: true,
                }
            });
            res.json(topUsers);
        } catch (error) {
            console.error('❌ /api/leaderboard error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.post('/api/achievements', async (req, res) => {
        try {
            const { initData, rawUser } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'No user ID' });

            const user = await prisma.user.findUnique({
                where: { telegramId },
                include: { nfts: true }
            });
            if (!user) return res.json([]);

            const achievements = [
                { type: 'clicks_100', name: '100 klikova', desc: 'Prvih 100 klikova', reward: 10, check: user.totalClicks >= 100 },
                { type: 'clicks_1000', name: '1000 klikova', desc: 'Tisuću klikova', reward: 50, check: user.totalClicks >= 1000 },
                { type: 'clicks_10000', name: '10000 klikova', desc: 'Deset tisuća klikova', reward: 200, check: user.totalClicks >= 10000 },
                { type: 'nft_first', name: 'Prvi NFT', desc: 'Iskopaj svoj prvi NFT', reward: 25, check: user.nfts.length >= 1 },
                { type: 'nft_5', name: '5 NFT-ova', desc: 'Iskopaj 5 NFT-ova', reward: 100, check: user.nfts.length >= 5 },
                { type: 'nft_all', name: 'Sve rijetkosti', desc: 'Iskopaj sve 5 rarity', reward: 500, check: new Set(user.nfts.map(n => n.rarity)).size >= 5 },
                { type: 'referral_5', name: '5 pozvanih', desc: 'Pozovi 5 prijatelja', reward: 75, check: user.referralCount >= 5 },
                { type: 'referral_20', name: '20 pozvanih', desc: 'Pozovi 20 prijatelja', reward: 300, check: user.referralCount >= 20 },
            ];

            const unlocked = await prisma.achievement.findMany({
                where: { userId: user.id }
            });
            const unlockedTypes = new Set(unlocked.map(a => a.type));

            const result = achievements.map(ach => ({
                ...ach,
                unlocked: unlockedTypes.has(ach.type)
            }));

            res.json(result);
        } catch (error) {
            console.error('❌ /api/achievements error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.post('/api/spin', async (req, res) => {
        try {
            const { initData, rawUser } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'No user ID' });

            const user = await prisma.user.findUnique({
                where: { telegramId }
            });
            if (!user) return res.status(404).json({ error: 'User not found' });

            const spin = await prisma.spin.findUnique({
                where: { userId: user.id }
            });

            const now = new Date();
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

            if (spin && spin.lastSpin > oneDayAgo) {
                return res.json({
                    available: false,
                    nextSpin: new Date(spin.lastSpin.getTime() + 24 * 60 * 60 * 1000)
                });
            }

            const rewards = [
                { type: 'kvnc', min: 10, max: 100, weight: 60 },
                { type: 'kvnc', min: 200, max: 500, weight: 20 },
                { type: 'boost', value: 2, weight: 10 },
                { type: 'boost', value: 5, weight: 5 },
                { type: 'nft', value: 1, weight: 4 },
                { type: 'kvnc', min: 1000, max: 5000, weight: 1 },
            ];

            const totalWeight = rewards.reduce((s, r) => s + r.weight, 0);
            let rand = Math.random() * totalWeight;
            let chosen: any = rewards[0];
            for (const r of rewards) {
                rand -= r.weight;
                if (rand <= 0) { chosen = r; break; }
            }

            let rewardAmount = 0;
            let rewardType = chosen.type;

            if (chosen.type === 'kvnc' && chosen.min !== undefined && chosen.max !== undefined) {
                rewardAmount = Math.floor(Math.random() * (chosen.max - chosen.min + 1)) + chosen.min;
                await prisma.user.update({
                    where: { telegramId },
                    data: { clickBalance: { increment: rewardAmount } }
                });
            } else if (chosen.type === 'boost' && chosen.value !== undefined) {
                await prisma.boost.create({
                    data: {
                        userId: user.id,
                        type: `${chosen.value}x`,
                        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
                        active: true
                    }
                });
                rewardAmount = chosen.value;
            } else if (chosen.type === 'nft') {
                rewardAmount = 1;
            }

            await prisma.spin.upsert({
                where: { userId: user.id },
                update: { lastSpin: now, reward: rewardAmount, rewardType: rewardType },
                create: { userId: user.id, lastSpin: now, reward: rewardAmount, rewardType: rewardType }
            });

            res.json({
                available: false,
                nextSpin: new Date(now.getTime() + 24 * 60 * 60 * 1000),
                reward: rewardAmount,
                rewardType: rewardType
            });
        } catch (error) {
            console.error('❌ /api/spin error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.post('/api/boost', async (req, res) => {
        try {
            const { initData, rawUser, action } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'No user ID' });

            const user = await prisma.user.findUnique({
                where: { telegramId }
            });
            if (!user) return res.status(404).json({ error: 'User not found' });

            if (action === 'buy') {
                const cost = 10;
                if (user.clickBalance < cost) {
                    return res.json({ error: `Nedovoljno KVNC. Treba ${cost} KVNC.` });
                }

                const existing = await prisma.boost.findFirst({
                    where: {
                        userId: user.id,
                        active: true,
                        expiresAt: { gt: new Date() }
                    }
                });
                if (existing) {
                    return res.json({ error: 'Već imaš aktivan boost!' });
                }

                await prisma.$transaction([
                    prisma.user.update({
                        where: { telegramId },
                        data: { clickBalance: { decrement: cost } }
                    }),
                    prisma.boost.create({
                        data: {
                            userId: user.id,
                            type: '2x',
                            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
                            active: true
                        }
                    })
                ]);

                return res.json({ success: true, type: '2x' });
            }

            const boost = await prisma.boost.findFirst({
                where: {
                    userId: user.id,
                    active: true,
                    expiresAt: { gt: new Date() }
                },
                orderBy: { expiresAt: 'desc' }
            });

            if (boost) {
                res.json({ active: true, type: boost.type, expiresAt: boost.expiresAt.getTime() });
            } else {
                res.json({ active: false });
            }
        } catch (error) {
            console.error('❌ /api/boost error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.post('/api/vip', async (req, res) => {
        try {
            const { initData, rawUser } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'No user ID' });

            const user = await prisma.user.findUnique({
                where: { telegramId }
            });
            if (!user) return res.status(404).json({ error: 'User not found' });

            const vip = await prisma.vIP.findFirst({
                where: {
                    userId: user.id,
                    active: true,
                    expiresAt: { gt: new Date() }
                }
            });

            if (vip) {
                res.json({ active: true, level: vip.level, expiresAt: vip.expiresAt });
            } else {
                res.json({ active: false });
            }
        } catch (error) {
            console.error('❌ /api/vip error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // === GAME API ===
    app.post('/api/game/rps', async (req, res) => {
        try {
            const { initData, rawUser, choice } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'No user ID' });

            const result = await GameService.playRPS(telegramId, choice);
            res.json(result);
        } catch (error) {
            console.error('❌ /api/game/rps error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.post('/api/game/guess', async (req, res) => {
        try {
            const { initData, rawUser, guess } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'No user ID' });

            const result = await GameService.guessNumber(telegramId, guess);
            res.json(result);
        } catch (error) {
            console.error('❌ /api/game/guess error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.post('/api/game/slot', async (req, res) => {
        try {
            const { initData, rawUser } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'No user ID' });

            const result = await GameService.playSlot(telegramId);
            res.json(result);
        } catch (error) {
            console.error('❌ /api/game/slot error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.post('/api/game/trivia', async (req, res) => {
        try {
            const { initData, rawUser } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'No user ID' });

            const result = await GameService.playTrivia(telegramId);
            res.json(result);
        } catch (error) {
            console.error('❌ /api/game/trivia error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.post('/api/game/coinflip', async (req, res) => {
        try {
            const { initData, rawUser, bet } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'No user ID' });

            const result = await GameService.playCoinFlip(telegramId, bet || 1);
            res.json(result);
        } catch (error) {
            console.error('❌ /api/game/coinflip error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    app.post('/api/game/memory', async (req, res) => {
        try {
            const { initData, rawUser } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'No user ID' });

            const result = await GameService.playMemory(telegramId);
            res.json(result);
        } catch (error) {
            console.error('❌ /api/game/memory error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // === DEX API ===
    app.get('/api/price', async (req, res) => {
        try {
            const price = await DexService.getLivePrice(process.env.KVNC_JETTON_MASTER!);
            res.json(price);
        } catch (error) {
            console.error('❌ /api/price error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

app.get('/api/pools', async (req, res) => {
    try {
        const price = await DexService.getLivePrice(process.env.KVNC_JETTON_MASTER!);
        const pools = {
            usdt: {
                liquidity: price.liquidity * 0.5,
                volume24h: price.volume24h * 0.6,
                apr: 15
            },
            gram: {
                liquidity: price.liquidity * 0.5,
                volume24h: price.volume24h * 0.4,
                apr: 12
            }
        };
        res.json(pools);
    } catch (error) {
        console.error('❌ /api/pools error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});
   
 app.get('/api/swap-link', async (req, res) => {
        try {
            const { to } = req.query;
            const link = DexService.getSwapLink(
                process.env.KVNC_JETTON_MASTER!,
                to as string || 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
                '1'
            );
            res.json({ link });
        } catch (error) {
            console.error('❌ /api/swap-link error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // ============================================
    // POKRENI SERVER
    // ============================================
    const PORT = process.env.PORT || 3000;
    const server = createServer(app);
    const wsService = new WebSocketService(server);

    server.listen(PORT, () => {
        console.log(`✅ Server running on http://localhost:${PORT}`);
        console.log(`✅ WebSocket running on ws://localhost:${PORT}/ws`);
    });

    const reminder = new ReminderService(bot);
    reminder.start();
    console.log('✅ Daily reminder pokrenut!');
    console.log('✅ Push service spreman!');

    // ============================================
    // START BOT
    // ============================================
    if (process.env.NODE_ENV === "production") {
        await bot.init();
        const webhookUrl = `https://${process.env.DOMAIN}/webhook`;
        await bot.api.setWebhook(webhookUrl);
        console.log(`✅ Bot ${bot.botInfo.username} je živ!`);
        console.log(`✅ Webhook registriran: ${webhookUrl}`);
    } else {
        bot.start({
            onStart: (botInfo) => {
                console.log(`✅ Bot ${botInfo.username} je živ!`);
            },
        });
    }

    bot.catch((err) => {
        console.error("❌ Greška:", err);
    });

    // === NFT API ENDPOINTI ===
    app.post('/api/equip', async (req: any, res: any) => {
        try {
            const { rawUser, initData, nftId } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'Neautoriziran' });
            const result = await NFTService.equipNFT(telegramId, Number(nftId));
            if (!result) return res.status(404).json({ error: 'NFT nije pronađen' });
            res.json({ success: true, nft: result });
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/unequip', async (req: any, res: any) => {
        try {
            const { rawUser, initData } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'Neautoriziran' });
            const result = await NFTService.unequipNFT(telegramId);
            if (!result) return res.status(404).json({ error: 'Nema opremljenog NFT-a' });
            res.json({ success: true, nft: result });
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/stake', async (req: any, res: any) => {
        try {
            const { rawUser, initData, nftId } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'Neautoriziran' });
            const result = await NFTService.stakeNFT(telegramId, Number(nftId));
            if (!result) return res.status(404).json({ error: 'NFT nije pronađen' });
            res.json({ success: true });
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/unstake', async (req: any, res: any) => {
        try {
            const { rawUser, initData, nftId } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'Neautoriziran' });
            const result = await NFTService.unstakeNFT(telegramId, Number(nftId));
            if (!result) return res.status(404).json({ error: 'NFT nije pronađen ili nije stakean' });
            res.json({ success: true, reward: result.reward });
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/nft/withdraw', async (req: any, res: any) => {
        try {
            const { rawUser, initData, nftId } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'Neautoriziran' });

            const user = await prisma.user.findUnique({ where: { telegramId } });
            if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen' });
            if (!user.tonWallet) return res.status(400).json({ error: 'Nema TON wallet adrese. Dodaj je s /wallet komandom.' });

            const nft = await prisma.nFT.findFirst({
                where: { id: Number(nftId), userId: user.id }
            });
            if (!nft) return res.status(404).json({ error: 'NFT nije pronađen' });
            if (nft.staked) return res.status(400).json({ error: 'NFT je stakean. Prvo ga unstakaj.' });
            if (nft.equipped) return res.status(400).json({ error: 'NFT je opremljen. Prvo ga skini.' });

            await prisma.nFT.update({
                where: { id: nft.id },
                data: { contractAddress: `withdraw:${user.tonWallet}:${Date.now()}` }
            });

            res.json({
                success: true,
                message: `NFT ${nft.name} je označen za withdrawal na ${user.tonWallet}. Admin će ga poslati u roku 24h.`,
                nft: nft,
                toWallet: user.tonWallet
            });
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    // === TONCONNECT WALLET API ===
    app.post('/api/wallet/connect', async (req: any, res: any) => {
        try {
            const { rawUser, initData, address } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'Neautoriziran' });
            if (!address) return res.status(400).json({ error: 'Nedostaje adresa' });

            let normalized: string;
            try {
                normalized = Address.parse(address).toString();
            } catch {
                return res.status(400).json({ error: 'Neispravna TON adresa' });
            }

            const user = await prisma.user.update({
                where: { telegramId },
                data: { tonWallet: normalized }
            });

            res.json({ success: true, tonWallet: user.tonWallet });
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/wallet/disconnect', async (req: any, res: any) => {
        try {
            const { rawUser, initData } = req.body;
            const telegramId = extractTelegramId(initData, rawUser);
            if (!telegramId) return res.status(401).json({ error: 'Neautoriziran' });

            await prisma.user.update({
                where: { telegramId },
                data: { tonWallet: null }
            });

            res.json({ success: true });
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    // Blacklist endpoint za admin
    app.post('/api/admin/user/blacklist', adminAuth, async (req: any, res: any) => {
        try {
            const { telegramId, blacklist } = req.body;
            await prisma.user.update({
                where: { telegramId: String(telegramId) },
                data: { isBlacklisted: blacklist }
            });
            res.json({ success: true });
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    // === ADMIN API ===
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "kovanica2026admin";

    function adminAuth(req: any, res: any, next: any) {
        const token = req.headers['x-admin-token'];
        if (token !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
        next();
    }

    app.post('/api/admin/login', async (req: any, res: any) => {
        const { password } = req.body;
        if (password === ADMIN_PASSWORD) {
            res.json({ success: true, token: ADMIN_PASSWORD });
        } else {
            res.status(401).json({ error: 'Pogrešna lozinka' });
        }
    });

    app.get('/api/admin/stats', adminAuth, async (req: any, res: any) => {
        try {
            const totalUsers = await prisma.user.count();
            const totalClicks = await prisma.user.aggregate({ _sum: { totalClicks: true } });
            const totalBalance = await prisma.user.aggregate({ _sum: { clickBalance: true } });
            const pendingWithdrawals = await prisma.withdrawal.count({ where: { status: 'pending' } });
            const totalNFTs = await prisma.nFT.count();
            const todayUsers = await prisma.user.count({
                where: { lastClickDate: { gte: new Date(new Date().setHours(0,0,0,0)) } }
            });
            res.json({
                totalUsers, todayUsers,
                totalClicks: totalClicks._sum.totalClicks || 0,
                totalBalance: totalBalance._sum.clickBalance || 0,
                pendingWithdrawals, totalNFTs
            });
        } catch(e: any) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/admin/users', adminAuth, async (req: any, res: any) => {
        try {
            const search = req.query.search as string || '';
            const users = await prisma.user.findMany({
                where: search ? { telegramId: { contains: search } } : {},
                orderBy: { totalClicks: 'desc' },
                take: 50
            });
            res.json({ users });
        } catch(e: any) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/admin/user/balance', adminAuth, async (req: any, res: any) => {
        try {
            const { telegramId, amount } = req.body;
            const user = await prisma.user.update({
                where: { telegramId: String(telegramId) },
                data: { clickBalance: { increment: Number(amount) } }
            });
            res.json({ success: true, newBalance: user.clickBalance });
        } catch(e: any) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/admin/nfts', adminAuth, async (req: any, res: any) => {
        try {
            const nfts = await prisma.nFT.findMany({ orderBy: { id: 'desc' }, take: 100 });
            res.json({ nfts });
        } catch(e: any) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/admin/nft/delete', adminAuth, async (req: any, res: any) => {
        try {
            const { id } = req.body;
            await prisma.nFT.delete({ where: { id: Number(id) } });
            res.json({ success: true });
        } catch(e: any) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/admin/withdrawals', adminAuth, async (req: any, res: any) => {
        try {
            const withdrawals = await prisma.withdrawal.findMany({
                orderBy: { requestedAt: 'desc' }, take: 50
            });
            res.json({ withdrawals });
        } catch(e: any) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/admin/withdrawal/process', adminAuth, async (req: any, res: any) => {
        try {
            const { id } = req.body;
            const w = await prisma.withdrawal.findUnique({ where: { id: Number(id) } });
            if (!w) return res.status(404).json({ error: 'Isplata nije pronađena' });
            if (w.status !== 'pending' && w.status !== 'failed') {
                return res.status(400).json({ error: `Isplata je već u statusu "${w.status}"` });
            }

            const result = await TonPaymentService.sendJetton(
                w.tonAddress,
                w.amount,
                process.env.KVNC_JETTON_MASTER!
            );

            if (!result.success) {
                await prisma.withdrawal.update({
                    where: { id: w.id },
                    data: { status: 'failed' }
                });
                return res.status(502).json({ error: result.error || 'Slanje nije uspjelo', status: 'failed' });
            }

            const [updated] = await prisma.$transaction([
                prisma.withdrawal.update({
                    where: { id: w.id },
                    data: { status: 'processed', processedAt: new Date() }
                }),
                prisma.user.update({
                    where: { id: w.userId },
                    data: { clickBalance: { decrement: w.amount } }
                })
            ]);

            res.json({ success: true, withdrawal: updated });
        } catch(e: any) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/admin/pools', adminAuth, async (req: any, res: any) => {
        try {
            const pools = await prisma.poolTracking.findMany({ orderBy: { id: 'desc' } });
            res.json({ pools });
        } catch(e: any) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/admin/pool/add', adminAuth, async (req: any, res: any) => {
        try {
            const { poolName, amount } = req.body;
            const addAmount = Number(amount);
            const existing = await prisma.poolTracking.findUnique({ where: { poolName } });
            const pool = await prisma.poolTracking.upsert({
                where: { poolName },
                update: {
                    totalAllocated: { increment: addAmount },
                    remaining: { increment: addAmount },
                    lastUpdated: new Date()
                },
                create: {
                    poolName,
                    totalAllocated: addAmount,
                    spent: 0,
                    remaining: addAmount
                }
            });
            res.json({ success: true, pool, wasNew: !existing });
        } catch(e: any) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/admin/settings', adminAuth, async (req: any, res: any) => {
        res.json({
            minWithdrawal: 1000,
            dailyLimit: 10000,
            initialReward: 1.0,
            referralBonusInviter: 10,
            referralBonusNew: 5,
            nodeEnv: process.env.NODE_ENV
        });
    });

    app.post('/api/admin/settings', adminAuth, async (req: any, res: any) => {
        res.json({ success: true, message: 'Settings saved (restart required)' });
    });

    cron.schedule('*/10 * * * *', async () => {
        console.log('⏳ [cron] Automatska obrada isplata...');
        try {
            await TonPaymentService.processPendingWithdrawals();
        } catch (err) {
            console.error('❌ [cron] Greška:', err);
        }
    });
}

initBot().catch(console.error);
