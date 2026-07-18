import axios from 'axios';

const STON_API_V2 = 'https://api.ston.fi/v2';
const DEX_SCALE = 1_000_000;

export const POOLS = {
    KVNC_USDT: 'EQCi5WSqkRsvaHNrs3pg6OrIA4C6Zk-inMHoVq0VAgo3svC5',
    KVNC_GRAM: 'EQDaPt-caUdBWLhF2In1P4x2-S7MOw79aganZ58PqMFqxR8S',
    TON: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
};

export interface PoolInfo {
    address: string;
    name: string;
    token0: string;
    token1: string;
    reserve0: string;
    reserve1: string;
    lpFee: number;
    volume24h: number;
    apy: number;
    tvl: number;
}

export interface PriceData {
    usdt: number;
    gram: number;
    change24h: number;
    volume24h: number;
    liquidity: number;
    high24h: number;
    low24h: number;
    marketCap: number;
}

const EMPTY_PRICE: PriceData = {
    usdt: 0, gram: 0, change24h: 0,
    volume24h: 0, liquidity: 0,
    high24h: 0, low24h: 0, marketCap: 0,
};

export class DexService {
    private static cache: { price: PriceData | null; timestamp: number } = {
        price: null,
        timestamp: 0,
    };
    private static CACHE_TTL = 60000;

    static async getLivePrice(jettonMasterAddress: string): Promise<PriceData> {
        try {
            const now = Date.now();
            if (this.cache.price && now - this.cache.timestamp < this.CACHE_TTL) {
                return this.cache.price;
            }

            const [usdtRes, gramRes] = await Promise.allSettled([
                axios.get(`${STON_API_V2}/pools/${POOLS.KVNC_USDT}`, { timeout: 8000 }),
                axios.get(`${STON_API_V2}/pools/${POOLS.KVNC_GRAM}`, { timeout: 8000 }),
            ]);

            let usdtPrice = 0;
            let gramPrice = 0;
            let volume24h = 0;
            let liquidity = 0;

            if (usdtRes.status === "fulfilled") {
                const pool = usdtRes.value.data?.pool || usdtRes.value.data;
                if (pool) {
                    const r0 = parseFloat(pool.reserve0 || "0");
                    const r1 = parseFloat(pool.reserve1 || "0");
                    if (r0 > 0 && r1 > 0) {
                        usdtPrice = pool.token0_address === jettonMasterAddress
                            ? r1 / r0 / DEX_SCALE
                            : r0 / r1 / DEX_SCALE;
                    }
                    volume24h += parseFloat(pool.volume_24h || "0") / DEX_SCALE;
                    liquidity += r0 / DEX_SCALE;
                }
            }

            if (gramRes.status === "fulfilled") {
                const pool = gramRes.value.data?.pool || gramRes.value.data;
                if (pool) {
                    const r0 = parseFloat(pool.reserve0 || "0");
                    const r1 = parseFloat(pool.reserve1 || "0");
                    if (r0 > 0 && r1 > 0) {
                        gramPrice = pool.token0_address === jettonMasterAddress
                            ? r1 / r0 / DEX_SCALE
                            : r0 / r1 / DEX_SCALE;
                    }
                }
            }

            const priceData: PriceData = {
                usdt: usdtPrice,
                gram: gramPrice,
                change24h: 0,
                volume24h,
                liquidity,
                high24h: Math.max(usdtPrice, gramPrice),
                low24h: usdtPrice > 0 && gramPrice > 0 ? Math.min(usdtPrice, gramPrice) : (usdtPrice || gramPrice),
                marketCap: usdtPrice * 1_000_000_000,
            };

            this.cache.price = priceData;
            this.cache.timestamp = now;
            return priceData;
        } catch (error) {
            console.error("DexService greška:", error);
            return this.cache.price || EMPTY_PRICE;
        }
    }

    static async getPools(jettonMasterAddress: string): Promise<PoolInfo[]> {
        try {
            const [usdtRes, gramRes] = await Promise.allSettled([
                axios.get(`${STON_API_V2}/pools/${POOLS.KVNC_USDT}`, { timeout: 8000 }),
                axios.get(`${STON_API_V2}/pools/${POOLS.KVNC_GRAM}`, { timeout: 8000 }),
            ]);

            const result: PoolInfo[] = [];
            const names = ["KVNC/USDT", "KVNC/GRAM"];

            for (const [i, res] of [usdtRes, gramRes].entries()) {
                if (res.status === "fulfilled") {
                    const pool = res.value.data?.pool || res.value.data;
                    if (pool) {
                        result.push({
                            address: pool.address,
                            name: names[i],
                            token0: pool.token0_symbol || pool.token0_address,
                            token1: pool.token1_symbol || pool.token1_address,
                            reserve0: pool.reserve0 || "0",
                            reserve1: pool.reserve1 || "0",
                            lpFee: pool.lp_fee || 0.3,
                            volume24h: parseFloat(pool.volume_24h || "0") / DEX_SCALE,
                            apy: pool.apy || 0,
                            tvl: (parseFloat(pool.reserve0 || "0") + parseFloat(pool.reserve1 || "0")) / DEX_SCALE,
                        });
                    }
                }
            }
            return result;
        } catch (error) {
            console.error("getPools greška:", error);
            return [];
        }
    }

    static async getPoolDisplay(jettonMasterAddress: string): Promise<string> {
        try {
            const pools = await this.getPools(jettonMasterAddress);
            const price = await this.getLivePrice(jettonMasterAddress);

            let message = "💧 **DEX Pool-ovi** 💧\n\n";
            message += "💰 **Cijena KVNC:**\n";
            message += `  💵 USDT: ${price.usdt.toFixed(6)}\n`;
            message += `  🪙 GRAM: ${price.gram.toFixed(6)}\n`;
            message += `  📊 Volumen 24h: $${price.volume24h.toFixed(2)}\n`;
            message += `  💧 Likvidnost: $${price.liquidity.toFixed(2)}\n`;
            message += `  🏦 Market Cap: $${price.marketCap.toFixed(2)}\n\n`;

            if (pools.length === 0) {
                message += "📭 **Nema aktivnih pool-ova.**\n";
                message += "🔗 https://app.ston.fi/pools";
                return message;
            }

            for (const pool of pools) {
                const r0 = (parseFloat(pool.reserve0) / DEX_SCALE).toFixed(2);
                const r1 = (parseFloat(pool.reserve1) / DEX_SCALE).toFixed(2);
                message += `📊 **${pool.name}**\n`;
                message += "  📌 " + pool.address.slice(0, 12) + "...\n";
                message += `  💰 ${pool.token0}: ${r0}\n`;
                message += `  💰 ${pool.token1}: ${r1}\n`;
                message += `  📈 Fee: ${pool.lpFee}%\n`;
                message += `  💰 TVL: $${pool.tvl.toFixed(2)}\n\n`;
            }

            return message;
        } catch (error) {
            return "❌ Greška pri dohvaćanju pool-ova.";
        }
    }

    static async simulateSwap(
        fromToken: string,
        toToken: string,
        amount: number
    ): Promise<{ expectedOutput: number; priceImpact: number; fee: number; route: string } | null> {
        try {
            const price = await this.getLivePrice(fromToken);
            const expectedOutput = amount * (price.usdt || price.gram || 0);
            return {
                expectedOutput,
                priceImpact: 0.1,
                fee: amount * 0.003,
                route: "Direct",
            };
        } catch (error) {
            console.error("simulateSwap greška:", error);
            return null;
        }
    }

    static getSwapLink(fromToken: string, toToken: string, amount?: string): string {
        let url = `https://app.ston.fi/swap?from=${fromToken}&to=${toToken}`;
        if (amount) url += `&amount=${amount}`;
        return url;
    }

    static getAddLiquidityLink(token0: string, token1: string): string {
        return `https://app.ston.fi/add-liquidity?token0=${token0}&token1=${token1}`;
    }

    static getRemoveLiquidityLink(token0: string, token1: string): string {
        return `https://app.ston.fi/remove-liquidity?token0=${token0}&token1=${token1}`;
    }
}
