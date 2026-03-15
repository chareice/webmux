import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import type { RepositoryEntry } from '../types';
import { colors, commonStyles, fonts } from '../theme';

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
    <TouchableOpacity
      style={styles.entryCard}
      activeOpacity={0.7}
      onPress={() => {
        if (item.kind === 'repository') {
          onSelectRepository(item.path);
          return;
        }
        onOpenPath(item.path);
      }}>
      <View style={styles.entryHeader}>
        <View
          style={[
            styles.kindBadge,
            item.kind === 'repository'
              ? styles.repositoryBadge
              : styles.directoryBadge,
          ]}>
          <Text
            style={[
              styles.kindBadgeText,
              item.kind === 'repository'
                ? styles.repositoryBadgeText
                : styles.directoryBadgeText,
            ]}>
            {item.kind === 'repository' ? 'REPO' : 'DIR'}
          </Text>
        </View>
        <View style={styles.entryTextArea}>
          <Text style={styles.entryName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.entryPath} numberOfLines={1}>
            {item.path}
          </Text>
        </View>
      </View>
      <Text style={styles.entryHint}>
        {item.kind === 'repository' ? 'Tap to select this repository' : 'Tap to open this folder'}
      </Text>
    </TouchableOpacity>
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
          <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>

        {parentPath ? (
          <TouchableOpacity
            style={styles.upButton}
            activeOpacity={0.7}
            onPress={() => onOpenPath(parentPath)}>
            <Text style={styles.upButtonText}>Up one level</Text>
          </TouchableOpacity>
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
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  upButtonText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
  },
  listContent: {
    padding: 20,
    gap: 12,
    paddingBottom: 120,
  },
  entryCard: {
    ...commonStyles.card,
    marginHorizontal: 0,
    marginVertical: 0,
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  kindBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 12,
  },
  repositoryBadge: {
    backgroundColor: `${colors.green}22`,
  },
  directoryBadge: {
    backgroundColor: `${colors.accent}22`,
  },
  kindBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  repositoryBadgeText: {
    color: colors.green,
  },
  directoryBadgeText: {
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
  entryPath: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: fonts.mono,
  },
  entryHint: {
    marginTop: 12,
    color: colors.textSecondary,
    fontSize: 13,
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
