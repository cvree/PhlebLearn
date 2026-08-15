/* Finds elements whose content escapes the panel, at several viewport sizes.
   The review's screenshots 4 and 5 both show the coaching card running off the
   right edge; this says which element does it and by how much. */
import { chromium } from "@playwright/test";

const PORT = process.env.SHOT_PORT || 4175;
const SIZES = [[1280, 800], [900, 700], [820, 900], [414, 896], [390, 844]];
const STEPS = ["gather", "tourniquet", "palpate", "assemble", "insert", "fill", "invert"];

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
});

let bad = 0;
for(const [w, h] of SIZES){
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`http://localhost:${PORT}/PhlebLearn/?e2e=1`);
  await page.waitForFunction(() => !!window.__phlebTest, null, { timeout: 20000 });

  for(const step of ["idle", ...STEPS]){
    if(step !== "idle"){
      await page.evaluate(s => window.__phlebTest.gotoProcedureStep(
        s, ["lightblue", "lavender"], "learn", "straight-antecubital"), step);
    }
    await page.waitForTimeout(500);
    const report = await page.evaluate(() => {
      const panel = document.getElementById("panel");
      if(!panel) return null;
      const pr = panel.getBoundingClientRect();
      const out = [];
      // horizontal overflow of the panel itself
      if(panel.scrollWidth > panel.clientWidth + 1){
        out.push({ what: "#panel", by: panel.scrollWidth - panel.clientWidth, kind: "scrollWidth" });
      }
      // any descendant sticking out sideways past the panel's padding box
      panel.querySelectorAll("*").forEach(el=>{
        const r = el.getBoundingClientRect();
        if(!r.width) return;
        const over = Math.max(pr.left - r.left, r.right - pr.right);
        if(over > 1.5){
          out.push({
            what: el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : ""),
            by: Math.round(over),
            kind: "escapes",
            text: (el.textContent || "").trim().slice(0, 40),
          });
        }
      });
      // and the page itself must never scroll sideways
      const doc = document.documentElement;
      if(doc.scrollWidth > doc.clientWidth + 1){
        out.push({ what: "document", by: doc.scrollWidth - doc.clientWidth, kind: "page scrolls sideways" });
      }
      return out;
    });
    if(report && report.length){
      bad += report.length;
      console.log(`\n${w}x${h} @ ${step}`);
      report.slice(0, 6).forEach(r => console.log(`   ${r.kind.padEnd(20)} ${String(r.by).padStart(4)}px  ${r.what}  ${r.text || ""}`));
    }
  }
  await page.close();
}
console.log(bad ? `\n${bad} overflow(s)` : "\nno overflow anywhere");
process.exitCode = bad ? 1 : 0;
await browser.close();
