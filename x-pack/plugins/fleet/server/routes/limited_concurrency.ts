/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { KibanaRequest } from 'kibana/server';
import type {
  CoreSetup,
  LifecycleResponseFactory,
  OnPreAuthToolkit,
  OnPreAuthHandler,
} from 'kibana/server';
import { LIMITED_CONCURRENCY_ROUTE_TAG } from '../../common';
import type { FleetConfigType } from '../index';

export class MaxCounter {
  constructor(private readonly max: number = 1) {}
  private counter = 0;
  valueOf() {
    return this.counter;
  }
  increase() {
    if (this.counter < this.max) {
      this.counter += 1;
    }
  }
  decrease() {
    if (this.counter > 0) {
      this.counter -= 1;
    }
  }
  lessThanMax() {
    return this.counter < this.max;
  }
}

export type IMaxCounter = Pick<MaxCounter, 'increase' | 'decrease' | 'lessThanMax'>;

export function isLimitedRoute(request: KibanaRequest) {
  const tags = request.route.options.tags;
  return !!tags.includes(LIMITED_CONCURRENCY_ROUTE_TAG);
}

export function createLimitedPreAuthHandler({
  isMatch,
  maxCounter,
}: {
  isMatch: (request: KibanaRequest) => boolean;
  maxCounter: IMaxCounter;
}): OnPreAuthHandler {
  return function preAuthHandler(
    request: KibanaRequest,
    response: LifecycleResponseFactory,
    toolkit: OnPreAuthToolkit
  ) {
    if (!isMatch(request)) {
      return toolkit.next();
    }

    if (!maxCounter.lessThanMax()) {
      return response.customError({
        body: 'Too Many Requests',
        statusCode: 429,
      });
    }

    maxCounter.increase();

    request.events.completed$.toPromise().then(() => {
      maxCounter.decrease();
    });

    return toolkit.next();
  };
}

export function registerLimitedConcurrencyRoutes(core: CoreSetup, config: FleetConfigType) {
  const max = config.agents.maxConcurrentConnections;
  if (!max) return;

  core.http.registerOnPreAuth(
    createLimitedPreAuthHandler({
      isMatch: isLimitedRoute,
      maxCounter: new MaxCounter(max),
    })
  );
}
