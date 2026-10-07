import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getTranslations } from '../../i18n/getTranslations';
import { TopologyGraph } from './TopologyGraph';
import type { TopologyGraphEdge, TopologyGraphNode } from './types';

const tEn = getTranslations('en-US');
const tKo = getTranslations('ko-KR');

const testNodes: TopologyGraphNode[] = [
  {
    id: 'kafka-topic:orders',
    title: 'Kafka topic',
    subtitle: 'orders',
    badge: 'kafka-topic',
    status: 'healthy',
  },
  {
    id: 'flink-job:orders-sync',
    title: 'Flink job',
    subtitle: 'orders-sync',
    badge: 'flink-job',
    status: 'degraded',
  },
];

const testEdges: TopologyGraphEdge[] = [
  {
    id: 'e1',
    source: 'kafka-topic:orders',
    target: 'flink-job:orders-sync',
    label: 'Topic feeds job',
    confidence: 0.95,
  },
];

describe('TopologyGraph', () => {
  it('renders loading state when isLoading is true', () => {
    const html = renderToStaticMarkup(<TopologyGraph t={tEn} nodes={[]} edges={[]} isLoading={true} />);
    expect(html).toContain(tEn.common.loading);
  });

  it('renders error state when error is provided', () => {
    const html = renderToStaticMarkup(
      <TopologyGraph t={tEn} nodes={[]} edges={[]} error={new Error('Graph load error')} />,
    );
    expect(html).toContain(tEn.common.loadError);
    expect(html).toContain('Graph load error');
  });

  it('renders empty state when nodes are empty', () => {
    const html = renderToStaticMarkup(<TopologyGraph t={tEn} nodes={[]} edges={[]} />);
    expect(html).toContain(tEn.graph.emptyState);
  });

  it('renders custom empty message when provided', () => {
    const html = renderToStaticMarkup(
      <TopologyGraph t={tEn} nodes={[]} edges={[]} emptyMessage="Custom empty pipeline" />,
    );
    expect(html).toContain('Custom empty pipeline');
  });

  it('renders nodes with title, subtitle, badge, and status', () => {
    const html = renderToStaticMarkup(<TopologyGraph t={tEn} nodes={testNodes} edges={testEdges} />);
    expect(html).toContain('Kafka topic');
    expect(html).toContain('orders');
    expect(html).toContain('Flink job');
    expect(html).toContain('orders-sync');
    // Status text is rendered alongside badge colour (WCAG AA non-color signal)
    expect(html).toContain(tEn.status.healthy);
    expect(html).toContain(tEn.status.degraded);
  });

  it('includes keyboard navigation attributes and focus visible styles on nodes', () => {
    const html = renderToStaticMarkup(<TopologyGraph t={tEn} nodes={testNodes} edges={testEdges} />);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="button"');
    expect(html).toContain('data-topology-node="true"');
    expect(html).toContain('focus-visible:ring-2');
    expect(html).toContain(tEn.graph.keyboardHint);
  });

  it('renders screen reader summary text alternative', () => {
    const html = renderToStaticMarkup(<TopologyGraph t={tEn} nodes={testNodes} edges={testEdges} />);
    expect(html).toContain('class="sr-only"');
    expect(html).toContain('2'); // nodes count
    expect(html).toContain('1'); // edges count
  });

  it('renders Korean translations correctly', () => {
    const html = renderToStaticMarkup(<TopologyGraph t={tKo} nodes={testNodes} edges={testEdges} />);
    expect(html).toContain(tKo.graph.graphView);
    expect(html).toContain(tKo.graph.tableView);
    expect(html).toContain(tKo.graph.keyboardHint);
  });

  it('renders 50 nodes without throwing or crashing', () => {
    const fiftyNodes: TopologyGraphNode[] = Array.from({ length: 50 }, (_, i) => ({
      id: `node-${i}`,
      title: `Node ${i}`,
      subtitle: `sub-${i}`,
    }));
    const html = renderToStaticMarkup(<TopologyGraph t={tEn} nodes={fiftyNodes} edges={[]} />);
    expect(html).toContain('Node 0');
    expect(html).toContain('Node 49');
  });
});
