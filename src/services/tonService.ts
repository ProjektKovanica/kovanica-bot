import { TonClient, internal, JettonMaster, JettonWallet, WalletContractV4 } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { Address, toNano, beginCell } from "@ton/core";

const client = new TonClient({
    endpoint: process.env.TON_RPC_URL || 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TON_API_KEY || '',
});

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export class TonService {
    static async sendJetton(
        toAddress: string,
        amount: number,
        jettonMasterAddress: string
    ): Promise<{ success: boolean; txHash?: string; error?: string }> {
        try {
            console.log(`📤 Slanje ${amount} KVNC na ${toAddress}`);
            
            const mnemonic = process.env.WITHDRAWAL_MNEMONIC;
            if (!mnemonic) {
                return { success: false, error: 'WITHDRAWAL_MNEMONIC nije postavljen' };
            }
            
            const mnemonicArray = mnemonic.split(' ');
            const key = await mnemonicToPrivateKey(mnemonicArray);
            
            // ⭐ KORISTI WalletContractV4 (kompatibilan je s W5)
            const wallet = WalletContractV4.create({
                publicKey: key.publicKey,
                workchain: 0,
            });
            
            const sender = client.open(wallet);
            const senderAddress = sender.address;
            console.log(`📤 SLANJE S ADRESE: ${senderAddress.toString()}`);
            
            await sleep(500);
            const balance = await sender.getBalance();
            console.log(`💰 TON balans: ${Number(balance) / 1_000_000_000} TON`);
            
            if (Number(balance) < 0.05 * 1_000_000_000) {
                return { 
                    success: false, 
                    error: `Nedovoljno TON za gas. Imaš: ${Number(balance) / 1_000_000_000} TON. Pošalji 0.1 TON na: ${senderAddress.toString()}` 
                };
            }
            
            const jettonMasterAddr = Address.parse(jettonMasterAddress);
            const toAddr = Address.parse(toAddress);
            
            const jettonMaster = client.open(JettonMaster.create(jettonMasterAddr));
            
            await sleep(500);
            const userJettonWalletAddress = await jettonMaster.getWalletAddress(senderAddress);
            console.log(`📤 Jetton Wallet: ${userJettonWalletAddress.toString()}`);
            
            await sleep(500);
            const recipientJettonWalletAddress = await jettonMaster.getWalletAddress(toAddr);
            console.log(`📥 Primateljev Jetton Wallet: ${recipientJettonWalletAddress.toString()}`);
            
            const userJettonWallet = client.open(JettonWallet.create(userJettonWalletAddress));
            
            await sleep(500);
            const jettonBalance = await userJettonWallet.getBalance();
            console.log(`💰 KVNC balans: ${Number(jettonBalance) / 1_000_000_000} KVNC`);
            
            const transferAmount = BigInt(Math.floor(amount * 1_000_000_000));
            if (jettonBalance < transferAmount) {
                return { success: false, error: `Nedovoljno KVNC. Imaš: ${Number(jettonBalance) / 1_000_000_000}` };
            }
            
            // ⭐ ISPRAVAN JETTON TRANSFER BODY
            const transferBody = beginCell()
                .storeUint(0xf8a7ea5, 32)
                .storeUint(0, 64)
                .storeCoins(transferAmount)
                .storeAddress(toAddr)
                .storeAddress(senderAddress)
                .storeUint(0, 1)
                .storeCoins(toNano('0.01'))
                .storeUint(0, 1)
                .endCell();
            
            // ⭐ DOHVAĆANJE SEQNO
            const seqno = await sender.getSeqno();
            console.log(`📊 Seqno: ${seqno}`);
            
            // ⭐ POŠALJI TRANSAKCIJU
            const result = await sender.sendTransfer({
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
}
