import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  RefreshControl,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useWorkpaths } from "../../../lib/workpath-context";
import { createRegistrationToken } from "../../../lib/api";
import { LAST_SERVER_URL_KEY } from "../../../lib/auth-utils";
import { buildRegistrationCommand } from "../../../lib/registration-utils";
import { storage } from "../../../lib/storage";
import { useTheme } from "../../../lib/theme";
import type { Workpath } from "../../../lib/workpath";

// --- Onboarding: inline node registration ---

function OnboardingView() {
  const { colors } = useTheme();

  const [registering, setRegistering] = useState(false);
  const [command, setCommand] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cachedRef = useRef<{ token: string; expiresAt: number; serverUrl?: string | null } | null>(null);
  const [lastServerUrl, setLastServerUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void storage.get(LAST_SERVER_URL_KEY).then((v) => {
      if (!cancelled) setLastServerUrl(v);
    });
    return () => { cancelled = true; };
  }, []);

  const buildCmd = useCallback(
    (token: string, serverUrl?: string | null) => {
      const windowOrigin =
        Platform.OS === "web" && typeof window !== "undefined"
          ? window.location.origin
          : null;
      return buildRegistrationCommand({ token, serverUrl, lastServerUrl, windowOrigin });
    },
    [lastServerUrl],
  );

  const generateToken = useCallback(async () => {
    // Reuse cached token if valid
    const cached = cachedRef.current;
    if (cached && cached.expiresAt > Date.now() + 60000) {
      setCommand(buildCmd(cached.token, cached.serverUrl));
      return;
    }

    setRegistering(true);
    setError(null);
    try {
      const data = await createRegistrationToken();
      cachedRef.current = {
        token: data.token,
        expiresAt: data.expiresAt,
        serverUrl: data.serverUrl ?? null,
      };
      setCommand(buildCmd(data.token, data.serverUrl));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRegistering(false);
    }
  }, [buildCmd]);

  // Auto-generate on mount
  useEffect(() => {
    void generateToken();
  }, [generateToken]);

  const handleCopy = async () => {
    if (!command) return;
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(command);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleRegenerate = () => {
    cachedRef.current = null;
    setCommand(null);
    setCopied(false);
    void generateToken();
  };

  return (
    <View className="flex-1 bg-background items-center justify-center p-8">
      <View className="w-full max-w-md">
        <Text className="text-foreground text-2xl font-bold mb-2">
          Welcome to webmux
        </Text>
        <Text className="text-foreground-secondary text-sm mb-6 leading-5">
          Connect a machine to get started. Run the command below on the server
          where your coding agent should work.
        </Text>

        {registering ? (
          <View className="items-center py-6">
            <ActivityIndicator size="small" color={colors.accent} />
            <Text className="text-foreground-secondary mt-2 text-sm">
              Generating registration command...
            </Text>
          </View>
        ) : command ? (
          <View>
            <Text className="text-foreground-secondary text-xs mb-2 font-semibold uppercase tracking-wide">
              Run on your server
            </Text>
            <View className="bg-surface border border-border p-3 mb-3">
              <Text className="text-foreground text-xs font-mono" selectable>
                {command}
              </Text>
            </View>
            <View className="flex-row gap-2 mb-4">
              <Pressable
                className="bg-foreground px-4 py-2"
                onPress={() => void handleCopy()}
              >
                <Text className="text-background text-sm font-semibold">
                  {copied ? "Copied!" : "Copy"}
                </Text>
              </Pressable>
              <Pressable
                className="bg-surface border border-border px-4 py-2"
                onPress={handleRegenerate}
              >
                <Text className="text-foreground-secondary text-sm">
                  Regenerate
                </Text>
              </Pressable>
            </View>
            <Text className="text-foreground-secondary text-xs leading-4">
              Once the agent connects, this page will update automatically.
              Use --name to set a custom node name.
            </Text>
          </View>
        ) : error ? (
          <View>
            <Text className="text-red text-sm mb-3">{error}</Text>
            <Pressable
              className="bg-surface border border-border px-4 py-2 self-start"
              onPress={handleRegenerate}
            >
              <Text className="text-foreground text-sm">Try again</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// --- Mobile: Workpath Card ---

function WorkpathCard({
  workpath,
  onPress,
}: {
  workpath: Workpath;
  onPress: () => void;
}) {
  return (
    <Pressable
      className="bg-surface border border-border rounded-lg px-4 py-3 mb-2"
      onPress={onPress}
    >
      <View className="flex-row items-center gap-2">
        <Text className="text-foreground text-base font-semibold flex-1" numberOfLines={1}>
          {workpath.dirName}
        </Text>
        {workpath.activeCount > 0 ? (
          <View className="bg-accent/20 rounded px-1.5 py-0.5">
            <Text className="text-accent text-xs font-medium">
              {workpath.activeCount} active
            </Text>
          </View>
        ) : null}
        <Text className="text-foreground-secondary text-xs">
          {workpath.runs.length} {workpath.runs.length === 1 ? "thread" : "threads"}
        </Text>
      </View>
      {workpath.nodeName ? (
        <Text className="text-foreground-secondary text-xs mt-1">
          {workpath.nodeName}
        </Text>
      ) : null}
      <Text
        className="text-foreground-secondary text-xs mt-0.5 font-mono"
        numberOfLines={1}
      >
        {workpath.repoPath}
      </Text>
    </Pressable>
  );
}

// --- Main Home Screen ---

export default function HomeScreen() {
  const router = useRouter();
  const { workpaths, agents, isLoading, reload } = useWorkpaths();
  const [refreshing, setRefreshing] = useState(false);

  const { width } = useWindowDimensions();
  const isWideScreen = Platform.OS === "web" && width >= 768;

  // Reload data when screen regains focus (e.g. after creating a thread)
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const hasNodes = agents.size > 0;

  // Show onboarding when no nodes exist (both wide and mobile)
  if (!isLoading && !hasNodes) {
    return <OnboardingView />;
  }

  // --- Web wide view: placeholder (thread list is in LeftPanel) ---
  if (isWideScreen) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-foreground-secondary text-sm">
          Select a thread from the sidebar
        </Text>
      </View>
    );
  }

  // --- Mobile view: workpath list ---
  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-8"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />
        }
      >
        {workpaths.length === 0 ? (
          <View className="items-center py-12">
            <Text className="text-foreground-secondary text-sm">
              No threads yet. Create one to get started.
            </Text>
          </View>
        ) : (
          workpaths.map((wp) => (
            <WorkpathCard
              key={wp.repoPath}
              workpath={wp}
              onPress={() => {
                router.push(
                  `/(main)/workpath?path=${encodeURIComponent(wp.repoPath)}&agentId=${wp.agentId}` as never,
                );
              }}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}
