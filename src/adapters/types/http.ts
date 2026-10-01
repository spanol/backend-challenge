export interface HttpRequest {
  correlationId: string;
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface HttpResponse {
  status(code: number): HttpResponse;

  json(body: unknown): void;

  setHeader(name: string, value: string): void;

  send(body: string): void;

  statusCode: number;

  on(event: 'finish', listener: () => void): void;
}
