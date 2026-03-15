import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';

import { listAgents } from '../api';
import type { RootStackParamList } from '../navigation';
import { AgentInfo } from '../types';
import { colors, commonStyles } from '../theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

function formatLastSeen(lastSeenAt: number | null): string {
  if (!lastSeenAt) {
    return 'Never connected'
  }

  const elapsedSeconds = Math.max(0, Math.floor(Date.now() / 1000) - lastSeenAt)
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`
  }

  return `${Math.floor(elapsedHours / 24)}d ago`
}

export default function AgentsScreen(): React.JSX.Element {
  const navigation = useNavigation<NavigationProp>();

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');

  const fetchAgents = useCallback(async (showLoading = false) => {
    if (showLoading) {
      setIsLoading(true);
    }

    setError('');
    try {
      const response = await listAgents();
      setAgents(response.agents);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load agents';
      setError(msg);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents(true);
  }, [fetchAgents]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchAgents(false);
    });
    return unsubscribe;
  }, [fetchAgents, navigation]);

  const onlineAgents = agents.filter(agent => agent.status === 'online').length;

  if (isLoading && agents.length === 0) {
    return (
      <View style={[commonStyles.screen, styles.center]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={commonStyles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => {
            setIsRefreshing(true);
            fetchAgents(false);
          }}
          tintColor={colors.accent}
        />
      }>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Your agents</Text>
        <Text style={styles.summaryText}>
          {onlineAgents} online / {agents.length} total
        </Text>
      </View>

      {error ? (
        <View style={styles.stateCard}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => fetchAgents(true)} activeOpacity={0.7}>
            <Text style={styles.retryText}>Tap to retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {agents.length === 0 && !error ? (
        <View style={styles.stateCard}>
          <Text style={styles.emptyTitle}>No agents yet</Text>
          <Text style={styles.emptyText}>
            Register an agent from the web app or your NAS first.
          </Text>
        </View>
      ) : null}

      {agents.map((agent) => (
        <View key={agent.id} style={commonStyles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.titleArea}>
              <Text style={styles.agentName}>{agent.name || agent.id}</Text>
              <Text style={styles.agentMeta}>{agent.id}</Text>
            </View>
            <View
              style={[
                styles.statusBadge,
                agent.status === 'online' ? styles.statusOnline : styles.statusOffline,
              ]}>
              <Text
                style={[
                  styles.statusText,
                  agent.status === 'online'
                    ? styles.statusOnlineText
                    : styles.statusOfflineText,
                ]}>
                {agent.status === 'online' ? 'Online' : 'Offline'}
              </Text>
            </View>
          </View>

          <Text style={styles.lastSeenText}>
            {agent.status === 'online'
              ? 'Connected now'
              : `Last seen ${formatLastSeen(agent.lastSeenAt)}`}
          </Text>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[
                styles.actionButton,
                agent.status !== 'online' && styles.actionButtonDisabled,
              ]}
              activeOpacity={0.7}
              disabled={agent.status !== 'online'}
              onPress={() => navigation.navigate('NewRun', { agentId: agent.id })}>
              <Text style={styles.actionButtonText}>New Run</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.secondaryButton,
                agent.status !== 'online' && styles.actionButtonDisabled,
              ]}
              activeOpacity={0.7}
              disabled={agent.status !== 'online'}
              onPress={() => navigation.navigate('Terminal', { agentId: agent.id })}>
              <Text style={styles.secondaryButtonText}>Terminal</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    paddingVertical: 12,
    paddingBottom: 32,
  },
  summaryCard: {
    ...commonStyles.card,
    marginTop: 4,
  },
  summaryTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
  },
  summaryText: {
    marginTop: 6,
    color: colors.textSecondary,
    fontSize: 14,
  },
  stateCard: {
    ...commonStyles.card,
    alignItems: 'center',
  },
  errorText: {
    color: colors.red,
    fontSize: 14,
    textAlign: 'center',
  },
  retryText: {
    marginTop: 12,
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  emptyText: {
    marginTop: 8,
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  titleArea: {
    flex: 1,
    marginRight: 12,
  },
  agentName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  agentMeta: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 12,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusOnline: {
    backgroundColor: `${colors.green}22`,
  },
  statusOffline: {
    backgroundColor: `${colors.textSecondary}22`,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statusOnlineText: {
    color: colors.green,
  },
  statusOfflineText: {
    color: colors.textSecondary,
  },
  lastSeenText: {
    marginTop: 14,
    color: colors.textSecondary,
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  actionButton: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: colors.accent,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.45,
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: colors.surfaceLight,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
});
