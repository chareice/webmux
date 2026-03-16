import React, { useMemo } from 'react';
import { Linking, StyleSheet, Text } from 'react-native';
import Markdown, { MarkdownIt, RenderRules } from 'react-native-markdown-display';

import { colors, fonts } from '../theme';

const markdownIt = MarkdownIt({
  typographer: true,
  breaks: true,
});

const selectableRules: RenderRules = {
  textgroup: (node, children, _parent, styles) => (
    <Text key={node.key} style={styles.textgroup} selectable>
      {children}
    </Text>
  ),
  text: (node, _children, _parent, styles, inheritedStyles = {}) => (
    <Text key={node.key} style={[inheritedStyles, styles.text]} selectable>
      {node.content}
    </Text>
  ),
  code_inline: (node, _children, _parent, styles, inheritedStyles = {}) => (
    <Text key={node.key} style={[inheritedStyles, styles.code_inline]} selectable>
      {node.content}
    </Text>
  ),
  fence: (node, _children, _parent, styles, inheritedStyles = {}) => (
    <Text key={node.key} style={[inheritedStyles, styles.fence]} selectable>
      {node.content}
    </Text>
  ),
  code_block: (node, _children, _parent, styles, inheritedStyles = {}) => (
    <Text key={node.key} style={[inheritedStyles, styles.code_block]} selectable>
      {node.content}
    </Text>
  ),
};

type Props = {
  content: string;
  compact?: boolean;
  selectable?: boolean;
};

export default function MarkdownContent({
  content,
  compact = false,
  selectable = false,
}: Props): React.JSX.Element {
  const style = compact ? compactMarkdownStyles : markdownStyles;
  const rules = useMemo(() => (selectable ? selectableRules : undefined), [selectable]);

  return (
    <Markdown
      markdownit={markdownIt}
      style={style}
      rules={rules}
      onLinkPress={(url) => {
        void Linking.openURL(url);
        return false;
      }}>
      {content}
    </Markdown>
  );
}

const baseMarkdownStyles = StyleSheet.create({
  body: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  paragraph: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 0,
    marginBottom: 12,
  },
  heading1: {
    color: colors.text,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 12,
  },
  heading2: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 10,
  },
  heading3: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    marginTop: 2,
    marginBottom: 8,
  },
  heading4: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    marginTop: 2,
    marginBottom: 6,
  },
  bullet_list: {
    marginTop: 0,
    marginBottom: 12,
  },
  ordered_list: {
    marginTop: 0,
    marginBottom: 12,
  },
  list_item: {
    marginBottom: 6,
  },
  bullet_list_icon: {
    color: colors.accent,
    marginRight: 8,
    lineHeight: 22,
  },
  ordered_list_icon: {
    color: colors.accent,
    marginRight: 8,
    lineHeight: 22,
    fontWeight: '700',
  },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingLeft: 12,
    marginLeft: 0,
    marginRight: 0,
    marginTop: 0,
    marginBottom: 12,
  },
  code_inline: {
    color: colors.green,
    backgroundColor: colors.background,
    fontFamily: fonts.mono,
    fontSize: 13,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 6,
  },
  code_block: {
    color: colors.text,
    backgroundColor: colors.background,
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 2,
    marginBottom: 12,
  },
  fence: {
    color: colors.text,
    backgroundColor: colors.background,
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 2,
    marginBottom: 12,
  },
  hr: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: 14,
  },
  strong: {
    color: colors.text,
    fontWeight: '700',
  },
  em: {
    color: colors.text,
    fontStyle: 'italic',
  },
  link: {
    color: colors.accent,
    textDecorationLine: 'underline',
  },
});

const markdownStyles = StyleSheet.create({
  ...baseMarkdownStyles,
});

const compactMarkdownStyles = StyleSheet.create({
  ...baseMarkdownStyles,
  body: {
    ...baseMarkdownStyles.body,
    fontSize: 14,
    lineHeight: 21,
  },
  paragraph: {
    ...baseMarkdownStyles.paragraph,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 10,
  },
  heading1: {
    ...baseMarkdownStyles.heading1,
    fontSize: 22,
    lineHeight: 28,
    marginBottom: 10,
  },
  heading2: {
    ...baseMarkdownStyles.heading2,
    fontSize: 19,
    lineHeight: 25,
    marginBottom: 8,
  },
  heading3: {
    ...baseMarkdownStyles.heading3,
    fontSize: 17,
    lineHeight: 23,
  },
  bullet_list_icon: {
    ...baseMarkdownStyles.bullet_list_icon,
    lineHeight: 21,
  },
  ordered_list_icon: {
    ...baseMarkdownStyles.ordered_list_icon,
    lineHeight: 21,
  },
});
