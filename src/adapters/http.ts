import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Injectable,
  Module,
  Param,
  Post,
  Query,
  Req,
  Res,
  type ExceptionFilter,
  type BeforeApplicationShutdown,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import {
  identifier,
  newId,
  object,
  parseCommand,
  parseMoney,
  RequestError,
} from '../application/contracts';
import { RUNTIME } from '../infrastructure/constants/runtime';
import type { Runtime } from '../infrastructure/types/runtime';
import { errorCode, log } from '../infrastructure/observability';
import type { HttpRequest, HttpResponse } from './types/http';

@Controller()
export class ApiController {
  constructor(@Inject(RUNTIME) private readonly rt: Runtime) {}

  @Post('wallets')
  async open(@Body() input: unknown, @Req() req: HttpRequest) {
    const body = object(input);

    if (Object.keys(body).some((k) => !['playerId', 'initialBalance'].includes(k)))
      throw new RequestError(400, 'UNKNOWN_FIELD');

    return this.rt.service.openWallet(
      identifier(body.playerId, 'player', true),
      parseMoney(body.initialBalance),
      { correlationId: req.correlationId },
    );
  }

  @Get('wallets/:walletId') wallet(@Param('walletId') id: string) {
    return this.rt.queries.wallet(identifier(id, 'wallet', true));
  }

  @Get('wallets/:walletId/ledger') ledger(
    @Param('walletId') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.rt.queries.ledger(
      identifier(id, 'wallet', true),
      cursor,
      limit === undefined ? 50 : Number(limit),
    );
  }

  @Post('wallets/:walletId/reconciliation') async reconcile(
    @Param('walletId') id: string,
    @Res() response: HttpResponse,
  ) {
    response.status(200).json(await this.rt.queries.reconciliation(identifier(id, 'wallet', true)));
  }

  @Get('wagering/transactions/:transactionId') transaction(@Param('transactionId') id: string) {
    return this.rt.queries.transaction(identifier(id, 'transaction', true));
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId') external(
    @Param('providerId') provider: string,
    @Param('externalTransactionId') external: string,
  ) {
    return this.rt.queries.external(
      identifier(provider, 'provider'),
      identifier(external, 'externalTransaction'),
    );
  }

  @Post('wagering/transactions')
  async process(
    @Body() input: unknown,
    @Headers('idempotency-key') key: unknown,
    @Req() req: HttpRequest,
    @Res() response: HttpResponse,
  ) {
    const timer = this.rt.metrics.latency.startTimer({ transport: 'http' });

    try {
      const body = object(input);

      if ('idempotencyKey' in body) throw new RequestError(400, 'IDEMPOTENCY_KEY_MUST_BE_HEADER');

      const command = parseCommand(body, key);
      const result = await this.rt.service.process(command, { correlationId: req.correlationId });

      if (result.idempotentReplay) this.rt.metrics.duplicates.inc();
      else this.rt.metrics.transactions.inc({ status: result.status });

      log('wager_committed', {
        correlationId: req.correlationId,
        transactionId: result.transactionId,
        walletId: command.walletId,
        providerId: command.providerId,
        status: result.status,
        idempotentReplay: result.idempotentReplay,
      });
      response
        .status(
          result.status === 'PENDING_REFERENCE'
            ? 202
            : result.status === 'REJECTED'
              ? 422
              : result.status === 'FAILED'
                ? 503
                : 200,
        )
        .json(result);
    } finally {
      timer();
    }
  }

  @Get('health/live') live() {
    return { status: 'ok' };
  }

  @Get('health/ready') async ready(@Res() response: HttpResponse) {
    const checks = await Promise.allSettled([
      this.rt.db.em.fork().execute<unknown[]>('SELECT 1'),
      ...[this.rt.queues.requests, this.rt.queues.dlq, this.rt.queues.events].map((QueueUrl) =>
        this.rt.client.send(
          new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ['QueueArn'] }),
        ),
      ),
    ]);

    const ready = checks.every((c) => c.status === 'fulfilled');

    response.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'unavailable',
      postgres: checks[0].status === 'fulfilled',
      sqs: checks.slice(1).every((c) => c.status === 'fulfilled'),
    });
  }

  @Get('metrics') async metrics(@Res() response: HttpResponse) {
    response.setHeader('Content-Type', this.rt.metrics.registry.contentType);
    response.send(await this.rt.metrics.registry.metrics());
  }
}

@Catch()
class ApiErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest<HttpRequest>();
    const res = host.switchToHttp().getResponse<HttpResponse>();
    const code = errorCode(error);

    const status =
      error instanceof RequestError
        ? error.status
        : error instanceof HttpException
          ? error.getStatus()
          : 503;

    const publicCode =
      error instanceof RequestError
        ? error.code
        : error instanceof HttpException
          ? 'INVALID_REQUEST'
          : 'SERVICE_UNAVAILABLE';

    log('request_failed', {
      correlationId: req.correlationId,
      errorCode: code,
      statusCode: status,
    });
    res.status(status).json({ error: publicCode, correlationId: req.correlationId });
  }
}

@Injectable()
class Lifecycle implements BeforeApplicationShutdown, OnApplicationShutdown {
  constructor(@Inject(RUNTIME) private readonly rt: Runtime) {}

  async beforeApplicationShutdown(): Promise<void> {
    log('shutdown_draining');
    await this.rt.workers.stop();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.rt.db.close(true);
    this.rt.client.destroy();
    log('shutdown_completed');
  }
}

@Module({})
class AppModule {}

export async function createHttpApp(rt: Runtime) {
  const app = await NestFactory.create(
    {
      module: AppModule,
      controllers: [ApiController],
      providers: [{ provide: RUNTIME, useValue: rt }, Lifecycle],
    },
    { logger: false, bodyParser: true, abortOnError: false },
  );

  app.use((req: HttpRequest, res: HttpResponse, next: () => void) => {
    const provided = req.headers['x-correlation-id'];

    req.correlationId =
      typeof provided === 'string' && /^[\w.:-]{1,200}$/.test(provided) ? provided : newId();
    res.setHeader('X-Correlation-Id', req.correlationId);

    const start = performance.now();

    res.on('finish', () =>
      log('http_request', {
        correlationId: req.correlationId,
        method: req.method,
        statusCode: res.statusCode,
        durationMs: Math.round(performance.now() - start),
      }),
    );
    next();
  });
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);

  return app;
}
