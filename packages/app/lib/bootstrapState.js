export const EMPTY_BROWSER_SESSION_STATE = {
    lastSeq: 0,
    machines: [],
    terminals: [],
    machineStats: {},
    controlLeases: {},
};
export function applyBootstrapSnapshot(snapshot) {
    return {
        lastSeq: snapshot.snapshot_seq,
        machines: snapshot.machines,
        terminals: snapshot.terminals,
        machineStats: Object.fromEntries(snapshot.machine_stats.map(({ machine_id, stats }) => [machine_id, stats])),
        controlLeases: Object.fromEntries(snapshot.control_leases.flatMap(({ machine_id, controller_device_id }) => controller_device_id ? [[machine_id, controller_device_id]] : [])),
    };
}
export function applyBrowserEventEnvelope(state, envelope) {
    if (shouldResyncForEnvelope(state, envelope)) {
        return state;
    }
    if (envelope.seq <= state.lastSeq) {
        return state;
    }
    return {
        ...applyBrowserEvent(state, envelope.event),
        lastSeq: envelope.seq,
    };
}
export function shouldResyncForEnvelope(state, envelope) {
    return state.lastSeq > 0 && envelope.seq > state.lastSeq + 1;
}
function applyBrowserEvent(state, event) {
    switch (event.type) {
        case "machine_online":
            return {
                ...state,
                machines: upsertMachine(state.machines, event.machine),
            };
        case "machine_offline": {
            const nextStats = omitKey(state.machineStats, event.machine_id);
            const nextLeases = omitKey(state.controlLeases, event.machine_id);
            return {
                ...state,
                // Keep machines list unchanged — machine info needed for unreachable terminals
                machineStats: nextStats,
                controlLeases: nextLeases,
            };
        }
        case "terminal_created":
        case "terminal_resized":
            return {
                ...state,
                terminals: upsertTerminal(state.terminals, event.terminal),
            };
        case "terminal_destroyed":
            return {
                ...state,
                terminals: state.terminals.filter((terminal) => terminal.id !== event.terminal_id),
            };
        case "terminal_reachable_changed":
            return {
                ...state,
                terminals: state.terminals.map((terminal) => terminal.id === event.terminal_id && terminal.machine_id === event.machine_id
                    ? { ...terminal, reachable: event.reachable }
                    : terminal),
            };
        case "machine_stats":
            return {
                ...state,
                machineStats: {
                    ...state.machineStats,
                    [event.machine_id]: event.stats,
                },
            };
        case "mode_changed":
            if (!event.controller_device_id) {
                return {
                    ...state,
                    controlLeases: omitKey(state.controlLeases, event.machine_id),
                };
            }
            return {
                ...state,
                controlLeases: {
                    ...state.controlLeases,
                    [event.machine_id]: event.controller_device_id,
                },
            };
    }
}
// Return a copy of `record` with `key` removed. Replaces the
// `const { [key]: _, ...rest } = record` pattern, which the current Metro /
// Babel toolchain mistranspiles for computed-key rest-spread in release
// bundles (the key was retained in `rest`, leaving stale control leases
// after a release). See design-refresh PR #141.
function omitKey(record, key) {
    if (!(key in record))
        return record;
    const next = {};
    for (const k of Object.keys(record)) {
        if (k !== key)
            next[k] = record[k];
    }
    return next;
}
function upsertMachine(machines, machine) {
    const existingIndex = machines.findIndex((item) => item.id === machine.id);
    if (existingIndex === -1) {
        return [...machines, machine];
    }
    const next = machines.slice();
    next[existingIndex] = machine;
    return next;
}
function upsertTerminal(terminals, terminal) {
    const existingIndex = terminals.findIndex((item) => item.id === terminal.id);
    if (existingIndex === -1) {
        return [...terminals, terminal];
    }
    const next = terminals.slice();
    next[existingIndex] = terminal;
    return next;
}
