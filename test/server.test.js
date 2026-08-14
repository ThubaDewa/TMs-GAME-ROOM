const test = require("node:test");
const assert = require("node:assert/strict");
const {cleanName, cleanWord, cleanPhrase, similar} = require("../server");
test("normalizes game words", () => assert.equal(cleanWord(" tiger! "), "TIGER"));
test("removes markup from names", () => assert.equal(cleanName("<TM>"), "TM"));
test("normalizes survey phrases", () => assert.equal(cleanPhrase("  Sun-Cream! "), "suncream"));
test("accepts close survey variants", () => assert.equal(similar("towels", "towel"), true));
