import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  connectThreadWebSocket,
  continueThread,
  getThreadDetail,
  interruptThread,
} from '../api';
import { Run, RunEvent, RunTimelineEvent, RunTurnDetail } from '../types';
import { colors, commonStyles, fonts, statusColor, statusLabel, toolIcon } from '../theme';
import type { RootStackParamList } from '../navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isRunTimelineEvent, isRunTurn } from '../run-detail-response';
import { appendTurnItem, canContinueRun, isRunActive, latestRunTurn, upsertRunTurn } from '../run-thread';

type Props = NativeStackScreenProps<RootStackParamList, 'ThreadDetail'>;

export default function RunDetailScreen({ route }: Props): React.JSX.Element {
  const { agentId, runId } = route.params;
  const insets = useSafeAreaInsets();

  const [run, setRun] = useState<Run | null>(null);
  const [turns, setTurns] = useState<RunTurnDetail[]>([]);
  const [followUpPrompt, setFollowUpPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isContinuing, setIsContinuing] = useState(false);
  const [error, setError] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchThreadDetail = useCallback(async () => {
    try {
      const result = await getThreadDetail(agentId, runId);
      setRun(result.run);
      setTurns(result.turns);
      setError('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load thread';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [agentId, runId]);

  useEffect(() => {
    setRun(null);
    setTurns([]);
    setError('');
    setFollowUpPrompt('');
    setIsLoading(true);
    void fetchThreadDetail();
  }, [fetchThreadDetail, runId]);

  useEffect(() => {
    const ws = connectThreadWebSocket(
      runId,
      (event: unknown) => {
        const typedEvent = event as RunEvent;
        if (typedEvent.type === 'run-item' && isRunTimelineEvent(typedEvent.item)) {
          setTurns((prev) => {
            const next = appendTurnItem(prev, typedEvent.turnId, typedEvent.item);
            if (next === prev) {
              void fetchThreadDetail();
            }
            return next;
          });
          return;
        }

        if (typedEvent.type === 'run-turn' && isRunTurn(typedEvent.turn)) {
          setTurns((prev) => upsertRunTurn(prev, typedEvent.turn));
          return;
        }

        if (typedEvent.type === 'run-status') {
          setRun(typedEvent.run);
        }
      },
      () => {
        void fetchThreadDetail();
      },
    );

    wsRef.current = ws;

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [runId, fetchThreadDetail]);

  useEffect(() => {
    if (!scrollViewRef.current) {
      return;
    }

    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 50);
  }, [turns]);

  const latestTurn = latestRunTurn(turns);
  const isActive = latestTurn ? isRunActive(latestTurn.status) : run ? isRunActive(run.status) : false;

  const handleInterrupt = async () => {
    try {
      await interruptThread(agentId, runId);
    } catch {
      // Ignore transient action failures here.
    }
  };

  const handleContinue = async () => {
    Keyboard.dismiss();

    if (!followUpPrompt.trim()) {
      setError('Please enter a follow-up prompt');
      return;
    }

    setIsContinuing(true);
    try {
      const result = await continueThread(agentId, runId, {
        prompt: followUpPrompt.trim(),
      });
      setRun(result.run);
      setTurns(result.turns);
      setFollowUpPrompt('');
      setError('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to continue thread';
      setError(msg);
    } finally {
      setIsContinuing(false);
    }
  };

  if (isLoading) {
    return (
      <View style={[commonStyles.screen, styles.center]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (error && !run) {
    return (
      <View style={[commonStyles.screen, styles.center]}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (!run) {
    return (
      <View style={[commonStyles.screen, styles.center]}>
        <Text style={styles.errorText}>Thread not found</Text>
      </View>
    );
  }

  return (
    <View style={commonStyles.screen}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.headerLeft}>
            <View
              style={[
                styles.toolBadge,
                {
                  backgroundColor:
                    run.tool === 'codex'
                      ? colors.green + '22'
                      : colors.accent + '22',
                },
              ]}>
              <Text
                style={[
                  styles.toolBadgeText,
                  {
                    color: run.tool === 'codex' ? colors.green : colors.accent,
                  },
                ]}>
                {toolIcon(run.tool)}
              </Text>
            </View>
            <View style={styles.headerInfo}>
              <Text style={styles.repoName} numberOfLines={1}>
                {run.repoPath}
              </Text>
              {run.branch ? (
                <Text style={styles.branch} numberOfLines={1}>
                  {run.branch}
                </Text>
              ) : null}
            </View>
          </View>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: statusColor(run.status) + '22' },
            ]}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: statusColor(run.status) },
              ]}
            />
            <Text style={[styles.statusText, { color: statusColor(run.status) }]}>
              {statusLabel(run.status)}
            </Text>
          </View>
        </View>

        <Text style={styles.promptLabel}>Started With</Text>
        <Text style={styles.promptText}>{run.prompt}</Text>

        {run.summary ? (
          <>
            <Text style={styles.summaryLabel}>Latest Summary</Text>
            <Text style={styles.summaryText}>{run.summary}</Text>
          </>
        ) : null}
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.timeline}
        contentContainerStyle={styles.timelineContent}>
        {turns.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>
              {isActive ? 'Thread started. Waiting for timeline events.' : 'No timeline recorded.'}
            </Text>
            <Text style={styles.emptyHint}>
              Each completed turn stays in this thread, so you can continue after it finishes.
            </Text>
          </View>
        ) : (
          turns.map((turn) => <TurnSectionView key={turn.id} turn={turn} />)
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
        {isActive ? (
          <>
            <TouchableOpacity
              style={[styles.actionButton, styles.interruptButton]}
              onPress={handleInterrupt}
              activeOpacity={0.7}>
              <Text style={[styles.actionButtonText, { color: colors.orange }]}>
                Interrupt
              </Text>
            </TouchableOpacity>
            <Text style={styles.footerHint}>
              Follow-up input becomes available after the current turn finishes.
            </Text>
          </>
        ) : canContinueRun(latestTurn) ? (
          <>
            <TextInput
              style={[commonStyles.input, styles.followUpInput]}
              placeholder="Continue this thread with a follow-up prompt"
              placeholderTextColor={colors.textSecondary}
              value={followUpPrompt}
              onChangeText={setFollowUpPrompt}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            {error ? <Text style={styles.errorTextInline}>{error}</Text> : null}
            <TouchableOpacity
              style={[
                commonStyles.button,
                styles.continueButton,
                (isContinuing || !followUpPrompt.trim()) && styles.buttonDisabled,
              ]}
              onPress={handleContinue}
              disabled={isContinuing || !followUpPrompt.trim()}
              activeOpacity={0.7}>
              {isContinuing ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={commonStyles.buttonText}>Send Follow-up</Text>
              )}
            </TouchableOpacity>
            <Text style={styles.footerHint}>
              This starts the next turn in the same thread. The page stays here.
            </Text>
          </>
        ) : (
          <Text style={styles.footerHint}>
            Need a full terminal? Open it from the agent page. Thread detail is a structured thread view.
          </Text>
        )}
      </View>
    </View>
  );
}

function TurnSectionView({ turn }: { turn: RunTurnDetail }): React.JSX.Element {
  return (
    <View style={styles.turnSection}>
      <View style={styles.turnHeader}>
        <Text style={styles.turnTitle}>Turn {turn.index}</Text>
        <Text style={[styles.turnStatus, { color: statusColor(turn.status) }]}>
          {statusLabel(turn.status)}
        </Text>
      </View>

      <View style={styles.messageCard}>
        <Text style={styles.messageEyebrow}>User</Text>
        <Text style={styles.messageText}>{turn.prompt}</Text>
      </View>

      {turn.items.length === 0 ? (
        <View style={styles.turnEmptyState}>
          <Text style={styles.turnEmptyText}>Waiting for events...</Text>
        </View>
      ) : (
        turn.items.map((item) => (
          <TimelineItemView key={`${turn.id}-${item.id}`} item={item} />
        ))
      )}
    </View>
  );
}

function TimelineItemView({ item }: { item: RunTimelineEvent }): React.JSX.Element {
  if (item.type === 'message') {
    return (
      <View style={styles.messageCard}>
        <Text style={styles.messageEyebrow}>
          {item.role === 'assistant' ? 'Assistant' : item.role === 'user' ? 'User' : 'System'}
        </Text>
        <Text style={styles.messageText}>{item.text}</Text>
      </View>
    );
  }

  if (item.type === 'command') {
    const commandColor =
      item.status === 'failed'
        ? colors.red
        : item.status === 'completed'
          ? colors.green
          : colors.accent;

    return (
      <View style={styles.commandCard}>
        <View style={styles.commandHeader}>
          <Text style={[styles.commandEyebrow, { color: commandColor }]}>
            {item.status === 'started' ? 'Command running' : 'Command'}
          </Text>
          {item.exitCode !== null ? (
            <Text style={styles.commandExit}>exit {item.exitCode}</Text>
          ) : null}
        </View>
        <Text style={styles.commandText}>{item.command}</Text>
        {item.output ? (
          <View style={styles.commandOutputBox}>
            <Text style={styles.commandOutputText}>{item.output.trimEnd()}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.activityRow}>
      <View
        style={[
          styles.activityDot,
          {
            backgroundColor:
              item.status === 'success'
                ? colors.green
                : item.status === 'warning'
                  ? colors.orange
                  : item.status === 'error'
                    ? colors.red
                    : colors.accent,
          },
        ]}
      />
      <View style={styles.activityTextArea}>
        <Text style={styles.activityLabel}>{item.label}</Text>
        {item.detail ? <Text style={styles.activityDetail}>{item.detail}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
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
  headerInfo: {
    flex: 1,
  },
  repoName: {
    color: colors.text,
    fontSize: 15,
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
  promptLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 12,
  },
  promptText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  summaryLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 14,
  },
  summaryText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  timeline: {
    flex: 1,
  },
  timelineContent: {
    padding: 14,
    gap: 14,
  },
  emptyState: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyHint: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 10,
    maxWidth: 280,
  },
  turnSection: {
    gap: 10,
  },
  turnHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  turnTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  turnStatus: {
    fontSize: 12,
    fontWeight: '600',
  },
  turnEmptyState: {
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  turnEmptyText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  messageCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  messageEyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  messageText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  commandCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  commandHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  commandEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  commandExit: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: fonts.mono,
  },
  commandText: {
    color: colors.text,
    fontSize: 12,
    fontFamily: fonts.mono,
    lineHeight: 18,
    marginTop: 8,
  },
  commandOutputBox: {
    backgroundColor: colors.background,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
  },
  commandOutputText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: fonts.mono,
    lineHeight: 18,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    marginRight: 10,
  },
  activityTextArea: {
    flex: 1,
  },
  activityLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  activityDetail: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
    fontFamily: fonts.mono,
  },
  footer: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  actionButton: {
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    marginBottom: 10,
  },
  interruptButton: {
    backgroundColor: colors.orange + '22',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  followUpInput: {
    minHeight: 96,
    marginBottom: 10,
  },
  continueButton: {
    marginBottom: 10,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  footerHint: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  errorText: {
    color: colors.red,
    fontSize: 14,
    textAlign: 'center',
  },
  errorTextInline: {
    color: colors.red,
    fontSize: 12,
    marginBottom: 10,
  },
});
