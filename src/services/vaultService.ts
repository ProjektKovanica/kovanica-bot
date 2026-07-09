import { TonClient, WalletContractV4, internal } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { Address, toNano, beginCell } from "@ton/core";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const client = new TonClient({
    endpoint: process.env.TON_RPC_URL || "https://toncenter.com/api/v2/jsonRPC",
    apiKey: process.env.TON_API_KEY || "",
});

export class VaultService {
    static async requestWithdrawal(
        userAddress: string,
        amount: number
    ): Promise<{ success: boolean; error?: string }> {
        try {
            const mnemonic = process.env.WITHDRAWAL_MNEMONIC!.split(" ");
            const key = await mnemonicToPrivateKey(mnemonic);
            
            const wallet = WalletContractV4.create({
                publicKey: key.publicKey,
                workchain: 0,
            });
            
            const sender = client.open(wallet);
            const vaultAddress = Address.parse(process.env.VAULT_ADDRESS!);
            const toAddr = Address.parse(userAddress);
            
            const body = beginCell()
                .storeUint(0, 32)
                .storeUint(0, 64)
                .storeStringTail("withdraw")
                .storeAddress(toAddr)
                .storeCoins(Math.floor(amount * 1_000_000_000))
                .endCell();
            
            const seqno = await sender.getSeqno();
            
            await sender.sendTransfer({
                secretKey: key.secretKey,
                seqno: seqno,
                messages: [
                    internal({
                        to: vaultAddress,
                        value: toNano("0.05"),
                        body: body,
                    }),
                ],
            });
            
            return { success: true };
        } catch (error: any) {
            console.error("❌ Vault withdrawal error:", error);
            return { success: false, error: error.message };
        }
    }
}
