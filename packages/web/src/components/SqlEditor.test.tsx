import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SqlEditor } from './SqlEditor';

describe('SqlEditor component', () => {
  const sampleSql = 'SELECT * FROM "beluga_lake"."analytics"."orders" LIMIT 20;';

  it('renders read-only starter SQL and title in static markup', () => {
    const html = renderToStaticMarkup(
      <SqlEditor
        value={sampleSql}
        readOnly={true}
        title="Trino Starter SQL"
        ariaLabel="Trino starter SQL editor"
        readOnlyBadgeLabel="Read-only starter SQL"
        copyLabel="Copy SQL"
      />,
    );

    expect(html).toContain('Trino Starter SQL');
    expect(html).toContain('Read-only starter SQL');
    expect(html).toContain('Copy SQL');
    expect(html).toContain('SELECT * FROM &quot;beluga_lake&quot;.&quot;analytics&quot;.&quot;orders&quot; LIMIT 20;');
    expect(html).toContain('aria-label="Trino starter SQL editor"');
  });

  it('does not contain query execution buttons or mutating actions (read-first design)', () => {
    const html = renderToStaticMarkup(
      <SqlEditor
        value={sampleSql}
        readOnly={true}
        title="Trino Starter SQL"
      />,
    );

    expect(html).not.toContain('Run Query');
    expect(html).not.toContain('Execute');
    expect(html).not.toContain('<textarea');
  });

  it('renders extra action buttons if provided', () => {
    const html = renderToStaticMarkup(
      <SqlEditor
        value={sampleSql}
        extraActions={<span id="test-action">Extra Link</span>}
      />,
    );

    expect(html).toContain('id="test-action"');
    expect(html).toContain('Extra Link');
  });
});
