// Deterministic note/folder icon assignment by keyword + type. Pure + unit-tested
// so the "auto icon" feature can't silently stop matching.
import { appIconForKey } from "./app-icons.ts";

export const NOTE_ICON_KEYWORDS: [string[], string][] = [
    [["deploy","ship","release","launch","rocket","vercel","netlify","ci","cd"], "RocketLaunchIcon"],
    [["email","mail","inbox","gmail","outlook","newsletter","reply","sent"], "__gmail"],
    [["pr","review","pull request","merge request","approve","feedback","reviewer","parity","spot check","verify","audit","inspect","validation"], "CheckCircleIcon"],
    [["recap","handoff","session summary","retro","retrospective"], "ArrowPathIcon"],
    [["ai agent","llm","gpt","claude","anthropic","openai","robot","chatbot"], "RobotIcon"],
    [["docker","container","kubernetes","k8s","pod"], "CubeTransparentIcon"],
    [["security","hack","kali","pentest","vuln","xss","csrf","auth","owasp","shield"], "KeyIcon"],
    [["todo","checklist","task","test","quality","qa","jest","vitest","playwright","coverage","lint"], "ClipboardDocumentListIcon"],
    [["database","db","postgres","sql","supabase","mongo","redis","migration"], "TableCellsIcon"],
    [["api","rest","graphql","endpoint","route","fetch","webhook","http"], "GlobeAltIcon"],
    [["terminal","bash","shell","cli","command","script","zsh","sh"], "CodeBracketIcon"],
    [["cloud","aws","gcp","azure","s3","lambda","serverless"], "CloudIcon"],
    [["network","dns","proxy","nginx","gateway","mcp","socket","websocket"], "GlobeAmericasIcon"],
    [["config","env","settings","setup","install","dotenv","yaml","toml","integrations","integration","plugin","extension"], "WrenchIcon"],
    [["git","github","branch","commit","merge","repo"], "FolderIcon"],
    [["bug","fix","error","debug","issue","crash","exception"], "BugAntIcon"],
    [["design","ui","ux","figma","css","style","theme","color","layout"], "SwatchIcon"],
    [["meeting","standup","sync","agenda","minutes"], "ChatBubbleLeftRightIcon"],
    [["idea","brainstorm","plan","strategy","think","concept"], "LightBulbIcon"],
    [["money","budget","cost","price","billing","invoice","payment"], "BanknotesIcon"],
    [["user","team","people","member","org","staff","hire"], "UserGroupIcon"],
    [["calendar","schedule","deadline","date","event","reminder"], "CalendarDaysIcon"],
    [["link","url","bookmark","resource","reference"], "LinkIcon"],
    [["photo","image","screenshot","pic","camera"], "PhotoIcon"],
    [["music","audio","sound","podcast","spotify"], "MusicalNoteIcon"],
    [["video","film","youtube","stream","record"], "FilmIcon"],
    [["book","read","docs","documentation","wiki","readme","cheat sheet","playbook","runbook"], "BookOpenIcon"],
    [["chart","analytics","metrics","data","dashboard","graph","status","report","rollup","summary","monitor","uptime","health"], "ChartBarIcon"],
    [["diagram","flowchart","sequence","mindmap","timeline"], "ShareIcon"],
    [["home","house","personal","family","life"], "HomeIcon"],
    [["work","office","job","career","project"], "BriefcaseIcon"],
    [["code","dev","program","function","module","component","react","next"], "CodeBracketIcon"],
    [["phone","mobile","ios","android","app","pwa"], "DevicePhoneMobileIcon"],
    [["star","favorite","important","priority"], "StarIcon"],
    [["trash","delete","removed","archived","recycle"], "ArchiveBoxIcon"],
    [["demo","example","sample","tutorial","showcase"], "PuzzlePieceIcon"],
];

// Fallback by note `type` when no keyword matches.
export const TYPE_ICON: Record<string, string> = {
    checklist: "__hero:ClipboardDocumentListIcon", code: "__hero:CodeBracketIcon",
    javascript: "__hero:CodeBracketIcon", typescript: "__hero:CodeBracketIcon",
    python: "__hero:CodeBracketIcon", css: "__hero:CodeBracketIcon",
    sql: "__hero:TableCellsIcon", bash: "__hero:CodeBracketIcon",
    json: "__hero:WrenchIcon", html: "__hero:GlobeAltIcon",
    text: "__hero:DocumentTextIcon",
};

// Last-resort default so EVERY note ends up with an icon.
export const DEFAULT_NOTE_ICON = "__hero:DocumentTextIcon";

// The icon names agents are allowed to send on POST. Curated from the keyword
// table + type fallbacks + a few common extras. All are valid Heroicons (the
// app maps `__hero:<Name>` to @heroicons/react/24/outline). Keeping it a known
// set means notes arrive already-iconed — no later AI pass to classify them.
export const SUPPORTED_NOTE_ICONS: readonly string[] = Array.from(new Set([
    ...NOTE_ICON_KEYWORDS.map(([, icon]) => icon).filter(icon => !icon.startsWith("__")),
    ...Object.values(TYPE_ICON).map(v => v.replace(/^__hero:/, "")),
    // common extras agents may want
    "BellIcon", "FlagIcon", "HeartIcon", "BeakerIcon", "BoltIcon", "CpuChipIcon",
    "DocumentTextIcon", "DocumentDuplicateIcon", "ClipboardIcon", "TagIcon",
    "MapPinIcon", "ClockIcon", "ShieldCheckIcon", "SparklesIcon", "TrophyIcon",
    "ExclamationTriangleIcon", "QuestionMarkCircleIcon", "InboxIcon", "ServerIcon",
    "MagnifyingGlassIcon", "UserIcon", "IdentificationIcon", "FingerPrintIcon",
])).sort();

/**
 * Normalize an agent-supplied icon to a supported `__hero:<Name>` value.
 * Accepts "__hero:RocketLaunchIcon", "RocketLaunchIcon", or "rocketlaunchicon"
 * (case-insensitive). Returns null if the icon isn't in the supported set.
 */
export function normalizeIcon(input: unknown): string | null {
    if (typeof input !== "string") return null;
    const raw = input.trim();
    // Brand icons: routine/agent posts can self-identify (Claude logo, GitHub mark, LinkedIn).
    if (/^(__claude|__img:claude|claude)$/i.test(raw)) return "__claude";
    if (/^(__github|__img:github|github)$/i.test(raw)) return "__github";
    if (/^(__linkedin|__img:linkedin|linkedin)$/i.test(raw)) return "__linkedin";
    if (/^(__gmail|__img:gmail|gmail)$/i.test(raw)) return "__gmail";
    // Combined marks for the audit skill family (rendered in FolderIconDisplay).
    if (/^(__portfolioaudit|__portfolio-audit|portfolio-?audit)$/i.test(raw)) return "__portfolioaudit";
    if (/^(__githubaudit|__github-audit|github-?audit)$/i.test(raw)) return "__githubaudit";
    if (/^(__repoaudit|__repo-audit|repo-?audit)$/i.test(raw)) return "__repoaudit";
    if (/^(__githubstats|__github-stats|github-?stats)$/i.test(raw)) return "__githubstats";
    if (/^(__praudit|__pr-audit|pr-?audit)$/i.test(raw)) return "__praudit";
    if (/^(__prtrends|__pr-trends|pr-?trends|__zetaprstats|zeta-?pr-?stats)$/i.test(raw)) return "__prtrends";
    if (/^(__prsummary|__pr-summary|pr-?summary|__ipaasprstats|ipaas-?pr-?stats)$/i.test(raw)) return "__prsummary";
    if (/^(__reporecon|__repo-recon|repo-?recon)$/i.test(raw)) return "__reporecon";
    if (/^(__securityaudit|__security-audit|security-?audit)$/i.test(raw)) return "__securityaudit";
    if (/^(__epicaudit|__epic-audit|epic-?audit)$/i.test(raw)) return "__epicaudit";
    if (/^(__projectaudit|__project-audit|project-?audit|project-?recon)$/i.test(raw)) return "__projectaudit";
    if (/^(__devaudit|__dev-audit|dev-?audit)$/i.test(raw)) return "__devaudit";
    if (/^(__repotest|__repo-test|repo-?test)$/i.test(raw)) return "__repotest";
    if (/^(__skillaudit|__skill-audit|skill-?audit)$/i.test(raw)) return "__skillaudit";
    if (/^(__storageaudit|__storage-audit|storage-?audit)$/i.test(raw)) return "__storageaudit";
    if (/^(__resourceaudit|__resource-audit|resource-?audit)$/i.test(raw)) return "__resourceaudit";
    // App-source icons: "__app:<key>" sets the note's MAIN icon to a registered app
    // logo (see lib/app-icons). Accept only keys that resolve to a known icon file.
    // Skill-generated reports self-identify this way: a /repo-audit report posts
    // icon:"__app:repo-audit" (which SKILL produced it) while the source sub-icon,
    // computed separately from created_by_key, still shows WHO submitted it (the
    // audited app). The two are independent - main icon = skill, sub-icon = submitter.
    if (/^__app:/i.test(raw)) {
        const key = raw.slice(6).toLowerCase();
        return appIconForKey(key) ? `__app:${key}` : null;
    }
    const bare = raw.replace(/^__hero:/i, "");
    if (!bare) return null;
    const match = SUPPORTED_NOTE_ICONS.find(n => n.toLowerCase() === bare.toLowerCase());
    return match ? `__hero:${match}` : null;
}

// Icons that are only meaningful as a TITLE topic. Nearly every agent-posted
// note mentions "claude"/"ai"/"llm" somewhere in its body, so letting these
// match on content collapses unrelated notes (status reports, recaps) to a
// robot face. They only win when the title itself is about AI.
const TITLE_ONLY_ICONS = new Set(["RobotIcon"]);

function scanForIcon(text: string, titleScope: boolean): string | null {
    for (const [keywords, icon] of NOTE_ICON_KEYWORDS) {
        if (!titleScope && TITLE_ONLY_ICONS.has(icon)) continue;
        if (keywords.some(kw =>
            kw.length <= 3
                ? text.includes(` ${kw} `) || text.includes(`${kw}/`) || text.includes(`/${kw}`)
                : text.includes(kw)
        )) return icon.startsWith("__") ? icon : `__hero:${icon}`;
    }
    return null;
}

export function matchNoteIcon(title: string, content?: string): string | null {
    // Brand override: any note whose TITLE mentions "Fable" (the Claude Fable
    // model) gets the Fable butterfly-S icon, ahead of every keyword rule (owner
    // request 2026-07-17). Caught here so incoming "Fable Scan - ..." posts get it
    // on creation instead of the generic audit checkmark.
    if (/\bfable\b/i.test(title)) return "__app:fable";
    // Skill-report brand tiles: match the producing skill by title so its notes
    // get a distinctive, on-brand icon in the list (owner request 2026-08-08).
    // Ahead of the generic keyword table so "report"/"audit"/"team" can't win.
    const tl = title.toLowerCase();
    if (/\bgithub profile audit\b/.test(tl)) return "__github";
    if (/\brepo recon\b/.test(tl)) return "__hero:FingerPrintIcon";
    if (/\brepo audit\b/.test(tl)) return "__hero:MagnifyingGlassIcon";
    if (/\busage (report|alert)\b/.test(tl)) return "__hero:ChartBarIcon";
    if (/\bzeta (activity|team)\b/.test(tl)) return "__hero:UserGroupIcon";
    if (/\bskill audit\b/.test(tl)) return "__skillaudit";
    if (/\bdev audit\b/.test(tl)) return "__hero:UserIcon";
    if (/\bresource audit\b/.test(tl)) return "__hero:CpuChipIcon";
    if (/\bsession recap\b/.test(tl)) return "__hero:ArrowPathIcon";
    // Title is the strongest topic signal: match it first so an incidental
    // "ai"/"status"/"model" mention in the body can't override a clear title.
    // Only fall back to title+content when the title alone matches nothing.
    const titleOnly = scanForIcon(` ${title} `.toLowerCase(), true);
    if (titleOnly) return titleOnly;
    // Strip HTML tags+attributes before scanning content: inline styles leak
    // "color"/"style"/"theme" into every HTML note and would mis-match Swatch.
    const visible = (content || "").replace(/<[^>]+>/g, " ").slice(0, 200);
    return scanForIcon(` ${title} ${visible} `.toLowerCase(), false);
}

/**
 * Resolve the icon for a note: keyword match → type fallback → default.
 * Always returns a usable `__hero:` value (never null), so auto-assign covers
 * 100% of notes.
 */
export function pickNoteIcon(title: string, content: string | undefined, type: string | null | undefined): string {
    return matchNoteIcon(title, content)
        || (type ? TYPE_ICON[type] : undefined)
        || DEFAULT_NOTE_ICON;
}
