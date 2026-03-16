import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import MarkdownContent from '../components/MarkdownContent';
import type { RootStackParamList } from '../navigation';
import { colors, commonStyles, fonts } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ThreadContent'>;

export default function ThreadContentScreen({ route }: Props): React.JSX.Element {
  const { content, mono = false } = route.params;

  return (
    <View style={commonStyles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          {mono ? (
            <Text selectable style={[styles.body, styles.bodyMono]}>
              {content}
            </Text>
          ) : (
            <MarkdownContent content={content} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  body: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  bodyMono: {
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 20,
  },
});
