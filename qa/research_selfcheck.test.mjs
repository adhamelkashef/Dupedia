/* X FORCE 2.1 — research secret self-check and tolerant key reading. Run:  node --test qa/research_selfcheck.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { secretCheck, researchConfig } from "../worker/research.js";
import { secretOf } from "../worker/providers.js";

test("self-check lists setting NAMES only, never values", () => {
  const c = secretCheck({ DB: {}, SETUP_CODE: "very-secret-setup", TAVILY_API_KEY: "tvly-dev-abcdefghijklmnop", GEMINI_API_KEY: "AIzaabcdefghijklmnopqrstu" });
  assert.deepEqual(c.names, ["GEMINI_API_KEY", "SETUP_CODE", "TAVILY_API_KEY"]);
  assert.ok(!JSON.stringify(c).includes("very-secret") && !JSON.stringify(c).includes("tvly-dev") && !JSON.stringify(c).includes("AIza"));
  assert.equal(c.tavily.found, true); assert.equal(c.gemini.found, true);
});

test("self-check spots near-miss names (lower case, spaces, dashes)", () => {
  const c = secretCheck({ "tavily_api_key": "tvly-dev-abcdefghijklmnop", "GEMINI-API-KEY ": "AIzaabcdefghijklmnopqrstu" });
  assert.equal(c.tavily.found, false); assert.deepEqual(c.tavily.similar, ["tavily_api_key"]);
  assert.equal(c.gemini.found, false); assert.deepEqual(c.gemini.similar, ["GEMINI-API-KEY "]);
  assert.equal(researchConfig({ "tavily_api_key": "x".repeat(40) }).configured, false, "a wrong name is not silently accepted");
});

test("self-check spots an empty or too-short value", () => {
  const c = secretCheck({ TAVILY_API_KEY: "  ", GEMINI_API_KEY: "abc" });
  assert.equal(c.tavily.found, true); assert.equal(c.tavily.length, 0); assert.equal(c.tavily.extraSpaces, true); assert.equal(c.gemini.length, 3);
});

test("keys pasted with spaces, a line break or quotes still work", () => {
  assert.equal(secretOf({ K: '  "tvly-dev-abcdefghij"\n' }, "K"), "tvly-dev-abcdefghij");
  assert.equal(secretOf({ K: "“AIzaabcdefghijklmnop”" }, "K"), "AIzaabcdefghijklmnop");
  const c = researchConfig({ TAVILY_API_KEY: " tvly-dev-abcdefghijklmnop \n", GEMINI_API_KEY: '"AIzaabcdefghijklmnopqrstu"' });
  assert.equal(c.configured, true); assert.deepEqual(c.missing, []);
});
