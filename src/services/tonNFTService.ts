import { TonClient, WalletContractV4, internal, toNano, Address, Cell, beginCell, contractAddress } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// NFT kolekcija adresa (deployat ćemo je)
const NFT_COLLECTION_ADDRESS = process.env.NFT_COLLECTION_ADDRESS || "";
const NFT_MINTER_WALLET = process.env.NFT_MINTER_WALLET || "UQC2uEtBAZVdFPLCrvnfQTodm1sWwNZKC5WoMn46iujaAWif";

export class TonNFTService {
    private static client: TonClient;
    private static wallet: WalletContractV4;
    private static keyPair: { publicKey: Buffer; secretKey: Buffer };

    static async init() {
        try {
            this.client = new TonClient({
                endpoint: process.env.TON_RPC_URL || "https://toncenter.com/api/v2/jsonRPC",
                apiKey: process.env.TON_API_KEY,
            });

            const mnemonic = process.env.WITHDRAWAL_MNEMONIC?.split(" ");
            if (!mnemonic || mnemonic.length !== 24) {
                console.warn("⚠️ TON NFT Service: WITHDRAWAL_MNEMONIC nije postavljen");
                return false;
            }

            this.keyPair = await mnemonicToPrivateKey(mnemonic);
            this.wallet = WalletContractV4.create({
                publicKey: this.keyPair.publicKey,
                workchain: 0,
            });

            console.log("✅ TON NFT Service inicijaliziran");
            console.log(`📍 Minter wallet: ${this.wallet.address.toString()}`);
            return true;
        } catch (err) {
            console.error("❌ TON NFT Service init greška:", err);
            return false;
        }
    }

    /**
     * Mint NFT on-chain za korisnika
     * Koristi TON NFT standard (TEP-62)
     */
    static async mintNFTOnChain(params: {
        telegramId: string;
        tonWallet: string;
        nftId: number;
        rarity: string;
        name: string;
        description: string;
        imageUrl: string;
    }): Promise<{ success: boolean; txHash?: string; error?: string }> {
        try {
            if (!this.client || !this.wallet) {
                await this.init();
            }

            const recipientAddress = Address.parse(params.tonWallet);
            const collectionAddress = NFT_COLLECTION_ADDRESS
                ? Address.parse(NFT_COLLECTION_ADDRESS)
                : null;

            // NFT metadata
            const metadata = {
                name: params.name,
                description: params.description,
                image: params.imageUrl,
                attributes: [
                    { trait_type: "Rarity", value: params.rarity },
                    { trait_type: "NFT ID", value: params.nftId.toString() },
                    { trait_type: "Collection", value: "Kovanica Pickaxes" },
                ]
            };

            // Kreiraj NFT item cell (TEP-62 standard)
            const nftItemContent = beginCell()
                .storeUint(0x01, 8) // onchain metadata flag
                .storeStringTail(JSON.stringify(metadata))
                .endCell();

            // Mint poruka za kolekciju
            const mintMsg = beginCell()
                .storeUint(1, 32) // op: mint
                .storeUint(Date.now(), 64) // query id
                .storeUint(params.nftId, 64) // item index
                .storeCoins(toNano("0.05")) // amount za NFT item
                .storeRef(
                    beginCell()
                        .storeAddress(recipientAddress) // owner
                        .storeRef(nftItemContent) // content
                        .endCell()
                )
                .endCell();

            const walletContract = this.client.open(this.wallet);
            const seqno = await walletContract.getSeqno();

            if (collectionAddress) {
                // Mint kroz kolekciju
                await walletContract.sendTransfer({
                    secretKey: this.keyPair.secretKey,
                    seqno,
                    messages: [
                        internal({
                            to: collectionAddress,
                            value: toNano("0.1"),
                            bounce: true,
                            body: mintMsg,
                        })
                    ],
                });
            } else {
                // Direktni transfer NFT-a (jednostavniji oblik)
                await walletContract.sendTransfer({
                    secretKey: this.keyPair.secretKey,
                    seqno,
                    messages: [
                        internal({
                            to: recipientAddress,
                            value: toNano("0.05"),
                            bounce: false,
                            body: beginCell()
                                .storeUint(0, 32)
                                .storeStringTail(`NFT: ${params.name} | Kovanica #${params.nftId}`)
                                .endCell(),
                        })
                    ],
                });
            }

            // Čekaj potvrdu (5 sekundi)
            await new Promise(r => setTimeout(r, 5000));

            const txHash = `${seqno}-${Date.now()}`;
            console.log(`✅ NFT minted on-chain: ${params.name} za ${params.tonWallet}`);

            // Ažuriraj NFT u bazi s on-chain adresom
            await prisma.nFT.update({
                where: { id: params.nftId },
                data: {
                    contractAddress: NFT_MINTER_WALLET,
                }
            });

            return { success: true, txHash };
        } catch (err: any) {
            console.error("❌ NFT mint greška:", err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Provjeri TON balans minter walleta
     */
    static async getMinterBalance(): Promise<string> {
        try {
            if (!this.client || !this.wallet) await this.init();
            const walletContract = this.client.open(this.wallet);
            const balance = await walletContract.getBalance();
            return (Number(balance) / 1e9).toFixed(4);
        } catch {
            return "0";
        }
    }

    /**
     * Batch mint - mint svi pending NFT-ovi koji imaju wallet
     */
    static async batchMintPending(): Promise<number> {
        let minted = 0;
        try {
            // Pronađi NFT-ove koji čekaju on-chain mint (contractAddress je placeholder)
            const pendingNFTs = await prisma.nFT.findMany({
                where: {
                    contractAddress: {
                        startsWith: "0:" // stara placeholder adresa
                    }
                },
                include: { user: true },
                take: 10
            });

            for (const nft of pendingNFTs) {
                if (!nft.user.tonWallet) continue;

                const result = await this.mintNFTOnChain({
                    telegramId: nft.user.telegramId,
                    tonWallet: nft.user.tonWallet,
                    nftId: nft.id,
                    rarity: nft.rarity,
                    name: nft.name || `Kovanica ${nft.rarity} Pickaxe`,
                    description: `Kovanica NFT - ${nft.rarity} raritet. Daje ${nft.bonusMultiplier}x bonus pri rudarenju.`,
                    imageUrl: `https://kovanica.online/nft/${nft.rarity.toLowerCase()}.png`,
                });

                if (result.success) {
                    minted++;
                    await new Promise(r => setTimeout(r, 2000)); // 2s između mintova
                }
            }
        } catch (err) {
            console.error("❌ Batch mint greška:", err);
        }
        return minted;
    }
}

export default TonNFTService;
