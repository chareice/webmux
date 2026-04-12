import test from "node:test";
import assert from "node:assert/strict";

import { shouldLoadMachineBookmarks } from "./sidebarSections.ts";

test("machine bookmarks only load after the section is expanded once", () => {
  assert.equal(
    shouldLoadMachineBookmarks({ expanded: false, loaded: false }),
    false,
  );
  assert.equal(
    shouldLoadMachineBookmarks({ expanded: true, loaded: false }),
    true,
  );
  assert.equal(
    shouldLoadMachineBookmarks({ expanded: true, loaded: true }),
    false,
  );
});
