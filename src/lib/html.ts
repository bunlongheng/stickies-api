// Pure HTML helpers for the notes UI. No React, no app state, no DOM access.

/**
 * Wrap an HTML note for the preview iframe with theme-aware DEFAULTS only.
 * Author styling (inline styles, <style> blocks — colored pills, table borders,
 * accent underlines) ALWAYS wins; we only fill in a sensible background/text/
 * font when the author didn't specify, so plain HTML is readable and matches
 * the app theme without a black box, while designed HTML renders as authored.
 */
export function wrapHtmlWithTheme(content: string, isDark: boolean): string {
    const bg     = isDark ? "#1a1a1a" : "#ffffff";
    const fg     = isDark ? "#e8e8e8" : "#1a1a1a";
    const link   = isDark ? "#6ab0ff" : "#0066cc";
    const thumb  = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.18)";
    const scrollbarCss = `::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${thumb};border-radius:6px}*{scrollbar-width:thin;scrollbar-color:${thumb} transparent}`;
    // No-swing guards — ENFORCED (!important) so a wide table / long string /
    // fixed-width element can never push horizontal overflow and make the note
    // wobble sideways. Layout-only; doesn't touch author colors.
    const noSwingCss = `html,body{max-width:100%!important;overflow-x:hidden!important}`
        + `*,*::before,*::after{box-sizing:border-box}`
        + `body{overflow-wrap:break-word;word-break:break-word}`
        + `img,svg,video,canvas,iframe{max-width:100%!important;height:auto}`
        + `pre{max-width:100%;overflow-x:auto}`           // long code scrolls inside its own box, not the page
        + `table{max-width:100%;table-layout:fixed;width:100%}`
        + `td,th{overflow-wrap:break-word;word-break:break-word}`;
    // Theme DEFAULTS — no !important, so any author rule/inline style overrides.
    const themeCss = `html,body{background:${bg};color:${fg};margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;line-height:1.6;font-size:15px}`
        + `a{color:${link}}`
        + `body{zoom:0.67}`   // render HTML notes at 67% so wide dashboards fit without manual browser zoom
        + noSwingCss;
    // Defaults must lose to author styles, so inject them FIRST (before author CSS).
    const themeStyle = `<style>${scrollbarCss}${themeCss}</style>`;
    // Theme ENFORCEMENT — !important + injected LAST so it wins over any author
    // rule. Forces the PAGE background/text to the selected app theme, so a note
    // that hardcoded a dark body never renders dark in light mode (and vice-versa).
    // Only the page-level surface is forced; inner elements keep their own colors.
    const enforceStyle = `<style>html,body{background:${bg}!important;color:${fg}!important}</style>`;
    const appendEnforced = (doc: string): string =>
        /<\/body>/i.test(doc) ? doc.replace(/<\/body>/i, `${enforceStyle}</body>`) : doc + enforceStyle;
    // Full document: inject defaults right after <head> opens (before author styles).
    if (/^\s*<!DOCTYPE\s+html/i.test(content) || /^\s*<html[\s>]/i.test(content)) {
        if (/<head[^>]*>/i.test(content)) return appendEnforced(content.replace(/(<head[^>]*>)/i, `$1${themeStyle}`));
        if (/<html[^>]*>/i.test(content)) return appendEnforced(content.replace(/(<html[^>]*>)/i, `$1<head>${themeStyle}</head>`));
        return appendEnforced(themeStyle + content);
    }
    // Bare fragment: pull out bare <script> + bare CSS blocks, then wrap in a doc
    // with theme defaults FIRST and the author's extracted CSS AFTER (author wins).
    let bodyContent = content;
    const extractedScripts = (content.match(/<script[\s\S]*?<\/script>/gi) ?? []).join("\n");
    bodyContent = bodyContent.replace(/<script[\s\S]*?<\/script>/gi, "");
    let extractedCss = "";
    if (!bodyContent.includes("<style")) {
        const cssLineRegex = /^[ \t]*(?:\*|#[\w-]|\.[\w-]|@[\w]|(?!(?:new|const|let|var|function|if|for|while|return|import|export)\b)[a-z][\w-]*(?:\s*[{,:.>+~]|\s+[.#*[\w]))[^;{}(]*\{[^{}]*\}[ \t]*$/gm;
        const matches = [...bodyContent.matchAll(cssLineRegex)];
        if (matches.length >= 3) { extractedCss = matches.map(m => m[0]).join("\n"); bodyContent = bodyContent.replace(cssLineRegex, ""); }
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${scrollbarCss}${themeCss}</style><style>${extractedCss}</style></head><body>${bodyContent}${extractedScripts}${enforceStyle}</body></html>`;
}
