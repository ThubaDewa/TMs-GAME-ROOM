const test = require("node:test");
const assert = require("node:assert/strict");
const {cleanName, cleanWord} = require("../server");
test("normalizes game words", () => assert.equal(cleanWord(" tiger! "), "TIGER"));
test("removes markup from names", () => assert.equal(cleanName("<TM>"), "TM"));
