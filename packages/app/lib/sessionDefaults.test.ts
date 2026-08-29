import { describe, expect, it } from "vitest";
import {
  FALLBACK_SESSION_DEFAULTS,
  modelsForAgentKind,
  readLastCwd,
  readModelCache,
  readSessionDefaults,
  recordSessionModels,
  writeLastCwd,
  writeSessionDefaults,
  type KeyValueStorage,
} from "./sessionDefaults";

function fakeStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

describe("session defaults", () => {
  it("falls back to kimi / no model / machine-default auto-run on first use", () => {
    const storage = fakeStorage();
    expect(readSessionDefaults(storage)).toEqual(FALLBACK_SESSION_DEFAULTS);
    expect(FALLBACK_SESSION_DEFAULTS.agentKind).toBe("kimi");
  });

  it("round-trips written defaults", () => {
    const storage = fakeStorage();
    writeSessionDefaults(storage, {
      agentKind: "claude",
      modelId: "claude-opus-4-5",
      autoRun: true,
    });
    expect(readSessionDefaults(storage)).toEqual({
      agentKind: "claude",
      modelId: "claude-opus-4-5",
      autoRun: true,
    });
  });

  it("drops unknown kinds and malformed payloads back to the fallback", () => {
    expect(
      readSessionDefaults(
        fakeStorage({ "webmux:session-defaults": '{"agentKind":"nope"}' }),
      ).agentKind,
    ).toBe("kimi");
    expect(
      readSessionDefaults(
        fakeStorage({ "webmux:session-defaults": "not json" }),
      ),
    ).toEqual(FALLBACK_SESSION_DEFAULTS);
  });

  it("remembers the last cwd per machine", () => {
    const storage = fakeStorage();
    expect(readLastCwd(storage, "m1")).toBeNull();
    writeLastCwd(storage, "m1", "/work/repo");
    writeLastCwd(storage, "m2", "/other");
    expect(readLastCwd(storage, "m1")).toBe("/work/repo");
    expect(readLastCwd(storage, "m2")).toBe("/other");
  });
});

describe("model cache", () => {
  const models = [
    { model_id: "grok-4.6", name: "Grok 4.6" },
    { model_id: "grok-4.5", name: "Grok 4.5" },
  ];

  it("caches advertised models per agent kind", () => {
    const storage = fakeStorage();
    recordSessionModels(storage, "grok", models);
    expect(readModelCache(storage).grok).toEqual(models);
    expect(readModelCache(storage).claude).toBeUndefined();
  });

  it("never overwrites a known list with an empty one", () => {
    const storage = fakeStorage();
    recordSessionModels(storage, "grok", models);
    recordSessionModels(storage, "grok", []);
    expect(readModelCache(storage).grok).toEqual(models);
  });

  it("drops malformed cache entries", () => {
    const storage = fakeStorage({
      "webmux:agent-models": JSON.stringify({ grok: [{ nope: 1 }], kimi: models }),
    });
    expect(readModelCache(storage).grok).toBeUndefined();
    expect(readModelCache(storage).kimi).toEqual(models);
  });

  it("prefers live sessions over the cache in modelsForAgentKind", () => {
    const storage = fakeStorage();
    recordSessionModels(storage, "grok", models);
    const live = [{ model_id: "live-1", name: "Live" }];
    expect(
      modelsForAgentKind(storage, "grok", [
        { agent_kind: "kimi", available_models: [] },
        { agent_kind: "grok", available_models: live },
      ]),
    ).toEqual(live);
    expect(modelsForAgentKind(storage, "grok", [])).toEqual(models);
    expect(modelsForAgentKind(storage, "claude", [])).toEqual([]);
  });
});
