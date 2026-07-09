import { WebSocketServer, WebSocket } from 'ws';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Client {
    ws: WebSocket;
    userId: string;
}

export class WebSocketService {
    private wss: WebSocketServer;
    private clients: Map<string, Client> = new Map();

    constructor(server: any) {
        this.wss = new WebSocketServer({ server, path: '/ws' });
        this.init();
        this.startHeartbeat();
    }

    private init() {
        this.wss.on('connection', (ws, req) => {
            const url = new URL(req.url || '', `http://${req.headers.host}`);
            const userId = url.searchParams.get('userId');

            if (!userId) {
                ws.close();
                return;
            }

            console.log(`🔌 WebSocket connected: ${userId}`);
            this.clients.set(userId, { ws, userId });
            this.sendUserUpdate(userId);

            ws.on('close', () => {
                console.log(`🔌 WebSocket disconnected: ${userId}`);
                this.clients.delete(userId);
            });

            ws.on('error', (error) => {
                console.error(`❌ WebSocket error:`, error);
            });
        });
    }

    private startHeartbeat() {
        setInterval(() => {
            for (const [userId, client] of this.clients) {
                if (client.ws.readyState === WebSocket.OPEN) {
                    client.ws.ping();
                } else {
                    this.clients.delete(userId);
                }
            }
        }, 30000);
    }

    async sendUserUpdate(userId: string) {
        try {
            const user = await prisma.user.findUnique({
                where: { telegramId: userId },
                include: { nfts: true }
            });

            if (!user) return;

            const client = this.clients.get(userId);
            if (!client || client.ws.readyState !== WebSocket.OPEN) return;

            const data = {
                type: 'user_update',
                data: {
                    clickBalance: user.clickBalance,
                    totalClicks: user.totalClicks,
                    dailyClicks: user.dailyClicks,
                    rank: getRank(user.totalClicks),
                    nfts: user.nfts.length,
                }
            };

            client.ws.send(JSON.stringify(data));
        } catch (error) {
            console.error('❌ WebSocket send error:', error);
        }
    }

    broadcast(notification: any) {
        const message = JSON.stringify({
            type: 'notification',
            data: notification
        });

        for (const [userId, client] of this.clients) {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(message);
            }
        }
    }

    sendNotification(userId: string, notification: any) {
        const client = this.clients.get(userId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({
                type: 'notification',
                data: notification
            }));
        }
    }
}

function getRank(totalClicks: number): string {
    if (totalClicks >= 100000) return "👑 Kralj rudara";
    if (totalClicks >= 50000) return "💎 Dijamantni rudar";
    if (totalClicks >= 20000) return "🔹 Platinasti rudar";
    if (totalClicks >= 10000) return "🥇 Zlatni rudar";
    if (totalClicks >= 5000) return "🥈 Srebrni rudar";
    if (totalClicks >= 2000) return "🥉 Brončani rudar";
    if (totalClicks >= 500) return "⛏️ Napredni rudar";
    if (totalClicks >= 100) return "⛏️ Početnik";
    return "🪨 Novi rudar";
}
