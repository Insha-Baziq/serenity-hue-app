import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("formula builder keeps calculation and ratio in separate grid areas", () => {
  assert.match(css, /\.lab-formula-builder__row\s*\{[^}]*grid-template-columns:\s*minmax\(170px, 1\.25fr\) minmax\(130px, \.8fr\) minmax\(90px, \.55fr\) 76px minmax\(140px, 1fr\) 34px/);
  assert.match(css, /grid-template-areas:\s*"ingredient calculation ratio phase note remove"/);
  assert.match(css, /\.lab-formula-builder__row\s*>\s*label:nth-of-type\(2\)\s*\{[^}]*grid-area:\s*calculation/);
  assert.match(css, /\.lab-formula-builder__row\s*>\s*label:nth-of-type\(3\)\s*\{[^}]*grid-area:\s*ratio/);
  assert.match(css, /\.ui-dialog\.lab-formula-dialog\s*\{[^}]*width:\s*min\(96vw, 960px\)/);
  assert.match(css, /\.lab-formula-builder__row\s+\.ui-input\s*\{[^}]*height:\s*43px[^}]*border:\s*1px solid var\(--line-strong\)/);
});
