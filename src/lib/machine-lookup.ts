// Server-only: names a posting machine when its IP is not in the static map.
// A peer on DHCP changes address, but the hub can always resolve its Bonjour
// name on the LAN, so match the caller IP against the names we know.
import { lookup } from "node:dns/promises";
import { machineForIp } from "./machines.ts";

// Peers the hub resolves by <name>.local, from STICKIES_PEER_HOSTS (comma-separated
// machine names, never IPs). Empty by default: peer names are deployment
// configuration, not code. Read per call, which only happens on a cache miss.
function peerHosts(): string[] {
    return (process.env.STICKIES_PEER_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
const TTL_MS = 5 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 2000;
const cache = new Map<string, { name: string | null; at: number }>();

async function resolvePeer(host: string): Promise<string | null> {
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), LOOKUP_TIMEOUT_MS));
    const dns = lookup(`${host}.local`, { family: 4 }).then((r) => r.address, () => null);
    return Promise.race([dns, timeout]);
}

/** machineForIp, plus a Bonjour lookup when the IP is not a known machine. */
export async function machineForRequestIp(ip: string): Promise<string | null> {
    const byIp = machineForIp(ip);
    const rawV4 = !!byIp && /^\d+\.\d+\.\d+\.\d+$/.test(byIp);
    if (!rawV4 || process.env.VERCEL) return byIp;

    const hit = cache.get(byIp);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.name ?? byIp;

    let name: string | null = null;
    for (const host of peerHosts()) {
        if ((await resolvePeer(host)) === byIp) { name = host; break; }
    }
    cache.set(byIp, { name, at: Date.now() });
    return name ?? byIp;
}
