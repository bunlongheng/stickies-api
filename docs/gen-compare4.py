#!/usr/bin/env python3
"""Regenerate compare4.html - the 4-way view of the Stickies system.

Every figure is measured, never estimated. Re-measure before changing one:
deps from package.json, packages and size from ls/du on node_modules, source
lines from find+cat excluding node_modules and .build, git from rev-list and
status, artifact size from du on .next / Noto.app.

Column order is the owner's: legacy first, then api, web, native. The heading
names them in that same order.
"""
import pathlib

INK, CREAM, SUB = "#2f3033", "#fffcf7", "#8b9096"
YES, NO = "#4ecdc4", "#f56a9b"
# 4 column identities. Tab colour behind white text, TEXT shade for body values
# (the tab colours sit near 2-3:1 on cream and are unreadable as type).
COLS = [
    ("Legacy Stickies", "#f79256", "#c24e09"),
    ("stickies-api",    "#b06ac7", "#a250bd"),
    ("stickies-web",    "#5b8def", "#2f5fc4"),
    ("Noto native",     "#6ab04c", "#3f7a29"),
]

SVG = {
 "layers":'<path d="m12.8 2.2a2 2 0 0 0-1.6 0L2.6 6.1a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0l8.6-3.9a1 1 0 0 0 0-1.8Z"/><path d="m22 17.6-9.2 4.2a2 2 0 0 1-1.6 0L2 17.6"/><path d="m22 12.6-9.2 4.2a2 2 0 0 1-1.6 0L2 12.6"/>',
 "sync":'<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
 "db":'<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.7-4 3-9 3s-9-1.3-9-3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/>',
 "drive":'<path d="M22 12H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/><path d="M6 16h.01"/><path d="M10 16h.01"/>',
 "clock":'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
 "box":'<path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22.1V12"/>',
 "code":'<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
 "cpu":'<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>',
 "zap":'<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
 "tool":'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z"/>',
 "laptop":'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
 "link":'<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
 "lock":'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
 "shield":'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
 "slash":'<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
 "home":'<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
 "phone":'<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
 "search":'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
 "back":'<path d="M3 2v6h6"/><path d="M3.5 9a9 9 0 1 0 2.1-3.4L3 8"/>',
 "term":'<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
}

def ico(name):
    return (f'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="{INK}" '
            f'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" '
            f'style="vertical-align:-3px;">{SVG[name]}</svg>')

def mark(ok):
    c, g = (YES, "&#10003;") if ok else (NO, "&#10007;")
    return (f'<span style="display:inline-block;width:22px;height:22px;line-height:22px;'
            f'border-radius:50%;background:{c};color:#fff;font-size:12px;font-weight:700;">{g}</span>')

def cell(v, col, text, first, last, rightmost):
    r = ("border-radius:0 4px 0 0;" if first and rightmost else
         "border-radius:0 0 12px 0;" if last and rightmost else "")
    top = f"border-top:{'2px' if first else '1px'} solid {col};"
    bot = f"border-bottom:2px solid {col};" if last else ""
    right = f"border-right:2px solid {col};" if rightmost else ""
    body = mark(v) if isinstance(v, bool) else f'<span style="color:{text};">{v}</span>'
    return (f'<td style="box-sizing:border-box;height:40px;padding:0 4px;vertical-align:middle;'
            f'background:{CREAM};{top}{bot}border-left:2px solid {col};{right}{r}'
            f'text-align:center;font-size:12.5px;">{body}</td>')

def label(t, icon, first, last):
    top = f"border-top:{'2px' if first else '1px'} solid {INK};"
    bot = f"border-bottom:2px solid {INK};" if last else ""
    r_ico = "border-radius:4px 0 0 0;" if first else "border-radius:0 0 0 12px;" if last else ""
    return (f'<td style="box-sizing:border-box;height:40px;width:38px;padding:0;text-align:center;'
            f'vertical-align:middle;background:{CREAM};{top}{bot}border-left:2px solid {INK};'
            f'border-right:1px solid {INK};{r_ico}">{ico(icon)}</td>'
            f'<td style="box-sizing:border-box;height:40px;padding:0 10px;vertical-align:middle;'
            f'background:{CREAM};{top}{bot}font-size:13px;line-height:1.3;color:{INK};">{t}</td>')

ROWS = [
    ("What it is",              "box",    "Next.js app", "HTTP API",  "Next.js UI", "macOS app"),
    ("Runtime dependencies",    "layers", "30",          "6",         "7",          "0"),
    ("Packages installed",      "box",    "502",         "25",        "54",         "none"),
    ("Install size on disk",    "drive",  "902 MB",      "113 MB",    "402 MB",     "4.8 MB"),
    ("Shipped artifact",        "zap",    "218 MB",      "no build",  "148 MB",     "4.8 MB"),
    ("Source lines",            "code",   "27,402",      "4,569",     "4,175",      "3,709"),
    ("HTTP paths it serves",    "term",   "26",          "30",        "3",          "0"),
    ("Realtime transport",      "sync",   "Pusher",      "SSE",       "polls",      "polls"),
    ("Git commits",             "back",   "14",          "0",         "9",          "27"),
    ("Uncommitted files",       "lock",   "14",          "12",        "13",         "0"),
    ("Reads Postgres directly", "db",     True,  True,  True,  False),
    ("Serves other clients",    "link",   True,  True,  False, False),
    ("Has a user interface",    "laptop", True,  False, True,  True),
    ("Needs a browser",         "home",   True,  False, True,  False),
    ("Needs a build to run",    "tool",   True,  False, True,  True),
    ("Running right now",       "clock",  True,  False, False, True),
    ("Restarts after a reboot", "shield", True,  False, False, False),
]

n = len(ROWS)
rows = []
for i, r in enumerate(ROWS):
    t, icon, vals = r[0], r[1], r[2:]
    cells = "".join(cell(v, COLS[j][1], COLS[j][2], i == 0, i == n-1, j == len(COLS)-1)
                    for j, v in enumerate(vals))
    rows.append("    <tr>" + label(t, icon, i == 0, i == n-1) + cells + "</tr>")
rows = "\n".join(rows)

tab = lambda col, name: (f'<div style="background:{col};color:#fff;font-weight:700;font-size:12.5px;'
                         f'text-align:center;padding:9px 3px;border-radius:8px 8px 0 0;'
                         f'line-height:1.25;">{name}</div>')
heads = "".join(f'<td style="width:15.5%;padding:0;vertical-align:bottom;">{tab(c, nme)}</td>'
                for nme, c, _ in COLS)

html = f'''<div style="width:100%;max-width:1100px;margin:0 auto;padding:28px 12px 20px;box-sizing:border-box;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;color:{INK};-webkit-text-size-adjust:100%;">

  <div style="text-align:center;margin-bottom:20px;">
    <div style="font-size:24px;font-weight:700;color:{INK};letter-spacing:-.3px;">Legacy Stickies vs api, web, native</div>
    <div style="font-size:13px;color:{SUB};margin-top:4px;line-height:1.5;">The one app it used to be, against the three it is becoming . Every number measured on this Mac . 2026-09-25</div>
  </div>

  <div style="overflow-x:auto;">
  <table style="width:100%;min-width:760px;table-layout:fixed;border-collapse:separate;border-spacing:0;padding:0;">
    <tr>
      <td style="width:38px;padding:0;"></td>
      <td style="width:24%;padding:0;"></td>
      {heads}
    </tr>
{rows}
  </table>
  </div>

</div>
'''
out = pathlib.Path(__file__).resolve().parent.parent / "compare4.html"
out.write_text(html)
print(f"{n} rows, 4 columns, {len(html)} bytes -> {out}")
