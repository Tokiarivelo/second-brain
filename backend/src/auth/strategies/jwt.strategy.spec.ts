import { JwtStrategy } from './jwt.strategy';

describe('Strategies', () => {
  it('should be defined', () => {
    expect(new JwtStrategy()).toBeDefined();
  });
});
