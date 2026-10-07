import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { getTranslations } from '../i18n/getTranslations';
import { DataTable } from './DataTable';

interface TestRow {
  id: string;
  name: string;
  status: string;
}

const columns: ColumnDef<TestRow, any>[] = [
  {
    accessorKey: 'id',
    header: 'ID',
    cell: (info) => info.getValue(),
  },
  {
    accessorKey: 'name',
    header: 'Name',
    cell: (info) => info.getValue(),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: (info) => info.getValue(),
  },
];

const testData: TestRow[] = [
  { id: '1', name: 'Alpha', status: 'healthy' },
  { id: '2', name: 'Beta', status: 'degraded' },
];

const tEn = getTranslations('en-US');
const tKo = getTranslations('ko-KR');

describe('DataTable component', () => {
  it('renders data grid with headers, cells, and row count', () => {
    const html = renderToStaticMarkup(
      <DataTable
        data={testData}
        columns={columns}
        t={tEn}
        locale="en-US"
        ariaLabel="Test Data Grid"
      />,
    );

    // Headers
    expect(html).toContain('ID');
    expect(html).toContain('Name');
    expect(html).toContain('Status');

    // Data rows
    expect(html).toContain('Alpha');
    expect(html).toContain('Beta');
    expect(html).toContain('healthy');
    expect(html).toContain('degraded');

    // Row count
    expect(html).toContain('2 row(s)');

    // Sticky header & role semantics
    expect(html).toContain('sticky top-0');
    expect(html).toContain('role="table"');
    expect(html).toContain('aria-label="Test Data Grid"');
  });

  it('renders empty state when data array is empty', () => {
    const html = renderToStaticMarkup(
      <DataTable
        data={[]}
        columns={columns}
        t={tEn}
        emptyMessage="Custom empty notice"
      />,
    );

    expect(html).toContain('Custom empty notice');
    expect(html).toContain('0 row(s)');
  });

  it('renders loading state when isLoading is true', () => {
    const html = renderToStaticMarkup(
      <DataTable
        data={[]}
        columns={columns}
        t={tEn}
        isLoading={true}
      />,
    );

    expect(html).toContain(tEn.common.loading);
  });

  it('renders error state when error is provided', () => {
    const html = renderToStaticMarkup(
      <DataTable
        data={[]}
        columns={columns}
        t={tEn}
        error={new Error('Data grid connection failed')}
      />,
    );

    expect(html).toContain(tEn.common.loadError);
    expect(html).toContain('Data grid connection failed');
  });

  it('renders pagination controls when pagination prop is passed', () => {
    const html = renderToStaticMarkup(
      <DataTable
        data={testData}
        columns={columns}
        t={tEn}
        pagination={{
          page: 1,
          pageSize: 2,
          total: 10,
        }}
      />,
    );

    expect(html).toContain('Page 1 of 5');
    expect(html).toContain(`aria-label="${tEn.table.previousPage}"`);
    expect(html).toContain(`aria-label="${tEn.table.nextPage}"`);
  });

  it('renders Korean translations correctly', () => {
    const html = renderToStaticMarkup(
      <DataTable
        data={testData}
        columns={columns}
        t={tKo}
        locale="ko-KR"
        pagination={{
          page: 1,
          pageSize: 2,
          total: 10,
        }}
      />,
    );

    expect(html).toContain('2개 행');
    expect(html).toContain('5페이지 중 1페이지');
    expect(html).toContain(tKo.table.columnsVisibility);
    expect(html).toContain(`aria-label="${tKo.table.previousPage}"`);
    expect(html).toContain(`aria-label="${tKo.table.nextPage}"`);
  });
});
