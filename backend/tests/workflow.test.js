import test from "node:test";
import assert from "node:assert/strict";
import { canTransition, STATUSES } from "../src/workflow.js";

test("workflow exposes expected states", () => {
  assert.deepEqual(STATUSES, ["Open","In Progress","Awaiting Approval","Resolved","Closed"]);
});
test("cannot skip directly from Open to Closed", () => {
  assert.equal(canTransition("Open","Closed","Admin"), false);
});
test("only Lead or Admin can approve an item", () => {
  assert.equal(canTransition("Awaiting Approval","Resolved","Member"), false);
  assert.equal(canTransition("Awaiting Approval","Resolved","Lead"), true);
  assert.equal(canTransition("Awaiting Approval","Resolved","Admin"), true);
});
test("valid normal transition is allowed", () => {
  assert.equal(canTransition("Open","In Progress","Member"), true);
});
