# Mobile Navigation Refactor

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the mobile web-style navigation (Slot + custom headers) with native Tab Bar + Stack navigation so the app feels like a real product.

**Architecture:** Outer Stack wraps a Tabs navigator (Home + Settings). Screens outside (tabs) — workpath, threads — push full-screen onto the Stack, hiding the tab bar. Desktop layout (LeftPanel + Slot) is untouched.

**Tech Stack:** expo-router (Tabs, Stack), @expo/vector-icons (Ionicons), react-native-safe-area-context

---

## File Structure Change

```
BEFORE:                              AFTER:
app/(main)/                          app/(main)/
  _layout.tsx  (Slot)                  _layout.tsx  (Stack on mobile)
  index.tsx                            (tabs)/
  workpath.tsx                           _layout.tsx  (Tabs navigator) [NEW]
  threads/                               index.tsx   (moved from ../index.tsx)
    _layout.tsx                          settings/   (moved from ../settings/)
    new.tsx                                _layout.tsx
    [agentId]/                             index.tsx
      _layout.tsx                          nodes.tsx
      [id].tsx                             instructions.tsx
  settings/                            workpath.tsx  (stays outside tabs)
    _layout.tsx                        threads/      (stays outside tabs)
    index.tsx                            _layout.tsx
    nodes.tsx                            new.tsx
    instructions.tsx                     [agentId]/
                                           _layout.tsx
                                           [id].tsx
```

Route groups `(tabs)` do not affect URL paths. All existing `router.push()` paths remain valid.

---

## Task 1: Create (tabs) route group and move files

This is the foundational structural change. Move files, fix imports, create the new Tabs layout.

**Files:**
- Create: `app/(main)/(tabs)/_layout.tsx`
- Move: `app/(main)/index.tsx` -> `app/(main)/(tabs)/index.tsx`
- Move: `app/(main)/settings/` -> `app/(main)/(tabs)/settings/`

### Step 1: Create the (tabs) directory and layout

Create `app/(main)/(tabs)/_layout.tsx`:

```tsx
import { Platform, useWindowDimensions } from "react-native";
import { Tabs, Slot } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "../../../lib/theme";

export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const isWideScreen = Platform.OS === "web" && width >= 768;
  const { colors } = useTheme();

  // Desktop: no tab bar, just render content
  if (isWideScreen) {
    return <Slot />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.foreground,
        tabBarInactiveTintColor: colors.foregroundSecondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        headerStyle: {
          backgroundColor: colors.surface,
        },
        headerTintColor: colors.foreground,
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cog-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
```

### Step 2: Move index.tsx into (tabs)

```bash
mv app/\(main\)/index.tsx app/\(main\)/\(tabs\)/index.tsx
```

Fix all relative imports — add one `../` level (was `../../`, now `../../../`):

In `app/(main)/(tabs)/index.tsx`, update these imports:
```
../../lib/workpath-context  ->  ../../../lib/workpath-context
../../lib/api               ->  ../../../lib/api
../../lib/auth-utils        ->  ../../../lib/auth-utils
../../lib/registration-utils -> ../../../lib/registration-utils
../../lib/storage           ->  ../../../lib/storage
../../lib/theme             ->  ../../../lib/theme
../../lib/workpath          ->  ../../../lib/workpath
```

### Step 3: Move settings/ into (tabs)

```bash
mv app/\(main\)/settings app/\(main\)/\(tabs\)/settings
```

Fix all relative imports in the 4 settings files — add one `../` level (was `../../../`, now `../../../../`):

**`(tabs)/settings/_layout.tsx`:**
```
../../../lib/theme  ->  ../../../../lib/theme
```

**`(tabs)/settings/index.tsx`:**
```
../../../lib/auth        ->  ../../../../lib/auth
../../../lib/theme       ->  ../../../../lib/theme
../../../lib/update      ->  ../../../../lib/update
../../../lib/theme-utils ->  ../../../../lib/theme-utils
```

**`(tabs)/settings/nodes.tsx`:**
All `../../../lib/...` -> `../../../../lib/...`
All `../../../components/...` -> `../../../../components/...` (if any)

**`(tabs)/settings/instructions.tsx`:**
All `../../../lib/...` -> `../../../../lib/...`

### Step 4: Verify

```bash
npx tsc --noEmit --pretty
```
Expected: no errors

### Step 5: Commit

```bash
git add -A && git commit -m "refactor: create (tabs) route group, move index and settings"
```

---

## Task 2: Update (main)/_layout.tsx for Stack navigation on mobile

Replace the mobile Slot + SafeAreaView with a Stack navigator. Keep desktop LeftPanel + Slot unchanged.

**Files:**
- Modify: `app/(main)/_layout.tsx`

### Step 1: Rewrite the mobile path

Replace the entire `MainContent` function. The key changes:
- Mobile: `Stack` instead of `SafeAreaView + KeyboardAvoidingView + Slot`
- Desktop: `LeftPanel + Slot` (unchanged)
- Remove imports: `SafeAreaView`, `KeyboardAvoidingView`, `getKeyboardAvoidingBehavior`
- Add import: `Stack` from `expo-router`

New `app/(main)/_layout.tsx`:

```tsx
import {
  useWindowDimensions,
  Platform,
  View,
  ActivityIndicator,
} from "react-native";
import { Stack, Slot, Redirect, usePathname } from "expo-router";
import { useAuth } from "../../lib/auth";
import { LeftPanel } from "../../components/LeftPanel";
import { WorkpathProvider } from "../../lib/workpath-context";
import { useTheme } from "../../lib/theme";

function MainContent() {
  const { width } = useWindowDimensions();
  const isWideScreen = Platform.OS === "web" && width >= 768;
  const pathname = usePathname();
  const { colors } = useTheme();

  // Extract active thread ID from the current route
  const threadMatch = pathname.match(/\/threads\/([^/]+)\/([^/]+)$/);
  const activeThreadId = threadMatch ? threadMatch[2] : null;

  if (isWideScreen) {
    return (
      <View className="flex-1 flex-row bg-background">
        <LeftPanel activeThreadId={activeThreadId} />
        <View className="flex-1">
          <Slot />
        </View>
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="workpath"
        options={{
          headerShown: true,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
        }}
      />
      <Stack.Screen name="threads" />
    </Stack>
  );
}

export default function MainLayout() {
  const { isLoading, isLoggedIn } = useAuth();
  const { colors } = useTheme();

  if (isLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (!isLoggedIn) {
    return <Redirect href="/login" />;
  }

  return (
    <WorkpathProvider>
      <MainContent />
    </WorkpathProvider>
  );
}
```

### Step 2: Verify

```bash
npx tsc --noEmit --pretty
```

### Step 3: Commit

```bash
git add -A && git commit -m "refactor: use Stack navigator on mobile in (main) layout"
```

---

## Task 3: Clean up Home screen

Remove the custom header from `index.tsx` and move the "+ New" button to the tab header.

**Files:**
- Modify: `app/(main)/(tabs)/index.tsx`
- Modify: `app/(main)/(tabs)/_layout.tsx`

### Step 1: Add headerRight to Home tab in (tabs)/_layout.tsx

The Home tab's `Tabs.Screen` needs a `headerRight` with the "+ New" button. Update the `(tabs)/_layout.tsx` to import `useRouter`, `Pressable`, `Text` and add:

```tsx
<Tabs.Screen
  name="index"
  options={{
    title: "webmux",
    tabBarIcon: ({ color, size }) => (
      <Ionicons name="home-outline" size={size} color={color} />
    ),
    headerRight: () => <NewThreadButton />,
  }}
/>
```

Add a `NewThreadButton` component in the same file:

```tsx
import { Pressable, Text } from "react-native";
import { useRouter } from "expo-router";

function NewThreadButton() {
  const router = useRouter();
  return (
    <Pressable
      className="bg-accent rounded-md px-3 py-1.5 mr-4"
      onPress={() => router.push("/(main)/threads/new" as never)}
    >
      <Text className="text-background text-xs font-semibold">+ New</Text>
    </Pressable>
  );
}
```

### Step 2: Remove custom header from index.tsx

In `app/(main)/(tabs)/index.tsx`, in the `HomeScreen` component's mobile view return, **delete** the entire header block (the `<View className="px-4 pt-2 pb-3 flex-row items-center gap-3">` containing the "webmux" title, "+ New" button, and "Settings" button).

The mobile view return should start directly with the ScrollView:

```tsx
return (
  <View className="flex-1 bg-background">
    <ScrollView
      className="flex-1"
      contentContainerClassName="px-4 pb-8"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />
      }
    >
      {/* workpath cards... */}
    </ScrollView>
  </View>
);
```

### Step 3: Verify and commit

```bash
npx tsc --noEmit --pretty
git add -A && git commit -m "refactor: move Home header to tab bar, remove custom header"
```

---

## Task 4: Add native header to workpath and new thread screens

**Files:**
- Modify: `app/(main)/workpath.tsx`
- Modify: `app/(main)/threads/_layout.tsx`
- Modify: `app/(main)/threads/new.tsx`

### Step 1: Clean up workpath.tsx

Remove the custom header. Use `<Stack.Screen>` from expo-router to set the dynamic title and headerRight.

At the top of the `WorkpathScreen` component's return (the non-null branch), add:

```tsx
import { Stack } from "expo-router";

// Inside the component, before the return:
return (
  <View className="flex-1 bg-background">
    <Stack.Screen
      options={{
        title: workpath.dirName,
        headerRight: () => (
          <Pressable
            className="bg-accent rounded-md px-3 py-1.5 mr-2"
            onPress={() => {
              const params = new URLSearchParams();
              params.set("agentId", agentId ?? workpath.agentId);
              params.set("repoPath", workpath.repoPath);
              router.push(`/(main)/threads/new?${params.toString()}` as never);
            }}
          >
            <Text className="text-background text-xs font-semibold">+ New</Text>
          </Pressable>
        ),
      }}
    />
    {/* Remove the entire header View */}
    {/* Keep only the ScrollView with thread list */}
    <ScrollView ...>
      ...
    </ScrollView>
  </View>
);
```

Also update the null/empty workpath branch — remove its custom header and use:
```tsx
<Stack.Screen options={{ title: "Workpath" }} />
```

### Step 2: Update threads/_layout.tsx to show header for new.tsx

Replace `app/(main)/threads/_layout.tsx`:

```tsx
import { Stack } from "expo-router";
import { useTheme } from "../../../lib/theme";

export default function ThreadsLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="new"
        options={{
          headerShown: true,
          title: "New Thread",
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
        }}
      />
      <Stack.Screen name="[agentId]" />
    </Stack>
  );
}
```

### Step 3: Clean up threads/new.tsx

Remove the custom header block (the `<View className="flex-row items-center gap-3 mb-6">` with "Back" button and "New Thread" title).

The content should start directly with the form fields inside the ScrollView. Delete these lines from the ScrollView content:

```tsx
{/* DELETE: Header */}
<View className="flex-row items-center gap-3 mb-6">
  <Pressable className="bg-surface-light rounded-lg px-3 py-2" onPress={() => router.back()}>
    <Text className="text-foreground-secondary text-sm">Back</Text>
  </Pressable>
  <Text className="text-foreground text-2xl font-bold">New Thread</Text>
</View>
```

### Step 4: Verify and commit

```bash
npx tsc --noEmit --pretty
git add -A && git commit -m "refactor: native headers for workpath and new thread screens"
```

---

## Task 5: Clean up settings screens with native headers

**Files:**
- Modify: `app/(main)/(tabs)/settings/_layout.tsx`
- Modify: `app/(main)/(tabs)/settings/index.tsx`
- Modify: `app/(main)/(tabs)/settings/nodes.tsx`
- Modify: `app/(main)/(tabs)/settings/instructions.tsx`

### Step 1: Update settings/_layout.tsx to show native headers

```tsx
import { Stack } from "expo-router";
import { useTheme } from "../../../../lib/theme";

export default function SettingsLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.foreground,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="nodes" options={{ title: "Nodes" }} />
      <Stack.Screen name="instructions" options={{ title: "Instructions" }} />
    </Stack>
  );
}
```

Note: `index` has `headerShown: false` because the Tab header already shows "Settings" for this screen.

### Step 2: Clean up settings/index.tsx

Remove the self-rendered title line. Delete:

```tsx
<Text className="text-foreground text-2xl font-bold mb-4">Settings</Text>
```

### Step 3: Clean up settings/nodes.tsx

Remove the custom header block (lines ~225-238). Use `<Stack.Screen>` for the headerRight with "+ Add Node" button:

At the top of the component's return, add:
```tsx
<Stack.Screen
  options={{
    headerRight: () => (
      <Pressable
        className="flex-row items-center bg-accent rounded-lg px-3 py-1.5 mr-2"
        onPress={openModal}
      >
        <Text className="text-background font-semibold text-xs">+ Add</Text>
      </Pressable>
    ),
  }}
/>
```

Delete the old header View block.

### Step 4: Clean up settings/instructions.tsx

Remove the custom header block with the "< Back" button and "Global Instructions" title. The Stack navigator provides the back button and title automatically.

Delete:
```tsx
<View className="flex-row items-center gap-3 mb-4">
  <Pressable onPress={() => router.replace(getSettingsRoute() as never)}>
    <Text className="text-accent text-base">{"< Back"}</Text>
  </Pressable>
  <Text className="text-foreground text-2xl font-bold">
    Global Instructions
  </Text>
</View>
```

### Step 5: Verify and commit

```bash
npx tsc --noEmit --pretty
git add -A && git commit -m "refactor: native headers for settings screens"
```

---

## Task 6: Update thread detail for standalone full-screen

Thread detail keeps its custom header but needs to handle safe area and keyboard avoiding itself, since the parent SafeAreaView was removed.

**Files:**
- Modify: `app/(main)/threads/[agentId]/[id].tsx`

### Step 1: Add SafeAreaView to thread detail

The screen currently starts with `<View className="flex-1 bg-background">`. Wrap the content in SafeAreaView for the top edge (the bottom is handled by the composer area):

```tsx
import { SafeAreaView } from "react-native-safe-area-context";

// In the render return:
return (
  <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
    {/* existing header */}
    <View className="bg-surface px-4 py-2.5 border-b border-border">
      ...
    </View>
    {/* existing content */}
    ...
  </SafeAreaView>
);
```

Replace the outermost `<View className="flex-1 bg-background">` with `<SafeAreaView className="flex-1 bg-background" edges={["top"]}>` and its closing tag.

### Step 2: Add KeyboardAvoidingView

Wrap the main content area (below the header) in a KeyboardAvoidingView for iOS keyboard handling:

```tsx
import { KeyboardAvoidingView } from "react-native";
import { getKeyboardAvoidingBehavior } from "../../../../lib/mobile-layout";

// Below the header, wrap content:
<KeyboardAvoidingView
  className="flex-1"
  behavior={getKeyboardAvoidingBehavior(Platform.OS)}
  enabled={Platform.OS !== "web"}
>
  <ScrollView ...>...</ScrollView>
  <View className="bg-surface border-t ...">
    {/* composer */}
  </View>
</KeyboardAvoidingView>
```

Note: `KeyboardAvoidingView` is already imported from react-native (check existing imports), and `getKeyboardAvoidingBehavior` is already imported. Just wrap the content area below the header.

### Step 3: Verify and commit

```bash
npx tsc --noEmit --pretty
git add -A && git commit -m "refactor: add SafeAreaView and KeyboardAvoidingView to thread detail"
```

---

## Task 7: Final verification

**Files:** none (test only)

### Step 1: Type check

```bash
npx tsc --noEmit --pretty
```
Expected: 0 errors

### Step 2: Unit tests

```bash
cd packages/app && pnpm test
```
Expected: all 65 tests pass

### Step 3: Build web

```bash
pnpm build:web
```
Expected: builds successfully (verifies no broken imports)

### Step 4: Commit if any fixups needed

```bash
git add -A && git commit -m "fix: address verification issues"
```

---

## Execution Notes

- **Tasks 1-2 are sequential** — Task 2 depends on Task 1's file structure
- **Tasks 3-6 are parallelizable** — each touches different files
- **Task 7 runs last** — final verification
- Desktop layout (LeftPanel + Slot) is completely untouched
- All `router.push()` paths remain the same (route groups don't affect URLs)
