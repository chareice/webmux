export type PaneLeaf = {
  type: "leaf";
  terminalId: string;
};

export type PaneSplit = {
  type: "split";
  direction: "horizontal" | "vertical";
  children: [PaneNode, PaneNode];
  ratio: number;
};

export type PaneNode = PaneLeaf | PaneSplit;

export function createLeaf(terminalId: string): PaneLeaf {
  return { type: "leaf", terminalId };
}

export function splitPane(
  root: PaneNode,
  targetTerminalId: string,
  newTerminalId: string,
  direction: "horizontal" | "vertical",
): PaneNode {
  if (root.type === "leaf") {
    if (root.terminalId === targetTerminalId) {
      return {
        type: "split",
        direction,
        children: [
          { type: "leaf", terminalId: targetTerminalId },
          { type: "leaf", terminalId: newTerminalId },
        ],
        ratio: 0.5,
      };
    }
    return root;
  }

  return {
    ...root,
    children: [
      splitPane(root.children[0], targetTerminalId, newTerminalId, direction),
      splitPane(root.children[1], targetTerminalId, newTerminalId, direction),
    ],
  };
}

export function removePane(root: PaneNode, terminalId: string): PaneNode | null {
  if (root.type === "leaf") {
    return root.terminalId === terminalId ? null : root;
  }

  const left = removePane(root.children[0], terminalId);
  const right = removePane(root.children[1], terminalId);

  if (!left && !right) return null;
  if (!left) return right;
  if (!right) return left;

  return { ...root, children: [left, right] };
}

export function updateRatio(
  root: PaneNode,
  targetNode: PaneSplit,
  newRatio: number,
): PaneNode {
  if (root === targetNode && root.type === "split") {
    return { ...root, ratio: Math.max(0.1, Math.min(0.9, newRatio)) };
  }
  if (root.type === "split") {
    return {
      ...root,
      children: [
        updateRatio(root.children[0], targetNode, newRatio),
        updateRatio(root.children[1], targetNode, newRatio),
      ],
    };
  }
  return root;
}

export function collectTerminalIds(root: PaneNode): string[] {
  if (root.type === "leaf") return [root.terminalId];
  return [
    ...collectTerminalIds(root.children[0]),
    ...collectTerminalIds(root.children[1]),
  ];
}

export function getLeaves(root: PaneNode): PaneLeaf[] {
  if (root.type === "leaf") return [root];
  return [...getLeaves(root.children[0]), ...getLeaves(root.children[1])];
}
