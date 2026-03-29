import { useMemo } from "react";
import { Linking, Platform, Text } from "react-native";
import Markdown, {
  MarkdownIt,
  type RenderRules,
} from "react-native-markdown-display";
import { useTheme } from "../lib/theme";
import type { ThemeColors } from "../lib/theme-utils";

const MONO_FONT = Platform.OS === "web" ? "monospace" : "Courier";

const markdownIt = MarkdownIt({
  breaks: true,
  typographer: true,
});

const selectableRules: RenderRules = {
  code_block: (node, _children, _parent, styles, inheritedStyles = {}) => (
    <Text key={node.key} style={[inheritedStyles, styles.code_block]} selectable>
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
  text: (node, _children, _parent, styles, inheritedStyles = {}) => (
    <Text key={node.key} style={[inheritedStyles, styles.text]} selectable>
      {node.content}
    </Text>
  ),
  textgroup: (node, children, _parent, styles) => (
    <Text key={node.key} style={styles.textgroup} selectable>
      {children}
    </Text>
  ),
};

function createBaseStyles(colors: ThemeColors) {
  return {
    blockquote: {
      borderLeftColor: colors.accent,
      borderLeftWidth: 3,
      marginBottom: 12,
      marginHorizontal: 0,
      marginTop: 0,
      paddingLeft: 12,
    },
    body: {
      color: colors.foreground,
      fontSize: 15,
      lineHeight: 22,
    },
    bullet_list: {
      marginBottom: 12,
      marginTop: 0,
    },
    bullet_list_icon: {
      color: colors.accent,
      lineHeight: 22,
      marginRight: 8,
    },
    code_block: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 10,
      borderWidth: 1,
      color: colors.foreground,
      fontFamily: MONO_FONT,
      fontSize: 13,
      lineHeight: 20,
      marginBottom: 12,
      marginTop: 2,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    code_inline: {
      backgroundColor: colors.surface,
      borderRadius: 6,
      color: colors.green,
      fontFamily: MONO_FONT,
      fontSize: 13,
      paddingHorizontal: 4,
      paddingVertical: 2,
    },
    em: {
      color: colors.foreground,
      fontStyle: "italic" as const,
    },
    fence: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 10,
      borderWidth: 1,
      color: colors.foreground,
      fontFamily: MONO_FONT,
      fontSize: 13,
      lineHeight: 20,
      marginBottom: 12,
      marginTop: 2,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    heading1: {
      color: colors.foreground,
      fontSize: 24,
      fontWeight: "700" as const,
      lineHeight: 30,
      marginBottom: 10,
      marginTop: 4,
    },
    heading2: {
      color: colors.foreground,
      fontSize: 20,
      fontWeight: "700" as const,
      lineHeight: 26,
      marginBottom: 8,
      marginTop: 4,
    },
    heading3: {
      color: colors.foreground,
      fontSize: 17,
      fontWeight: "700" as const,
      lineHeight: 23,
      marginBottom: 6,
      marginTop: 2,
    },
    hr: {
      backgroundColor: colors.border,
      height: 1,
      marginVertical: 14,
    },
    link: {
      color: colors.accent,
      textDecorationLine: "underline" as const,
    },
    list_item: {
      marginBottom: 6,
    },
    ordered_list: {
      marginBottom: 12,
      marginTop: 0,
    },
    ordered_list_icon: {
      color: colors.accent,
      fontWeight: "700" as const,
      lineHeight: 22,
      marginRight: 8,
    },
    paragraph: {
      color: colors.foreground,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 12,
      marginTop: 0,
    },
    strong: {
      color: colors.foreground,
      fontWeight: "700" as const,
    },
  };
}

function createCompactStyles(colors: ThemeColors) {
  const baseStyles = createBaseStyles(colors);

  return {
    ...baseStyles,
    body: {
      ...baseStyles.body,
      fontSize: 14,
      lineHeight: 21,
    },
    heading1: {
      ...baseStyles.heading1,
      fontSize: 22,
      lineHeight: 28,
    },
    heading2: {
      ...baseStyles.heading2,
      fontSize: 18,
      lineHeight: 24,
    },
    paragraph: {
      ...baseStyles.paragraph,
      fontSize: 14,
      lineHeight: 21,
      marginBottom: 10,
    },
  };
}

interface MarkdownContentProps {
  compact?: boolean;
  content: string;
  selectable?: boolean;
}

export default function MarkdownContent({
  compact = false,
  content,
  selectable = false,
}: MarkdownContentProps) {
  const { colors } = useTheme();
  const rules = useMemo(
    () => (selectable ? selectableRules : undefined),
    [selectable],
  );
  const styles = useMemo(
    () => (compact ? createCompactStyles(colors) : createBaseStyles(colors)),
    [colors, compact],
  );

  return (
    <Markdown
      markdownit={markdownIt}
      onLinkPress={(url) => {
        void Linking.openURL(url);
        return false;
      }}
      rules={rules}
      style={styles}
    >
      {content}
    </Markdown>
  );
}
