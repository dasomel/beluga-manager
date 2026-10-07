import React, { useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Layout, Table as TableIcon, Keyboard } from 'lucide-react';
import { interpolate } from '../../i18n/interpolate';
import { StatusBadge } from '../StatusBadge';
import { LoadingState, ErrorState } from '../QueryState';
import { TopologyFlowNode, type TopologyFlowNodeType } from './TopologyFlowNode';
import { computeGraphLayout } from './layout';
import type { TopologyGraphProps } from './types';

const nodeTypes: NodeTypes = { topology: TopologyFlowNode };
const EDGE_COLOR = '#94a3b8'; // slate-400

export const TopologyGraph: React.FC<TopologyGraphProps> = ({
  t,
  theme = 'light',
  nodes,
  edges,
  selectedNodeId = null,
  onSelectNode,
  isLoading = false,
  error = null,
  emptyMessage,
  height = 420,
  className = '',
  ariaLabel,
}) => {
  const [viewMode, setViewMode] = useState<'graph' | 'table'>('graph');

  const layoutPositions = useMemo(
    () => computeGraphLayout(nodes, edges),
    [nodes, edges],
  );

  const flowNodes = useMemo<TopologyFlowNodeType[]>(() => {
    return nodes.map((node) => {
      const pos = layoutPositions.get(node.id) ?? node.position ?? { x: 0, y: 0 };
      return {
        id: node.id,
        type: 'topology',
        position: pos,
        data: {
          node,
          t,
          isSelected: selectedNodeId === node.id,
          onSelect: onSelectNode,
        },
      };
    });
  }, [nodes, layoutPositions, selectedNodeId, onSelectNode, t]);

  const flowEdges = useMemo<Edge[]>(() => {
    return edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: 'smoothstep',
      animated: edge.dashed,
      style: {
        stroke: EDGE_COLOR,
        strokeWidth: 2,
        strokeDasharray: edge.dashed ? '5,5' : undefined,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: EDGE_COLOR,
      },
    }));
  }, [edges]);

  if (isLoading) {
    return <LoadingState t={t} />;
  }

  if (error) {
    return <ErrorState t={t} error={error} />;
  }

  if (nodes.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-sm text-slate-500 dark:text-slate-400 font-medium">
        {emptyMessage ?? t.graph.emptyState}
      </div>
    );
  }

  const summaryText = interpolate(t.graph.summary, {
    nodes: String(nodes.length),
    edges: String(edges.length),
  });

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Accessible toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setViewMode('graph')}
            aria-pressed={viewMode === 'graph'}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              viewMode === 'graph'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Layout className="h-3.5 w-3.5" />
            {t.graph.graphView}
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            aria-pressed={viewMode === 'table'}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              viewMode === 'table'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <TableIcon className="h-3.5 w-3.5" />
            {t.graph.tableView}
          </button>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-medium">
          <span className="flex items-center gap-1">
            <Keyboard className="h-3.5 w-3.5" />
            {t.graph.keyboardHint}
          </span>
        </div>
      </div>

      {/* Screen reader summary announcement */}
      <div className="sr-only" aria-live="polite">
        {summaryText}
      </div>

      {viewMode === 'graph' ? (
        <div
          className="relative rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-50 dark:bg-slate-950"
          style={{ height }}
          role="region"
          aria-label={ariaLabel ?? t.graph.textAlternative}
        >
          <ReactFlow<TopologyFlowNodeType>
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => onSelectNode?.(n.id)}
            onPaneClick={() => onSelectNode?.(null)}
            nodesDraggable={false}
            nodesConnectable={false}
            zoomOnDoubleClick={false}
            colorMode={theme}
            proOptions={{ hideAttribution: true }}
            fitView
            fitViewOptions={{ padding: 0.3 }}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      ) : (
        <div className="space-y-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div>
            <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
              {t.graph.nodesTitle} ({nodes.length})
            </h5>
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">{t.graph.nodeLabel}</th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">{t.graph.typeLabel}</th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">{t.graph.statusLabel}</th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">{t.graph.viewDetails}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  {nodes.map((node) => {
                    const isSelected = selectedNodeId === node.id;
                    return (
                      <tr
                        key={node.id}
                        className={`hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors ${
                          isSelected ? 'bg-cyan-50/50 dark:bg-cyan-950/40 font-bold' : ''
                        }`}
                      >
                        <td className="px-3 py-2 font-mono font-medium text-slate-900 dark:text-white">
                          <button
                            type="button"
                            onClick={() => onSelectNode?.(node.id)}
                            className="text-left hover:underline text-cyan-700 dark:text-cyan-400 font-bold"
                          >
                            {node.title}: {node.subtitle}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300 font-mono">
                          {node.badge ?? '-'}
                        </td>
                        <td className="px-3 py-2">
                          {node.status ? <StatusBadge status={node.status} t={t} /> : '-'}
                        </td>
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                          {node.detail ?? '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {edges.length > 0 && (
            <div>
              <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
                {t.graph.edgesTitle} ({edges.length})
              </h5>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">{t.graph.sourceLabel}</th>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">{t.graph.targetLabel}</th>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">{t.graph.relationLabel}</th>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">{t.graph.confidenceLabel}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {edges.map((edge) => (
                      <tr key={edge.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                        <td className="px-3 py-2 font-mono text-slate-900 dark:text-white">{edge.source}</td>
                        <td className="px-3 py-2 font-mono text-slate-900 dark:text-white">{edge.target}</td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{edge.label ?? '-'}</td>
                        <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-300">
                          {edge.confidence !== undefined ? `${Math.round(edge.confidence * 100)}%` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
