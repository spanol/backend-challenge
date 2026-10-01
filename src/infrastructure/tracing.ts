import { SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { LogEvent } from './constants/log-events';
import { errorCode, log } from './observability';

const serviceName = 'distributed-wagering-processor';
let provider: BasicTracerProvider | undefined;
let shutdownPromise: Promise<void> | undefined;

export function initializeTracing(): void {
  const baseEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  if (!baseEndpoint) return;

  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
    new URL('/v1/traces', baseEndpoint).toString();

  provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME ?? serviceName,
    }),
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint }), {
        maxExportBatchSize: 64,
        scheduledDelayMillis: 1000,
      }),
    ],
  });

  trace.setGlobalTracerProvider(provider);
  log(LogEvent.TELEMETRY_STARTED, { serviceName: process.env.OTEL_SERVICE_NAME ?? serviceName });
}

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  operation: (span: Span) => Promise<T>,
): Promise<T> {
  const span = trace.getTracer(serviceName).startSpan(name, { attributes });

  try {
    return await operation(span);
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;

    span.setStatus(
      message ? { code: SpanStatusCode.ERROR, message } : { code: SpanStatusCode.ERROR },
    );

    if (error instanceof Error) span.recordException(error);

    throw error;
  } finally {
    span.end();
  }
}

export function shutdownTracing(): Promise<void> {
  if (!provider) return Promise.resolve();

  shutdownPromise ??= provider.shutdown().catch((error: unknown) => {
    log(LogEvent.TELEMETRY_SHUTDOWN_FAILED, { errorCode: errorCode(error) });
  });

  return shutdownPromise;
}
