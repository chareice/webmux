import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import MarkdownContent from '../components/MarkdownContent';
import {
  DraftImageAttachment,
  Run,
  RunEvent,
  RunImageAttachment,
  RunTimelineEvent,
  RunTurnDetail,
} from '../types';
import { colors, commonStyles, fonts, statusColor, statusLabel } from '../theme';
import type { RootStackParamList } from '../navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isRunTimelineEvent, isRunTurn } from '../run-detail-response';
import { appendTurnItem, canContinueRun, isRunActive, latestRunTurn, upsertRunTurn } from '../run-thread';
import {
  formatAttachmentSize,
  pickImageAttachments,
  toUploadAttachments,
} from '../image-attachments';
// PreviewableMarkdownCard is unused — assistant messages render MarkdownContent directly

type Props = NativeStackScreenProps<RootStackParamList, 'ThreadDetail'>;

// Group timeline items into conversation segments (like web version)
type ConversationSegment =
  | { type: 'user'; text: string; attachments: RunImageAttachment[]; id: string }
  | { type: 'assistant'; text: string; id: number }
  | { type: 'tools'; items: RunTimelineEvent[]; id: string }
  | { type: 'system'; text: string; id: number };

function isTrivialActivity(item: RunTimelineEvent): boolean {
  if (item.type !== 'activity') return false;
  const lbl = item.label.toLowerCase();
  return (
    lbl.includes('completed') ||
    lbl.includes('started') ||
    lbl.includes('finished')
  );
}

function getActivityText(item: RunTimelineEvent): string {
  if (item.type !== 'activity') return '';
  return item.label + (item.detail ? `: ${item.detail}` : '');
}

function groupIntoSegments(turns: RunTurnDetail[]): ConversationSegment[] {
  const segments: ConversationSegment[] = [];

  for (const turn of turns) {
    // User message
    if (turn.prompt || turn.attachments.length > 0) {
      segments.push({
        type: 'user',
        text: turn.prompt,
        attachments: turn.attachments,
        id: `user-${turn.id}`,
      });
    }

    // Group items into assistant messages vs tool calls
    let pendingTools: RunTimelineEvent[] = [];

    const flushTools = () => {
      if (pendingTools.length === 0) return;
      // Single trivial activity → inline system text
      if (pendingTools.length === 1 && isTrivialActivity(pendingTools[0])) {
        segments.push({
          type: 'system',
          text: getActivityText(pendingTools[0]),
          id: pendingTools[0].id,
        });
      } else {
        segments.push({
          type: 'tools',
          items: [...pendingTools],
          id: `tools-${turn.id}-${pendingTools[0].id}`,
        });
      }
      pendingTools = [];
    };

    for (const item of turn.items) {
      if (item.type === 'message' && item.role === 'assistant') {
        flushTools();
        segments.push({ type: 'assistant', text: item.text, id: item.id });
      } else {
        // Commands, activities, system messages → tool group
        pendingTools.push(item);
      }
    }

    flushTools();
  }

  return segments;
}

export default function RunDetailScreen({ navigation, route }: Props): React.JSX.Element {
  const { agentId, runId } = route.params;
  const insets = useSafeAreaInsets();

  const [run, setRun] = useState<Run | null>(null);
  const [turns, setTurns] = useState<RunTurnDetail[]>([]);
  const [followUpPrompt, setFollowUpPrompt] = useState('');
  const [followUpAttachments, setFollowUpAttachments] = useState<DraftImageAttachment[]>([]);
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
    setFollowUpAttachments([]);
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
  const handleOpenContent = useCallback(
    (title: string, content: string, mono = false) => {
      navigation.navigate('ThreadContent', { title, content, mono });
    },
    [navigation],
  );

  const handleInterrupt = async () => {
    try {
      await interruptThread(agentId, runId);
    } catch {
      // Ignore transient action failures here.
    }
  };

  const handleContinue = async () => {
    Keyboard.dismiss();

    if (!followUpPrompt.trim() && followUpAttachments.length === 0) {
      setError('Please enter a follow-up prompt or attach an image');
      return;
    }

    setIsContinuing(true);
    try {
      const result = await continueThread(agentId, runId, {
        prompt: followUpPrompt.trim(),
        attachments: toUploadAttachments(followUpAttachments),
      });
      setRun(result.run);
      setTurns(result.turns);
      setFollowUpPrompt('');
      setFollowUpAttachments([]);
      setError('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to continue thread';
      setError(msg);
    } finally {
      setIsContinuing(false);
    }
  };

  const handlePickAttachments = async () => {
    try {
      const nextAttachments = await pickImageAttachments(followUpAttachments.length);
      if (nextAttachments.length === 0) {
        return;
      }

      setFollowUpAttachments((current) => [...current, ...nextAttachments]);
      setError('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to pick images';
      setError(msg);
    }
  };

  const segments = groupIntoSegments(turns);

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
      {/* Compact header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.headerRepo} numberOfLines={1}>
            {run.repoPath.split('/').pop()}
          </Text>
          <Text style={styles.headerSep}>·</Text>
          <Text style={styles.headerTool}>
            {run.tool === 'codex' ? 'Codex' : 'Claude Code'}
          </Text>
          <View style={[styles.headerStatusBadge, { backgroundColor: statusColor(run.status) + '22' }]}>
            <View style={[styles.headerStatusDot, { backgroundColor: statusColor(run.status) }]} />
            <Text style={[styles.headerStatusText, { color: statusColor(run.status) }]}>
              {statusLabel(run.status)}
            </Text>
          </View>
        </View>
        {run.branch ? (
          <Text style={styles.headerBranch} numberOfLines={1}>{run.branch}</Text>
        ) : null}
      </View>

      {/* Chat conversation */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.chatArea}
        contentContainerStyle={styles.chatContent}>
        {segments.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>
              {isActive ? 'Waiting for response...' : 'No conversation recorded.'}
            </Text>
          </View>
        ) : (
          segments.map((segment) => {
            if (segment.type === 'user') {
              return (
                <View key={segment.id} style={styles.bubbleUser}>
                  <Text style={styles.bubbleRole}>You</Text>
                  {segment.text ? (
                    <Text style={styles.bubbleUserText}>{segment.text}</Text>
                  ) : null}
                  {segment.attachments.length > 0 ? (
                    <View style={styles.attachmentRow}>
                      {segment.attachments.map((a) => (
                        <AttachmentChip key={a.id} attachment={a} />
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            }

            if (segment.type === 'assistant') {
              return (
                <View key={segment.id} style={styles.bubbleAssistant}>
                  <Text style={styles.bubbleRoleAssistant}>Assistant</Text>
                  <View style={styles.bubbleContent}>
                    <MarkdownContent content={segment.text} compact />
                  </View>
                </View>
              );
            }

            if (segment.type === 'system') {
              return (
                <View key={segment.id} style={styles.systemLine}>
                  <Text style={styles.systemText}>{segment.text}</Text>
                </View>
              );
            }

            // tools segment
            return (
              <ToolsAccordion
                key={segment.id}
                items={segment.items}
                onOpenContent={handleOpenContent}
              />
            );
          })
        )}
      </ScrollView>

      {/* Composer / footer */}
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
            <View style={styles.composerCard}>
              {followUpAttachments.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.composerAttachmentRow}>
                  {followUpAttachments.map((attachment) => (
                    <View key={attachment.id} style={styles.composerAttachmentThumb}>
                      <Image source={{ uri: attachment.uri }} style={styles.composerAttachmentPreview} />
                      <TouchableOpacity
                        style={styles.composerAttachmentRemove}
                        onPress={() =>
                          setFollowUpAttachments((current) =>
                            current.filter((item) => item.id !== attachment.id),
                          )
                        }
                        activeOpacity={0.7}>
                        <Text style={styles.composerAttachmentRemoveText}>X</Text>
                      </TouchableOpacity>
                      <Text style={styles.composerAttachmentMeta}>
                        {formatAttachmentSize(attachment.sizeBytes)}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              ) : null}

              <View style={styles.composerInputRow}>
                <TouchableOpacity
                  style={[
                    styles.composerIconButton,
                    followUpAttachments.length >= 4 && styles.composerIconButtonDisabled,
                  ]}
                  accessibilityLabel="Add image"
                  disabled={followUpAttachments.length >= 4}
                  onPress={() => {
                    void handlePickAttachments();
                  }}
                  activeOpacity={0.7}>
                  <AddImageIcon />
                </TouchableOpacity>

                <TextInput
                  style={styles.followUpInput}
                  placeholder="Message this thread"
                  placeholderTextColor={colors.textSecondary}
                  value={followUpPrompt}
                  onChangeText={setFollowUpPrompt}
                  multiline
                  textAlignVertical="top"
                />

                <TouchableOpacity
                  style={[
                    styles.sendButton,
                    (isContinuing || (!followUpPrompt.trim() && followUpAttachments.length === 0)) &&
                      styles.sendButtonDisabled,
                  ]}
                  onPress={handleContinue}
                  disabled={isContinuing || (!followUpPrompt.trim() && followUpAttachments.length === 0)}
                  activeOpacity={0.7}>
                  {isContinuing ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text style={styles.sendButtonText}>Send</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
            {error ? <Text style={styles.errorTextInline}>{error}</Text> : null}
          </>
        ) : (
          <Text style={styles.footerHint}>
            Thread completed. Open the agent page for a full terminal.
          </Text>
        )}
      </View>
    </View>
  );
}

function ToolsAccordion({
  items,
  onOpenContent,
}: {
  items: RunTimelineEvent[];
  onOpenContent: (title: string, content: string, mono?: boolean) => void;
}): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);

  const first = items[0];
  const label = items.length === 1
    ? (first.type === 'command' ? 'Command' : first.type === 'activity' ? first.label : '1 item')
    : `${items.length} tool calls`;

  return (
    <View style={styles.toolsAccordion}>
      <TouchableOpacity
        style={styles.toolsAccordionHeader}
        onPress={() => setIsExpanded(!isExpanded)}
        activeOpacity={0.7}>
        <Text style={styles.toolsAccordionChevron}>
          {isExpanded ? '⌄' : '›'}
        </Text>
        <Text style={styles.toolsAccordionLabel}>{label}</Text>
      </TouchableOpacity>
      {isExpanded ? (
        <View style={styles.toolsAccordionBody}>
          {items.map((item) => (
            <TimelineItemView
              key={item.id}
              item={item}
              onOpenContent={onOpenContent}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function AttachmentChip({ attachment }: { attachment: RunImageAttachment }): React.JSX.Element {
  return (
    <View style={styles.attachmentChip}>
      <Text style={styles.attachmentChipName} numberOfLines={1}>
        {attachment.name}
      </Text>
      <Text style={styles.attachmentChipMeta}>
        {formatAttachmentSize(attachment.sizeBytes)}
      </Text>
    </View>
  );
}

function TimelineItemView({
  item,
  onOpenContent,
}: {
  item: RunTimelineEvent;
  onOpenContent: (title: string, content: string, mono?: boolean) => void;
}): React.JSX.Element {
  if (item.type === 'message') {
    return (
      <View style={styles.inlineMessage}>
        <Text style={styles.inlineMessageRole}>
          {item.role === 'assistant' ? 'Assistant' : item.role === 'user' ? 'User' : 'System'}
        </Text>
        <Text style={styles.inlineMessageText} numberOfLines={3}>
          {item.text}
        </Text>
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
            {item.status === 'started' ? 'Running' : 'Command'}
          </Text>
          {item.exitCode !== null ? (
            <Text style={styles.commandExit}>exit {item.exitCode}</Text>
          ) : null}
        </View>
        <Text style={styles.commandText}>{item.command}</Text>
        {item.output ? (
          <CommandOutputView
            output={item.output.trimEnd()}
            onOpen={() => onOpenContent('Command Output', item.output.trimEnd(), true)}
          />
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

function CommandOutputView({
  output,
  onOpen,
}: {
  output: string;
  onOpen: () => void;
}): React.JSX.Element {
  const isCollapsible = output.length > 200 || output.split('\n').length > 4;

  return (
    <TouchableOpacity
      style={styles.commandOutputBox}
      activeOpacity={isCollapsible ? 0.78 : 1}
      disabled={!isCollapsible}
      onPress={onOpen}>
      <View style={styles.commandOutputHeader}>
        <Text style={styles.commandOutputLabel}>Output</Text>
        {isCollapsible ? (
          <TouchableOpacity onPress={onOpen} activeOpacity={0.7}>
            <Text style={styles.commandOutputToggle}>Open full output</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={styles.commandOutputText} numberOfLines={isCollapsible ? 4 : undefined}>
        {output}
      </Text>
    </TouchableOpacity>
  );
}

function AddImageIcon(): React.JSX.Element {
  return (
    <View style={styles.addImageIcon}>
      <View style={styles.addImageIconFrame}>
        <View style={styles.addImageIconSun} />
        <View style={styles.addImageIconMountainLeft} />
        <View style={styles.addImageIconMountainRight} />
      </View>
      <View style={styles.addImageIconBadge}>
        <View style={styles.addImageIconPlusHorizontal} />
        <View style={styles.addImageIconPlusVertical} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Compact header
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerRepo: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  headerSep: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  headerTool: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  headerStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: 'auto',
  },
  headerStatusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 5,
  },
  headerStatusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  headerBranch: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: fonts.mono,
    marginTop: 3,
  },

  // Chat area
  chatArea: {
    flex: 1,
  },
  chatContent: {
    padding: 14,
    gap: 10,
  },
  emptyState: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  emptyTitle: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },

  // Chat bubbles
  bubbleUser: {
    backgroundColor: colors.surface,
    borderRadius: 4,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  bubbleRole: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  bubbleUserText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  bubbleAssistant: {
    backgroundColor: colors.surface,
    borderRadius: 4,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderLeftWidth: 3,
    borderLeftColor: colors.green,
  },
  bubbleRoleAssistant: {
    color: colors.green,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  bubbleContent: {
    // wrapper for markdown
  },

  // System line
  systemLine: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  systemText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontStyle: 'italic',
  },

  // Tools accordion
  toolsAccordion: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    overflow: 'hidden',
  },
  toolsAccordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  toolsAccordionChevron: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    width: 12,
    textAlign: 'center',
  },
  toolsAccordionLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  toolsAccordionBody: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 8,
  },

  // Inline items (inside tools accordion)
  inlineMessage: {
    paddingVertical: 4,
  },
  inlineMessageRole: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inlineMessageText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },

  // Attachment
  attachmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  attachmentChip: {
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  attachmentChipName: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  attachmentChipMeta: {
    color: colors.textSecondary,
    fontSize: 10,
    marginTop: 2,
  },

  // Command card
  commandCard: {
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  commandHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  commandEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  commandExit: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: fonts.mono,
  },
  commandText: {
    color: colors.text,
    fontSize: 12,
    fontFamily: fonts.mono,
    lineHeight: 18,
    marginTop: 6,
  },
  commandOutputBox: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
  },
  commandOutputHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  commandOutputLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  commandOutputToggle: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '600',
  },
  commandOutputText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: fonts.mono,
    lineHeight: 16,
  },

  activityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 3,
  },
  activityDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginTop: 5,
    marginRight: 8,
  },
  activityTextArea: {
    flex: 1,
  },
  activityLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  activityDetail: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
    fontFamily: fonts.mono,
  },

  // Footer / composer
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
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    backgroundColor: colors.surfaceLight,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
  },
  composerCard: {
    backgroundColor: colors.background,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  composerAttachmentRow: {
    gap: 10,
    paddingBottom: 10,
    paddingRight: 2,
  },
  composerAttachmentThumb: {
    width: 72,
    alignItems: 'center',
  },
  composerAttachmentPreview: {
    width: 72,
    height: 72,
    borderRadius: 14,
    backgroundColor: colors.surfaceLight,
  },
  composerAttachmentRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#00000099',
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerAttachmentRemoveText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  composerAttachmentMeta: {
    marginTop: 6,
    color: colors.textSecondary,
    fontSize: 11,
  },
  composerInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  composerIconButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerIconButtonDisabled: {
    opacity: 0.45,
  },
  addImageIcon: {
    width: 20,
    height: 20,
  },
  addImageIconFrame: {
    width: 16,
    height: 14,
    borderRadius: 4,
    borderWidth: 1.4,
    borderColor: colors.accent,
    position: 'absolute',
    left: 1,
    top: 3,
  },
  addImageIconSun: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.accent,
    position: 'absolute',
    top: 2,
    right: 2,
  },
  addImageIconMountainLeft: {
    position: 'absolute',
    left: 2,
    bottom: 2,
    width: 7,
    height: 2,
    backgroundColor: colors.accent,
    borderRadius: 999,
    transform: [{ rotate: '-35deg' }],
  },
  addImageIconMountainRight: {
    position: 'absolute',
    left: 6,
    bottom: 3,
    width: 6,
    height: 2,
    backgroundColor: colors.accent,
    borderRadius: 999,
    transform: [{ rotate: '36deg' }],
  },
  addImageIconBadge: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addImageIconPlusHorizontal: {
    position: 'absolute',
    width: 5,
    height: 1.4,
    borderRadius: 999,
    backgroundColor: colors.background,
  },
  addImageIconPlusVertical: {
    position: 'absolute',
    width: 1.4,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.background,
  },
  sendButton: {
    height: 42,
    minWidth: 68,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
  sendButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
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
