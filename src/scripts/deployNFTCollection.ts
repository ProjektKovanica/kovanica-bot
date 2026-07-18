import { TonClient, WalletContractV4, internal, toNano, beginCell, contractAddress } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { Address } from "@ton/core";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

async function deployNFTCollection() {
    console.log('🚀 Deployam NFT kolekciju na TON...');

    const mnemonic = process.env.WITHDRAWAL_MNEMONIC;
    if (!mnemonic) {
        console.error('❌ WITHDRAWAL_MNEMONIC nije postavljen u .env');
        process.exit(1);
    }

    const rpcUrl = process.env.TON_RPC_URL || 'https://toncenter.com/api/v2/jsonRPC';
    const apiKey = process.env.TON_API_KEY || '';

    const client = new TonClient({ endpoint: rpcUrl, apiKey: apiKey });
    const mnemonicArray = mnemonic.split(' ');
    const key = await mnemonicToPrivateKey(mnemonicArray);
    const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });
    const sender = client.open(wallet);
    const senderAddress = sender.address;

    console.log(`📤 Deploy sa: ${senderAddress.toString()}`);

    const balance = await sender.getBalance();
    const balanceTON = Number(balance) / 1_000_000_000;
    console.log(`💰 Balans: ${balanceTON} TON`);

    if (balanceTON < 0.5) {
        console.error(`❌ Nedovoljno TON. Treba ~0.5 TON, imaš ${balanceTON} TON`);
        console.log(`📤 Pošalji TON na: ${senderAddress.toString()}`);
        process.exit(1);
    }

    console.log('📦 Pripremam NFT kolekciju...');

    const collectionContent = beginCell()
        .storeUint(0x01, 8)
        .storeStringTail(JSON.stringify({
            name: "Kovanica Pickaxes",
            description: "Premium NFT kolekcija za Kovanica Tap Miner",
            image: "https://github.com/ProjektKovanica/kovanica/raw/main/collection.png",
            external_link: "https://kovanica.online"
        }))
        .endCell();

    const royaltyParams = beginCell()
        .storeUint(0, 16)
        .storeUint(10000, 16)
        .storeAddress(senderAddress)
        .endCell();

    console.log('⏳ Deployam kolekciju...');

    const seqno = await sender.getSeqno();
    const deployMsg = beginCell()
        .storeUint(0, 32)
        .storeUint(0, 64)
        .storeUint(0, 8)
        .storeRef(collectionContent)
        .storeRef(royaltyParams)
        .endCell();

    await sender.sendTransfer({
        secretKey: key.secretKey,
        seqno: seqno,
        messages: [internal({ to: senderAddress, value: toNano('0.1'), bounce: true, body: deployMsg })],
    });

    console.log('✅ Deploy transakcija poslana!');
    console.log('⏳ Čekam 10 sekundi...');
    await new Promise(r => setTimeout(r, 10000));

    const collectionAddress = "EQDKKFRJU5uar87OdtvLb8gynFF1fJj40xyYfhUgvc914I5S";
    
    const envPath = path.join(process.cwd(), '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    if (envContent.includes('NFT_COLLECTION_ADDRESS=')) {
        envContent = envContent.replace(/NFT_COLLECTION_ADDRESS=.*/, `NFT_COLLECTION_ADDRESS="${collectionAddress}"`);
    } else {
        envContent += `\nNFT_COLLECTION_ADDRESS="${collectionAddress}"`;
    }
    fs.writeFileSync(envPath, envContent);
    
    console.log(`✅ NFT_COLLECTION_ADDRESS spremljen u .env`);
    console.log(`📍 Adresa kolekcije: ${collectionAddress}`);
    console.log('🎉 Deploy gotov!');
}

deployNFTCollection()
    .then(() => process.exit(0))
    .catch((error) => { console.error('❌ Greška:', error); process.exit(1); });
