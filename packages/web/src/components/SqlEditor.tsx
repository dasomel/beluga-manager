import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Lock, Terminal } from 'lucide-react';
import { EditorState, Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { sql } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';

export interface SqlEditorProps {
  value: string;
  readOnly?: boolean;
  title?: string;
  ariaLabel?: string;
  readOnlyBadgeLabel?: string;
  copyLabel?: string;
  copiedLabel?: string;
  copyFailedLabel?: string;
  onCopy?: () => Promise<boolean> | boolean;
  className?: string;
  extraActions?: React.ReactNode;
}

// D1: CodeMirror 6 (MIT, ADR-0003) modular editor. Read-only starter SQL mode displays
// syntax-highlighted SQL with line numbers and full keyboard navigation. Because Beluga is
// strictly read-first, no query execution endpoint or Run action exists.
export const SqlEditor: React.FC<SqlEditorProps> = ({
  value,
  readOnly = true,
  title,
  ariaLabel,
  readOnlyBadgeLabel,
  copyLabel,
  copiedLabel,
  copyFailedLabel,
  onCopy,
  className = '',
  extraActions,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Initialize CodeMirror in the browser
  useEffect(() => {
    if (!editorHostRef.current) return;

    const isDark = document.documentElement.classList.contains('dark');
    const extensions: Extension[] = [
      lineNumbers(),
      sql(),
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      EditorView.lineWrapping,
      EditorView.theme({
        '&': {
          height: '100%',
          fontSize: '12px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          backgroundColor: isDark ? '#020617' : '#ffffff',
          color: isDark ? '#67e8f9' : '#0f172a',
        },
        '.cm-scroller': {
          overflow: 'auto',
          lineHeight: '1.6',
        },
        '.cm-content': {
          padding: '12px 0',
        },
        '.cm-line': {
          padding: '0 12px',
        },
        '.cm-gutters': {
          backgroundColor: isDark ? '#020617' : '#f8fafc',
          borderRight: isDark ? '1px solid #1e293b' : '1px solid #e2e8f0',
          color: isDark ? '#64748b' : '#94a3b8',
          fontSize: '11px',
        },
        '.cm-activeLineGutter': {
          backgroundColor: isDark ? '#0f172a' : '#f1f5f9',
        },
      }),
    ];

    if (isDark) {
      extensions.push(oneDark);
    }

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorHostRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [readOnly]);

  // Keep editor document synchronized if value changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
    }
  }, [value]);

  // Handle clipboard copy
  const handleCopy = async () => {
    let success = false;
    if (onCopy) {
      success = Boolean(await onCopy());
    } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(value);
        success = true;
      } catch {
        success = false;
      }
    }
    setCopied(success);
    setCopyFailed(!success);
    setTimeout(() => {
      setCopied(false);
      setCopyFailed(false);
    }, 2000);
  };

  const copyStatusText = copied ? copiedLabel : copyFailed ? copyFailedLabel : copyLabel;

  return (
    <div
      role="region"
      aria-label={ariaLabel}
      className={`rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs ${className}`}
      ref={containerRef}
    >
      {/* Editor Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs">
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-mono font-bold">
          <Terminal className="h-4 w-4 text-cyan-700 dark:text-cyan-400" aria-hidden="true" />
          {title && <span>{title}</span>}
          {readOnly && readOnlyBadgeLabel && (
            <span className="inline-flex items-center gap-1 rounded bg-slate-200/80 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-mono font-bold text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
              <Lock className="h-3 w-3 text-slate-500 dark:text-slate-400" aria-hidden="true" />
              {readOnlyBadgeLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {copyLabel && (
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white px-2 py-1 rounded hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors font-bold focus:outline-hidden focus-visible:ring-2 focus-visible:ring-cyan-500"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {copyStatusText && <span>{copyStatusText}</span>}
            </button>
          )}
          {extraActions}
        </div>
      </div>

      {/* Editor Body: CodeMirror host in browser; static pre/code fallback in Node/SSR */}
      <div className="relative focus-within:ring-2 focus-within:ring-cyan-500 focus-within:ring-inset">
        <div ref={editorHostRef} className={isMounted ? 'min-h-[120px]' : 'hidden'} />
        {!isMounted && (
          <pre className="rounded-b-xl bg-slate-950 p-4 border-t border-slate-800 text-xs font-mono text-cyan-300 overflow-x-auto leading-relaxed">
            <code>{value}</code>
          </pre>
        )}
      </div>
    </div>
  );
};
