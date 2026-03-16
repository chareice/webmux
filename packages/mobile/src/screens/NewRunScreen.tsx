import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute } from '@react-navigation/native';

import {
  browseAgentRepositories,
  listAgents,
  listThreads,
  startThread,
} from '../api';
import RepositoryBrowserModal from '../components/RepositoryBrowserModal';
import type { RootStackParamList } from '../navigation';
import {
  AgentInfo,
  DraftImageAttachment,
  RepositoryBrowseResponse,
  Run,
  RunTool,
} from '../types';
import {
  formatAttachmentSize,
  pickImageAttachments,
  toUploadAttachments,
} from '../image-attachments';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, commonStyles, fonts } from '../theme';

const FAVORITES_KEY = 'webmux:favorite-repos';

async function getFavoriteRepos(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

async function toggleFavoriteRepo(path: string): Promise<string[]> {
  const current = await getFavoriteRepos();
  const next = current.includes(path)
    ? current.filter((p) => p !== path)
    : [...current, path];
  await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  return next;
}

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type NewRunRouteProp = RouteProp<RootStackParamList, 'NewThread'>;

const TOOLS: { value: RunTool; label: string; description: string }[] = [
  { value: 'claude', label: 'Claude Code', description: 'Anthropic Claude Code CLI' },
  { value: 'codex', label: 'Codex', description: 'OpenAI Codex CLI' },
];

function extractRecentRepositories(runs: Run[]): string[] {
  const seen = new Set<string>();

  return [...runs]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((run) => run.repoPath)
    .filter((repoPath) => {
      if (!repoPath || seen.has(repoPath)) {
        return false;
      }
      seen.add(repoPath);
      return true;
    })
    .slice(0, 8);
}

function repositoryName(repoPath: string): string {
  const parts = repoPath.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? repoPath;
}

export default function NewRunScreen(): React.JSX.Element {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<NewRunRouteProp>();
  const preferredAgentId = route.params?.agentId;

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [selectedTool, setSelectedTool] = useState<RunTool>('claude');
  const [repoPath, setRepoPath] = useState('');
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<DraftImageAttachment[]>([]);
  const [recentRepos, setRecentRepos] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [repositoryBrowser, setRepositoryBrowser] = useState<RepositoryBrowseResponse | null>(null);
  const [isRepositoryModalVisible, setIsRepositoryModalVisible] = useState(false);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const [isLoadingRepositories, setIsLoadingRepositories] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [repositoryError, setRepositoryError] = useState('');
  const previousAgentRef = useRef('');

  const fetchAgents = useCallback(async () => {
    try {
      setIsLoadingAgents(true);
      const response = await listAgents();
      const onlineAgents = response.agents.filter((agent) => agent.status === 'online');
      setAgents(onlineAgents);
      setSelectedAgent((currentAgent) => {
        if (preferredAgentId && onlineAgents.some((agent) => agent.id === preferredAgentId)) {
          return preferredAgentId;
        }
        if (currentAgent && onlineAgents.some((agent) => agent.id === currentAgent)) {
          return currentAgent;
        }
        return onlineAgents[0]?.id ?? '';
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load agents';
      setError(msg);
    } finally {
      setIsLoadingAgents(false);
    }
  }, [preferredAgentId]);

  const loadRepositoryBrowser = useCallback(
    async (agentId: string, repositoryPath?: string) => {
      setIsLoadingRepositories(true);
      setRepositoryError('');

      try {
        const result = await browseAgentRepositories(agentId, repositoryPath);
        setRepositoryBrowser(result);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to browse repositories';
        setRepositoryError(msg);
      } finally {
        setIsLoadingRepositories(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchAgents();
    void getFavoriteRepos().then(setFavorites);
  }, [fetchAgents]);

  const handleToggleFavorite = useCallback(async (path: string) => {
    const next = await toggleFavoriteRepo(path);
    setFavorites(next);
  }, []);

  useEffect(() => {
    if (!preferredAgentId || agents.length === 0) {
      return;
    }

    if (agents.some((agent) => agent.id === preferredAgentId)) {
      setSelectedAgent(preferredAgentId);
    }
  }, [agents, preferredAgentId]);

  useEffect(() => {
    if (!selectedAgent) {
      setRecentRepos([]);
      setRepositoryBrowser(null);
      setRepositoryError('');
      return;
    }

    const agentChanged =
      previousAgentRef.current !== '' && previousAgentRef.current !== selectedAgent;
    previousAgentRef.current = selectedAgent;

    if (agentChanged) {
      setRepoPath('');
      setRepositoryBrowser(null);
    }

    let isCancelled = false;
    setIsLoadingRepositories(true);
    setRepositoryError('');

    void Promise.allSettled([
      listThreads(selectedAgent),
      browseAgentRepositories(selectedAgent),
    ]).then((results) => {
      if (isCancelled) {
        return;
      }

      const [runsResult, browseResult] = results;
      if (runsResult.status === 'fulfilled') {
        setRecentRepos(extractRecentRepositories(runsResult.value));
      } else {
        setRecentRepos([]);
      }

      if (browseResult.status === 'fulfilled') {
        setRepositoryBrowser(browseResult.value);
      } else {
        const msg =
          browseResult.reason instanceof Error
            ? browseResult.reason.message
            : 'Failed to browse repositories';
        setRepositoryBrowser(null);
        setRepositoryError(msg);
      }

      setIsLoadingRepositories(false);
    });

    return () => {
      isCancelled = true;
    };
  }, [selectedAgent]);

  const selectedAgentInfo = useMemo(
    () => agents.find((agent) => agent.id === selectedAgent) ?? null,
    [agents, selectedAgent],
  );

  const handleSubmit = async () => {
    Keyboard.dismiss();
    setError('');

    if (!selectedAgent) {
      setError('Please select an agent');
      return;
    }

    if (!repoPath.trim()) {
      setError('Please choose a repository');
      return;
    }

    if (!prompt.trim() && attachments.length === 0) {
      setError('Please enter a prompt or attach an image');
      return;
    }

    setIsSubmitting(true);
    try {
      const run = await startThread(selectedAgent, {
        tool: selectedTool,
        repoPath: repoPath.trim(),
        prompt: prompt.trim(),
        attachments: toUploadAttachments(attachments),
      });

      navigation.replace('ThreadDetail', {
        agentId: run.agentId,
        runId: run.id,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to start thread';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePickAttachments = async () => {
    try {
      const nextAttachments = await pickImageAttachments(attachments.length);
      if (nextAttachments.length === 0) {
        return;
      }

      setAttachments((current) => [...current, ...nextAttachments]);
      setError('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to pick images';
      setError(msg);
    }
  };

  if (isLoadingAgents) {
    return (
      <View style={[commonStyles.screen, styles.center]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={commonStyles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Agent</Text>
        {agents.length === 0 ? (
          <View style={styles.emptyStateCard}>
            <Text style={styles.noAgents}>No agents online right now</Text>
            <TouchableOpacity
              style={styles.secondaryButton}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('Agents')}>
              <Text style={styles.secondaryButtonText}>View agents</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.optionsRow}>
            {agents.map((agent) => (
              <TouchableOpacity
                key={agent.id}
                style={[
                  styles.optionChip,
                  selectedAgent === agent.id && styles.optionChipSelected,
                ]}
                onPress={() => setSelectedAgent(agent.id)}
                activeOpacity={0.7}>
                <Text
                  style={[
                    styles.optionChipText,
                    selectedAgent === agent.id && styles.optionChipTextSelected,
                  ]}>
                  {agent.name || agent.id}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text style={styles.label}>Tool</Text>
        <View style={styles.optionsRow}>
          {TOOLS.map((tool) => (
            <TouchableOpacity
              key={tool.value}
              style={[
                styles.toolCard,
                selectedTool === tool.value && styles.toolCardSelected,
              ]}
              onPress={() => setSelectedTool(tool.value)}
              activeOpacity={0.7}>
              <Text
                style={[
                  styles.toolCardTitle,
                  selectedTool === tool.value && styles.toolCardTitleSelected,
                ]}>
                {tool.label}
              </Text>
              <Text style={styles.toolCardDesc}>{tool.description}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Repository</Text>
        <TouchableOpacity
          style={styles.repositoryCard}
          activeOpacity={0.7}
          disabled={!selectedAgent}
          onPress={() => {
            if (!selectedAgent) {
              return;
            }
            setIsRepositoryModalVisible(true);
            if (!repositoryBrowser && !isLoadingRepositories) {
              void loadRepositoryBrowser(selectedAgent);
            }
          }}>
          <Text style={styles.repositoryCardTitle}>
            {repoPath ? repositoryName(repoPath) : 'Choose a repository'}
          </Text>
          <Text style={styles.repositoryCardPath} numberOfLines={2}>
            {repoPath ||
              (selectedAgentInfo
                ? `Browse folders on ${selectedAgentInfo.name || selectedAgentInfo.id}`
                : 'Select an agent first')}
          </Text>
        </TouchableOpacity>

        {isLoadingRepositories && !repositoryBrowser ? (
          <View style={styles.repositoryState}>
            <ActivityIndicator size="small" color={colors.accent} />
          </View>
        ) : null}

        {favorites.length > 0 ? (
          <>
            <Text style={styles.helperLabel}>Favorites</Text>
            <View style={styles.optionsRow}>
              {favorites.map((fav) => (
                <TouchableOpacity
                  key={fav}
                  style={[
                    styles.repoChip,
                    repoPath === fav && styles.repoChipSelected,
                  ]}
                  activeOpacity={0.7}
                  onPress={() => setRepoPath(fav)}>
                  <View style={styles.repoChipHeader}>
                    <Text
                      style={[
                        styles.repoChipTitle,
                        repoPath === fav && styles.repoChipTitleSelected,
                      ]}>
                      {repositoryName(fav)}
                    </Text>
                    <TouchableOpacity
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => void handleToggleFavorite(fav)}
                      activeOpacity={0.7}>
                      <Text style={styles.starFilled}>★</Text>
                    </TouchableOpacity>
                  </View>
                  <Text
                    style={[
                      styles.repoChipPath,
                      repoPath === fav && styles.repoChipPathSelected,
                    ]}
                    numberOfLines={1}>
                    {fav}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}

        {recentRepos.filter((r) => !favorites.includes(r)).length > 0 ? (
          <>
            <Text style={styles.helperLabel}>Recent repositories</Text>
            <View style={styles.optionsRow}>
              {recentRepos.filter((r) => !favorites.includes(r)).map((recentRepo) => (
                <TouchableOpacity
                  key={recentRepo}
                  style={[
                    styles.repoChip,
                    repoPath === recentRepo && styles.repoChipSelected,
                  ]}
                  activeOpacity={0.7}
                  onPress={() => setRepoPath(recentRepo)}>
                  <View style={styles.repoChipHeader}>
                    <Text
                      style={[
                        styles.repoChipTitle,
                        repoPath === recentRepo && styles.repoChipTitleSelected,
                      ]}>
                      {repositoryName(recentRepo)}
                    </Text>
                    <TouchableOpacity
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => void handleToggleFavorite(recentRepo)}
                      activeOpacity={0.7}>
                      <Text style={styles.starEmpty}>☆</Text>
                    </TouchableOpacity>
                  </View>
                  <Text
                    style={[
                      styles.repoChipPath,
                      repoPath === recentRepo && styles.repoChipPathSelected,
                    ]}
                    numberOfLines={1}>
                    {recentRepo}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : selectedAgent && favorites.length === 0 ? (
          <Text style={styles.helperText}>
            No recent repositories yet. Use the picker above to browse folders on this agent.
          </Text>
        ) : null}

        {repositoryError ? <Text style={styles.error}>{repositoryError}</Text> : null}

        <Text style={styles.label}>Prompt</Text>
        <TextInput
          style={[commonStyles.input, styles.promptInput]}
          placeholder="What would you like the AI to do?"
          placeholderTextColor={colors.textSecondary}
          value={prompt}
          onChangeText={setPrompt}
          multiline
          numberOfLines={6}
          textAlignVertical="top"
        />

        <View style={styles.attachmentHeader}>
          <Text style={styles.helperLabel}>Images</Text>
          <TouchableOpacity
            style={[
              styles.attachButton,
              attachments.length >= 4 && styles.attachButtonDisabled,
            ]}
            activeOpacity={0.7}
            disabled={attachments.length >= 4}
            onPress={() => {
              void handlePickAttachments();
            }}>
            <Text style={styles.attachButtonText}>
              {attachments.length >= 4 ? 'Limit reached' : 'Add Images'}
            </Text>
          </TouchableOpacity>
        </View>

        {attachments.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.attachmentList}>
            {attachments.map((attachment) => (
              <View key={attachment.id} style={styles.attachmentCard}>
                <Image source={{ uri: attachment.uri }} style={styles.attachmentPreview} />
                <Text style={styles.attachmentName} numberOfLines={1}>
                  {attachment.name}
                </Text>
                <Text style={styles.attachmentMeta}>{formatAttachmentSize(attachment.sizeBytes)}</Text>
                <TouchableOpacity
                  style={styles.attachmentRemove}
                  onPress={() =>
                    setAttachments((current) =>
                      current.filter((item) => item.id !== attachment.id),
                    )
                  }
                  activeOpacity={0.7}>
                  <Text style={styles.attachmentRemoveText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[
            commonStyles.button,
            styles.submitButton,
            (isSubmitting || !selectedAgent || !repoPath.trim() || (!prompt.trim() && attachments.length === 0)) &&
              styles.buttonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={isSubmitting || !selectedAgent || !repoPath.trim() || (!prompt.trim() && attachments.length === 0)}
          activeOpacity={0.7}>
          {isSubmitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={commonStyles.buttonText}>Start Thread</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      <RepositoryBrowserModal
        visible={isRepositoryModalVisible}
        currentPath={repositoryBrowser?.currentPath ?? null}
        parentPath={repositoryBrowser?.parentPath ?? null}
        entries={repositoryBrowser?.entries ?? []}
        isLoading={isLoadingRepositories}
        error={repositoryError}
        onClose={() => setIsRepositoryModalVisible(false)}
        onOpenPath={(repositoryPath) => {
          if (!selectedAgent) {
            return;
          }
          void loadRepositoryBrowser(selectedAgent, repositoryPath);
        }}
        onSelectRepository={(repositoryPath) => {
          setRepoPath(repositoryPath);
          setIsRepositoryModalVisible(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
    gap: 8,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
    marginTop: 12,
    marginBottom: 4,
  },
  helperLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 10,
  },
  helperText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  optionChipSelected: {
    backgroundColor: `${colors.accent}22`,
    borderColor: colors.accent,
  },
  optionChipText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  optionChipTextSelected: {
    color: colors.accent,
  },
  toolCard: {
    flex: 1,
    minWidth: '47%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  toolCardSelected: {
    borderColor: colors.accent,
    backgroundColor: `${colors.accent}14`,
  },
  toolCardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  toolCardTitleSelected: {
    color: colors.accent,
  },
  toolCardDesc: {
    marginTop: 6,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  repositoryCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  repositoryCardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  repositoryCardPath: {
    marginTop: 6,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.mono,
  },
  repositoryState: {
    paddingVertical: 8,
  },
  repoChip: {
    minWidth: '47%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  repoChipSelected: {
    borderColor: colors.green,
    backgroundColor: `${colors.green}16`,
  },
  repoChipTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  repoChipTitleSelected: {
    color: colors.green,
  },
  repoChipHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  starFilled: {
    color: '#f5a623',
    fontSize: 16,
  },
  starEmpty: {
    color: colors.textSecondary,
    fontSize: 16,
  },
  repoChipPath: {
    marginTop: 6,
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: fonts.mono,
  },
  repoChipPathSelected: {
    color: colors.text,
  },
  promptInput: {
    minHeight: 140,
  },
  attachmentHeader: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  attachButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: `${colors.accent}20`,
    borderWidth: 1,
    borderColor: `${colors.accent}55`,
  },
  attachButtonDisabled: {
    opacity: 0.5,
  },
  attachButtonText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  attachmentList: {
    gap: 10,
    paddingVertical: 6,
  },
  attachmentCard: {
    width: 132,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
  },
  attachmentPreview: {
    width: '100%',
    height: 88,
    borderRadius: 10,
    backgroundColor: colors.surfaceLight,
  },
  attachmentName: {
    marginTop: 10,
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  attachmentMeta: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 12,
  },
  attachmentRemove: {
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  attachmentRemoveText: {
    color: colors.red,
    fontSize: 12,
    fontWeight: '600',
  },
  error: {
    color: colors.red,
    fontSize: 14,
    lineHeight: 20,
  },
  submitButton: {
    marginTop: 12,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  emptyStateCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  noAgents: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceLight,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
});
