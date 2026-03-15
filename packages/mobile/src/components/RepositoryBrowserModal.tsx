import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { RepositoryEntry } from '../types';
import { colors, fonts } from '../theme';

interface RepositoryBrowserModalProps {
  visible: boolean;
  currentPath: string | null;
  parentPath: string | null;
  entries: RepositoryEntry[];
  isLoading: boolean;
  error: string;
  onClose: () => void;
  onOpenPath: (path?: string) => void;
  onSelectRepository: (path: string) => void;
}

export default function RepositoryBrowserModal({
  visible,
  currentPath,
  parentPath,
  entries,
  isLoading,
  error,
  onClose,
  onOpenPath,
  onSelectRepository,
}: RepositoryBrowserModalProps): React.JSX.Element {
  const renderEntry = ({ item }: { item: RepositoryEntry }) => (
    <Pressable
      style={styles.entryRow}
      onPress={() => {
        if (item.kind === 'repository') {
          onSelectRepository(item.path);
          return;
        }
        onOpenPath(item.path);
      }}>
      <View
        style={[
          styles.entryIcon,
          item.kind === 'repository'
            ? styles.repositoryIcon
            : styles.directoryIcon,
        ]}>
        <Text
          style={[
            styles.entryIconText,
            item.kind === 'repository'
              ? styles.repositoryIconText
              : styles.directoryIconText,
          ]}>
          {item.kind === 'repository' ? 'G' : 'D'}
        </Text>
      </View>
      <View style={styles.entryTextArea}>
        <Text style={styles.entryName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.entryMeta}>
          {item.kind === 'repository' ? 'Git repository' : 'Folder'}
        </Text>
      </View>
      <View style={styles.entryAction}>
        <Text
          style={[
            styles.entryActionText,
            item.kind === 'repository'
              ? styles.repositoryActionText
              : styles.directoryActionText,
          ]}>
          {item.kind === 'repository' ? 'Select' : 'Open'}
        </Text>
        <Text style={styles.entryChevron}>›</Text>
      </View>
    </Pressable>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>Choose Repository</Text>
            <Text style={styles.subtitle} numberOfLines={2}>
              {currentPath ?? 'Loading...'}
            </Text>
          </View>
          <Pressable onPress={onClose}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>

        {parentPath ? (
          <Pressable style={styles.upButton} onPress={() => onOpenPath(parentPath)}>
            <Text style={styles.upButtonArrow}>←</Text>
            <View style={styles.upButtonTextArea}>
              <Text style={styles.upButtonText}>Up one level</Text>
              <Text style={styles.upButtonMeta} numberOfLines={1}>
                {parentPath}
              </Text>
            </View>
          </Pressable>
        ) : null}

        {error ? (
          <View style={styles.stateContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.stateContainer}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : (
          <FlatList
            data={entries}
            keyExtractor={(item) => item.path}
            renderItem={renderEntry}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <View style={styles.stateContainer}>
                <Text style={styles.emptyText}>No folders found here</Text>
                <Text style={styles.emptyHint}>
                  Move up a level or choose another agent.
                </Text>
              </View>
            }
          />
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Only Git repositories can be selected.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerText: {
    flex: 1,
    marginRight: 16,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 8,
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: fonts.mono,
  },
  closeText: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: '600',
  },
  upButton: {
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: colors.surface,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  upButtonArrow: {
    color: colors.accent,
    fontSize: 18,
    fontWeight: '700',
    marginRight: 12,
  },
  upButtonTextArea: {
    flex: 1,
  },
  upButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  upButtonMeta: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: fonts.mono,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 120,
  },
  separator: {
    height: 10,
  },
  entryRow: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  entryIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  directoryIcon: {
    backgroundColor: `${colors.accent}22`,
  },
  repositoryIcon: {
    backgroundColor: `${colors.green}22`,
  },
  entryIconText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  repositoryIconText: {
    color: colors.green,
  },
  directoryIconText: {
    color: colors.accent,
  },
  entryTextArea: {
    flex: 1,
  },
  entryName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  entryMeta: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 12,
  },
  entryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
    gap: 6,
  },
  entryActionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  repositoryActionText: {
    color: colors.green,
  },
  directoryActionText: {
    color: colors.accent,
  },
  entryChevron: {
    color: colors.textSecondary,
    fontSize: 18,
    lineHeight: 18,
  },
  stateContainer: {
    paddingHorizontal: 24,
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  emptyHint: {
    marginTop: 8,
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
  errorText: {
    color: colors.red,
    fontSize: 14,
    textAlign: 'center',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  footerText: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
});
