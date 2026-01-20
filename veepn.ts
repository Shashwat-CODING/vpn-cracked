/**
 * VeePN HTTPS Proxy Fetcher
 * 
 * Fetches HTTPS proxies from VeePN's API with automatic domain fallback.
 * 
 * Usage: deno run --allow-net veepn_https.ts
 */

const PRIMARY_DOMAINS = ["https://antpeak.com", "https://zorvian.com"];
const BACKUP_SOURCES = [
    "https://s3-oregon-1.s3-us-west-2.amazonaws.com/api.json",
    "https://proigor.com/payload.json"
];
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const APP_VERSION = "3.7.8";
const PROTOCOL = "https";

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 10000): Promise<Response | null> {
    try {
        const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
        return response.ok ? response : null;
    } catch {
        return null;
    }
}

async function findWorkingDomain(): Promise<string | null> {
    for (const domain of PRIMARY_DOMAINS) {
        const resp = await fetchWithTimeout(`${domain}/api/available/`, {}, 5000);
        if (resp) {
            const data = await resp.json();
            if (data.message === "OK") return domain;
        }
    }

    for (const source of BACKUP_SOURCES) {
        const resp = await fetchWithTimeout(source, {}, 5000);
        if (resp) {
            const data = await resp.json();
            for (const domain of data.domains?.free || []) {
                const check = await fetchWithTimeout(`${domain}/api/available/`, {}, 5000);
                if (check) return domain;
            }
        }
    }
    return null;
}

async function testProxy(proxyUrl: string): Promise<boolean> {
    try {
        const client = Deno.createHttpClient({ proxy: { url: proxyUrl } });
        const response = await fetch("https://httpbin.org/ip", { client, signal: AbortSignal.timeout(10000) });
        client.close();
        return response.ok;
    } catch {
        return false;
    }
}

async function main() {
    console.log(`🔒 VeePN ${PROTOCOL.toUpperCase()} Proxy Fetcher\n`);

    const apiBase = await findWorkingDomain();
    if (!apiBase) {
        console.error("❌ No working API domain found.");
        Deno.exit(1);
    }
    console.log(`✓ API Domain: ${apiBase}`);

    const deviceInfo = {
        udid: crypto.randomUUID(),
        appVersion: APP_VERSION,
        platform: "chrome",
        platformVersion: USER_AGENT,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        deviceName: "Chrome",
    };

    const launchResp = await fetchWithTimeout(`${apiBase}/api/launch/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deviceInfo),
    });
    if (!launchResp) { console.error("❌ Launch failed."); Deno.exit(1); }
    const launchData = await launchResp.json();
    const token = launchData.data?.accessToken;
    if (!token) { console.error("❌ No access token."); Deno.exit(1); }
    console.log("✓ Got access token");

    const locResp = await fetchWithTimeout(`${apiBase}/api/location/list/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!locResp) { console.error("❌ Failed to get locations."); Deno.exit(1); }
    const locData = await locResp.json();
    const locations = locData.data?.locations?.filter((l: { proxyType: number }) => l.proxyType === 0) || [];
    console.log(`✓ Found ${locations.length} free locations`);

    const shuffled = locations.sort(() => Math.random() - 0.5);
    for (const loc of shuffled.slice(0, 5)) {
        const serverResp = await fetchWithTimeout(`${apiBase}/api/server/list/`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ protocol: PROTOCOL, region: loc.region, type: loc.type }),
        });
        if (!serverResp) continue;
        const serverData = await serverResp.json();
        const server = serverData.data?.[0];
        if (!server) continue;

        const host = server.addresses[0];
        const port = server.port;
        const username = server.username || "";
        const password = server.password || "";
        const url = username ? `${PROTOCOL}://${username}:${password}@${host}:${port}` : `${PROTOCOL}://${host}:${port}`;

        console.log(`Testing ${loc.region}...`);
        if (await testProxy(url)) {
            console.log("\n" + "=".repeat(60));
            console.log(`✅ Working ${PROTOCOL.toUpperCase()} Proxy Found`);
            console.log("=".repeat(60));
            console.log(`Location: ${loc.name} (${loc.region})`);
            console.log(`Host: ${host}`);
            console.log(`Port: ${port}`);
            if (username) console.log(`Username: ${username}\nPassword: ${password}`);
            console.log("=".repeat(60));
            console.log("\nProxy URL:");
            console.log(url);
            console.log("=".repeat(60));
            return;
        }
    }
    console.error("❌ No working proxy found.");
    Deno.exit(1);
}

if (import.meta.main) await main();
