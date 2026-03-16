import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { colors, commonStyles, statusColor, statusLabel, toolIcon } from '../theme';
import type { RootStackParamList } from '../navigation';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const ACTIVE_STATUSES: RunStatus[] = ['starting', 'running'];
const COMPLETED_STATUSES: RunStatus[] = ['success', 'failed', 'interrupted'];
const AUTO_REFRESH_INTERVAL = 5000;

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

export default function ThreadsScreen(): React.JSX.Element {
  const navigation = useNavigation<NavigationProp>();
  const { logout } = useAuth();
  const [runs, setRuns] = useState<Run[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [deletingRunId, setDeletingRunId] = useState('');
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

  // Auto-refresh when there are active runs
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

  // Refresh when screen is focused
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

  const activeRuns = runs.filter(r => ACTIVE_STATUSES.includes(r.status));
  const completedRuns = runs.filter(r => COMPLETED_STATUSES.includes(r.status));

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

  const renderRunCard = (run: Run) => (
    <View key={run.id} style={commonStyles.card}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() =>
          navigation.navigate('ThreadDetail', {
            agentId: run.agentId,
            runId: run.id,
          })
        }>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={[styles.toolBadge, { backgroundColor: run.tool === 'codex' ? colors.green + '22' : colors.accent + '22' }]}>
              <Text style={[styles.toolBadgeText, { color: run.tool === 'codex' ? colors.green : colors.accent }]}>
                {toolIcon(run.tool)}
              </Text>
            </View>
            <View style={styles.cardTitleArea}>
              <Text style={styles.repoName} numberOfLines={1}>
                {repoName(run.repoPath)}
              </Text>
              {run.branch ? (
                <Text style={styles.branch} numberOfLines={1}>
                  {run.branch}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor(run.status) + '22' }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor(run.status) }]} />
            <Text style={[styles.statusText, { color: statusColor(run.status) }]}>
              {statusLabel(run.status)}
            </Text>
          </View>
        </View>

        <Text style={styles.prompt} numberOfLines={2}>
          {run.prompt}
        </Text>
      </TouchableOpacity>

      <View style={styles.cardFooter}>
        <Text style={styles.timeText}>{timeAgo(run.updatedAt)}</Text>
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

        {activeRuns.length > 0 && (
          <>
            <Text style={commonStyles.sectionTitle}>Active</Text>
            {activeRuns.map(renderRunCard)}
          </>
        )}

        {completedRuns.length > 0 && (
          <>
            <Text style={commonStyles.sectionTitle}>Completed</Text>
            {completedRuns.map(renderRunCard)}
          </>
        )}

        {/* Bottom spacing for FAB */}
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  toolBadge: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  toolBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  cardTitleArea: {
    flex: 1,
  },
  repoName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  branch: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  prompt: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timeText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  deleteText: {
    color: colors.red,
    fontSize: 13,
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
