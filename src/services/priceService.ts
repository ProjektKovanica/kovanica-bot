import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface PriceData {
    usdt: number;
    gram: number;
    change24h: number;
    volume24h: number;
    liquidity: number;
    high24h: number;
    low24h: number;
    marketCap: number;
    lastUpdate: Date;
}

export interface PoolData {
    name: string;
    address: string;
    tvl: number;
    volume24h: number;
    apy: number;
    reserve0: number;
    reserve1: number;
    token0: string;
    token1: string;
}

export class PriceService {
    private static cache: {
        price: PriceData | null;
        pools: PoolData[] | null;
        timestamp: number;
    } = {
        price: null,
        pools: null,
        timestamp: 0,
    };

    private static CACHE_TTL = 30000;

    // ============================================
    // DOHVATI LIVE CIJENU (STON.fi V2)
    // ============================================
    static async getLivePrice(): Promise<PriceData> {
        try {
            const now = Date.now();
            
            if (this.cache.price && now - this.cache.timestamp < this.CACHE_TTL) {
                return this.cache.price;
            }

            console.log('🔄 Dohvaćam live cijenu KVNC (STON.fi V2)...');

            const jettonMaster = process.env.KVNC_JETTON_MASTER;
            if (!jettonMaster) {
                throw new Error('KVNC_JETTON_MASTER nije postavljen u .env');
            }

            let usdtPrice = 0;
            let gramPrice = 0;
            let volume24h = 0;
            let liquidity = 0;
            let high24h = 0;
            let low24h = Infinity;

            // STON.fi V2 API
            const STON_V2_API = 'https://api.ston.fi/v2';

            try {
                // Dohvati sve pool-ove za KVNC
                const response = await axios.get(
                    `${STON_V2_API}/pools`,
                    {
                        params: { 
                            jetton_master: jettonMaster,
                            limit: 100 
                        },
                        timeout: 8000,
                    }
                );

                const pools = response.data?.pools || [];

                for (const pool of pools) {
                    // V2 struktura: reserve0, reserve1 su u "reserve0" i "reserve1" poljima
                    const reserve0 = parseFloat(pool.reserve0) / 1_000_000_000;
                    const reserve1 = parseFloat(pool.reserve1) / 1_000_000_000;
                    
                    const price = pool.token0_address === jettonMaster 
                        ? reserve1 / reserve0 
                        : reserve0 / reserve1;

                    // Prepoznaj pool po adresi
                    if (pool.address === process.env.KVNC_USDT_POOL) {
                        usdtPrice = price;
                    }
                    if (pool.address === process.env.KVNC_GRAM_POOL) {
                        gramPrice = price;
                    }

                    const vol = parseFloat(pool.volume_24h || '0') / 1_000_000_000;
                    volume24h += vol;
                    liquidity += parseFloat(pool.reserve0 || '0') / 1_000_000_000;
                    
                    if (price > high24h) high24h = price;
                    if (price < low24h) low24h = price;
                }

                // Ako nismo dobili cijenu, probaj V1 kao fallback
                if (usdtPrice === 0 || gramPrice === 0) {
                    console.log('⚠️ V2 nije vratio cijenu, pokušavam V1...');
                    const fallback = await this.getPriceV1(jettonMaster);
                    if (fallback) {
                        usdtPrice = fallback.usdt || usdtPrice;
                        gramPrice = fallback.gram || gramPrice;
                        volume24h = fallback.volume24h || volume24h;
                        liquidity = fallback.liquidity || liquidity;
                    }
                }

            } catch (error) {
                console.warn('⚠️ STON.fi V2 API greška, pokušavam V1...');
                try {
                    const fallback = await this.getPriceV1(jettonMaster);
                    if (fallback) {
                        usdtPrice = fallback.usdt || usdtPrice;
                        gramPrice = fallback.gram || gramPrice;
                        volume24h = fallback.volume24h || volume24h;
                        liquidity = fallback.liquidity || liquidity;
                    }
                } catch (e) {
                    console.warn('⚠️ V1 fallback također ne radi');
                }
            }

            // Ako i dalje nema cijene, koristi cached
            if (usdtPrice === 0 && this.cache.price) {
                usdtPrice = this.cache.price.usdt;
                gramPrice = this.cache.price.gram;
            }

            const TOTAL_SUPPLY = Number(process.env.TOTAL_SUPPLY) || 1_000_000_000;
            const marketCap = usdtPrice * TOTAL_SUPPLY;

            const priceData: PriceData = {
                usdt: usdtPrice,
                gram: gramPrice,
                change24h: 0,
                volume24h: volume24h,
                liquidity: liquidity,
                high24h: high24h || usdtPrice,
                low24h: low24h === Infinity ? usdtPrice : low24h,
                marketCap: marketCap,
                lastUpdate: new Date(),
            };

            this.cache.price = priceData;
            this.cache.timestamp = now;

            return priceData;
        } catch (error) {
            console.error('❌ Greška pri dohvaćanju cijene:', error);
            
            if (this.cache.price) {
                return this.cache.price;
            }

            return {
                usdt: 0,
                gram: 0,
                change24h: 0,
                volume24h: 0,
                liquidity: 0,
                high24h: 0,
                low24h: 0,
                marketCap: 0,
                lastUpdate: new Date(),
            };
        }
    }

    // ============================================
    // V1 FALLBACK
    // ============================================
    private static async getPriceV1(jettonMaster: string): Promise<any> {
        try {
            const response = await axios.get(
                `https://api.ston.fi/v1/pools`,
                {
                    params: { jetton_master: jettonMaster },
                    timeout: 5000,
                }
            );
            const pools = response.data?.pools || [];
            let usdtPrice = 0, gramPrice = 0, volume = 0, liq = 0;

            for (const pool of pools) {
                const reserve0 = parseFloat(pool.reserve0) / 1_000_000_000;
                const reserve1 = parseFloat(pool.reserve1) / 1_000_000_000;
                const price = pool.token0_address === jettonMaster 
                    ? reserve1 / reserve0 
                    : reserve0 / reserve1;

                if (pool.address === process.env.KVNC_USDT_POOL) usdtPrice = price;
                if (pool.address === process.env.KVNC_GRAM_POOL) gramPrice = price;

                volume += parseFloat(pool.volume_24h || '0') / 1_000_000_000;
                liq += parseFloat(pool.reserve0 || '0') / 1_000_000_000;
            }

            return { usdt: usdtPrice, gram: gramPrice, volume24h: volume, liquidity: liq };
        } catch {
            return null;
        }
    }

    // ============================================
    // DOHVATI POOL STATUS IZ BAZE
    // ============================================
    static async getPoolStatus() {
        try {
            const pools = await prisma.poolTracking.findMany({
                orderBy: { poolName: 'asc' },
            });

            return pools.map(p => ({
                name: p.poolName,
                totalAllocated: p.totalAllocated,
                spent: p.spent,
                remaining: p.remaining,
                usedPercent: p.totalAllocated > 0 
                    ? ((p.spent / p.totalAllocated) * 100).toFixed(1) 
                    : '0',
            }));
        } catch (error) {
            console.error('❌ Greška pri dohvaćanju pool statusa:', error);
            return [];
        }
    }

    // ============================================
    // FORMATIRANI PRIKAZ ZA BOT
    // ============================================
    static async getFormattedPrice(): Promise<string> {
        const price = await this.getLivePrice();
        const poolStatus = await this.getPoolStatus();

        let message = '💰 **LIVE CIJENA KVNC** 💰\n\n';
        
        message += `💵 **USDT:** ${price.usdt.toFixed(6)}\n`;
        message += `🪙 **GRAM:** ${price.gram.toFixed(6)}\n`;
        message += `📈 **Volumen 24h:** $${price.volume24h.toFixed(2)}\n`;
        message += `💧 **Likvidnost:** $${price.liquidity.toFixed(2)}\n`;
        message += `🏦 **Market Cap:** $${price.marketCap.toFixed(2)}\n`;
        message += `⏱️ **Zadnje ažuriranje:** ${price.lastUpdate.toLocaleString()}\n\n`;

        if (poolStatus.length > 0) {
            message += `📦 **Pool status:**\n`;
            for (const p of poolStatus) {
                const emoji = p.name === 'tap_base' ? '⛏️' :
                              p.name === 'nft_mint_rewards' ? '🎨' :
                              p.name === 'referral_pool' ? '👥' :
                              p.name === 'dex_kvnc_gram' ? '💧' :
                              p.name === 'dex_kvnc_usdt' ? '💧' : '📦';
                message += `  ${emoji} ${p.name}: ${p.usedPercent}% potrošeno (${p.remaining.toLocaleString()} KVNC)\n`;
            }
        }

        return message;
    }
}
