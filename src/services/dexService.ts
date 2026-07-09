import axios from 'axios';

const STON_API = 'https://api.ston.fi/v1';
const DEX_SCALE = 400_000_000;

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

export class DexService {
    private static cache: { price: PriceData | null; timestamp: number } = {
        price: null,
        timestamp: 0,
    };
    private static CACHE_TTL = 30000;

    static async getLivePrice(jettonMasterAddress: string): Promise<PriceData> {
        try {
            const now = Date.now();
            if (this.cache.price && now - this.cache.timestamp < this.CACHE_TTL) {
                return this.cache.price;
            }

            const response = await axios.get(`${STON_API}/pools`, {
                params: { jetton_master: jettonMasterAddress }
            });

            const pools = response.data?.pools || [];

            // Ako nema poolova, vrati prazne podatke
            if (pools.length === 0) {
                const emptyPrice: PriceData = {
                    usdt: 0,
                    gram: 0,
                    change24h: 0,
                    volume24h: 0,
                    liquidity: 0,
                    high24h: 0,
                    low24h: 0,
                    marketCap: 0,
                };
                this.cache.price = emptyPrice;
                this.cache.timestamp = now;
                return emptyPrice;
            }

            let usdtPrice = 0;
            let gramPrice = 0;
            let volume24h = 0;
            let liquidity = 0;
            let high24h = 0;
            let low24h = Infinity;

            for (const pool of pools) {
                const reserve0 = parseFloat(pool.reserve0) / DEX_SCALE;
                const reserve1 = parseFloat(pool.reserve1) / DEX_SCALE;
                
                const price = pool.token0_address === jettonMasterAddress 
                    ? reserve1 / reserve0 
                    : reserve0 / reserve1;

                if (pool.address === POOLS.KVNC_USDT) {
                    usdtPrice = price;
                }
                if (pool.address === POOLS.KVNC_GRAM) {
                    gramPrice = price;
                }

                const vol = parseFloat(pool.volume_24h || '0') / DEX_SCALE;
                volume24h += vol;
                liquidity += parseFloat(pool.reserve0 || '0') / DEX_SCALE;
                
                if (price > high24h) high24h = price;
                if (price < low24h) low24h = price;
            }

            const TOTAL_SUPPLY = 1_000_000_000;
            const marketCap = usdtPrice * TOTAL_SUPPLY;

            const priceData: PriceData = {
                usdt: usdtPrice,
                gram: gramPrice,
                change24h: 0,
                volume24h: volume24h,
                liquidity: liquidity,
                high24h: high24h,
                low24h: low24h === Infinity ? 0 : low24h,
                marketCap: marketCap,
            };

            this.cache.price = priceData;
            this.cache.timestamp = now;

            return priceData;
        } catch (error) {
            console.error('❌ Greška pri dohvaćanju cijene:', error);
            return this.cache.price || {
                usdt: 0,
                gram: 0,
                change24h: 0,
                volume24h: 0,
                liquidity: 0,
                high24h: 0,
                low24h: 0,
                marketCap: 0,
            };
        }
    }

    static async getPools(jettonMasterAddress: string): Promise<PoolInfo[]> {
        try {
            const response = await axios.get(`${STON_API}/pools`, {
                params: { jetton_master: jettonMasterAddress }
            });
            const pools = response.data?.pools || [];

            return pools.map((pool: any) => ({
                address: pool.address,
                name: pool.name || 'KVNC Pool',
                token0: pool.token0_symbol || pool.token0_address,
                token1: pool.token1_symbol || pool.token1_address,
                reserve0: pool.reserve0 || '0',
                reserve1: pool.reserve1 || '0',
                lpFee: pool.lp_fee || 0.3,
                volume24h: parseFloat(pool.volume_24h || '0') / DEX_SCALE,
                apy: pool.apy || 0,
                tvl: (parseFloat(pool.reserve0 || '0') + parseFloat(pool.reserve1 || '0')) / DEX_SCALE,
            }));
        } catch (error) {
            console.error('❌ Greška pri dohvaćanju pool-ova:', error);
            return [];
        }
    }

    static async getPoolDisplay(jettonMasterAddress: string): Promise<string> {
        try {
            const pools = await this.getPools(jettonMasterAddress);
            const price = await this.getLivePrice(jettonMasterAddress);

            let message = '💧 **DEX Pool-ovi** 💧\n\n';
            message += `💰 **Cijena KVNC:**\n`;
            message += `  💵 USDT: ${price.usdt.toFixed(6)}\n`;
            message += `  🪙 GRAM: ${price.gram.toFixed(6)}\n`;
            message += `  📈 24h High: $${price.high24h.toFixed(6)}\n`;
            message += `  📉 24h Low: $${price.low24h.toFixed(6)}\n`;
            message += `  📊 Volumen 24h: $${price.volume24h.toFixed(2)}\n`;
            message += `  💧 Likvidnost: $${price.liquidity.toFixed(2)}\n`;
            message += `  🏦 Market Cap: $${price.marketCap.toFixed(2)}\n\n`;

            if (pools.length === 0) {
                message += `📭 **Nema aktivnih pool-ova.**\n`;
                message += `Dodaj likvidnost na STON.fi da bi se pojavili ovdje!\n`;
                message += `🔗 https://app.ston.fi/pools`;
                return message;
            }

            for (const pool of pools) {
                const reserve0 = (parseFloat(pool.reserve0) / DEX_SCALE).toFixed(2);
                const reserve1 = (parseFloat(pool.reserve1) / DEX_SCALE).toFixed(2);
                message += `📊 **${pool.name}**\n`;
                message += `  📌 Adresa: \`${pool.address.slice(0, 12)}...\`\n`;
                message += `  💰 ${pool.token0}: ${reserve0}\n`;
                message += `  💰 ${pool.token1}: ${reserve1}\n`;
                message += `  📈 Fee: ${pool.lpFee}%\n`;
                if (pool.apy) message += `  📈 APY: ${pool.apy}%\n`;
                message += `  💰 TVL: $${pool.tvl.toFixed(2)}\n\n`;
            }

            message += `\n🔗 **Akcije:**\n`;
            message += `🔄 /swap - Swap KVNC\n`;
            message += `➕ /addliquidity - Dodaj likvidnost\n`;
            message += `➖ /removeliquidity - Ukloni likvidnost`;

            return message;
        } catch (error) {
            console.error('❌ Greška:', error);
            return '❌ Greška pri dohvaćanju pool-ova. Pokušaj kasnije.';
        }
    }

    static getSwapLink(fromToken: string, toToken: string, amount?: string): string {
        const baseUrl = 'https://app.ston.fi/swap';
        let url = `${baseUrl}?from=${fromToken}&to=${toToken}`;
        if (amount) {
            url += `&amount=${amount}`;
        }
        return url;
    }

    static getAddLiquidityLink(token0: string, token1: string): string {
        return `https://app.ston.fi/add-liquidity?token0=${token0}&token1=${token1}`;
    }

    static getRemoveLiquidityLink(token0: string, token1: string): string {
        return `https://app.ston.fi/remove-liquidity?token0=${token0}&token1=${token1}`;
    }

    static async simulateSwap(
        fromToken: string,
        toToken: string,
        amount: number
    ): Promise<{ expectedOutput: number; priceImpact: number; fee: number; route: string } | null> {
        try {
            const response = await axios.get(`${STON_API}/swap/simulate`, {
                params: {
                    from: fromToken,
                    to: toToken,
                    amount: amount * DEX_SCALE,
                }
            });

            const data = response.data;
            return {
                expectedOutput: data.expected_output / DEX_SCALE,
                priceImpact: data.price_impact || 0,
                fee: data.fee || 0,
                route: data.route || 'Direct',
            };
        } catch (error) {
            console.error('❌ Greška pri simulaciji swap-a:', error);
            return null;
        }
    }
}
