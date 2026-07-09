import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class GameService {
    // === GAME 1: KAMEN-ŠKARE-PAPIR ===
    static async playRPS(userId: string, choice: string): Promise<any> {
        const user = await prisma.user.findUnique({
            where: { telegramId: userId }
        });
        if (!user) return { error: 'User not found' };

        const options = ['kamen', 'škare', 'papir'];
        const botChoice = options[Math.floor(Math.random() * 3)];

        let result = '';
        let reward = 0;

        if (choice === botChoice) {
            result = '🤝 Izjednačeno!';
            reward = 0;
        } else if (
            (choice === 'kamen' && botChoice === 'škare') ||
            (choice === 'škare' && botChoice === 'papir') ||
            (choice === 'papir' && botChoice === 'kamen')
        ) {
            result = '🎉 POBJEDA!';
            reward = 2;
            await prisma.user.update({
                where: { telegramId: userId },
                data: { clickBalance: { increment: reward } }
            });
        } else {
            result = '💀 Poraz!';
            reward = 0;
        }

        return {
            game: 'kamen-škare-papir',
            playerChoice: choice,
            botChoice: botChoice,
            result: result,
            reward: reward,
        };
    }

    // === GAME 2: POGODI BROJ ===
    static async guessNumber(userId: string, guess: number): Promise<any> {
        const user = await prisma.user.findUnique({
            where: { telegramId: userId }
        });
        if (!user) return { error: 'User not found' };

        const target = Math.floor(Math.random() * 10) + 1;
        let reward = 0;
        let result = '';

        if (guess === target) {
            result = '🎉 POGODIO SI!';
            reward = 5;
            await prisma.user.update({
                where: { telegramId: userId },
                data: { clickBalance: { increment: reward } }
            });
        } else {
            result = `❌ Netočno! Bio je ${target}.`;
            reward = 0;
        }

        return {
            game: 'pogodi-broj',
            guess: guess,
            target: target,
            result: result,
            reward: reward,
        };
    }

    // === GAME 3: SLOT ===
    static async playSlot(userId: string): Promise<any> {
        const user = await prisma.user.findUnique({
            where: { telegramId: userId }
        });
        if (!user) return { error: 'User not found' };

        if (user.clickBalance < 1) {
            return { error: 'Nedovoljno KVNC! Treba 1 KVNC.' };
        }

        await prisma.user.update({
            where: { telegramId: userId },
            data: { clickBalance: { decrement: 1 } }
        });

        const symbols = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣'];
        const slots = [
            symbols[Math.floor(Math.random() * 6)],
            symbols[Math.floor(Math.random() * 6)],
            symbols[Math.floor(Math.random() * 6)]
        ];

        let reward = 0;
        let result = '';

        if (slots[0] === slots[1] && slots[1] === slots[2]) {
            if (slots[0] === '💎') {
                reward = 100;
                result = '💎 JACKPOT! 100 KVNC!';
            } else if (slots[0] === '7️⃣') {
                reward = 50;
                result = '7️⃣ TRI 7! 50 KVNC!';
            } else {
                reward = 10;
                result = '🎉 TRI ISTA! 10 KVNC!';
            }
        } else if (slots[0] === slots[1] || slots[1] === slots[2] || slots[0] === slots[2]) {
            reward = 2;
            result = '👏 DVA ISTA! 2 KVNC!';
        } else {
            result = '😢 Ništa. Pokušaj ponovno!';
        }

        if (reward > 0) {
            await prisma.user.update({
                where: { telegramId: userId },
                data: { clickBalance: { increment: reward } }
            });
        }

        return {
            game: 'slot',
            slots: slots,
            result: result,
            reward: reward,
            cost: 1,
        };
    }

    // === GAME 4: TRIVIA ===
    static async playTrivia(userId: string): Promise<any> {
        const user = await prisma.user.findUnique({
            where: { telegramId: userId }
        });
        if (!user) return { error: 'User not found' };

        const questions = [
            {
                question: 'Koja je godina osnovan TON blockchain?',
                options: ['2018', '2019', '2020', '2021'],
                answer: 0
            },
            {
                question: 'Koji je native token TON blockchaina?',
                options: ['TON', 'GRAM', 'KVNC', 'USDT'],
                answer: 1
            },
            {
                question: 'Tko je osnovao Telegram?',
                options: ['Pavel Durov', 'Vitalik Buterin', 'Satoshi Nakamoto', 'Elon Musk'],
                answer: 0
            },
            {
                question: 'Koliko traje jedan blok na TON-u?',
                options: ['1s', '2s', '3s', '4s'],
                answer: 0
            },
            {
                question: 'Kako se zove tvoj token?',
                options: ['TON', 'GRAM', 'KVNC', 'BTC'],
                answer: 2
            }
        ];

        const q = questions[Math.floor(Math.random() * questions.length)];
        
        return {
            game: 'trivia',
            question: q.question,
            options: q.options,
            answer: q.answer,
            reward: 3
        };
    }

    // === GAME 5: COIN FLIP ===
    static async playCoinFlip(userId: string, bet: number): Promise<any> {
        const user = await prisma.user.findUnique({
            where: { telegramId: userId }
        });
        if (!user) return { error: 'User not found' };

        if (bet < 1 || bet > user.clickBalance) {
            return { error: `Nedovoljno KVNC! Imaš: ${user.clickBalance}` };
        }

        const result = Math.random() < 0.5 ? 'glava' : 'pismo';
        const win = Math.random() < 0.5;

        let reward = 0;
        if (win) {
            reward = bet * 2;
            await prisma.user.update({
                where: { telegramId: userId },
                data: { clickBalance: { increment: reward } }
            });
        } else {
            await prisma.user.update({
                where: { telegramId: userId },
                data: { clickBalance: { decrement: bet } }
            });
        }

        return {
            game: 'coin-flip',
            bet: bet,
            result: result,
            win: win,
            reward: reward,
            netChange: win ? bet : -bet
        };
    }

    // === GAME 6: MEMORY ===
    static async playMemory(userId: string): Promise<any> {
        const user = await prisma.user.findUnique({
            where: { telegramId: userId }
        });
        if (!user) return { error: 'User not found' };

        const sequence = Array.from({ length: 5 }, () => Math.floor(Math.random() * 10));
        const sequenceStr = sequence.join(' ');

        return {
            game: 'memory',
            sequence: sequenceStr,
            reward: 2
        };
    }

    // === GAME 7: BLACKJACK (21) ===
    static async playBlackjack(userId: string, bet: number): Promise<any> {
        const user = await prisma.user.findUnique({
            where: { telegramId: userId }
        });
        if (!user) return { error: 'User not found' };

        if (bet < 1 || bet > user.clickBalance) {
            return { error: `Nedovoljno KVNC! Imaš: ${user.clickBalance}` };
        }

        // Igrač dobiva dvije karte
        const playerCards = [
            Math.floor(Math.random() * 10) + 1,
            Math.floor(Math.random() * 10) + 1
        ];
        const dealerCards = [
            Math.floor(Math.random() * 10) + 1,
            Math.floor(Math.random() * 10) + 1
        ];

        const playerTotal = playerCards.reduce((a, b) => a + b, 0);
        const dealerTotal = dealerCards.reduce((a, b) => a + b, 0);

        let result = '';
        let reward = 0;

        // Provjeri blackjack
        if (playerTotal === 21 && dealerTotal === 21) {
            result = '🤝 Izjednačeno! (Blackjack)';
            reward = bet;
        } else if (playerTotal === 21) {
            result = '🎉 BLACKJACK!';
            reward = bet * 2.5;
        } else if (dealerTotal === 21) {
            result = '💀 Dealer ima Blackjack!';
            reward = 0;
        } else if (playerTotal > 21) {
            result = '💀 Prešao si 21!';
            reward = 0;
        } else if (dealerTotal > 21) {
            result = '🎉 Dealer je prešao 21!';
            reward = bet * 2;
        } else if (playerTotal > dealerTotal) {
            result = '🎉 POBJEDA!';
            reward = bet * 2;
        } else if (playerTotal < dealerTotal) {
            result = '💀 Poraz!';
            reward = 0;
        } else {
            result = '🤝 Izjednačeno!';
            reward = bet;
        }

        if (reward > 0) {
            await prisma.user.update({
                where: { telegramId: userId },
                data: { clickBalance: { increment: reward } }
            });
        } else if (reward === 0 && playerTotal <= 21) {
            // Ako je izgubio, oduzmi ulog
            await prisma.user.update({
                where: { telegramId: userId },
                data: { clickBalance: { decrement: bet } }
            });
        }

        return {
            game: 'blackjack',
            playerCards: playerCards,
            dealerCards: dealerCards,
            playerTotal: playerTotal,
            dealerTotal: dealerTotal,
            result: result,
            reward: reward,
            bet: bet,
            netChange: reward > 0 ? reward - bet : -bet
        };
    }

    // === GAME 8: DICE ===
    static async playDice(userId: string, bet: number, guess: number): Promise<any> {
        const user = await prisma.user.findUnique({
            where: { telegramId: userId }
        });
        if (!user) return { error: 'User not found' };

        if (bet < 1 || bet > user.clickBalance) {
            return { error: `Nedovoljno KVNC! Imaš: ${user.clickBalance}` };
        }
        if (guess < 1 || guess > 6) {
            return { error: 'Pogodi broj između 1 i 6!' };
        }

        const roll = Math.floor(Math.random() * 6) + 1;
        const win = guess === roll;

        let reward = 0;
        if (win) {
            reward = bet * 6;
            await prisma.user.update({
                where: { telegramId: userId },
                data: { clickBalance: { increment: reward } }
            });
        } else {
            await prisma.user.update({
                where: { telegramId: userId },
                data: { clickBalance: { decrement: bet } }
            });
        }

        return {
            game: 'dice',
            bet: bet,
            guess: guess,
            roll: roll,
            win: win,
            reward: reward,
            netChange: win ? reward - bet : -bet
        };
    }

    // === GAME 9: WHEEL OF FORTUNE ===
    static async playWheel(userId: string): Promise<any> {
        const user = await prisma.user.findUnique({
            where: { telegramId: userId }
        });
        if (!user) return { error: 'User not found' };

        if (user.clickBalance < 5) {
            return { error: 'Treba 5 KVNC za spin!' };
        }

        await prisma.user.update({
            where: { telegramId: userId },
            data: { clickBalance: { decrement: 5 } }
        });

        const segments = [
            { label: '💎 JACKPOT', multiplier: 20, weight: 1 },
            { label: '🎉 2x', multiplier: 2, weight: 10 },
            { label: '💰 1.5x', multiplier: 1.5, weight: 15 },
            { label: '🔄 1x', multiplier: 1, weight: 20 },
            { label: '😢 0.5x', multiplier: 0.5, weight: 20 },
            { label: '💀 Bankrot', multiplier: 0, weight: 10 },
            { label: '🎁 Bonus', multiplier: 3, weight: 5 },
            { label: '🔥 5x', multiplier: 5, weight: 2 },
        ];

        const totalWeight = segments.reduce((s, seg) => s + seg.weight, 0);
        let rand = Math.random() * totalWeight;
        let chosen = segments[0];
        for (const seg of segments) {
            rand -= seg.weight;
            if (rand <= 0) { chosen = seg; break; }
        }

        let reward = 0;
        if (chosen.multiplier > 0) {
            reward = Math.floor(5 * chosen.multiplier);
            await prisma.user.update({
                where: { telegramId: userId },
                data: { clickBalance: { increment: reward } }
            });
        }

        return {
            game: 'wheel',
            segment: chosen.label,
            multiplier: chosen.multiplier,
            reward: reward,
            cost: 5,
            netChange: reward - 5
        };
    }
}
