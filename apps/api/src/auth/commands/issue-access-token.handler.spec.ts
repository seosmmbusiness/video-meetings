import { JwtService } from '@nestjs/jwt';
import { IssueAccessTokenCommand } from './issue-access-token.command';
import { IssueAccessTokenHandler } from './issue-access-token.handler';

/** The exact claim set every token this app issues carries (D-9, D-10). */
const CLAIMS = ['email', 'sub', 'ver'] as const;

describe('IssueAccessTokenHandler', () => {
  let signAsync: jest.Mock;
  let handler: IssueAccessTokenHandler;

  beforeEach(() => {
    signAsync = jest.fn().mockResolvedValue('signed.jwt.token');
    handler = new IssueAccessTokenHandler({
      signAsync,
    } as unknown as JwtService);
  });

  it('signs exactly { sub, email, ver } and nothing else (D-10)', async () => {
    await handler.execute(
      new IssueAccessTokenCommand('user-1', 'alice@example.com', 3),
    );

    expect(signAsync).toHaveBeenCalledTimes(1);
    const [payload] = signAsync.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(payload).sort()).toEqual([...CLAIMS]);
    expect(payload).toEqual({
      sub: 'user-1',
      email: 'alice@example.com',
      ver: 3,
    });
  });

  it("carries the account's revocation counter verbatim, including 0 (D-9)", async () => {
    await handler.execute(
      new IssueAccessTokenCommand('user-1', 'alice@example.com', 0),
    );

    const [payload] = signAsync.mock.calls[0] as [{ ver: number }];
    // A fresh account is at 0, and the claim has to say so rather than be
    // omitted — an omitted claim is indistinguishable from a legacy token.
    expect(payload.ver).toBe(0);
  });

  it('returns the signed token', async () => {
    await expect(
      handler.execute(
        new IssueAccessTokenCommand('user-1', 'alice@example.com', 1),
      ),
    ).resolves.toBe('signed.jwt.token');
  });
});
