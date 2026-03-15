import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  approveRun,
  connectRunWebSocket,
  getRunDetail,
  interruptRun,
  rejectRun,
  sendInput,
} from '../api';
import { Run, RunEvent } from '../types';
import { colors, commonStyles, fonts, statusColor, statusLabel, toolIcon } from '../theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'RunDetail'>;

// Strip ANSI escape codes from text
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

const MAX_OUTPUT_LINES = 100;

export default function RunDetailScreen({ route, navigation }: Props): React.JSX.Element {
  const { agentId, runId } = route.params;

  const [run, setRun] = useState<Run | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchRunDetail = useCallback(async () => {
    try {
      const result = await getRunDetail(agentId, runId);
      setRun(result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load run';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [agentId, runId]);

  // Initial fetch
  useEffect(() => {
    fetchRunDetail();
  }, [fetchRunDetail]);

  // WebSocket connection for real-time output
  useEffect(() => {
    const ws = connectRunWebSocket(
      runId,
      (event: unknown) => {
        const typedEvent = event as RunEvent;
        if (typedEvent.type === 'run-output') {
          const cleanText = stripAnsi(typedEvent.data);
          setOutput(prev => {
            const newLines = [...prev, ...cleanText.split('\n')];
            // Keep only last MAX_OUTPUT_LINES
            if (newLines.length > MAX_OUTPUT_LINES) {
              return newLines.slice(-MAX_OUTPUT_LINES);
            }
            return newLines;
          });
        } else if (typedEvent.type === 'run-status') {
          setRun(typedEvent.run);
        }
      },
      () => {
        // On error, just try to refresh via REST
        fetchRunDetail();
      },
    );

    wsRef.current = ws;

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [runId, fetchRunDetail]);

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    if (scrollViewRef.current) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 50);
    }
  }, [output]);

  const handleSendInput = async () => {
    if (!inputText.trim()) {
      return;
    }

    const text = inputText;
    setInputText('');

    try {
      await sendInput(agentId, runId, text);
    } catch {
      // Show the text back so user can retry
      setInputText(text);
    }
  };

  const handleInterrupt = async () => {
    try {
      await interruptRun(agentId, runId);
    } catch {
      // Ignore
    }
  };

  const handleApprove = async () => {
    try {
      await approveRun(agentId, runId);
    } catch {
      // Ignore
    }
  };

  const handleReject = async () => {
    try {
      await rejectRun(agentId, runId);
    } catch {
      // Ignore
    }
  };

  const handleOpenTerminal = () => {
    navigation.navigate('Terminal', { agentId });
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
        <Text style={styles.errorText}>Run not found</Text>
      </View>
    );
  }

  const isActive = ['starting', 'running', 'waiting_input', 'waiting_approval'].includes(
    run.status,
  );
  const showInput = run.status === 'waiting_input' || run.status === 'running';
  const showApproveReject = run.status === 'waiting_approval';
  const showInterrupt = isActive;

  return (
    <KeyboardAvoidingView
      style={commonStyles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      {/* Header info */}
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
            <Text
              style={[styles.statusText, { color: statusColor(run.status) }]}>
              {statusLabel(run.status)}
            </Text>
          </View>
        </View>

        {run.summary ? (
          <Text style={styles.summary} numberOfLines={2}>
            {run.summary}
          </Text>
        ) : null}
      </View>

      {/* Output area */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.outputArea}
        contentContainerStyle={styles.outputContent}>
        {output.length === 0 ? (
          <Text style={styles.outputPlaceholder}>
            {isActive ? 'Waiting for output...' : 'No output recorded'}
          </Text>
        ) : (
          <Text style={styles.outputText} selectable>
            {output.join('\n')}
          </Text>
        )}
      </ScrollView>

      {/* Action buttons */}
      <View style={styles.actionsContainer}>
        {showApproveReject && (
          <View style={styles.approveRejectRow}>
            <TouchableOpacity
              style={[styles.actionButton, styles.rejectButton]}
              onPress={handleReject}
              activeOpacity={0.7}>
              <Text style={[styles.actionButtonText, { color: colors.red }]}>
                Reject
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.approveButton]}
              onPress={handleApprove}
              activeOpacity={0.7}>
              <Text style={[styles.actionButtonText, { color: colors.green }]}>
                Approve
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.bottomRow}>
          {showInterrupt && (
            <TouchableOpacity
              style={[styles.actionButton, styles.interruptButton]}
              onPress={handleInterrupt}
              activeOpacity={0.7}>
              <Text style={[styles.actionButtonText, { color: colors.orange }]}>
                Interrupt
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.actionButton, styles.terminalButton]}
            onPress={handleOpenTerminal}
            activeOpacity={0.7}>
            <Text style={[styles.actionButtonText, { color: colors.textSecondary }]}>
              Terminal
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Input bar */}
      {showInput && (
        <View style={styles.inputBar}>
          <TextInput
            style={styles.inputField}
            placeholder="Type a message..."
            placeholderTextColor={colors.textSecondary}
            value={inputText}
            onChangeText={setInputText}
            returnKeyType="send"
            onSubmitEditing={handleSendInput}
            autoCorrect={false}
          />
          <TouchableOpacity
            style={styles.sendButton}
            onPress={handleSendInput}
            activeOpacity={0.7}>
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
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
    paddingVertical: 12,
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
  summary: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 8,
  },
  outputArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  outputContent: {
    padding: 12,
    minHeight: '100%',
  },
  outputPlaceholder: {
    color: colors.textSecondary,
    fontSize: 14,
    fontFamily: fonts.mono,
    textAlign: 'center',
    marginTop: 40,
  },
  outputText: {
    color: colors.text,
    fontSize: 12,
    fontFamily: fonts.mono,
    lineHeight: 18,
  },
  actionsContainer: {
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  approveRejectRow: {
    flexDirection: 'row',
    gap: 8,
  },
  bottomRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  approveButton: {
    backgroundColor: colors.green + '22',
  },
  rejectButton: {
    backgroundColor: colors.red + '22',
  },
  interruptButton: {
    backgroundColor: colors.orange + '22',
  },
  terminalButton: {
    backgroundColor: colors.surfaceLight,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  inputBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
    gap: 8,
  },
  inputField: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },
  sendButton: {
    backgroundColor: colors.accent,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  sendButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  errorText: {
    color: colors.red,
    fontSize: 14,
    textAlign: 'center',
  },
});
