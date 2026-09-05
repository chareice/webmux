import { createContext } from "react";
/** RTT to the Hub, including the tunnel; does not measure agent execution. */
export const HubLatencyContext = createContext<number | null>(null);
