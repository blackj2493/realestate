// src/lib/avm/auditService.n.test.ts
import { describe, it, expect } from 'vitest';
import type { AuditInfo } from './auditService';

describe('AuditInfo', () => {
  it('carries cohort sample size n', () => {
    const info: AuditInfo = { r2: 0.7, basePrice: 800000, n: 117 };
    expect(info.n).toBe(117);
  });
});
