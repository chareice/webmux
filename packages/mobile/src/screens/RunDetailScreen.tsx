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
import { colors, commonStyles, fonts, statusColor, statusLabel, toolIcon } from '../theme';
import type { RootStackParamList } from '../navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isRunTimelineEvent, isRunTurn } from '../run-detail-response';
import { appendTurnItem, canContinueRun, isRunActive, latestRunTurn, upsertRunTurn } from '../run-thread';
import {
  formatAttachmentSize,
  pickImageAttachments,
  toUploadAttachments,
} from '../image-attachments';
import { normalizePreviewText, shouldForcePreviewText } from '../thread-detail-preview';

type Props = NativeStackScreenProps<RootStackParamList, 'ThreadDetail'>;

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

        {run.summary ? (
          <>
            <Text style={styles.summaryLabel}>Latest Summary</Text>
            <PreviewableMarkdownCard
              style={styles.summaryCard}
              content={run.summary}
              lineLimit={4}
              charLimit={200}
              openLabel="Open full summary"
              previewTextStyle={styles.summaryText}
              measureTextStyle={styles.summaryMeasureText}
              onOpenContent={() => handleOpenContent('Latest Summary', run.summary ?? '')}
            />
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
          turns.map((turn) => (
            <TurnSectionView key={turn.id} turn={turn} onOpenContent={handleOpenContent} />
          ))
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
            Need a full terminal? Open it from the agent page. Thread detail is a structured thread view.
          </Text>
        )}
      </View>
    </View>
  );
}

function TurnSectionView({
  turn,
  onOpenContent,
}: {
  turn: RunTurnDetail;
  onOpenContent: (title: string, content: string, mono?: boolean) => void;
}): React.JSX.Element {
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
        {turn.prompt ? (
          <PreviewableMarkdownCard
            style={styles.messageContent}
            content={turn.prompt}
            lineLimit={6}
            charLimit={280}
            openLabel="Open full prompt"
            previewTextStyle={styles.messagePreviewText}
            measureTextStyle={styles.messageMeasureText}
            onOpenContent={() => onOpenContent(`Turn ${turn.index} Prompt`, turn.prompt)}
          />
        ) : (
          <Text style={styles.messagePlaceholder}>Sent image attachment</Text>
        )}
        {turn.attachments.length > 0 ? (
          <View style={styles.turnAttachmentList}>
            {turn.attachments.map((attachment) => (
              <AttachmentChip key={attachment.id} attachment={attachment} />
            ))}
          </View>
        ) : null}
      </View>

      {turn.items.length === 0 ? (
        <View style={styles.turnEmptyState}>
          <Text style={styles.turnEmptyText}>Waiting for events...</Text>
        </View>
      ) : (
        turn.items.map((item) => (
          <TimelineItemView
            key={`${turn.id}-${item.id}`}
            item={item}
            onOpenContent={onOpenContent}
          />
        ))
      )}
    </View>
  );
}

function AttachmentChip({ attachment }: { attachment: RunImageAttachment }): React.JSX.Element {
  return (
    <View style={styles.attachmentChip}>
      <Text style={styles.attachmentChipTitle} numberOfLines={1}>
        Image
      </Text>
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
      <View style={styles.messageCard}>
        <Text style={styles.messageEyebrow}>
          {item.role === 'assistant' ? 'Assistant' : item.role === 'user' ? 'User' : 'System'}
        </Text>
        <PreviewableMarkdownCard
          style={styles.messageContent}
          content={item.text}
          lineLimit={7}
          charLimit={320}
          openLabel="Open full message"
          previewTextStyle={styles.messagePreviewText}
          measureTextStyle={styles.messageMeasureText}
          onOpenContent={() => onOpenContent('Message', item.text)}
        />
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

function PreviewableMarkdownCard({
  content,
  lineLimit,
  charLimit,
  openLabel,
  previewTextStyle,
  measureTextStyle,
  style,
  onOpenContent,
}: {
  content: string;
  lineLimit: number;
  charLimit: number;
  openLabel: string;
  previewTextStyle: object;
  measureTextStyle: object;
  style?: object;
  onOpenContent: () => void;
}): React.JSX.Element {
  const previewText = normalizePreviewText(content);
  const [needsPreview, setNeedsPreview] = useState(
    shouldForcePreviewText(previewText, { charLimit, lineLimit }),
  );

  return (
    <TouchableOpacity
      style={style}
      activeOpacity={needsPreview ? 0.78 : 1}
      disabled={!needsPreview}
      onPress={onOpenContent}>
      <Text
        style={measureTextStyle}
        onTextLayout={(event) => {
          const nextNeedsPreview = event.nativeEvent.lines.length > lineLimit;
          setNeedsPreview((current) => (current === nextNeedsPreview ? current : nextNeedsPreview));
        }}>
        {previewText}
      </Text>
      {needsPreview ? (
        <>
          <Text style={previewTextStyle} numberOfLines={lineLimit}>
            {previewText}
          </Text>
          <TouchableOpacity
            style={styles.previewToggle}
            onPress={onOpenContent}
            activeOpacity={0.7}>
            <Text style={styles.previewToggleText}>{openLabel}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <MarkdownContent content={content} compact />
      )}
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
  },
  summaryMeasureText: {
    position: 'absolute',
    opacity: 0,
    zIndex: -1,
    left: 12,
    right: 12,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  summaryCard: {
    marginTop: 6,
    backgroundColor: colors.surfaceLight,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
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
  messageContent: {
    marginTop: 8,
  },
  messagePreviewText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
  },
  messageMeasureText: {
    position: 'absolute',
    opacity: 0,
    zIndex: -1,
    left: 0,
    right: 0,
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
  },
  messagePlaceholder: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    fontStyle: 'italic',
  },
  turnAttachmentList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  attachmentChip: {
    minWidth: 110,
    backgroundColor: colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  attachmentChipTitle: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  attachmentChipName: {
    marginTop: 4,
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  attachmentChipMeta: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 11,
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
  commandOutputHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  commandOutputLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  commandOutputToggle: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  commandOutputText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: fonts.mono,
    lineHeight: 18,
  },
  previewToggle: {
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  previewToggleText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
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
