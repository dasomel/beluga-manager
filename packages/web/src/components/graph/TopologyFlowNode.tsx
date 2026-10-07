import React from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { Translations } from '../../i18n/translations';
import { StatusBadge } from '../StatusBadge';
import type { TopologyGraphNode } from './types';

export interface TopologyFlowNodeData extends Record<string, unknown> {
  node: TopologyGraphNode;
  t: Translations;
  isSelected: boolean;
  onSelect?: (nodeId: string) => void;
}

export type TopologyFlowNodeType = Node<TopologyFlowNodeData, 'topology'>;

export function TopologyFlowNode({ data }: NodeProps<TopologyFlowNodeType>) {
  const { node, t, isSelected, onSelect } = data;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(node.id);
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (typeof document !== 'undefined') {
        const current = e.currentTarget;
        const allNodes = Array.from(document.querySelectorAll<HTMLElement>('[data-topology-node="true"]'));
        const index = allNodes.indexOf(current);
        if (index >= 0 && index < allNodes.length - 1) {
          allNodes[index + 1]?.focus();
        }
      }
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (typeof document !== 'undefined') {
        const current = e.currentTarget;
        const allNodes = Array.from(document.querySelectorAll<HTMLElement>('[data-topology-node="true"]'));
        const index = allNodes.indexOf(current);
        if (index > 0) {
          allNodes[index - 1]?.focus();
        }
      }
      return;
    }
  };

  const accessibleName =
    node.ariaLabel ??
    `${node.title}: ${node.subtitle}${node.status ? `, ${t.common.status}: ${t.status[node.status]}` : ''}`;

  return (
    <div
      role="button"
      tabIndex={0}
      data-topology-node="true"
      data-node-id={node.id}
      aria-selected={isSelected}
      aria-label={accessibleName}
      onClick={() => onSelect?.(node.id)}
      onKeyDown={handleKeyDown}
      className={`w-[220px] rounded-xl border bg-white dark:bg-slate-900 p-3.5 shadow-xs transition-all cursor-pointer text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-cyan-500 dark:focus-visible:ring-cyan-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${
        isSelected
          ? 'border-cyan-500 dark:border-cyan-400 ring-2 ring-cyan-400/40 bg-cyan-50/20 dark:bg-cyan-950/20'
          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-400 dark:!bg-slate-500" />
      <div className="flex items-center justify-between gap-1 mb-1.5">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-900 dark:text-white font-mono truncate">
          {node.title}
        </span>
        {node.badge && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold border border-slate-200 dark:border-slate-700">
            {node.badge}
          </span>
        )}
      </div>
      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 font-medium mb-2.5 truncate" title={node.subtitle}>
        {node.subtitle}
      </div>
      {node.status && <StatusBadge status={node.status} t={t} />}
      <Handle type="source" position={Position.Right} className="!bg-slate-400 dark:!bg-slate-500" />
    </div>
  );
}
