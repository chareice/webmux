import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { deleteThread, listAllThreads } from '../api';
import { useAuth } from '../store';
import { Run, RunStatus } from '../types';
import { colors, commonStyles, statusColor, statusLabel } from '../theme';
import type { RootStackParamList } from '../navigation';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const ACTIVE_STATUSES: RunStatus[] = ['starting', 'running'];
const AUTO_REFRESH_INTERVAL = 5000;

interface ProjectGroup {
  repoPath: string;
  repoName: string;
  runs: Run[];
  hasActive: boolean;
  latestUpdate: number;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function repoName(repoPath: string): string {
  const parts = repoPath.split('/');
  return parts[parts.length - 1] || repoPath;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

function aiPreview(run: Run): string {
  if (run.summary) return truncate(run.summary, 100);
  if (run.status === 'running' || run.status === 'starting') return 'Running...';
  return 'No summary';
}

function groupByProject(runs: Run[]): ProjectGroup[] {
  const map = new Map<string, Run[]>();
  for (const run of runs) {
    const key = run.repoPath;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(run);
  }

  const groups: ProjectGroup[] = [];
  for (const [path, groupRuns] of map) {
    groupRuns.sort((a, b) => b.updatedAt - a.updatedAt);
    groups.push({
      repoPath: path,
      repoName: repoName(path),
      runs: groupRuns,
      hasActive: groupRuns.some((r) => ACTIVE_STATUSES.includes(r.status)),
      latestUpdate: groupRuns[0].updatedAt,
    });
  }

  groups.sort((a, b) => {
    if (a.hasActive !== b.hasActive) return a.hasActive ? -1 : 1;
    return b.latestUpdate - a.latestUpdate;
  });

  return groups;
}

export default function ThreadsScreen(): React.JSX.Element {
  const navigation = useNavigation<NavigationProp>();
  const { logout } = useAuth();
  const [runs, setRuns] = useState<Run[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [deletingRunId, setDeletingRunId] = useState('');
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchThreads = useCallback(async (showLoading = false) => {
    if (showLoading) {
      setIsLoading(true);
    }
    setError('');
    try {
      const result = await listAllThreads();
      setRuns(result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load threads';
      setError(msg);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchThreads(true);
  }, [fetchThreads]);

  useEffect(() => {
    const hasActiveRuns = runs.some(r =>
      ACTIVE_STATUSES.includes(r.status),
    );

    if (hasActiveRuns) {
      intervalRef.current = setInterval(() => {
        fetchThreads(false);
      }, AUTO_REFRESH_INTERVAL);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [runs, fetchThreads]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchThreads(false);
    });
    return unsubscribe;
  }, [navigation, fetchThreads]);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchThreads(false);
  }, [fetchThreads]);

  const projectGroups = useMemo(() => groupByProject(runs), [runs]);

  const toggleProject = useCallback((path: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => navigation.navigate('Agents')}
            activeOpacity={0.7}>
            <Text style={styles.headerActionText}>Agents</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={logout} activeOpacity={0.7}>
            <Text style={styles.headerActionText}>Logout</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [logout, navigation]);

  const handleDelete = useCallback((run: Run) => {
    const actionLabel =
      run.status === 'starting' || run.status === 'running'
        ? 'This will stop the running task and remove it from the list.'
        : 'This will remove the thread from the list.';

    Alert.alert(
      'Remove thread?',
      actionLabel,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingRunId(run.id);
              await deleteThread(run.agentId, run.id);
              setRuns(prev => prev.filter(item => item.id !== run.id));
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : 'Failed to remove thread';
              setError(msg);
            } finally {
              setDeletingRunId('');
            }
          },
        },
      ],
    );
  }, []);

  const renderRunCard = (run: Run) => {
    const sc = statusColor(run.status);
    const toolName = run.tool === 'codex' ? 'Codex' : 'Claude';
    return (
      <View key={run.id} style={styles.threadCard}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('ThreadDetail', {
              agentId: run.agentId,
              runId: run.id,
            })
          }>
          {/* Meta row: tool · status · time */}
          <View style={styles.metaRow}>
            <Text style={styles.metaTool}>{toolName}</Text>
            <View style={[styles.statusBadge, { backgroundColor: sc + '22' }]}>
              <View style={[styles.statusDot, { backgroundColor: sc }]} />
              <Text style={[styles.statusText, { color: sc }]}>
                {statusLabel(run.status)}
              </Text>
            </View>
            <Text style={styles.metaTime}>{timeAgo(run.updatedAt)}</Text>
          </View>

          {/* Conversation preview */}
          <View style={styles.convoPreview}>
            <View style={styles.convoLine}>
              <Text style={styles.convoRoleUser}>You:</Text>
              <Text style={styles.convoText} numberOfLines={1}>
                {truncate(run.prompt, 80)}
              </Text>
            </View>
            <View style={styles.convoLine}>
              <Text style={styles.convoRoleAssistant}>AI:</Text>
              <Text style={styles.convoText} numberOfLines={1}>
                {aiPreview(run)}
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Delete button */}
        <View style={styles.cardFooter}>
          <TouchableOpacity
            activeOpacity={0.7}
            disabled={deletingRunId === run.id}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => handleDelete(run)}>
            <Text
              style={[
                styles.deleteText,
                deletingRunId === run.id && styles.deleteTextDisabled,
              ]}>
              {deletingRunId === run.id ? 'Removing...' : 'Remove'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (isLoading && runs.length === 0) {
    return (
      <View style={[commonStyles.screen, styles.center]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={commonStyles.screen}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }>
        {error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => fetchThreads(true)}>
              <Text style={styles.retryText}>Tap to retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {runs.length === 0 && !error ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No threads yet</Text>
            <Text style={styles.emptySubtext}>
              Tap + to create your first thread
            </Text>
          </View>
        ) : null}

        {projectGroups.map((group) => {
          const isCollapsed = collapsedProjects.has(group.repoPath);
          const activeCount = group.runs.filter((r) =>
            ACTIVE_STATUSES.includes(r.status),
          ).length;

          return (
            <View key={group.repoPath} style={styles.projectSection}>
              <TouchableOpacity
                style={styles.projectHeader}
                activeOpacity={0.7}
                onPress={() => toggleProject(group.repoPath)}>
                <Text style={styles.projectChevron}>
                  {isCollapsed ? '›' : '⌄'}
                </Text>
                <Text style={styles.projectName}>{group.repoName}</Text>
                <Text style={styles.projectPath} numberOfLines={1}>
                  {group.repoPath}
                </Text>
                <View style={styles.projectBadges}>
                  {activeCount > 0 ? (
                    <View style={styles.activeBadge}>
                      <Text style={styles.activeBadgeText}>
                        {activeCount} active
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{group.runs.length}</Text>
                  </View>
                </View>
              </TouchableOpacity>

              {!isCollapsed ? group.runs.map(renderRunCard) : null}
            </View>
          );
        })}

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('NewThread')}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 100,
  },

  // Project group header
  projectSection: {
    marginTop: 8,
  },
  projectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    backgroundColor: colors.surface,
    borderRadius: 10,
    marginBottom: 4,
  },
  projectChevron: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    width: 14,
    textAlign: 'center',
  },
  projectName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  projectPath: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 11,
    marginLeft: 4,
  },
  projectBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  activeBadge: {
    backgroundColor: colors.accent + '22',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  activeBadgeText: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '700',
  },
  countBadge: {
    backgroundColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  countBadgeText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
  },

  // Thread card (compact)
  threadCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 16,
    marginVertical: 3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  metaTool: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  metaTime: {
    color: colors.textSecondary,
    fontSize: 11,
    marginLeft: 'auto',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 5,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
  },

  // Conversation preview
  convoPreview: {
    gap: 4,
  },
  convoLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  convoRoleUser: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    width: 28,
  },
  convoRoleAssistant: {
    color: colors.green,
    fontSize: 12,
    fontWeight: '700',
    width: 28,
  },
  convoText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },

  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 6,
  },
  deleteText: {
    color: colors.red,
    fontSize: 12,
    fontWeight: '600',
  },
  deleteTextDisabled: {
    opacity: 0.6,
  },
  errorContainer: {
    alignItems: 'center',
    padding: 32,
  },
  errorText: {
    color: colors.red,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
  },
  retryText: {
    color: colors.accent,
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
  },
  emptyText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtext: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  bottomSpacer: {
    height: 40,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  fabText: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '300',
    marginTop: -2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 16,
  },
  headerActionText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
});
