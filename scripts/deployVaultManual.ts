import { TonClient, WalletContractV4, internal } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { Address, toNano, beginCell, contractAddress, Cell } from "@ton/core";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

async function deployVaultManual() {
    console.log("🚀 Deployam Vault (manualno)...");

    try {
        // 1. Učitaj mnemonic
        const mnemonic = process.env.WITHDRAWAL_MNEMONIC!.split(" ");
        const key = await mnemonicToPrivateKey(mnemonic);
        
        const wallet = WalletContractV4.create({
            publicKey: key.publicKey,
            workchain: 0,
        });
        
        const client = new TonClient({
            endpoint: process.env.TON_RPC_URL || "https://toncenter.com/api/v2/jsonRPC",
            apiKey: process.env.TON_API_KEY || "",
        });
        
        const sender = client.open(wallet);
        const senderAddress = sender.address;
        
        console.log(`📤 Wallet: ${senderAddress.toString()}`);
        console.log(`💰 Balans: ${await sender.getBalance()}`);
        
        // 2. Kreiraj jednostavni cell za vault (minimalni code)
        // Za sada koristimo dummy code
        const vaultCode = beginCell()
            .storeUint(0, 8)  // dummy code
            .endCell();
        
        // 3. Init data
        const owner = senderAddress;
        const jettonMaster = Address.parse(process.env.KVNC_JETTON_MASTER!);
        
        const initData = beginCell()
            .storeAddress(owner)
            .storeAddress(jettonMaster)
            .endCell();
        
        // 4. Izračunaj adresu
        const init = {
            code: vaultCode,
            data: initData,
        };
        
        const vaultAddress = contractAddress(0, init);
        console.log(`📊 Predviđena adresa Vaulta: ${vaultAddress.toString()}`);
        
        // 5. Deployaj
        console.log("⏳ Deployam Vault...");
        const seqno = await sender.getSeqno();
        
        await sender.sendTransfer({
            secretKey: key.secretKey,
            seqno: seqno,
            messages: [
                internal({
                    to: vaultAddress,
                    value: toNano("0.1"),
                    body: beginCell().storeUint(0, 32).storeUint(0, 64).endCell(),
                    init: init,
                }),
            ],
        });
        
        console.log(`✅ Vault deployan na: ${vaultAddress.toString()}`);
        console.log(`👑 Vlasnik: ${owner.toString()}`);
        console.log(`🪙 Jetton Master: ${jettonMaster.toString()}`);
        
        // 6. Spremi adresu
        console.log("\n📝 DODAJ U .env:");
        console.log(`VAULT_ADDRESS="${vaultAddress.toString()}"`);
        console.log("\n📝 ZATIM:");
        console.log(`1. Pošalji KVNC na: ${vaultAddress.toString()}`);
        console.log("2. Pošalji 0.1 TON za gas");
        console.log("3. Kompajliraj: npx tsc");
        console.log("4. Restartaj bot: pm2 restart kovanica-bot");
        
    } catch (error) {
        console.error("❌ Greška:", error);
    }
}

deployVaultManual()
    .then(() => console.log("✅ Gotovo!"))
    .catch(console.error);
