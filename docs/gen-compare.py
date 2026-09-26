#!/usr/bin/env python3
"""Regenerate compare.html. Edit ROWS, re-run, done.

Every figure is measured, never estimated. Re-measure before changing a number:
deps and disk from package.json + du, latency and concurrency from a live run
against both services, memory from ps on the serving process.
"""
import base64, pathlib

# COLUMN ORDER (owner rule 2026-09-14): the OLDER thing is always column A (left),
# the NEWER one always column B (right). The eye reads left to right as a timeline,
# so a reversed table quietly inverts every comparison on the page.
A, B, INK = "#f79256", "#b06ac7", "#2f3033"   # A = older / left, B = newer / right
# Text needs a darker shade of the same hue. The tab colours are only 2.2:1 and
# 3.6:1 on cream - fine behind white tab text, unreadable as body text.
A_TEXT, B_TEXT = "#c24e09", "#a250bd"         # 4.7:1 and 4.6:1 on cream
TEXT = {A: A_TEXT, B: B_TEXT}
YES, NO, CREAM, SUB = "#4ecdc4", "#f56a9b", "#fffcf7", "#8b9096"
uri = lambda s: "data:image/svg+xml;base64," + base64.b64encode(
    pathlib.Path(f"/tmp/si/{s}.svg").read_bytes()).decode()


# One black line-icon per row, inline SVG so it survives Stickies (no font, no CDN).
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

def stack(items, col=INK):
    return "".join(
        f'<span style="display:inline-block;margin:0 5px;white-space:nowrap;">'
        f'<img src="{uri(sl)}" alt="{n}" width="14" height="14" style="vertical-align:-2px;margin-right:3px;">'
        f'<span style="font-size:10px;color:{TEXT.get(col, col)};">{n}</span></span>' for sl, n in items)

def mark(ok):
    c, g = (YES, "&#10003;") if ok else (NO, "&#10007;")
    return (f'<span style="display:inline-block;width:22px;height:22px;line-height:22px;'
            f'border-radius:50%;background:{c};color:#fff;font-size:12px;font-weight:700;">{g}</span>')

# One vertical rule per boundary: left border on every cell, right only on the
# last column. Bordering both sides doubles every internal line.
def cell(v, col, first, last, rightmost):
    r = ("border-radius:0 4px 0 0;" if first and rightmost else
         "border-radius:0 0 12px 0;" if last and rightmost else "")
    top = f"border-top:{'2px' if first else '1px'} solid {col};"
    bot = f"border-bottom:2px solid {col};" if last else ""
    right = f"border-right:2px solid {col};" if rightmost else ""
    body = (v if isinstance(v, str) and "<img" in v else mark(v) if isinstance(v, bool)
            else f'<span style="color:{TEXT[col]};">{v}</span>')
    return (f'<td style="box-sizing:border-box;height:40px;padding:0 5px;vertical-align:middle;background:{CREAM};{top}{bot}border-left:2px solid {col};'
            f'{right}{r}text-align:center;font-size:13.5px;">{body}</td>')

# The label column is not a product, so its rules are ink, not a brand colour.
RULE = INK   # the icon divider is ink, same as every other rule in the label column

def label(t, icon, first, last):
    """Two cells: a narrow icon column, then the text, divided by a full-height rule."""
    top = f"border-top:{'2px' if first else '1px'} solid {INK};"
    bot = f"border-bottom:2px solid {INK};" if last else ""
    r_ico = "border-radius:4px 0 0 0;" if first else "border-radius:0 0 0 12px;" if last else ""
    icon_td = (f'<td style="box-sizing:border-box;height:40px;width:40px;padding:0;text-align:center;'
               f'vertical-align:middle;background:{CREAM};{top}{bot}border-left:2px solid {INK};'
               f'border-right:1px solid {RULE};{r_ico}">{ico(icon)}</td>')
    text_td = (f'<td style="box-sizing:border-box;height:40px;padding:0 12px;vertical-align:middle;'
               f'background:{CREAM};{top}{bot}font-size:13.5px;line-height:1.35;color:{INK};">{t}</td>')
    return icon_td + text_td

ROWS = [
    ("Runtime dependencies",            "layers", "30",          "6"),
    ("Packages installed",              "box",    "502",         "25"),
    ("node_modules on disk",            "drive",  "902 MB",      "114 MB"),
    ("API source lines",                "code",   "3,457",       "4,372"),
    ("Idle memory",                     "cpu",    "47 MB",       "21 MB"),
    ("Folder counts, p50",              "clock",  "122 ms",      "107 ms"),
    ("50 concurrent reads, wall",       "zap",    "1,506 ms",    "955 ms"),
    ("Build before it runs",            "tool",   "next build",  "None"),
    ("Realtime transport",              "sync",   "Pusher",      "SSE"),
    ("Live event size cap",             "db",     "10 KB",       "None"),
    ("Generated client contract",       "term",   "None",        "openapi.yaml"),
    ("Runs with no build step",         "slash",  False, True),
    ("Realtime with no paid service",   "link",   False, True),
    ("Native app can sign in",          "phone",  False, True),
    ("Passcode hash stays server-side", "shield", False, True),
    ("Restarts itself after a reboot",  "back",   True,  False),
    ("Committed to git",                "lock",   True,  False),
    ("Serves Noto today",               "laptop", True,  True),
    ("Serves stickies-web today",       "home",   True,  False),
]
n = len(ROWS)
rows = "\n".join("    <tr>" + label(t, ic, i == 0, i == n-1)
                 + cell(a, A, i == 0, i == n-1, False)
                 + cell(b, B, i == 0, i == n-1, True) + "</tr>"
                 for i, (t, ic, a, b) in enumerate(ROWS))

tab = lambda col, name: (f'<div style="background:{col};color:#fff;font-weight:700;font-size:13.5px;'
                         f'text-align:center;padding:9px 4px;border-radius:8px 8px 0 0;'
                         f'line-height:1.25;display:block;">{name}</div>')
key = lambda c, l, sq=False: (
    f'<span><span style="display:inline-block;width:13px;height:13px;border-radius:'
    f'{"3px" if sq else "50%"};background:{c};vertical-align:-2px;margin-right:5px;"></span>{l}</span>')

html = f'''<div style="width:100%;max-width:1100px;margin:0 auto;padding:28px 12px 20px;box-sizing:border-box;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;color:{INK};-webkit-text-size-adjust:100%;">

  <div style="text-align:center;margin-bottom:20px;">
    <div style="font-size:24px;font-weight:700;color:{INK};letter-spacing:-.3px;">stickies vs stickies-api</div>
    <div style="font-size:13px;color:{SUB};margin-top:4px;line-height:1.5;">The standalone API against the monolith it would replace . Every number measured on this Mac . 2026-09-24</div>
  </div>

  <table style="width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0;padding:0;">
    <tr>
      <td style="width:40px;padding:0;"></td>
      <td style="width:40%;padding:0;"></td>
      <td style="width:28%;padding:0;vertical-align:bottom;">{tab(A, "stickies")}</td>
      <td style="width:28%;padding:0;vertical-align:bottom;">{tab(B, "stickies-api")}</td>
    </tr>
{rows}
  </table>



</div>
'''
(pathlib.Path(__file__).resolve().parent.parent / "compare.html").write_text(html)
print(f"{n} rows, {len(html)} bytes")
