export type RootStackParamList = {
  Login: undefined;
  Runs: undefined;
  Agents: undefined;
  NewRun: { agentId?: string } | undefined;
  RunDetail: { agentId: string; runId: string };
  Terminal: { agentId: string; sessionName?: string };
};

// Allow typing for useNavigation / useRoute
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
