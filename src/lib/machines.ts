// Resolves the machine that made an API call from its request IP, and maps a
// machine name to a device icon (mirrored from the local-apps device registry
// into /public/machines). A direct localhost post (no forwarded IP) is attributed
// to the hub, since the server runs there.
//
// The registry names real machines and their LAN addresses, so it is configuration,
// not code: it is read from env and defaults to empty. A fresh checkout ships no
// addresses and no machine names. Set these in .env.local (see .env.example):
//
//   NEXT_PUBLIC_STICKIES_HUB_MACHINE     hub name             "M4"
//   NEXT_PUBLIC_STICKIES_MACHINE_IPS     ip=name pairs        "192.0.2.10=M4,192.0.2.11=Laptop"
//   NEXT_PUBLIC_STICKIES_MACHINE_MODELS  name=model pairs     "M4=mac mini,Laptop=macbook pro"
//   NEXT_PUBLIC_STICKIES_FORCE_MACHINES  always device-badged "Laptop"
//
// NEXT_PUBLIC_ because the note tiles resolve icons in the browser as well as on
// the server. Values are inlined at build time, so rebuild after changing them.

const DEFAULT_HUB = "hub";
const DEFAULT_HUB_MODEL = "mac mini";

/** Parse a "k=v,k=v" env list into a record. Blank and malformed pairs are skipped. */
function pairs(raw: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of (raw ?? "").split(",")) {
        const [k, v] = part.split("=");
        if (k?.trim() && v?.trim()) out[k.trim()] = v.trim();
    }
    return out;
}

interface Registry {
    hub: string;
    byIp: Record<string, string>;
    model: Record<string, string>;
    force: Set<string>;
}

// Rebuilt only when the env values actually change, so the note grid does not
// re-parse the same strings on every tile render.
let cache: { key: string; reg: Registry } | null = null;

function registry(): Registry {
    const hub = process.env.NEXT_PUBLIC_STICKIES_HUB_MACHINE;
    const ips = process.env.NEXT_PUBLIC_STICKIES_MACHINE_IPS;
    const models = process.env.NEXT_PUBLIC_STICKIES_MACHINE_MODELS;
    const forced = process.env.NEXT_PUBLIC_STICKIES_FORCE_MACHINES;
    const key = `${hub}|${ips}|${models}|${forced}`;
    if (cache?.key !== key) {
        cache = {
            key,
            reg: {
                hub: hub?.trim() || DEFAULT_HUB,
                byIp: pairs(ips),
                model: pairs(models),
                force: new Set((forced ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
            },
        };
    }
    return cache.reg;
}

const DEVICE_ICON: Record<string, string> = {
    "mac mini": "mac-mini.png",
    // M2-era MacBook Pro icon, used for M2-onward MacBooks (2026-07-24).
    "macbook pro": "macbook-m2.png",
    "macbook air": "macbook-air.png",
};

/** Map a request IP to a machine name. localhost/empty = the hub. */
export function machineForIp(ip: string | null | undefined): string | null {
    const { hub, byIp } = registry();
    const x = (ip ?? "").trim();
    if (!x || x === "127.0.0.1" || x === "::1" || x === "::ffff:127.0.0.1") return hub;
    const norm = x.replace(/^::ffff:/, "");
    return byIp[norm] ?? norm; // known name, else the raw IP so it is still recorded
}

/** True for the hub. The hub is the implicit default origin, so it gets no device badge. */
export function isHubMachine(machine: string | null | undefined): boolean {
    return (machine ?? "").trim() === registry().hub;
}

/** Resolve the device icon for a machine name, or null (caller falls back to a text chip).
 *  The hub intentionally returns null: the large majority of posts come from it, so showing
 *  its badge everywhere is noise. Only non-hub machines get a device icon, so they stand out. */
// Cache-bust for the device-icon PNGs. Bump when an icon file's ART changes so
// browsers (esp. iPad Safari, which caches images past max-age=0) fetch the new
// one instead of the stale cached copy.
const ICON_V = "3";

export function machineIcon(machine: string | null | undefined): string | null {
    if (!machine || isHubMachine(machine)) return null;
    const model = registry().model[machine];
    const file = model ? DEVICE_ICON[model] : undefined;
    return file ? `/machines/${file}?v=${ICON_V}` : null;
}

/** Device icon for a machine that must OVERRIDE the app/owner sub-icon (e.g. a work
 *  laptop), or null for a normal machine. Resolvers check this first so a
 *  force-badged machine always shows its device icon. */
export function forcedMachineIcon(machine: string | null | undefined): string | null {
    const m = (machine ?? "").trim();
    return registry().force.has(m) ? machineIcon(m) : null;
}

/** The hub's own device icon, used ONLY for notes the hub authored as a system task
 *  (deep audits / health checks) where the hub itself IS the legitimate source. Normal hub
 *  posts keep their hidden badge via machineIcon; this is the deliberate exception. */
export function hubMachineIcon(): string {
    const { hub, model } = registry();
    const file = DEVICE_ICON[model[hub] ?? DEFAULT_HUB_MODEL] ?? DEVICE_ICON[DEFAULT_HUB_MODEL];
    return `/machines/${file}?v=${ICON_V}`;
}

/** True when a note came from the owner's own browser: no external API key (or the
 *  built-in "stickies" key) AND a non-hub machine with no device icon (an unknown peer
 *  that is really just the owner on another box). Such notes get the owner avatar, not
 *  an app/device badge. */
export function isOwnerBrowserNote(byKey: string | null | undefined, byMachine: string | null | undefined): boolean {
    const fromBrowser = !byKey || byKey === "stickies";
    return fromBrowser && !!byMachine && !isHubMachine(byMachine) && !machineIcon(byMachine);
}
