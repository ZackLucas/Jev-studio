import { SystemOneClient } from '@jev/core';
import type { SystemOneGateway } from '../ports';

/**
 * The only outbound adapter. TypeSafe and jeff share the official wire format,
 * so the same code serves both — only the base URL and key differ.
 */
export class HttpSystemOneGateway implements SystemOneGateway {
  evaluate: SystemOneGateway['evaluate'] = (request, opts) =>
    new SystemOneClient({
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      retry: opts.retry,
      timeoutMs: opts.timeoutMs,
    }).evaluate(request);
}
