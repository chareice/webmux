import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

const KeyBarSlotContext = createContext<HTMLElement | null>(null);
const KeyBarSlotRegisterContext = createContext<
  ((node: HTMLElement | null) => void) | null
>(null);

export function KeyBarSlotProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const register = useCallback((node: HTMLElement | null) => {
    setSlot(node);
  }, []);
  return (
    <KeyBarSlotRegisterContext.Provider value={register}>
      <KeyBarSlotContext.Provider value={slot}>
        {children}
      </KeyBarSlotContext.Provider>
    </KeyBarSlotRegisterContext.Provider>
  );
}

export function useKeyBarSlot(): HTMLElement | null {
  return useContext(KeyBarSlotContext);
}

export function useKeyBarSlotRegister(): (node: HTMLElement | null) => void {
  const register = useContext(KeyBarSlotRegisterContext);
  return register ?? noopRegister;
}

function noopRegister(_node: HTMLElement | null) {}

/** Empty bottom slot for the touch-workspace ExtendedKeyBar portal. */
export function WorkspaceKeyBarSlot() {
  const register = useKeyBarSlotRegister();
  return (
    <div
      data-testid="workspace-keybar-slot"
      ref={register}
      style={{ flexShrink: 0 }}
    />
  );
}
