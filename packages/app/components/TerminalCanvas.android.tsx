import { useState, useCallback, useEffect, useRef } from "react";
import * as Application from "expo-application";
import {
  View,
  Pressable,
  Text,
  StyleSheet,
  BackHandler,
  StatusBar,
  Dimensions,
  ScrollView,
  Modal,
  TextInput,
} from "react-native";
import type { Bookmark, MachineInfo, TerminalInfo } from "@webmux/shared";
import {
  checkForegroundProcess,
  createBookmark,
  createRegistrationToken,
  createTerminal,
  destroyTerminal,
  eventsWsUrl,
  getBootstrap,
  listBookmarks,
  releaseControl,
  requestControl,
} from "@/lib/api";
import { estimateMobileInitialTerminalDimensions } from "@/lib/terminalViewModel";
import {
  applyBootstrapSnapshot,
  applyBrowserEventEnvelope,
  EMPTY_BROWSER_SESSION_STATE,
  shouldResyncForEnvelope,
} from "@/lib/bootstrapState";
import { colors, colorAlpha } from "@/lib/colors";
import { getPersistentDeviceId } from "@/lib/deviceId";
import {
  getActiveMachine,
  getMachineTerminals,
  isMachineController as ownsMachineControl,
  summarizeResourceStats,
} from "@/lib/mobileShellModel";
import { getServerUrl } from "@/lib/serverUrl";
import { buildOnboardingScript } from "@/lib/nodeInstaller";
import type { AndroidUpdate } from "@/lib/nativeUpdate";
import { fetchLatestAndroidUpdate } from "@/lib/nativeUpdate";
import { downloadAndOpenAndroidApk } from "@/lib/nativeUpdateInstall";
import { TerminalCard } from "./TerminalCard.android";

type MobileTab = "hosts" | "terminals" | "stats";
type UpdateState =
  | { status: "idle"; message: string }
  | { status: "checking"; message: string }
  | { status: "downloading"; message: string; update: AndroidUpdate }
  | { status: "none"; message: string }
  | { status: "error"; message: string };

export function TerminalCanvas() {
  const [browserState, setBrowserState] = useState(EMPTY_BROWSER_SESSION_STATE);
  const [activeMachineId, setActiveMachineId] = useState<string | null>(null);
  const [selectedWorkpathId, setSelectedWorkpathId] = useState<string | "all">(
    "all",
  );
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  const [tab, setTab] = useState<MobileTab>("terminals");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [reconnectGeneration, setReconnectGeneration] = useState(0);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [addHostOpen, setAddHostOpen] = useState(false);
  const [addWorkpathOpen, setAddWorkpathOpen] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState>({
    status: "idle",
    message: "Check for a new APK release",
  });
  const [closeConfirmation, setCloseConfirmation] = useState<{
    terminal: TerminalInfo;
    processName: string;
  } | null>(null);
  const maximizedRef = useRef<string | null>(null);
  const lastSeqRef = useRef(0);

  const machines = browserState.machines;
  const terminals = browserState.terminals;
  const machineStats = browserState.machineStats;
  const controlLeases = browserState.controlLeases;
  const activeMachine = getActiveMachine(machines, activeMachineId);
  const activeMachineTerminals = getMachineTerminals(
    terminals,
    activeMachine?.id ?? null,
  );
  const machineBookmarks = activeMachine
    ? bookmarks.filter((bookmark) => bookmark.machine_id === activeMachine.id)
    : [];
  const selectedBookmark =
    selectedWorkpathId === "all" || !activeMachine
      ? null
      : bookmarks.find(
          (bookmark) =>
            bookmark.id === selectedWorkpathId &&
            bookmark.machine_id === activeMachine.id,
        ) ?? null;
  const scopedTerminals = activeMachineTerminals;
  const isActiveController = ownsMachineControl(
    controlLeases,
    activeMachine?.id ?? null,
    deviceId,
  );
  const maximizedTerminal = maximizedId
    ? terminals.find((terminal) => terminal.id === maximizedId) ?? null
    : null;

  const isMachineController = useCallback(
    (machineId: string) => ownsMachineControl(controlLeases, machineId, deviceId),
    [controlLeases, deviceId],
  );

  useEffect(() => {
    maximizedRef.current = maximizedId;
  }, [maximizedId]);

  useEffect(() => {
    let cancelled = false;

    void getPersistentDeviceId().then((id) => {
      if (!cancelled) {
        setDeviceId(id);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    lastSeqRef.current = browserState.lastSeq;
  }, [browserState.lastSeq]);

  useEffect(() => {
    if (machines.length === 0) {
      if (activeMachineId !== null) setActiveMachineId(null);
      return;
    }
    if (!machines.some((machine) => machine.id === activeMachineId)) {
      setActiveMachineId(machines[0].id);
      setSelectedWorkpathId("all");
    }
  }, [activeMachineId, machines]);

  useEffect(() => {
    if (selectedWorkpathId === "all") return;
    if (!bookmarks.some((bookmark) => bookmark.id === selectedWorkpathId)) {
      setSelectedWorkpathId("all");
    }
  }, [bookmarks, selectedWorkpathId]);

  useEffect(() => {
    if (machines.length === 0) {
      setBookmarks([]);
      return;
    }
    let cancelled = false;
    void Promise.all(
      machines.map((machine) => {
        const fallback: Bookmark[] = [
          {
            id: `local-home-${machine.id}`,
            machine_id: machine.id,
            path: machine.home_dir || "/",
            label: "~",
            sort_order: 0,
          },
        ];
        return listBookmarks(machine.id)
          .then((items) => (items.length > 0 ? items : fallback))
          .catch(() => fallback);
      }),
    ).then((all) => {
      if (!cancelled) setBookmarks(all.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [machines]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (closeConfirmation) {
        setCloseConfirmation(null);
        return true;
      }
      if (addHostOpen) {
        setAddHostOpen(false);
        return true;
      }
      if (addWorkpathOpen) {
        setAddWorkpathOpen(false);
        return true;
      }
      if (maximizedId) {
        setMaximizedId(null);
        return true;
      }
      if (tab !== "terminals") {
        setTab("terminals");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [addHostOpen, addWorkpathOpen, closeConfirmation, maximizedId, tab]);

  useEffect(() => {
    if (!deviceId) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setBootstrapReady(false);

    getBootstrap()
      .then((snapshot) => {
        if (cancelled) return;
        lastSeqRef.current = snapshot.snapshot_seq;
        setBrowserState(applyBootstrapSnapshot(snapshot));
        setBootstrapReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        retryTimer = setTimeout(() => {
          setReconnectGeneration((value) => value + 1);
        }, 1000);
      });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [deviceId, reconnectGeneration]);

  useEffect(() => {
    if (!bootstrapReady || !deviceId) return;

    const ws = new WebSocket(eventsWsUrl(deviceId, lastSeqRef.current));
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    ws.onmessage = (event: any) => {
      try {
        const envelope = JSON.parse(event.data);
        let needsResync = false;
        setBrowserState((prev) => {
          if (shouldResyncForEnvelope(prev, envelope)) {
            needsResync = true;
            return prev;
          }
          const next = applyBrowserEventEnvelope(prev, envelope);
          if (
            next !== prev &&
            envelope.event?.type === "terminal_destroyed" &&
            maximizedRef.current === envelope.event.terminal_id
          ) {
            setMaximizedId(null);
          }
          return next;
        });
        if (needsResync) {
          ws.close();
        }
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      reconnectTimer = setTimeout(() => {
        setBootstrapReady(false);
        setReconnectGeneration((value) => value + 1);
      }, 1000);
    };

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws.close();
    };
  }, [bootstrapReady, deviceId]);

  const handleRequestControl = useCallback(
    async (machineId: string) => {
      if (!deviceId) return;
      const next = await requestControl(machineId, deviceId);
      setBrowserState((prev) => ({
        ...prev,
        controlLeases: next.controller_device_id
          ? {
              ...prev.controlLeases,
              [machineId]: next.controller_device_id,
            }
          : prev.controlLeases,
      }));
    },
    [deviceId],
  );

  const handleReleaseControl = useCallback(
    async (machineId: string) => {
      if (!deviceId) return;
      const next = await releaseControl(machineId, deviceId);
      setBrowserState((prev) => ({
        ...prev,
        controlLeases: next.controller_device_id
          ? {
              ...prev.controlLeases,
              [machineId]: next.controller_device_id,
            }
          : Object.fromEntries(
              Object.entries(prev.controlLeases).filter(
                ([key]) => key !== machineId,
              ),
            ),
      }));
    },
    [deviceId],
  );

  const handleCreateTerminal = useCallback(
    async (machineId: string, cwd: string) => {
      if (!deviceId || !isMachineController(machineId)) return;
      const { width, height } = Dimensions.get("window");
      const { cols, rows } = estimateMobileInitialTerminalDimensions(width, height);
      const terminal = await createTerminal(
        machineId,
        cwd,
        deviceId,
        undefined,
        cols,
        rows,
      );
      setMaximizedId(terminal.id);
      setTab("terminals");
    },
    [deviceId, isMachineController],
  );

  const handleNewTerminal = useCallback(async () => {
    if (!activeMachine || !deviceId || !isActiveController) return;
    await handleCreateTerminal(
      activeMachine.id,
      selectedBookmark?.path ?? activeMachine.home_dir ?? "~",
    );
  }, [
    activeMachine,
    deviceId,
    handleCreateTerminal,
    isActiveController,
    selectedBookmark,
  ]);

  const handleDestroyTerminal = useCallback(
    async (terminal: TerminalInfo) => {
      if (!deviceId || !isMachineController(terminal.machine_id)) return;
      try {
        const result = await checkForegroundProcess(
          terminal.machine_id,
          terminal.id,
        );
        if (result.has_foreground_process) {
          setCloseConfirmation({
            terminal,
            processName: result.process_name ?? "unknown",
          });
          return;
        }
      } catch {
        /* fall through */
      }
      await destroyTerminal(terminal.machine_id, terminal.id, deviceId);
    },
    [deviceId, isMachineController],
  );

  const confirmCloseTerminal = useCallback(async () => {
    if (!closeConfirmation || !deviceId) return;
    const terminal = closeConfirmation.terminal;
    setCloseConfirmation(null);
    await destroyTerminal(terminal.machine_id, terminal.id, deviceId);
  }, [closeConfirmation, deviceId]);

  const handleAddWorkpath = useCallback(
    async (path: string) => {
      if (!activeMachine || !path.trim()) {
        setAddWorkpathOpen(false);
        return;
      }
      const normalized = path.trim();
      const parts = normalized.replace(/\/+$/, "").split("/");
      const label = parts[parts.length - 1] || normalized;
      try {
        const bookmark = await createBookmark(activeMachine.id, normalized, label);
        setBookmarks((prev) => [...prev, bookmark]);
        setSelectedWorkpathId(bookmark.id);
      } catch {
        const bookmark: Bookmark = {
          id: `local-${Date.now()}`,
          machine_id: activeMachine.id,
          path: normalized,
          label,
          sort_order: bookmarks.length,
        };
        setBookmarks((prev) => [...prev, bookmark]);
        setSelectedWorkpathId(bookmark.id);
      } finally {
        setAddWorkpathOpen(false);
        setTab("terminals");
      }
    },
    [activeMachine, bookmarks.length],
  );

  const reconnect = useCallback(() => {
    setBootstrapReady(false);
    setReconnectGeneration((value) => value + 1);
  }, []);

  const handleCheckUpdates = useCallback(async () => {
    setUpdateState({ status: "checking", message: "Checking GitHub Releases…" });
    try {
      const currentVersion = Application.nativeApplicationVersion ?? "0.1.0";
      const update = await fetchLatestAndroidUpdate(currentVersion);
      if (!update) {
        setUpdateState({
          status: "none",
          message: `Already up to date (${currentVersion})`,
        });
        return;
      }

      setUpdateState({
        status: "downloading",
        message: `Downloading ${update.apkName}…`,
        update,
      });
      await downloadAndOpenAndroidApk(update);
      setUpdateState({
        status: "idle",
        message: `Installer opened for ${update.version}`,
      });
    } catch (err) {
      setUpdateState({
        status: "error",
        message: (err as Error).message,
      });
    }
  }, []);

  const currentScopeLabel = selectedBookmark?.label ?? "All";
  const currentScopePath = selectedBookmark?.path ?? null;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <View style={styles.header}>
        <View style={styles.machinePill}>
          <HostDot active={isActiveController} />
          <View style={styles.headerTextBlock}>
            <Text numberOfLines={1} style={styles.headerTitle}>
              {activeMachine?.name ?? "No host"}
            </Text>
            <Text numberOfLines={1} style={styles.headerMeta}>
              {currentScopePath ?? currentScopeLabel}
            </Text>
          </View>
        </View>
        {isActiveController ? (
          <Pressable
            style={styles.headerControlButton}
            onPress={() => activeMachine && handleReleaseControl(activeMachine.id)}
          >
            <Text style={styles.headerControlText}>CTRL</Text>
          </Pressable>
        ) : (
          <Pressable
            disabled={!activeMachine}
            style={[styles.headerControlButton, styles.headerControlTake]}
            onPress={() => activeMachine && handleRequestControl(activeMachine.id)}
          >
            <Text style={styles.headerControlTakeText}>CONTROL</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.content}>
        {tab === "hosts" && (
          <HostsTab
            machines={machines}
            activeMachineId={activeMachine?.id ?? null}
            controlLeases={controlLeases}
            deviceId={deviceId}
            bookmarks={machineBookmarks}
            selectedWorkpathId={selectedWorkpathId}
            terminals={terminals}
            canCreateTerminal={isActiveController}
            onAddHost={() => setAddHostOpen(true)}
            onSelectMachine={(machineId) => {
              setActiveMachineId(machineId);
              setSelectedWorkpathId("all");
            }}
            onSelectWorkpath={(workpathId) => {
              setSelectedWorkpathId(workpathId);
              setTab("terminals");
            }}
            onAddWorkpath={() => setAddWorkpathOpen(true)}
          />
        )}
        {tab === "terminals" && (
          <TerminalsTab
            machine={activeMachine}
            terminals={scopedTerminals}
            scopeLabel={currentScopeLabel}
            scopePath={currentScopePath}
            isController={isActiveController}
            onChangeScope={() => setTab("hosts")}
            onNewTerminal={handleNewTerminal}
            onOpenTerminal={setMaximizedId}
            onRequestControl={
              activeMachine ? () => handleRequestControl(activeMachine.id) : undefined
            }
            onReleaseControl={
              activeMachine ? () => handleReleaseControl(activeMachine.id) : undefined
            }
          />
        )}
        {tab === "stats" && (
          <StatsTab
            machine={activeMachine}
            stats={activeMachine ? machineStats[activeMachine.id] : undefined}
            terminalCount={activeMachineTerminals.length}
            isController={isActiveController}
            onReconnect={reconnect}
            onAddHost={() => setAddHostOpen(true)}
            updateState={updateState}
            onCheckUpdates={handleCheckUpdates}
            onRequestControl={
              activeMachine ? () => handleRequestControl(activeMachine.id) : undefined
            }
            onReleaseControl={
              activeMachine ? () => handleReleaseControl(activeMachine.id) : undefined
            }
          />
        )}
      </View>

      {tab === "terminals" && isActiveController && (
        <Pressable
          testID="android-fab-new-terminal"
          onPress={handleNewTerminal}
          style={styles.fab}
        >
          <Text style={styles.fabText}>+</Text>
        </Pressable>
      )}

      <View style={styles.bottomNav}>
        <NavButton
          label="Hosts"
          active={tab === "hosts"}
          badge={machines.length}
          onPress={() => setTab("hosts")}
        />
        <NavButton
          label="Terminals"
          active={tab === "terminals"}
          badge={scopedTerminals.length}
          onPress={() => setTab("terminals")}
        />
        <NavButton label="Stats" active={tab === "stats"} onPress={() => setTab("stats")} />
      </View>

      {maximizedTerminal && (
        <TerminalCard
          terminal={maximizedTerminal}
          siblings={activeMachineTerminals}
          maximized
          isMobile
          isController={isMachineController(maximizedTerminal.machine_id)}
          deviceId={deviceId}
          onMaximize={() => {}}
          onMinimize={() => setMaximizedId(null)}
          onDestroy={() => handleDestroyTerminal(maximizedTerminal)}
          onPickTerminal={setMaximizedId}
          onRequestControl={handleRequestControl}
          onReleaseControl={handleReleaseControl}
        />
      )}

      <AddHostModal visible={addHostOpen} onClose={() => setAddHostOpen(false)} />
      <AddWorkpathModal
        visible={addWorkpathOpen}
        machine={activeMachine}
        onClose={() => setAddWorkpathOpen(false)}
        onSubmit={handleAddWorkpath}
      />
      <ConfirmCloseModal
        pending={closeConfirmation}
        onCancel={() => setCloseConfirmation(null)}
        onConfirm={confirmCloseTerminal}
      />
    </View>
  );
}

function HostsTab({
  machines,
  activeMachineId,
  controlLeases,
  deviceId,
  bookmarks,
  selectedWorkpathId,
  terminals,
  canCreateTerminal,
  onAddHost,
  onSelectMachine,
  onSelectWorkpath,
  onAddWorkpath,
}: {
  machines: MachineInfo[];
  activeMachineId: string | null;
  controlLeases: Record<string, string>;
  deviceId: string | null;
  bookmarks: Bookmark[];
  selectedWorkpathId: string | "all";
  terminals: TerminalInfo[];
  canCreateTerminal: boolean;
  onAddHost: () => void;
  onSelectMachine: (machineId: string) => void;
  onSelectWorkpath: (workpathId: string | "all") => void;
  onAddWorkpath: () => void;
}) {
  const activeTerminals = activeMachineId
    ? terminals.filter((terminal) => terminal.machine_id === activeMachineId)
    : [];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
      <SectionTitle title="Hosts" />
      <Pressable style={styles.primaryWideButton} onPress={onAddHost}>
        <Text style={styles.primaryWideText}>Add host</Text>
      </Pressable>
      {machines.map((machine) => {
        const active = machine.id === activeMachineId;
        const controlling = ownsMachineControl(controlLeases, machine.id, deviceId);
        return (
          <Pressable
            key={machine.id}
            style={[styles.hostRow, active && styles.selectedRow]}
            onPress={() => onSelectMachine(machine.id)}
          >
            <HostDot active={controlling} />
            <View style={styles.rowTextBlock}>
              <Text numberOfLines={1} style={styles.rowTitle}>
                {machine.name}
              </Text>
              <Text numberOfLines={1} style={styles.rowMeta}>
                {machine.os} · {machine.home_dir}
              </Text>
            </View>
            <Text style={styles.rowCount}>
              {terminals.filter((terminal) => terminal.machine_id === machine.id).length}
            </Text>
          </Pressable>
        );
      })}

      <SectionTitle title="Workpaths" />
      <Pressable
        disabled={!canCreateTerminal}
        style={[
          styles.secondaryWideButton,
          !canCreateTerminal && styles.disabledButton,
        ]}
        onPress={onAddWorkpath}
      >
        <Text
          style={[
            styles.secondaryWideText,
            !canCreateTerminal && styles.disabledText,
          ]}
        >
          Add workpath
        </Text>
      </Pressable>
      <WorkpathRow
        label="All workpaths"
        path={null}
        selected={selectedWorkpathId === "all"}
        count={activeTerminals.length}
        onPress={() => onSelectWorkpath("all")}
      />
      {bookmarks.map((bookmark) => (
        <WorkpathRow
          key={bookmark.id}
          label={bookmark.label}
          path={bookmark.path}
          selected={selectedWorkpathId === bookmark.id}
          count={
            activeTerminals.filter((terminal) => terminal.cwd === bookmark.path)
              .length
          }
          onPress={() => onSelectWorkpath(bookmark.id)}
        />
      ))}
    </ScrollView>
  );
}

function TerminalsTab({
  machine,
  terminals,
  scopeLabel,
  scopePath,
  isController,
  onChangeScope,
  onNewTerminal,
  onOpenTerminal,
  onRequestControl,
  onReleaseControl,
}: {
  machine: MachineInfo | null;
  terminals: TerminalInfo[];
  scopeLabel: string;
  scopePath: string | null;
  isController: boolean;
  onChangeScope: () => void;
  onNewTerminal: () => void;
  onOpenTerminal: (terminalId: string) => void;
  onRequestControl?: () => void;
  onReleaseControl?: () => void;
}) {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.terminalBody}>
      <View style={styles.controlPanel}>
        <View style={styles.rowTextBlock}>
          <Text numberOfLines={1} style={styles.panelTitle}>
            {machine?.name ?? "No host"}
          </Text>
          <Text style={[styles.panelMeta, isController && styles.accentText]}>
            {isController ? "Ready to type and create terminals" : "Viewing only"}
          </Text>
        </View>
        <Pressable
          disabled={!machine}
          style={[
            styles.inlineControlButton,
            !isController && styles.inlineControlTake,
          ]}
          onPress={() => {
            if (isController) onReleaseControl?.();
            else onRequestControl?.();
          }}
        >
          <Text
            style={[
              styles.inlineControlText,
              !isController && styles.inlineControlTakeText,
            ]}
          >
            {isController ? "Stop" : "Control"}
          </Text>
        </Pressable>
        {isController && (
          <Pressable style={styles.inlineNewButton} onPress={onNewTerminal}>
            <Text style={styles.inlineNewText}>New</Text>
          </Pressable>
        )}
      </View>

      <Pressable style={styles.scopeButton} onPress={onChangeScope}>
        <View style={styles.rowTextBlock}>
          <Text style={styles.scopeEyebrow}>Workpath</Text>
          <Text numberOfLines={1} style={styles.scopeTitle}>
            {scopeLabel}
            {scopePath ? ` · ${shortenPath(scopePath)}` : ""}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      {terminals.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>⌘</Text>
          <Text style={styles.emptyTitle}>No terminals here yet</Text>
          <Text style={styles.emptyText}>
            {isController ? "Tap + to start one" : "Take control to create one"}
          </Text>
        </View>
      ) : (
        terminals.map((terminal) => (
          <TerminalListRow
            key={terminal.id}
            terminal={terminal}
            onPress={() => onOpenTerminal(terminal.id)}
          />
        ))
      )}
    </ScrollView>
  );
}

function StatsTab({
  machine,
  stats,
  terminalCount,
  isController,
  onReconnect,
  onAddHost,
  updateState,
  onCheckUpdates,
  onRequestControl,
  onReleaseControl,
}: {
  machine: MachineInfo | null;
  stats: Parameters<typeof summarizeResourceStats>[0];
  terminalCount: number;
  isController: boolean;
  onReconnect: () => void;
  onAddHost: () => void;
  updateState: UpdateState;
  onCheckUpdates: () => void;
  onRequestControl?: () => void;
  onReleaseControl?: () => void;
}) {
  const summary = summarizeResourceStats(stats);
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
      <View style={styles.statsGrid}>
        <StatCard label="CPU" value={formatPercent(summary.cpuPercent)} />
        <StatCard label="MEM" value={formatPercent(summary.memoryPercent)} />
        <StatCard label="DISK" value={formatPercent(summary.diskPercent)} />
        <StatCard label="TERM" value={String(terminalCount)} />
      </View>

      <SectionTitle title={machine ? `${machine.name} · ${machine.os}` : "Host"} />
      <InfoPanel>
        <InfoRow label="Home" value={machine?.home_dir ?? "—"} />
        <InfoRow label="Memory" value={summary.memoryLabel} />
        <InfoRow label="Controlling" value={isController ? "yes" : "no"} />
      </InfoPanel>

      <SectionTitle title="Actions" />
      <ActionRow
        label={isController ? "Release control" : "Request control"}
        danger={isController}
        onPress={() => {
          if (isController) onReleaseControl?.();
          else onRequestControl?.();
        }}
      />
      <ActionRow label="Reconnect session" onPress={onReconnect} />
      <ActionRow label="Add host" onPress={onAddHost} />
      <ActionRow
        label={
          updateState.status === "checking"
            ? "Checking updates"
            : updateState.status === "downloading"
              ? "Downloading update"
              : "Check updates"
        }
        disabled={
          updateState.status === "checking" ||
          updateState.status === "downloading"
        }
        onPress={onCheckUpdates}
      />
      <Text
        style={[
          styles.updateMessage,
          updateState.status === "error" && styles.dangerText,
        ]}
      >
        {updateState.message}
      </Text>
    </ScrollView>
  );
}

function AddHostModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [script, setScript] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { token } = await createRegistrationToken("node");
      setScript(buildOnboardingScript(getMachineWsUrl(), token));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible && !script && !loading && !error) {
      void generate();
    }
  }, [error, generate, loading, script, visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalSheet}>
        <Text style={styles.modalTitle}>Add host</Text>
        <Text style={styles.modalDescription}>
          Run this script on the machine you want to control.
        </Text>
        <View style={styles.codeBox}>
          <Text selectable style={styles.codeText}>
            {loading ? "Generating token…" : error ?? script ?? ""}
          </Text>
        </View>
        <Pressable style={styles.secondaryWideButton} onPress={generate}>
          <Text style={styles.secondaryWideText}>Regenerate token</Text>
        </Pressable>
        <Pressable style={styles.primaryWideButton} onPress={onClose}>
          <Text style={styles.primaryWideText}>Done</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function AddWorkpathModal({
  visible,
  machine,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  machine: MachineInfo | null;
  onClose: () => void;
  onSubmit: (path: string) => void;
}) {
  const [path, setPath] = useState("");

  useEffect(() => {
    if (visible) setPath(machine?.home_dir ?? "");
  }, [machine?.home_dir, visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.dialogBackdrop}>
        <View style={styles.dialog}>
          <Text style={styles.dialogTitle}>Add workpath</Text>
          <TextInput
            value={path}
            onChangeText={setPath}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="/path/to/project"
            placeholderTextColor={colors.foregroundMuted}
            style={styles.input}
          />
          <View style={styles.dialogActions}>
            <Pressable style={styles.dialogButton} onPress={onClose}>
              <Text style={styles.dialogButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.dialogButton, styles.dialogPrimaryButton]}
              onPress={() => onSubmit(path)}
            >
              <Text style={styles.dialogPrimaryText}>Add</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ConfirmCloseModal({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: { terminal: TerminalInfo; processName: string } | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal visible={Boolean(pending)} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.dialogBackdrop}>
        <View style={styles.dialog}>
          <Text style={styles.dialogTitle}>Close terminal?</Text>
          <Text style={styles.dialogText}>
            {pending?.processName ?? "A foreground process"} is still running.
          </Text>
          <View style={styles.dialogActions}>
            <Pressable style={styles.dialogButton} onPress={onCancel}>
              <Text style={styles.dialogButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.dialogButton, styles.dialogDangerButton]}
              onPress={onConfirm}
            >
              <Text style={styles.dialogDangerText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function TerminalListRow({
  terminal,
  onPress,
}: {
  terminal: TerminalInfo;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.terminalRow} onPress={onPress}>
      <View
        style={[
          styles.terminalDot,
          !terminal.reachable && styles.terminalDotOffline,
        ]}
      />
      <View style={styles.rowTextBlock}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {terminal.title || terminal.id.slice(0, 8)}
        </Text>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {shortenPath(terminal.cwd)}
        </Text>
      </View>
      <Text style={styles.rowCount}>
        {terminal.cols}×{terminal.rows}
      </Text>
    </Pressable>
  );
}

function WorkpathRow({
  label,
  path,
  selected,
  count,
  onPress,
}: {
  label: string;
  path: string | null;
  selected: boolean;
  count: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.workpathRow, selected && styles.selectedRow]}
      onPress={onPress}
    >
      <Text style={styles.folderIcon}>▣</Text>
      <View style={styles.rowTextBlock}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {label}
        </Text>
        {path && (
          <Text numberOfLines={1} style={styles.rowMeta}>
            {shortenPath(path)}
          </Text>
        )}
      </View>
      <Text style={styles.rowCount}>{count || "—"}</Text>
    </Pressable>
  );
}

function NavButton({
  label,
  active,
  badge,
  onPress,
}: {
  label: string;
  active: boolean;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.navButton} onPress={onPress}>
      <Text style={[styles.navIcon, active && styles.navActiveText]}>
        {label === "Hosts" ? "▦" : label === "Terminals" ? "⌁" : "◌"}
      </Text>
      <Text style={[styles.navLabel, active && styles.navActiveText]}>
        {label}
      </Text>
      {badge !== undefined && badge > 0 && (
        <View style={[styles.badge, active && styles.badgeActive]}>
          <Text style={[styles.badgeText, active && styles.badgeTextActive]}>
            {badge}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function HostDot({ active }: { active: boolean }) {
  return (
    <View style={[styles.hostDot, active && styles.hostDotActive]}>
      {active && <View style={styles.hostDotInner} />}
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function InfoPanel({ children }: { children: React.ReactNode }) {
  return <View style={styles.infoPanel}>{children}</View>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.infoValue}>
        {value}
      </Text>
    </View>
  );
}

function ActionRow({
  label,
  danger,
  disabled,
  onPress,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      style={[styles.actionRow, disabled && styles.disabledButton]}
      onPress={onPress}
    >
      <Text
        style={[
          styles.actionText,
          danger && styles.dangerText,
          disabled && styles.disabledText,
        ]}
      >
        {label}
      </Text>
      <Text style={[styles.chevron, disabled && styles.disabledText]}>›</Text>
    </Pressable>
  );
}

function getMachineWsUrl(): string {
  const base = getServerUrl().replace(/\/+$/, "");
  return `${base.replace(/^http/, "ws")}/ws/machine`;
}

function shortenPath(path: string): string {
  return path.replace(/^\/home\/[^/]+/, "~");
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    minHeight: 54,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  machinePill: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 7,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "700",
  },
  headerMeta: {
    marginTop: 1,
    color: colors.foregroundMuted,
    fontSize: 10,
  },
  headerControlButton: {
    minHeight: 34,
    borderRadius: 8,
    paddingHorizontal: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colorAlpha.accentBorder,
    backgroundColor: colorAlpha.accentLight,
  },
  headerControlTake: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  headerControlText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "800",
  },
  headerControlTakeText: {
    color: colors.background,
    fontSize: 11,
    fontWeight: "800",
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
  scroll: {
    flex: 1,
  },
  scrollBody: {
    padding: 12,
    paddingBottom: 96,
  },
  terminalBody: {
    padding: 12,
    paddingBottom: 112,
  },
  sectionTitle: {
    marginTop: 8,
    marginBottom: 8,
    color: colors.foregroundMuted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  primaryWideButton: {
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  primaryWideText: {
    color: colors.background,
    fontSize: 13,
    fontWeight: "800",
  },
  secondaryWideButton: {
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  secondaryWideText: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: "700",
  },
  disabledButton: {
    opacity: 0.55,
  },
  disabledText: {
    color: colors.foregroundMuted,
  },
  hostRow: {
    minHeight: 64,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  workpathRow: {
    minHeight: 58,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  selectedRow: {
    borderColor: colors.accent,
    backgroundColor: colorAlpha.accentLight,
  },
  rowTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "700",
  },
  rowMeta: {
    marginTop: 3,
    color: colors.foregroundMuted,
    fontSize: 11,
  },
  rowCount: {
    color: colors.foregroundSecondary,
    fontSize: 11,
    fontWeight: "700",
  },
  folderIcon: {
    color: colors.foregroundMuted,
    fontSize: 15,
  },
  hostDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
  },
  hostDotActive: {
    backgroundColor: colors.accent,
  },
  hostDotInner: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.success,
    borderWidth: 1,
    borderColor: colors.surface,
  },
  controlPanel: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 12,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  panelTitle: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "800",
  },
  panelMeta: {
    marginTop: 3,
    color: colors.foregroundMuted,
    fontSize: 11,
  },
  accentText: {
    color: colors.accent,
  },
  inlineControlButton: {
    minHeight: 38,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.backgroundSecondary,
  },
  inlineControlTake: {
    borderColor: colors.accent,
    backgroundColor: colorAlpha.accentLight,
  },
  inlineControlText: {
    color: colors.foreground,
    fontSize: 12,
    fontWeight: "800",
  },
  inlineControlTakeText: {
    color: colors.accent,
  },
  inlineNewButton: {
    minHeight: 38,
    borderRadius: 9,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  inlineNewText: {
    color: colors.background,
    fontSize: 12,
    fontWeight: "900",
  },
  scopeButton: {
    minHeight: 58,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  scopeEyebrow: {
    color: colors.foregroundMuted,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  scopeTitle: {
    marginTop: 2,
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "700",
  },
  chevron: {
    color: colors.foregroundMuted,
    fontSize: 24,
  },
  emptyState: {
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyIcon: {
    color: colors.foregroundMuted,
    fontSize: 38,
    opacity: 0.5,
  },
  emptyTitle: {
    marginTop: 10,
    color: colors.foreground,
    fontSize: 15,
    fontWeight: "700",
  },
  emptyText: {
    marginTop: 4,
    color: colors.foregroundMuted,
    fontSize: 12,
  },
  terminalRow: {
    minHeight: 64,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  terminalDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  terminalDotOffline: {
    backgroundColor: colors.foregroundMuted,
  },
  bottomNav: {
    minHeight: 62,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    flexDirection: "row",
    paddingBottom: 4,
  },
  navButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    position: "relative",
  },
  navIcon: {
    color: colors.foregroundSecondary,
    fontSize: 20,
    lineHeight: 22,
  },
  navLabel: {
    color: colors.foregroundSecondary,
    fontSize: 10,
    fontWeight: "700",
  },
  navActiveText: {
    color: colors.accent,
  },
  badge: {
    position: "absolute",
    top: 7,
    right: 34,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeActive: {
    backgroundColor: colors.accent,
  },
  badgeText: {
    color: colors.foreground,
    fontSize: 9,
    fontWeight: "900",
  },
  badgeTextActive: {
    color: colors.background,
  },
  fab: {
    position: "absolute",
    right: 18,
    bottom: 78,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
  },
  fabText: {
    color: colors.background,
    fontSize: 30,
    lineHeight: 32,
    fontWeight: "700",
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  statCard: {
    width: "47.5%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 12,
  },
  statLabel: {
    color: colors.foregroundMuted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  statValue: {
    marginTop: 5,
    color: colors.foreground,
    fontSize: 24,
    fontWeight: "800",
  },
  infoPanel: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
  },
  infoRow: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  infoLabel: {
    color: colors.foregroundMuted,
    fontSize: 12,
  },
  infoValue: {
    flex: 1,
    textAlign: "right",
    color: colors.foreground,
    fontSize: 12,
    fontWeight: "700",
  },
  actionRow: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: 8,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  actionText: {
    flex: 1,
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "700",
  },
  dangerText: {
    color: colors.danger,
  },
  updateMessage: {
    marginTop: 2,
    color: colors.foregroundMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  modalSheet: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 18,
    paddingTop: 42,
  },
  modalTitle: {
    color: colors.foreground,
    fontSize: 22,
    fontWeight: "800",
  },
  modalDescription: {
    marginTop: 8,
    marginBottom: 16,
    color: colors.foregroundSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  codeBox: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 12,
    marginBottom: 12,
  },
  codeText: {
    color: colors.foreground,
    fontSize: 12,
    lineHeight: 19,
  },
  dialogBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  dialog: {
    width: "100%",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
  },
  dialogTitle: {
    color: colors.foreground,
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 10,
  },
  dialogText: {
    color: colors.foregroundSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
  },
  input: {
    minHeight: 44,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.foreground,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  dialogActions: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  dialogButton: {
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  dialogPrimaryButton: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  dialogDangerButton: {
    borderColor: colors.danger,
    backgroundColor: "transparent",
  },
  dialogButtonText: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: "700",
  },
  dialogPrimaryText: {
    color: colors.background,
    fontSize: 13,
    fontWeight: "800",
  },
  dialogDangerText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "800",
  },
});
