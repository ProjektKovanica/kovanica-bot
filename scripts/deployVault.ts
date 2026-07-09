import { toNano, Address } from "@ton/core";
import { JettonizedVault } from "../wrappers/vault";
import { compile, NetworkProvider } from "@ton/blueprint";
import * as dotenv from "dotenv";

dotenv.config();

export async function run(provider: NetworkProvider) {
    console.log("🚀 Deployam Jettonized Vault...");
    
    const sender = provider.sender();
    const senderAddress = await sender.address();
    
    if (!senderAddress) {
        console.error("❌ Nema sender address");
        return;
    }
    
    console.log(`📤 Wallet: ${senderAddress.toString()}`);
    
    const owner = senderAddress;
    const jettonMaster = Address.parse(process.env.KVNC_JETTON_MASTER!);
    
    console.log(`🪙 Jetton Master: ${jettonMaster.toString()}`);
    
    const vault = provider.open(
        JettonizedVault.createFromConfig(
            { owner, jettonMaster },
            await compile("vault")
        )
    );
    
    await vault.sendDeploy(provider.sender(), toNano("0.1"));
    
    await provider.waitForDeploy(vault.address);
    
    console.log(`✅ Vault deployan na: ${vault.address.toString()}`);
    console.log("\n📝 DODAJ U .env:");
    console.log(`VAULT_ADDRESS="${vault.address.toString()}"`);
    console.log("\n📝 ZATIM:");
    console.log(`1. Pošalji KVNC na: ${vault.address.toString()}`);
    console.log("2. Pošalji 0.1 TON za gas");
    console.log("3. Restartaj bot: pm2 restart kovanica-bot");
}
