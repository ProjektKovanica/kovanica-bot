import { TonClient, WalletContractV4, internal, JettonMaster, JettonWallet } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { Address, toNano, beginCell } from "@ton/core";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const client = new TonClient({
    endpoint: process.env.TON_RPC_URL || 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TON_API_KEY || '',
});

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export class TonPaymentService {
    static async sendJetton(
        toAddress: string,
        amount: number,
        jettonMasterAddress: string
    ): Promise<{ success: boolean; txHash?: string; error?: string }> {
        try {
            console.log(`📤 Slanje ${amount} KVNC na ${toAddress}`);
            
            await sleep(1000);
            
            // 1. Učitaj mnemonic iz .env
            const mnemonic = process.env.WITHDRAWAL_MNEMONIC;
            if (!mnemonic) {
                return { success: false, error: 'WITHDRAWAL_MNEMONIC nije postavljen' };
            }
            
            const mnemonicArray = mnemonic.split(' ');
            const key = await mnemonicToPrivateKey(mnemonicArray);
            
            // 2. Kreiraj wallet iz mnemonic-a
            const wallet = WalletContractV4.create({
                publicKey: key.publicKey,
                workchain: 0,
            });
            
            const sender = client.open(wallet);
            const senderAddress = sender.address;
            console.log(`📤 WALLET: ${senderAddress.toString()}`);
            
            // 3. Provjeri TON balans za gas
            const balance = await sender.getBalance();
            console.log(`💰 TON balans: ${Number(balance) / 1_000_000_000} TON`);
            
            if (Number(balance) < 0.05 * 1_000_000_000) {
                return { 
                    success: false, 
                    error: `Nedovoljno TON za gas. Imaš: ${Number(balance) / 1_000_000_000} TON. Pošalji 0.1 TON na: ${senderAddress.toString()}` 
                };
            }
            
            // 4. Dohvati Jetton Master
            const jettonMasterAddr = Address.parse(jettonMasterAddress);
            const toAddr = Address.parse(toAddress);
            
            const jettonMaster = client.open(JettonMaster.create(jettonMasterAddr));
            
            // 5. Dohvati Jetton wallet od pošiljatelja
            const userJettonWalletAddress = await jettonMaster.getWalletAddress(senderAddress);
            console.log(`📤 Jetton Wallet: ${userJettonWalletAddress.toString()}`);
            
            // 6. Dohvati Jetton wallet od primatelja
            const recipientJettonWalletAddress = await jettonMaster.getWalletAddress(toAddr);
            console.log(`📥 Primateljev Jetton Wallet: ${recipientJettonWalletAddress.toString()}`);
            
            // 7. Provjeri KVNC balans
            const userJettonWallet = client.open(JettonWallet.create(userJettonWalletAddress));
            const jettonBalance = await userJettonWallet.getBalance();
            console.log(`💰 KVNC balans: ${Number(jettonBalance) / 1_000_000_000} KVNC`);
            
            const transferAmount = BigInt(Math.floor(amount * 1_000_000_000));
            if (jettonBalance < transferAmount) {
                return { success: false, error: `Nedovoljno KVNC. Imaš: ${Number(jettonBalance) / 1_000_000_000}` };
            }
            
            // 8. Kreiraj Jetton transfer poruku
            const transferBody = beginCell()
                .storeUint(0xf8a7ea5, 32)      // Op_code za JettonTransfer
                .storeUint(0, 64)               // Query ID
                .storeCoins(transferAmount)     // Iznos za slanje
                .storeAddress(toAddr)           // Destinacija
                .storeAddress(senderAddress)    // Response dest
                .storeUint(0, 1)                // Custom payload (null)
                .storeCoins(toNano('0.01'))     // Forward TON amount
                .storeUint(0, 1)                // Forward payload (null)
                .endCell();
            
            // 9. Pošalji transakciju
            const seqno = await sender.getSeqno();
            console.log(`📊 Seqno: ${seqno}`);
            
            await sender.sendTransfer({
                secretKey: key.secretKey,
                seqno: seqno,
                messages: [
                    internal({
                        to: userJettonWalletAddress,
                        value: toNano('0.05'),
                        body: transferBody,
                        bounce: true,
                    }),
                ],
            });
            
            console.log(`✅ Jetton transfer uspješan!`);
            return { success: true, txHash: 'sent' };
            
        } catch (error: any) {
            console.error('❌ Greška:', error);
            return { success: false, error: error.message || 'Nepoznata greška' };
        }
    }

    // Automatska obrada pending isplata
    static async processPendingWithdrawals() {
        try {
            const pending = await prisma.withdrawal.findMany({
                where: { status: 'pending' },
                include: { user: true },
                orderBy: { requestedAt: 'asc' }
            });

            console.log(`📊 Pronađeno ${pending.length} pending isplata`);

            for (const w of pending) {
                console.log(`🔄 Obrada isplate #${w.id} za ${w.user.telegramId}`);

                const result = await this.sendJetton(
                    w.tonAddress,
                    w.amount,
                    process.env.KVNC_JETTON_MASTER!
                );

                if (result.success) {
                    await prisma.$transaction([
                        prisma.withdrawal.update({
                            where: { id: w.id },
                            data: {
                                status: 'processed',
                                processedAt: new Date()
                            }
                        }),
                        prisma.user.update({
                            where: { id: w.userId },
                            data: {
                                clickBalance: { decrement: w.amount }
                            }
                        })
                    ]);
                    console.log(`✅ Isplata #${w.id} obrađena`);
                } else {
                    console.log(`❌ Isplata #${w.id} neuspješna: ${result.error}`);
                    await prisma.withdrawal.update({
                        where: { id: w.id },
                        data: { status: 'failed' }
                    });
                }

                await sleep(2000);
            }
        } catch (error) {
            console.error('❌ Greška pri obradi isplata:', error);
        }
    }
}
