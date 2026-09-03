#!/usr/bin/env node
/**
 * app/e2e/contrast.mjs — measured contrast for the create-event modal.
 *
 * Reads the COMPUTED colours out of the real components (via the same harness
 * as shots.mjs) and prints a WCAG ratio per field, in both themes. Written
 * because the reported bug was "dark mode has text which is bad contrast when
 * we want to create new event", and eyeballing a screenshot cannot tell you
 * whether a fix cleared 4.5:1 or landed on 3.1:1.
 *
 * It reads the background by walking UP from the element, the way the eye does:
 * an <input> with a transparent background is judged against whatever is
 * actually behind it, which is the case that produced the bug (a field with no
 * `color` of its own, rendering the UA's black on a dark modal).
 *
 * Run the build first (shots.mjs does it):
 *   node e2e/shots.mjs && node e2e/contrast.mjs
 */
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname, resolve } from "node:path";
const root = resolve("../data/shots-build");
const TYPES={".html":"text/html",".js":"text/javascript",".css":"text/css"};
const server = createServer(async (req,res)=>{
  const rel = normalize(decodeURIComponent((req.url??"/").split("?")[0]));
  const abs = join(root, rel==="/"?"/index.html":rel);
  try { const b=await readFile(abs); res.writeHead(200,{"Content-Type":TYPES[extname(abs)]??"application/octet-stream"}); res.end(b);} catch { res.writeHead(404).end(); }
});
await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
const port=server.address().port;
const browser=await chromium.launch();
for (const theme of ["dark","light"]) {
  const page=await browser.newPage({viewport:{width:900,height:900}});
  await page.goto(`http://127.0.0.1:${port}/?theme=${theme}`,{waitUntil:"load"});
  await page.locator("form").first().waitFor();
  if (!process.argv.includes("--no-focus")) {
    await page.locator('input[class*="date__input"]').first().click();
    await page.waitForTimeout(200);
  }
  const rows = await page.evaluate(() => {
    const lin=(c)=>{c/=255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;};
    const L=([r,g,b])=>0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
    const parse=(s)=>{const m=s.match(/[\d.]+/g);return m?m.slice(0,3).map(Number):null;};
    // Walk up for the first non-transparent background, the way the eye does.
    const bgOf=(el)=>{
      let n=el;
      while(n){
        const cs=getComputedStyle(n); const bg=cs.backgroundColor;
        if(bg && !/rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(bg)) return parse(bg);
        n=n.parentElement;
      }
      return [0,0,0];
    };
    const ratio=(a,b)=>{const la=L(a),lb=L(b);const hi=Math.max(la,lb),lo=Math.min(la,lb);return (hi+0.05)/(lo+0.05);};
    const targets=[
      ["date input",'input[class*="date__input"]'],
      ["time input",'input[class*="time__input"], input[class*="time"]'],
      ["title input",'input[class*="modal__form__title"]'],
      ["description",'textarea'],
      ["peer input",'input[class*="peers__input"]'],
      ["mini-calendar today",'[class*="day_today"], [class*="_today"]'],
      ["checkbox label",'span[class*="checkbox__title"]'],
      ["create button",'button[class*="modal__form__btn"]'],
    ];
    const out=[];
    for (const [name,sel] of targets){
      const el=document.querySelector(sel);
      if(!el){out.push([name,"—","—",null]);continue;}
      const fg=parse(getComputedStyle(el).color);
      const bg=bgOf(el);
      out.push([name, `rgb(${fg})`, `rgb(${bg})`, +ratio(fg,bg).toFixed(2)]);
    }
    return out;
  });
  console.log(`\n### ${theme}`);
  for(const [n,fg,bg,r] of rows){
    const flag = r===null ? "" : (r<3 ? "  ⚠️ FAIL" : r<4.5 ? "  ~ large-text only" : "  ok");
    console.log(`  ${n.padEnd(22)} fg=${String(fg).padEnd(20)} bg=${String(bg).padEnd(20)} ${r===null?"":r+":1"}${flag}`);
  }
  await page.close();
}
await browser.close(); server.close();
