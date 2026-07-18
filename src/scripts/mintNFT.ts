import { TonClient, WalletContractV4, internal, toNano, beginCell } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { Address } from "@ton/core";
import * as dotenv from "dotenv";

dotenv.config();

interface NFTMetadata {
    name: string;
    description: string;
    image: string;
    attributes: Array<{ trait_type: string; value: string | number }>;
}

async function mintNFT(
    collectionAddress: string,
    recipientAddress: string,
    metadata: NFTMetadata
) {
    console.log(`🔄 Mintam NFT za ${recipientAddress}...`);

    const mnemonic = process.env.WITHDRAWAL_MNEMONIC;
    if (!mnemonic) {
        console.error('❌ WITHDRAWAL_MNEMONIC nije postavljen');
        return;
    }

    const rpcUrl = process.env.TON_RPC_URL || 'https://toncenter.com/api/v2/jsonRPC';
    const apiKey = process.env.TON_API_KEY || '';

    const client = new TonClient({ endpoint: rpcUrl, apiKey: apiKey });
    const mnemonicArray = mnemonic.split(' ');
    const key = await mnemonicToPrivateKey(mnemonicArray);
    const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });
    const sender = client.open(wallet);
    const senderAddress = sender.address;

    console.log(`📤 Mint sa: ${senderAddress.toString()}`);

    const balance = await sender.getBalance();
    const balanceTON = Number(balance) / 1_000_000_000;
    console.log(`💰 Balans: ${balanceTON} TON`);

    if (balanceTON < 0.2) {
        console.error(`❌ Nedovoljno TON. Treba ~0.2 TON`);
        return;
    }

    const nftContent = beginCell()
        .storeUint(0x01, 8)
        .storeStringTail(JSON.stringify(metadata))
        .endCell();

    const seqno = await sender.getSeqno();
    const mintMsg = beginCell()
        .storeUint(1, 32)
        .storeUint(Date.now(), 64)
        .storeCoins(toNano('0.01'))
        .storeAddress(Address.parse(recipientAddress))
        .storeRef(nftContent)
        .endCell();

    await sender.sendTransfer({
        secretKey: key.secretKey,
        seqno: seqno,
        messages: [internal({ to: Address.parse(collectionAddress), value: toNano('0.1'), bounce: true, body: mintMsg })],
    });

    console.log('✅ Mint transakcija poslana!');
    await new Promise(r => setTimeout(r, 5000));
    console.log('🎉 NFT mintan!');
}

// ES module check
if (import.meta.url === `file://${process.argv[1]}`) {
    const collectionAddress = process.env.NFT_COLLECTION_ADDRESS;
    if (!collectionAddress) {
        console.error('❌ NFT_COLLECTION_ADDRESS nije postavljen u .env');
        process.exit(1);
    }

    await mintNFT(
        collectionAddress,
        "UQC2uEtBAZVdFPLCrvnfQTodm1sWwNZKC5WoMn46iujaAWif",
        {
            name: "Brončani pijuk #001",
            description: "Brončani pijuk - Kovanica NFT kolekcija",
            image: "https://github.com/ProjektKovanica/kovanica/raw/main/common.png",
            attributes: [
                { trait_type: "Rarity", value: "Common" },
                { trait_type: "Bonus", value: "1.2x" }
            ]
        }
    );
}

export { mintNFT };
