export type RootStackParamList = {
  Login: undefined;
  Threads: undefined;
  Agents: undefined;
  NewThread: { agentId?: string } | undefined;
  ThreadDetail: { agentId: string; runId: string };
  ThreadContent: { title: string; content: string; mono?: boolean };
  Terminal: { agentId: string; sessionName?: string };
};

// Allow typing for useNavigation / useRoute
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
