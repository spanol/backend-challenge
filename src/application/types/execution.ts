export interface Clock {
  now(): Date;
}

export interface FaultHooks {
  beforeCommit?(): void | Promise<void>;

  afterCommit?(): void | Promise<void>;

  afterPublish?(eventId?: string): void | Promise<void>;
}
