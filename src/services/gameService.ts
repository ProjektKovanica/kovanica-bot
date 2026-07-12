import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export class GameService {
    // ============================================
    // KAMEN-ŠKARE-PAPIR
    // ============================================
    static async playRPS(telegramId: string, playerChoice: string) {
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return { error: "Korisnik nije pronađen." };

        const choices = ['kamen', 'škare', 'papir'];
        const botChoice = choices[Math.floor(Math.random() * choices.length)];
        let result = '';
        let reward = 0;

        if (playerChoice === botChoice) {
            result = '🤝 Neriješeno!';
        } else if (
            (playerChoice === 'kamen' && botChoice === 'škare') ||
            (playerChoice === 'škare' && botChoice === 'papir') ||
            (playerChoice === 'papir' && botChoice === 'kamen')
        ) {
            result = '🎉 Pobjeda!';
            reward = 2;
        } else {
            result = '😢 Poraz!';
        }

        if (reward > 0) {
            await prisma.user.update({
                where: { telegramId },
                data: { clickBalance: { increment: reward } }
            });
        }

        return {
            playerChoice,
            botChoice,
            result,
            reward
        };
    }

    // ============================================
    // POGODI BROJ
    // ============================================
    static async guessNumber(telegramId: string, guess: number) {
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return { error: "Korisnik nije pronađen." };

        const target = Math.floor(Math.random() * 10) + 1;
        let result = '';
        let reward = 0;

        if (guess === target) {
            result = '🎉 Pogodio si! +5 KVNC';
            reward = 5;
        } else {
            result = `❌ Netočno. Cilj je bio ${target}.`;
        }

        if (reward > 0) {
            await prisma.user.update({
                where: { telegramId },
                data: { clickBalance: { increment: reward } }
            });
        }

        return {
            guess,
            target,
            result,
            reward
        };
    }

    // ============================================
    // SLOT
    // ============================================
    static async playSlot(telegramId: string) {
        const COST = 1;
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return { error: "Korisnik nije pronađen." };
        if (user.clickBalance < COST) return { error: `Nemaš dovoljno KVNC. Potrebno: ${COST} KVNC` };

        const symbols = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣'];
        const slots = [
            symbols[Math.floor(Math.random() * symbols.length)],
            symbols[Math.floor(Math.random() * symbols.length)],
            symbols[Math.floor(Math.random() * symbols.length)]
        ];

        let reward = 0;
        let result = '';

        // Provjera dobitaka
        if (slots[0] === slots[1] && slots[1] === slots[2]) {
            // Sva tri ista
            if (slots[0] === '7️⃣') {
                reward = 100;
                result = '🎰 JACKPOT! +100 KVNC';
            } else if (slots[0] === '💎') {
                reward = 50;
                result = '🎰 DIJAMANT! +50 KVNC';
            } else {
                reward = 10;
                result = `🎰 Tri ${slots[0]}! +10 KVNC`;
            }
        } else if (slots[0] === slots[1] || slots[1] === slots[2] || slots[0] === slots[2]) {
            reward = 2;
            result = '🎰 Dva ista! +2 KVNC';
        } else {
            result = '😢 Ništa. -1 KVNC';
        }

        const netChange = reward - COST;
        await prisma.user.update({
            where: { telegramId },
            data: { clickBalance: { increment: netChange } }
        });

        return {
            slots,
            result,
            reward,
            netChange
        };
    }

    // ============================================
    // TRIVIA (KVIZ)
    // ============================================
    static async playTrivia(telegramId: string) {
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return { error: "Korisnik nije pronađen." };

        // Jednostavna pitanja
        const questions = [
            {
                question: "Koji je glavni grad Hrvatske?",
                options: ["Zagreb", "Split", "Rijeka", "Osijek"],
                correct: 0
            },
            {
                question: "Koja je najveća planeta u Sunčevom sustavu?",
                options: ["Saturn", "Jupiter", "Neptun", "Uran"],
                correct: 1
            },
            {
                question: "Tko je napisao 'Orlando'?",
                options: ["Virginia Woolf", "James Joyce", "William Faulkner", "Ernest Hemingway"],
                correct: 0
            }
        ];

        const q = questions[Math.floor(Math.random() * questions.length)];
        const reward = 3;

        // Spremi trenutno pitanje za korisnika (možeš koristiti cache, ali za sada samo vrati)
        // U stvarnom scenariju bi trebao spremiti stanje po korisniku, ali ovdje samo vraćamo pitanje.
        return {
            question: q.question,
            options: q.options,
            correct: q.correct,
            reward
        };
    }

    // ============================================
    // COIN FLIP
    // ============================================
    static async playCoinFlip(telegramId: string, bet: number) {
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return { error: "Korisnik nije pronađen." };
        if (user.clickBalance < bet) return { error: `Nemaš dovoljno KVNC. Stanje: ${user.clickBalance.toFixed(2)}` };
        if (bet < 1) return { error: "Minimalni ulog je 1 KVNC." };

        const outcome = Math.random() < 0.5 ? 'glava' : 'pismo';
        const win = outcome === 'glava'; // Pretpostavimo da korisnik uvijek bira glavu? Zapravo, u botu nema izbora, ali mi ćemo reći da je pobjeda ako padne glava.
        // Pošto u komandi nema odabira, neka bude jednostavno: 50% šanse.
        const netChange = win ? bet : -bet;

        await prisma.user.update({
            where: { telegramId },
            data: { clickBalance: { increment: netChange } }
        });

        return {
            result: outcome,
            win,
            bet,
            netChange
        };
    }

    // ============================================
    // MEMORY
    // ============================================
    static async playMemory(telegramId: string) {
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return { error: "Korisnik nije pronađen." };

        // Generiraj niz od 4 broja
        const sequence = [];
        for (let i = 0; i < 4; i++) {
            sequence.push(Math.floor(Math.random() * 9) + 1);
        }
        const reward = 2;

        // Spremi sekvencu za korisnika (u stvarnosti bi trebao spremiti u cache)
        // Ovdje samo vraćamo sekvencu da je korisnik vidi.
        return {
            sequence: sequence.join(' '),
            reward
        };
    }

    // ============================================
    // BLACKJACK (NOVO)
    // ============================================
    static async playBlackjack(telegramId: string, bet: number) {
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return { error: "Korisnik nije pronađen." };
        if (user.clickBalance < bet) return { error: `Nemaš dovoljno KVNC. Stanje: ${user.clickBalance.toFixed(2)}` };
        if (bet < 1) return { error: "Minimalni ulog je 1 KVNC." };

        const deck = [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10, 11];
        const drawCard = () => deck[Math.floor(Math.random() * deck.length)];

        const playerCards = [drawCard(), drawCard()];
        const dealerCards = [drawCard(), drawCard()];

        const calculateTotal = (cards: number[]) => {
            let total = cards.reduce((a, b) => a + b, 0);
            while (total > 21 && cards.includes(11)) {
                total -= 10;
                cards[cards.indexOf(11)] = 1;
            }
            return total;
        };

        let playerTotal = calculateTotal(playerCards);
        let dealerTotal = calculateTotal(dealerCards);

        while (dealerTotal < 17) {
            dealerCards.push(drawCard());
            dealerTotal = calculateTotal(dealerCards);
        }

        let result = "";
        let netChange = 0;

        if (playerTotal === 21 && playerCards.length === 2) {
            result = "🎉 Blackjack! Pobjeda!";
            netChange = bet * 1.5;
        } else if (playerTotal > 21) {
            result = "💀 Prešao si 21. Gubiš!";
            netChange = -bet;
        } else if (dealerTotal > 21) {
            result = "🎉 Dealer je prešao 21. Pobjeda!";
            netChange = bet;
        } else if (playerTotal > dealerTotal) {
            result = "🎉 Pobjeda!";
            netChange = bet;
        } else if (playerTotal < dealerTotal) {
            result = "😢 Poraz.";
            netChange = -bet;
        } else {
            result = "🤝 Izjednačeno (push). Ulog vraćen.";
            netChange = 0;
        }

        await prisma.user.update({
            where: { telegramId },
            data: { clickBalance: { increment: netChange } }
        });

        return {
            playerCards,
            dealerCards,
            playerTotal,
            dealerTotal,
            bet,
            netChange,
            result
        };
    }

    // ============================================
    // DICE (NOVO)
    // ============================================
    static async playDice(telegramId: string, bet: number, guess: number) {
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return { error: "Korisnik nije pronađen." };
        if (user.clickBalance < bet) return { error: `Nemaš dovoljno KVNC. Stanje: ${user.clickBalance.toFixed(2)}` };
        if (bet < 1) return { error: "Minimalni ulog je 1 KVNC." };
        if (guess < 1 || guess > 6) return { error: "Pogodi broj između 1 i 6." };

        const roll = Math.floor(Math.random() * 6) + 1;
        const win = guess === roll;
        const multiplier = 5;
        const netChange = win ? bet * multiplier : -bet;

        await prisma.user.update({
            where: { telegramId },
            data: { clickBalance: { increment: netChange } }
        });

        return {
            guess,
            roll,
            win,
            bet,
            netChange,
            result: win ? `🎉 POGODIO! +${bet * multiplier} KVNC` : `😢 Nisi pogodio. -${bet} KVNC`
        };
    }

    // ============================================
    // WHEEL (NOVO)
    // ============================================
    static async playWheel(telegramId: string) {
        const COST = 5;
        const user = await prisma.user.findUnique({ where: { telegramId } });
        if (!user) return { error: "Korisnik nije pronađen." };
        if (user.clickBalance < COST) return { error: `Nemaš dovoljno KVNC. Potrebno: ${COST} KVNC` };

        const segments = [
            { label: "1x", multiplier: 1 },
            { label: "2x", multiplier: 2 },
            { label: "3x", multiplier: 3 },
            { label: "5x", multiplier: 5 },
            { label: "10x", multiplier: 10 },
            { label: "20x", multiplier: 20 },
            { label: "LOSE", multiplier: 0 },
        ];

        const weighted = [
            ...Array(20).fill(segments[0]),
            ...Array(15).fill(segments[1]),
            ...Array(10).fill(segments[2]),
            ...Array(5).fill(segments[3]),
            ...Array(3).fill(segments[4]),
            ...Array(2).fill(segments[5]),
            ...Array(5).fill(segments[6]),
        ];

        const pick = weighted[Math.floor(Math.random() * weighted.length)];
        const reward = pick.multiplier * COST;
        const netChange = reward - COST;

        await prisma.user.update({
            where: { telegramId },
            data: { clickBalance: { increment: netChange } }
        });

        return {
            segment: pick.label,
            multiplier: pick.multiplier,
            reward,
            cost: COST,
            netChange,
            result: pick.multiplier === 0 ? "😢 Ništa nisi osvojio." : `🎉 Osvojio si ${reward} KVNC!`
        };
    }
}
