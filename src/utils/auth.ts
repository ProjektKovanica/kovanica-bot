import { createHmac, timingSafeEqual } from "crypto";

export function validateAndExtractId(initData: string, botToken: string): string | null {
    if (!initData || !botToken) return null;
    try {
        const params = new URLSearchParams(initData);
        const receivedHash = params.get("hash");
        if (!receivedHash) return null;
        params.delete("hash");
        const dataCheckString = Array.from(params.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`)
            .join("\n");
        const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
        const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
        const hashMatch = timingSafeEqual(Buffer.from(receivedHash, "hex"), Buffer.from(expectedHash, "hex"));
        if (!hashMatch) return null;
        const authDate = params.get("auth_date");
        if (authDate) {
            const ageSeconds = Math.floor(Date.now() / 1000) - parseInt(authDate);
            if (ageSeconds > 300) { console.warn("initData istekao"); return null; }
        }
        const userStr = params.get("user");
        if (!userStr) return null;
        const user = JSON.parse(userStr);
        if (!user?.id) return null;
        return String(user.id);
    } catch (err) {
        console.error("Auth greška:", err);
        return null;
    }
}

export function extractTelegramIdDev(rawUser?: any): string | null {
    if (process.env.NODE_ENV === "production") return null;
    if (rawUser?.id) { console.warn("DEV MODE: rawUser fallback!"); return String(rawUser.id); }
    return null;
}
