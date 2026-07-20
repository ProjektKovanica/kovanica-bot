import axios from 'axios';

const KVNC_JETTON_MASTER = process.env.KVNC_JETTON_MASTER!;

export class DexService {
  private static lastPrice: any = null;
  private static lastPriceUpdate = 0;
  private static readonly PRICE_CACHE_TTL = 30000;

  static async getLivePrice(jettonMaster: string = KVNC_JETTON_MASTER): Promise<{
    usdt: number;
    gram: number;
    change24h: number;
    liquidity: number;
    volume24h: number;
    high24h: number;
    low24h: number;
    marketCap: number;
  }> {
    if (this.lastPrice && Date.now() - this.lastPriceUpdate < this.PRICE_CACHE_TTL) {
      return this.lastPrice;
    }

    // ============================================
    // RUČNE CIJENE - ZAMIJENI OVDJE PO POTREBI
    // ============================================
    const result = {
      usdt: 0.00000348,
      gram: 0.00000239,
      change24h: 79.5,
      liquidity: 348.21,
      volume24h: 127,
      high24h: 0.00000400,
      low24h: 0.00000280,
      marketCap: 3482.09
    };
    
    this.lastPrice = result;
    this.lastPriceUpdate = Date.now();
    return result;
  }

  static getSwapLink(fromToken: string, toToken: string, amount: string): string {
    return `https://app.ston.fi/swap?from=${fromToken}&to=${toToken}&amount=${amount}`;
  }

  static getAddLiquidityLink(tokenA: string, tokenB: string): string {
    return `https://app.ston.fi/pools/add?token0=${tokenA}&token1=${tokenB}`;
  }

  static getRemoveLiquidityLink(tokenA: string, tokenB: string): string {
    return `https://app.ston.fi/pools/remove?token0=${tokenA}&token1=${tokenB}`;
  }

  static async simulateSwap(fromToken: string, toToken: string, amount: number): Promise<{
    expectedOutput: number;
    priceImpact: number;
    fee: number;
  } | null> {
    try {
      const price = await this.getLivePrice(KVNC_JETTON_MASTER);
      const toPrice = toToken === 'USDT' ? price.usdt : price.gram;
      if (!toPrice || toPrice <= 0) return null;
      return {
        expectedOutput: (amount / toPrice) * 0.997,
        priceImpact: Math.min(0.5 + (amount / 10000) * 0.1, 5),
        fee: 0.003 * amount
      };
    } catch (error) {
      return null;
    }
  }

  static async getTrustScore(jettonMaster: string = KVNC_JETTON_MASTER) {
    return null;
  }

  static async getPoolDisplay(jettonMaster: string = KVNC_JETTON_MASTER): Promise<string> {
    const price = await this.getLivePrice(jettonMaster);
    let message = "💧 **DEX Pool-ovi** 💧\n\n";
    message += `💰 **Cijena:** $${price.usdt.toFixed(8)} USDT\n`;
    message += `🪙 **GRAM:** ${price.gram.toFixed(8)}\n`;
    message += `📊 **24h promjena:** ${price.change24h > 0 ? '+' : ''}${price.change24h.toFixed(1)}%\n`;
    message += `💧 **Likvidnost:** $${price.liquidity.toFixed(2)}\n`;
    message += `📈 **24h volumen:** $${price.volume24h.toFixed(2)}\n`;
    message += `🏦 **Market Cap:** $${price.marketCap.toFixed(2)}\n\n`;
    message += `🔄 **Swap:** /swap GRAM 100\n`;
    message += `➕ **Add liquidity:** /addliquidity USDT 1000\n`;
    message += `📊 **Izvor:** Ručne cijene`;
    return message;
  }
}
