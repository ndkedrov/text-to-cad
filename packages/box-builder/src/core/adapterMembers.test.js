import assert from "node:assert/strict";
import test from "node:test";

import {
  adapterCapabilities,
  confirmWithAdapter,
  fileAction,
  printFloorWithAdapter
} from "./adapterMembers.js";

// The site's adapter as it is today: none of the optional members.
const siteAdapter = Object.freeze({
  fileUrl: (name, part, format) => `/__cad/boxes/file?name=${name}&part=${part}&format=${format}`
});

// A window that records what the panel asked of it.
function fakeWindow({ confirmAnswer = true, opens = true } = {}) {
  const calls = { confirm: [], open: [], written: "", printed: 0 };
  const sheet = {
    opener: "the page",
    document: {
      write: (html) => {
        calls.written += html;
      },
      close: () => {}
    },
    focus: () => {},
    setTimeout: (callback) => callback(),
    print: () => {
      calls.printed += 1;
    }
  };
  return {
    calls,
    sheet,
    confirm: (message) => {
      calls.confirm.push(message);
      return confirmAnswer;
    },
    open: (...args) => {
      calls.open.push(args);
      return opens ? sheet : null;
    }
  };
}

test("without capabilities the hosted prop decides, as it always has", () => {
  assert.deepEqual(adapterCapabilities(siteAdapter), {
    folderPath: true,
    copyFolderPath: true,
    openStep: true,
    quota: true
  });
  assert.deepEqual(adapterCapabilities(siteAdapter, { hosted: true }), {
    folderPath: false,
    copyFolderPath: true,
    openStep: false,
    quota: true
  });
});

test("capabilities decide over the hosted prop; a missing field falls back to it", () => {
  const app = { ...siteAdapter, capabilities: { folderPath: false, openStep: false, quota: false } };
  assert.deepEqual(adapterCapabilities(app), {
    folderPath: false,
    copyFolderPath: false,
    openStep: false,
    quota: false
  });
  const partial = { ...siteAdapter, capabilities: { openStep: true } };
  assert.deepEqual(adapterCapabilities(partial, { hosted: true }), {
    folderPath: false,
    copyFolderPath: true,
    openStep: true,
    quota: true
  });
  const showFolder = { ...siteAdapter, capabilities: { folderPath: true } };
  assert.equal(adapterCapabilities(showFolder, { hosted: true }).folderPath, true);
  // Only booleans count.
  const loose = { ...siteAdapter, capabilities: { folderPath: "no", quota: 0 } };
  assert.deepEqual(adapterCapabilities(loose, { hosted: false }), adapterCapabilities(siteAdapter));
});

test("confirm: the browser's own without a member, the host's with one", async () => {
  const browser = fakeWindow({ confirmAnswer: false });
  assert.equal(await confirmWithAdapter(siteAdapter, "discard?", browser), false);
  assert.deepEqual(browser.calls.confirm, ["discard?"]);
  assert.equal(await confirmWithAdapter(siteAdapter, "again?", fakeWindow({ confirmAnswer: true })), true);

  const asked = [];
  const untouched = fakeWindow();
  const host = { ...siteAdapter, confirm: async (message) => { asked.push(message); return true; } };
  assert.equal(await confirmWithAdapter(host, "discard?", untouched), true);
  assert.deepEqual(asked, ["discard?"]);
  assert.deepEqual(untouched.calls.confirm, [], "window.confirm is not used");

  const refuses = { ...siteAdapter, confirm: async () => false };
  assert.equal(await confirmWithAdapter(refuses, "discard?", untouched), false);
  const vague = { ...siteAdapter, confirm: async () => "yes" };
  assert.equal(await confirmWithAdapter(vague, "discard?", untouched), false, "only true goes ahead");
  const broken = { ...siteAdapter, confirm: async () => { throw new Error("no dialog"); } };
  assert.equal(await confirmWithAdapter(broken, "discard?", untouched), false, "a failed question is not a yes");
});

test("floor sheet: a print window without a member, the host's printing with one", async () => {
  const browser = fakeWindow();
  assert.equal(await printFloorWithAdapter(siteAdapter, "<svg/>", "box-1", browser), true);
  assert.equal(browser.calls.open.length, 1);
  assert.ok(browser.calls.written.includes("<svg/>"));
  assert.equal(browser.calls.printed, 1);
  assert.equal(await printFloorWithAdapter(siteAdapter, "<svg/>", "box-1", fakeWindow({ opens: false })), false,
    "a blocked window is reported");

  const printed = [];
  const untouched = fakeWindow();
  const host = { ...siteAdapter, printFloorSheet: async (svg, title) => { printed.push([svg, title]); return true; } };
  assert.equal(await printFloorWithAdapter(host, "<svg/>", "box-1", untouched), true);
  assert.deepEqual(printed, [["<svg/>", "box-1"]]);
  assert.deepEqual(untouched.calls.open, [], "window.open is not used");

  const fails = { ...siteAdapter, printFloorSheet: async () => false };
  assert.equal(await printFloorWithAdapter(fails, "<svg/>", "box-1", untouched), false);
  const throws = { ...siteAdapter, printFloorSheet: async () => { throw new Error("no printer"); } };
  assert.equal(await printFloorWithAdapter(throws, "<svg/>", "box-1", untouched), false);
});

test("files: a download link without exportFile, the host's export with it", async () => {
  assert.deepEqual(fileAction(siteAdapter, "box-1", "lid", "stl"), {
    kind: "link",
    href: "/__cad/boxes/file?name=box-1&part=lid&format=stl"
  });

  const exported = [];
  // fileUrl is not needed once exportFile is there.
  const app = { exportFile: async (...args) => { exported.push(args); return false; } };
  const action = fileAction(app, "box-1", "inlay", "3mf");
  assert.equal(action.kind, "export");
  assert.equal(action.href, undefined);
  assert.equal(exported.length, 0, "nothing runs until the button is pressed");
  assert.equal(await action.run(), false);
  assert.deepEqual(exported, [["box-1", "inlay", "3mf"]]);
});
