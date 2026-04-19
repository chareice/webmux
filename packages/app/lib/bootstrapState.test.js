import { describe, expect, it } from "vitest";
import { applyBootstrapSnapshot, applyBrowserEventEnvelope, EMPTY_BROWSER_SESSION_STATE, shouldResyncForEnvelope, } from "./bootstrapState";
function stateWithControl(machineId, deviceId, seq = 10) {
    return {
        ...EMPTY_BROWSER_SESSION_STATE,
        lastSeq: seq,
        controlLeases: { [machineId]: deviceId },
    };
}
function envelope(seq, event) {
    return { seq, event };
}
describe("applyBootstrapSnapshot", () => {
    it("maps control_leases from snapshot", () => {
        const state = applyBootstrapSnapshot({
            snapshot_seq: 5,
            machines: [],
            terminals: [],
            machine_stats: [],
            control_leases: [
                { machine_id: "m1", controller_device_id: "d1" },
                { machine_id: "m2", controller_device_id: null },
            ],
        });
        expect(state.controlLeases).toEqual({ m1: "d1" });
        expect(state.lastSeq).toBe(5);
    });
});
describe("mode_changed event", () => {
    it("sets control lease when controller_device_id is present", () => {
        const state = applyBrowserEventEnvelope({ ...EMPTY_BROWSER_SESSION_STATE, lastSeq: 1 }, envelope(2, {
            type: "mode_changed",
            machine_id: "m1",
            controller_device_id: "d1",
        }));
        expect(state.controlLeases).toEqual({ m1: "d1" });
    });
    it("removes control lease when controller_device_id is null", () => {
        const state = applyBrowserEventEnvelope(stateWithControl("m1", "d1", 1), envelope(2, {
            type: "mode_changed",
            machine_id: "m1",
            controller_device_id: null,
        }));
        expect(state.controlLeases).toEqual({});
    });
    it("replaces existing controller with new device", () => {
        const state = applyBrowserEventEnvelope(stateWithControl("m1", "d1", 1), envelope(2, {
            type: "mode_changed",
            machine_id: "m1",
            controller_device_id: "d2",
        }));
        expect(state.controlLeases).toEqual({ m1: "d2" });
    });
    it("does not affect other machines' leases", () => {
        const initial = {
            ...EMPTY_BROWSER_SESSION_STATE,
            lastSeq: 1,
            controlLeases: { m1: "d1", m2: "d2" },
        };
        const state = applyBrowserEventEnvelope(initial, envelope(2, {
            type: "mode_changed",
            machine_id: "m1",
            controller_device_id: null,
        }));
        expect(state.controlLeases).toEqual({ m2: "d2" });
    });
});
describe("machine_offline event", () => {
    it("removes control lease for the offline machine", () => {
        const state = applyBrowserEventEnvelope(stateWithControl("m1", "d1", 1), envelope(2, { type: "machine_offline", machine_id: "m1" }));
        expect(state.controlLeases).toEqual({});
    });
});
describe("shouldResyncForEnvelope", () => {
    it("returns false for first event after bootstrap", () => {
        const state = { ...EMPTY_BROWSER_SESSION_STATE, lastSeq: 5 };
        expect(shouldResyncForEnvelope(state, { seq: 6, event: {} })).toBe(false);
    });
    it("returns true when sequence gap detected", () => {
        const state = { ...EMPTY_BROWSER_SESSION_STATE, lastSeq: 5 };
        expect(shouldResyncForEnvelope(state, { seq: 8, event: {} })).toBe(true);
    });
    it("returns false when lastSeq is 0 (initial state)", () => {
        expect(shouldResyncForEnvelope(EMPTY_BROWSER_SESSION_STATE, {
            seq: 100,
            event: {},
        })).toBe(false);
    });
});
describe("applyBrowserEventEnvelope", () => {
    it("ignores events with seq <= lastSeq", () => {
        const initial = stateWithControl("m1", "d1", 5);
        const result = applyBrowserEventEnvelope(initial, envelope(5, {
            type: "mode_changed",
            machine_id: "m1",
            controller_device_id: null,
        }));
        expect(result).toBe(initial);
    });
    it("returns original state when resync needed", () => {
        const initial = stateWithControl("m1", "d1", 5);
        const result = applyBrowserEventEnvelope(initial, envelope(10, {
            type: "mode_changed",
            machine_id: "m1",
            controller_device_id: null,
        }));
        expect(result).toBe(initial);
    });
});
