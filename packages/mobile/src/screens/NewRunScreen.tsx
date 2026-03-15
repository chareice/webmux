import React, { useCallback, useEffect, useState } from 'react';
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
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { listAgents, startRun } from '../api';
import { AgentInfo, RunTool } from '../types';
import { colors, commonStyles } from '../theme';
import type { RootStackParamList } from '../navigation';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const TOOLS: { value: RunTool; label: string; description: string }[] = [
  { value: 'claude', label: 'Claude Code', description: 'Anthropic Claude Code CLI' },
  { value: 'codex', label: 'Codex', description: 'OpenAI Codex CLI' },
];

export default function NewRunScreen(): React.JSX.Element {
  const navigation = useNavigation<NavigationProp>();

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [selectedTool, setSelectedTool] = useState<RunTool>('claude');
  const [repoPath, setRepoPath] = useState('');
  const [prompt, setPrompt] = useState('');
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fetchAgents = useCallback(async () => {
    try {
      setIsLoadingAgents(true);
      const response = await listAgents();
      const onlineAgents = response.agents.filter(a => a.status === 'online');
      setAgents(onlineAgents);
      if (onlineAgents.length > 0 && !selectedAgent) {
        setSelectedAgent(onlineAgents[0].id);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load agents';
      setError(msg);
    } finally {
      setIsLoadingAgents(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const handleSubmit = async () => {
    Keyboard.dismiss();
    setError('');

    if (!selectedAgent) {
      setError('Please select an agent');
      return;
    }

    if (!repoPath.trim()) {
      setError('Please enter a repository path');
      return;
    }

    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    setIsSubmitting(true);
    try {
      const run = await startRun(selectedAgent, {
        tool: selectedTool,
        repoPath: repoPath.trim(),
        prompt: prompt.trim(),
      });

      navigation.replace('RunDetail', {
        agentId: run.agentId,
        runId: run.id,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to start run';
      setError(msg);
    } finally {
      setIsSubmitting(false);
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
    <ScrollView
      style={commonStyles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      {/* Agent selector */}
      <Text style={styles.label}>Agent</Text>
      {agents.length === 0 ? (
        <Text style={styles.noAgents}>No agents online</Text>
      ) : (
        <View style={styles.optionsRow}>
          {agents.map(agent => (
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

      {/* Tool selector */}
      <Text style={styles.label}>Tool</Text>
      <View style={styles.optionsRow}>
        {TOOLS.map(tool => (
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

      {/* Repo path */}
      <Text style={styles.label}>Repository Path</Text>
      <TextInput
        style={commonStyles.input}
        placeholder="/home/user/project"
        placeholderTextColor={colors.textSecondary}
        value={repoPath}
        onChangeText={setRepoPath}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {/* Prompt */}
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

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* Submit */}
      <TouchableOpacity
        style={[
          commonStyles.button,
          styles.submitButton,
          (isSubmitting || !selectedAgent) && styles.buttonDisabled,
        ]}
        onPress={handleSubmit}
        disabled={isSubmitting || !selectedAgent}
        activeOpacity={0.7}>
        {isSubmitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={commonStyles.buttonText}>Start Run</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
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
    borderColor: colors.accent,
    backgroundColor: colors.accent + '18',
  },
  optionChipText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  optionChipTextSelected: {
    color: colors.accent,
  },
  noAgents: {
    color: colors.red,
    fontSize: 14,
    marginBottom: 8,
  },
  toolCard: {
    flex: 1,
    minWidth: 140,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  toolCardSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accent + '18',
  },
  toolCardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  toolCardTitleSelected: {
    color: colors.accent,
  },
  toolCardDesc: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  promptInput: {
    minHeight: 120,
    paddingTop: 12,
  },
  submitButton: {
    marginTop: 20,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  error: {
    color: colors.red,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
});
