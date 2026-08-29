import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createPrefixEngine,
  isPrefixTriggerEvent,
  loadPrefixBindingsCached,
  type PrefixActionId,
  type PrefixBindings,
  type PrefixEngine,
  type PrefixKeyEventLike,
  type PrefixResult,
} from "./prefixKey";

export type PrefixActionHandler = () => void;

export interface PrefixKeyContextValue {
  // Armed state for the ⌃B indicator.
  armed: boolean;
  // Runs one keydown through the engine, syncs the armed indicator and
  // dispatches action/literal results to the registered handlers.
  handleKeydown: (event: PrefixKeyEventLike) => PrefixResult;
  // True when the event is the Ctrl+B trigger or the engine is armed — xterm
  // uses this to keep those keys out of the terminal input path.
  isPrefixKeyEvent: (event: PrefixKeyEventLike) => boolean;
  setActionHandler: (action: PrefixActionId, handler: PrefixActionHandler) => void;
  clearActionHandler: (action: PrefixActionId) => void;
  // Sends the literal Ctrl+B byte (\x02) to the focused terminal.
  setLiteralHandler: (handler: PrefixActionHandler | null) => void;
}

const PrefixKeyContext = createContext<PrefixKeyContextValue | null>(null);

interface PrefixKeyController {
  engine: PrefixEngine;
  bindings: PrefixBindings;
  actionHandlers: Map<PrefixActionId, PrefixActionHandler>;
  literalHandler: { current: PrefixActionHandler | null };
}

function createPrefixKeyController(): PrefixKeyController {
  const bindings = loadPrefixBindingsCached();
  return {
    engine: createPrefixEngine(bindings),
    bindings,
    actionHandlers: new Map(),
    literalHandler: { current: null },
  };
}

function runControllerKeydown(
  controller: PrefixKeyController,
  event: PrefixKeyEventLike,
): PrefixResult {
  // Reload bindings on every keydown so rebinding in Settings takes effect
  // without a reload. The cached loader only re-reads localStorage after a
  // save/reset (or a cross-tab storage event), so a plain keystroke costs
  // one identity check here instead of a getItem + JSON.parse.
  const bindings = loadPrefixBindingsCached();
  if (bindings !== controller.bindings) {
    controller.engine.setBindings(bindings);
    controller.bindings = bindings;
  }
  const result = controller.engine.handleKeydown(event);
  if (result.type === "action") {
    controller.actionHandlers.get(result.action)?.();
  } else if (result.type === "literal") {
    controller.literalHandler.current?.();
  }
  return result;
}

export function PrefixKeyProvider({ children }: { children: ReactNode }) {
  const [armed, setArmed] = useState(false);
  const controllerRef = useRef<PrefixKeyController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createPrefixKeyController();
  }

  const handleKeydown = useCallback((event: PrefixKeyEventLike) => {
    const controller = controllerRef.current!;
    const result = runControllerKeydown(controller, event);
    setArmed(controller.engine.isArmed());
    return result;
  }, []);

  const isPrefixKeyEvent = useCallback(
    (event: PrefixKeyEventLike) =>
      isPrefixTriggerEvent(event) || controllerRef.current!.engine.isArmed(),
    [],
  );

  const setActionHandler = useCallback(
    (action: PrefixActionId, handler: PrefixActionHandler) => {
      controllerRef.current!.actionHandlers.set(action, handler);
    },
    [],
  );

  const clearActionHandler = useCallback((action: PrefixActionId) => {
    controllerRef.current!.actionHandlers.delete(action);
  }, []);

  const setLiteralHandler = useCallback((handler: PrefixActionHandler | null) => {
    controllerRef.current!.literalHandler.current = handler;
  }, []);

  const value = useMemo<PrefixKeyContextValue>(
    () => ({
      armed,
      handleKeydown,
      isPrefixKeyEvent,
      setActionHandler,
      clearActionHandler,
      setLiteralHandler,
    }),
    [
      armed,
      handleKeydown,
      isPrefixKeyEvent,
      setActionHandler,
      clearActionHandler,
      setLiteralHandler,
    ],
  );

  return (
    <PrefixKeyContext.Provider value={value}>
      {children}
    </PrefixKeyContext.Provider>
  );
}

// Standalone controller for callers outside the provider (defensive — the
// app always renders one, but tests may render leaf components bare).
let fallbackValue: PrefixKeyContextValue | null = null;

function getFallbackPrefixKey(): PrefixKeyContextValue {
  if (!fallbackValue) {
    const controller = createPrefixKeyController();
    fallbackValue = {
      armed: false,
      handleKeydown: (event) => runControllerKeydown(controller, event),
      isPrefixKeyEvent: (event) =>
        isPrefixTriggerEvent(event) || controller.engine.isArmed(),
      setActionHandler: (action, handler) => {
        controller.actionHandlers.set(action, handler);
      },
      clearActionHandler: (action) => {
        controller.actionHandlers.delete(action);
      },
      setLiteralHandler: (handler) => {
        controller.literalHandler.current = handler;
      },
    };
  }
  return fallbackValue;
}

export function usePrefixKey(): PrefixKeyContextValue {
  return useContext(PrefixKeyContext) ?? getFallbackPrefixKey();
}
