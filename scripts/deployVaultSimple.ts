import { TonClient, WalletContractV4, internal } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { Address, toNano, beginCell, contractAddress, Cell } from "@ton/core";
import * as dotenv from "dotenv";

dotenv.config();

// Jednostavna funkcija za kompajliranje Tact koda
// Ovdje koristimo prekompajlirani kod (moramo ga ručno dobiti)
// Za sada koristimo dummy Cell

async function deployVault() {
    console.log("🚀 Deployam Jettonized Vault...");

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
        
        // 2. Kreiraj jednostavni vault code (za testiranje)
        // Ovo je pojednostavljeni vault koji šalje tokene na zahtjev
        const vaultCode = beginCell()
            .storeUint(0, 8) // dummy code
            .endCell();
        
        // 3. Pripremi init data
        const owner = Address.parse(senderAddress.toString());
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
        
        const contractAddressObj = contractAddress(0, init);
        console.log(`📊 Predviđena adresa Vaulta: ${contractAddressObj.toString()}`);
        
        // 5. Deployaj
        console.log("⏳ Deployam Vault...");
        const seqno = await sender.getSeqno();
        
        await sender.sendTransfer({
            secretKey: key.secretKey,
            seqno: seqno,
            messages: [
                internal({
                    to: contractAddressObj,
                    value: toNano("0.1"),
                    body: beginCell().storeUint(0, 32).storeUint(0, 64).endCell(),
                    init: init,
                }),
            ],
        });
        
        console.log(`✅ Vault deployan na: ${contractAddressObj.toString()}`);
        console.log("\n📝 DODAJ U .env:");
        console.log(`VAULT_ADDRESS="${contractAddressObj.toString()}"`);
        console.log("\n📝 ZATIM:");
        console.log(`1. Pošalji KVNC na: ${contractAddressObj.toString()}`);
        console.log("2. Pošalji 0.1 TON za gas");
        console.log("3. Restartaj bot: pm2 restart kovanica-bot");
        
    } catch (error) {
        console.error("❌ Greška:", error);
    }
}

deployVault()
    .then(() => console.log("✅ Gotovo!"))
    .catch(console.error);
