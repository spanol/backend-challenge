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
import { ApplicationErrorCode, IdentifierField } from '../application/constants/errors';
import { HttpStatusCode } from '../application/constants/http-status';
import { WagerStatus } from '../domain/constants/wager';
import { HealthStatus } from '../domain/constants/health';
import { RUNTIME } from '../infrastructure/constants/runtime';
import { LogEvent } from '../infrastructure/constants/log-events';
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
      throw new RequestError(HttpStatusCode.BAD_REQUEST, ApplicationErrorCode.UNKNOWN_FIELD);

    const wallet = await this.rt.service.openWallet(
      identifier(body.playerId, IdentifierField.PLAYER, true),
      parseMoney(body.initialBalance),
      { correlationId: req.correlationId },
    );
    const { walletId, ...view } = wallet;

    return { id: walletId, ...view };
  }

  @Get('wallets/:walletId') wallet(@Param('walletId') id: string) {
    return this.rt.queries.wallet(identifier(id, IdentifierField.WALLET, true));
  }

  @Get('wallets/:walletId/ledger') ledger(
    @Param('walletId') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.rt.queries.ledger(
      identifier(id, IdentifierField.WALLET, true),
      cursor,
      limit === undefined ? 50 : Number(limit),
    );
  }

  @Post('wallets/:walletId/reconciliation') async reconcile(
    @Param('walletId') id: string,
    @Res() response: HttpResponse,
  ) {
    response
      .status(HttpStatusCode.OK)
      .json(await this.rt.queries.reconciliation(identifier(id, IdentifierField.WALLET, true)));
  }

  @Get('wagering/transactions/:transactionId') transaction(@Param('transactionId') id: string) {
    return this.rt.queries.transaction(identifier(id, IdentifierField.TRANSACTION, true));
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId') external(
    @Param('providerId') provider: string,
    @Param('externalTransactionId') external: string,
  ) {
    return this.rt.queries.external(
      identifier(provider, IdentifierField.PROVIDER),
      identifier(external, IdentifierField.EXTERNAL_TRANSACTION_PARAM),
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

      if ('idempotencyKey' in body)
        throw new RequestError(
          HttpStatusCode.BAD_REQUEST,
          ApplicationErrorCode.IDEMPOTENCY_KEY_MUST_BE_HEADER,
        );

      const command = parseCommand(body, key);
      const result = await this.rt.service.process(command, { correlationId: req.correlationId });

      if (result.idempotentReplay) this.rt.metrics.duplicates.inc();
      else this.rt.metrics.transactions.inc({ status: result.status });

      log(LogEvent.WAGER_COMMITTED, {
        correlationId: req.correlationId,
        transactionId: result.transactionId,
        walletId: command.walletId,
        providerId: command.providerId,
        status: result.status,
        idempotentReplay: result.idempotentReplay,
      });
      response
        .status(
          result.status === WagerStatus.PENDING_REFERENCE
            ? HttpStatusCode.ACCEPTED
            : result.status === WagerStatus.REJECTED
              ? HttpStatusCode.UNPROCESSABLE_ENTITY
              : result.status === WagerStatus.FAILED
                ? HttpStatusCode.SERVICE_UNAVAILABLE
                : HttpStatusCode.OK,
        )
        .json(result);
    } finally {
      timer();
    }
  }

  @Get('health/live') live() {
    return { status: HealthStatus.OK };
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

    response.status(ready ? HttpStatusCode.OK : HttpStatusCode.SERVICE_UNAVAILABLE).json({
      status: ready ? HealthStatus.OK : HealthStatus.UNAVAILABLE,
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
          : HttpStatusCode.SERVICE_UNAVAILABLE;

    const publicCode =
      error instanceof RequestError
        ? error.code
        : error instanceof HttpException
          ? ApplicationErrorCode.INVALID_REQUEST
          : ApplicationErrorCode.SERVICE_UNAVAILABLE;

    log(LogEvent.REQUEST_FAILED, {
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
    log(LogEvent.SHUTDOWN_DRAINING);
    await this.rt.workers.stop();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.rt.db.close(true);
    this.rt.client.destroy();
    log(LogEvent.SHUTDOWN_COMPLETED);
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
      log(LogEvent.HTTP_REQUEST, {
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
