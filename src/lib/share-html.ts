/**
 * HTML for the public share surface, lifted from the Next.js route. These are
 * pure string builders with no framework coupling, so they moved unchanged
 * apart from taking an `origin` string instead of a Request.
 */
export function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Build the Open Graph / Twitter meta block so shared /raw links render a rich
// preview (note title + generated card image) in iMessage, Slack, etc. No
// description - the note body dumps messy raw text, so title + card only.
export function ogMeta(origin: string, noteId: string, title: string): string {
    const safeTitle = escapeHtml(title || "Stickies");
    const img = `${origin}/api/stickies/public/og?noteId=${encodeURIComponent(noteId)}`;
    const pageUrl = `${origin}/share?noteId=${encodeURIComponent(noteId)}`;
    return [
        `<meta property="og:type" content="article">`,
        `<meta property="og:site_name" content="Stickies">`,
        `<meta property="og:title" content="${safeTitle}">`,
        `<meta property="og:url" content="${pageUrl}">`,
        `<meta property="og:image" content="${img}">`,
        `<meta property="og:image:width" content="1200">`,
        `<meta property="og:image:height" content="630">`,
        `<meta name="twitter:card" content="summary_large_image">`,
        `<meta name="twitter:title" content="${safeTitle}">`,
        `<meta name="twitter:image" content="${img}">`,
    ].join("");
}

export function gatePageHtml(origin: string, noteId: string, title: string, badPassword: boolean, theme: "dark" | "light" = "light"): string {
    const safeTitle = escapeHtml(title);
    const errorBlock = badPassword
        ? `<div class="alert">ACCESS DENIED</div>`
        : `<div class="alert hidden">&nbsp;</div>`;
    const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SAFE // ${safeTitle}</title>
${ogMeta(origin, noteId, title)}
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:radial-gradient(ellipse at 50% 30%,#181818 0%,#000 80%);color:#bdbdbd;font-family:'SF Pro Display',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.room{min-height:100%;display:flex;align-items:center;justify-content:center;padding:32px 20px;perspective:1400px}
.safe{position:relative;width:100%;max-width:420px;padding:38px 30px 34px;border-radius:22px;
  background:linear-gradient(145deg,#1c1c1c 0%,#0e0e0e 35%,#050505 100%);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.07),
    inset 0 -1px 0 rgba(0,0,0,0.7),
    inset 0 0 0 1px rgba(255,255,255,0.025),
    0 1px 0 rgba(255,255,255,0.04),
    0 30px 60px -20px rgba(0,0,0,0.95),
    0 80px 120px -40px rgba(0,0,0,0.8);
  transform:rotateX(2deg);
}
/* brushed metal sheen */
.safe::before{content:"";position:absolute;inset:0;border-radius:22px;pointer-events:none;
  background:repeating-linear-gradient(90deg,rgba(255,255,255,0.014) 0,rgba(255,255,255,0.014) 1px,transparent 1px,transparent 3px);
  mix-blend-mode:overlay;}
.rivet{position:absolute;width:9px;height:9px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#3a3a3a 0%,#0c0c0c 70%,#000 100%);
  box-shadow:inset 0 0.5px 1px rgba(255,255,255,0.18),0 1px 2px rgba(0,0,0,0.9);}
.rivet.tl{top:12px;left:12px}.rivet.tr{top:12px;right:12px}
.rivet.bl{bottom:12px;left:12px}.rivet.br{bottom:12px;right:12px}
.bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
.brand{font-size:9px;letter-spacing:0.32em;color:#555;font-weight:700;font-family:ui-monospace,SFMono-Regular,monospace}
.brand b{color:#bdbdbd}
.status{display:flex;align-items:center;gap:8px;font-size:9px;letter-spacing:0.2em;color:#6c6c6c;font-family:ui-monospace,monospace;font-weight:700}
.led{width:9px;height:9px;border-radius:50%;display:inline-block;background:#fff;
  box-shadow:0 0 6px #fff,0 0 14px rgba(255,255,255,0.5),inset 0 -1px 1px rgba(0,0,0,0.3)}
.led-slow{animation:pulse 1.6s ease-in-out infinite}
.led-fast{animation:pulse 0.45s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
/* LCD display — black + white phosphor */
.lcd{
  background:linear-gradient(180deg,#0a0a0a 0%,#020202 100%);
  border:1px solid #1a1a1a;
  border-radius:8px;
  padding:18px 18px 16px;
  margin-bottom:22px;
  box-shadow:inset 0 2px 8px rgba(0,0,0,0.9),inset 0 0 0 1px rgba(0,0,0,0.4),0 1px 0 rgba(255,255,255,0.04);
  font-family:ui-monospace,'SF Mono',Menlo,monospace;
  position:relative;
}
.lcd::after{content:"";position:absolute;inset:0;border-radius:8px;pointer-events:none;
  background:repeating-linear-gradient(0deg,rgba(0,0,0,0.22) 0,rgba(0,0,0,0.22) 1px,transparent 1px,transparent 2px);}
.lcd .label{font-size:9px;letter-spacing:0.32em;color:#5a5a5a;font-weight:700;margin-bottom:6px}
.lcd .name{font-size:14px;color:#f4f4f4;text-shadow:0 0 8px rgba(255,255,255,0.18);font-weight:600;word-break:break-word;line-height:1.4}
.alert{margin:-6px 0 16px;font-size:10px;letter-spacing:0.3em;color:#fff;font-weight:700;text-align:center;font-family:ui-monospace,monospace;text-shadow:0 0 10px rgba(255,255,255,0.7);animation:flash 0.5s ease-in-out 3}
@keyframes flash{0%,100%{opacity:1}50%{opacity:0.25}}
.alert.hidden{visibility:hidden;animation:none}
.entry{
  display:flex;align-items:center;
  background:linear-gradient(180deg,#0a0a0a 0%,#020202 100%);
  border:1px solid #1a1a1a;border-radius:10px;
  padding:6px 16px;
  box-shadow:inset 0 2px 6px rgba(0,0,0,0.9),0 1px 0 rgba(255,255,255,0.03);
}
/* type=text + text-security masks input WITHOUT being a password field, so
   LastPass/1Password never attach their autofill icon. */
.entry input{flex:1;background:transparent;border:0;outline:0;color:#fff;font-size:16px;font-family:ui-monospace,monospace;letter-spacing:0.25em;padding:10px 0;text-shadow:0 0 4px rgba(255,255,255,0.3);-webkit-text-security:disc;text-security:disc}
.entry input::placeholder{color:#3a3a3a;letter-spacing:0.15em;font-size:12px}
.meta{margin-top:18px;display:flex;align-items:center;justify-content:space-between;font-size:9px;letter-spacing:0.25em;color:#3a3a3a;font-family:ui-monospace,monospace;font-weight:600}
.meta .dot{width:4px;height:4px;border-radius:50%;background:#3a3a3a;display:inline-block;margin:0 8px;vertical-align:middle}
</style>
</head><body>
<div class="room">
<form class="safe" method="POST" action="/share?noteId=${encodeURIComponent(noteId)}&theme=${theme}">
  <span class="rivet tl"></span><span class="rivet tr"></span>
  <span class="rivet bl"></span><span class="rivet br"></span>

  <div class="lcd">
    <div class="label">CONTENTS</div>
    <div class="name">${safeTitle}</div>
  </div>

  ${errorBlock}

  <div class="entry">
    <input name="password" type="text" autofocus autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other" required placeholder="passcode">
  </div>
</form>
</div>
</body></html>`;
    return html;
}
