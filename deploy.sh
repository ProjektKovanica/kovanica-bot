#!/bin/bash
echo "🚀 Deploying Kovanica Bot..."
cd ~/kovanica-bot
git pull
npm run build
pm2 restart kovanica-bot
pm2 save
echo "✅ Deploy gotov!"
