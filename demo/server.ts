import { object, RequestError } from '../src/application/contracts';
import type { DemoTable } from './table';
import { DemoErrorCode, DemoRequestError } from './errors';

export function startDemoServer(
  table: DemoTable,
  port = 3200,
  options: { hostname?: string; publicOrigin?: string; isReady?: () => boolean } = {},
) {
  const publicOrigin = options.publicOrigin && new URL(options.publicOrigin).origin;
  const publicRoot = new URL('./public/', import.meta.url);
  const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'browser' });
  const assets: Record<string, string> = {
    '/': 'index.html',
    '/style.css': 'style.css',
    '/vendor/cena.js': 'vendor/cena.js',
    '/vendor/sprites/heroi.png': 'vendor/sprites/heroi.png',
  };

  return Bun.serve({
    hostname: options.hostname ?? '127.0.0.1',
    port,
    idleTimeout: 255,
    async fetch(request) {
      const url = new URL(request.url);

      try {
        if (request.method === 'GET' && url.pathname === '/client.js')
          return new Response(
            await transpiler.transform(await Bun.file(new URL('client.ts', publicRoot)).text()),
            { headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' } },
          );
        if (request.method === 'GET' && assets[url.pathname])
          return new Response(Bun.file(new URL(assets[url.pathname]!, publicRoot)), {
            headers: { 'Cache-Control': 'no-store' },
          });
        if (request.method === 'GET' && url.pathname === '/demo/health')
          return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
        if (request.method === 'GET' && url.pathname === '/demo/dashboard')
          return Response.json(
            table.dashboardView(
              Number(url.searchParams.get('offset') ?? 0),
              url.searchParams.get('selectedPeerId') ?? undefined,
            ),
          );
        if (request.method === 'GET' && url.pathname === '/demo/peer-options')
          return Response.json(
            table.peerOptions(
              url.searchParams.get('search') ?? '',
              url.searchParams.get('selectedPeerId') ?? undefined,
            ),
          );
        if (request.method === 'GET' && url.pathname === '/demo/state')
          return Response.json(table.view());
        if (request.method === 'GET' && url.pathname === '/demo/evidence')
          return Response.json(
            await table.evidence(
              url.searchParams.get('peerId') ?? '',
              url.searchParams.get('cursor') ?? undefined,
            ),
          );
        if (request.method !== 'POST' || !url.pathname.startsWith('/demo/'))
          return new Response('Not found', { status: 404 });
        if (
          !request.headers.get('content-type')?.startsWith('application/json') ||
          (request.headers.get('origin') &&
            request.headers.get('origin') !== (publicOrigin ?? url.origin))
        )
          throw new DemoRequestError(403, DemoErrorCode.INVALID_ORIGIN);

        if (options.isReady && !options.isReady())
          throw new DemoRequestError(503, DemoErrorCode.DEMO_INITIALIZING);

        const body = object((await request.json()) as unknown);
        const id = typeof body.id === 'string' ? body.id : '';

        switch (url.pathname) {
          case '/demo/session':
            if (
              typeof body.count !== 'number' ||
              (body.autoplay !== undefined && typeof body.autoplay !== 'boolean') ||
              (body.mode !== 'independent' && body.mode !== 'shared')
            )
              throw new DemoRequestError(400, DemoErrorCode.INVALID_SESSION);
            await table.session(
              body.count,
              body.mode,
              body.autoplay === true,
              body.mode === 'independent' ? 'deadline' : 'confirm_all',
            );
            break;
          case '/demo/autoplay':
            if (
              typeof body.enabled !== 'boolean' ||
              (body.peersPerRound !== undefined && typeof body.peersPerRound !== 'number')
            )
              throw new DemoRequestError(400, DemoErrorCode.INVALID_SESSION);
            await table.setAutoplay(body.enabled, body.peersPerRound);
            break;
          case '/demo/peers':
            if (typeof body.count !== 'number')
              throw new DemoRequestError(400, DemoErrorCode.INVALID_SESSION);
            await table.addPeers(body.count);
            break;
          case '/demo/bet':
            if (typeof body.amount !== 'string')
              throw new DemoRequestError(400, DemoErrorCode.INVALID_BET);
            if (body.allPeers === true) await table.queueAllBets(body.amount);
            else {
              if (
                !Array.isArray(body.peerIds) ||
                !body.peerIds.every((p): p is string => typeof p === 'string')
              )
                throw new DemoRequestError(400, DemoErrorCode.INVALID_BET);
              await table.queueBet(body.peerIds, body.amount);
            }
            break;
          case '/demo/cashout':
            await table.settle(id, 'win');
            break;
          case '/demo/cancel':
            await table.settle(id, 'refund');
            break;
          case '/demo/rollback':
            await table.settle(id, 'rollback');
            break;
          case '/demo/replay':
            await table.repeat(id);
            break;
          case '/demo/conflict':
            return Response.json({ status: await table.conflict(id) });
          case '/demo/retry':
            await table.retry();
            break;
          default:
            return new Response('Not found', { status: 404 });
        }

        return Response.json(
          url.searchParams.get('view') === 'dashboard'
            ? table.dashboardView(
                Number(url.searchParams.get('offset') ?? 0),
                url.searchParams.get('selectedPeerId') ?? undefined,
              )
            : table.view(),
        );
      } catch (error) {
        return Response.json(
          {
            error: error instanceof Error ? error.message : 'Falha na demo',
            code:
              error instanceof RequestError || error instanceof DemoRequestError
                ? error.code
                : DemoErrorCode.DEMO_UNAVAILABLE,
          },
          {
            status:
              error instanceof RequestError || error instanceof DemoRequestError
                ? error.status
                : 503,
          },
        );
      }
    },
  });
}
