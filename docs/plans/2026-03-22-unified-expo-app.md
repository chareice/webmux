# Unified Expo App Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `packages/web` (React + Vite) and `packages/mobile` (bare React Native) with a single `packages/app` (Expo + React Native Web + NativeWind) that runs on both web and Android from one codebase.

**Architecture:** Expo SDK 53 with Expo Router for file-based routing, NativeWind v4 for Tailwind-style cross-platform styling. Shared logic (API client, auth, WebSocket, timeline builder, utils) lives in `packages/app/lib/`. UI components in `packages/app/components/`. Platform differences handled via `Platform.select()` in a few places (storage, markdown rendering, image picking). Responsive layout switches between top navigation bar (web wide screen) and bottom tabs (mobile/narrow).

**Tech Stack:** Expo SDK 53, Expo Router v4, NativeWind v4, React Native Web, expo-secure-store, expo-image-picker, expo-notifications, @webmux/shared (existing types package)

**Reference code:** The existing `packages/web/src/` and `packages/mobile/src/` contain all business logic and UI to port. The subagent should read these files as the source of truth for behavior.

---

## Task 1: Initialize Expo Project with NativeWind

**Goal:** Create the Expo project skeleton in `packages/app/` with NativeWind configured and monorepo integration working.

**Files:**
- Create: `packages/app/package.json`
- Create: `packages/app/app.json`
- Create: `packages/app/tsconfig.json`
- Create: `packages/app/metro.config.js`
- Create: `packages/app/tailwind.config.ts`
- Create: `packages/app/babel.config.js`
- Create: `packages/app/global.css` (NativeWind entry)
- Create: `packages/app/nativewind-env.d.ts`
- Create: `packages/app/app/_layout.tsx` (minimal root layout that just renders `<Slot />`)
- Create: `packages/app/app/index.tsx` (minimal "Hello World" page)
- Modify: `pnpm-workspace.yaml` (add `packages/app`, keep excluding `packages/mobile`)

**Steps:**

1. Create `packages/app/package.json` with dependencies:
   - `expo`, `expo-router`, `react-native`, `react-native-web`, `react-dom`
   - `nativewind`, `tailwindcss` (v3.x for NativeWind v4 compat)
   - `react-native-safe-area-context`, `react-native-screens`
   - `expo-linking`, `expo-constants`, `expo-status-bar`
   - `@webmux/shared` as `workspace:*`
   - Dev: `@types/react`, `@types/react-dom`

2. Create `app.json` with:
   - `expo.name: "webmux"`, `expo.slug: "webmux"`
   - `expo.scheme: "webmux"` (for deep linking / OAuth redirect)
   - `expo.web.bundler: "metro"` (required for Expo Router web)
   - `expo.plugins: ["expo-router"]`
   - `expo.android.package: "com.webmux.app"`

3. Create `metro.config.js` that:
   - Extends `expo/metro-config`
   - Adds `withNativeWind` wrapper
   - Configures `watchFolders` to include `../../packages/shared` for monorepo resolution
   - Configures `nodeModulesPaths` to resolve from monorepo root

4. Create `tailwind.config.ts`:
   - `content: ["./app/**/*.tsx", "./components/**/*.tsx"]`
   - Dark theme colors matching current design: background `#1a1b26`, surface `#1f2335`, accent `#7aa2f7`, etc.
   - The `important: "html"` for web specificity

5. Create `babel.config.js` with `babel-preset-expo` + NativeWind preset

6. Create minimal `app/_layout.tsx` that imports `global.css` and renders `<Slot />`

7. Create `app/index.tsx` with a simple `<Text>Hello Webmux</Text>`

8. Update `pnpm-workspace.yaml` to add `packages/app`

9. Run `pnpm install` from monorepo root

10. Verify with `cd packages/app && npx expo start --web` — should show "Hello Webmux" in browser

**Acceptance criteria:** `npx expo start --web` renders the hello world page. `@webmux/shared` types can be imported. NativeWind className prop works (test with `className="bg-red-500"`).

---

## Task 2: Shared Utilities

**Goal:** Move duplicated utility functions into `@webmux/shared` so both current packages and the new app can use them.

**Files:**
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/utils.ts`
- Create: `packages/shared/src/timeline.ts`

**Steps:**

1. Create `packages/shared/src/utils.ts` with functions extracted from `packages/web/src/lib/utils.ts` and `packages/mobile/src/theme.ts`:

```typescript
// Time formatting
export function timeAgo(timestamp: number): string { ... }
export function formatDuration(ms: number): string { ... }

// Tool helpers
export function toolLabel(tool: string): string { return tool === 'codex' ? 'Codex' : 'Claude Code' }
export function toolIcon(tool: string): string { return tool === 'codex' ? 'CX' : 'CC' }

// Repo helpers
export function repoName(repoPath: string): string { ... }

// Run status helpers
export function runStatusLabel(status: RunStatus): string { ... }
export function runStatusColor(status: RunStatus): string { ... }

// Task status helpers
export function taskStatusLabel(status: TaskStatus): string { ... }
export function taskStatusColor(status: TaskStatus): string { ... }
export function isTaskActive(status: TaskStatus): boolean { ... }

// Image attachments
export const MAX_ATTACHMENTS = 4
```

Copy exact implementations from `packages/web/src/lib/utils.ts` (lines 25-53) and `packages/mobile/src/theme.ts` (lines 69-109). Use the color hex values from mobile's `theme.ts`.

2. Create `packages/shared/src/timeline.ts` — extract the timeline builder from `packages/web/src/pages/TaskDetailPage.tsx` (lines 112-168):

```typescript
import type { Task, TaskMessage, TaskStep } from './contracts'

export type TimelineItem =
  | { type: 'message'; data: TaskMessage; timestamp: number }
  | { type: 'step-group'; data: TaskStep[]; timestamp: number }
  | { type: 'summary'; text: string; timestamp: number }
  | { type: 'error'; text: string; timestamp: number }

export function buildTaskTimeline(
  messages: TaskMessage[],
  steps: TaskStep[],
  task: Task,
): TimelineItem[] { ... }
```

Copy the exact algorithm from web's `buildUnifiedTimeline` function.

3. Export both from `packages/shared/src/index.ts`

4. Run `cd packages/shared && pnpm build` to verify compilation

**Acceptance criteria:** `packages/shared` builds successfully. All utility functions and timeline builder are exported.

---

## Task 3: Storage Adapter + API Client

**Goal:** Create the cross-platform storage adapter and unified API client in `packages/app/lib/`.

**Files:**
- Create: `packages/app/lib/storage.ts`
- Create: `packages/app/lib/api.ts`

**Steps:**

1. Create `packages/app/lib/storage.ts`:

```typescript
import { Platform } from 'react-native'

export const storage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key)
    }
    const SecureStore = require('expo-secure-store')
    return SecureStore.getItemAsync(key)
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value)
      return
    }
    const SecureStore = require('expo-secure-store')
    await SecureStore.setItemAsync(key, value)
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key)
      return
    }
    const SecureStore = require('expo-secure-store')
    await SecureStore.deleteItemAsync(key)
  },
}
```

Add `expo-secure-store` to package.json dependencies.

2. Create `packages/app/lib/api.ts` — port from `packages/mobile/src/api.ts` (the centralized API client), adapting it to:
   - Use a module-level `_baseUrl` and `_token` (same pattern as mobile)
   - Export a `configure(baseUrl: string, token: string)` function
   - Export ALL API functions from mobile's api.ts (lines 62-253):
     - `getOAuthUrl`, `listAgents`, `browseAgentRepositories`
     - `startThread`, `listThreads`, `listAllThreads`, `getThreadDetail`, `continueThread`, `interruptThread`, `deleteThread`
     - `updateQueuedTurn`, `deleteQueuedTurn`, `resumeQueue`, `discardQueue`
     - `registerPushDevice`, `unregisterPushDevice`
   - ALSO add functions that web uses but mobile centralizes differently:
     - `getMe()` — GET `/api/auth/me`, returns User
     - `devLogin()` — GET `/api/auth/dev`, returns `{ token: string }` or null
     - `createRegistrationToken()` — POST `/api/agents/register-token`
     - `deleteAgent(agentId)` — DELETE `/api/agents/{id}`
     - `renameAgent(agentId, name)` — PATCH `/api/agents/{id}`
     - `getProjectDetail(projectId)` — GET `/api/projects/{id}`
     - `listProjects()` — GET `/api/projects`
     - `createProject(req)` — POST `/api/projects`
     - `updateProject(id, req)` — PATCH `/api/projects/{id}`
     - `deleteProject(id)` — DELETE `/api/projects/{id}`
     - `createTask(projectId, req)` — POST `/api/projects/{id}/tasks`
     - `getTaskSteps(projectId, taskId)` — GET `/api/projects/{id}/tasks/{taskId}/steps`
     - `getTaskMessages(projectId, taskId)` — GET `/api/projects/{id}/tasks/{taskId}/messages`
     - `sendTaskMessage(projectId, taskId, content, attachments?)` — POST `/api/projects/{id}/tasks/{taskId}/messages`
     - `retryTask(projectId, taskId)` — POST `/api/projects/{id}/tasks/{taskId}/retry`
     - `completeTask(projectId, taskId)` — POST `/api/projects/{id}/tasks/{taskId}/complete`
     - `interruptTask(projectId, taskId)` — POST `/api/projects/{id}/tasks/{taskId}/interrupt`
     - `deleteTask(projectId, taskId)` — DELETE `/api/projects/{id}/tasks/{taskId}`
     - `listLlmConfigs()`, `createLlmConfig(req)`, `updateLlmConfig(id, req)`, `deleteLlmConfig(id)`
     - `getInstructions(agentId, tool)`, `saveInstructions(agentId, tool, content)`
     - `listProjectActions(projectId)`, `createProjectAction(projectId, req)`, `updateProjectAction(projectId, actionId, req)`, `deleteProjectAction(projectId, actionId)`, `generateProjectAction(projectId, req)`
   - WebSocket functions:
     - `connectThreadWebSocket(threadId, onMessage, onError?, onClose?)` — returns WebSocket
     - `connectProjectWebSocket(projectId, onMessage, onError?, onClose?)` — returns WebSocket
   - Infer the full list of API calls by reading all `fetchApi()` calls in web pages and all exported functions in mobile api.ts

**Key difference from mobile's api.ts:** The `getOAuthUrl` function needs to be platform-aware:
- Web: redirect back to `window.location.origin` with `?token=xxx`
- Mobile: redirect to `webmux://auth?server=...&provider=...`

**Acceptance criteria:** All API functions compile. Types are correct (imported from `@webmux/shared`).

---

## Task 4: Reconnectable WebSocket

**Goal:** Port the reconnectable WebSocket wrapper from web.

**Files:**
- Create: `packages/app/lib/websocket.ts`

**Steps:**

1. Copy `packages/web/src/lib/reconnectable-socket.ts` to `packages/app/lib/websocket.ts`
2. No changes needed — the implementation is already framework-agnostic (uses standard WebSocket API which works in both React Native and web)

**Acceptance criteria:** File compiles with TypeScript.

---

## Task 5: Auth Provider

**Goal:** Create a unified AuthProvider that merges web's `auth.tsx` and mobile's `store.ts`.

**Files:**
- Create: `packages/app/lib/auth.tsx`

**Steps:**

1. Create `packages/app/lib/auth.tsx` that:
   - Provides `AuthContext` with: `user`, `token`, `serverUrl`, `isLoading`, `isLoggedIn`, `login()`, `logout()`
   - On mount: restores session from storage (token + serverUrl)
   - On web: also checks URL for `?token=xxx` (OAuth callback), stores it, cleans URL
   - On web with no token: tries dev login via `api.devLogin()`
   - When token changes: calls `api.configure(serverUrl, token)` then `api.getMe()` to load user
   - `login(serverUrl, token)`: stores both, configures API, loads user
   - `logout()`: clears storage, resets state

Reference implementations:
- Web: `packages/web/src/auth.tsx` (lines 54-156) — URL token handling, dev login, user loading
- Mobile: `packages/mobile/src/store.ts` (lines 39-111) — storage, serverUrl management

The unified version combines both. On web, `serverUrl` defaults to `''` (same-origin). On mobile, user provides it during login.

**Interface:**
```typescript
interface User {
  id: string
  displayName: string
  avatarUrl: string | null
  role: string
}

interface AuthContextValue {
  user: User | null
  token: string | null
  serverUrl: string
  isLoading: boolean
  isLoggedIn: boolean
  login: (serverUrl: string, token: string) => Promise<void>
  logout: () => Promise<void>
}
```

**Acceptance criteria:** AuthProvider compiles. Exports `useAuth()` hook.

---

## Task 6: Root Layout + Login Page

**Goal:** Create the Expo Router root layout with auth gating and the login page.

**Files:**
- Modify: `packages/app/app/_layout.tsx`
- Create: `packages/app/app/login.tsx`

**Steps:**

1. Update `packages/app/app/_layout.tsx`:
   - Wrap everything in `<AuthProvider>`
   - Use `useAuth()` — if loading, show spinner; if not logged in, redirect to `/login`; otherwise render `<Slot />`

2. Create `packages/app/app/login.tsx`:
   - On web: Show "Login with GitHub" button that navigates to `api.getOAuthUrl('github')`
   - On mobile: Show server URL input + "Login with GitHub" button
   - Reference: `packages/web/src/pages/LoginPage.tsx` and `packages/mobile/src/screens/LoginScreen.tsx`
   - Use NativeWind for styling. Dark theme.

**Acceptance criteria:** Opening the app shows login page when not authenticated. On web, the GitHub OAuth button works (redirects to server, comes back with token in URL).

---

## Task 7: Responsive Main Layout with Navigation

**Goal:** Create the main authenticated layout that shows top navigation bar on web wide screens and bottom tabs on mobile/narrow screens.

**Files:**
- Create: `packages/app/app/(main)/_layout.tsx`
- Create: `packages/app/app/(main)/(tabs)/_layout.tsx`
- Create: `packages/app/app/(main)/(tabs)/index.tsx` (Agents - placeholder)
- Create: `packages/app/app/(main)/(tabs)/threads.tsx` (placeholder)
- Create: `packages/app/app/(main)/(tabs)/projects.tsx` (placeholder)
- Create: `packages/app/app/(main)/(tabs)/settings.tsx` (placeholder)
- Create: `packages/app/components/TopBar.tsx`

**Steps:**

1. Create `packages/app/components/TopBar.tsx`:
   - Port from web's `App.tsx` AppLayout (lines 38-93)
   - Shows: logo "webmux", nav links (Agents, Threads, Projects, Settings), user avatar + name, logout button
   - Use `useAuth()` for user info and logout
   - Use `expo-router`'s `Link` and `usePathname()` for navigation and active state
   - NativeWind styling — dark background, horizontal layout

2. Create `packages/app/app/(main)/_layout.tsx`:
   - Use `useWindowDimensions()` and `Platform.OS`
   - Wide screen (web && width >= 768): render `<TopBar />` + `<Slot />` vertically
   - Otherwise: just render `<Slot />` (the tabs layout handles navigation)

3. Create `packages/app/app/(main)/(tabs)/_layout.tsx`:
   - Define bottom tabs: Agents (home icon), Threads (message icon), Projects (folder icon), Settings (gear icon)
   - Only show tab bar when NOT on wide screen (on wide screen, TopBar handles navigation)
   - Dark theme tab bar styling

4. Create placeholder pages for each tab (just `<Text>Agents</Text>` etc.)

**Acceptance criteria:** On web wide screen: top navigation bar visible, tab bar hidden. On narrow/mobile: bottom tab bar visible, top bar hidden. Navigation between tabs works on both.

---

## Task 8: Agents Screen

**Goal:** Port the Agents page with agent list, add-agent modal, rename, and delete.

**Files:**
- Modify: `packages/app/app/(main)/(tabs)/index.tsx`

**Steps:**

1. Port from `packages/web/src/pages/AgentsPage.tsx` (383 lines)
2. Use `api.listAgents()`, `api.createRegistrationToken()`, `api.deleteAgent()`, `api.renameAgent()` from `lib/api.ts`
3. Use NativeWind for styling
4. The "Add Agent" modal should work on both web and mobile:
   - On web: show registration command with copy button (use `Clipboard` from expo or `navigator.clipboard`)
   - On mobile: same, but the copy mechanism uses `expo-clipboard`
5. Agent cards: status dot (online/offline), name, last seen, click to go to new thread
6. Navigation: clicking an agent card navigates to `/threads/new?agentId=xxx`

**Reference:** `packages/web/src/pages/AgentsPage.tsx` for full behavior

**Acceptance criteria:** Agent list loads and displays. Add agent modal works. Delete and rename work. Clicking an agent navigates to new thread page.

---

## Task 9: Threads Screen

**Goal:** Port the Threads list page with project grouping.

**Files:**
- Modify: `packages/app/app/(main)/(tabs)/threads.tsx`

**Steps:**

1. Port from `packages/web/src/pages/ThreadsPage.tsx` (353 lines)
2. Use `api.listAllThreads()`, `api.listAgents()`, `api.deleteThread()`
3. Group threads by `repoPath` using the `groupByProject()` logic (lines 71-98)
4. Each thread row shows: tool badge, branch, agent name, status badge, time, delete button
5. Auto-refresh when there are active runs (5s interval)
6. "New Thread" button — if one online agent, go directly; if multiple, show dropdown/picker
7. Click a thread → navigate to `/threads/[agentId]/[id]`

**Reference:** `packages/web/src/pages/ThreadsPage.tsx`

**Acceptance criteria:** Thread list loads grouped by project. Status badges display correctly. Delete and navigation work.

---

## Task 10: Projects Screen

**Goal:** Port the Projects list page.

**Files:**
- Modify: `packages/app/app/(main)/(tabs)/projects.tsx`

**Steps:**

1. Port from `packages/web/src/pages/ProjectsPage.tsx`
2. Use `api.listProjects()`
3. Show project cards with name, description, repo path, agent, default tool, task count
4. Click → navigate to `/projects/[id]`
5. "New Project" button → navigate to `/projects/new`

**Reference:** `packages/web/src/pages/ProjectsPage.tsx` — note this file is large (~1958 lines). The relevant part is the project list section only. The project detail is a separate task.

**Acceptance criteria:** Project list loads and displays. Navigation to project detail and new project works.

---

## Task 11: Settings Screens

**Goal:** Port LLM Config and Instructions settings pages.

**Files:**
- Modify: `packages/app/app/(main)/(tabs)/settings.tsx` (settings index with links)
- Create: `packages/app/app/(main)/(tabs)/settings/index.tsx`
- Create: `packages/app/app/(main)/settings/llm.tsx`
- Create: `packages/app/app/(main)/settings/instructions.tsx`

**Steps:**

1. Settings index: list of links to LLM Config and Instructions
   - On mobile: also show server URL and logout button (like `packages/mobile/src/screens/SettingsScreen.tsx`)

2. LLM Config page: port from `packages/web/src/pages/LlmConfigPage.tsx` (420 lines)
   - CRUD for LLM configurations (API base URL, API key, model)
   - Use `api.listLlmConfigs()`, `api.createLlmConfig()`, `api.updateLlmConfig()`, `api.deleteLlmConfig()`

3. Instructions page: port from `packages/web/src/pages/InstructionsPage.tsx` (213 lines)
   - Per-agent, per-tool instructions editor
   - Use `api.getInstructions()`, `api.saveInstructions()`

**Reference:** Web pages for full behavior

**Acceptance criteria:** Settings navigation works. LLM configs can be created/edited/deleted. Instructions can be viewed and saved.

---

## Task 12: New Thread Page

**Goal:** Port the new thread creation page.

**Files:**
- Create: `packages/app/app/(main)/threads/new.tsx`

**Steps:**

1. Port from `packages/web/src/pages/NewThreadPage.tsx` (678 lines)
2. Receives `agentId` as a search param or route param
3. Repository browser to select repo path (use `api.browseAgentRepositories()`)
4. Tool selector (Claude Code / Codex)
5. Prompt input (textarea)
6. Image attachments — use `expo-image-picker` on mobile, file input on web
7. Model/effort options
8. Submit → `api.startThread()` → navigate to thread detail

**Reference:** `packages/web/src/pages/NewThreadPage.tsx`

Add `expo-image-picker` to dependencies.

**Acceptance criteria:** Can browse repositories, enter a prompt, select tool, and start a thread. Navigates to thread detail on success.

---

## Task 13: New Project Page

**Goal:** Port the new project creation page.

**Files:**
- Create: `packages/app/app/(main)/projects/new.tsx`

**Steps:**

1. Port from `packages/web/src/pages/NewProjectPage.tsx` (522 lines)
2. Agent selector, repository browser, name, description, default tool
3. Submit → `api.createProject()` → navigate to project detail

**Reference:** `packages/web/src/pages/NewProjectPage.tsx`

**Acceptance criteria:** Can select agent, browse repos, fill in details, and create a project.

---

## Task 14: Thread Detail Page

**Goal:** Port the thread detail page with real-time updates.

**Files:**
- Create: `packages/app/app/(main)/threads/[agentId]/[id].tsx`
- Create: `packages/app/components/MarkdownContent.tsx`

**Steps:**

1. Create `packages/app/components/MarkdownContent.tsx`:
   - On web: use `react-markdown` + `remark-gfm`
   - On native: use `react-native-markdown-display` or plain `<Text>` for now
   - Add appropriate dependencies

2. Port from `packages/web/src/pages/ThreadDetailPage.tsx` (1075 lines):
   - Two-column layout on web (sidebar + main), single column on mobile
   - Sidebar: run info (status, tool, branch, agent), action buttons (interrupt, delete)
   - Main: timeline of turns with expandable command/activity items
   - Continue conversation: prompt input with image attachments
   - Model/effort selector for new turns
   - Queued turn management (edit, delete, resume, discard)
   - WebSocket for real-time updates using `createReconnectableSocket` from `lib/websocket.ts`
   - Auto-refresh fallback

3. Use `api.getThreadDetail()`, `api.continueThread()`, `api.interruptThread()`, `api.deleteThread()`, etc.

**Reference:** `packages/web/src/pages/ThreadDetailPage.tsx` for web behavior, `packages/mobile/src/screens/RunDetailScreen.tsx` for mobile behavior

**Acceptance criteria:** Thread detail loads with timeline. Real-time updates work via WebSocket. Can continue conversation, interrupt, delete. Status displays correctly.

---

## Task 15: Project Detail Page

**Goal:** Port the project detail page with task list and management.

**Files:**
- Create: `packages/app/app/(main)/projects/[id]/index.tsx`

**Steps:**

1. Port from `packages/web/src/pages/ProjectDetailPage.tsx` (1022 lines):
   - Project info header (name, description, repo, agent, tool)
   - Edit project (name, description, default tool)
   - Task list with status badges and time ago
   - Create task form (title, prompt, priority, tool)
   - Project actions (predefined prompts that create tasks)
   - Action CRUD (create, edit, delete, reorder)
   - Generate action from description (AI-powered)
   - Click task → navigate to `/projects/[id]/tasks/[taskId]`
   - Delete project
   - WebSocket for real-time task status updates

**Reference:** `packages/web/src/pages/ProjectDetailPage.tsx`

**Acceptance criteria:** Project detail loads. Tasks display with correct status. Can create tasks, edit project, manage actions. Real-time updates work.

---

## Task 16: Task Detail Page

**Goal:** Port the most complex page — task detail with timeline, chat, and real-time updates.

**Files:**
- Create: `packages/app/app/(main)/projects/[id]/tasks/[taskId].tsx`

**Steps:**

1. Port from `packages/web/src/pages/TaskDetailPage.tsx` (766 lines):
   - Two-column on web (sidebar + main), single column on mobile
   - Use `buildTaskTimeline()` from `@webmux/shared` (added in Task 2)
   - Use `timeAgo()`, `formatDuration()`, `taskStatusLabel()` etc from `@webmux/shared`
   - Sidebar: task info (status, tool, project, branch, priority, dates, description), action buttons
   - Main timeline: messages (chat bubbles), step groups (expandable), summary box, error box
   - Chat input with image attachments
   - Actions: interrupt, mark complete, retry, delete
   - WebSocket for real-time updates (task-status, task-step, task-message events)
   - Auto-scroll on new content
   - Auto-refresh fallback for active tasks

2. Image attachments:
   - Web: `<input type="file">` equivalent — use a hidden file input rendered only on web via `Platform.OS`
   - Mobile: `expo-image-picker`
   - Both: convert to base64 for API upload

3. Use `createReconnectableSocket` for WebSocket connection

**Reference:**
- `packages/web/src/pages/TaskDetailPage.tsx` — primary reference for behavior
- `packages/mobile/src/screens/TaskDetailScreen.tsx` — reference for mobile-specific patterns

**Acceptance criteria:** Task detail loads with full timeline. Real-time updates work. Chat with image attachments works. All action buttons (interrupt, complete, retry, delete) work. Auto-scroll on new content.

---

## Task 17: Push Notifications (Mobile)

**Goal:** Set up push notifications for Android using expo-notifications.

**Files:**
- Create: `packages/app/lib/push.ts`
- Modify: `packages/app/lib/auth.tsx` (call unregister on logout)
- Modify: `packages/app/app/_layout.tsx` (initialize push on login)

**Steps:**

1. Add `expo-notifications` and `expo-device` to dependencies

2. Create `packages/app/lib/push.ts`:
   - `registerForPush()`: request permissions, get device push token (FCM), register with server via `api.registerPushDevice()`
   - `unregisterPush()`: unregister with server
   - Only run on native platforms (`Platform.OS !== 'web'`)
   - Handle notification received (foreground display)
   - Handle notification opened (navigate to thread/task detail)

3. Reference: `packages/mobile/src/push-notifications.ts`

4. Integrate with auth: register on login, unregister on logout

**Acceptance criteria:** Push notifications register on Android login. Tapping a notification navigates to the relevant screen.

---

## Task 18: Cleanup and Deployment Config

**Goal:** Remove old packages, update workspace and Docker config.

**Files:**
- Delete: `packages/web/` (entire directory)
- Delete: `packages/mobile/` (entire directory)
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json` (root scripts)
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`

**Steps:**

1. Update `pnpm-workspace.yaml`:
   ```yaml
   packages:
     - "packages/*"
   ```
   (Remove the `!packages/mobile` exclusion)

2. Update root `package.json` scripts:
   ```json
   {
     "dev": "pnpm --filter @webmux/app dev",
     "dev:web": "cd packages/app && npx expo start --web",
     "dev:android": "cd packages/app && npx expo start --android",
     "build": "pnpm -r build",
     "build:web": "cd packages/app && npx expo export --platform web",
     "typecheck": "tsc -b"
   }
   ```

3. Update `Dockerfile`:
   - Build step: `cd packages/app && npx expo export --platform web`
   - Output: `packages/app/dist/` (or wherever expo exports to)
   - Serve with the existing server setup (static files)

4. Delete `packages/web/` and `packages/mobile/` directories

5. Run `pnpm install` to clean up lockfile

6. Verify `pnpm build:web` produces the static output

**Acceptance criteria:** Old packages removed. Web build works. Docker build produces deployable image.

---

## Dependency Graph

```
Task 1 (Expo Init)
  ├── Task 2 (Shared Utils) — can start after shared package exists
  ├── Task 3 (Storage + API) — needs packages/app to exist
  ├── Task 4 (WebSocket) — needs packages/app to exist
  └── Task 5 (Auth) — needs Task 3 (storage + api)
        └── Task 6 (Root Layout + Login) — needs Task 5 (auth)
              └── Task 7 (Main Layout + Navigation) — needs Task 6
                    ├── Task 8 (Agents) ─────────┐
                    ├── Task 9 (Threads) ─────────┤
                    ├── Task 10 (Projects) ───────┤ can run in parallel
                    ├── Task 11 (Settings) ───────┤
                    ├── Task 12 (New Thread) ─────┤
                    └── Task 13 (New Project) ────┘
                          ├── Task 14 (Thread Detail) ──┐
                          ├── Task 15 (Project Detail) ──┤ can run in parallel
                          └── Task 16 (Task Detail) ─────┘
                                ├── Task 17 (Push Notifications)
                                └── Task 18 (Cleanup)
```

**Parallelization opportunities:**
- Tasks 2, 3, 4 can run in parallel (all just create files in lib/)
- Tasks 8-13 can run in parallel (independent screens)
- Tasks 14-16 can run in parallel (complex screens, independent)
