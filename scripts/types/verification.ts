export interface VerificationStepResult {
  step: string;
  exitCode: number;
  durationMs: number;
}
export interface SuiteResources {
  resourceId: string;
  suite: string;
  interrupted: string | null;
  cleanupComplete: boolean;
  failedResources: string[];
}
