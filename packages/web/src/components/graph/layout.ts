import type { TopologyGraphEdge, TopologyGraphNode } from './types';

export const GRAPH_NODE_WIDTH = 220;
export const GRAPH_NODE_HEIGHT = 100;
export const GRAPH_GAP_X = 90;
export const GRAPH_GAP_Y = 24;

/**
 * Computes deterministic 2D positions for nodes in a directed graph.
 * If nodes already have positions defined, those are respected.
 * For unpositioned nodes, it performs longest-path DAG layering so dependencies
 * flow naturally from left to right with no layout jank or physics jitter.
 */
export function computeGraphLayout(
  nodes: readonly TopologyGraphNode[],
  edges: readonly TopologyGraphEdge[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) {
    return positions;
  }

  const allPositioned = nodes.every((n) => n.position !== undefined);
  if (allPositioned) {
    for (const n of nodes) {
      if (n.position) positions.set(n.id, n.position);
    }
    return positions;
  }

  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }

  const validNodeIds = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    if (validNodeIds.has(edge.source) && validNodeIds.has(edge.target)) {
      outgoing.get(edge.source)?.push(edge.target);
      incoming.get(edge.target)?.push(edge.source);
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }
  }

  const layer = new Map<string, number>();
  const queue: string[] = [];

  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      layer.set(id, 0);
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currLayer = layer.get(curr) ?? 0;
    for (const next of outgoing.get(curr) ?? []) {
      const nextLayer = Math.max(layer.get(next) ?? 0, currLayer + 1);
      layer.set(next, nextLayer);
      const remaining = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) {
        queue.push(next);
      }
    }
  }

  for (const node of nodes) {
    if (!layer.has(node.id)) {
      layer.set(node.id, 0);
    }
  }

  const layers = new Map<number, TopologyGraphNode[]>();
  for (const node of nodes) {
    const l = layer.get(node.id) ?? 0;
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l)!.push(node);
  }

  const sortedLayers = Array.from(layers.keys()).sort((a, b) => a - b);
  for (const l of sortedLayers) {
    const nodesInLayer = layers.get(l)!;
    nodesInLayer.forEach((node, rowIndex) => {
      if (node.position) {
        positions.set(node.id, node.position);
      } else {
        positions.set(node.id, {
          x: l * (GRAPH_NODE_WIDTH + GRAPH_GAP_X),
          y: rowIndex * (GRAPH_NODE_HEIGHT + GRAPH_GAP_Y),
        });
      }
    });
  }

  return positions;
}
