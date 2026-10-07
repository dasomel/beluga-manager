import { describe, expect, it } from 'vitest';
import { computeGraphLayout, GRAPH_NODE_WIDTH, GRAPH_GAP_X } from './layout';
import type { TopologyGraphEdge, TopologyGraphNode } from './types';

describe('computeGraphLayout', () => {
  it('returns empty map for empty node list', () => {
    const positions = computeGraphLayout([], []);
    expect(positions.size).toBe(0);
  });

  it('preserves existing explicit positions if all nodes are positioned', () => {
    const nodes: TopologyGraphNode[] = [
      { id: 'n1', title: 'N1', subtitle: 's1', position: { x: 10, y: 20 } },
      { id: 'n2', title: 'N2', subtitle: 's2', position: { x: 30, y: 40 } },
    ];
    const positions = computeGraphLayout(nodes, []);
    expect(positions.get('n1')).toEqual({ x: 10, y: 20 });
    expect(positions.get('n2')).toEqual({ x: 30, y: 40 });
  });

  it('computes linear DAG layering left-to-right', () => {
    const nodes: TopologyGraphNode[] = [
      { id: 'a', title: 'A', subtitle: 'a' },
      { id: 'b', title: 'B', subtitle: 'b' },
      { id: 'c', title: 'C', subtitle: 'c' },
    ];
    const edges: TopologyGraphEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ];
    const positions = computeGraphLayout(nodes, edges);
    const posA = positions.get('a')!;
    const posB = positions.get('b')!;
    const posC = positions.get('c')!;

    expect(posA.x).toBe(0);
    expect(posB.x).toBe(GRAPH_NODE_WIDTH + GRAPH_GAP_X);
    expect(posC.x).toBe((GRAPH_NODE_WIDTH + GRAPH_GAP_X) * 2);
  });

  it('handles diamond DAG structure (fan-out and fan-in)', () => {
    const nodes: TopologyGraphNode[] = [
      { id: 'root', title: 'Root', subtitle: 'r' },
      { id: 'left', title: 'Left', subtitle: 'l' },
      { id: 'right', title: 'Right', subtitle: 'r' },
      { id: 'sink', title: 'Sink', subtitle: 's' },
    ];
    const edges: TopologyGraphEdge[] = [
      { id: 'e1', source: 'root', target: 'left' },
      { id: 'e2', source: 'root', target: 'right' },
      { id: 'e3', source: 'left', target: 'sink' },
      { id: 'e4', source: 'right', target: 'sink' },
    ];
    const positions = computeGraphLayout(nodes, edges);
    expect(positions.get('root')!.x).toBe(0);
    expect(positions.get('left')!.x).toBe(GRAPH_NODE_WIDTH + GRAPH_GAP_X);
    expect(positions.get('right')!.x).toBe(GRAPH_NODE_WIDTH + GRAPH_GAP_X);
    expect(positions.get('sink')!.x).toBe((GRAPH_NODE_WIDTH + GRAPH_GAP_X) * 2);
    // Rows within the same layer should differ
    expect(positions.get('left')!.y).not.toBe(positions.get('right')!.y);
  });

  it('scales cleanly to 50 nodes without collisions or errors', () => {
    const nodes: TopologyGraphNode[] = Array.from({ length: 50 }, (_, i) => ({
      id: `node-${i}`,
      title: `Node ${i}`,
      subtitle: `sub-${i}`,
    }));
    // Chain groups of 5
    const edges: TopologyGraphEdge[] = [];
    for (let i = 0; i < 49; i++) {
      edges.push({ id: `e-${i}`, source: `node-${i}`, target: `node-${i + 1}` });
    }
    const positions = computeGraphLayout(nodes, edges);
    expect(positions.size).toBe(50);
    for (let i = 0; i < 50; i++) {
      expect(positions.get(`node-${i}`)).toBeDefined();
    }
  });
});
