import { JwtAuthGuard } from './jwt-auth.guard';

describe('Guards', () => {
  it('should be defined', () => {
    expect(new JwtAuthGuard()).toBeDefined();
  });
});
