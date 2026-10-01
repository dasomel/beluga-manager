import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataAsset, QueryContext } from '@beluga-manager/domain-api/schema';
import { getTranslations } from '../i18n/getTranslations';
import { QueryWorkspaceView } from './QueryWorkspaceView';

const mocks = vi.hoisted(() => ({
  assets: [] as DataAsset[],
  assetsLoading: false,
  assetsError: false,
  context: undefined as QueryContext | undefined,
  contextLoading: false,
  contextError: false,
  requestedId: undefined as string | null | undefined,
}));

vi.mock('../api/hooks', () => ({
  useDataAssets: () => ({
    data: mocks.assetsError ? undefined : { data: mocks.assets, meta: { total: mocks.assets.length, page: 1, pageSize: 100 } },
    isLoading: mocks.assetsLoading,
    isError: mocks.assetsError,
    error: mocks.assetsError ? new Error('assets down') : null,
  }),
  useQueryContext: (id: string | null | undefined) => {
    mocks.requestedId = id;
    return {
      data: mocks.contextError ? undefined : mocks.context,
      isLoading: mocks.contextLoading,
      isError: mocks.contextError,
      error: mocks.contextError ? new Error('context 404') : null,
    };
  },
}));

const tEn = getTranslations('en-US');
const tKo = getTranslations('ko-KR');

const asset = (id: string, name: string, kind: DataAsset['kind'] = 'table'): DataAsset => ({
  id,
  name,
  kind,
  serviceId: 'svc-iceberg',
  status: 'healthy',
});

const ordersContext: QueryContext = {
  assetId: 'asset-table-orders',
  catalog: 'beluga_lake',
  schema: 'analytics',
  table: 'orders',
  trinoServiceId: 'svc-trino',
  trinoUiUrl: 'https://trino.local.beluga.internal',
  sampleSql: 'SELECT * FROM "beluga_lake"."analytics"."orders" LIMIT 20',
  readOnly: true,
  rowLimit: 20,
};

describe('QueryWorkspaceView', () => {
  beforeEach(() => {
    mocks.assets = [asset('asset-topic-x', 'orders.events', 'topic'), asset('asset-table-orders', 'analytics.orders')];
    mocks.assetsLoading = false;
    mocks.assetsError = false;
    mocks.context = ordersContext;
    mocks.contextLoading = false;
    mocks.contextError = false;
    mocks.requestedId = undefined;
  });

  it('success: shows the Trino target, starter SQL, copy button and Open in Trino link', () => {
    const html = renderToStaticMarkup(<QueryWorkspaceView t={tEn} />);
    expect(html).toContain('beluga_lake.analytics.orders');
    expect(html).toContain('SELECT * FROM &quot;beluga_lake&quot;.&quot;analytics&quot;.&quot;orders&quot; LIMIT 20');
    expect(html).toContain(tEn.query.copySql);
    expect(html).toContain(tEn.query.openInTrino);
    expect(html).toContain('href="https://trino.local.beluga.internal/"');
    // Defaults to the first *table* asset (topics are not queryable).
    expect(mocks.requestedId).toBe('asset-table-orders');
    expect(html).not.toContain('asset-topic-x');
  });

  it('does not pretend to execute queries: no Run button or mock results', () => {
    const html = renderToStaticMarkup(<QueryWorkspaceView t={tEn} />);
    expect(html).not.toContain('Run Query');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('Query Succeeded');
    expect(html).toContain(tEn.query.readOnlyNote);
  });

  it('requests the handed-off initialAssetId from the catalog', () => {
    mocks.assets = [asset('asset-table-a', 'a.a'), asset('asset-table-b', 'b.b')];
    renderToStaticMarkup(<QueryWorkspaceView t={tEn} initialAssetId="asset-table-b" />);
    expect(mocks.requestedId).toBe('asset-table-b');
  });

  it('omits the Open in Trino link when the URL is not a safe http(s) URL', () => {
    mocks.context = { ...ordersContext, trinoUiUrl: 'javascript:alert(1)' };
    const html = renderToStaticMarkup(<QueryWorkspaceView t={tEn} />);
    expect(html).not.toContain(tEn.query.openInTrino);
    expect(html).not.toContain('javascript:');
  });

  it('loading: shows the loading state while the asset list loads', () => {
    mocks.assetsLoading = true;
    mocks.assets = [];
    const html = renderToStaticMarkup(<QueryWorkspaceView t={tEn} />);
    expect(html).toContain(tEn.common.loading);
  });

  it('loading: shows the loading state while the query context loads', () => {
    mocks.contextLoading = true;
    mocks.context = undefined;
    const html = renderToStaticMarkup(<QueryWorkspaceView t={tEn} />);
    expect(html).toContain(tEn.common.loading);
    expect(html).not.toContain(tEn.query.copySql);
  });

  it('error: shows the load error when the asset list fails', () => {
    mocks.assetsError = true;
    const html = renderToStaticMarkup(<QueryWorkspaceView t={tEn} />);
    expect(html).toContain(tEn.common.loadError);
    expect(html).toContain('assets down');
  });

  it('error: shows the load error when the query context fails', () => {
    mocks.contextError = true;
    const html = renderToStaticMarkup(<QueryWorkspaceView t={tEn} />);
    expect(html).toContain(tEn.common.loadError);
    expect(html).toContain('context 404');
    expect(html).not.toContain(tEn.query.copySql);
  });

  it('empty: shows the empty state when there are no table assets', () => {
    mocks.assets = [asset('asset-topic-x', 'orders.events', 'topic')];
    const html = renderToStaticMarkup(<QueryWorkspaceView t={tEn} />);
    expect(html).toContain(tEn.query.emptyState);
    expect(html).not.toContain(tEn.query.assetLabel);
  });

  it('renders Korean translations', () => {
    const html = renderToStaticMarkup(<QueryWorkspaceView t={tKo} locale="ko-KR" />);
    expect(html).toContain(tKo.query.title);
    expect(html).toContain(tKo.query.openInTrino);
    expect(html).toContain(tKo.query.copySql);
  });
});
