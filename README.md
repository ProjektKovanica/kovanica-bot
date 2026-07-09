
# 🪙 Kovanica (KVNC) Tap Miner

**Kovanica** je Telegram tap-mining bot na TON blockchainu.

---

## 📊 Tokenomics

| Kategorija | Postotak | Iznos |
|------------|----------|-------|
| Mining Bot | 50% | 500.000.000 KVNC |
| DEX Liquidity | 40% | 400.000.000 KVNC |
| Burn | 10% | 100.000.000 KVNC |

---

## 🎨 NFT Kolekcija

| Rarity | Broj | Multiplier |
|--------|------|------------|
| Common | 1000 | 1.2x |
| Rare | 500 | 1.5x |
| Epic | 300 | 2.0x |
| Legendary | 150 | 3.0x |
| Mythic | 50 | 5.0x |

---

## 🛠️ Tehnologije

- **Blockchain:** TON (GRAM)
- **Bot Framework:** Grammy (TypeScript)
- **Baza:** PostgreSQL + Prisma
- **Hosting:** VPS (Ubuntu) + PM2
- **Mini App:** HTML + CSS + JavaScript

---

## 📋 Bot Komande

| Komanda | Opis |
|---------|------|
| `/start` | Početna poruka |
| `/status` | Tvoj profil |
| `/leaderboard` | Top 10 rudara |
| `/referral` | Referral link |
| `/wallet` | Spremi GRAM adresu |
| `/withdraw` | Zatraži isplatu |
| `/nfts` | Pregled NFT-ova |
| `/equip` | Opremi NFT |
| `/stake` | Stake-aj NFT |
| `/unstake` | Prekini staking |
| `/stakeinfo` | Pregled stake-anih |
| `/mine` | Otvori Mini App |

---

## 🚀 Instalacija

```bash
git clone https://github.com/ProjektKovanica/kovanica-bot.git
cd kovanica-bot
npm install
cp .env.example .env
# Uredi .env sa svojim podacima
npx prisma db push
npx ts-node src/scripts/initPools.ts
npm run build
pm2 start dist/bot.js --name "kovanica-bot"
