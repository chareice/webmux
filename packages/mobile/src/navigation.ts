export type MainTabParamList = {
  Threads: undefined;
  Agents: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  NewThread: { agentId?: string } | undefined;
  ThreadDetail: { agentId: string; runId: string };
  ThreadContent: { title: string; content: string; mono?: boolean };

};

// Allow typing for useNavigation / useRoute
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
