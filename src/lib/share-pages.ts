/**
 * Pure HTML builders for the public share flow (no React, no DB). The safe
 * gate page stays in the route (it needs OG meta); these are the 2 pieces that
 * run after a correct passcode.
 */

/** Theme surface colors, kept identical to lib/html.ts wrapHtmlWithTheme. */
export const SHARE_BG = { dark: "#1a1a1a", light: "#ffffff" } as const;

/**
 * Injected into a shared note's <head> when it arrives from the unlock page:
 * the body fades in over the theme background so the black safe -> note
 * hand-off reads as one continuous reveal, never a white flash + hard cut.
 */
export const REVEAL_STYLE =
    `<style>@keyframes stickiesReveal{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}` +
    `body{animation:stickiesReveal .55s ease-out both}` +
    `@media (prefers-reduced-motion:reduce){body{animation:none}}</style>`;

/**
 * The "access granted" beat between the black safe and the note. Same dark
 * room as the gate: a radar sweeps the file (rings, crosshair, a green beam
 * with a fading trail, blips that light as it passes), the readout flips from
 * SCANNING to ACCESS GRANTED, then the scene dissolves into a veil of the
 * note's own theme color before navigating, so the next page paints on the
 * same surface it fades on.
 */
export function unlockedSuccessPage(target: string, isDark: boolean): string {
    const veil = isDark ? SHARE_BG.dark : SHARE_BG.light;
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ACCESS GRANTED</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;-webkit-font-smoothing:antialiased}
body{background:radial-gradient(ellipse at 50% 30%,#181818 0%,#000 80%);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.scene{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;
  animation:appear .28s ease-out both,dissolve .48s ease-in 1.42s forwards}
@keyframes appear{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
@keyframes dissolve{to{opacity:0;filter:blur(18px);transform:scale(1.04)}}
.veil{position:fixed;inset:0;background:${veil};opacity:0;pointer-events:none;animation:veil .55s ease-in 1.4s forwards}
@keyframes veil{to{opacity:1}}
/* radar dish: rings + crosshair etched into dark glass */
.radar{position:relative;width:46vmin;height:46vmin;max-width:340px;max-height:340px;border-radius:50%;overflow:hidden;
  background:
    repeating-radial-gradient(circle at 50% 50%,rgba(74,201,143,.16) 0 1px,transparent 1px 25%),
    linear-gradient(rgba(74,201,143,.16),rgba(74,201,143,.16)) 50% 0/1px 100% no-repeat,
    linear-gradient(rgba(74,201,143,.16),rgba(74,201,143,.16)) 0 50%/100% 1px no-repeat,
    radial-gradient(circle at 50% 50%,#0f1512 0%,#070908 70%,#000 100%);
  box-shadow:0 0 0 1px rgba(74,201,143,.22),0 0 40px rgba(74,201,143,.12),inset 0 0 40px rgba(0,0,0,.8)}
/* the beam: a thin bright edge with a long fading trail behind it */
.sweep{position:absolute;inset:0;border-radius:50%;
  background:conic-gradient(from 0deg,rgba(74,201,143,0) 0deg,rgba(74,201,143,.05) 220deg,rgba(74,201,143,.28) 330deg,rgba(120,255,190,.9) 359deg,rgba(74,201,143,0) 360deg);
  animation:sweep 1.25s linear .15s 1 forwards;transform:rotate(0deg)}
@keyframes sweep{to{transform:rotate(720deg)}}
.center{position:absolute;top:50%;left:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:#4ac98f;box-shadow:0 0 10px #4ac98f}
/* blips light up as the beam passes, then linger */
.blip{position:absolute;width:7px;height:7px;margin:-3.5px;border-radius:50%;background:#7dffbe;opacity:0;
  box-shadow:0 0 10px 2px rgba(125,255,190,.8);animation:blip 1.1s ease-out forwards}
.b1{top:32%;left:64%;animation-delay:.42s}.b2{top:66%;left:40%;animation-delay:.68s}.b3{top:44%;left:26%;animation-delay:.94s}
@keyframes blip{0%{opacity:0;transform:scale(.4)}15%{opacity:1;transform:scale(1.4)}100%{opacity:.75;transform:scale(1)}}
/* LCD readout under the dish */
.lcd{position:relative;height:18px;width:46vmin;max-width:340px;text-align:center;font-size:12px;letter-spacing:.34em;font-weight:700}
.lcd span{position:absolute;inset:0;white-space:nowrap}
.scan{color:rgba(74,201,143,.75);animation:scanTxt 1.2s steps(1) forwards}
@keyframes scanTxt{0%{opacity:1}100%{opacity:0}}
.ok{color:#7dffbe;text-shadow:0 0 12px rgba(125,255,190,.8);opacity:0;animation:okTxt .3s ease-out 1.2s forwards}
@keyframes okTxt{to{opacity:1}}
.scan i{font-style:normal;animation:dots 1.2s steps(4) infinite}
@keyframes dots{0%{content:""}}
@media (prefers-reduced-motion:reduce){.scene,.sweep,.blip,.veil,.scan,.ok{animation-duration:.01ms;animation-delay:0s}}
</style>
</head><body>
<div class="scene">
  <div class="radar">
    <div class="sweep"></div>
    <span class="blip b1"></span><span class="blip b2"></span><span class="blip b3"></span>
    <span class="center"></span>
  </div>
  <div class="lcd"><span class="scan">SCANNING FILE</span><span class="ok">ACCESS GRANTED</span></div>
</div>
<div class="veil"></div>
<script>
(function(){
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      var ctx = new AC();
      var beep = function(freq, start, dur){
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "square"; o.frequency.value = freq;
        g.gain.setValueAtTime(0, ctx.currentTime + start);
        g.gain.linearRampToValueAtTime(0.08, ctx.currentTime + start + 0.01);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
        o.connect(g); g.connect(ctx.destination);
        o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + dur + 0.02);
      };
      beep(523.25, 0.42, 0.06); beep(523.25, 0.68, 0.06); beep(523.25, 0.94, 0.06); beep(987.77, 1.2, 0.26);
    }
  } catch(e){}
  setTimeout(function(){ window.location.replace(${JSON.stringify(target)}); }, 1950);
})();
</script>
</body></html>`;
}
